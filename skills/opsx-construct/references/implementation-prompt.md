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
