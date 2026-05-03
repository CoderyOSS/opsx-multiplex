# opsx-construct Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the opsx-construct skill and command — a parallel build + deliberate review protocol for spec-complete projects.

**Architecture:** OpenCode skill/command installed via opsx-multiplex. FSM-based orchestrator (like opsx-deliberate) with 9 stages across 8 phases. Uses opencode-ensemble for parallel implementation teammates, subagent dispatches for review cycles, state file for crash recovery and resume. Lead agent orchestrates — never analyzes code itself.

**Tech Stack:** Markdown (SKILL.md, prompts), JSON (state schema), OpenCode plugin conventions (skill + command pattern from opsx-multiplex)

---

## File Structure

All paths relative to `/home/gem/projects/opsx-multiplex/`.

```
commands/
  opsx-construct.md                          # Command entry point (user-facing)
skills/
  opsx-construct/
    SKILL.md                                  # FSM: STATE 0–8, all rules
    references/
      architecture-prompt.md                  # Phase 1: architecture deliberation prompt
      implementation-prompt.md                # Phase 2: teammate prompt template
      review-prompt.md                        # Phase 3+5: 3-axis code review prompt
      fix-prompt.md                           # Fix agent prompt for addressing review feedback
      construct-state-schema.json             # State file JSON schema for validation
      workflow-design.md                      # Architecture doc (copy of design spec)
bin/
  install.js                                  # MODIFY: add opsx-construct to SKILLS array
example.opencode.json                         # (no change needed — same opsx-* agents work)
```

---

### Task 1: Create workflow-design.md reference

**Files:**
- Create: `skills/opsx-construct/references/workflow-design.md`

This is the architecture reference consumed by the skill. Adapted from the design spec at `CoderyProbes/docs/superpowers/specs/2026-05-02-opsx-construct-design.md`.

- [ ] **Step 1: Create workflow-design.md**

```bash
mkdir -p /home/gem/projects/opsx-multiplex/skills/opsx-construct/references
```

Write `skills/opsx-construct/references/workflow-design.md`:

```markdown
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
```

- [ ] **Step 2: Verify file**

Run: `wc -l /home/gem/projects/opsx-multiplex/skills/opsx-construct/references/workflow-design.md`
Expected: ~120 lines

- [ ] **Step 3: Commit**

```bash
cd /home/gem/projects/opsx-multiplex && git add skills/opsx-construct/references/workflow-design.md && git commit -m "feat(opsx-construct): add workflow design reference"
```

---

### Task 2: Create state file JSON schema

**Files:**
- Create: `skills/opsx-construct/references/construct-state-schema.json`

- [ ] **Step 1: Write the schema**

