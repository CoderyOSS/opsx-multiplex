---
name: opsx-construct
description: >
  Parallel build + deliberate review protocol for spec-complete projects.
  Implements features using ensemble teammates, reviews via round-robin subagent
  dispatches, merges, regression-tests, and repeats per dependency layer.
---

# OpsxConstruct — Parallel Build + Deliberate Review

## Overview

This skill guides the agent through a structured build pipeline. The primary agent
acts as orchestrator — it does NOT write code or review code itself. It manages state,
spawns ensemble teammates, dispatches subagents for review, and controls phase
transitions.

**Input**: Optionally specify flags. Supports `--resume`, `--layer N`, `--max-parallel N`,
`--pause`, `--halt`.

---

## Execution Rules (MANDATORY — read before proceeding)

You are executing a finite state machine. These rules override all defaults.

### Step Locking

- You MUST complete EXACTLY ONE state per agent response.
- Do NOT combine states. Do NOT skip states. Do NOT infer future states.
- Each state defines a required STOP point — you MUST wait for user input at those points.

### Gating Rules

You are NOT allowed to proceed to the next state unless:
- The current state's required output is produced
- All required fields in the output are populated
- No assumptions are left unstated

### Self-Check (before every state transition)

Before moving to the next state, validate:
- Did I complete all required actions for this state?
- Did I produce the required output?
- Did I write to the state file?
- Did I follow the exact format specified?

If not, fix before continuing. If yes, proceed to next state.

### Deviation Penalty

If you skip a state, combine states, or violate the output format:
- The output is considered invalid
- You must re-execute the current state correctly

### Orchestrator Role

The primary agent is the orchestrator. It does NOT write code or review code. It:
- Reads artifacts and constructs prompts
- Dispatches subagents via `task` tool
- Manages ensemble teammates via team tools
- Updates state file after every action
- Checks consensus logic
- Controls phase transitions
- Presents results to user at human gates

All implementation and review happens inside subagents/teammates.

---

## STATE 0: SETUP

### 0.1 Check flags

Parse input flags:
- `--resume`: Load state file, skip to resume logic
- `--pause`: Set status to "paused" in state file, stop
- `--halt`: Set status to "halted", shutdown all teammates, write halt_context, stop
- `--layer N`: Resume at specific layer
- `--max-parallel N`: Override max_parallel
- `help` / `-h` / `--help`: Print help and STOP
- `reset`: Delete state file (with confirmation) and STOP

**Help**: If `help`, `-h`, or `--help`:

Print the following and STOP:

```
opsx-construct — Parallel build + deliberate review protocol

Usage:
  /opsx-construct                          Fresh start
  /opsx-construct --resume                 Resume from paused/halted/aborted
  /opsx-construct --resume --layer N       Resume at specific layer
  /opsx-construct --max-parallel N         Override max parallel tasks
  /opsx-construct --pause                  Soft pause: current jobs finish, no new spawns
  /opsx-construct --halt                   Hard halt: stop all, save granular state
  /opsx-construct reset                    Remove state file (destructive, confirms first)
  /opsx-construct help | -h | --help       Show this help

Workflow:
  Phase 0: Setup — configure, baseline tests
  Phase 1: Architecture deliberation → human gate
  Phase 2: Parallel implementation (ensemble teammates)
  Phase 3: Per-feature code review → fix cycles
  Phase 3.5: Shutdown teammates
  Phase 4: Smart merge (clean first, conflicting pairwise)
  Phase 5: Post-merge cross-feature review
  Phase 6: Full regression pass
  Phase 7: Finalize → human gate → merge to main

Requirements:
  - OpenSpec project with specs, tasks.md, E2E tests
  - opencode-ensemble plugin installed
  - opsx-* subagents configured in opencode.json
```

**Reset**: If `reset`:

1. Check if `.openspec/tmp/construct-state.json` exists.
2. If not: "No state file found. Nothing to reset." STOP.
3. If yes: present confirmation via `question` tool:

> "This will permanently delete `.openspec/tmp/construct-state.json` and all associated
> architecture directive files in `.openspec/tmp/`. This is **destructive** — you will
> lose all progress tracking for the current build. Any running ensemble teammates will
> NOT be stopped (use `--halt` first if needed). Proceed?"

