#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");

const SKILLS = [
  { name: "opsx-deliberate", command: "opsx-deliberate.md", meta: "opsx-deliberate.json" },
  { name: "opsx-arrange", command: "opsx-arrange.md" },
];

const TOOL_SKILL_DIRS = {
  "amazon-q": ".amazonq",
  claude: ".claude",
  cline: ".cline",
  codex: ".codex",
  cursor: ".cursor",
  gemini: ".gemini",
  github: ".github",
  opencode: ".opencode",
  windsurf: ".windsurf",
};

const OPENSPEC_CORE_SKILLS = [
  "openspec-explore",
  "openspec-new-change",
  "openspec-continue-change",
  "openspec-apply-change",
  "openspec-ff-change",
  "openspec-sync-specs",
  "openspec-archive-change",
  "openspec-verify-change",
  "openspec-onboard",
  "openspec-propose",
];

function detectTargetSkillRoots(targetRepo) {
  const roots = [];
  const uniqueDirs = [...new Set(Object.values(TOOL_SKILL_DIRS))].sort();

  for (const toolDir of uniqueDirs) {
    const skillsRoot = path.join(targetRepo, toolDir, "skills");
    if (!fs.existsSync(skillsRoot)) continue;

    const hasCore = OPENSPEC_CORE_SKILLS.some((name) =>
      fs.existsSync(path.join(skillsRoot, name, "SKILL.md"))
    );
    if (hasCore) {
      roots.push(path.join(toolDir, "skills"));
    }
  }

  return roots;
}

function posixRelative(p) {
  return p.split(path.sep).join("/");
}

function runInstall(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "target-repo": { type: "string" },
      force: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });

  const targetRepo = values["target-repo"]
    ? path.resolve(values["target-repo"])
    : process.cwd();

  if (!fs.existsSync(targetRepo)) {
    throw new Error(`Target directory does not exist: ${targetRepo}`);
  }

  if (!fs.existsSync(path.join(targetRepo, "openspec", "config.yaml"))) {
    throw new Error(
      "OpenSpec not initialized in target repo. Run 'openspec init' first."
    );
  }

  const sourceRoot = path.resolve(__dirname, "..");
  const dryRun = values["dry-run"] ?? false;
  const force = values.force ?? false;

  const actions = [];

  const targetRoots = detectTargetSkillRoots(targetRepo);
  if (targetRoots.length === 0) {
    throw new Error(
      "No OpenSpec-managed skill directories found in target repo. " +
        "Run 'openspec init' first to install core skills."
    );
  }

  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8")
  );

  for (const skill of SKILLS) {
    const skillSrc = path.join(sourceRoot, "skills", skill.name);
    if (!fs.existsSync(skillSrc)) {
      actions.push(`  SKIP (source missing): ${skill.name}`);
      continue;
    }

    for (const skillsRoot of targetRoots) {
      const dest = path.join(targetRepo, skillsRoot, skill.name);
      if (fs.existsSync(dest) && !force) {
        actions.push(`  SKIP (exists, use --force): ${posixRelative(path.join(skillsRoot, skill.name))}`);
        continue;
      }
      if (!dryRun) {
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(skillSrc, dest, { recursive: true });
      }
      actions.push(
        `  ${dryRun ? "WOULD INSTALL" : "INSTALLED"}: ${posixRelative(path.join(skillsRoot, skill.name))}`
      );
    }

    if (skill.command) {
      const commandSrc = path.join(sourceRoot, "commands", skill.command);
      if (!fs.existsSync(commandSrc)) {
        actions.push(`  SKIP (command missing): ${skill.command}`);
        continue;
      }
      const commandContent = fs.readFileSync(commandSrc, "utf8");
      const label = skill.name.replace("opsx-", "");

      const commandTargets = [
        {
          dest: path.join(targetRepo, ".claude", "commands", "opsx", `${label}.md`),
          content:
            "---\n" +
            `name: "OPSX: ${label.charAt(0).toUpperCase() + label.slice(1)}"\n` +
            `description: ${commandContent.split("\n").find((l) => l.startsWith("description:"))?.replace(/^description:\s*/, "") ?? skill.name}\n` +
            "category: Workflow\n" +
            "tags: [workflow, artifacts, experimental]\n" +
            "---\n\n" +
            commandContent.replace(/^---\n[\s\S]*?\n---\n/, ""),
        },
        {
          dest: path.join(targetRepo, ".opencode", "commands", skill.command),
        },
        {
          dest: path.join(
            targetRepo,
            ".github",
            "prompts",
            `${skill.name}.prompt.md`
          ),
        },
      ];

      for (const { dest, content } of commandTargets) {
        const dir = path.dirname(dest);
        if (!fs.existsSync(dir)) {
          actions.push(`  SKIP (no ${posixRelative(path.relative(targetRepo, dir))}): ${posixRelative(path.relative(targetRepo, dest))}`);
          continue;
        }
        if (fs.existsSync(dest) && !force) {
          actions.push(`  SKIP (exists, use --force): ${posixRelative(path.relative(targetRepo, dest))}`);
          continue;
        }
        if (!dryRun) {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(dest, content ?? commandContent);
        }
        actions.push(
          `  ${dryRun ? "WOULD INSTALL" : "INSTALLED"}: ${posixRelative(path.relative(targetRepo, dest))}`
        );
      }
    }

    if (skill.meta) {
      const metaPath = path.join(targetRepo, "openspec", skill.meta);
      const meta = {
        metadata_version: 1,
        package_name: pkgJson.name,
        installed_version: pkgJson.version,
        updated_at: new Date().toISOString(),
      };

      if (!dryRun) {
        fs.mkdirSync(path.dirname(metaPath), { recursive: true });
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
      }
      actions.push(
        `  ${dryRun ? "WOULD WRITE" : "WROTE"}: openspec/${skill.meta}`
      );
    }
  }

  console.log(`\nopsx-multiplex install ${dryRun ? "(dry run)" : "complete"}\n`);
  for (const a of actions) console.log(a);
  console.log();

  return 0;
}

const [command, ...rest] = process.argv.slice(2);

if (command === "install") {
  runInstall(rest);
} else if (command === "help" || command === "--help" || command === "-h") {
  process.stdout.write(
    `opsx-multiplex — Multi-model consensus tools for large projects

Usage:
  opsx-multiplex install --target-repo <path> [options]

Options:
  --target-repo <path>   Target repository path (required)
  --force                Overwrite existing skill files
  --dry-run              Preview without writing files

Prerequisites:
  1. OpenSpec initialized in target repo (openspec/config.yaml exists)
  2. At least one AI tool configured (opencode, claude, cursor, etc.)

Install into a project:
  opsx-multiplex install --target-repo /path/to/my-project

Or run via npx:
  npx opsx-multiplex install --target-repo /path/to/my-project
`
  );
} else {
  process.stderr.write(
    `Unknown command: ${command ?? "(none)"}\nRun 'opsx-multiplex help' for usage.\n`
  );
  process.exitCode = 1;
}
