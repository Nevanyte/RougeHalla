# P-QUEST-ROOM-DELIVERY-1 — real quest completion through Room publication

**Status: Root-approved implementation dispatch; see the final allocation below.** Prepared at integration HEAD
`ef6161c3cc6c0b4c9f2d0c770d2486640d24666d` (2026-11-10). Root chooses the eventual clean base, worker, and exact
leases. All Rust remains DeepSeek-owned; no client/protocol change, source recapture, production activation, or status
edit is included.

## Goal and limits

Add one bounded server test that starts from a deterministic, actually produced native Collect offer; earns completion
through accepted Room inputs and ordinary fixed 50 ms wakes; and proves the owner's and foreign human's resulting Toast
sequence through the actual per-seat publication, Outbox, and protocol decode path. Compare only after the native world
has produced its own events against the captured legacy Room-method output order. Do not claim equality of the 181-record
source transport stream, full quest or browser acceptance, hosted lobby startup, or public quest activation.

This is a real residual backend integration seam: `quest_bridge_tests.rs` already covers native quest wire views,
pickup, Room accept/resync, and hidden/preview/closed-handle refusals, while the admitted source/native notice tests stop
at Sim observation. No test composes a genuine native completion through `Room::wake` into per-human `ServerMsg::Events`.

## Read-only producer and publication contract

- `crates/rh-sim/src/quests/live_tests.rs::collect_tokens_and_the_turn_in_pay_the_two_reward_channels` is the code-backed
  earned progression recipe: actual accepted QuestAccept, actual token pickups, return to the offer, automatic turn-in,
  quest GV, farm award, private completion toast, and public completion toast. Its test helper teleports the actor before
  acceptance, each pickup, and turn-in; those pose changes are test conveniences, not ordinary movement and must not be
  described as such in this packet.
- `crates/rh-server/src/quest_bridge_tests.rs::quest_bridge_room_failed_enqueue_accept_resync_and_resume` demonstrates
  actual Room input handling, a current delivered quest handle, and the explicit active-Sim swap/rebind component
  fixture. It currently demonstrates quest acceptance/state delivery only. Use its seat, `RoomCmd::Input`, and Outbox
  helpers as code patterns, not its narrow one-human coverage as public-delivery proof.
- The ordinary publication path is `Room::wake` (`room.rs:1240-1400`): it runs due Sim steps, feeds each completed
  `FxTickReport` through the seat-owned `FxProjector`, appends viewer-filtered events into that human's carry, then calls
  `Room::publish`. The publish call passes an empty last-step event slice to `frames_prepared`; the raw event batch is
  used by the dedicated per-viewer result path. Toast/GV delivery for this test therefore depends on the actual wake-fed
  carry. A direct `Sim::step()` followed by `Room::publish(&events)` is not an acceptable substitute.
- The Room call chain is `crates/rh-server/src/wire.rs::Publisher::frames_prepared` and
  `build_observation_frames` (`wire.rs:335-414`): it converts the already-observed events, appends only the dedicated
  per-viewer results, and encodes `ServerMsg::Events`. Its imported shared
  `rh_policy::delivery::projection::to_wire` maps observed Toasts to the existing `WireEvent::Toast`.
  `rh-policy/src/delivery/session.rs` has a parallel delivery-session encode/decode path, but Room does not call it.
  There is no recipient field on the wire Toast. Recipient privacy is established by comparing the separate owner and
  foreign viewer batches.

## Proposed exact scope

| Owner | Exact path |
| --- | --- |
| DeepSeek focused room producer/delivery test(s) | `crates/rh-server/src/quest_bridge_tests.rs` |
| DeepSeek sanitized commands/results and limitation record | NEW `docs/evidence/quest-public-completion-room-delivery/**` |
| Independent source/code review | NEW `docs/evidence/quest-public-completion-room-delivery-review/**` |

No production Rust, protocol, wire type, quest rule, host profile, source, existing corpus, native notice consumer,
client, shared status, `Cargo.lock`, or existing evidence file is in scope.

## Concrete setup and earned sequence

