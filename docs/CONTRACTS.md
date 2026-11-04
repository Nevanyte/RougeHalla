# Contracts

Invariants of the Rust foundation, each linked to its canonical source (code is the source of truth; this file only names
and points) and to the tests that hold it. **Decision status** (Accepted / Provisional) is independent of **validation
status** (Passed / Failed / Blocked / Not run) at the revision recorded in [MIGRATION.md](MIGRATION.md).

**FROZEN** means: the baseline ordinary workers preserve. GPT's coordinator may amend a FROZEN contract only with evidence
(a failing scenario or a measurement) and an independent review, recorded in an ADR or in this file's change log.

## Status table

| ID | Contract | Decision | Validation | Tests |
|---|---|---|---|---|
| C-TICK | Fixed 20 Hz step; sim time +50 ms per step; fixed system order, held as an executable schedule checked against the legacy record | Accepted, FROZEN | Passed | parity suite; `rh-parity/tests/schedule.rs`; `rh-sim/src/systems/tests.rs`; `rh-server` pacer unit tests; `rh-server/tests/density.rs` |
| C-RNG | No entropy in the core; injected secrets; one stream per purpose | Accepted, FROZEN | Passed (with the known tie-outcome observability below) | `rh-sim/tests/observe.rs`; `tie_kill_credit_*` parity fixtures; determinism tests |
| C-NUM | f64, legacy order, no FMA, `libm` transcendentals | Accepted, FROZEN | Passed (x86_64) / Not run (aarch64) | parity suite |
| C-DET | Replays and checkpoints (`rh-checkpoint/3`) reproduce every step hash; live = headless; the tick allocates nothing in steady state | Accepted, FROZEN | Passed (`state_hash` still lists its fields by hand until P8) | `rh-headless/tests/env.rs`, `rh-server/tests/equivalence.rs`, `rh-sim/tests/checkpoint.rs`, `rh-sim/tests/no_alloc.rs` |
| C-INPUT | One input path for every actor (including in-tick actors via `Cx::submit`); validation; order budget; ≤ 6 actions/tick | Accepted, FROZEN | Passed | `rh-sim` input unit tests; flood policy test; live tests |
| C-OBS | Three views (state / public snapshot / observation); no leaks | Accepted, FROZEN | Passed (slice) | `rh-sim/tests/observe.rs` |
| C-NET | Protocol v2 framing, limits, versioning, event classes, resume, liveness, batched egress | Accepted, FROZEN | Passed (loopback and in-process density runs; no real-network or socket-level load test yet) | `rh-protocol/tests`, C# tests, `tools/protocol-js/check-vectors.mjs`, `rh-server/tests/{live,transport,density}.rs`, `conn.rs` unit tests, browser proof |
| C-MAP | Server-sent canonical map | Accepted | Passed (blob + hash) | protocol vectors; browser proof `admission_and_map` |
| C-POLICY | Seat contract, cadence, faults, async deadline | Accepted, FROZEN | Passed | `rh-headless/tests/env.rs`, equivalence test |
| C-PERSIST | Idempotent results, fenced leases, ledger reconciliation | Accepted, FROZEN | Store: Passed (local PG 16). Server path: Passed for results, MIA results, lease release on leave/close and rejoin after a leave (`pg_e2e`, 30 of 30 runs under CPU load after P5d); **lease renewal not implemented**, a crashed host's leases wait for their TTL (3600 s), and unwritten results live only in memory (~2 min of retries) | `rh-persist/tests`, `rh-server/tests/pg_e2e.rs` |
| C-HOST | Lifecycle states, drain (control API, SIGTERM, Ctrl-C), no SDK in process | Provisional | Passed locally / Blocked on AWS | `rh-server/tests/live.rs` drain test, `tests/sigterm.rs` |
| C-PARITY | Legacy behaviour reproduced within the stated tolerances | Accepted, FROZEN | Passed (slice: 8 scenarios + 300 paths) | `rh-parity/tests/parity.rs` |

