# Contracts

Invariants of the Rust foundation, each linked to its canonical source (code is the source of truth; this file only names
and points) and to the tests that hold it. **Decision status** (Accepted / Provisional) is independent of **validation
status** (Passed / Failed / Blocked / Not run) at the revision recorded in [MIGRATION.md](MIGRATION.md).

**FROZEN** means: the baseline ordinary workers preserve. GPT's coordinator may amend a FROZEN contract only with evidence
(a failing scenario or a measurement) and an independent review, recorded in an ADR or in this file's change log.

## Status table

| ID | Contract | Decision | Validation | Tests |
|---|---|---|---|---|
| C-TICK | Fixed 20 Hz step; sim time +50 ms per step; fixed system order | Accepted, FROZEN | Passed | parity suite; `rh-server` pacer unit tests |
| C-RNG | No entropy in the core; injected secrets; one stream per purpose | Accepted, FROZEN | Passed (with the known tie-outcome observability below) | `rh-sim/tests/observe.rs`; `tie_kill_credit_*` parity fixtures; determinism tests |
| C-NUM | f64, legacy order, no FMA, `libm` transcendentals | Accepted, FROZEN | Passed (x86_64) / Not run (aarch64) | parity suite |
| C-DET | Replays and checkpoints reproduce every step hash; live = headless | Accepted, FROZEN | Passed | `rh-headless/tests/env.rs`, `rh-server/tests/equivalence.rs` |
| C-INPUT | One input path for every actor; validation; order budget; ≤ 6 actions/tick | Accepted, FROZEN | Passed | `rh-sim` input unit tests; flood policy test; live tests |
| C-OBS | Three views (state / public snapshot / observation); no leaks | Accepted, FROZEN | Passed (slice) | `rh-sim/tests/observe.rs` |
| C-NET | Protocol v1 framing, limits, versioning, event classes, resume, liveness | Accepted, FROZEN | Passed (loopback; no real-network or load test yet) | `rh-protocol/tests`, C# tests, `rh-server/tests/live.rs`, browser proof |
| C-MAP | Server-sent canonical map | Accepted | Passed (blob + hash) | protocol vectors; browser proof `admission_and_map` |
| C-POLICY | Seat contract, cadence, faults, async deadline | Accepted, FROZEN | Passed | `rh-headless/tests/env.rs`, equivalence test |
| C-PERSIST | Idempotent results, fenced leases, ledger reconciliation | Accepted, FROZEN | Store: Passed (local PG 16). Server path: Passed for results, MIA results and lease release on leave/close (`pg_e2e`); **lease renewal not implemented**, a crashed host's leases wait for their TTL (3600 s), and unwritten results live only in memory (~2 min of retries) | `rh-persist/tests`, `rh-server/tests/pg_e2e.rs` |
| C-HOST | Lifecycle states, drain (control API, SIGTERM, Ctrl-C), no SDK in process | Provisional | Passed locally / Blocked on AWS | `rh-server/tests/live.rs` drain test, `tests/sigterm.rs` |
| C-PARITY | Legacy behaviour reproduced within the stated tolerances | Accepted, FROZEN | Passed (slice: 8 scenarios + 300 paths) | `rh-parity/tests/parity.rs` |

## C-TICK: time and order
- `rh_sim::Sim::step` advances exactly `TICK_MS` (50 ms) of simulation time; nothing else advances time
  (`crates/rh-sim/src/sim.rs`).
- Active tick order (legacy `packages/server/src/sim/step.ts`): mark tick start → inputs in the secret action order →
  [abilities] → [target locks] → weapons → [afterWeapons] → movement (all multipliers read before anyone moves) → history
  → [projectiles] → melee (rewound) → [beforeDamage: signatures, terrain, statuses] → [sudden death] → ledger → systems →
  settle. Bracketed phases are not ported; a port inserts them at that position (backlog packets say where).
- The live adapter paces a fixed wall-clock grid, runs at most 3 owed steps per wake and drops a longer backlog
  (`crates/rh-server/src/pacer.rs`). Dropping wall time never changes an outcome, because sim time is virtual.
- Message handlers never mutate state between steps except by queueing inputs (and joins/leaves, which the legacy server
  also applies between steps).

## C-RNG: randomness and secrets
- `rh-sim` reads no entropy and no clock. `Secrets { order_salt, spawn_seed }` arrives from the adapter
  (`Room::new`: `getrandom`) or from a run seed (`Secrets::from_seed`, tests/headless only).
- Streams: `order_salt` → per-tick action order (`rng::action_order`, bit-exact with legacy mulberry32);
  `spawn_seed` → spawn shuffle. Future streams (rewards, quests, loot, mob AI) get their own seeds in `Secrets`
  (legacy: `rewardRandom`, `questRandom`, `hashSalt`, `world.random`: docs/legacy/INVENTORY.md section 4).
