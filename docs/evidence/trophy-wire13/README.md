# Trophy protocol 13 — Phase A and released Phase B

Private codec/client prefix from `8e3d7268e7026e2a95d201bd8e639a4f65e24e21`, under the lead's
`P-TROPHY-WIRE13` packet. The Phase A receipt below remains historical; the released Phase B section records the
normal publication/grant and actual Room queue proof. No socket or browser execution follows from these tests.

## Wire and client scope

Reward kind 3 carries one typed source-order key byte and the original positive finite binary64 gain:
`0 ad, 1 ap, 2 damage, 3 health, 4 attackSpeed, 5 armor, 6 mr, 7 speed, 8 leech`.
Rust, C# and JS preserve gain without f32 narrowing. Card kind 1, Boost kind 2, their bytes/indices, row order,
and ordinary Choose handle/index encoding stay intact. No snapshot mask, Wish lifecycle or input scheduling changes.

The owned C# reward view copies the delivered key/gain. MatchHud labels these rows Trophy, formats source names and
amounts, includes key and all gain bits in its refresh signature, and uses canonical CanChoose/Picked/Taken.
The existing Choose path is reused. `TrophyText` formats delivered values only: it calculates no investment, grant,
eligibility or cumulative killStats. Exact binary64 midpoint rounding avoids first rounding a neighbour onto a tie.

The production whole-row Kill omission remains in place before bindings are staged. The reliable offer transaction
is unchanged. Typed codec support does not authorize its removal, compact indices, publish a partial row or issue a
Trophy handle. Phase B awaits the coordinator's native prerequisite release.

## Source wording receipt

`source-format.json` is a byte-identical copy of immutable
`7bf5806c29ea8b8ef86dfc80cc908bf4c3b8684c:parity/trophy-format/format.json`:

- SHA256 `b75078a3286913391d5c7f309536bc6e8e8c4ea2f101a8ad939ad1f235e4673c`, 47,713 bytes.
- Recorded capture SHA256 `0f1e3d04b013771758e1a8f8462f050d23fcfcacb62c75b305119fdc29940f48`.
- Actual unmodified pinned-container shared source: all nine names, 28 midpoint/neighbour groups, tiny inputs and
  refusal/roll diagnostics. These are declared formatting inputs, not installed gameplay outcomes.

`TrophyTextTests` checks the immutable file hash, all nine source wordings and each tie group's parsed title/body
through a real encoded State, Session decoder and owned reward view. Flat raw midpoint neighbours also compare exact
input bits and source fixed text. No historical corpus or expected native gain was rewritten.

## Executed focused checks

- Rust protocol: 93 tests passed; strict all-target/all-feature Clippy and package formatting passed.
- C#: 288 focused protocol/vector/State/Wish/Trophy/formatter tests passed; the Unity net mirror check passed.
  A subsequent root Trophy/formatter-only run passed 5 tests including the immutable source-file hash. These overlap;
  they are not an additive test count.
- JS: 40 server vectors, 119 malformed, 13 chains, 18,205 checks; first-playable decoder controls 64 passed.
- Server collection publication controls: 6 passed, including whole-row Trophy refusal and baseline commit after enqueue.
  The protocol-13 result-metadata byte loop passed. Strict all-target server Clippy and formatting checks for the four affected server Rust files passed.
- Wish harness protocol-13 compatibility changes only current admission/version checks and diagnostic fixture values;
  its 19 focused contract/listener-readiness controls passed, with syntax/help checks. No browser was launched.
- Generated v13 fixture SHA256 `be324b5e6d5bf62fd027aae2565baa53c6470455503f3ed2213f42c5e97796c7`.
  Historical v12 stays byte-identical, SHA256 `11e2474cf1c9da8f72b016ea27249b7ac192b09e95b49853e42cbf6b0dcc9f36`.

## Pending composition and actual execution

Two actual MatchHud EditMode cases are supplied for decoded gain-only refresh/source midpoint wording, the Trophy
heading, old option labels, canonical button/skip state and ordinary Choose handle/index. They have not run in Unity
in this prefix. The coordinator reserved the existing art Editor for a focused composed test window; no new Editor
or Web player was opened or built here.

The updated server native-reward regression expects Trophy disclosure only for its owner. It requires the separately
sealed owner-filter/Observation19 prerequisite `f61faa566d8b65d69750395018e13a894ca2ee56`, absent from this prefix's
old native base. The native birth-hold and source consumers are separately composed by the coordinator. Those native
files, content/tapes/schema, shared statuses and Cargo.lock are outside this lane.