## C-TICK: time and order
- `rh_sim::Sim::step` advances exactly `TICK_MS` (50 ms) of simulation time; nothing else advances time
  (`crates/rh-sim/src/sim.rs`). `Sim::step_into(&mut Vec<Event>)` is the allocation-free entry (`step` wraps it).
- Active tick order (legacy `packages/server/src/sim/step.ts`): mark tick start → inputs in the secret action order →
  [abilities] → [target locks] → weapons → [afterWeapons] → movement (all multipliers read before anyone moves) → history
  → [projectiles] → melee (rewound) → [beforeDamage: signatures, terrain, statuses] → [sudden death] → ledger → systems →
  settle. Bracketed phases are not ported; a port inserts them at that position (backlog packets say where).
- The order is data and executable: `crates/rh-sim/src/schedule.rs` holds the phases, systems, hook chains, actions, move
  modifiers and modifier sources as tables whose rows are Ported (a function) or Pending (the backlog packet that ports it);
  the plan for a gate set is compiled once and the tick runs the live rows in table order. Only the schedule calls a system
  (source guard `nothing_but_the_schedule_calls_a_system`, in `crates/rh-parity/tests/schedule.rs`, which also fails when a table stops
  matching `parity/schedule/legacy_schedule.json`, captured from the real `createGameWorld`, with mutation tests); the
  `schedule-trace` feature records the executed order for the conformance test. A mechanic packet flips a row from Pending to
  Ported and never reorders a table. Rationale: [adr/0009-core-layout.md](adr/0009-core-layout.md).
- Hooks (`crates/rh-sim/src/hooks.rs`): a chain follows the legacy default/append/wrap/replace modes. The two legacy
  deferrals stay separate: `payLater` is `World::pay` and is paid in queue order at the end of the ledger pass of the SAME
  tick (`a_payout_of_the_pass_lands_in_the_same_tick_not_the_next` in `systems/tests.rs`); `deferHit` is `World::deferred`
  and opens the next tick's ledger. Kill credit goes through `World::pay`.
- The live room loop's select is biased with the step deadline first (one pinned timer): when a step is due and commands are
  queued at the same poll, the step runs first and the commands are applied after it, taking effect in the next step's input
  window. Replays record the order actually applied (`density.rs` `a_due_step_runs_before_a_queued_command`).
- Entities live in `Store<T>` (`crates/rh-sim/src/store.rs`: ascending `EntityId` = join order, O(1) lookup while dense, O(log n)
  after leavers). Per-tick working lists indexed by entity (action rank, tick-start bounty, ledger victim chains) are dense by
  slot and rewritten every active tick. Systems that act on a fighter take `FighterCore` (`fighter.rs`) or one of its
  components; only seat, credit and fate logic needs the `Player`.
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
  (joins, commands as submitted, drops, leaves) and each step's hash; `run_replay` checks every hash. Replays recorded
  before P7a/P7b still verify step for step: `state_hash` feeds the same values in the same order.
- A checkpoint (`crates/rh-sim/src/checkpoint.rs`, tag `rh-checkpoint/3`) is `{format, statics, world}`; `after_restore`
  rebuilds derived tables and the restored sim continues identically (`rh-sim/tests/checkpoint.rs`). Players are serialized
  in id order as nested components (core{id, body, vitals, weapon, motion}, seat, credit, fate, status, down, resolved); the
  world carries `roster` (append-only join names, leavers included; `killed_by` and `winner` are ids resolved to names only
  in results). Fighter path and rewind history serialize as their logical sequence (path from the cursor; history oldest
  first, a fixed inline ring) and the action queue as a list of at most `MAX_ACTIONS_PER_TICK`. Scratch is never part of a
  checkpoint. Any other tag (`rh-checkpoint/1`, `/2`, or none) is refused with a typed `CheckpointError`
  (`UnsupportedFormat` / `MissingFormat`), never an untyped parse error.
- The steady-state tick allocates nothing: `rh-sim/tests/no_alloc.rs` (dhat) asserts 0 allocations per `step_into` on
  crowded_8, duel_chase and fists_duel. New per-tick lists go in `TickScratch` (cleared, never taken); new per-entity queues
  are fixed inline arrays or reserved buffers.
