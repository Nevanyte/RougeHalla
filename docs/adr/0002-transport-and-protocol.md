# ADR 0002: WSS with a versioned binary protocol; no Colyseus compatibility

**Status:** Accepted. **Context:** browsers can only use WebSocket (or WebTransport, not universally available); a Unity
Web build reaches the network through the browser's WebSocket API via a jslib bridge (no `System.Net.Sockets`, no
native UDP/TCP, no threads by default). The legacy wire is Colyseus 0.18 schema patches plus an `fxs` tuple codec, which
synchronises the whole state to every client (no interest management) and is defined by TypeScript decorators-free
schema reflection.

**Decision.**
- Transport: WebSocket binary frames over TLS (`wss://`); one protocol message per frame; TCP's reliability and order.
- Protocol: `rh-protocol` (v2 since the addendum below), hand-written little-endian encoding mirrored byte for byte in C#
  (`client-unity/RoguehallaNet/Protocol`) and pinned by golden vectors (`protocol/fixtures/v2.json`) tested on both sides (and by the JS probe decoder).
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
