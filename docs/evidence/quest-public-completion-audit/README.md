# Remaining quest public-delivery audit

Read-only audit at integration HEAD `20e9c72d8cb21be3907fcc9e438e751033829273` (2026-11-10). No tests, captures,
Rust commands, or source mutations were performed. The `20e9c72d` tip adds the protocol-16 provider inventory; the
quest/server paths examined here are unchanged from `611a2034`.

## Existing bounded evidence

The frozen `parity/quest-notices/source.json` is `rh-quest-notices-source/1`, six cases, 181 raw event records, and 41
frames (SHA-256 `a20d751e88cb16765cf2aa3ef856765a0d3321d8e25eb6e41c6722cdf9a99244`). Its recorder retains `raidStarted`,
`toast`, `questReveal`, `gv`, `resolved`, `fx`, and `raidEnded`, including full FX payloads. Across the six cases, the
admitted comparison retains 44 ordered Toast/GV notices on both sides; it reports 137 source non-notice records and
130 native non-notice records (181 source records versus 174 native records total). The counts are deliberately not an
equality claim. Cases 0/4 and then 1/2/3/5 are admitted as a bounded ordered Toast/GV and entitled-preview witness. The continuation review confirms the diagnostic
closed-pickup case, deadline-order cases, direct teleport producer case, and inline camp-wipe case retain their stated
limits. The notice corpus is not a native comparison of all 181 event records: private `questReveal` is represented by
the entitled `QuestView`; FX, combat, lifecycle, and other classes are not promoted into a transport parity claim.

Separate source room feedback evidence takes the actual captured completion batch from `parity/quest-giver/source.json`
case 7 / frame 8 (tick 8, 400 ms; raw event SHA-256
`6e40908a3cf563b1d5778b185129c829218af6fd80c903a8a1605552563e7a26`) through the real legacy
`RaidRoom.handleEvents → toastTo → sendTo` methods. Its output order is owner `+10 GV (quest)`, owner farm-stat notice,
owner `Quest complete: Shards of the Watch`, then public `name0 completed quest: Shards of the Watch`. This is a real
legacy method projection over a captured batch, not Room construction, a socket/session send, native Outbox delivery, or
client display. The source corpus and projection remain useful post-execution comparison evidence; their output must not
be installed as native input.

Native producer and observation coverage exists: `rh-sim`'s turn-in test performs accepted input, real token pickups and
automatic completion, then checks raw quest GV and ordered owner/foreign `SeenEvent` projection. The admitted six-case
consumer likewise runs native Sim producers for its declared boundaries. This still stops before `rh-server` publication.
`rh-server/src/quest_bridge_tests.rs` tests quest wire bounds, real quest props/pickup, Room acceptance/resync and hidden,
preview, or closed-handle rejection. It has no quest Toast/GV assertion against decoded `ServerMsg::Events`.

## Concrete backend gap

There is a small, genuine missing integration proof: no current quest test carries a real native completion's events
through per-human `Room::wake`, `Room::publish`, `Publisher::frames_prepared`, delivery projection, Outbox enqueue, and
protocol decode. The test should use the wake path because that path feeds each step's `FxTickReport` into the seat's
`FxProjector` and appends viewer-filtered notices into `HumanSeat::carry` before publication. `Room::publish` passes an
empty `last_step` slice; its raw events argument is used for the dedicated per-viewer result path, not as a substitute
for the carry. Calling `Sim::step()` and then `Room::publish(&events)` would not prove delivery of quest Toast/GV.
The component layers are present:

- `crates/rh-server/src/room.rs:1402-1468` publishes for each connected human using that human's observer and carry;
  successful enqueue commits staged state. `Room::publish` is private, but `quest_bridge_tests` is a child test module
  declared in this file (`room.rs:1782-1785`), so it can exercise this exact method without widening production API.
- The actual Room path is `crates/rh-server/src/wire.rs:335-414`: `Publisher::frames_prepared` prepares the per-seat
  observation and `build_observation_frames` calls the imported shared `rh_policy::delivery::projection::to_wire`,
  then encodes `ServerMsg::Events`. Shared `projection.rs:310` maps `SeenEvent::Toast` to `WireEvent::Toast`.
  `rh-policy/src/delivery/session.rs:74-99` is a parallel delivery-session path; Room does not invoke it.
- Existing `quest_bridge_room_failed_enqueue_accept_resync_and_resume` explicitly constructs a test Room, joins a
  human, then swaps in an active quest-enabled Sim and rebinds its observers. Its comment correctly says this is a
  component fixture, not proof of the runtime/lobby startup path. The nested test module already has `drain(&Outbox)` to
  decode accepted frames.
- `quest-room-feedback` supplies a narrow legacy completion-order oracle; native `live_tests.rs` supplies a real
  accepted/turn-in producer recipe; native observation tests establish owner-only GV/Toast projection. None currently
  composes all of those through Room publication.

This can proceed independently of Unity or protocol edits. The wire toast has no recipient field; delivery privacy is
viewer-local because `Room::publish` prepares a separate observation for each human. Assertions must therefore compare
each human's decoded toast sequence and absence/presence, not invent a wire recipient property.

## Smallest justified next packet

Recommend a DeepSeek test-only packet, with no production or protocol changes:

| Scope | Exact path |
| --- | --- |
| New focused producer-through-Room test(s), reusing existing helpers | `crates/rh-server/src/quest_bridge_tests.rs` |
| New sanitized commands/results and explicit component-fixture limitations | `docs/evidence/quest-public-completion-room-delivery/**` |