- A live match recorded by `rh-server` replays headless, and its bots re-decide identically headless.

## C-INPUT: actions
- Every actor's commands go through `rh_sim::validate` (finite numbers; points clamped to the world; angles wrapped) and
  `Sim::submit` (the seat's order budget: 30 burst, 15/s on SIM time; `Aim` is free) into the per-tick `InputQueue`
  (latest move and aim win; ≤ 6 actions per tick; arrival order preserved). `submit_unbudgeted` exists for the parity
  harness only.
- An actor inside the tick (a future mob brain) uses `Cx::submit`, which goes through the same validate, `OrderBudget` and
  `InputQueue`; `input::accept` is the only code that enqueues.
- The network layer additionally caps frames (1 KiB, 16 commands, 60 frames/s burst 120 per connection).

## C-OBS: views and leaks
- Full state: `Sim` (server-only). Public snapshot: `observe::public_snapshot` (no secrets; ignores line of sight; never
  sent to a playing client). Observation: `observe::observe(sim, viewer, events)`: self in full; other actors only within
  `VISION_RADIUS` with a clear line on the sight mask; sorted by public id; hp as a bar (hundredths); events filtered to
  what the viewer could perceive. Clients and policies receive the same observation.
- The legacy vision has a 120 s revealed-tile trail and bushes (docs/legacy/INVENTORY.md); the slice implements current
  sight only (stricter). Porting the trail must keep the leak tests green (packet P-VISION-1).

## C-NET: protocol and sessions
- `crates/rh-protocol` v2 (`PROTOCOL_VERSION = 2`), mirrored in `client-unity/RoguehallaNet/Protocol`; golden vectors
  `protocol/fixtures/v2.json` (regenerated with `cargo run -p rh-protocol --bin protocol-fixtures`; the Rust and C# test
  suites and `tools/protocol-js/check-vectors.mjs` assert byte equality and malformed-frame rejection).
- Snapshots (v2): no `server_ms` (decoders derive it as tick x `TICK_MS`); the self view is full precision; remote actors are
  quantized (position on a 1/8 u grid, facing, hp as a percent, a per-actor field mask) and encoded with varints
  (`crates/rh-protocol/src/quant.rs`, `encode.rs`). Quantization **refuses, never clamps**: a position outside the grid is
  `EncodeError::BadValue`, and the server refuses at startup an arena that does not fit (`wire::arena_fits`).
- Codes: status 0 lobby / 1 alive / 2 dead / 3 mia; phase 0 lobby / 1 active / 2 ended; outcome 0 won / 1 draw / 2 died /
  3 mia; faction and weapon codes are `FactionId::ALL` / `WeaponId::ALL` order (append only) (`crates/rh-server/src/wire.rs`).
- Admission order (all refusals before a seat is taken): protocol version → content hash → resume token → callsign
  format → draining → credentials → profile ownership (process, then fenced lease) → capacity (`director.rs`).
- Per tick each connected player gets: Events (important, reliable), Fx (droppable, filtered by sight), Snapshot
  (latest-wins, with `ack_input`). The room hands a client's frames for one tick to its outbox as ONE push with ONE notify
  (`outbox_pushes` equals the notify count; `density.rs` asserts 1.0 notifies per human-tick). A client more than 256
  important frames behind is closed with `TooSlow`.
- Egress batching (`conn.rs`, `outbox.rs`): the writer drains the outbox once per wake in the old priority order (all
  important frames, then the close if any, otherwise fx, then the latest snapshot), sends each frame as its own WebSocket
  message with identical bytes and flushes once per wake, flushing early only so unflushed bytes stay within
  `WS_MAX_WRITE_BUFFER` (a large batch costs extra flushes, never a failed send).
- Reader: a ready client frame always wins over an overdue liveness tick (biased select), and the reader serves a drained
  batch in the old order (client frame first, then the writer-done signal). The writer-done arm is polled only when no client
  frame is ready, so a client keeping frames continuously ready can have inputs forwarded for a short while after the writer
  ended; the frame token bucket bounds this.
- Resume: Welcome carries a 16-byte session token; a dropped seat is held `RECONNECT_GRACE` (10 s) and then leaves (MIA in
  a run); resuming re-sends Welcome (full map) and continues.
- Liveness: inbound liveness is the time of the last client frame, checked on a coarse interval (`IDLE_TIMEOUT`/4, between
  10 ms and 1 s): a connection that sends nothing for `IDLE_TIMEOUT` (10 s; clients ping every 0.5-1 s) is dropped between
  `IDLE_TIMEOUT` and `IDLE_TIMEOUT` plus one period (its seat held for the grace). A batch write (feed and flush, including
  the closing Reject and Close) stuck for `SEND_TIMEOUT` (5 s) ends the connection. Each connection has a process-unique id: a
  seat ignores input, disconnect and leave from a connection its resume replaced.
- Telemetry: a room's step times are a fixed 384-byte log-linear histogram (`crates/rh-server/src/metrics.rs`, 4 sub-buckets
  per power of two). `/info` `closedRooms` `step_us_p50` and `step_us_p99` are **bucket upper bounds** (never below the true
  value, at most 25% above it); `step_us_max` and `ticks` are exact. `/control/health` also carries process-wide counters
  and histogram summaries under `metrics` (wakes, steps, droppedSteps, bytesOut, outboxPushes, stepUs, publishUs,
  latenessUs, rssBytes). A refused snapshot is counted per room and logged once per room, not per tick and viewer.