At Phase A, normal-wire credited kill → Trophy birth → reliable offer → decoded owner row → ordinary Choose → actual
grant was BLOCKED by the deliberate production omission. No simulated omitted branch was called a production proof.
The release and new execution are recorded below. One matched protocol-13 Web build follows final composition;
no stale protocol-12 build is made.

## Released Phase B

After the clean Phase A head `4352b992c90f22904512cf6840aafc580b75860f`, the lead released exact native prerequisite
`f048f3827c014b6ecac8e118ee0a28972f95107b`. Ordinary private merge
`c2989d52ddded395030a4dbfec07b5bf982feec9` composes it without editing native gameplay, content, tapes, status or lock
files. It contains the owner-before-staging filter, Observation19 and strict birth-hold/source consumers. Native
identity at that release is content `67183626db240b6a`, checkpoint25/replay19/policy13.

The server now removes only the unsupported-Kill gate. Normal observer preparation supplies owner-filtered complete
rows; the adapter exhaustively maps all nine keys and copies gain unchanged. No option filtering or index compaction
is added. Invalid gain still refuses the complete reliable replacement without committing a baseline. A declared
mixed-row adapter control uses a gain one binary64 ULP above 6.25, so an f32 conversion fails its exact check; this
synthetic transport control is separate from the genuine gameplay grant proof.

The shared `tests/support/trophy_fixture.rs` performs ordinary native stat-chest Pickup and Choose, then a validated
credited PvP kill in a four-seat match. The victim's low starting current HP is an explicit public Placement fixture;
no Trophy, invested stat, grant or status is installed. Expected grants come from the actual decoded row, never from
hard-coded native gains.

Executed on the released private union:

- `cargo test -p rh-server --lib wire`: 25 passed, including exact typed mapping/whole-row refusal and baseline controls.
- `cargo test -p rh-server --test native_reward_transport_regression`: 3 passed. Covers real kill/birth, owner/stranger
  publication, source option order and exact gain, held-tick processing refusal, ordinary wire Choose/grant, dropped
  prepared guards, repeat/skip/expiry, stale/reconnect and foreign handles, Far and dead-owner behavior.
- `cargo test -p rh-server --test trophy_status_los_transport`: 2 passed. Busy comes from an actual Frost Freeze after
  900 normal 20-Hz warm-up ticks before the kill. Blocked comes from a declared static one-wall map, validated with
  consistent floor-area metadata, and ordinary walking behind it while within the native 96-unit reward range.
  Both assert the specific native refusal and leave the real Trophy unspent and its grant unchanged.
- `cargo test -p rh-server --lib room::tests::real_trophy_room_enqueue_rejection_does_not_issue_or_spend_handles`:
  1 passed with both actual closed-queue and open-full-capacity rejection paths. It bootstraps Room with the genuinely
  produced Sim, then runs production Room.publish/Outbox, decoded State, reconnect and encoded/decoded Input Choose
  through Room intake. Rejected publication leaves the candidate handle unbound and unspent; accepted publication
  preserves rows/indices and the selected grant equals the delivered gain. Peers receive no Trophy. This is actual
  Room/reliable-queue evidence, not socket delivery. Room changes are confined to the explicitly leased test module.
- Strict `cargo clippy -p rh-server --all-targets --all-features -- -D warnings`, package formatting and diff checks pass.

Boundary details kept explicit:

- Sim advances its tick before processing queued input. Row CanChoose is false at birth and held ticks; a Choose
  submitted at birth processes at the held tick and refuses. Submitting during the held tick can process on the first
  available tick. The tests assert processing time rather than inventing an extra gameplay delay.
- Tests choose the last original option actually produced; they do not install additional investments to force a
  particular slot number. Owner repeat reaches Picked before Taken; the resulting Taken/Picked facts are checked.
- Handles are viewer-local. A foreign numeric handle can alias an unrelated ordinary reward, so the control asserts
  that it cannot bind or grant the private Trophy rather than claiming global handle uniqueness.
- Far and dead controls use ordinary Move/Release/Attack and require a still-live Trophy before its decoded expiry.
  Fresh post-death resolution redacts the old handle and the normal wire path is silent/no-grant. A separately labeled
  diagnostic retains a pre-death-resolved validated Command, without submitting it, then submits it after real death
  to isolate the native non-standing guard. It is not described as an already queued or socket request.

The coordinator separately sealed actual 62/62 Editor evidence in `79af41a69185047554ffbd32ec1c907c76e65ac3`, on its
composed UI source with approved SessionState alias `f4ba7cfe3a3dc2473e3c642d91b5288de191d343`. Phase B changes no UI.
Final composition also owns the portable restore/clone scratch repair and clock-control correction. They are not
worked around here. No new Editor, Web player, cloud deployment or spend occurred in this lane.