The test should create a test `Room` plus owner and foreign human Outboxes, then use the established explicit active-Sim
swap/rebind pattern before issuing any handles or actions. Bind each Sim placement to the actual joined seat id, rebind
both FX projectors and item observers, and label the active-Sim bootstrap as component setup. This avoids conflating
direct active-state fixture setup with proof of lobby/startup. The native actor/offer/tokens/progress/reward/events must
still be produced by the Sim.

Use `quest_bridge_sim`/`quest_bridge_runtime` as the existing deterministic native active-world recipe: source arena,
seed7, two declared human placements, and inspection of the *actual produced* published Open Collect offer. Bind the
owner to the receipt's `name0` only when that is an explicit fixture placement, and select `shards-frost` only if the
generated native offer is actually present and open. Do not install an offer or copy source frame pose diagnostics as
initial input. The existing source `quest-room-feedback` case7/frame8 is only the after-execution output oracle; it is
not a Sim/Room setup object.

After joining and rebinding, use `Room::wake(start + 50ms)` to publish actual current QuestView/Props and decode their
current handles. For every gameplay action, send a correctly sequenced `RoomCmd::Input` with the joined player's `conn`
and the current decoded QuestAccept/Pickup handle or an accepted `WireCommand::Move`; call `Room::wake` once per ordinary
50 ms slot. Move to actual native objective positions through accepted Move commands, collect the delivered quest
items with their current handles, then return to the actual giver. Keep draining both Outboxes each wake. This mirrors
the existing `live_tests::collect_tokens_and_the_turn_in_pay_the_two_reward_channels` accept → collect → return recipe,
but does not reuse its private `teleport()` calls: those calls are test pose edits, not ordinary movement. A single
explicit initial Placement for the owner near the actual generated giver is setup only if the movement route otherwise
blocks the bounded proof; all acceptance, pickups, progress, completion, and payment must still be earned by Room input
and normal wakes. Never write quest progress, carrier, Done status, GV, or an Event.

At each completion wake, bind raw output to `room.last_events` and check the actual typed completion state as corroboration;
decode the messages from both real Outboxes. The server sequence is sourced by `FxProjector::feed`/`append_into` into the
seat carry, then merged by `frames_prepared` and encoded as `ServerMsg::Events`. Do not call `Room::publish` with a
hand-built or separately produced event batch for the delivery claim.

At minimum, assert that the owner's `ServerMsg::Events` contains the exact ordered completion toast sequence and that
the foreign viewer receives only the genuinely public toast(s), not owner GV/farm/completion notices. Compare the
observed text/order to the sealed `quest-room-feedback` completion witness after native production; assert the event
tick and unchanged public protocol types. Keep raw native `Event` producer output separate from projected wire output.
No expected event or expected recipient outcome may seed the Sim. Preserve the existing source-event batch and source
notice consumers unchanged. Record the profile-gate bypass as a test-component fixture, not hosted quest activation.

If the exact source-matched completion cannot be reached from the deterministic actual native offer and accepted action
path above, return the concrete missing producer/input fact to Root. Keep the full completion-delivery target; do not
downgrade it to acceptance-only, and do not inject constructed `Event` rows to manufacture an apparent
Room-to-Outbox result.

Focused acceptance should cover the new test, existing `quest_bridge` tests, relevant delivery/wire tests only if shared
setup changes, and scoped format/default/all-feature lint. Do not rerun source capture, the 181-record campaign, broad
workspace tests, protocol vector generation, or browser proof for this test-only packet.

## Boundaries and remaining ownership

This proposed integration would prove native quest completion through backend per-seat publication and protocol
decoding for its declared component fixture. It would not prove the full runtime lobby/startup path, live
authenticated sockets, persistent resume/reconnect notice retention, the complete 181-record transport stream, browser
rendering, toast lifetime, Unity acceptance, or full quest-port parity. The already admitted notice/preview and Room
component tests remain the accepted bounded scopes. Any broader public client or host activation remains outside this
packet and requires its own accepted backend/profile and client gates.

### Hosted quest configuration is not globally disabled

`Settings::sim` sets `quests: !training` (`crates/rh-server/src/runtime.rs:122-150`, assignment line127): the actual `source-arena` runtime enables quests and the
training runtime disables them. `Director::validate_runtime` requires quest configs to use a validated layered map and
enforces the training exclusions; `wire::profile_supported` only rejects a training configuration combined with quests
or arena lifecycle. `main.rs` sets `quests: false` only in its no-runtime fallback (`main.rs:467-507`, assignment
line471). The existing bridge-test `cfg()` also
starts with quests disabled, then swaps in an active quest Sim for its component test. Therefore this packet does not
allocate production quest activation or assume a global Room quest gate. The source-runtime browser/UI flows and their
union acceptance remain separate.

Reviewed references: `docs/evidence/quest-notices/README.md`,
`docs/evidence/quest-notice-continuation-review/followup.md`, `docs/evidence/quest-room-feedback/README.md`,
`docs/evidence/quest-gv-native/README.md`, `crates/rh-server/src/quest_bridge_tests.rs`,
`crates/rh-server/src/room.rs`, `crates/rh-policy/src/delivery/session.rs`,
`crates/rh-policy/src/delivery/projection.rs`, `crates/rh-sim/src/quests/live_tests.rs`, and
`crates/rh-sim/src/observe/quest_gv_tests/source_room.rs`.
