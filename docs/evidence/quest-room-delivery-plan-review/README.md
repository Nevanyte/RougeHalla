# Quest completion through Room — independent plan review

Disposition: **RELEASE the bounded test-only PLAN for Root's lease/dispatch review**. This is not native test or quest-delivery admission. Read-only code review on2026-11-10 at
integration `ef6161c3cc6c0b4c9f2d0c770d2486640d24666d` (code references below); the packet was not yet saved at
initial inspection. No Rust, tests/probes/captures, production/client changes, worker contact or Claude contact.
Only this NEW review document was written. Concrete findings were sent directly to Luna and Root.

## Genuine bounded gap and profile correction

The audit identifies a real missing composition proof: earned native quest completion has not yet been asserted as
complete per-human decoded `ServerMsg::Events` output through Room publication and Outbox. The admitted quest
notice/QuestView tests and source room-method projection do not already supply it. No literal181-record legacy
transport campaign is required or justified by that gap.

Correct the audit's universal quest-disabled-host language. `crates/rh-server/src/runtime.rs:122-128` sets
`quests: !training`: the explicit SourceArena profile enables quests and Training disables them; existing runtime
tests assert this at209/214. `main.rs:467-472` quests:false belongs to the no-runtime fallback. The older shared
Room test cfg at `room.rs:2009-2032` and `quest_bridge_tests.rs:262-266` is quest-disabled, but that is a test
fixture assertion, not a universal Room/host admission prohibition. Hosting bootstrap chooses source-arena for the
Source service (`hosting/technical-demo/bootstrap.py:213-216`). A new component proof neither activates nor disables
that production profile and must not claim a host deployment/session/client result.

## Required real execution path

The exact path is available inside the already declared child `quest_bridge_tests` module, without widening
production visibility or changing Room:

1. Construct Room and join two actual human seats with distinct real Outboxes/connections. Prefer the normal test
   Room constructor with explicitly quest-enabled test config, deterministic declared secrets, source arena/assets,
   lobby/startRaid and normal wake. Existing cfg's quests:false is not a production barrier.
2. If a trusted active-Sim swap/bootstrap is necessary, perform it only before capability publication/actions,
   explicitly rebind BOTH observers/projectors and label exactly which pose/profile/lifecycle setup is synthetic.
   It is component setup, not a captured normal constructor or hosted admission proof. Never install captured
   offers, completion/progress/rewards/events, or source constructor-output pose diagnostics (`input.initial`).
3. Submit decoded typed commands through actual Room::handle(RoomCmd::Input), the correct seat/connection/sequence,
   delivered ItemObserver handles, validate/submit, and actual normal steps (`room.rs:700-738`). Acceptance, objective
   pickups/progress and automatic giver turn-in must be earned after setup; no post-setup teleport-to-token/turn-in,
   direct private container IDs, installed status or manufactured Event batch substitutes for these producers.
4. Execute completion through `Room::wake`: step_into at1327; actual per-viewer fx.feed/append_into into h.carry
   at1335-1355; publication at1377; observer prepare/build and reliable Outbox enqueue/commit at1404-1511.
   `wire.rs:335-414` uses h.carry/observed events to create the Toast frame. Its raw `all` argument adds Result only.
   Therefore `sim.step(); room.publish(&produced_events)` with empty carry does NOT prove quest Toast transport.
   Do not repair that shortcut by constructing SeenEvents/carry from the expected source batch.
5. Drain and decode both actual Outboxes, using existing drain. Drain during travel so capacity/coalescing does not
   hide the relevant frame; no socket infrastructure is needed for this test-only packet.

Existing `quests/live_tests.rs:187-250` genuinely earns token progress via pickup and the automatic completion,
but it uses private pose teleports before acceptance, each token and return. It is a useful producer reference,
not ordinary movement proof. Existing quest_bridge token test already supplies a real Move/published-Pickup recipe;
extend that approach through completion. Private runtime/checkpoint reads can diagnose/assert genesis and outcome,
not replace issued capabilities or select hidden client action facts.

## Honest two-viewer oracle and tick

The frozen source room-feedback witness projects the genuine quest-giver case7/frame8 completion batch through
real legacy handleEvents/toastTo/sendTo. It supplies ordered expected text and recipient semantics, not native
Sim/Room input. Owner receives GV, farm reward, completion, public announcement in that order; foreign receives
only the public announcement. Native wire Toast has no recipient field: privacy is proved by which actual
Outbox contains the row. Do not invent a wire recipient property or source broadcast fanout.

For exact Shards of the Watch overlap, compare the complete Toast subsequence of each decoded completion-window
Events batch, including extras, order and absence: owner4 versus foreign1. Do not filter by expected-text membership,
substring matching, amount membership, or a claimed quest label. If decorative owner names differ, bind source
p0/name0 to the actual owner identity/name explicitly and narrowly; do not wildcard quest/reward text or substitute
a nearest different quest. A different actual quest can support a separately labelled native transport assertion,
not exact comparison to the Shards witness without a matching source oracle.

