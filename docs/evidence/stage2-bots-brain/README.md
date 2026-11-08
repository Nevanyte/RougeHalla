# P-BOTS-3 remainder — the planning feature module (slice DONE-VERIFIED; packet INCOMPLETE)

Phase: stage 2, backlog [P-BOTS-3](../../backlog/README.md) (planning/chest/hazard modules + chestHunt; deps P-ARENA-1,
P-CARDS-2, P-TERRAIN-1, P-BOTS-1). **No packet file exists.** Branch `deepseek/p-bots-brain`, created from
`origin/deepseek/p-bots-6` at `f87727dd` (the bots tip: core + Wish + tactics + hunt + tournament); the PR is stacked on
`deepseek/p-bots-6`. No wire, schedule, serialized-state or content change.

## Assessment before writing (code and git, not memory)

The P-BOTS-3 evidence (`docs/evidence/stage2-bots-3/README.md` at the bots tip) leaves four items: (1) the feature
modules planning/chests/hazards + chestHunt, (2) the full BrainContext/memory/strategy goal machinery, (3) strategy.ts
scoring/threat and tactics/{fight,world}, (4) full fair perception. The same remainder is repeated from the P-BOTS-4
evidence for the stateful hunters/build routes that consume it. The Rust seat today has fair perception, the tier/persona
tables, the humanizer, the Wish module, the room path service, away-points and a bounded combat/roam front end, but its
planning branch is a placeholder: it sends one `Plan { ready: true }` on the first planning tick.

The requested order starts with the BrainContext/memory/goal machinery + strategy scoring/threat + tactics/{fight,world}.
That layer is large (memory.ts 920, strategy.ts 901, tactics/{fight,world} 695 lines plus the frames/knowledge/services it
reads) and nothing in it is observable until a consumer exists. The planning module is the opposite: a bounded, self-contained
feature module (179 lines) whose entire dependency set is the shared planning maths (matchupShare/campMatchup/nearestCamps/
planSpawnScore/planPick), which is itself pure and capturable value-for-value. It was the largest *verifiable* slice of this
packet's first item, and porting its maths also closes P-BOTS-4's outstanding item 4 (planSpawnScore/PLAN_CAMPS/matchupShare)
and half of item 5 (the reference-duel/matchup consumer). So this slice lands the planning module with real seat wiring and an
actual-source corpus, and reports the rest as the exact remainder below.

## What landed

- `crates/rh-policy/src/bots/planning.rs`:
  - the shared planning maths: the reference duel of `shared/factions.ts` (bonusParts/pressure/aura/lifesteal/mitigate and the
    integration order), `shared/mobs.ts` mobFaction (including the execute k-squared and mark k x d hand scaling),
    `shared/mark.ts` markTierOf/taxedRate, matchupShare, campMatchup, nearestCamps, planSpawnScore and planPick, over the
    public `rh_sim` faction sheet and registered constants (no gameplay number is re-declared except the identity-valued
    FACTIONS params mark_amp/tax_keep/tax_cap/suppress, documented as such);
  - the module's state machine: PLAN_RULES, the deal reader, the tier-scaled reading/settling schedule, the spawn pick with the
    learned state bias and the tier softmax/lapse, the boon pick, the Ready timer, the three-asks resend ladder and the no-deal
    Ready, exactly where `brain/modules/planning.ts` puts them.
- `crates/rh-policy/src/bots/bot.rs`: the seat's planning branch now feeds the observed deal, clock, tier, faction and
  map view through `observe`/`intents` and emits `PublicCommand::Plan` on the validated path; the planning map view is read
  once from the public arena layers at reset. The humanizer's menu conversion for a plan intent is the identity; the module
  itself models the human timing (tier reading, settling and reaction-gated re-asks), and the planning branch carries no other
  competing command, so the seat converts the module intent 1:1 (documented below).
- `crates/rh-policy/src/bots/types.rs` + `perception.rs`: the fair percept's own view now carries the owner's faction (the
  observation already sends it publicly; the planning spawn maths reads it).
- Capture tooling `tools/bots-planning-fixtures/` (capture.mts/capture.sh/README.md/plan-maps.json) and the corpus
  `parity/policy/bot-planning.json`, sha256 `e1eb015e88e4967d929f4bd9d8d182736fe0d3dae5cac059d899c91b795bf975`, captured
  in the pinned Linux x64 Node 22.23.4 container: 50 matchupShare rows, 15 campMatchup, 6 nearestCamps, 240 planSpawnScore,
  70 planPick rows, the module's constant/tier tables and ten declared screen cases; after every module step the next draws
  of the decide/lapse streams are recorded, so stream-consumption drift fails even when the answer accidentally matches.

## Tests

`crates/rh-policy/src/bots/planning_parity_tests.rs` (6 tests):
- `captured_planning_helpers_reproduce`: every helper row matches the actual source value to 1e-6.
- `captured_planning_cases_reproduce`: every declared frame's intent (spawn/boon/ready/why) and every RNG probe matches.
- `captured_planning_constants_pin_the_source_tables`: PLAN_RULES, PLAN_SECONDS, PLAN_CAMPS and the tier numbers it reads.
- `mutants_of_the_planning_corpus_cannot_false_match`: flipped Ready, nudged matchup, wrong spawn and drifted RNG probe all fail.
- `a_seat_presses_ready_without_a_deal` / `a_seat_answers_a_deal_then_presses_ready`: the real seat wiring (Observation-only
  planning phase -> module -> PublicCommand::Plan), including the source's 1000 ms no-deal boundary and the ask-then-Ready path.
The capture tool's `--check` mode is byte-identical.

## Gates

- `cargo test --workspace --all-features --locked` (pinned PostgreSQL): **1,480 passed, 0 failed, 3 ignored, 154
  test binaries, exit 0**.
- `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`: **clean, exit 0**;
  `cargo fmt --all -- --check` clean.

## Documented gaps in this slice

- The planning branch converts the module's intent to its plan command directly. The source routes it through
  `humanizer.submit`; for a plan intent that conversion is the identity, but the humanizer's token bucket/min-gap gate that
  shares the combat click stream is not replayed for menu intents here. The module's own timing (read/settle/re-ask waits) is
  ported; if a later slice routes menu intents through the humanizer queue, the corpus already pins the intent stream it must
  feed.
- The learned-bias layer is the declared stats-file interface only: the module reads a bias map the seat leaves empty (the
  learning store is P-BOTS-5 and is off by default). The corpus exercises the enabled path with declared biases.

## Exact remainder for P-BOTS-3 (after this slice)

1. The BrainContext/memory/goal machinery: `brain/memory.ts` (MobTracker engagement/bans/retreat, player/container/chest
   memory, camp memory, goal reasons), `frames.ts`, `knowledge.ts`, `services.ts` wiring and the goal/intent merge in
   `brain.ts`.
2. `brain/strategy.ts` scoring/threat/HP-race/execute/goal selection and `tactics/fight.ts` + `tactics/world.ts`.
3. The remaining feature modules `modules/chests.ts`, `modules/hazards.ts` and `server/src/bots/chestHunt.ts` (they consume
   items 1-2).
4. Full fair perception (the P-BOTS-1 remainder: `brain/perception.ts` beyond the bounded view) is the input side of all of
   the above.
5. P-BOTS-4's stateful MobHunter/BuildRoute/huntAdapter remain (they need the same memory/frames layer).

No `docs/MIGRATION.md`, `docs/CONTRACTS.md` status table, `Cargo.lock` or `packages/` edit; no merge.
