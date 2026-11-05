# ADR 0010: per-connection snapshot delta (packet P10b)

**Status:** Accepted, implemented (P10c, `ae0c37b`; protocol v3; see the v3 addendum of [ADR 0002](0002-transport-and-protocol.md)
for the shipped layout and the measured result, 908 -> 305 B/player/s). **Context:** ADR 0002's v2 addendum left one item open: a Snapshot delta against the last frame written to a
connection, encoded in that connection's writer task (so a skipped snapshot is never encoded and encoding leaves the room
task), with a full frame on join, resume and resync. It would be protocol v3, a stateful writer, a base-tick reference,
and mirrors in Rust, C# and JS. The packet was gated on numbers; this records them.

**Gate (set by the owner's plan):** adopt only if the delta saves >= 25% of the bytes at 8 players with <= 1.10x
publish Ir, or if the 204-actor case needs it. The measure is `wirebench`'s `bytesPerPlayerPerSec` (payload only, snapshot
plus fx). Transport framing is not part of it and is not used here.

## Method

`crates/rh-server/src/bin/deltabench.rs` (`cargo build --release -p rh-server --features synthetic --bin deltabench`).
It runs the real observation path and prototypes a sensible delta, lossless in every field:

* a base-tick byte (the spec requires it);
* actors: per changed actor a LEB128 id gap, a mask byte and only the changed fields (x, y, facing, kit, hp, bounty;
  status inline);
* departed ids: signalled by a spare bit of the head word, so an empty list costs nothing (it is empty in every frame of
  the 8-player run); a non-empty list costs a count and the id gaps;
* the self block: a 2-byte changed-field mask and only the changed fields (id, x, y, facing, hp, max_hp, kit, ready,
  kills, bounty, gv, move_seq) at their v2 encodings, exact values. A delta of unchanged fields loses nothing, so the
  self block is delta coded like the rest (the client still gets full-precision x, y, facing whenever they change).

The head (tag, tick, ack, head word, count) is the real v2 bytes in both. The v2 side reproduces `wirebench` exactly (859
snapshot bytes per player per second in the 8-player run). The prototype ignores the periodic full frames a resync needs
(join, resume, a missing base: a handful per session, not per second). The synthetic runs use `scalebench`'s disc of
fighters, each re-ordered to move every 16 ticks (almost everything moves, which is unfavourable to a delta), 8 sampled
viewers. Instructions are callgrind counts (`--toggle-collect`) over 600 ticks x 8 viewers.

## Bytes

| case | v2 snapshot B/player/s | delta B/player/s | saved (snapshot) | actors seen (mean / max) |
|---|---|---|---|---|
| 8 players (seed-1, 8 bots) | 859 | 296 | 65.5% | 1.5 / 2 |
| 204 synthetic fighters | 36 601 | 21 933 | 40.1% | 200 / 203 |
| 1000 synthetic fighters | 165 614 | 100 936 | 39.1% | 917 / 996 |

8-player split (B/player/s): head incl. self block 562 (self block 423, 102 as a delta), actor records 298 (55 as a delta).
The whole stream (`wirebench` bytesPerPlayerPerSec, snapshot + fx) is 908 B/s; with the delta it is 345 B/s: **a saving of
563 B/s, 62.0%**, against the 25% line. Without the self-block delta and the free departed flag the same prototype saved 222
B/s (24.4%); the first version of this ADR stopped there, wrongly (it argued the self block could not be delta coded, but
unchanged fields are lossless to omit).

## Cost

Ir per viewer-tick at 8 players (callgrind, 600 ticks x 8 viewers):

* `observe_into` 1424; v2 `encode_snapshot` (head, self, actors) 623, of which the actor records alone (`full_into`) 144.
* Delta actor records (`delta_into`): 169, i.e. +25 over `full_into`.
* Self-block diff (`self_delta_len`, length model; the write adds a little): 85.
* Moving the encode to the writer task and keeping the quantized actors and self in the outbox slot adds about 20 for the
  copy. Total about +130 on the 2047 of observe + encode: **about 1.06x publish Ir**, inside the 1.10x limit. This is
  an estimate from the prototype's functions, not a perfproof A/B of an implementation; the v2 self write that the delta
  replaces is not credited, so it leans high. An implementation needs a real `wire_seed1_8bots` A/B. Total work rises
  slightly; the room task shrinks by the encode and the writer grows by the diff.
* Memory per connection: the remembered actor base is 15 bytes of fields per visible actor (16 with padding): 32 B at 8
  players, 3.2 KB at 204, 16 KB at 1000 (8 KB if capped at MAX_ACTORS = 512), plus the remembered self (about 40 B) and the
  writer's state (base tick, resume flag).
* Complexity: a protocol v3 (breaking), connection state that must be reset on every resume, a full-frame path, a
  base-too-old rule, a malformed-delta class, and three mirrored decoders (Rust, C#, JS) that must keep agreeing.

## The 204-actor case

Read as "the delta alone brings 204 visible actors under the 20 KB/s gate" it does not: 36.6 KB/s in v2 and 21.9 KB/s with
the delta. That reading was chosen deliberately; the rule above does not need it, because the 8-player clause passes. At
1000 fighters a viewer sees 917, which a Snapshot cannot carry anyway (MAX_ACTORS is 512: the encoder refuses rather than
clamp). What bounds those cases is interest management of mobs (nearest-K or distance tiers, lower update rates for far
actors, the 30 s vision trail's own limit): P-MOBS-1 and P-VISION-1. The delta helps there too (about 40%) but does not
replace them.

## Decision

The gate says adopt: 62% of the bytes at 8 players (>= 25%) at about 1.06x publish Ir (<= 1.10x). Adopted: the byte
saving matters for regional egress cost and for browser clients on weak links, and the complexity is contained (TCP
delivers in order, so the base is simply the last snapshot that connection's writer actually wrote; no client ack is
needed). It is implemented as packet P10c; this measurement change does not implement it. Scope of the implementation if scheduled: `PROTOCOL_VERSION` 3; a delta
frame referencing a base tick; full frames on join, resume, resync and when the base is unknown or too old (a resumed
connection always gets a full frame first); bounded per-connection state in the writer task; Rust encoder and decoder, C#
mirror and JS decoder; `protocol/fixtures/v3.json`; tests for resume, full frame, drop, out-of-order and malformed
deltas; browser proof and C# probe; a perfproof `wire_seed1_8bots` A/B.

Repeat: `target/release/deltabench real`, `deltabench synth 204`, `deltabench synth 1000 100`.
