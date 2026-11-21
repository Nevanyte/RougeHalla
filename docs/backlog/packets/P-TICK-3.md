# P-TICK-3: protocol 21, snapshot time from the rate sent in Welcome

- **Serves:** not in the plan: owner approval 2026-11-19 (ADR 0029); supports ORDER_OF_OPERATIONS phase 3, item 16a
- **Implementer tier:** implementer-opus (wire format, cross-crate: Rust, C#, JS)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 golden vectors (required for a wire change) · D2 n/a · D5/D6 none · D9 unchanged

## 1. ID and outcome
Today a snapshot's server time is `tick * 50` on every side (`crates/rh-protocol/src/lib.rs` `TICK_MS: u32 = 50`,
`snapshot_server_ms`; C# `Wire.TickMs` in `Codec.cs`, `ServerMsg.Snapshot.cs`, `Session.cs`; the JS decoder in
`crates/rh-server/web/probe.html` and `tools/protocol-js`). When this lands the protocol is version 21: server time is
`tick * tick_ms` with `tick_ms = 1000 / Welcome.tick_rate` (Welcome already carries `tick_rate: u8`; only 20 and 40 are
accepted). The delta limits (`delta.rs` `MAX_DELTA_AGE` 64, `MIN_FORCED_FULL_TICKS` 20) are scaled with the rate so
they keep their wall-clock time, and every decoder bounds them the same way. `public_ground.rs`'s literal `tick_rate: 20`
reads the room's rate. The server still sends 20 everywhere until P-TICK-5 and P-TICK-6.

## 2. Dependencies
- The "Cut delay on other players" thread's walk-hint wire change (protocol 19) merges first, agreed 2026-11-19: this
  packet then takes the next free protocol number and rebases onto it. Merged as PR #74 (protocol 19). The coliseum
  thread's heal props (P-COLISEUM-HEALS-2) take protocol 20 first (agreed 2026-11-20); this packet then takes 21 or
  the next free number. P-COLISEUM-HEALS-2 merged as PR #76 (deaf125b, protocol 20): this packet takes **21**.
  Meanwhile the local line's origin sync (P-SYNC-ORIGIN-1, integration 71) had also taken 20, for the walk hint plus
  P-WIRE19-A/B; P-SYNC-ORIGIN-2 merged origin's 20 and 21 with the local 20 as protocol 22.
- P-TICK-1b merged; no other protocol or fixture packet in flight (shared-file rule)

## 3. Relevant legacy paths
- `packages/shared/src/constants.ts:13`: `PATCH_MS = TICK_MS` (one state patch per tick)
- The wire is not legacy (Colyseus patches); the oracle is the three decoders against each other and the v20 vectors.
- Today: `crates/rh-protocol/src/lib.rs:214-224` (`PROTOCOL_VERSION` 20, `TICK_MS` 50, `snapshot_server_ms`),
  `server_msg.rs:277,332-343` (Welcome rate read unchecked; override refused when equal to `tick * 50`),
  `delta/read.rs:142-147`, `delta/tracker.rs:126-140` (Welcome resets, no rate kept),
  C# `ServerMsg.Snapshot.cs:48,52,351`, `SnapshotTracker.cs:58-72`, `Session.cs:372-460,659`,
  JS `probe.html:262,692,718,761,791,1319-1324`.

## 4. New paths
- `protocol/fixtures/v21.json` (by `cargo run -p rh-protocol --bin protocol-fixtures`), with snapshots at both rates

## 5. Exclusive write scope
- `crates/rh-protocol/src/**` (`PROTOCOL_VERSION`, `TICK_MS`, `snapshot_server_ms`, `delta.rs` and `delta/`),
  `crates/rh-protocol/tests/**`, the fixtures binary
- `crates/rh-server/src/wire/**`, `crates/rh-server/src/outbox.rs`, `crates/rh-server/src/public_ground.rs`,
  `crates/rh-server/web/probe.html`