Write `skills/opsx-construct/references/construct-state-schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "OpsxConstructState",
  "description": "State file for opsx-construct parallel build + review protocol",
  "type": "object",
  "required": ["version", "status", "project", "config", "progress", "arch_directives", "work_queue", "completed", "human_issues", "error_log", "regression_history"],
  "properties": {
    "version": {
      "type": "integer",
      "const": 1
    },
    "status": {
      "type": "string",
      "enum": ["running", "paused", "halted", "aborted", "complete"]
    },
    "project": {
      "type": "string",
      "description": "Project name from openspec config"
    },
    "config": {
      "type": "object",
      "required": ["max_parallel", "max_review_rounds", "max_impl_attempts", "reviewers"],
      "properties": {
        "max_parallel": {
          "type": "integer",
          "minimum": 1,
          "default": 3
        },
        "max_review_rounds": {
          "type": "integer",
          "minimum": 1,
          "default": 3
        },
        "max_impl_attempts": {
          "type": "integer",
          "minimum": 1,
          "default": 5
        },
        "reviewers": {
          "type": "array",
          "items": { "type": "string" },
          "minItems": 1
        },
        "ensemble_team": {
          "type": ["string", "null"]
        }
      }
    },
    "progress": {
      "type": "object",
      "required": ["current_layer", "total_layers", "current_phase", "current_state", "last_phase_completed"],
      "properties": {
        "current_layer": { "type": "integer", "minimum": 0 },
        "total_layers": { "type": "integer", "minimum": 1 },
        "current_phase": {
          "type": "string",
          "enum": ["setup", "architecture", "implementing", "reviewing", "shutdown", "merging", "post_review", "regression", "finalizing"]
        },
        "current_state": { "type": "string" },
        "last_phase_completed": { "type": "integer", "minimum": -1 }
      }
    },
    "arch_directives": {
      "type": "object",
      "additionalProperties": { "type": "string" },
      "description": "Layer number → file path of approved directives"
    },
    "work_queue": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "task_id", "spec", "test_files", "phase", "state", "status", "attempts", "review_rounds", "updated_at"],
        "properties": {
          "id": { "type": "string" },
          "task_id": { "type": "string" },
          "spec": { "type": "string" },
          "test_files": {
            "type": "array",
            "items": { "type": "string" }
          },
          "phase": {
            "type": "string",
            "enum": ["implementing", "reviewing", "approved", "merged"]
          },
          "state": { "type": "string" },
          "status": {
            "type": "string",
            "enum": ["pending", "queued", "in_progress", "crashed", "reviewing", "approved", "merged", "halted"]
          },
          "branch": { "type": ["string", "null"] },
          "teammate": { "type": ["string", "null"] },
          "attempts": { "type": "integer", "minimum": 0 },
          "review_rounds": { "type": "integer", "minimum": 0 },
          "test_results": {
            "type": ["object", "null"],
            "properties": {
              "pass": { "type": "integer" },
              "fail": { "type": "integer" }
            }
          },
          "error": { "type": ["string", "null"] },
          "state_note": { "type": ["string", "null"] },
          "halt_context": {
            "type": ["object", "null"],
            "properties": {
              "completed_steps": {
                "type": "array",
                "items": { "type": "string" }
              },
              "next_step": { "type": "string" },
              "branch_state": { "type": "string" },
              "artifacts_preserved": { "type": "boolean" }
            }
          },
          "updated_at": { "type": "string", "format": "date-time" }
        }
      }
    },
    "completed": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "task_id": { "type": "string" },
          "spec": { "type": "string" },
          "test_files": { "type": "array", "items": { "type": "string" } },
          "phase": { "type": "string" },
          "state": { "type": "string" },
          "status": { "type": "string", "enum": ["merged_to_main"] },
          "branch": { "type": ["string", "null"] },
          "attempts": { "type": "integer" },
          "review_rounds": { "type": "integer" },
          "test_results": {
            "type": ["object", "null"],
            "properties": {
              "pass": { "type": "integer" },
              "fail": { "type": "integer" }
            }
          }
        }
      }
    },
    "human_issues": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "source", "feature", "description", "status", "raised_at"],
        "properties": {
          "id": { "type": "string" },
          "source": { "type": "string", "enum": ["review", "regression"] },
          "feature": { "type": "string" },
          "work_queue_id": { "type": ["string", "null"] },
          "description": { "type": "string" },
          "test_file": { "type": ["string", "null"] },
          "status": { "type": "string", "enum": ["open", "resolved", "wontfix"] },
          "raised_at": { "type": "string", "format": "date-time" }
        }
      }
    },
    "error_log": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["timestamp", "phase", "error"],
        "properties": {
          "timestamp": { "type": "string", "format": "date-time" },
          "work_queue_id": { "type": ["string", "null"] },
          "phase": { "type": "string" },
          "error": { "type": "string" },
          "recovery": { "type": "string" }
        }
      }
    },
    "regression_history": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["layer", "run_at", "total_tests", "with_impl", "passed", "failed"],
        "properties": {
          "layer": { "type": "integer" },
          "run_at": { "type": "string", "format": "date-time" },
          "total_tests": { "type": "integer" },
          "with_impl": { "type": "integer" },
          "passed": { "type": "integer" },
          "failed": { "type": "integer" }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('/home/gem/projects/opsx-multiplex/skills/opsx-construct/references/construct-state-schema.json','utf8')); console.log('valid')" `
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
cd /home/gem/projects/opsx-multiplex && git add skills/opsx-construct/references/construct-state-schema.json && git commit -m "feat(opsx-construct): add state file JSON schema"
```

---

### Task 3: Create architecture deliberation prompt

**Files:**
- Create: `skills/opsx-construct/references/architecture-prompt.md`

This is the initial analysis prompt sent to the first reviewer in Phase 1 (architecture deliberation).

- [ ] **Step 1: Write the prompt**

Write `skills/opsx-construct/references/architecture-prompt.md`:

```markdown
# Architecture Deliberation Prompt (Initial Review)

