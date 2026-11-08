# Trophy protocol 13 — Phase A

Private codec/client prefix from `8e3d7268e7026e2a95d201bd8e639a4f65e24e21`, under the lead's
`P-TROPHY-WIRE13` packet. This is not production Trophy publication or a grant proof.

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

Normal-wire credited kill → Trophy birth → reliable offer → decoded owner row → ordinary Choose → actual grant
remains BLOCKED by the deliberate production omission until Phase B release. No simulated omitted branch is called
a production proof. One matched protocol-13 Web build follows final composition; no stale protocol-12 build is made.