1. Build a test `Room` with `source_arena()`/matching `MapAssets`, two real joined human Outboxes, stable connection ids,
   and a fixed tick/seed. Reuse the current test helper recipe (`quest_bridge_sim`, `quest_bridge_runtime`) only as
   component setup; bind the active Sim players to the joined seat identities, and rebind **both** `fx` projectors and
   `ItemObserver`s before any observer handles are issued. This active-Sim swap is an explicitly labelled component
   fixture, not the Room lobby/startup path. A single declared initial `Placement` at the actual generated offer/giver may
   be used to keep the bounded route finite. Never copy the source frame's constructor-output pose diagnostics into
   native setup.
2. Inspect only the newly generated native offer set. Select the published Open Collect offer by the actual produced
   `shards-frost` identity if that offer exists. If it does not exist/open under the deterministic setup, report the
   specific producer/setup gap to Root; do not install an offer or substitute an unrelated expected offer while claiming
   the captured Shards completion witness.
3. Use the first ordinary `Room::wake(start + tick)` to publish the actual current owner QuestView and Props. Decode the
   Outbox and obtain the actual issued QuestHandle. Submit QuestAccept through `RoomCmd::Input` using the correct joined
   player, connection, monotone sequence, and current handle. `Room::handle` must resolve/validate/submit it. Advance with
   one `Room::wake` per due 50 ms slot; drain and decode both Outboxes every wake.
4. After each accepted movement/step, derive movement targets and pickup handles from currently delivered observations.
   Submit ordinary `WireCommand::Move` and `WireCommand::Pickup` inputs with current typed handles; let the native
   movement/pickup path earn each unit of objective progress. Re-observe/resolve handles after publication as needed.
   Return to the real native giver with accepted movement and allow the ordinary quest system to produce turn-in.
5. Inspect `room.last_events` only after each normal wake to bind the actual native completion tick and corroborate the
   actual typed GV/turn-in producer. The observation, projection and wire output remain the primary delivery subject.
   No direct raw `Event`, progress, carried-item, offer-status, reward, closure or completion installation is permitted.

The shared `quest_bridge_sim` currently uses seed7, source arena, and two human placements. If matching the captured
public name is necessary, declare `name0` as the test owner's initial placement before constructing the Sim; do not
rewrite the actor's name after producing the completion. Use the foreign human as `name1`. The full captured
`quest-room-feedback` completion batch is the *post-execution* text/order oracle only; neither its events nor its
recipient rows are native setup inputs.

## Required assertions

- Completion was produced by the real accepted action/pickup/turn-in route, and its native completion wake tick is
  recorded from the running Room rather than copied from source tick8/400 ms.
- Decode `ServerMsg::Events` from both Outboxes at that actual tick. For the exact `shards-frost` case, compare the full
  ordered Toast subsequence against the source method witness: owner gets `+10 GV (quest)`, the farm-stat grant notice,
  `Quest complete: Shards of the Watch`, then public `name0 completed quest: Shards of the Watch`; the foreign viewer
  receives only the final public toast. Compare the text/order after native production; bind the public name to the
  declared native owner name. Do not invent a wire recipient assertion.
- Assert that raw quest GV remains a native producer event and that the owner protocol notice appears once through the
  existing observation mapping. Preserve source/private/public ordering; do not create a duplicate world Toast for GV.
- The source-room batch provenance is `parity/quest-giver/source.json`, case7 `completion-retirement`, frame8
  `turned-in`, tick8/time400 ms, raw events SHA-256
  `6e40908a3cf563b1d5778b185129c829218af6fd80c903a8a1605552563e7a26`. This tick describes the captured legacy
  projection input, not the required native Room tick.
- Keep native producer output, `SeenEvent` batches, and decoded wire rows distinct in assertions/receipts. There is no
  all-event-count or 181-row equality gate.

If the native current offer/producer path cannot reach this full completion without a missing real producer input,
stop and return that concrete gap to Root. Do not downgrade scope to acceptance-only, do not weaken the privacy/order
assertions, and do not manufacture event rows.