- User confirms: `rm -f .openspec/tmp/construct-state.json .openspec/tmp/arch-guidance-L*.md .openspec/tmp/construct-report-L*.md`. "State reset. Ready for fresh start."
- User cancels: "Reset cancelled." STOP.

If `--resume`: jump to RESUME LOGIC (section below).

If `--pause` or `--halt`: jump to PAUSE/HALT LOGIC (section below).

If neither flag: check if `.openspec/tmp/construct-state.json` already exists.
If it does: tell user "State file exists. Use `--resume` to continue or `reset` to delete it." STOP.

### 0.2 Verify prerequisites

Check that the project has:
- `openspec/changes/` directory with at least one change
- `tasks.md` with dependency-layered task list
- E2E tests in `test/e2e/` or equivalent
- `opencode.json` (project or global `~/.config/opencode/config.json`) with at least one `opsx-*` subagent

If any missing: tell user what's missing. STOP.

### 0.2a Verify dependencies

Check that opencode-ensemble is available by attempting a dry-call:

```bash
# The team tools are ensemble plugin tools. If opencode recognizes them, ensemble is loaded.
# We verify by checking if the team_create tool exists in the current session's tool list.
```

In practice: attempt `team_status` or check if the `opencode-ensemble` plugin is listed
in the project's `opencode.json`, `.opencode/config.json`, or global
`~/.config/opencode/config.json`. Check all three, merging agents from each source —
project-level takes precedence on name conflicts.

If opencode-ensemble is not available: tell user "opencode-ensemble plugin required for
parallel implementation. Install @hueyexe/opencode-ensemble before running opsx-construct."
STOP.

### 0.3 Detect subagents

Read the project's `opencode.json` (or `.opencode/config.json`), then fall back to
`~/.config/opencode/config.json` (global config). Merge agents from both sources —
project-level takes precedence on name conflicts. Find agents with names starting `opsx-`
and `"mode": "subagent"`.

If zero found: tell user "No opsx-* subagents found in project or global config. Add agents with the opsx- prefix to `opencode.json` or `~/.config/opencode/config.json`." STOP.

### 0.4 Select reviewers

Present available agents via `question` tool:

> "Which agents should participate as reviewers?"

Show all `opsx-*` agents as checkboxes. Default: all selected.
STOP and wait for user response.

### 0.5 Configure

Load project config if it exists:

```bash
cat .opencode/construct.json 2>/dev/null
```

If found, read any overrides as baseline values.

Priority chain for each setting (highest wins):
1. CLI flag (e.g., `--max-parallel 2`)
2. State file `config.*` (on resume)
3. Project config `.opencode/construct.json`
4. Default

Ask each configuration question separately via `question` tool:

**Question 1 — Max architecture deliberation cycles:**

> "Max architecture deliberation cycles: **6** (default).
> Each cycle = all architecture reviewers review once. Cycles repeat until every
> reviewer agrees on all feedback with no new feedback added (consensus). If max
> reached without consensus, directives proceed without it — human gate follows.
> Higher values allow more opportunity for consensus but cost more tokens. Change or accept."

**Question 2 — Max implementation attempts:**

> "Max implementation attempts per task: **10** (default).
> How many times a teammate may retry passing its relevant E2E tests. Complex features
> or unfamiliar codebases may need many attempts. Change or accept."

**Question 3 — Max code review cycles:**

> "Max code review cycles per feature: **6** (default).
> Each cycle = all reviewers review once. Covers Phase 3 (per-feature) and Phase 5
> (post-merge) review rounds. Change or accept."

STOP and wait for user response after each question. Apply overrides.

### 0.6 Run baseline tests

Run the project's existing E2E test suite:

```bash
# Adapt to project's test runner
bun test test/e2e/ 2>&1 | tail -5
```

Record baseline pass rate. This establishes what's already working.

### 0.7 Initialize state file

```bash
mkdir -p .openspec/tmp
```

Write `.openspec/tmp/construct-state.json`:

