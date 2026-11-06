# Architecture decision records

Short records of consequential decisions. **Decision status** (accepted / provisional / superseded) is separate from
**validation status**, which lives in [../CONTRACTS.md](../CONTRACTS.md) and [../MIGRATION.md](../MIGRATION.md). A
provisional decision is the working default until the named experiment confirms or replaces it.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-architecture.md) | Rust workspace of a few owned crates; thin adapters; legacy kept runnable beside it | Accepted |
| [0002](0002-transport-and-protocol.md) | WSS binary protocol (no Colyseus compatibility); interest-managed, quantized snapshots; v4 (append-only varint masks over v3's per-connection deltas) is the shipped wire | Accepted |
| [0003](0003-canonical-map.md) | The server sends the map's collision layer; clients never generate maps | Accepted |
| [0004](0004-hosting.md) | GameLift managed containers + queues first, SDK bridge out of process, own TLS + DNS | Provisional |
| [0005](0005-policy-seam.md) | One seat contract for humans, scripted bots and future learned policies; contract v2 (`reset(&MatchStart)`) since L-sim | Accepted |
| [0006](0006-persistence.md) | PostgreSQL with fenced session leases and idempotent results | Accepted |
| [0007](0007-determinism.md) | Determinism scope, numeric policy, RNG streams, replays; P8 addendum: derived state hash (server-private), `rh-replay/2`, layout rule, lints | Accepted |
| [0008](0008-unity-client.md) | Unity 6 LTS Web client; engine-independent C# net library; narrow prediction | Provisional |
| [0009](0009-core-layout.md) | `rh-sim` core layout; the tick schedule, hook chains and input seam as data that a test compares with legacy | Accepted |
| [0010](0010-snapshot-delta.md) | Per-connection snapshot delta: gate passed (62% of bytes at 8 players, about 1.06x publish Ir by estimate), adopted and shipped as protocol v3 (packet P10c): 908 -> 305 B/player/s at 8 players, wire Ir 1.048x. Protocol v4 ([0011](0011-protocol-v4.md)) superseded the v3 framing but kept this delta design | Accepted, implemented (P10c, `ae0c37b`) |
| [0011](0011-protocol-v4.md) | Protocol v4, the lock-in bump: append-only varint field masks, actor kind and a shared id namespace, a reserved keyed-State channel with the Result kept across a resume, an admission ticket in the Hello | Accepted, implemented (L-v4) |
| [0012](0012-combat-protocol-v5.md) | Protocol v5: weapon inputs and observed combat effects, exact frame bounds, frozen rejection envelope and source redaction | Accepted, implemented (Stage 2 combat transport) |
| [0013](0013-temporal-damage-projection.md) | Settled per-contribution damage eligibility and retained Rust public projection, independent of delivery cadence | Accepted, implemented and independently reviewed (bounded Plague slice) |
| [0014](0014-sentenced-public-state.md) | Current-survivor Mark fields, eligible-before-numeric owner identity and fail-closed projector sessions | Accepted, implemented and independently reviewed (bounded base Sentenced) |
| [0015](0015-landmark-recipes.md) | Actual five-faction landmark recipes, ordered shared state and exact stage admission | Accepted, implemented and independently reviewed (stage four; full generator/pins remain open) |
| [0016](0016-map-finalization.md) | Canonical records, exact ECMAScript legacy map identity and ordered terrain acceptance | Accepted, implemented and independently reviewed (finalization leaves; full generator/certifier/pins remain open) |
| [0017](0017-visible-status-fields.md) | Visible status fields as redacted snapshot facts without shared runtime IDs | Provisional; private implementation and integrated privacy/version checks pending |
| [0018](0018-keyed-state-protocol-v6.md) | Reliable observer collections, staged enqueue and status/displacement scalars in protocol6 | Accepted; selected MVP producers/HUD integrated under ADR0019; broader content remains |
| [0019](0019-first-playable-runtime.md) | Selected first-playable runtime, private constructor provenance and public NPC/projectile facts | Accepted for the staging milestone; full-port validation remains open |
