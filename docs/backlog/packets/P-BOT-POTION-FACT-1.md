# P-BOT-POTION-FACT-1: accepted owner healing predicate proof

## ID and outcome

Root dispatch,2026-11-10. DeepSeek owns this **test-only** proof of an existing native producer/accepted-frame
invariant. It is not a potion mechanic port, full bot runner, new public fact or live activation. Prove that the source
runner's consumed predicate `healingUntil > now` can be represented by accepted owner inventory
`potions_healing > 0` in the validated non-Ended domain at exactly the frame's source time. Sol independently reviewed
the static producer/validator reasoning; preserve any actual counterexample rather than repair production unilaterally.

## Dependencies

Start from the current Root backend integration containing admitted NPC/quest repairs and the protocol14 delivery
boundary. Root creates isolated `codex/deepseek-potion-fact` in `backend-bot-potion-fact` and records its exact start in
the runtime handoff. Current Card, Tactics, Modules and Hand workers own separate scopes and must not be edited.
No new source capture is required: this proves a property of the existing native producer and accepted transport,
not a new source behavior. The later runner port still needs actual source parity.

## Relevant paths

- `packages/server/src/bots/brain/runner.ts:29-35`: consumed owner-only predicate and potion eligibility.
- `crates/rh-sim/src/systems/potions.rs`: actual use, HOT updates, fighter-out cleanup and checkpoint validator.
- `crates/rh-sim/src/potions.rs`, existing `systems/potions_tests.rs` and observation/inventory projection.
- `crates/rh-policy/src/delivery/{mod.rs,frame.rs,collections.rs}` and existing actual accepted-delivery tests.
- `docs/evidence/bot-fair-activation-plan/field-closure.md` and forthcoming independent plan review.

## New paths and exclusive write scope

- NEW `crates/rh-policy/src/bots/potion_fact_tests.rs` and optional helpers under NEW `bots/potion_fact_tests/**`.
- Existing `crates/rh-policy/src/bots/mod.rs`: ONLY `#[cfg(test)] mod potion_fact_tests;` registration.
- NEW `docs/evidence/bot-potion-fact-native/**` for real commands, results, raw failure/pass receipts and code pins.

No production edits, other existing Rust/test files, source fixtures/tools, dependency/lock, schemas, protocol, Unity,
hosting or shared status. If a helper is genuinely inaccessible, return the precise need to Root before changing scope.
All Rust/tests/probes remain DeepSeek-authored; Sol/Luna/Root may inspect and review them.

## Contracts and behavior to preserve

Use public Sim/checkpoint APIs for an explicit accepted starting fixture if setup needs stock/damage. Initial declared
state is not an earned gameplay claim. Require actual restore acceptance before use; then drive real ordinary
`validate` + `Sim::submit` + scheduled steps. Do not install HOTs, count, deadline, expected outcome or future time after
the producer runs. Enable the actual consumable/lifecycle domain being tested; avoid silently using disabled systems.

Observe the owner through actual `ItemObserver` preparation and `DeliverySession` prepare/commit. Check the resulting
opaque accepted frame's Inventory count and its exact `source_time`; a prepared view or synthetic wire row is not this
receipt. Read trusted serialized `healing_until`/HOT mirrors only in test assertions to compare the invariant, never as
input to a bot or the published frame. Preserve missing inventory as unavailable. Do not substitute viewT, local wall
time or tick*50 for the accepted source clock.

Static domain proof: nonempty accepted HOTs have last.next > world.server_time and left>=1; the stored deadline equals
last.next+(left-1)*step. With no HOT row, the validator requires both count and deadline zero. This supports only the
boolean at the same source time, not reconstruction of an absolute deadline. Ended checkpoints intentionally permit
elapsed HOTs, so the conversion must explicitly exclude Ended. These tests must not narrow restore admission.

## Acceptance checks

Use a small finite set of genuine trajectories, combining compatible checks:

1. Fresh accepted owner, real first potion use, and subsequent accepted frames show correct false→true predicate.
2. Actual second/third use reaches overlapping HOTs through normal command acceptance; show count and deadline match
   the admitted producer, without claiming that the future bot's no-heal gate would itself submit overlapping uses.
3. Accepted samples just before and exactly at the last5000ms HOT expiry establish true then false; include the
   overlapping final-expiry distinction, not only the first HOT ending. Use actual configured duration constant.
4. Real standing→out cleanup clears mirrors/count in a run kept non-Ended, so cleanup is not confused with the Ended
   exclusion. Use existing legitimate command/lifecycle APIs; no direct installed status.
5. Explicitly demonstrate why Ended is outside the derived-predicate contract using an accepted ended trajectory or
   accepted checkpoint, clearly distinguishing declared baseline from earned continuation. Do not reject valid restore.
6. The assertion/comparator must reject a meaningful wrong count or wrong sample-time pairing; the control must not
   mutate gameplay state or become an expected-answer input. Missing Inventory must be refused/unavailable.

If the chosen public APIs cannot reach a boundary, report that concrete limitation with the exact available API before
inventing a test seam or expanding the lease. No broad campaign or full workspace run is needed for this proof.

## Validation commands

Run the new focused filter, relevant existing delivery/inventory overlap, `cargo fmt -p rh-policy -- --check`, and
strict rh-policy all-target Clippy with default and all features. Use an isolated ignored build target outside new
source directories. Record actual commands/toolchain, start/source identities, counts and first failures. Tests may
reuse existing helpers only through existing visibility; do not copy another engine.

## Risk and known traps

Keep source Brain `noteSent` semantics separate from adapter acceptance. This packet does not implement a potion retry
clock: in the actual delayed BotManager, adapter send can mean successful queue insertion, while later simulation
refusal does not reverse that earlier source acceptance. No runner behavior or source expected result is inferred from
this boolean proof. No Claude communication is allowed before17:30UTC/10:30am Edmonton November10.
