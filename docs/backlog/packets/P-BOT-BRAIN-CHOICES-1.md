# P-BOT-BRAIN-CHOICES-1: a Brain seat records the choices it makes, so the learner has something to learn from

- **Serves:** owner decision 8 (MIGRATION, 2026-11-10: the legacy learner on); finding of reviewer-opus on
  P-BOT-LEARN-ON-1 (2026-11-13): with P-BOT-BRAIN-CONTINUITY-1 merged in a scratch tree, Brain seats report no
  choices of their own; the learner's store holds only `faction|…` keys
- **Implementer tier:** implementer-opus (rh-policy Brain: bot priority and learning facts)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework, after P-BOT-BRAIN-CONTINUITY-1
- **D-rules touched:** D1 loose proof against the legacy Brain (`packages/server/src/bots/brain.ts`) · R-ML: the
  ported learner only · no wire, sim or live-default change (`--bot-brain` stays off)

## 1. ID and outcome
The legacy Brain records a learning choice when a goal decision carries one (`brain.ts:246`; the port:
`crates/rh-policy/src/bots/temporal_percept/brain.rs:1186`), in the learner's eight domains (opener, boon, skill,
camp, …). In the port's tournaments none is ever recorded: probed with the brief's fast settings and with a 15 s
planning phase added, the store's keys are all `faction|…`, and in a tournament the lineup fixes each seat's faction,
so nothing learned steers anything. First establish WHY: which legacy decisions carry a choice key, whether the
port's strategy modules produce those decisions at all on the fair degraded profile (DEV-026) or produce them without
the key, and whether the facts they need are missing from the fair percept. When this lands a Brain seat in a
headless match records the same kinds of choices legacy's does (the eight domains that the fair profile can decide),
each exactly once per decision as legacy does, and a learning tournament's store holds non-faction keys.

## 2. Dependencies
- P-BOT-BRAIN-CONTINUITY-1 merged (seats that act). P-BOT-LEARN-ON-1 merged (the tournament's store).

## 5. Exclusive write scope
- `crates/rh-policy/src/bots/**` where the choice is produced and recorded (the oracle author names the files); not
  `rh-sim`, not `rh-server`, not the tournament runner unless the oracle author shows the fault is there

## 6. Contracts
- C-OBS, C-INPUT: a choice is made from the seat's own fair observation and recorded by the seat; nothing from the
  sim. C-RNG: any draw (the learner's exploration, softmax sampling) comes from the seat's own seeded stream, in
  legacy's order. A domain legacy decides from a fact the fair profile does not deliver stays undecided and is named
  in DEV-026's list: no new fact is added to the percept here (that is a wire or observation packet).

## 8. Acceptance checks
- A headless Brain match of a stated length, seeded: each seat's recorded choices include at least the domains the
  oracle author lists, with legacy's key shapes (`domain|persona|choice` or whatever legacy uses: cite it); red today
  (no choices).
- A learning tournament of a few games: the store holds non-faction keys; two seeded runs are byte-identical; with
  learning off the tournament's golden is unchanged.
- One loose-proof case against legacy for one domain: the same percept, the same seed, the same choice key.
- `scripts/gate.sh --quick --oracle packet/P-BOT-BRAIN-CHOICES-1` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-BOT-BRAIN-CHOICES-1`

## 10. Risk and suggested model tier
Opus. If the cause is that the degraded profile cannot make these decisions at all, the packet's answer is the list
of facts it lacks, and the owner decides whether to deliver them (each is an observation change).

## Notes from previous attempts