```json
{
  "version": 1,
  "status": "running",
  "project": "<from openspec config>",
  "config": {
    "max_parallel": <N>,
    "max_arch_cycles": <N>,
    "max_impl_attempts": <N>,
    "max_review_cycles": <N>,
    "reviewers": [<list of selected agent names>],
    "arch_reviewers": null,
    "ensemble_team": null
  },
  "progress": {
    "current_layer": 0,
    "total_layers": <count from tasks.md>,
    "current_phase": "setup",
    "current_state": "S0.7",
    "last_phase_completed": -1
  },
  "arch_directives": {},
  "work_queue": [],
  "completed": [],
  "human_issues": [],
  "error_log": [],
  "regression_history": []
}
```

### STATE 0 OUTPUT

- Prerequisites verified
- Reviewers selected
- Configuration set
- Baseline tests run
- State file initialized

**GATE**: State file written. At least one reviewer. tasks.md exists.

---

## STATE 1: ARCHITECTURE DELIBERATION

### 1.1 Select next layer

Read state file `progress.current_layer`. If 0, start at layer 1.
Find all tasks in `tasks.md` for this layer that are not yet in `completed`.

If no pending tasks in this layer: increment layer, repeat.
If no more layers: go to DONE.

### 1.2 Gather materials

Read:
- All spec files in `openspec/changes/*/specs/` relevant to this layer's tasks
- `design.md` from the change directory
- All existing source code (summary scan)
- Prior layers' architecture directives (from `arch_directives` in state)
- `tasks.md` for this layer

### 1.2a Select architecture reviewers

Present the reviewers chosen in S0.4 to the human via `question` tool:

> "Which reviewers should participate in architecture deliberation for this layer?"

Show all `config.reviewers` as checkboxes. Default: all selected.
STOP and wait for user response.

Save selected architecture reviewers to state file as `config.arch_reviewers`.

### 1.3 Dispatch first architecture reviewer

Read `references/architecture-prompt.md`. Append all materials.

Call `task` with:
- `subagent_type`: first agent from `config.arch_reviewers`
- `prompt`: architecture prompt + materials
- `description`: `"opsx-construct arch L{N}: {agent-name}"`

The subagent returns JSON:
```json
{
  "directives": [
    {
      "id": "D1",
      "title": "...",
      "category": "pattern|constraint|interface|convention|infrastructure",
      "scope": "...",
      "directive": "...",
      "rationale": "...",
      "example": "..."
    }
  ]
}
```

### 1.4 Consensus cycle (re-entrant)

**If `config.arch_reviewers.length === 1`**: skip this step. No consensus needed with
a single reviewer. Go directly to S1.5.

For 2+ reviewers, dispatch subsequent reviewers with:
- Same materials + current directives JSON
- Ask: agree/disagree with each directive, add new directives
- Same consensus detection as opsx-deliberate: last N rounds with zero disagreements
  AND zero new directives = consensus
- Max cycles: `config.max_arch_cycles` (each cycle = all arch reviewers review once)
- Track cycles, not individual dispatches (1 cycle = 1 complete pass of all arch reviewers)

Update state file after each dispatch.

### 1.5 HARD GATE — Present to human

Once consensus reached (or max cycles, or single reviewer done):

Output directives directly to the user as formatted text (NOT via question tool —
question renders plaintext, not markdown):

```
## Architecture Directives — Layer {N}

**D1: {title}**
{directive} — {rationale}

**D2: {title}**
{directive} — {rationale}

(... repeat for each directive)
```

Each directive MUST include the `directive` and `rationale` fields from the JSON output.
Do NOT summarize into a single sentence. Do NOT omit rationale.

Then present the approval gate via `question` tool:
- question: "Approve, amend, or abort these Layer {N} directives?"
- options: [{"label": "Approve", "description": "Proceed with parallel implementation"}, {"label": "Amend", "description": "Modify directives before proceeding"}, {"label": "Abort", "description": "Stop the workflow"}]

STOP and wait for user response.

- **Approve**: Save directives to `.openspec/tmp/arch-guidance-L{N}.md`. Update state
  `arch_directives["{N}"]`. Go to STATE 2.
