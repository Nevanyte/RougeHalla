# ADR 0002: WSS with a versioned binary protocol; no Colyseus compatibility

**Status:** Accepted. **Context:** browsers can only use WebSocket (or WebTransport, not universally available); a Unity
Web build reaches the network through the browser's WebSocket API via a jslib bridge (no `System.Net.Sockets`, no
native UDP/TCP, no threads by default). The legacy wire is Colyseus 0.18 schema patches plus an `fxs` tuple codec, which
synchronises the whole state to every client (no interest management) and is defined by TypeScript decorators-free
schema reflection.

**Decision.**
- Transport: WebSocket binary frames over TLS (`wss://`); one protocol message per frame; TCP's reliability and order.
- Protocol: `rh-protocol` (v4 since the last addendum below), hand-written little-endian encoding mirrored byte for byte in C#
  (`client-unity/RoguehallaNet/Protocol`) and pinned by golden vectors (`protocol/fixtures/v4.json` now; the v1 to v3 history is in the addenda) tested on both sides (and by the JS probe decoder).
- Do **not** reimplement Colyseus. Both ends migrate; the legacy stack keeps its own protocol until it is retired.
- Replication: each client gets its OWN observation every tick (`rh_sim::observe`): itself in full, others only while in
  sight. This is the interest management the legacy Known TODOs asked for, and it is exactly what policies observe.
- Important events (deaths, results, end) are delivered reliably in order; presentation fx are droppable; the snapshot is
  latest-wins for a slow client; a client too far behind on important frames is disconnected and resumes.
- Versioning: `PROTOCOL_VERSION` in Hello/Welcome; the server also checks the client's content hash
  (`rh_sim::content::content_hash`), so a stale client is refused before it can misdecode or mis-predict.
- Limits: client frames ≤ 1 KiB (cut by the WebSocket layer before decoding), ≤ 16 commands per Input, ≤ 60 frames/s
  (burst 120) per connection, ≤ 6 actions per tick and the 30/15 per second order budget in the sim.

**Measured.** Browser→Rust over WSS in Chromium (docs/evidence/browser-proof.json); C# client→Rust
(docs/evidence/csharp-probe.json). Encoding cost and bytes per player: [../MIGRATION.md](../MIGRATION.md) "Benchmarks".
Delta compression is not implemented (see the addendum for what v2 does instead).

## Addendum: protocol v2 (stateless snapshots)

**Status:** Accepted (packet P10a). **Why:** a Snapshot spent 8 bytes on a server time that is always `tick x 50 ms`, and 22
bytes on every remote actor in full f32 precision. v1 had no client in the field yet (P-UNITY-1 not started), so this was
the cheapest moment to change the wire; the server speaks only v2 and refuses a v1 Hello with the existing
`ProtocolMismatch` reject.

**Changes** (layout: `crates/rh-protocol/src/lib.rs` module docs; every other message is as in v1):
- Snapshot drops `server_ms`; decoders derive it as `tick * 50` (Rust `snapshot_server_ms`, C# `Snapshot.ServerMs`, JS
  `serverMs`). The identity is asserted against the simulation by `rh-server` `wire::tests::server_time_is_tick_times_50`.
- Counters (tick, ack, ids, counts, kills, bounty, gv) are canonical LEB128 varints; a non-canonical or overlong varint is
  malformed, so decode then encode is byte-identical.
- Remote actors are quantized: positions u16 at 1/8 world unit (the finest power of two that fits a u16 over the 5120 u
  world; the encoder refuses a position outside 0..8191.875 u rather than clamp, and the server refuses a larger map), facing u16 over 2 pi, hp_pct exact. Error bounds: 0.0625 u and 4.8e-5 rad (`quant.rs`). Each actor
  carries a mask byte so that default values (full hp, no faction or weapon nibble, no bounty) cost nothing; status is
  inline in the mask. Actor ids are sent as gaps (the observation sorts by id, and the wire requires strictly ascending ids).
- The SELF view keeps full precision (prediction and reconciliation need it); a head word carries the phase and a mask of
  the fields that differ from their defaults (hp equal to max_hp, zero kills and so on); max_hp is a varint when integral.
- Fx swings are quantized the same way and use varint ids (hits keep an f32 amount). Events and Welcome are unchanged.
- Observation contents are unchanged (C-OBS, `OBSERVATION_VERSION` unchanged); only their encoding changed.

**Vectors:** `protocol/fixtures/v2.json` replaces `v1.json` (history keeps it). A Snapshot or Fx vector also lists what a
decoder must produce (floats as bit patterns), so the Rust, C# and JS decoders are held to the same quantization;
`malformedServer` lists frames every decoder must reject.

**Measured** (`wirebench --ticks 2400`, seed-1 map, 8 bots, payload bytes only): 1888 -> 908 bytes per player per second
(0.48x), mean Snapshot 89.8 -> 43.0 bytes; at 204 synthetic remote actors with the slice's field mix the per-actor cost falls from 22 to 10.0 bytes (0.456x of v1; with
every optional field set, 11.8 bytes, 0.54x: `cargo run --release -p rh-protocol --example encodebench -- --report --actors 204`).
**Not done (P10b):** a per-connection delta against the last frame written, which needs connection state in the writer task.

## Addendum: protocol v3 (per-connection snapshot deltas)

**Status:** Accepted and implemented (packet P10c; the decision and its numbers are [ADR 0010](0010-snapshot-delta.md)). The server
speaks only v3 and refuses an older Hello with `ProtocolMismatch`; vectors are `protocol/fixtures/v3.json` (v2.json is gone: the
rule is vectors for the current version only).