- Secrets never appear in snapshots, observations, events or public exports. Replays contain them (private artifacts).
- Known limit (inherited from legacy, its Known TODOs): the action order decides tied outcomes (e.g. who gets a kill when
  two equal hits land together), so a client that stages many ties and reads their outcomes learns bits of the order salt.
  A per-match salt bounds the damage; changing it is owner decision 14 in [backlog/README.md](backlog/README.md).

## C-NUM: numeric policy
See [adr/0007-determinism.md](adr/0007-determinism.md). `rh_sim::math` is the only source of `atan2/hypot/exp/asin/pow`.

## C-DET: reproducibility
- Same arena + config + secrets + inputs ⇒ the same state hash after every step on declared targets.
- `rh_sim::replay::Replay` (`rh-replay/1`) records the start (typed reset or lobby), secrets, every input with its tick
  (joins, commands as submitted, drops, leaves) and each step's hash; `run_replay` checks every hash.
- A checkpoint is the serialised `Sim` (`after_restore` rebuilds derived tables) and continues identically.
- A live match recorded by `rh-server` replays headless, and its bots re-decide identically headless.

## C-INPUT: actions
- Every actor's commands go through `rh_sim::validate` (finite numbers; points clamped to the world; angles wrapped) and
  `Sim::submit` (the seat's order budget: 30 burst, 15/s on SIM time; `Aim` is free) into the per-tick `InputQueue`
  (latest move and aim win; ≤ 6 actions per tick; arrival order preserved). `submit_unbudgeted` exists for the parity
  harness only.
- The network layer additionally caps frames (1 KiB, 16 commands, 60 frames/s burst 120 per connection).

## C-OBS: views and leaks
- Full state: `Sim` (server-only). Public snapshot: `observe::public_snapshot` (no secrets; ignores line of sight; never
  sent to a playing client). Observation: `observe::observe(sim, viewer, events)`: self in full; other actors only within
  `VISION_RADIUS` with a clear line on the sight mask; sorted by public id; hp as a bar (hundredths); events filtered to
  what the viewer could perceive. Clients and policies receive the same observation.
- The legacy vision has a 120 s revealed-tile trail and bushes (docs/legacy/INVENTORY.md); the slice implements current
  sight only (stricter). Porting the trail must keep the leak tests green (packet P-VISION-1).

## C-NET: protocol and sessions
- `crates/rh-protocol` v1 (`PROTOCOL_VERSION`), mirrored in `client-unity/RoguehallaNet/Protocol`; golden vectors
  `protocol/fixtures/v1.json` (both test suites assert byte equality and malformed-frame rejection).
- Codes: status 0 lobby / 1 alive / 2 dead / 3 mia; phase 0 lobby / 1 active / 2 ended; outcome 0 won / 1 draw / 2 died /
  3 mia; faction and weapon codes are `FactionId::ALL` / `WeaponId::ALL` order (append only) (`crates/rh-server/src/wire.rs`).
- Admission order (all refusals before a seat is taken): protocol version → content hash → resume token → callsign
  format → draining → credentials → profile ownership (process, then fenced lease) → capacity (`director.rs`).
- Per tick each connected player gets: Events (important, reliable), Fx (droppable, filtered by sight), Snapshot
  (latest-wins, with `ack_input`). A client more than 256 important frames behind is closed with `TooSlow`.
- Resume: Welcome carries a 16-byte session token; a dropped seat is held `RECONNECT_GRACE` (10 s) and then leaves (MIA in
  a run); resuming re-sends Welcome (full map) and continues.
- Liveness: a connection that sends nothing for `idle_timeout` (10 s; clients ping every 0.5-1 s) is dropped (its seat held
  for the grace); a socket write stuck for 5 s ends the connection. Each connection has a process-unique id: a seat ignores
  input, disconnect and leave from a connection its resume replaced.
- Every room phase change is reported to the director; a lobby that closed into its run is never offered to a new player.
- Durable I/O never runs on a room task.

## C-POLICY
See [adr/0005-policy-seam.md](adr/0005-policy-seam.md). `rh_policy::{Policy, Seat, AsyncSeat, drive_seats}`.

## C-PERSIST
See [adr/0006-persistence.md](adr/0006-persistence.md) and `crates/rh-persist/README.md`.

## C-HOST
See [adr/0004-hosting.md](adr/0004-hosting.md). `crates/rh-server/src/hosting.rs`: Starting → Ready → Draining →
Terminated; `/control/health` (200 only when Ready), `/control/drain`; SIGTERM/Ctrl-C drains; draining refuses new
admissions with `ServerDraining`, lets running matches finish, and terminates when the last room closes.

## C-PARITY
`parity/README.md`: discrete outcomes exact; continuous values within 2e-6. The harness must fail when a rule changes
(`a_changed_rule_is_caught`).

## Change log
- Stage 1: initial contracts.
- Stage 1 exit review: C-PERSIST and C-HOST statuses corrected after independent review found defects (fixed, with
  regression tests); C-NET gained liveness and connection identity; C-RNG records the tie-outcome observability.