- **Amend**: Apply user's changes to directives. Re-present. Loop until approved.
- **Abort**: Set status to "aborted". Save state. STOP.

### STATE 1 OUTPUT

- Layer selected
- Materials gathered
- Architecture directives deliberated (consensus or max rounds)
- Human approved directives saved
- State file updated

**GATE**: Directives approved. State file updated with arch_directives path.

---

## STATE 2: PARALLEL IMPLEMENTATION

### 2.1 Build work queue

For each task in current layer:
- Create WQ entry with task_id, spec name, test file paths, status "pending"
- Map task to its spec and test files

Write WQ entries to state file.

### 2.2 Create ensemble team

```bash
team_create name="construct-{project}-L{N}"
```

Save team name to `config.ensemble_team`.

### 2.3 Spawn teammates (respecting max_parallel)

Count WQ items with `status = "in_progress"`.
While count < max_parallel and pending items exist:

For next pending WQ item:
1. Read `references/implementation-prompt.md`
2. Fill template: task_id, spec content, architecture directives, test file paths,
   design doc, existing code summary
3. `team_spawn` with:
   - `name`: descriptive name (e.g., "impl-auth")
   - `prompt`: filled template
   - `worktree: true`
4. Update WQ item: status="in_progress", branch=<worktree branch>, teammate=<name>

### 2.4 Monitor teammates

Poll `team_status` periodically. For each teammate:
- **completed**: Run relevant E2E tests against its worktree
  - Pass → status="reviewing"
  - Fail → `team_message` with failure details, teammate reworks
- **error**: Log error. If attempts < max: reset to pending for retry. Else: flag for human.
- **busy**: Continue monitoring

### 2.5 Completion check

When all WQ items have status "reviewing" (or max attempts reached):
Update state:
```json
{
  "progress": { "current_phase": "reviewing", "current_state": "S3.1" }
}
```

Go to STATE 3.

### STATE 2 OUTPUT

- Work queue built
- Ensemble team created
- Teammates spawned and monitored
- Relevant tests run per worktree
- All features passing or max-attempted

**GATE**: All WQ items in "reviewing" status. State updated.

---

## STATE 3: PER-FEATURE PRE-MERGE REVIEW

### 3.1 Select next branch

Find first WQ item with `status = "reviewing"` that has not reached `max_review_cycles` complete review cycles.

If none: go to STATE 3.5 (shutdown).

### 3.2 Dispatch review

Get the branch diff:
```bash
git diff main...<branch> -- <relevant paths>
```

Read `references/review-prompt.md`. Construct prompt with:
- Code diff
- Architecture directives
- Spec for this feature
- Previous review feedback (if any, from consensus rounds)

Call `task` with:
- `subagent_type`: round-robin reviewer
- `prompt`: review prompt + diff + materials
- `description`: `"opsx-construct review {task_id}: {agent-name}"`

### 3.3 Process review results

Collect JSON from subagent. For each review item:

**test_spec_issue items:**
- Add to `human_issues` in state file
- Do NOT attempt to fix
- Include in completion message to user

**code_quality / architecture items:**
- Compile feedback
- Send to teammate via `team_message` (teammate is alive, idle, waiting)

### 3.4 Teammate fixes

After sending feedback via team_message:
- Wait for teammate to complete fixes
- Re-run relevant E2E tests
- If pass: increment review_rounds, re-dispatch next reviewer (consensus cycle)
- If fail: send failure details, teammate re-fixes

### 3.5 Consensus check

Same pattern as opsx-deliberate:
- Last N rounds (N = reviewers.length) with zero disagreements = consensus
- Max review cycles (`config.max_review_cycles`) reached = forced pass
- Track cycles, not individual dispatches (1 cycle = 1 complete pass of all reviewers)

When consensus: set WQ item `status = "approved"`.

### 3.6 Loop

Return to S3.1 for next branch.

### STATE 3 OUTPUT

- Each branch reviewed by all reviewers
- Code issues addressed by teammates
- Test/spec issues flagged for human
- All branches have consensus

**GATE**: All WQ items "approved". State updated.