This is the prompt sent to the first agent in the architecture deliberation chain.
The orchestrator reads this file, combines it with specs, design, and existing code,
then sends it as the `prompt` parameter to the `task` tool.

---

## Preamble

You are the first reviewer in a multi-agent architecture deliberation for a software
project layer. Your job is to produce architectural directives that will guide all
implementation agents working on this layer's tasks.

Think deeply about:
- Concurrency patterns (locks, queues, actors, async boundaries)
- Data flow and state management
- Shared interfaces and contracts between features
- Error propagation and recovery strategies
- Performance characteristics under load
- Deployment and operational concerns
- Cross-feature consistency (naming, patterns, error handling)

Other agents will review your proposals after you. Be thorough but precise. Each
directive must be specific enough that an implementor can follow it without ambiguity.

## Your Task

Review ALL materials provided below. Produce a set of architectural directives that
every implementor working on this layer MUST follow. Focus on decisions that affect
multiple features or have system-wide implications.

## Review Criteria

### Cross-Feature Consistency
- Shared data models or types between features
- Consistent API patterns (error responses, pagination, auth)
- Naming conventions (endpoints, variables, database columns)
- Shared utility code or libraries

### Concurrency and State
- How concurrent access to shared resources is handled
- Transaction boundaries and isolation levels
- Background job patterns and queue design
- Cache invalidation strategies
- Race conditions in multi-step operations

### Integration Patterns
- External service communication patterns (retries, timeouts, circuit breakers)
- Event/notification delivery guarantees
- Idempotency requirements
- Rate limiting architecture

### Error Handling
- Error propagation strategy (exceptions, result types, error codes)
- Partial failure recovery
- Graceful degradation patterns
- Logging and observability standards

### Performance
- Database query patterns and indexing strategy
- N+1 query prevention
- Pagination strategy
- Connection pooling and resource management

### Security
- Authentication and authorization patterns
- Input validation strategy
- Secret management approach
- Audit logging requirements

## Classification

Classify each directive into exactly one of:
- **pattern** — a reusable pattern all features must follow
- **constraint** — a hard constraint that limits implementation choices
- **interface** — a shared interface or contract between features
- **convention** — a naming or style convention for consistency
- **infrastructure** — infrastructure or operational requirement

## Output Format

Return ONLY a JSON object. No other text before or after the JSON.

```json
{
  "directives": [
    {
      "id": "D1",
      "title": "short descriptive title",
      "category": "pattern|constraint|interface|convention|infrastructure",
      "scope": "which features this applies to, or 'all'",
      "directive": "the exact rule or pattern that implementors must follow",
      "rationale": "why this directive exists — what goes wrong without it",
      "example": "optional code snippet or pseudocode showing the pattern"
    }
  ]
}
```

Number directives sequentially: D1, D2, D3, ...

Every directive MUST be concrete enough for an implementor to follow without asking
questions. Avoid vague directives like "use good error handling" — instead specify
the exact pattern.

## Project Materials

The specs, design docs, existing code, and prior layer directives follow.
Read everything before producing directives.

