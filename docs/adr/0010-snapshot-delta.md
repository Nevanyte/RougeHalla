# ADR 0010: per-connection snapshot delta (packet P10b)

**Status:** Not adopted (measured; the protocol stays v2). **Context:** ADR 0002's v2 addendum left one item open: a
Snapshot delta against the last frame written to a connection, encoded in that connection's writer task (so a skipped
snapshot is never encoded and encoding leaves the room task), with a full frame on join, resume and resync. It would
be protocol v3, a stateful writer, a base-tick reference, and mirrors in Rust, C# and JS. The packet was gated on
numbers; this records them.

**Gate (set by the owner's plan):** adopt only if the delta saves >= 25% of the bytes at 8 players with <= 1.10x
publish Ir, or if the 204-actor case needs it.

## Method

`crates/rh-server/src/bin/deltabench.rs` (`cargo build --release -p rh-server --features synthetic --bin deltabench`).
It runs the real observation path and prototypes the cheapest sensible delta: a base-tick byte, per changed actor a LEB128
id gap, a mask byte and only the changed fields (x, y, facing, kit, hp, bounty; status inline), then a departed-id list.
The head and the self block (full precision for prediction, so never delta coded) are the real v2 bytes, identical in
both. Only changed actors are listed, so the prototype is the best case for a delta: it ignores the periodic full frames a
resync needs. The v2 side of the 8-player run reproduces `wirebench` exactly (859 snapshot bytes per player per second).
The synthetic runs use `scalebench`'s disc of fighters, every one re-ordered to move every 16 ticks (almost everything moves, so this is
unfavourable to a delta, which saves on what stays still), 8 sampled viewers.
Instructions are callgrind counts (`--toggle-collect`) over 600 ticks x 8 viewers.

## Bytes

| case | v2 snapshot B/player/s | delta B/player/s | saved | actors seen (mean / max) |
|---|---|---|---|---|
| 8 players (seed-1, 8 bots) | 859 | 637 | 25.9% of the snapshot stream | 1.5 / 2 |
| 204 synthetic fighters | 36 601 | 22 174 | 39.4% | 200 / 203 |
| 1000 synthetic fighters | 165 614 | 101 164 | 38.9% | 917 / 996 |

At 8 players the whole stream (`wirebench` bytesPerPlayerPerSec, snapshot + fx) is 908 B/s, so the delta saves 222 B/s,
which is **24.4%**: just under the 25% line, and that is the prototype's best case. Counting the transport the frames ride
in (WebSocket header, TLS record and TCP/IP per frame, roughly 70 to 80 bytes at 23 frames a second: an estimate, not
measured) the saving is about 10% of what crosses the wire. Absolute: 222 B/s per player against legacy's 11 to 15 KB/s
and a 20 KB/s gate.

## Cost

* Ir per viewer-tick (8 players): `observe_into` 1424, v2 `encode_snapshot` (head, self, actors) 623, the actor records
  alone 144 (`full_into`), the delta diff and records 176 (`delta_into`). Moving the encode to the writer task and storing
  quantized actors in the outbox slot adds about 32 Ir for the diff and about 20 for the slot copy: roughly +55 on
  2047 (observe + encode), **about 1.03x publish Ir**, inside the 1.10x limit. The room task would shrink by the encode
  and the writer would grow by the diff; total work rises slightly, it does not fall.
* Memory per connection: the remembered base is 14 bytes per visible actor (16 with padding): 32 B at 8 players, 3.2 KB at
  204, 16 KB at 1000 (8 KB if capped at MAX_ACTORS = 512), plus the writer's own state machine (base tick, resume flag).
* Complexity: a protocol v3 (breaking), connection state that must be reset on every resume, a full-frame path, a
  base-too-old rule, a malformed-delta class, and three mirrored decoders (Rust, C#, JS) that must keep agreeing.

## The 204-actor case

It does not need the delta, because the delta does not solve it. At 204 visible fighters the stream is 36.6 KB/s in v2 and
still 22.2 KB/s with the delta, above the 20 KB/s gate. At 1000 fighters a viewer would see 917, which a Snapshot cannot
carry anyway (MAX_ACTORS is 512: the encoder refuses, by design, rather than clamp). What bounds those cases is
interest management of mobs (a nearest-K or distance-tiered observation, lower update rates for far actors, the 30 s
vision trail's own limit), which belongs to the mob packets (P-MOBS-1, P-VISION-1) and changes what the observation
contains, not how it is encoded. A delta can be added later on top of that (a v3) if the bytes ever matter.

## Decision

Not adopted: it misses the 8-player threshold on the headline measure (24.4% against 25%, best case, before transport
overhead), it does not bring the 204-actor case under the gate, and it spends a breaking protocol revision, a stateful
writer and three decoders on 222 B/s per player. The Ir cost (about 1.03x) is not the obstacle. Revisit when mob
observations are bounded: re-run `deltabench` with the real mob mix (idle mobs change less than the synthetic crowd).
Repeat: `target/release/deltabench real`, `deltabench synth 204`, `deltabench synth 1000 100`.