- `crates/rh-policy/src/delivery/collections.rs` (the forced-full rule only)
- `client-unity/RoguehallaNet/Protocol/**`, `client-unity/RoguehallaNet/Net/Session.cs` (the two `Wire.TickMs` uses),
  then `bash client-unity/sync-net.sh`
- `tools/protocol-js/**`, protocol-version pins in `tools/unity-browser-reload-proof` and `client-unity/UnityProject/Tools`
- `protocol/fixtures/v21.json`
- Existing tests that pin protocol 20: owner approval per the v17 precedent (P-WIRE17-MAP-1); the coordinator asks
  before dispatch.

## 6. Contracts and references
- C-NET and the AGENTS.md wire rule (bump, regenerate, three decoders, one branch); ADR 0010 (snapshot delta), ADR 0029

## 7. Behaviour to preserve
- At `tick_rate` 20 every frame's bytes equal protocol 20's except the version field; the v20 fixture stays as history.
- Content hash unchanged (the rate is a room setting, not content).

## 8. Acceptance checks
- `scripts/gate.sh --quick --regen-fixtures --oracle packet/P-TICK-3` passes; the coordinator runs the full gate.
- `v21.json` vectors at 20 and 40 decode to the same server times in Rust, C# and JS; a Welcome with `tick_rate` 30 is
  refused by all three.

