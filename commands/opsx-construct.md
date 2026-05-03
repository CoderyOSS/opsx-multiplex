---
description: Parallel build + deliberate review — implement features, review, merge, regress per layer
---

Parallel build + deliberate review protocol for spec-complete projects. Implements
features using ensemble teammates in parallel worktrees, reviews via round-robin
subagent dispatches, merges, regression-tests, and repeats per dependency layer.

**Prerequisite**: Project must have OpenSpec change with specs, tasks.md (layer-ordered
via opsx-arrange), and E2E tests.

---

**Usage**:

```
/opsx-construct                          # Fresh start
/opsx-construct --resume                 # Resume from paused/halted/aborted state
/opsx-construct --resume --layer 3       # Resume at specific layer
/opsx-construct --max-parallel 2         # Override max parallel tasks
/opsx-construct --resume --max-parallel 1 # Resume with reduced parallelism
/opsx-construct --pause                  # Soft pause: let current jobs finish, no new spawns
/opsx-construct --halt                   # Hard halt: stop everything, save granular state notes
```

**Steps**

1. **Setup (STATE 0)**

   Verify prerequisites, detect `opsx-*` subagents from `opencode.json`, user selects
   reviewers, configure max_parallel and max attempts, run baseline E2E tests,
   initialize state file.

2. **Follow the opsx-construct skill instructions exactly**

   The skill guides you through a finite state machine (STATE 0 through STATE 7 + DONE):

   - **STATE 0**: Setup — verify project, select reviewers, configure, baseline tests
   - **STATE 1**: Architecture deliberation — round-robin review produces directives,
     **HARD GATE**: human approves/amends/aborts
   - **STATE 2**: Parallel implementation — team_spawn teammates (respect max_parallel),
     each gets spec + arch directives + test paths, monitor + test
   - **STATE 3**: Per-feature review — round-robin subagent review (3 axes:
     best practices, architecture, test correctness), fix via team_message,
     consensus required per branch
   - **STATE 3.5**: Shutdown teammates (branches preserved)
   - **STATE 4**: Smart merge — clean branches first, conflicting pairwise via subagent
   - **STATE 5**: Post-merge review — full consolidated diff, cross-feature check
   - **STATE 6**: Regression — full E2E suite, fix cycles until clean
   - **STATE 7**: Finalize — **HARD GATE**: human approves, merge to main, report
   - **DONE**: Summary, cleanup

   **Multi-agent configuration** — add to your project's `opencode.json`:
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
   Any agent name starting with `opsx-` is auto-detected. Users select which agents
   to use at runtime via checkbox.

   **Critical rules**:
   - The primary agent is an orchestrator — it does NOT write or review code
   - All implementation happens in ensemble teammates with isolated worktrees
   - All review happens in subagent dispatches (sequential, round-robin)
   - Tests are NEVER modified by any agent — flagged issues go to human queue
   - Two HARD GATES: architecture directives (S1.5) and layer finalization (S7.1)
   - **STOP** at each gate and wait for user's approve/amend/abort response
   - State file at `.openspec/tmp/construct-state.json` enables pause/halt/resume

**Pause and Resume**

- `--pause`: Soft pause. Current jobs finish naturally, no new spawns. Resume picks up
  where the queue left off.
- `--halt`: Hard halt. All teammates force-stopped, granular state notes saved per task.
  Resume reads halt_context to skip completed work.
- `--resume`: Loads state file, re-attaches to live teammates (paused) or reads
  halt_context (halted), picks up at exact checkpoint.

**Dependencies**

| Tool | Role |
|------|------|
| opencode-ensemble | Parallel teammates, worktrees, messaging, merge |
| opsx-deliberate pattern | Subagent dispatch FSM, consensus detection |
| @codery/probes | E2E test infrastructure |
| opsx-arrange | Task dependency layer ordering |
