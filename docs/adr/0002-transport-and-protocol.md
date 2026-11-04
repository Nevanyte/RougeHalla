# ADR 0002: WSS with a versioned binary protocol; no Colyseus compatibility

**Status:** Accepted. **Context:** browsers can only use WebSocket (or WebTransport, not universally available); a Unity
Web build reaches the network through the browser's WebSocket API via a jslib bridge (no `System.Net.Sockets`, no
native UDP/TCP, no threads by default). The legacy wire is Colyseus 0.18 schema patches plus an `fxs` tuple codec, which
synchronises the whole state to every client (no interest management) and is defined by TypeScript decorators-free
schema reflection.

**Decision.**
- Transport: WebSocket binary frames over TLS (`wss://`); one protocol message per frame; TCP's reliability and order.
- Protocol: `rh-protocol` v1, hand-written little-endian encoding mirrored byte for byte in C#
  (`client-unity/RoguehallaNet/Protocol`) and pinned by golden vectors (`protocol/fixtures/v1.json`) tested on both sides.
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
Delta compression is not implemented: measure before adding it (snapshot sizes are small in the slice).