Legacy tick8/400ms is provenance of that captured producer batch, not the required Room tick after native travel.
Prefer one due50ms wake at a time (`Room::next_deadline`,1236): assert a single tick advance, locate the genuine
completion in unmodified native last_events, then require decoded owner/foreign Events tick equals that actual
completion wake's Sim tick. Do not overwrite clocks to force8, drop mismatching tick rows, or claim per-event
producer timestamps from the batch envelope during catch-up. Complete Toast-vector equality plus the real two-seat
privacy control is sufficient; no generic malformed/fuzz campaign is needed here.

## Scope and stop boundary

The minimal test-only lease is `crates/rh-server/src/quest_bridge_tests.rs` and NEW
`docs/evidence/quest-public-completion-room-delivery/**`. Its child-module access covers Room construction, intake,
wake, real last_events and Outbox decoding. No Room/wire/protocol/host profile change is justified by this plan.
Run the focused new test, existing quest_bridge regressions and default/all-feature server lint/format with truthful
raw commands/counts/exits. Reuse frozen source unchanged; do not recapture or rerun181-record/broad workspace/UI gates.

Full real completion remains the target. If accepted movement/producer inputs cannot reach it in the declared
fixture, retain the first real failure and report its exact cause to Root. There is NO automatic downgrade to
QuestAccept-only/private notice or a constructed public toast. Root may separately scope a different task after
reviewing that evidence. Outcome-installed tests or weakened output filtering cannot count as completion.

This closes only the stated component/backend delivery proof when implemented and independently admitted. It does
not establish socket/authenticated-session delivery, persistence/reconnect retention, host profile deployment,
Unity display/retention, all181 source event transport or full quest-port parity.

## Saved packet disposition and bindings

Reviewed the saved packet and corrected audit after the author incorporated the concrete findings. The packet chooses
an explicit active-Sim bootstrap, rebinds BOTH per-seat observers/projectors before handle issuance, labels that setup
rather than claiming hosted startup, and requires all later acceptance/objective movement/pickups/turn-in through Room
inputs and real wakes. Actual published handles, full ordered per-viewer Toast subsequences, native completion tick,
source-only8/400 provenance and no automatic downgrade are explicit. No production path/visibility change is requested.
The profile correction is incorporated: Source runtime enables quests; old disabled fixture is not a universal gate.
There is no remaining semantic planning blocker for this finite test-only proof. Whether the selected deterministic
fixture actually reaches an open Shards offer and completes the route remains work to be demonstrated by DeepSeek,
not a successful test inferred from this plan. A real first failure must be retained and reported, not converted into
an expected outcome or acceptance-only green.

Bounded inspected draft identities:

| Document | SHA256 |
|---|---|
| `docs/backlog/packets/P-QUEST-ROOM-DELIVERY-1.md` | `89d97efa9f8004b80d0cad532e459db3c217aa3ce99c840f00dcb78e9418e724` |
| `docs/evidence/quest-public-completion-audit/README.md` | `3d5345c72e35143883a5d7e8528fb4fbc4b96749acab666181b516e4cc93154a` |

Two citation-only corrections were sent to the author: the actual runtime type/method is `Settings::sim` at
runtime.rs122 (quests127), not `RuntimeSettings::sim`164-192; the no-runtime fallback is main.rs467-472. The actual
Room Events encoder is `wire::Publisher::{frames_prepared,build_observation_frames}` at335-414. The policy
DeliverySession is useful shared/parallel delivery evidence, but Room does not invoke that class. These corrections
do not change the approved test semantics/lease; any revised document hashes should be bound below before Root seals.

Root alone grants the existing quest_bridge_tests.rs test-only lease and new evidence paths, assigns DeepSeek and
integrates after independent native review. No implementation, new probe, capture, test run or activation was done
by this reviewer.

## Final citation-corrected plan release

**RELEASE, exact final documents at integration HEAD ef6161c3.** Independently recomputed the following hashes and
read the corrected runtime/Room encoder references. The actual Room Publisher path and Settings::sim/Source
quest-enabled interpretation now match the code. The earlier citation-only conditions are resolved; the earlier
draft hashes above remain historical rather than being overwritten.

| Final document | SHA256 |
|---|---|
| `docs/backlog/packets/P-QUEST-ROOM-DELIVERY-1.md` | `d1242c953d893189812595a87b2c29b08e599beb32f5c1aed5ff75d719c2b784` |
| `docs/evidence/quest-public-completion-audit/README.md` | `5e3ebae89d2f78640dcd7072de1cf83f7787439a241bdb5600f5f4831bdab9b8` |

This release is the bounded test-only plan for Root to dispatch, not an executed producer/delivery test, hosted
activation or native admission. The exact minimal file lease and mandatory real completion/Room wake/issued handles/
two-viewer ordered oracle/native tick/no-downgrade requirements above remain unchanged. No Rust or tests were run.

Final author handoff delta: packet reference list removed the now-parallel DeliverySession citation after the preceding
hash read. Re-read the complete final packet and independently recomputed SHA256
`568a8ddfa10349f128ac322cbbc148b91cd2700ebe47d98b63641d8f04c3cd59`; audit remains
`5e3ebae89d2f78640dcd7072de1cf83f7787439a241bdb5600f5f4831bdab9b8`. This is the authoritative final packet binding;
`d1242c95` above is the intermediate citation-corrected draft. **PLAN RELEASE remains unchanged.**
