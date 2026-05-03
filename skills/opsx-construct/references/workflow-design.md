# OpsxConstruct Workflow Design

## Architecture

Parallel build + deliberate review protocol for spec-complete projects. The primary
agent acts as orchestrator — it does NOT write code or review code itself. It:

- Manages state file and work queue
- Spawns ensemble teammates for parallel implementation
- Dispatches subagents for architecture deliberation and code review
- Controls phase transitions and human gates
- Handles pause/halt/resume via state file

## Pipeline

```
User: /opsx-construct [--resume] [--max-parallel N] [--layer N] [--pause] [--halt]
  |
  +-- STATE 0: SETUP
  |     load tasks.md -> detect opsx-* agents -> run baseline tests -> init state
  |     GATE: tasks.md exists, at least one reviewer selected, state file written
  |
  +-- STATE 1: ARCHITECTURE DELIBERATION
  |     select next layer -> gather specs+design+code ->
  |     round-robin architecture review (subagent dispatches) ->
  |     consensus on architectural directives ->
  |     HARD GATE: human approves/amends/aborts via question tool
  |     GATE: directives approved and saved
  |
  +-- STATE 2: PARALLEL IMPLEMENTATION
  |     for each task: team_spawn teammate (respect max_parallel) ->
  |     teammates implement in parallel ->
  |     run relevant E2E tests per worktree ->
  |     failures: team_message feedback, teammate reworks ->
  |     GATE: all teammates pass relevant tests
  |
  +-- STATE 3: PER-FEATURE PRE-MERGE REVIEW
  |     for each branch: round-robin subagent review (3-axis prompt) ->
  |     code issues: team_message to idle teammate -> teammate fixes -> re-review ->
  |     test/spec issues: write to human issues queue (NEVER fix) ->
  |     GATE: all branches have reviewer consensus
  |
  +-- STATE 3.5: SHUTDOWN TEAMMATES
  |     team_shutdown all -> branches preserved -> save state
  |     GATE: all teammates shutdown, state updated
  |
  +-- STATE 4: SMART MERGE
  |     create consolidated branch -> classify clean vs conflicting ->
  |     merge clean first -> pairwise resolve conflicts (subagent) ->
  |     merge resolved into consolidated
  |     GATE: all branches merged into consolidated
  |
  +-- STATE 5: POST-MERGE REVIEW
  |     round-robin review of full consolidated diff (cross-feature check) ->
  |     code issues: subagent fix dispatch -> re-review ->
  |     test/spec issues: human issues queue
  |     GATE: all reviewers satisfied with consolidated diff
  |
  +-- STATE 6: REGRESSION PASS
  |     run ALL E2E tests with implementations ->
  |     regressions: fix + mini review -> re-run ->
  |     GATE: clean regression pass
  |
  +-- STATE 7: FINALIZE LAYER
  |     HARD GATE: present summary to human (approve/amend/abort) ->
  |     merge to main -> generate report ->
  |     more layers -> STATE 1 with next layer
  |     no more layers -> DONE
```

## State Persistence

State file: `.openspec/tmp/construct-state.json`

Contains:
- Project name, config (max_parallel, reviewers, max attempts, max rounds)
- Current progress (layer, phase, state)
- Architecture directives per layer (file paths)
- Work queue (per-task tracking with phase, status, attempts, test results, halt_context)
- Completed tasks archive
- Human issues queue (test/spec problems flagged for external resolution)
- Error log
- Regression history

The state file enables:
- Crash recovery: resume from exact state
- Pause: set status="paused", let current jobs finish
- Halt: set status="halted", force-stop with granular per-task state notes
- Resume: re-attach or skip completed steps based on halt_context

## Phase Transitions

Each state writes to the state file BEFORE transitioning. If the session crashes,
the next `/opsx-construct --resume` reads the file and picks up at the current phase.

Phase → state mapping:
- S0.x → SETUP
- S1.x → ARCHITECTURE
- S2.x → IMPLEMENTING
- S3.x → REVIEWING
- S3.5 → SHUTDOWN
- S4.x → MERGING
- S5.x → POST_REVIEW
- S6.x → REGRESSION
- S7.x → FINALIZING

## Consensus Detection (Reviews)

Same pattern as opsx-deliberate:

After each reviewer's turn:
1. Collect disagreements count + new proposals count
2. Examine last N rounds (N = number of reviewers)
3. If all N rounds have zero disagreements AND zero new proposals: consensus
4. Max review rounds (default: 3 * reviewers.length) → forced halt

## Human Gates

Two hard gates that STOP and wait for user via question tool:
1. STATE 1 (S1.5): Architecture directives — approve/amend/abort
2. STATE 7 (S7.1): Layer finalization — approve/amend/abort

Abort at either gate preserves state file for resume.

## Pause Modes

- `--pause`: status="paused", no new spawns, let current finish
- `--halt`: status="halted", team_shutdown --force all, write halt_context per WQ item
- `--resume`: read status, re-attach (paused) or read halt_context (halted)

## Ensemble Integration

- team_spawn: implementation teammates with worktrees
- team_message: send review feedback to idle teammates
- team_shutdown: graceful or forced, branches preserved
- team_merge: squash merge with overlap detection
- team_status: monitor teammate state

Reviewers are NOT ensemble teammates — they are subagent dispatches (like opsx-deliberate).

## Cost Profile (estimates per layer, 3 reviewers)

| Phase | Dispatches |
|-------|-----------|
| Architecture deliberation | 3–9 (typical: 4) |
| Implementation | N teammates (parallel) |
| Per-feature review | 3–9 per task × N tasks |
| Post-merge review | 3–9 |
| Regression fix cycles | 0–6 |
| **Total per layer** | ~12–30 dispatches + N teammate sessions |