---
```

- [ ] **Step 2: Commit**

```bash
cd /home/gem/projects/opsx-multiplex && git add skills/opsx-construct/references/architecture-prompt.md && git commit -m "feat(opsx-construct): add architecture deliberation prompt"
```

---

### Task 4: Create implementation prompt (teammate template)

**Files:**
- Create: `skills/opsx-construct/references/implementation-prompt.md`

This is the prompt template sent to each ensemble teammate in Phase 2.

- [ ] **Step 1: Write the prompt**

Write `skills/opsx-construct/references/implementation-prompt.md`:

```markdown
# Implementation Prompt (Ensemble Teammate)

This is the prompt template sent to each ensemble teammate via team_spawn.
The orchestrator fills in the template variables before spawning.

---

## Template

You are implementing feature **{TASK_ID}**: **{SPEC_NAME}** for a software project.

### Your Instructions

1. Read the spec below carefully — it describes exactly what you must build
2. Read the architecture directives below — you MUST follow these
3. Read the project design doc below — understand the big picture
4. Implement the feature in your worktree
5. When done, report completion via team_message to the lead

### CRITICAL RULES

- **NEVER modify test files.** Tests are correct. If tests seem wrong, note it in
  your completion message but do NOT change any test files. Test fixes happen externally.
- **Follow the architecture directives exactly.** These were deliberated on by multiple
  reviewers and approved by the project owner. Deviations will be caught in review.
- **Only implement what the spec describes.** Do not add extra features, endpoints, or
  behavior not specified.
- **Use the project's existing patterns.** Look at existing code for style, naming,
  error handling patterns. Match them.
- **Commit frequently** with clear messages as you build.

### Test Files Relevant to Your Feature

These test files contain E2E tests for your feature:
{TEST_FILE_LIST}

After implementing, the lead will run these tests against your worktree. Your goal is
to make them pass.

### Architecture Directives (MANDATORY — follow all of these)

{ARCHITECTURE_DIRECTIVES}

### Feature Spec

{SPEC_CONTENT}

### Project Design Document

{DESIGN_DOC_CONTENT}

### Existing Codebase Context

{EXISTING_CODE_SUMMARY}

---
```

- [ ] **Step 2: Commit**

```bash
cd /home/gem/projects/opsx-multiplex && git add skills/opsx-construct/references/implementation-prompt.md && git commit -m "feat(opsx-construct): add implementation prompt template"
```

---

### Task 5: Create 3-axis code review prompt

**Files:**
- Create: `skills/opsx-construct/references/review-prompt.md`

This is the prompt for both per-feature (Phase 3) and post-merge (Phase 5) reviews. Subagents receive this combined with the code diff.

- [ ] **Step 1: Write the prompt**

Write `skills/opsx-construct/references/review-prompt.md`:

```markdown
# Code Review Prompt (3-Axis Review)

This is the prompt sent to each reviewer subagent during code review phases.
Used in both Phase 3 (per-feature pre-merge review) and Phase 5 (post-merge review).

The orchestrator reads this file, combines it with the code diff, architecture
directives, and specs, then sends it as the `prompt` parameter to the `task` tool.

---

## Preamble

You are a code reviewer in a multi-agent review chain. Review the code diff below
across three axes. Be rigorous and specific.

Other reviewers will see your feedback. Be precise enough that another reviewer can
evaluate whether your assessment is correct.

## Three Review Axes

### Axis 1: Coding Best Practices

Evaluate the code for:
- Clean code principles (SRP, DRY, meaningful names)
- Error handling completeness (all failure paths covered, meaningful error messages)
- Input validation (boundary checks, type safety, injection prevention)
- Resource management (connections closed, memory freed, no leaks)
- Code organization (appropriate abstractions, no god functions)
- Testing considerations (is the code testable? are edge cases handleable?)
- Performance (no obvious N+1, unnecessary allocations, blocking in async paths)

### Axis 2: Architecture Compliance

