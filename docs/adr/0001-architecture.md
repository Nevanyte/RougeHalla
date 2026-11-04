# ADR 0001: A small Rust workspace with thin adapters

**Status:** Accepted (Stage 1). **Context:** the legacy game is ~95k lines of TypeScript (shared rules, a Colyseus server,
a Phaser client). Requirements: full simulation and authoritative server in Rust; a Unity browser client; a standalone
headless engine that builds and tests without Unity or AWS; future policies attached through one contract.

**Decision.** One Cargo workspace (`crates/`), each crate with one owner and one job:

| Crate | Owns | Must not |
|---|---|---|
| `rh-sim` | Rules, fixed-step advancement, system order, RNG streams, observations, replays/checkpoints | Do I/O, read a clock or entropy, depend on a network/engine/cloud crate |
| `rh-protocol` | Versioned wire format, limits, golden vectors | Depend on `rh-sim` (internal refactors must not change the wire) |
| `rh-policy` | The seat contract (cadence, validation path, faults, async seat), scripted policies | Change rules; hold a model runtime |
| `rh-headless` | Reset/step environment, bot-vs-bot runner, replay files | Wait on wall time |
| `rh-server` | Sockets, wall-clock pacing, admission, replication, hosting lifecycle, result sink | Mutate the sim outside its room task |
| `rh-persist` | Durable profiles/results (PostgreSQL) | Be called from a tick |
| `rh-parity` | Differential harness against captured legacy scenarios | Ship in the server |

Direct calls inside a process (no per-tick RPC, no microservices). The Unity client talks to the server only through the
protocol; it never links Rust code (browser builds cannot load native code). The legacy TypeScript game stays in
`packages/` and runs as before until the port reaches parity (see [../MIGRATION.md](../MIGRATION.md)).

**Consequences.** Mechanics are ported into `rh-sim` one system at a time, each at its legacy position in the tick order
(the order is documented in `crates/rh-sim/src/sim.rs` and must never be reordered silently), each with captured legacy
fixtures in `parity/fixtures/` and a parity test.