## Oracle files (read-only for implementers)
- `crates/rh-protocol/tests/tick_rate_wire.rs` (Rust; red on the stub, 10 tests)
- `client-unity/RoguehallaNet.Tests/TickRateProtocolTests.cs` (C#; not run by the oracle author: no dotnet on that host)
- `tools/protocol-js/check-tick-rate.mjs` (JS; `node tools/protocol-js/check-tick-rate.mjs`, 7 of 8 checks red on the stub)
- `docs/backlog/packets/P-TICK-3.md` (this brief)

Stub files (the implementer replaces their bodies): `crates/rh-protocol/src/lib.rs` (`tick_ms_for_rate`,
`snapshot_server_ms_at`), `crates/rh-protocol/src/server_msg.rs` (`ServerMsg::decode_at`),
`crates/rh-protocol/src/delta/tracker.rs` (`TrackError::NoWelcome`, `SnapshotTracker::awaiting_welcome`),
`client-unity/RoguehallaNet/Protocol/ServerMsg.cs` (`Decode(frame, length, reuse, tickRate)`) and its synced Unity copy.

### The API the oracle pins (all three decoders)
| | Rust | C# | JS (probe.html codec block) |
|---|---|---|---|
| tick ms of a rate | `tick_ms_for_rate(u8) -> Option<u32>`: 20 -> 50, 40 -> 25, else `None`; `snapshot_server_ms_at(tick, tick_ms)` | (internal) | (internal) |
| stateless decode at a rate | `ServerMsg::decode_at(frame, tick_rate)`; `decode(frame)` is the 20 Hz decode | `ServerMsg.Decode(frame, length, reuse, tickRate)`; the rate-less overloads are 20 Hz | `decode(buf, tickRate)`; `decode(buf)` is 20 Hz |
| bad rate | Welcome with `tick_rate` not 20/40, or `decode_at` at such a rate: `DecodeError::BadField("tick rate")` | `DecodeException` | throws, message matches `/tick rate/` |
| tracker | `SnapshotTracker::new()` reads at 20 until a Welcome, then at the latest accepted Welcome's rate; a refused Welcome changes nothing | `SnapshotTracker` the same | `Tracker` the same |
| snapshot before Welcome | `SnapshotTracker::awaiting_welcome()`: `TrackError::NoWelcome` until a Welcome is accepted | `Session` ignores it (today's behaviour, kept) | `new Tracker({ awaitWelcome: true })` throws, message matches `/welcome/i` |
| override equal to the rate's default | refused at that rate (`BadField("server time")`) | encoder omits it at the snapshot's rate (decoder lenient, as today) | lenient, as today |

### v21.json contract
- Every section but `"serverTickRate40"` is v20.json with the version substituted (header, `011400` -> `011500`,
  `811400` -> `811500`, debug `protocol: 20,` -> `protocol: 21,`); trailing commas and the `"format"` line may move.
- `"serverTickRate40"`: one entry per line, `{"name", "hex", "decoded": {"tick", "serverMs", ...}}`, at least three Full
  (`0x83`) snapshots, at least two with the default time (no override on the wire, so the same bytes read `tick * 50` at
  20), `decoded.serverMs` = what the frame decodes to at 40. A new top-level section so the existing `server` iterators in
  C# `ProtocolVectorTests` and `check-vectors.mjs` stay at 20 Hz.

### Red on the stub, and why
- Rust `tick_rate_wire`: `the_wire_speaks_protocol_21` (20 != 21); `tick_ms_is_1000_over_the_rate_for_20_and_40_only`
  (stub returns 50 for 40); `the_same_full_snapshot_bytes...`, `a_delta_without_override...`,
  `a_tracker_reads_snapshots_at_its_latest_welcomes_rate` (time is `tick * 50` at 40); `an_override_..._is_refused`
  (500 at tick 20 decodes at 40); `a_welcome_at_30_is_refused...` (decodes); `a_snapshot_before_the_welcome_is_refused`
  (accepted); both `v21_*` (fixture missing).
- C# `TickRateProtocolTests`: `CodecSpeaksProtocol21`, `TheSameSnapshotBytes...`, `AWelcomeAt30...`, `ATrackerReads...`,
  `ASessionIgnores...` (the 30 Hz Welcome starts the match), `V21FortyHertzVectors...` (file missing).
  `ADecoded40HzSnapshotReencodesToItsOwnBytes` is green on the stub: it guards the section 11 trap.
- JS `check-tick-rate.mjs`: 7 of 8 red (protocol, both rate decodes, Welcome 30, both trackers, v21 missing); the override
  check is a green guard.

### Existing tests this packet must change (owner approval; listed, not edited)
Protocol-20 pins (move to 21):
- `crates/rh-protocol/tests/envelope.rs:34`, `frost_wall_wire.rs:132`, `map_public.rs:330` (`assert_eq!(PROTOCOL_VERSION, 20)`)
- `crates/rh-protocol/tests/heal_prop_wire.rs:74` (`PROTOCOL_VERSION, 20`)
- `crates/rh-protocol/tests/map_dressing.rs:553-563` (Welcome vector digests `WELCOME_DIGEST`, `SHIPPED_DIGEST`,
  `ALL_DIGEST`, `GROUND_BOTH_DIGEST`: the version bytes move)
- `crates/rh-server/src/wire/tests/frames.rs:48`, `crates/rh-server/tests/ending_metadata.rs:50`,
  `crates/rh-server/tests/walk_hint_wire.rs:249`, `crates/rh-server/tests/protocol_18_stamp.rs:109,128`
- `client-unity/RoguehallaNet.Tests/Protocol18StampTests.cs:14,40-52`, `HealPropProtocolTests.cs:38`
- `tools/unity-browser-reload-proof/protocol-18-stamp.test.mjs` (v20.json, marker `protocol v20`),
  `heal-prop-probe.test.mjs:30-32`, `normal-companion.test.mjs:6,13,58,142`, `check.test.mjs:239-240`, and the
  non-test `normal-companion.mjs:22-27`, `wire-metadata.js` (v20 parser comments)
- `crates/rh-server/web/probe.html:18,25` (the `protocol v20` marker every JS check finds the codec by)
C# tests that decode or deliver a Welcome with `TickRate` 0 (the field's default), which a 20/40-only rule refuses:
- `ProtocolVectorTests.cs:386-388` and `:1349-1350` (decode), `:382` (encode; its expected ArgumentException message
  changes if the encoder checks the rate first), `HudContentProtocolTests.cs:58` via `:110-112` (decode),
  `OwnedSeatCheckpointTests.cs:103,118` (a Session must reach InMatch; `Session.cs:659` maps 0 to 50 ms today).
  The edit is `TickRate = 20` in each initializer.

### Corrections to the brief
- Section 11, "keep refusing that order": only the C# `Session` refuses (ignores) a snapshot before its Welcome today.
  The Rust and JS trackers accept a Full snapshot with no Welcome: every `vNN.json` chain and about 100 Rust tests start
  that way. The oracle keeps that (20 Hz before any Welcome) and adds an opt-in awaiting mode in Rust and JS. This
  conflicts with ADR 0029 item 5 "no decoder assumes 50" for the pre-Welcome case only.
- Section 11, the bit-pattern trap: C# and JS decoders never refused an override equal to the default (only Rust does);
  the oracle pins Rust's refusal at the connection's rate and the C# encoder's omission, and leaves C#/JS lenient.
- Section 5: `crates/rh-server/src/wire/**` does not cover `crates/rh-server/src/wire.rs` (where `profile_supported`
  lives); `crates/rh-server/src/room.rs:667` also sends `rh_sim::constants::TICK_RATE as u8` and is outside the scope.
  Carried note: `profile_supported` (`wire.rs:109`) does not look at `SimConfig::tick_ms` (`rh-sim/src/statics.rs:300`),
  so a 25 ms sim would be announced as 20 Hz. Not pinned by this oracle.
- `scripts/gate.sh` (`jsvectors`, lines 66-72) does not run `tools/protocol-js/check-tick-rate.mjs`; proposed owner edit:
  add `run "JS tick-rate checks" node tools/protocol-js/check-tick-rate.mjs`. Until then run it by hand.
- Not pinned: the delta limits scaled with the rate (`MAX_DELTA_AGE`, `MIN_FORCED_FULL_TICKS`; JS `age > 64` at
  `probe.html:756`), the fixtures binary's 40 Hz encoder path, `Session.cs:518,570,587` shifts.

## 9. Validation commands
- `cargo run -p rh-protocol --bin protocol-fixtures`, `cargo test -p rh-protocol`, `dotnet test
  client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`, the JS checks in `tools/protocol-js`

## 10. Risk and suggested model tier
High: wire format across three languages. Opus.

## 11. Known traps
- `ServerMsg.Snapshot.cs` compares an override against `Tick * Wire.TickMs` by bit pattern; the comparison must use the
  session's rate or every 40 Hz snapshot looks overridden.
- A decoder that sees a snapshot before Welcome has no rate: keep refusing that order.

## Carried from the P-TICK-1a review
- `crates/rh-server/src/wire.rs` `profile_supported` does not refuse `tick_ms != 50`; refuse it there or pace the room
  from the setting (with P-TICK-5).

## Notes from previous attempts

## Coordinator amendments (2026-11-20, after the oracle)
- Version pins: the owner accepted ADR 0029 decision 5 (a protocol bump) and approved pushing and merging this work
  (2026-11-19). The coordinator reads that as covering the mechanical edits that every bump needs: the protocol 20 pins
  the oracle author listed (Rust, C#, JS, `probe.html` marker), and `TickRate = 20` in the C# tests that build a Welcome
  with rate 0 (`ProtocolVectorTests.cs`, `HudContentProtocolTests.cs`, `OwnedSeatCheckpointTests.cs`). Change only the
  version or rate value in each; list every one in the hand-off.
- Write scope adds `crates/rh-server/src/wire.rs` for one change: `profile_supported` refuses a sim whose `tick_ms` is
  not 50 (P-TICK-5 lifts it when the room paces and announces the rate). `room.rs` stays with P-TICK-5.
- `scripts/gate.sh` is owner-protected: do not edit it. Make the gate run `check-tick-rate.mjs` by calling it from a JS
  check the gate already runs under `tools/protocol-js/` (inside the write scope), and say which in the hand-off.
- Snapshot-before-Welcome as an opt-in refusal in Rust and JS (correction 1) and the override leniency in C#/JS
  (correction 2) are accepted.
