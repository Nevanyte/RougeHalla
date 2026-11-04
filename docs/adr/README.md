# Architecture decision records

Short records of consequential decisions. **Decision status** (accepted / provisional / superseded) is separate from
**validation status**, which lives in [../CONTRACTS.md](../CONTRACTS.md) and [../MIGRATION.md](../MIGRATION.md). A
provisional decision is the working default until the named experiment confirms or replaces it.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-architecture.md) | Rust workspace of a few owned crates; thin adapters; legacy kept runnable beside it | Accepted |
| [0002](0002-transport-and-protocol.md) | WSS binary protocol v1 (no Colyseus compatibility); interest-managed snapshots | Accepted |
| [0003](0003-canonical-map.md) | The server sends the map's collision layer; clients never generate maps | Accepted |
| [0004](0004-hosting.md) | GameLift managed containers + queues first, SDK bridge out of process, own TLS + DNS | Provisional |
| [0005](0005-policy-seam.md) | One seat contract for humans, scripted bots and future learned policies | Accepted |
| [0006](0006-persistence.md) | PostgreSQL with fenced session leases and idempotent results | Accepted |
| [0007](0007-determinism.md) | Determinism scope, numeric policy, RNG streams, replays | Accepted |
| [0008](0008-unity-client.md) | Unity 6 LTS Web client; engine-independent C# net library; narrow prediction | Provisional |
| [0009](0009-core-layout.md) | `rh-sim` core layout; the tick schedule, hook chains and input seam as data that a test compares with legacy | Accepted |
