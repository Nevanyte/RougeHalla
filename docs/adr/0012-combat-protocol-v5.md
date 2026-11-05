# ADR 0012: protocol v5, weapon inputs and observed combat effects

**Status:** Accepted, implemented for P-COMBAT-1 / P-NET-3. Protocol v5 extends the v4 layout of ADR 0011.

## Decision

The weapon port needs two input tags, two disposable effect tags, an owner-only refusal event, and the passive marker on a
hit. The added Hit byte changes an existing record, so clients and servers use `PROTOCOL_VERSION = 5`; v4 frames are never
reinterpreted as v5. This is the combat integration bump, independent of the deferred P-NET-7 unchanged-snapshot proposal.
Full/Delta masks, writer baselines, resync, State, admission and resume behavior retain ADR 0011's layout and semantics.

The cross-version envelope remains frozen: Hello bytes `[0,3)` are tag 0x01 followed by the little-endian u16 version;
the server examines that prefix before decoding the rest. The entire Reject frame remains tag 0x82, u16 code, u8-length
UTF-8 reason. Unknown nonzero Reject codes preserve their raw value and reason in every decoder; zero is refused.

Input command tags are append-only. Existing tags 1..5 retain their meaning. Tag 6 is `Swap`: a strict 0/1 presence flag,
then a slot byte when present. Absent toggles; present 0 or 1 chooses a slot; other slots and flags are malformed. Tag 7 is
`Pickup`: a little-endian u32 container ID; zero is malformed. These are ordinary Input commands under the existing frame
limit, reader rate limits, simulation validation and action-order budget. The client makes no inventory, range or outcome
decisions. The server maps them to `RawCommand` and submits through the existing input path.

Fx tag 2 (`Hit`) appends a strict 0/1 `passive` byte after victim varint, source varint and amount f32. The bit survives every
codec. New Fx tag 3 (`Block`) carries affected actor ID varint, source ID varint, weapon byte. New Fx tag 4 (`Stagger`) carries
affected actor ID varint. These retain the disposable Fx channel. For Hit and Block, source `u32::MAX` denotes no source or a
source redacted by observation; it never identifies a hidden actor. Encoders preserve that sentinel.

Events tag 5 is `PickupRefused`: one reason byte, no recipient or container ID. Observation has already filtered it to the
owner. It uses the reliable Important channel. Its reason codes are append-only and never reused:

| Code | Simulation refusal |
|---|---|
| 1 | Blocked |
| 2 | NothingThere |
| 3 | TooFar |
| 4 | Unreachable |
| 5 | NothingToTake |

Zero and unknown refusal reasons are malformed in v5; adding a reason requires the normal version gate and all codec
updates. This strict gameplay record is separate from the frozen cross-version Reject envelope's unknown-code rule.
All server decoders reject frames larger than 256 KiB before parsing or allocating records. Events and Fx encoders check
their count and complete byte length before allocating a frame; exactly 256 KiB is valid. UTF-8 decoding preserves a
leading U+FEFF in a string, including an unknown Reject reason. A browser rejects a mismatched Welcome before decoding its
map or resetting the snapshot baseline, closes the connection, and ignores further queued frames on that connection.

Presentation may map the reasons to text; private actor IDs and the simulation's message text are not payload fields.

## Validation contract

Only the current golden file, `protocol/fixtures/v5.json`, is retained. It covers all old commands plus toggle and both
explicit slots, pickup, both passive states, sourced and redacted Block/Hit, Stagger and all five owner refusals. Invalid
slots, IDs, flags and refusal reasons are exercised alongside the previous malformed, truncation and delta-chain vectors.
Rust, C# and the marked JavaScript probe codec consume those vectors; the JS check also decodes client frames and checks
Input encodings, the exact maximum frame and its one-byte overflow, and a BOM-bearing unknown Reject reason. The C#
InputSender exposes ordered Swap/Pickup intents alongside the existing commands and preserves the 16-command frame limit.
C# sources are copied with `client-unity/sync-net.sh`, preserving Unity metadata. The browser proof asserts
protocol 5 explicitly. Tests retain v4 and future-version Hello-prefix cases and unknown Reject preservation.