## Quest hosting interpretation

Do not add quest activation to this packet. The current runtime code does not impose a blanket quest-hosting ban:
`Settings::sim` sets `quests: !training` (`crates/rh-server/src/runtime.rs:122-150`, with the assignment at line127), so `source-arena` enables
quests while the training profile does not. `Director::validate_runtime` requires a validated layered map for quests
and rejects incompatible training settings (`director.rs:334-354`); `wire::profile_supported` only prohibits a training
configuration combined with quests or arena lifecycle (`wire.rs:107-116`). `main.rs`'s no-runtime fallback sets
`quests:false` (`main.rs:467-507`, assignment line471), which is distinct from the Source runtime profile. The existing `quest_bridge` test
config starts disabled and swaps in an active Sim because it is a component fixture; that assertion does not show a
global hosted quest gate. Any UI/browser flow, union acceptance or release readiness remains independently gated.

## Validation after a separate Root dispatch

Run the new focused server test and existing `quest_bridge` tests, then relevant wire/delivery tests only if shared setup
changes. Run scoped format and default/all-feature strict server lint with exact commands, exits and raw logs. No source
capture, 181-record campaign, broad workspace test, protocol vector regeneration, browser run, host profile edit, or
deployment is part of this plan.

## References

- [Quest public completion audit](../../evidence/quest-public-completion-audit/README.md)
- [Source room feedback witness](../../evidence/quest-room-feedback/README.md)
- [Six-case bounded notice continuation review](../../evidence/quest-notice-continuation-review/followup.md)
- `crates/rh-server/src/quest_bridge_tests.rs`, `crates/rh-server/src/room.rs`, `crates/rh-server/src/wire.rs`
- `crates/rh-policy/src/delivery/projection.rs`
- `crates/rh-sim/src/quests/live_tests.rs`, `crates/rh-sim/src/observe/quest_gv_tests/source_room.rs`


## Active Root allocation (2026-11-10)

Root approves the independently released final plan SHA256
`568a8ddfa10349f128ac322cbbc148b91cd2700ebe47d98b63641d8f04c3cd59`; the
[final independent review](../../evidence/quest-room-delivery-plan-review/README.md) preserves earlier citation
corrections and exact final binding. Implement the complete bounded proof, not a plan or acceptance-only substitute.

Work only in `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-quest-room-delivery`, branch
`codex/deepseek-quest-room-delivery`, from this Root dispatch commit (exact clean hash is supplied in the worker prompt).
The sole existing-file lease is additive focused tests/helpers in `crates/rh-server/src/quest_bridge_tests.rs`.
Preserve all existing test behavior/expectations; do not edit shared helpers in other files. New sanitized evidence
belongs only under `docs/evidence/quest-public-completion-room-delivery/**`.

The approved plan's exact ordinary wake, real delivered handles, accepted movement/pickup/turn-in, two-viewer full
Toast equality, actual native tick and explicit bootstrap limits are mandatory. No expected Event/carry/quest progress
installation, post-bootstrap teleport, direct hidden pickup ID or output-membership filtering. The current Source
runtime already enables quests; this proof changes no production/host profile. No automatic scope downgrade.

Use `/Users/nevinmckinnon/.cargo/bin/cargo`, pinned Rust1.97.0, locked/offline/jobs1, incremental0 and your own
`target-deepseek-quest-room-delivery`. Run the new focused test, unchanged quest_bridge regressions, format and strict
default/all-feature server lint. No source capture, fixture/lock/dependency/wire/schema edits, broad unrelated campaign,
client work, shared status edit, merge/push/deployment or communication with Claude before17:30UTC/10:30am Edmonton.
Keep all raw first failures and actual final commands/cwd/env/exits/counts/code hashes. If a concrete real producer or
input reach gap requires a new scope decision, report the exact evidence to Root; do not inject an outcome. Keep
Workspace Write unchanged. If common Git metadata is unwritable, provide exact scoped-file hashes/diff/seal for Root
instead of expanding permissions. No cache/target files belong in the candidate seal.
