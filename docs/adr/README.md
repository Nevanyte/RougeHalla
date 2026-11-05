# Architecture decision records

Short records of consequential decisions. **Decision status** (accepted / provisional / superseded) is separate from
**validation status**, which lives in [../CONTRACTS.md](../CONTRACTS.md) and [../MIGRATION.md](../MIGRATION.md). A
provisional decision is the working default until the named experiment confirms or replaces it.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-architecture.md) | Rust workspace of a few owned crates; thin adapters; legacy kept runnable beside it | Accepted |
| [0002](0002-transport-and-protocol.md) | WSS binary protocol (no Colyseus compatibility); interest-managed, quantized snapshots; v3 (per-connection deltas) is the shipped wire | Accepted |
| [0003](0003-canonical-map.md) | The server sends the map's collision layer; clients never generate maps | Accepted |
| [0004](0004-hosting.md) | GameLift managed containers + queues first, SDK bridge out of process, own TLS + DNS | Provisional |
| [0005](0005-policy-seam.md) | One seat contract for humans, scripted bots and future learned policies | Accepted |
| [0006](0006-persistence.md) | PostgreSQL with fenced session leases and idempotent results | Accepted |
| [0007](0007-determinism.md) | Determinism scope, numeric policy, RNG streams, replays; P8 addendum: derived state hash (server-private), `rh-replay/2`, layout rule, lints | Accepted |
| [0008](0008-unity-client.md) | Unity 6 LTS Web client; engine-independent C# net library; narrow prediction | Provisional |
| [0009](0009-core-layout.md) | `rh-sim` core layout; the tick schedule, hook chains and input seam as data that a test compares with legacy | Accepted |
| [0010](0010-snapshot-delta.md) | Per-connection snapshot delta: gate passed (62% of bytes at 8 players, about 1.06x publish Ir by estimate), adopted and shipped as protocol v3 (packet P10c): 908 -> 305 B/player/s at 8 players, wire Ir 1.048x | Accepted, implemented (P10c, `ae0c37b`) |
