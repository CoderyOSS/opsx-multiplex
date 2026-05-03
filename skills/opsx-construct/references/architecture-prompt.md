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
