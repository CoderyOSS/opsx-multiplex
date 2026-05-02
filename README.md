# opsx-multiplex

Multi-model consensus tools for building large projects. Route proposals through multiple AI models in round-robin until they converge on refined output.

## What it does

Multiplex provides two tools that work with [OpenSpec](https://openspec.dev) change proposals:

- **`/opsx-deliberate`** — Send a change proposal through multiple AI models sequentially. Each model reviews, agrees or disagrees, and proposes fixes. The cycle continues until all models reach consensus or max turns expire. You accept, modify, or reject the final result.

- **`/opsx-arrange`** — Reorder implementation tasks by dependency layer (infrastructure first, polish last). Classifies tasks into 8 layers, builds a dependency tree, and rewrites your task list in build order.

## Install

```bash
npx opsx-multiplex install --target-repo /path/to/your-project
```

This copies skills and commands into your project's OpenSpec directory.

### Configure agents

Add models to your project's `opencode.json`:

```json
{
  "agent": {
    "opsx-deepseek": {
      "mode": "subagent",
      "model": "deepseek/deepseek-v4-flash",
      "description": "OpenSpec reviewer — DeepSeek",
      "hidden": true
    },
    "opsx-kimi": {
      "mode": "subagent",
      "model": "kimi-for-coding/k2p6",
      "description": "OpenSpec reviewer — Kimi",
      "hidden": true
    },
    "opsx-glm": {
      "mode": "subagent",
      "model": "zai-coding-plan/glm-5.1",
      "description": "OpenSpec reviewer — GLM",
      "hidden": true
    }
  }
}
```

Any agent with an `opsx-` prefix and `"mode": "subagent"` is auto-detected. Mix and match any models available to your OpenCode instance.

## Usage

### Deliberate

```bash
# From an OpenCode session in a project with OpenSpec changes:
/opsx-deliberate              # auto-detect active change
/opsx-deliberate add-auth     # specify change by name
```

Flow:
1. Select agents from your configured `opsx-*` models
2. First agent reviews all artifacts, produces proposals
3. Each subsequent agent reviews proposals — agrees, disagrees (with counter-proposals), or adds new findings
4. Cycle continues until every agent agrees in a full round, or max turns reached
5. You see agreed and disputed proposals, then accept, modify, or reject

### Arrange

```bash
/opsx-arrange                 # auto-detect active change
/opsx-arrange add-auth        # specify change by name
```

Flow:
1. Reads all tasks, classifies each into a dependency layer (0–7)
2. Builds a dependency tree showing build order
3. You confirm or correct the tree
4. Rewrites `tasks.md` with tasks in build order, renumbered IDs, updated cross-references

**Dependency layers:**

| Layer | Name | What goes here |
|-------|------|----------------|
| 0 | Infrastructure | Database, server, build config, containers |
| 1 | Core Data | Models, schemas, repositories, migrations |
| 2 | Security/Auth | Authentication, authorization, sessions |
| 3 | Core Services | Business logic, internal APIs, middleware |
| 4 | External Integration | Third-party APIs, webhooks |
| 5 | Client Framework | Frontend setup, state management, router |
| 6 | UI Features | Pages, forms, feature components |
| 7 | Polish | Error handling, loading states, tests, docs |

## Prerequisites

- [OpenCode](https://opencode.ai) with subagent support
- [OpenSpec](https://openspec.dev) initialized in your project
- At least one `opsx-*` subagent configured for deliberation

## How deliberation works

```
Agent A reviews artifacts → produces proposals P1, P2, P3
Agent B reviews proposals → agrees P1, disagrees P2 (counter P2a), adds P4
Agent C reviews proposals → agrees P1, agrees P2a, agrees P3, agrees P4
                         → consensus reached (zero disagreements in full cycle)
```

The primary agent orchestrates but never analyzes — all review happens inside model-specific subagents. Agents run sequentially so each sees the previous agent's results.

Consensus = one full cycle where every agent had zero disagreements and zero new proposals. Default max turns: 3 × number of agents.

## License

MIT
