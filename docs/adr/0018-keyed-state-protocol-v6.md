# 0018: Reliable observer collections in protocol 6

Status: **Accepted for the bounded transport implementation**. Native reward/potion producers, live loot admission and Unity HUD remain separate gates.

Protocol 6 implements the reserved State channel as complete, ordered replacements. Keys 1–5 contain self inventory,
visible pickup props/focus, redacted visible fields, reward offers and self build. Missing keys retain their last value;
explicit empty values clear it. Clients decode the whole frame before changing retained state and apply reliable frames
in socket order, independently of a newer coalesced snapshot. Welcome clears the prior observer epoch and pending inputs.

Pickup command 7 retains its nonzero little-endian u32 payload but carries a typed observer-issued handle. Human room
seats now own the same ItemObserver used by policies/headless. Resolve within that seat, recheck visibility, then use
validate/Sim::submit; absent, retired or hidden targets retain the ordinary budgeted refusal path. Reconnect discards
bindings and preserves the next unused handle. There is no raw container-ID fallback.

The room prepares both collection state and handle bindings. One outbox lock accepts State and Events atomically before
FX and snapshot; reliable overflow accepts none of that tick's batch and closes the connection. Only successful enqueue
commits collection baselines and offered handles. Initial/resumed clients receive all five keys. Resync requests refresh
the collections, with forced full replacements spaced by 20 ticks. Continuing unchanged collections cost no State bytes.

Full snapshots append self effects/displacement at bits 11/12 and actor effects/displacement at bits 5/6. Deltas append
self bits 15/16 and actor bits 8/9. Explicit zero clears survive both paths. C# interpolation snaps when the displacement
sequence changes, including short teleports. These are authoritative presentation facts, with no new client rules.

Collections have at most five keys and 512 rows per collection, with exact frame cap 256 KiB, checked flags, handles,
finite geometry and bounded UTF-8 labels. Visible fields preserve multiplicity and contain no global runtime identity.
Before native loot-bearing live matches are admitted, setup must also check the conservative source bound of persistent
props + maximum bodies + all available weapon units. Runtime fail-closed refusal is only a fallback.

At this transport checkpoint reward/build keys carry empty replacements and potion counts are zero because those native
producers are not yet integrated. Choose/Use inputs are not implemented by this checkpoint. It does not close the full
P-NET-ITEMS-1 packet or certify a playable MVP. The existing Unity player must be rebuilt for protocol 6.

Validation: [transport evidence](../evidence/protocol6/INTEGRATION.md), the shared Rust/C#/JS golden vectors and focused
live room pickup/reconnect, reliable backpressure and real Chromium WSS join/resync/reconnect/results checks.