Evaluate whether the implementation:
- Follows the architectural directives provided below
- Is consistent with the project design document
- Uses appropriate abstractions (not over-engineered, not under-engineered)
- Maintains cross-feature compatibility (shared types, consistent patterns)
- Handles integration points correctly (API contracts, data formats, error codes)
- Scales appropriately for the expected load
- Does not introduce architectural drift (deviations that compound over time)

### Axis 3: Test/Spec Correctness

Evaluate whether the E2E tests and specs are possibly wrong:
- Do test expectations contradict the spec?
- Are specs ambiguous in ways that make tests unimplementable?
- Do specs require behavior that is technically infeasible or self-contradictory?
- Are there missing test cases that indicate incomplete specs?
- Do multiple specs contradict each other?

**IMPORTANT**: If you find test/spec issues, flag them as `test_spec_issue`. These
will be reported to the project owner for external resolution. **Never suggest
modifying test files.** Tests are the source of truth in this workflow.

## Classification

Classify each issue into exactly one of:
- **code_quality** — coding best practice violation (Axis 1)
- **architecture** — architecture directive violation or concern (Axis 2)
- **test_spec_issue** — test or spec may be incorrect (Axis 3)

## Output Format

Return ONLY a JSON object. No other text before or after the JSON.

```json
{
  "reviews": [
    {
      "id": "R1",
      "axis": "code_quality|architecture|test_spec_issue",
      "severity": "critical|major|minor|nit",
      "location": "file:line or file:function",
      "issue": "description of the problem",
      "suggestion": "specific fix or improvement",
      "effort": "trivial|small|medium|large"
    }
  ]
}
```

- **critical**: will cause failures or data loss in production
- **major**: incorrect behavior, missing error handling, violates architecture directive
- **minor**: code quality issue, non-ideal pattern, missing edge case
- **nit**: style, naming, formatting

For `test_spec_issue` items, the `location` should reference the test file and the
`suggestion` should describe what the human needs to understand about the problem.

## Consensus Review (for subsequent reviewers)

If this is a consensus round (not the first review), you will also see previous
reviewer feedback below. For each previous review:

- **agree** if the assessment is correct and the suggestion is appropriate
- **disagree** if the assessment is wrong, provide your counter-assessment

```json
{
  "reviews": [... your new reviews ...],
  "consensus": [
    {
      "review_id": "R1",
      "verdict": "agree",
      "note": "optional"
    },
    {
      "review_id": "R2",
      "verdict": "disagree",
      "reason": "why this assessment is wrong",
      "counter": {
        "axis": "...",
        "severity": "...",
        "location": "...",
        "issue": "...",
        "suggestion": "..."
      }
    }
  ]
}
```

## Materials

The code diff, architecture directives, specs, and previous review feedback follow.

---
```

- [ ] **Step 2: Commit**

```bash
cd /home/gem/projects/opsx-multiplex && git add skills/opsx-construct/references/review-prompt.md && git commit -m "feat(opsx-construct): add 3-axis code review prompt"
```

---

### Task 6: Create fix agent prompt

**Files:**
- Create: `skills/opsx-construct/references/fix-prompt.md`

Prompt for subagent dispatches that address review feedback (Phase 3, 5, and 6).

- [ ] **Step 1: Write the prompt**

Write `skills/opsx-construct/references/fix-prompt.md`:

```markdown
# Fix Agent Prompt

This is the prompt sent to subagent dispatches that address code review feedback.
Used in Phase 3 (teammate fixes via team_message), Phase 5 (fix subagent for
consolidated branch), and Phase 6 (regression fixes).

---

## Template

You are a fix agent. Apply the following review feedback to the codebase.

### Instructions

1. Read each review item below
2. Read the relevant source files
3. Apply the suggested fixes precisely
4. Do NOT modify any test files
5. Ensure your changes don't break existing functionality

### CRITICAL RULES