- Every room phase change is reported to the director; a lobby that closed into its run is never offered to a new player.
- Durable I/O never runs on a room task.

## C-POLICY
See [adr/0005-policy-seam.md](adr/0005-policy-seam.md). `rh_policy::{Policy, Seat, AsyncSeat, drive_seats}`.

## C-PERSIST
See [adr/0006-persistence.md](adr/0006-persistence.md) and `crates/rh-persist/README.md`.
- Rejoin (`crates/rh-server/src/director.rs`): a profile that left, was dropped past the reconnect grace, or whose room
  closed stays reserved only until its lease give-back (or result write) lands. An admission for it waits for that, at most
  `LEAVING_WAIT` (3 s) per attempt, and is then admitted or refused `ProfileInUse`; `admit()` may retry a closed match or
  lobby up to 4 times, so the worst case is about 4 x `LEAVING_WAIT`. A profile with a LIVE seat is refused immediately (one
  live seat per profile; the durable lease fences across hosts). `pg_e2e` covers the rejoin.

## C-HOST
See [adr/0004-hosting.md](adr/0004-hosting.md). `crates/rh-server/src/hosting.rs`: Starting → Ready → Draining →
Terminated; `/control/health` (200 only when Ready), `/control/drain`; SIGTERM/Ctrl-C drains; draining refuses new
admissions with `ServerDraining`, lets running matches finish, and terminates when the last room closes.

## C-PARITY
`parity/README.md`: discrete outcomes exact; continuous values within 2e-6. The harness must fail when a rule changes
(`a_changed_rule_is_caught`).

## Change log
- Stage 1: initial contracts.
- Core sweep (P2b, P10a, P7a, P5b, P5c, P7b, P5d merged; P8, P9, P10b, CI pending): C-TICK gained the executable schedule,
  hooks, the same-tick `payLater` seam and the biased room loop; C-NET moved to protocol v2 and gained batched egress, the
  biased reader, the batch `SEND_TIMEOUT` and the telemetry description; C-DET gained `rh-checkpoint/3` and the
  zero-allocation step; C-INPUT gained `Cx::submit`; C-PERSIST gained the bounded rejoin wait. Evidence:
  [sweep/README.md](sweep/README.md).
- Stage 1 exit review: C-PERSIST and C-HOST statuses corrected after independent review found defects (fixed, with
  regression tests); C-NET gained liveness and connection identity; C-RNG records the tie-outcome observability.
