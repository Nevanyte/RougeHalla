# P-BOTS-3 remainder — planning + Knowledge + the fair-view foundation (slices DONE-VERIFIED; packet INCOMPLETE)

Phase: stage 2, backlog [P-BOTS-3](../../backlog/README.md) (planning/chest/hazard modules + chestHunt; deps P-ARENA-1,
P-CARDS-2, P-TERRAIN-1, P-BOTS-1). **No packet file exists.** Branch `deepseek/p-bots-brain`, created from
`origin/deepseek/p-bots-6` at `f87727dd` (the bots tip: core + Wish + tactics + hunt + tournament); the PR is stacked on
`deepseek/p-bots-6`. No wire, schedule, serialized-state or content change.

Pull request: [#58](https://github.com/Nevanyte/RougeHalla/pull/58), stacked on the P-BOTS-6 PR; commit range
`f87727dd`..`8bec7290` on `deepseek/p-bots-brain` (slice 1 `1aa8c462`, slice 2 `6a432c2b`, slice 3 `8bec7290`). Ledger row:
[`docs/evidence/deepseek-rust/PROGRESS.md`](../deepseek-rust/PROGRESS.md).

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

## Slice 2 — the Knowledge layer (task-24)

The P-BOTS-3 remainder II starts with the foundation layers. After re-checking the three, the Knowledge layer was the largest
layer that is pure, fully observable and independently capturable; memory.ts (920 lines) and frames.ts (485) both need the full
client-percept/event model that the Rust policy does not carry yet (its percept is deliberately narrowed to what the current
front end reads), so they are the next slice rather than approximated here. frames.ts in particular is the client network-delay
ring: the Rust policy receives the authoritative fair Observation directly (C-OBS), so a port would currently be an unused
parallel input path.

What landed:
- `crates/rh-policy/src/bots/knowledge.rs»: the source Knowledge layer over the ported shapes — ten faction masks and ten
  weapon masks drawn from the independent tag-3 Knowledge stream, one fixed mob-share error per me/region/elite triple, `factionEdge»/
  `weaponEdge» (the faction wheel is all zero since the rework; the weapon wheel uses the already-ported mob_hunt edge),
  `mobShare» (the planning matchupShare plus the fixed error, clamped to 0..1) and `odds» (known-wheel score or the tint's
  sign, plus twice the hp-share lead, clamped to -2..+2, with the source's two-decimal debug line).
- `crates/rh-policy/src/bots/types.rs»: the source OpponentSnapshot and FightOdds data shapes.
- Seat wiring: HumanBot owns the Knowledge layer, created in `reset» from `mulberry32(derive(seed, 3))` exactly where the legacy brain
  construction creates it (before any decision), with a `knowledge()» accessor for the strategy/tactics consumers that are the
  next slice. The repaired wiring does not consume the decision stream; the policy/humanizer corpora stay green.
- Capture `tools/knowledge-fixtures/» + corpus `parity/policy/bot-knowledge.json», sha256
  `872e154cc226fdb974b075a7650580b702c1fd14513dae0906dd959f1c97fce6», captured in the pinned Linux x64 Node 22.23.4
  container: six declared creations (three tier tables, blind, seer, partial) over declared seeds, every wheel pair both ways,
  the full 5x5x2 mob-share grid, 396 declared fight-odds rows covering known/partial/tint and clamp paths, and the next two
  stream draws after each creation to pin the draw count. `--check» is byte-identical.
- Tests `crates/rh-policy/src/bots/knowledge_parity_tests.rs» (4): every captured creation/wheel/mob-share row reproduces, every
  odds row reproduces with its debug line, the constants are pinned, and four mutants die (drifted creation stream, nudged mob
  share, wrong odds trace, flipped wheel edge).

## Slice 3 — the fair-view foundation (task-26)

The P-BOTS-1 remainder (the full fair perception view model) is the source `brain/perception.ts` constructor: a state-plus-fx
frame becomes the full client Percept (self/fighter/mob/container/camp/field/minimap views, the decoded event stream and
projectiles). The constructor needs two things this slice could not both certify in one step: its pure exported foundation
(landed here), and the fair Observation leaves the Rust side does not carry yet (container labels/contents, minimap repaint
state, build/potion/barrier HUD facts, and a decoded-fx stream equivalent). This slice lands the foundation value-for-value;
the constructor itself and the Observation extension are the next slice, and memory.ts stays blocked until they land.

What landed:
- `crates/rh-policy/src/bots/view.rs`: the exported source helpers over the ported window constants —
  `detectFeatures` (the room/branch feature flags by runtime presence: the client message gates, the schema fields by key,
  the fields/camps state keys, the default message set, the first-player fallback, and the map floor-hazard scan when the
  probe is an instance), `inView`/`fieldInView` (the exact window tests, trails as segments) and `plainCopy` (the JSON-safe
  message copy with the source depth limit), plus the `Features`/`FeatureProbe` shapes and the client message set. No new
  crate dependency: the message-data value is a local JSON-like enum (the policy crate has no serialization dependency).
- Capture `tools/perception-fixtures/` + corpus `parity/policy/bot-perception.json`, sha256
  `378b0a073ad9b474df5eedbadffa6ef257661cd2f5d74afc2393b5e8447a5782`, from the pinned Linux x64 Node 22.23.4 container:
  19 declared feature probes (each gate, schema field, state key, default set, first-player fallback and every hazard
  branch), 81 inView rows and 63 fieldInView rows, and 13 plainCopy values including the depth limit. `--check` is
  byte-identical.
- Tests `crates/rh-policy/src/bots/view_parity_tests.rs` (4): every probe/row/value reproduces, and four mutants die
  (flipped feature flag, flipped window answer, field radius that must matter, an extra copied key).

## Gates

- `cargo test --workspace --all-features --locked` (pinned PostgreSQL): **1,488 passed, 0 failed, 3 ignored, 154
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

## Exact remainder for P-BOTS-3 (after these slices)

1. The BrainContext/memory/goal machinery: `brain/memory.ts` (MobTracker engagement/bans/retreat, player/container/chest
   memory, camp memory, goal reasons), `frames.ts`, `services.ts` wiring and the goal/intent merge in `brain.ts`. Both
   need the full client-percept/event view model (FighterView/MobView/Percept events/projectiles/extras) that the Rust
   policy's narrowed percept does not carry; frames.ts is additionally the client network-delay ring, which the
   Observation-authoritative Rust architecture currently has no consumer for.
2. `brain/strategy.ts` scoring/threat/HP-race/execute/goal selection and `tactics/fight.ts` + `tactics/world.ts`.
3. The remaining feature modules `modules/chests.ts`, `modules/hazards.ts` and `server/src/bots/chestHunt.ts` (they consume
   items 1-2).
4. Full fair perception (the P-BOTS-1 remainder: `brain/perception.ts` beyond the bounded view) is the input side of all of
   the above.
5. P-BOTS-4's stateful MobHunter/BuildRoute/huntAdapter remain (they need the same memory/frames layer).

Delivered across PR #58: the planning feature module + its shared planning maths (slice 1), and the Knowledge layer with its
counter wheels, mob-share errors and fight odds (slice 2).

No `docs/MIGRATION.md`, `docs/CONTRACTS.md` status table, `Cargo.lock` or `packages/` edit; no merge.
