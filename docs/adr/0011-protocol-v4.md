# ADR 0011: protocol v4, the lock-in bump (append-only masks, actor kind, State channel, admission ticket)

**Status:** Accepted, implemented (package L-v4; protocol v4). **Context:** the lock-in review of the wire found that wire bytes
are not part of any durable data (replays record sim inputs; the web client reloads), so layout decisions stay cheap to change
as long as a stale client always gets a decodable "please reload" (done in L-envelope: the Hello version prefix is read before the
rest is decoded). What is NOT cheap is the bulk port arriving at the v3 layout: every presence mask was full (the delta head used
16 of 16 bits, the actor-delta mask 8 of 8), the legacy `MobState` and `PlayerState` show some 20 more fields coming, and each
mechanic packet would have queued on the same bits in three decoders (Rust, C#, JS) and the golden vectors. This ADR makes the one
planned break that removes that queue, before any wave-1 packet touches the wire and before P-UNITY-1 writes gameplay against the
raw wire structs. It builds on [ADR 0002](0002-transport-and-protocol.md) and [ADR 0010](0010-snapshot-delta.md); the layout is
`crates/rh-protocol/src/lib.rs` (module docs) and `delta.rs`.

## Decision

**1. Presence masks are canonical LEB128 varints with append-only bit numbers.** The Full head, the Full actor mask, the Delta head
and the actor-delta mask are all varints: a mask whose set bits are below bit 7 is one byte, so the common frame pays nothing for
the room to grow. Rules:

- A bit number is never renumbered, reused or repurposed. Adding a field is a new top bit plus its codec arm in the three decoders,
  the writer, the tracker's apply code, the vectors, and a protocol bump (the version gate below).
- Decoders stay strict per version: a mask with a bit the version does not define is refused (`BadField`), never skipped. Nothing
  becomes skippable, so a frame is either exactly understood or refused.
- The common case is placed in the one-byte region: the Delta head puts present, x, y, facing, move_seq, hp and ready_in_ms
  in bits 0..6; the actor-delta mask puts x, y, facing, kit, hp, bounty and status there. Bits for rarely changing fields
  (kills, bounty, gv, status, max_hp) and for the departed list and the phase take a second byte when set.
- Lifecycle status and match phase leave the masks (they were 2-bit codes packed into spare bits) and become ordinary fields with
  defaults: a clear bit means alive (status 1) and active (phase 1). A Delta carries the phase only when it differs from the base's;
  a new actor in a Delta starts from the default actor and must carry its position, plus whatever differs from the defaults.
- Defaults are protocol constants (`DEFAULT_STATUS`, `DEFAULT_PHASE`, hp 100%, kit 0, bounty 0, kind 0).

**2. Actor kind and the id namespace.** `WireActor` carries a `kind` (0 = player, the default, omitted at no cost; Full actor mask bit
4, actor-delta bit 7). A wire actor id names one entity for the whole match, across every kind of entity, and is never reused within
a match: the observation, the events (`Death.by`, `Hit.by`) and the trackers all key on it. The sim may keep typed ids; the mapping to
the wire is `crates/rh-server/src/wire.rs`. A packet that adds mobs allocates their ids either from the same monotonic counter as
players or from a disjoint range that `wire.rs` maps; two kinds must never share an id, or `by` becomes ambiguous.

**3. A reserved keyed-state channel, and the Result survives a resume.** There are three channels: Snapshot (per-tick scalars, a
lossless chain), Events (reliable, one-shot announcements) and Fx (droppable). Collections and match-level state (cards, inventory,
gates, coliseum timers) fit none of them, and an event is lost across a resume. v4 reserves `State` (server tag 0x88): `tick varint,
count varint, then [key varint][record]` per item, the latest value per key, keys strict per version. v4 defines no key, so every
decoder accepts exactly the empty State (the Rust type has no value for an item), and a Welcome (join and resume) will be followed by a
full State once keys exist, which makes a resumed or recovered client independent of any event it missed. The server sends no State
today. The one gap that exists today is fixed now: the player's own `Result` is kept on its seat and re-sent after the Welcome of a
resume, so a client that was away when its run resolved (the reconnect grace, or a TooSlow close that dropped its queued frames) still
receives it. `MatchEnded` is public state a rejoining client derives from the phase.

**4. Admission ticket in the Hello.** `token: str` becomes `ticket: bytes` (`u16` length, at most `MAX_TICKET` = 448 bytes), and
`profile` stays the requested display name. The largest legal Hello (every field at its maximum) is 992 bytes, under the 1 KiB
`MAX_CLIENT_FRAME` (a test holds it). The admission order is unchanged: the ticket is checked where the credentials were checked
before (after the protocol and content-hash checks, before a seat is reserved). What the ticket contains is defined by P-HOST-1 (a
GameLift player-session id the control plane pre-authorised, or a signed join token); without a hosting layer it is the callsign's
secret as UTF-8 bytes, which is what the static auth file and the Postgres credentials store check.

## Consequences

- **Bytes.** `wirebench` (seed-1 map, 8 bots, 2400 ticks, payload only): 305 -> 285 bytes per player per second (bound set for this
  package: at most 320). The Delta head of a quiet or moving player is one byte (v3: two), which pays for the occasional second byte.
  A Full frame costs a little more for a non-alive actor or a non-active phase (a head bit past bit 7 and one byte).
- **Cost.** `perfproof.py --baseline 8f697a3 --only wire_seed1_8bots,headless_seed1_8bots`: the wire workload goes 25,408 -> 25,512 Ir
  per step (1.0041x) with allocations unchanged (9.08 per step) and allocated bytes 107 -> 99; the headless workload is unchanged
  (7,183 Ir per tick, 1.0000x). Every gameplay fingerprint is identical (`outcomeDigest`, the state-hash fold); only the declared byte
  counts change (`bytesPerPlayerPerSec` 305 -> 285, `meanSnapshotBytes` 12.8 -> 11.8).
- **Version gate.** Everything above is incompatible with v3, so `PROTOCOL_VERSION` is 4: a v3 client gets `ProtocolMismatch` from
  the envelope check. The vectors are `protocol/fixtures/v4.json` (v3.json is gone: vectors for the current version only), held by
  the Rust, C# and JS decoders.
- **How to add a field after v4** (the rule this ADR exists to make cheap): take the next free top bit of the right mask; add the
  field to `WireSelf`/`WireActor`/`SelfDelta`/`ActorDelta` (or its `QActor`/`SnapshotData` form), the writers, the Full and Delta
  readers, the tracker, the C# and JS mirrors and a vector; choose a default so that an unset bit costs nothing; bump
  `PROTOCOL_VERSION`; regenerate the vectors. Bits are never moved to make the layout tidier.
- **Not done.** No State key, no mob kind and no change to what the observation shows. The sim does not import `rh_protocol`, and
  nothing durable (replays, results, persistence) depends on these bytes.