---

## STATE 3.5: SHUTDOWN TEAMMATES

### 3.5.1 Shutdown all

For each WQ item with a teammate:
```bash
team_shutdown <teammate_name>
```

Record branch info, commit count, dirty state.

### 3.5.2 Update state

```json
{
  "progress": { "current_phase": "merging", "current_state": "S4.1" },
  "config": { "ensemble_team": null }
}
```

### STATE 3.5 OUTPUT

- All teammates shutdown
- Branches preserved
- State updated

**GATE**: All teammates shutdown. Branches exist. State updated.

---

## STATE 4: SMART MERGE

### 4.1 Create consolidated branch

```bash
git checkout -b construct-L{N} main
```

### 4.2 Classify branches

For each WQ item with a branch:
```bash
git merge --no-commit --no-ff <branch>
```

If clean: record as "clean". `git merge --abort`.
If conflicts: record as "conflicting". `git merge --abort`.

### 4.3 Merge clean branches

For each clean branch (in dependency order):
```bash
git merge --squash <branch>
git commit -m "feat(L{N}): {task_id} — {spec_name}"
```

### 4.4 Resolve conflicting branches

For conflicting branches, process pairwise:
1. Merge first conflicting branch into consolidated (let conflicts appear)
2. Dispatch subagent to resolve conflicts (prompt with conflict markers + context)
3. Commit resolution
4. Merge next conflicting branch on top
5. Repeat until all merged

### 4.5 Verify

```bash
git log --oneline main..construct-L{N}
```

Verify all WQ items accounted for in commit history.

### STATE 4 OUTPUT

- Consolidated branch created
- All feature branches merged (clean or resolved)
- Single commit history on consolidated branch

**GATE**: All branches merged. No outstanding conflicts. State updated.

---

## STATE 5: POST-MERGE REVIEW

### 5.1 Get full diff

```bash
git diff main...construct-L{N}
```

### 5.2 Dispatch review

Same as STATE 3 but reviewing the full consolidated diff.
Read `references/review-prompt.md`. Include all specs for the layer.

Round-robin dispatch with consensus detection.

### 5.3 Process results

- code_quality / architecture items: dispatch fix subagent
  - Read `references/fix-prompt.md`, fill with review feedback + relevant source files
  - Subagent applies fixes directly to consolidated branch
  - Commit fix
  - Re-dispatch reviewer
- test_spec_issue items: add to human_issues queue

### 5.4 Consensus loop

Same pattern. When all reviewers satisfied: go to STATE 6.

### STATE 5 OUTPUT

- Full consolidated diff reviewed
- Code issues fixed
- Test/spec issues flagged
- Consensus reached

**GATE**: All reviewers satisfied. State updated.

---

## STATE 6: REGRESSION PASS

### 6.1 Run full regression

```bash
# Adapt to project's test runner
bun test test/e2e/ 2>&1 | tail -20
```

Record results in `regression_history`.

### 6.2 Check results

If all tests pass: go to STATE 7.

If regressions found:
1. Identify which tests regressed
2. Dispatch fix subagent with regression details
3. Fix subagent addresses regressions on consolidated branch
4. Mini review cycle (one reviewer pass)
5. Re-run full regression (loop to S6.1)

### STATE 6 OUTPUT

- Full regression suite passed
- Any regressions fixed and verified
- Regression history updated

**GATE**: Clean regression pass. State updated.

---

## STATE 7: FINALIZE LAYER

### 7.1 HARD GATE — Present to human

Compile layer summary:
- Features built (count, list)
- Test results (per-feature + regression)
- Reviewer notes summary
- Human issues flagged
- Commits on consolidated branch

Output the layer summary directly to the user as formatted text (NOT via question tool):

```
## Layer {N} Summary

**Features**: X built, Y approved
**Tests**: Z passing
**Human issues**: W flagged
**Commits**: C on construct-L{N}

{detailed feature list with test results}

{human issues list}
```

Then present the approval gate via `question` tool:
- question: "Approve, amend, or abort Layer {N}?"
- options: [{"label": "Approve", "description": "Merge to main and proceed"}, {"label": "Amend", "description": "Rework before merging"}, {"label": "Abort", "description": "Stop the workflow"}]