- **NEVER modify test files.** If a review item suggests changing tests, skip it
  and note that it was skipped in your response.
- **Apply fixes precisely.** Don't refactor surrounding code. Don't add improvements
  beyond what was requested.
- **Preserve existing patterns.** Match the coding style, naming, and patterns already
  in the codebase.
- **If a fix seems wrong**, note it in your response but apply it anyway. The reviewer
  will catch it in the next cycle.

### Review Feedback to Apply

{REVIEW_FEEDBACK_JSON}

### Architecture Directives (reference)

{ARCHITECTURE_DIRECTIVES}

### Source Files

{RELEVANT_SOURCE_FILES}

### Output

After applying fixes, report:
1. Which review items you applied (by ID)
2. Which items you skipped (and why)
3. Any concerns about the fixes you applied

---
```

- [ ] **Step 2: Commit**

```bash
cd /home/gem/projects/opsx-multiplex && git add skills/opsx-construct/references/fix-prompt.md && git commit -m "feat(opsx-construct): add fix agent prompt"
```

---

### Task 7: Create SKILL.md — the FSM

**Files:**
- Create: `skills/opsx-construct/SKILL.md`

This is the core — the finite state machine that orchestrates the entire protocol. Modeled on opsx-deliberate's SKILL.md pattern but with 9 states and ensemble integration.

- [ ] **Step 1: Write SKILL.md**

Write `skills/opsx-construct/SKILL.md`:

```markdown
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

If `--resume`: jump to RESUME LOGIC (section below).

If `--pause` or `--halt`: jump to PAUSE/HALT LOGIC (section below).

If neither flag: check if `.openspec/tmp/construct-state.json` already exists.
If it does: tell user "State file exists. Use `--resume` to continue or delete the file to start fresh." STOP.

### 0.2 Verify prerequisites

Check that the project has:
- `openspec/changes/` directory with at least one change
- `tasks.md` with dependency-layered task list
- E2E tests in `test/e2e/` or equivalent
- `opencode.json` with at least one `opsx-*` subagent

If any missing: tell user what's missing. STOP.

### 0.3 Detect subagents

Read the project's `opencode.json`. Find agents with names starting `opsx-` and
`"mode": "subagent"`.

If zero found: tell user "No opsx-* subagents configured." STOP.

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

If found, read `max_parallel`, `max_review_rounds`, `max_impl_attempts` as baseline values.

Priority chain for each setting (highest wins):
1. CLI flag (e.g., `--max-parallel 2`)
2. State file `config.*` (on resume)
3. Project config `.opencode/construct.json`
4. Default (max_parallel=3, max_review_rounds=3, max_impl_attempts=5)

Present resolved configuration via `question` tool:

> "Max parallel tasks: **{N}**. Max review rounds per cycle: **{N}**. Max implementation attempts: **{N}**. Change any value or accept defaults."

STOP and wait for user response. Apply overrides.

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
    "max_review_rounds": <N>,
    "max_impl_attempts": 5,
    "reviewers": [<list of selected agent names>],
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

### 1.3 Dispatch first architecture reviewer

Read `references/architecture-prompt.md`. Append all materials.

Call `task` with:
- `subagent_type`: first reviewer from config
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

For subsequent reviewers, dispatch with:
- Same materials + current directives JSON
- Ask: agree/disagree with each directive, add new directives
- Same consensus detection as opsx-deliberate: last N rounds with zero disagreements
  AND zero new directives = consensus
- Max rounds: `config.max_review_rounds * reviewers.length`

Update state file after each dispatch.

### 1.5 HARD GATE — Present to human

Once consensus reached (or max rounds):

Present directives to user via `question` tool:

> "## Architecture Directives — Layer {N}
>
> {formatted list of directives}
>
> **Approve** to proceed with implementation. **Amend** to modify directives. **Abort** to stop."

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

Find first WQ item with `status = "reviewing"` and `review_rounds < max_review_rounds * reviewers.length`.

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
- Max review rounds reached = forced pass

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

