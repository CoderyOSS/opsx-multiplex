# OpsxDeliberate Workflow Design

## Architecture

Sequential multi-agent deliberation. Agents review OpenSpec change proposals in
round-robin fashion. Each agent reviews the previous agent's proposals, agrees or
disagrees, and may add new proposals. The cycle continues until all agents agree
or max cycles are exceeded.

The primary agent acts as orchestrator — it does NOT analyze artifacts itself.
All analysis and review happens in subagent dispatches.

## Pipeline

```
User: /opsx-deliberate <change-name>
  |
  +-- STATE 0: SETUP
  |     detect change -> verify artifacts -> detect opsx-* agents ->
  |     user selects agents -> set max_cycles -> init state file
  |     GATE: artifacts must exist, at least one agent selected
  |
  +-- STATE 1: INITIAL REVIEW
  |     first agent reads all artifacts -> produces proposals ->
  |     write proposals to state file -> dispatch = 1
  |     GATE: state file written with at least one proposal (or confirmed empty)
  |
  +-- STATE 2: CONSENSUS CYCLE (re-entrant)
  |     next agent reads artifacts + current proposals ->
  |     reviews each: agree or disagree ->
  |     may add new proposals ->
  |     dispatch++ -> update state file ->
  |     check consensus:
  |       all agents in last full cycle had zero disagreements AND zero new proposals
  |       -> STATE 3 (consensus reached)
  |       cycle >= max_cycles
  |       -> STATE 3 (forced halt)
  |       else -> handoff to next agent -> STATE 2
  |     GATE: state file updated after each dispatch
  |
  +-- STATE 3: PRESENT TO USER
  |     formatted output of final proposals + consensus status ->
  |     user: accept / modify / reject
  |     GATE: user has responded
  |
  +-- STATE 4: APPLY (if accepted or modified)
  |     apply approved proposals to artifact files -> commit
  |     GATE: changes applied
  |
  +-- STATE 5: SUMMARY
        final report -> done
```

## Consensus Detection

After each agent's dispatch in STATE 2:

1. Collect the agent's results: disagreements count + new proposals count
2. Examine the last N dispatches (N = number of participating agents)
3. If all N dispatches have zero disagreements AND zero new proposals: consensus reached
4. If fewer than N dispatches have occurred: cannot reach consensus yet

This means consensus requires one full cycle where every agent reviewed the current
state and had nothing to add or object to.

## State Persistence

State file: `.openspec/tmp/deliberate-state.json`

Contains:
- Change name, max cycles, current dispatch counter
- Agent list and current agent index for rotation
- Complete history of all rounds
- Current proposal pool with statuses and agreement tracking
- Consensus flag

The state file enables crash recovery — if the session is interrupted, the user
can say "continue deliberating" and the agent reads the file to resume from the
current state.

## Agent Rotation

Agents rotate in order: agents[0], agents[1], ..., agents[N-1], agents[0], ...

```
agent_index = (agent_index + 1) % agents.length
```

The first agent (dispatch 1) does initial review. All subsequent agents do consensus
cycle review. The agent that did the initial review will also participate in the
consensus cycle on its second pass.

## Commit Behavior

Single commit after user accepts. opsx-deliberate commits once because changes
are applied as a batch after user acceptance.

Commit message: `opsx-deliberate: apply N proposals for <change-name>`

## Dispatch Counter

Incremented by 1 after each agent dispatch. The counter tracks total dispatches,
not cycles. With 3 agents and 2 full cycles: dispatch counter = 6 (not cycle counter = 2).

Max cycles default: 3

## Dispute Resolution

When an agent disagrees:
- The original proposal is marked "disputed"
- The counter-proposal is added with status "counter"
- Both remain in the proposal pool
- Subsequent agents review both and can agree with either

When the user is presented with disputed proposals:
- Both the original and counter-proposal are shown
- User picks which one to apply (or neither)

## Cost Profile

- **Minimum** (1 agent, zero issues): 1 dispatch
- **Typical** (3 agents, consensus in 1 cycle): 4 dispatches (1 initial + 3 consensus)
- **Maximum** (3 agents, max cycles 3): 9 dispatches
- Each dispatch is one subagent call via `task` tool
- Dispatches are sequential (not parallel) — wall-clock time is sum of all dispatches