STOP and wait for user response.

- **Approve**: go to S7.2
- **Amend**: return to appropriate state for rework
- **Abort**: set status="aborted", save state, STOP

### 7.2 Merge to main

```bash
git checkout main
git merge construct-L{N}
```

### 7.3 Generate report

Write `.openspec/tmp/construct-report-L{N}.md`:
- Layer number and task list
- Features implemented with test results
- Review rounds per feature
- Human issues (still open)
- Regression history
- Commits

### 7.4 Update state

Move WQ items to `completed`. Increment layer. Update progress.

### 7.5 Next layer or done

If more layers: set `progress.current_layer` to next, go to STATE 1.
If no more layers: go to DONE.

### STATE 7 OUTPUT

- Layer merged to main
- Report generated
- State updated
- Next layer started or workflow complete

**GATE**: Merged to main. Committed. State updated.

---

## DONE

Output final summary:

```
## Construct Complete — {project}

| Metric | Value |
|--------|-------|
| Layers completed | N |
| Features built | X |
| Tests passing | Y / Z |
| Human issues (open) | W |
| Total review rounds | R |
```

Clean up: remove state file only if user confirms.

---

## PAUSE/HALT LOGIC

### --pause

1. Read state file
2. Set `status: "paused"`
3. Write state file
4. Do NOT spawn any new teammates
5. Let current teammates finish (they continue to completion)
6. Report: "Paused. Current jobs will finish. No new jobs will start."

### --halt

1. Read state file
2. For each WQ item with `status = "in_progress"`:
   - `team_shutdown --force <teammate>` (branch preserved by ensemble)
   - Write `halt_context`:
     ```json
     {
       "completed_steps": [list of completed state steps],
       "next_step": "S{N}.{M} — description",
       "branch_state": "clean/dirty, N commits, test results",
       "artifacts_preserved": true
     }
     ```
   - Set `status: "halted"`
3. Set `status: "halted"` on state file
4. Write state file
5. Report: "Halted. All work stopped. State saved for resume."

---

## RESUME LOGIC

### From paused

1. Read state file, verify `status = "paused"`
2. Set `status: "running"`
3. Check ensemble team — re-attach to live teammates via `team_status`
4. Resume at `progress.current_phase` + `progress.current_state`
5. Resume dispatching new teammates for pending WQ items

### From halted

1. Read state file, verify `status = "halted"`
2. Set `status: "running"`
3. No live teammates — spawn new ones as needed
4. Resume at `progress.current_phase` + `progress.current_state`

### From aborted

Same as halted but inform user this was previously aborted.

### Per-WQ-item resume handling

After restoring workflow status, scan each WQ item:

| WQ status | Resume action |
|-----------|---------------|
| `in_progress` + paused | Check if teammate alive via `team_status`. Alive → re-attach. Dead → mark crashed. |
| `in_progress` + halted | Read `halt_context`. Skip completed steps. Resume at `next_step`. |
| `crashed` | Reset to `pending`. Increment `attempts`. If `attempts > max_impl_attempts` → flag for human. |
| `pending` / `queued` | Queue for next available slot (respect `max_parallel`). |
| `reviewing` | Resume review cycle at `review_rounds` count. Re-dispatch next reviewer. |
| `approved` | Proceed directly to merge phase (STATE 4). |
| `halted` | Read `halt_context.next_step`. Resume from there. Skip completed steps. |
| `merged` | Already complete. Skip. |

---

## Guardrails

- Tests are NEVER modified by any agent — code, review, or fix
- Test/spec issues are flagged to human_issues — never auto-fixed
- The orchestrator does NOT analyze code — all review via subagents
- State file at `.openspec/tmp/construct-state.json` — update after every action
- Ensemble teammates run in parallel with isolated worktrees
- Review subagents run sequentially — each sees previous results
- Human gates at S1.5 and S7.1 are mandatory stops
- Abort at any gate preserves state for resume
- Pause lets current work finish, halt stops everything with granular state
- Single commit per feature on merge, single merge per layer to main