Present via `question` tool:

> "## Layer {N} Summary
>
> **Features**: X built, Y approved
> **Tests**: Z passing
> **Human issues**: W flagged
> **Commits**: C on construct-L{N}
>
> {detailed feature list with test results}
>
> {human issues list}
>
> **Approve** to merge to main. **Amend** to rework. **Abort** to stop."

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
```

- [ ] **Step 2: Verify line count**

Run: `wc -l /home/gem/projects/opsx-multiplex/skills/opsx-construct/SKILL.md`
Expected: ~450 lines

- [ ] **Step 3: Commit**

```bash
cd /home/gem/projects/opsx-multiplex && git add skills/opsx-construct/SKILL.md && git commit -m "feat(opsx-construct): add SKILL.md — FSM with 9 states"
```

---

### Task 8: Create command entry point

**Files:**
- Create: `commands/opsx-construct.md`

- [ ] **Step 1: Write the command**

Write `commands/opsx-construct.md`:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
cd /home/gem/projects/opsx-multiplex && git add commands/opsx-construct.md && git commit -m "feat(opsx-construct): add command entry point"
```

---

### Task 9: Update installer and package

**Files:**
- Modify: `bin/install.js` (add opsx-construct to SKILLS array)
- Modify: `example.opencode.json` (no change needed — same agents work)

- [ ] **Step 1: Update SKILLS array in install.js**

In `/home/gem/projects/opsx-multiplex/bin/install.js`, change line 7-10 from:

```javascript
const SKILLS = [
  { name: "opsx-deliberate", command: "opsx-deliberate.md", meta: "opsx-deliberate.json" },
  { name: "opsx-arrange", command: "opsx-arrange.md" },
];
```

to:

```javascript
const SKILLS = [
  { name: "opsx-deliberate", command: "opsx-deliberate.md", meta: "opsx-deliberate.json" },
  { name: "opsx-arrange", command: "opsx-arrange.md" },
  { name: "opsx-construct", command: "opsx-construct.md" },
];
```

- [ ] **Step 2: Update package description**

In `/home/gem/projects/opsx-multiplex/package.json`, change `description` from:

```json
"description": "Multi-model consensus tools — deliberation and task arrangement for large projects",
```

to:

```json
"description": "Multi-model consensus tools — deliberation, task arrangement, and parallel build for large projects",
```

Add keyword `"construct"` to the `keywords` array.

- [ ] **Step 3: Verify install works (dry run)**

```bash
cd /home/gem/projects/opsx-multiplex && node bin/install.js install --target-repo /home/gem/projects/Unbought --dry-run
```

Expected: output showing `opsx-construct` in the install list.

- [ ] **Step 4: Commit**

```bash
cd /home/gem/projects/opsx-multiplex && git add bin/install.js package.json && git commit -m "feat(opsx-construct): register in installer and update package metadata"
```

---

### Task 10: Verify complete file structure

- [ ] **Step 1: Verify all files exist**

```bash
cd /home/gem/projects/opsx-multiplex && find skills/opsx-construct commands/opsx-construct.md -type f | sort
```

Expected:
```
commands/opsx-construct.md
skills/opsx-construct/SKILL.md
skills/opsx-construct/references/architecture-prompt.md
skills/opsx-construct/references/construct-state-schema.json
skills/opsx-construct/references/fix-prompt.md
skills/opsx-construct/references/implementation-prompt.md
skills/opsx-construct/references/review-prompt.md
skills/opsx-construct/references/workflow-design.md
```

- [ ] **Step 2: Verify install.js has all three skills**

```bash
cd /home/gem/projects/opsx-multiplex && grep -c "opsx-" bin/install.js
```

Expected: at least 3 matches in SKILLS array

- [ ] **Step 3: Final commit (if any stray files)**

```bash
cd /home/gem/projects/opsx-multiplex && git status
```

Ensure clean working tree.