**What changed** (layout: `crates/rh-protocol/src/lib.rs` module docs and `delta.rs`; every other message is as in v2):
- A connection's snapshots are Full (tag 0x83, the v2 layout byte for byte) or Delta (tag 0x87) against the last snapshot that
  connection's WRITER wrote to the socket. TCP is ordered and reliable, so the base needs no client ack: the client's base is the
  last snapshot it applied. A Delta carries its tick, its age (1 to 64 ticks behind: the base is `tick - age`), the ack, and a head
  word (self present, departed list present, phase, and which of 12 self fields follow); then the changed self fields at their v2
  encodings (exact, bitwise), the changed actors (a mask and only the changed quantized fields; a new actor carries all of them) and
  the departed ids. Everything is lossless: a chain of frames equals the Full frame of the same tick.
- The room no longer encodes snapshots. It hands each connection's outbox the validated wire data of the tick (`SnapshotData`:
  remote actors already quantized, the self at full precision, a lower bound of its Full frame size); the writer encodes when it drains
  (`Outbox::drain_into`), so a snapshot a slow client skips is never encoded, encoding is off the room task, and "latest wins" is
  unchanged. The writer keeps one base per connection (bounded by `MAX_ACTORS`: 16 B per actor plus two scratch lists).
- The writer sends a Full frame for: the first snapshot after a Welcome (so a resumed connection ALWAYS starts Full), a client
  `Resync`, a base more than 64 ticks old (or not older than the new tick), a self that appears or changes id, and a delta that
  would not be smaller than the Full frame.
- Clients (Rust `SnapshotTracker`, C# `SnapshotTracker`, JS `Tracker`) hold the last snapshot applied and REFUSE, never repair or
  clamp, a delta whose base is not the one held, that updates or departs an unknown actor, that lists an actor both ways, that gives
  a new actor without every field, that has a self without a base self, that would pass `MAX_ACTORS`, or that is malformed (a
  reserved or out-of-range field, a bad age, ids that do not strictly ascend, truncation, trailing bytes). A refusal changes
  nothing. The C# `Session` and the JS probe answer a refusal with one client message, `Resync` (tag 0x05, no body), skip deltas
  until a Full frame arrives, and do not disconnect. The server never drops a `Resync`: the writer answers it with a Full frame,
  but at least 20 ticks (1 s) after its previous forced Full, so a request that arrives sooner stays pending and is answered when
  the interval ends (a client asks once per burst of refusals and must be able to rely on that answer). The interval is counted in
  ticks, so it is deterministic; a client that sends one before every snapshot gets one forced Full per 20 ticks, not one per
  request, and the frame-rate bucket bounds the flood itself. As defence in depth the clients repeat a request still unanswered
  after 2 s (with the next refused delta), longer than the server's interval so a well-behaved server never sees a repeat.
  The refusal of a remote actor off the position grid (H-server) happens in `SnapshotData::build`, so it holds for Full frames and
  deltas alike (a Delta carries only grid codes of a built snapshot; the C# `ActorDelta` fields are grid codes by type).
- C-OBS: a Delta names only actors the Full frame of that tick lists, and its departed list only ids the client was told about;
  `tests/snapshot_delta.rs` checks both over a whole match for every viewer.

**Measured** (`wirebench --ticks 2400`, seed-1 map, 8 bots, payload bytes only, every snapshot written): 908 -> 305 bytes per
player per second (66%; the ADR 0010 prototype measured 345). Snapshot frames 43.0 -> 12.8 bytes on average (8 Full, 19,192
Delta). The 2-byte head (self field bits in the head word, the status as a rare byte, no id in the self delta) is where this beats
the prototype's 4 (head word plus a separate 2-byte mask).

**Cost** on top of H-server (`perfproof.py --baseline 2e8682c --only wire_seed1_8bots,headless_seed1_8bots`): wire 25,929 ->
27,178 Ir per step (1.048x), allocations 9.08 -> 9.08 per step, allocated bytes 366 -> 827 per step (each frame reserves room
for a Full frame; see below), headless 0.9999x, every gameplay fingerprint identical (only `bytesPerPlayerPerSec` 908 -> 305 and
`meanSnapshotBytes` 43.0 -> 12.8 change, declared). Before that merge (`--baseline 8e54a25`, deterministic counts): the wire workload (`wirebench`, the sim step
included) goes 25,811 -> 27,282 Ir per step (1.057x) with allocations per step unchanged (9.08) and every gameplay fingerprint
identical (the declared byte counts aside); on the publish path alone (observe plus encode, 2,047 Ir per viewer-tick in ADR 0010)
it is +184 Ir per viewer-tick, about 1.09x. Two things keep it there: a snapshot is validated and quantized once in the room and
its heap block cycles room -> outbox slot -> writer base -> spare -> room (no allocation or copy of the snapshot per tick), and
the writer builds a delta in one pass into the frame it hands to the socket. Memory per connection: the pending slot, the writer's
base and one spare, each a block of about 100 B plus 16 B per visible actor (a few hundred bytes at 8 players; 10.5 KB measured
for the base and spare at `MAX_ACTORS`, the bound is a few tens of KB).

## Addendum: protocol v4 (lock-in)

**Status:** Accepted and implemented (package L-v4; the decision, the rules and the how-to-add-a-field recipe are
[ADR 0011](0011-protocol-v4.md)). The server speaks only v4 and refuses an older Hello with `ProtocolMismatch`; vectors are
`protocol/fixtures/v4.json` (v3.json is gone). In short: every presence mask is a canonical varint with append-only bit numbers
(unknown bits refused); status and phase are ordinary fields with defaults; actors carry a `kind` (0 = player); `State` (0x88) is
reserved for keyed state (empty today); the Hello carries `ticket: bytes` instead of `token: str`; a resumed seat is re-sent its own
`Result`. Measured: 305 -> 285 bytes per player per second at 8 players.
