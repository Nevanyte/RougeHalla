# <ID>: <short outcome>

<!-- Copy to docs/backlog/packets/<ID>.md. Sections 1–11 are the backlog README's required list ("Adding a packet");
     the routing block and "Oracle files" are what the agent pipeline needs. Cite real files; invent no numbers. -->

- **Serves:** ORDER_OF_OPERATIONS phase <n>, item <n> (or "not in the plan: owner approval <date>")
- **Implementer tier:** implementer | implementer-sonnet | implementer-opus
- **Reviewer:** reviewer | reviewer-opus
- **Integration base:** <branch from docs/agent/INTEGRATION_BRANCH at the time of writing>
- **D-rules touched:** D1 <parity standard> · D2 <harness or n/a> · D5/D6/D9 <none or note>

## 1. ID and outcome
<One paragraph: the behaviour in game terms, and what is true when this packet lands.>

## 2. Dependencies
<Packets or merges that must be in the base first, or "none".>

## 3. Relevant legacy paths
- `packages/<path>:<lines>`: <what it does> (verified with `rg`)

## 4. New paths
- <files this packet creates>

## 5. Exclusive write scope
- <every existing file the implementer may change; nothing else>

## 6. Contracts and references
- <C-* contracts, ADRs, requirements this must keep>

## 7. Behaviour to preserve
- <what must not change: RNG draw order, tick order, wire bytes, state hash of fixture X, ...>

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/<ID>` passes (full).
- <extra, machine-checkable: "parity-report: scenario X MATCH", "state hash of seed1 unchanged", ...>

## Oracle files (read-only for implementers)
- `<path to each failing test / capture / vector committed on packet/<ID>>`

## 9. Validation commands
- <only commands that exist, or "to be created by this packet">

## 10. Risk and suggested model tier
<Why this tier; what makes it hard.>

## 11. Known traps
- <same-tick competitions, off-by-one-tick cooldowns, float order, removal during iteration, ...>

## Notes from previous attempts
<!-- Coordinator appends on escalation: tier, branch, the gate's failure block. Nothing else. -->
