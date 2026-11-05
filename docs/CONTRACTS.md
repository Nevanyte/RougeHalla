# Contracts

Invariants of the Rust foundation, each linked to its canonical source (code is the source of truth; this file only names
and points) and to the tests that hold it. **Decision status** (Accepted / Provisional) is independent of **validation
status** (Passed / Failed / Blocked / Not run). Validation columns refer to `optimization_port` at `b326676` (the merge of
L-v4, the last package of the efficiency and lock-in passes, which follow the core sweep merged at `ae0c37b`; the revision and
results are recorded in [MIGRATION.md](MIGRATION.md)) unless a cell says otherwise. The evidence behind each cell is the gate run of the package that last changed it, on that package's own
revision; [sweep/README.md](sweep/README.md) says which (H-sim and H-server-2 have no merge-time run recorded).

**FROZEN** means: the baseline ordinary workers preserve. The coordinator may amend a FROZEN contract only with evidence
(a failing scenario or a measurement) and an independent review, recorded in an ADR or in this file's change log.

## Status table

| ID | Contract | Decision | Validation | Tests |
|---|---|---|---|---|
| C-TICK | Fixed 20 Hz step; sim time +50 ms per step; fixed system order, held as an executable schedule checked against the legacy record | Accepted, FROZEN | Passed | parity suite; `rh-parity/tests/schedule.rs`; `rh-sim/src/systems/tests.rs`; `rh-server` pacer unit tests; `rh-server/tests/density.rs` |
| C-RNG | No entropy in the core; injected secrets; one stream per purpose; the state hash is server-private (it depends on `spawn_seed`) | Accepted, FROZEN | Passed (with the known tie-outcome observability and the state-hash oracle limit below) | `rh-sim/tests/observe.rs`; `tie_kill_credit_*` parity fixtures; determinism tests; `rh-sim/tests/hash_coverage.rs` (statics secrets held out and asserted) |
| C-NUM | f64, legacy order, no FMA, `libm` transcendentals; the kernel fast paths (E-sim) equal the plain formulations bit for bit | Accepted, FROZEN | Passed (x86_64) / Not run (aarch64) | parity suite; `rh-sim/tests/kernel.rs` (`ray_blocked`, `circle_clear` and `wrap_angle` against the plain forms) |
| C-DET | Replays (`rh-replay/2`) and checkpoints (`rh-checkpoint/3`) reproduce every step hash and carry the `build` and `content_hash` that recorded them (a stored file is verified by that build only; another content is refused with `ContentMismatch`); the state hash is derived from the serialized `World` (0 unhashed leaves); live = headless; the tick allocates nothing in steady state | Accepted, FROZEN | Passed (P8; H-sim tests ran on the H-sim branch head `fec4572`, no merge-time gate run is recorded for `2e8682c`) | `rh-headless/tests/{env,restore_real}.rs`, `rh-server/tests/equivalence.rs`, `rh-sim/tests/{checkpoint,hash_coverage,replay,no_alloc}.rs`, `rh-sim/src/hash.rs` unit tests, `rh-sim/clippy.toml` |
| C-INPUT | One input path for every actor (including in-tick actors via `Cx::submit`; fighters are addressed by `FighterIx` inside a tick); validation; `Command` opaque (only `validate` or a re-validating decode builds one); order budget; ≤ 6 actions/tick | Accepted, FROZEN | Passed (H-sim tests on its branch head `fec4572`) | `rh-sim` input unit tests (incl. the `Command` decode refusals); `rh-sim/tests/replay.rs`; flood policy test; live tests |
| C-OBS | Three views (state / public snapshot / observation); no leaks; every event declares who may perceive it (exhaustive `visibility`/`class`); catch-up wakes judge each step against its own sight; a hit's source is optional (a sourceless kill credits nobody); the sight memo is derived and never hashed | Accepted, FROZEN | Passed (slice) | `rh-sim/tests/{observe,kernel}.rs`, `rh-headless/tests/sight_cache.rs`, `rh-server/tests/publish.rs`, `a_sourceless_hit_damages_and_credits_no_one` (`rh-sim/src/systems/tests.rs`) |
| C-NET | Protocol v4 (ADR 0011 over the per-connection deltas of ADR 0010): append-only varint presence masks, status and phase as fields, actor kind and one id namespace, the reserved State channel, the admission ticket in the Hello, the Result re-sent after a resume; the frozen cross-version envelope (Hello bytes 0..3 and the whole Reject frame never change); Full frames and Deltas against the last snapshot the connection's writer wrote; Resync deferred, never dropped; framing, limits, versioning, event classes, resume, liveness, batched egress, fair guarded reader, refusing encoders | Accepted, FROZEN (v4) | Passed for v4 (loopback, in-process density runs, browser proof incl. resync, resume and the Result after a resume, C# probe against the real server; no real-network load test yet) | `rh-protocol/tests` (delta.rs, v4.rs, envelope.rs, snapshot_build.rs, vectors.rs), C# tests (199, L-v4 report), `tools/protocol-js/check-vectors.mjs` (16 server vectors, 58 malformed, 9 chains, 2,078 checks), `rh-server/tests/{live,transport,density,publish,snapshot_delta}.rs`, `conn.rs`/`room.rs` unit tests, browser proof |
| C-MAP | Server-sent canonical map | Accepted | Passed (blob + hash) | protocol vectors; browser proof `admission_and_map` |
| C-POLICY | Seat contract v2 (`reset(&MatchStart)`, version faults with a safe fallback), cadence, faults, async deadline; a seat is observed only on its decision ticks, events between decisions accumulate (bounded) | Accepted, FROZEN | Passed | `rh-headless/tests/env.rs`, equivalence test, `rh-policy` unit tests |
| C-PERSIST | Idempotent results, fenced leases, ledger reconciliation; a profile is its surrogate `profile_id` (the callsign is a renamable display attribute), the complete versioned match record and a `matches` row, tolerant profile blobs, the `schema_compat` gate, append-only durable ids; one owned entry per profile in the director (owner token, lease states), a lease never given back while a result is due or in flight | Accepted, FROZEN | Store: Passed (local PG 16). Server path: Passed for results, MIA results, lease release on leave/close, rejoin after a leave and the director state machine (`pg_e2e`: 30 of 30 under CPU load after P5d, 20 of 20 after H-server; director unit tests on strict memory leases). **Lease renewal not implemented**, a crashed host's leases wait for their TTL (3600 s), and unwritten results live only in memory (~2 min of retries) | `rh-persist/tests`, `rh-server/src/director.rs` unit tests, `rh-server/tests/{pg_e2e,lease_conformance,durable_ids}.rs` |
| C-HOST | Lifecycle states, drain (control API, SIGTERM, Ctrl-C), no SDK in process; a panicking room is reported `Closed` and its seats and leases are freed | Provisional | Passed locally / Blocked on AWS | `rh-server/tests/live.rs` drain test, `tests/sigterm.rs`, `director.rs` room-panic test |
| C-PARITY | Legacy behaviour reproduced within the stated tolerances | Accepted, FROZEN | Passed (slice: 13 scenarios MATCH + 1 capture-only + 300 paths) | `rh-parity/tests/parity.rs`, `rh-parity/tests/schedule.rs` |
| C-PERF | Pull requests touching the Rust core are A/B-measured against their merge-base with deterministic counts (Ir per unit <= 1.03x, no allocation increase, equal behaviour fingerprints unless declared) | Accepted | Not run in CI yet: the workflow passed `actionlint` and a local dry run of its exact command line; its first real pull-request run is still to be observed | `.github/workflows/perfproof.yml`, `tools/perfproof/perfproof.py`, [CONTRIBUTING.md](../CONTRIBUTING.md) |

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
  window. Replays record the order actually applied (`density.rs` `a_due_step_runs_before_a_queued_command`). Under overload
  (H-server): when a wake ends with its next step already due, the commands already queued (at most `INBOUND_CAP`) are
  applied before that step, so at most one wake runs between two looks at the inbox; this is the order a command arriving
  during a wake meets in the normal case, so no new ordering is introduced (`room.rs` `an_overloaded_room_still_applies_queued_commands`).
- Entities live in `Store<T>` (`crates/rh-sim/src/store.rs`: ascending `EntityId` = join order, O(1) lookup while dense, O(log n)
  after leavers). Per-tick working lists indexed by entity (action rank, tick-start bounty, ledger victim chains) are dense by
  slot and rewritten every active tick. A fighter's data lives in `FighterCore` components (`fighter.rs`) and `Player`
  derefs to it; most systems still take the `Player` today, and a mechanic packet may narrow its signatures.
- Fighter addressing (L-sim): the tick addresses fighters by `FighterIx(u32)`
  (`crates/rh-sim/src/fighter.rs`): players at `0..players.len()` in join order, mobs to follow in id order, with `World`
  accessors `fighter_count`, `core`, `core_mut`, `fighter_idx`, `is_player` and `standing`. An index is valid for one tick and is
  never stored in the `World`, a checkpoint, a replay or the wire. Every fighter kind takes its id from the one `next_id` space.
  PvP rules, the order budget and run bookkeeping are player-only and are gated by `is_player`. The legacy world id counter
  (`world.idCounter`, hashed and checkpointed) is deferred to P-MOBS-1, because adding a hashed `World` field now would change
  every state hash: P-COMBAT-1, P-COMBAT-2 and P-STATUS-1 keep container, projectile and field ids local and compare them
  canonically in fixtures; P-MOBS-1 re-threads the allocation sites in legacy order.
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
- The state hash is **server-private**. The statics secrets (`Secrets`) are not mixed into the statics digest, but
  `World.spawn_rng` is `Mulberry32::new(spawn_seed)` and is hashed on purpose (it is simulation state), so the state hash
  is still a function of the 32-bit spawn seed. A hash that is logged or exported, together with a near-public lobby world,
  would be an offline oracle against that secret. Therefore `Sim::state_hash` and per-step replay hashes are never sent to
  clients and never appear in public exports or logs. The server keeps only the final hash in its internal closed-room
  report and ignores it; the director holds the last 4 replays in memory. Before any public replay or checkpoint export,
  separate `spawn_rng` from `spawn_seed` or use a keyed hash (open follow-up, ADR 0007).
- Known limit (inherited from legacy, its Known TODOs): the action order decides tied outcomes (e.g. who gets a kill when
  two equal hits land together), so a client that stages many ties and reads their outcomes learns bits of the order salt.
  A per-match salt bounds the damage; changing it is owner decision 14 in [backlog/README.md](backlog/README.md).

## C-NUM: numeric policy
See [adr/0007-determinism.md](adr/0007-determinism.md). `rh_sim::math` is the only source of `atan2/hypot/exp/asin/pow`.

## C-DET: reproducibility
- Same arena + config + secrets + inputs ⇒ the same state hash after every step on declared targets.
- `rh_sim::replay::Replay` (`rh-replay/2`) records the start (typed reset or lobby), secrets, every input with its tick
  (joins, commands as submitted, drops, leaves) and each step's hash; `run_replay` checks every hash. Any other tag
  (`rh-replay/1` or unknown) is refused with `ReplayError::Format { found }` before a step runs: P8 redefined the per-step
  hashes once, so an `rh-replay/1` file cannot verify on any build.
- State identity by construction (P8, [adr/0007-determinism.md](adr/0007-determinism.md) addendum): `Sim::state_hash` is
  derived from the serialized `World` by a serde `Serializer` (`crates/rh-sim/src/hash.rs`, `HashSer`: 64-bit words,
  length-prefixed sequences, maps and strings, enum variant index, `Option` tag), seeded with a digest of the statics
  (config, map layer, spawns; no secrets). What a checkpoint restores and what the hash sees are the same set: a new
  component is hashed the moment it is a serde field of the world. `tests/hash_coverage.rs` perturbs every serialized leaf
  of real scenarios and asserts the hash changes (0 unhashed of 12,696; the hand list left 66 unhashed at `7d94332`); only
  the statics secrets are held out, and the test asserts that. The world layout rule is enforced by `Sim::check_layout`
  (a validating run of the same serializer): no non-finite float (a sentinel is an `Option`), no `skip_serializing_if`, no
  `flatten`, no sequence of unknown length; `#[serde(skip)]` is the only way to leave a field out and every use is pinned.
  A decoded value is complete (`TileMap::rebuild` and `Sim::after_restore` are gone); malformed or truncated input is an
  `Err`. The ADR 0007
  rules are a lint: `crates/rh-sim/clippy.toml` (and `rh-policy/clippy.toml`) disallow `HashMap`/`HashSet`, platform-libm
  `f64` transcendentals, `mul_add`, `Instant` and `SystemTime`; a sanctioned use carries an `#[allow]` with its reason.
- Restore refuses the states the rules below cover (H-sim): `Sim::restore` returns the typed
  `CheckpointError::Malformed` for the rule families `check_world` (`crates/rh-sim/src/checkpoint.rs`) implements:
  (1) ids and roster order: `next_id` greater than the last player and roster id and not `u32::MAX`; roster and player
  order are checked by their own decoders; (2) clock and tick: `server_time` within `0..=u32::MAX x TICK_MS` (where
  `+= TICK_MS` and the rewind cutoff are exact) and `tick` not `u32::MAX`; (3) rewind history: consecutive samples at least
  `TICK_MS` apart (this also covers order and NaN) and none dated after `server_time`; (4) coordinates: every body,
  rewind sample, path point and arena spawn finite and within the map extent plus `COORD_MARGIN` (1024); (5) counters:
  `joined`, `rt.downs_between_ticks` and every `credit.kills` at most the roster length, `credit.bot_kills` at most
  `credit.kills`; (6) carried weapons: fists only (the slice has no item flow); (7) pending actions: only a fist swing
  with finite times, angle and packet; (8) queued inputs: each queued move, aim and action is re-run through `validate`
  and any value it would change is refused (`InputQueue::check`). Layer two: arithmetic the tick cannot bound by a check
  saturates where results stay bit-identical for in-range values (`inputs.dropped`, `credit.kills`/`bot_kills`, the
  bounty and gv sums, the settle total, `rt.downs_between_ticks`, `joined`, tile arithmetic in `snap_to_floor` and
  `circle_clear`, a finiteness test per coordinate in `find_path_into`), so a state neither layer refuses is not known to
  panic or to wrap differently in debug and release (800-mutation fuzz, unit tests). `rh-headless/tests/restore_real.rs`
  shows no false refusal for between-step checkpoints: bot matches (5 seeds, 2 to 8 players, every 5th tick) restore with an
  equal hash and then step on identically with the original for 3 steps; lobby matches (joins, leaves and random validated
  inputs) restore with an equal hash, checked every 7th step. Every checkpoint there is taken after `step()`, so the queued
  inputs are empty and rule (8) is covered only by the unit test `a_queued_input_validation_would_change_is_refused`. A packet that moves bodies past
  `COORD_MARGIN` or adds items or ranged actions must widen these rules and the `hash_coverage` seeds.
- Not done yet: `TileMap` keeps public `w`/`h`/`tiles` ([sweep/README.md](sweep/README.md), follow-ups).
- A checkpoint (`crates/rh-sim/src/checkpoint.rs`, tag `rh-checkpoint/3`) is `{format, content_hash, build, statics, world}`; deserialization
  builds every derived table (the decoded value is complete, see above) and the restored sim continues identically (`rh-sim/tests/checkpoint.rs`). Players are serialized
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
- Build and content identity (L-durable). A replay carries `content_hash`, `build` (`rh_sim::BUILD_ID`: the `RH_BUILD`
  compile-time variable, else `dev-<crate version>`) and an optional `match_id`; a checkpoint is `{format, content_hash, build,
  statics, world}`. `run_replay` refuses another `content_hash` (`ReplayError::ContentMismatch`) and `Sim::restore` refuses
  another one (`CheckpointError::ContentMismatch`); a file written before the keys existed still loads. A replay or checkpoint
  is verified by the build that recorded it and never across builds (the state hash follows the serialized layout of the world
  and `content_hash` does not cover system code): releases keep their commit buildable (`rust-toolchain.toml` and `Cargo.lock`
  pin the rest), and hashes are not made stable across versions. Open: nothing sets `RH_BUILD` yet (Dockerfile, CI, P-HOST-1),
  so until then the build id is not informative.
- Derived state (E-sight). The line-of-sight memo (`rh_sim::SightCache`, `crates/rh-sim/src/sight.rs`) lives outside the
  `World`: it is never hashed, checkpointed or serialized. A hit needs the same ordered (viewer, other) pair, the same four
  endpoint `f64` bit patterns and the same arena (pointer and statics digest), so an observation is byte-identical to the
  uncached path (`rh-headless/tests/sight_cache.rs`, a debug assertion on every hit in `sight.rs`). The room,
  the headless `Env` and the publisher each own one.

## C-INPUT: actions
- Every actor's commands go through `rh_sim::validate` (finite numbers; points clamped to the world; angles wrapped) and
  `Sim::submit` (the seat's order budget: 30 burst, 15/s on SIM time; `Aim` is free) into the per-tick `InputQueue`
  (latest move and aim win; ≤ 6 actions per tick; arrival order preserved). `submit_unbudgeted` exists for the parity
  harness only.
- An actor inside the tick (a future mob brain) uses `Cx::submit`, which goes through the same validate, `OrderBudget` and
  `InputQueue`; `input::accept` is the only code that enqueues.
- `Command` is opaque (H-sim): its field is private, and the only ways to hold one are `validate` and a `Deserialize` that
  runs `validate` again and refuses anything it would change, so no fixture or edited replay can hand the sim an
  unvalidated command. It serializes as the plain variant, so recorded replays keep their shape. `run_replay` checks
  `REPLAY_FORMAT` (`rh-replay/2`) first (C-DET). Queued inputs inside a restored checkpoint get the same re-validation.
- The network layer additionally caps frames (1 KiB, 16 commands, 60 frames/s burst 120 per connection).

## C-OBS: views and leaks
- Full state: `Sim` (server-only). Public snapshot: `observe::public_snapshot` (no secrets; ignores line of sight; never
  sent to a playing client). Observation: `observe::observe(sim, viewer, events)`: self in full; other actors only within
  `VISION_RADIUS` with a clear line on the sight mask; sorted by public id; hp as a bar (hundredths); events filtered to
  what the viewer could perceive. Clients and policies receive the same observation. `observe_into` fills caller-owned
  buffers (`observe` wraps it).
- Event visibility is declared, not inferred (P9): `Event::visibility()` and `Event::class()` (`crates/rh-sim/src/events.rs`)
  are exhaustive matches, and observation and the wire mapping (`SeenEvent`) are exhaustive too; a new event variant fails
  to compile until it says who may perceive it and whether it is important or droppable. `is_important` is gone.
- A hit's source is optional (L-sim): `Entry.by` and `Event::Hit.by` are `Option<PlayerId>`, `weapon` is `Option<WeaponId>`.
  `None` means the arena's own damage (legacy sudden death, terrain burn, ability and field damage): such a hit takes no PvP
  factor, gives no damage or rival credit, and **a kill by it credits nobody**, as legacy sudden death does (the arena's own;
  legacy `arena.ts`). Mobs and departed shooters stay `Some(id)` and keep the recent-rival rule; a self-hit credits nobody. Names
  resolve at result time (the roster for players, content for mob types). Parity canonicalises a sourceless `by` as the legacy
  string `"sudden death"` and a missing weapon as null. The wire still has a required `Fx::Hit.by`: `WIRE_NO_SOURCE` =
  `u32::MAX` in `rh-server/src/wire.rs` is a stop-gap no producer emits; the first sourceless producer makes it optional in a
  protocol bump (the golden vector `fx_quantized` changes then) and fixes the canonical fx `by` and weapon and the result
  `killedBy` (legacy: `game.ts:151`). Open: whether the PvP hit cap applies to arena damage (legacy `ledger.ts:264`; the cap in
  `ledger.rs` still applies to a sourceless hit on a player when `pvp_rules` is on).
- Observation shape (L-sim): actors keep one shape for players and mobs, with no hidden-state fields; a new fighter kind goes into
  `Observation.visible` with an id from the one fighter id space, and objects that are not fighters (projectiles, containers,
  fields, camps) get their own lists, not `ActorView` rows. A policy written now must not assume every actor is a player. Any
  new observation field must be public per C-OBS and bumps `OBSERVATION_VERSION` (2 today) and, if it reaches the wire,
  `PROTOCOL_VERSION`.
- Sight is judged per ordered pair: `ray_blocked(a, b)` is not always equal to `ray_blocked(b, a)` (5,946 of 2e6 segments
  on the seed-1 map, 14,497 on the practice map), so the observation judges each (viewer, other) pair on its own; never
  reuse one verdict for both viewers (`rh-sim/tests/kernel.rs`, `the_sight_verdict_is_not_symmetric_so_each_ordered_pair_is_judged_alone`).
- Catch-up wakes (several steps in one wake): each human's events of the earlier steps are judged against that step's own
  line of sight, at that step, and carried to the final frame; only the last step's events are judged in the observation,
  so an event is never judged against a later step's sight. One snapshot goes out for the final state. A room test
  (`rh-server/tests/publish.rs`, a three-step wake equals three single-step wakes, walking a human across the vision edge)
  fails when the carry is removed. On single-step wakes frames are byte-identical to the pre-P9 path.
- The legacy vision has a 120 s revealed-tile trail and bushes (docs/legacy/INVENTORY.md); the slice implements current
  sight only (stricter). Porting the trail must keep the leak tests green (packet P-VISION-1).

## C-NET: protocol and sessions
- `crates/rh-protocol` v4 (`PROTOCOL_VERSION = 4`, [ADR 0011](adr/0011-protocol-v4.md)), mirrored in
  `client-unity/RoguehallaNet/Protocol`; golden vectors `protocol/fixtures/v4.json` (vectors for the current version only,
  `v3.json` is gone; regenerated with `cargo run -p rh-protocol --bin protocol-fixtures`). The Rust and C# suites and
  `tools/protocol-js/check-vectors.mjs` (the `probe.html` decoder) assert byte equality, malformed-frame rejection and replay of
  the delta chains. The `malformedServer` vectors cover Reject code 0, a reason that is not UTF-8, every MapBlob rule and the
  malformed deltas; code 12 (unnamed) is a valid server vector; all three decoders reject the malformed ones. The C# encoders
  refuse off-grid positions as Rust does.
- **Frozen cross-version envelope** (L-envelope): Hello bytes 0..3 (`0x01`, protocol `u16` LE) and the whole Reject frame
  (`0x82`, code `u16` LE, reason `str`) never change in any version, so a stale client always gets a decodable "reload". The
  server reads the Hello prefix before the full decode and answers any other protocol with `Reject ProtocolMismatch`, whatever
  follows (`rh-protocol/tests/envelope.rs`, `rh-server/tests/live.rs`). Reject codes are append-only; code 0 is not a code;
  every decoder (Rust, C#, JS) accepts an unknown code (kept raw, the session ends `Rejected` with the server's reason text). A
  wire string carries a `u8` length: encoders **refuse** more than 255 bytes (`EncodeError::StringTooLong` in Rust, an
  `EncodeException` in C#, a throw in the JS probe) and never truncate; the server clips the diagnostic text of a Reject itself
  (`conn.rs` `clip_reason`, on a char boundary) before encoding.
- **Presence masks (v4)**: every mask in a Snapshot or SnapshotDelta (the Full head, the Full actor mask, the Delta head and the
  actor-delta mask) is a canonical LEB128 varint with append-only bit numbers. A bit is never renumbered, reused or
  repurposed; adding a field takes the next free top bit, its codec arm in the three decoders, the writer, the trackers, a
  vector and a `PROTOCOL_VERSION` bump. Decoders are strict per version: a bit the version does not define is refused
  (`BadField`), never skipped. Common fields sit in bits 0..6 so the usual head is one byte; rarely changing ones sit above and
  widen it (the Delta head's status bit is bit 14, a three-byte varint when set). The numbers are pinned by
  `delta_head_and_actor_delta_bit_numbers_are_pinned` (`rh-protocol/tests/v4.rs`). Lifecycle status and match phase are ordinary
  fields with defaults (`DEFAULT_STATUS` 1 alive, `DEFAULT_PHASE` 1 active, hp 100%, kit 0, bounty 0, kind 0): a clear bit
  means the default; a Delta carries a field only when it differs from its base, and a new actor in a Delta starts from the
  default actor and must carry its position.
- **Actor kind and the id namespace**: `WireActor.kind` (0 = player, the default, free). A wire actor id names one entity for
  the whole match across every kind of entity and is never reused within a match; the observation, the events (`Death.by`,
  `Hit.by`) and the trackers key on it. The sim may keep typed ids; the mapping is `crates/rh-server/src/wire.rs` (which sets
  kind 0 today). P-MOBS-1 allocates mob ids from the same monotonic counter as players or from a disjoint range that
  `wire.rs` maps, and sets the kind; two kinds must never share an id.
- **Channels and the reserved State message**: Snapshot (per-tick scalars, a lossless chain), Events (reliable, one-shot) and
  Fx (droppable). State a client must keep (cards, inventory, gates, coliseum timers, the planning deal) is carried by the
  reserved `State` message (server tag `0x88`: `tick varint, count varint, [key varint][record]` per item, the latest value per
  key, keys strict per version). v4 defines no key (the Rust type `StateItem` has no value), so every decoder accepts exactly
  the empty State and the server sends none. Rule: once keys exist, a Welcome (join and resume) is followed by a full State, so
  a resumed or recovered client never depends on an event it missed; the first packet that needs state defines its key and
  record layout, adds the C# and JS arms, makes the server send the State after each Welcome and bumps the protocol.
- **The Result survives a resume**: the player's own `Result` is kept on its seat and re-sent after the Welcome of every resume
  (`live.rs` `a_player_who_reconnects_after_the_match_resolved_still_receives_their_result`; browser proof
  `resume_after_the_run_resolved_resends_the_result`), provided the client resumes within the reconnect grace and the room is
  still open (afterwards the resume is `NoSuchSession` and the Result lives only in durable storage). It is re-sent even when
  the client already received it, so **clients treat `Result` as idempotent**; the re-sent Events frame carries the current
  tick, not the tick of resolution. The seat's copy is in memory: a future room recovery must restore it from the durable
  results. `MatchEnded` is public state a rejoining client derives from the phase.
- **Admission ticket**: the Hello carries `ticket: bytes` (`u16` length, at most `MAX_TICKET` = 448) instead of a token;
  `profile` is the requested display name. The largest legal Hello is 992 bytes, under `MAX_CLIENT_FRAME` (1 KiB; a test holds
  it). The ticket is checked where credentials were checked before (after the protocol and content-hash checks, before a seat
  is reserved). Its contents are defined by P-HOST-1 (a GameLift player-session id the control plane pre-authorised, or a signed
  join token that fits 448 bytes); without a hosting layer it is the callsign's secret as UTF-8 bytes, which the static auth file
  and the Postgres credentials store check.
- **Unity API rule**: gameplay code is written against `Net/` (`Session.Me` / `SelfView`, `InterpActor`, `ActorStatus` /
  `FactionId` / `WeaponId`, `Snapshots.Sample`); `Protocol/*` is internal to the netcode, so a wire change is absorbed in `Net/`
  and not in gameplay scripts. Until `Net/` has views of its own, a few codec types stay on the `Session` surface (`MapBlob`,
  `RejectCode`, `Welcome`, `LastResult` / `WireResult`, the `EventsReceived` / `FxReceived` events); `client-unity/README.md` names
  them.
- Snapshots (the v3 design of [ADR 0010](adr/0010-snapshot-delta.md), P10c, kept by v4): per connection, a Full frame (tag 0x83, the v2 layout) or a
  Delta (tag 0x87) against the last snapshot that connection's writer wrote. The room hands the outbox validated
  `SnapshotData` and the writer encodes it when it drains (latest-wins is unchanged; a snapshot that was skipped is never
  encoded). A Full frame goes out for: the first snapshot after a Welcome (a resume always starts Full), an answered Resync,
  a base older than 64 ticks (`MAX_DELTA_AGE`), a self that appears or changes id, a snapshot whose tick is not later than its base's, and a delta not smaller than the Full
  frame. A client refuses, never repairs, a delta it cannot apply (unknown base, malformed) and answers with Resync
  (0x05). The server never drops a Resync: it is answered by a Full frame at the next snapshot, or at the first one at least
  20 ticks (`MIN_FORCED_FULL_TICKS`) after the last forced Full, so a flood costs one Full per interval. Clients repeat an
  unanswered Resync with the next refused delta after 2 s. Decoders refuse unknown bases and malformed deltas and never
  clamp. 908 -> 305 B/player/s at 8 players on the slice with v3 (1.048x wire Ir) and 285 with v4 (`wirebench`, seed-1 map, 8 bots, 2,400 ticks; wire Ir 1.0041x of v3; [sweep/README.md](sweep/README.md)).
- Snapshot content (both frame kinds): no `server_ms` (decoders derive it as tick x `TICK_MS`); the self view is full
  precision; remote actors are quantized (position on a 1/8 u grid, facing, hp as a percent, a per-actor varint field mask) and
  encoded with varints (`crates/rh-protocol/src/quant.rs`, `encode.rs`, `delta.rs`). Quantization **refuses, never clamps**:
  a position outside the grid is `EncodeError::BadValue`, and the server refuses at startup an arena that does not fit
  (`wire::arena_fits`). `SnapshotData::build` applies every refusal of the encoders, off-grid positions included, so no
  Delta can carry one.
- Every server frame that can be refused goes through a refusing encoder: Snapshot (`SnapshotData::build_checked`, the one
  snapshot builder, which `build`/`build_with` share with each actor checked by `QActor::checked`; called by `Publisher::frames`
  in the room; `rh-protocol/tests/snapshot_build.rs` holds each refusal and its parity with the message encoder; the writer's
  `ConnEncoder::encode` takes only validated data and cannot fail), Events and Fx (`try_encode`, one exact allocation, `wire::encode_or_refuse`). A refused frame
  is never clamped or repaired: it is not sent, it is counted per room (`snapshotRefusals`, `frameRefusals` in `/info`
  `closedRooms`) and logged once per room, not per tick and viewer. `SnapshotWriter` was removed (it had no production
  caller and a second refusal path). The publisher checks and quantizes each actor once for all viewers (a memo keyed by the
  whole view, compared bitwise; actor ids at or above `MAX_ACTORS` are converted every time) and the writer assembles each frame
  in a kept buffer and copies it to its exact size (`ConnEncoder::encode_frame`), so a frame is one right-sized allocation (E-pub).
- Per-room counters: `snapshotsFull`, `snapshotsDelta` and `snapshotBytesSent` hold the wire figures of the snapshots.
  `bytesOut` and `bytesEnqueuedTotal` count a snapshot at `min_len`, a lower bound of its Full frame, so they are not the
  wire figure for snapshots.
- Codes: status 0 lobby / 1 alive / 2 dead / 3 mia (default 1); phase 0 lobby / 1 active / 2 ended (default 1); outcome 0 won / 1 draw / 2 died /
  3 mia; faction and weapon codes are `FactionId::ALL` / `WeaponId::ALL` order (append only) (`crates/rh-server/src/wire.rs`).
- Admission order (all refusals before a seat is taken): protocol version → content hash → resume token → callsign
  format → draining → credentials (the ticket) → profile ownership (process, then fenced lease) → capacity (`director.rs`).
- Per tick each connected player gets: Events (important, reliable), Fx (droppable, filtered by sight), Snapshot
  (latest-wins, with `ack_input`). The room hands a client's frames for one tick to its outbox as ONE push with ONE notify
  (`outbox_pushes` equals the notify count; `density.rs` asserts 1.0 notifies per human-tick). A client more than 256
  important frames behind is closed with `TooSlow`.
- Egress batching (`conn.rs`, `outbox.rs`): the writer drains the outbox once per wake in the old priority order (all
  important frames, then the close if any, otherwise fx, then the latest snapshot), sends each frame as its own WebSocket
  message with identical bytes and flushes once per wake, flushing early only so unflushed bytes stay within
  `WS_MAX_WRITE_BUFFER` (a large batch costs extra flushes, never a failed send).
- Reader: a ready client frame always wins over an overdue liveness tick (biased select), and the reader serves a drained
  batch in the old order (client frame first, then the writer-done signal). Fairness (H-server): after `FAIR_STREAK` (32)
  frames in a row the reader checks the writer once, so a finished writer ends the reader within 33 frames even under an
  always-ready stream; the liveness tick is never checked ahead of a ready frame. Every inbound WebSocket frame, control
  frames (Ping, Pong) included, is charged to the frame bucket (60/s, burst 120): a Ping flood is closed `RateLimited`
  (`tests/transport.rs`).
- Resume: Welcome carries a 16-byte session token; a dropped seat is held `RECONNECT_GRACE` (10 s) and then leaves (MIA in
  a run); resuming re-sends Welcome (full map), the seat's Result if it has one (above), and continues.
- Liveness: inbound liveness is the time of the last client frame, checked on a coarse interval (`IDLE_TIMEOUT`/4, between
  10 ms and 1 s): a connection that sends nothing for `IDLE_TIMEOUT` (10 s; clients ping every 0.5-1 s) is dropped between
  `IDLE_TIMEOUT` and `IDLE_TIMEOUT` plus one period (its seat held for the grace). Every server write is bounded by
  `SEND_TIMEOUT` (5 s): the Welcome, a Reject, and each drained batch (feed and flush, including the closing Reject and
  Close); a write stuck for that long ends the connection. Each connection has a process-unique id: a
  seat ignores input, disconnect and leave from a connection its resume replaced.
- Telemetry: a room's step times are a fixed 384-byte log-linear histogram (`crates/rh-server/src/metrics.rs`, 4 sub-buckets
  per power of two). `/info` `closedRooms` `stepUsP50` and `stepUsP99` are **bucket upper bounds** (never below the true
  value, at most 25% above it); `stepUsMax` and `ticks` are exact. `/control/health` also carries process-wide counters
  and histogram summaries under `metrics` (wakes, steps, droppedSteps, bytesOut (snapshots at `min_len`, as per room), outboxPushes, stepUs, publishUs,
  latenessUs, rssBytes). `/info` also carries `resultsRefused` (result writes the store refused for good) and, per closed
  room, `crashed`, `frameRefusals` and `frameRefusalsLogged` (all room stats keys are camelCase since H-server-2, pinned by
  `info_and_closed_room_keys_are_exactly_these_camel_case_names`).
- Every room phase change is reported to the director; a lobby that closed into its run is never offered to a new player.
- Crash safety (H-server): each call into a room (wake, handle, close) is wrapped in `catch_unwind`. A panic closes the
  room's connections and reports `Closed` with `crashed = true`, so the director frees its seats and gives their leases
  back (`director.rs`, room-panic test).
- Durable I/O never runs on a room task.

## C-POLICY
See [adr/0005-policy-seam.md](adr/0005-policy-seam.md). `rh_policy::{Policy, Seat, AsyncSeat, drive_seats}`.
- Contract v2 (L-sim): `POLICY_CONTRACT_VERSION` is 2 and `OBSERVATION_VERSION` is 2. `Policy::reset(&mut self, m: &MatchStart)`
  replaces `reset(seed, me)`; `MatchStart { me, seed, arena: Arc<Arena>, content_hash, observation_version, tick_ms }`, where
  `seed` is the policy's own public seed (never `Secrets`) and the arena is public static data (map and spawn points).
  `Seat::new` and `AsyncSeat::spawn` attach a policy whose contract or observation version differs already faulted (a typed
  `Fault`; the fallback plays) and never call `reset` on a refused policy, so every v1 policy is refused at attach and the match
  still runs. Open: `policy.reset` and the fallback's `reset`/`decide` are not wrapped in `catch_unwind`.
- A seat is observed (an `Observation` is built) only on its decision ticks (`Seat::wants(tick)`); `Policy::decide_into`
  has a default that wraps `decide`, so `POLICY_CONTRACT_VERSION` did not change (P9).
- Events between decisions accumulate, bounded. After every step that is not a decision tick, the seat is told what it could
  perceive of that step's events, judged against that step's own line of sight like a human's
  (`rh_sim::observe_events_into`), and holds them in a per-seat buffer capped at `MAX_PENDING_EVENTS` = 256
  (`crates/rh-policy/src/lib.rs`). Overflow rule: the oldest are dropped first. The next decision's observation carries the
  held events first, in step order, then the events of the step just before the decision; the buffer is then emptied. A
  policy therefore sees every event it could perceive whatever its decision interval, except after a gap of more than 256
  perceivable events. Scripted-bot outcomes are unchanged (outcome digest and state-hash fold identical to the base).

## C-PERSIST
See [adr/0006-persistence.md](adr/0006-persistence.md) and `crates/rh-persist/README.md`.
- Identity and the record (L-durable). A profile is its surrogate `profile_id` (identity primary key); the callsign is a unique
  (by `lower()`), renamable display attribute, resolved once at the edge: admission (`acquire_lease`) returns the id, and a live
  match banks its result and releases its session lease by that `profile_id` (`Store::*_by_id`, renewal included), never by
  callsign, so a rename mid-match cannot lose a result, strand the lease or credit the wrong profile
  (`rh-server/tests/lease_conformance.rs` `a_rename_after_admission_banks_once_and_frees_the_lease`;
  `rh-persist/tests/durable.rs`). The server carries the id in `Persistence` (a map keyed by admission name and fence), not
  through the room protocol, which is still fence-only; a process that did not admit the lease falls back to the callsign. The
  server does not renew yet (no lease renewal, below). All child tables reference `profile_id`.
- `match_results.result` is the complete `RunResult` as camelCase JSON with `"v":1` (`RESULT_VERSION`); fields added later must
  have a default. A `matches` row (owner, region, placement, build, content hash, humans, bots, replay ref) is written
  idempotently in the result transaction of the match's first result; `matches.ended_at` is the time of the latest recorded
  result. `faction`, `weapon` and `killedBy` (a callsign today) are not filled yet (P-PERSIST-2); `region` and `placement` wait for
  P-HOST-1.
- Profile JSON blobs (`Stats`, `Progress`, `Cosmetics`) are tolerant: `#[serde(default)]` plus a flattened map of unknown keys that
  survives a write-back by an older binary. A binary is gated by `schema_compat.min_binary` (one row), not by the presence of
  newer migrations, so additive migrations allow expand/contract rollouts (`rh-persist/README.md`); the store refuses a
  database whose `min_binary` is above the binary's newest migration.
- Durable content ids (faction, weapon, cosmetic and achievement strings, `outcome`, `winBonusWhy`) are keys and values in stored
  JSON and are **append only**: a rename or removal fails `rh-server/tests/durable_ids.rs` and `rh-persist/tests/ids.rs` (both
  in the default `cargo test --workspace`).
- There is exactly one global writable primary (ADR 0006, topology): profiles are not region-homed, and leases and fences
  depend on that. The initial migration `0001_init.sql` was rewritten in place before any production database existed (local
  and test databases must be recreated); after the first deployment an applied migration is never edited.
- Profile ownership in process (`crates/rh-server/src/director.rs`, ownership invariant in the doc comment on `Inner`;
  H-server). There is one entry per profile. While it exists, a new admission for the profile is refused `ProfileInUse`. Each
  entry has an **owner token** (`gen`, unique per admission), a state (`Reserved`, `Seated`, `Leaving`), `result_due`, a count
  of result writes in flight and a lease state (`Held`, `Releasing`, `Gone`). Only an admission creates an entry (`Reserved`),
  and only that entry's owner removes or changes it: the admission's own unwinding, or the give-back or result write of the
  seat it became, each naming its `gen`. A room's `Closed` never touches a reservation.
- If the entry is `Leaving` (the profile left, was dropped past the reconnect grace, or its room closed or crashed), the
  admission waits for it to go. **One `LEAVING_WAIT` (3 s) deadline covers the whole admission, retries included, and it starts
  before authentication** (a slow database `auth.verify` eats into it); `admit()` may retry a closed match or lobby up to 4
  times but never waits longer than that deadline in total. The admission is then admitted or refused `ProfileInUse`. A failed
  attempt keeps its entry `Leaving` until its own lease give-back lands, so a dead-lobby retry waits for it instead of racing it.
  A profile with a LIVE seat is refused immediately (one live seat per profile; the durable fenced lease covers cross-host
  ownership).
- A seat that left has its lease given back only when no result is due or in flight for it; a result write that lands
  releases the lease in its own transaction, so a give-back never runs in parallel with the write it would fence out. A write
  the store refuses for good (`NoLease`, `StaleFence`) is not retried: the loop stops at once, counts it in `resultsRefused`
  and frees the profile; only transient errors back off and retry. A `Left` for a seat this process holds no entry for still
  releases its fenced lease. After a room crash, `Closed` lets go of `Seated` entries and clears `result_due`.
- Tests: director unit tests on `MemoryStore::strict` (rh-persist's lease rules minus expiry, with optional release and
  record delays on the tokio clock): the dead-lobby retry waits for its own give-back, one deadline for the whole admission
  (refused at exactly 3.000 s with three dead lobbies), a result in flight keeps the lease, a refused write is not retried,
  entries change only through their owner, a room panic frees seats and leases. Each was mutation-checked. Also
  `tests/pg_e2e.rs`. Known gap: no `pg_e2e` case for a dead-lobby retry (it needs a test seam; the race is covered only by
  the strict-memory director test). `AlreadyApplied` results do not give the lease back (benign: the earlier write released it).

## C-HOST
See [adr/0004-hosting.md](adr/0004-hosting.md). `crates/rh-server/src/hosting.rs`: Starting → Ready → Draining →
Terminated; `/control/health` (200 only when Ready), `/control/drain`; SIGTERM/Ctrl-C drains; draining refuses new
admissions with `ServerDraining`, lets running matches finish, and terminates when the last room closes. `/control/health`
also carries the process `metrics` object (see C-NET); a panicking room is reported `Closed` (C-NET, crash safety).

## C-PERF
`.github/workflows/perfproof.yml` runs `tools/perfproof/perfproof.py` against the pull request's merge-base (or a
`workflow_dispatch` baseline) when a PR touches `crates/**`, `parity/**`, `Cargo.*`, `rust-toolchain.toml`,
`tools/perfproof/**` or the workflow. It fails on Ir per unit of work above 1.03x (`--max-ir-ratio`), any allocation
increase per unit (`--max-alloc-increase 0`), or any behaviour-fingerprint difference (outcome digest, state hashes, replay
verification of base-recorded replays). A PR that changes behaviour on purpose declares it with one description line,
`Perf-Allow-Fingerprint: <workload|key|workload.key>, ...`; the description is read when the job runs (`gh api`), and
`edited` re-triggers it. The 1.03 threshold sits well above the measured noise, which is **not** +-0.02%: the sweep-wide
review measured a revision against itself at about -0.1% (0.9989, 0.9994, 0.9991 on the three `sim_*` workloads) and up to
0.3% on the smallest per-step workloads (0.9971 between two revisions with no Rust change). Instruction counts are
architecture-specific; compare A/B on one machine. See [CONTRIBUTING.md](../CONTRIBUTING.md). Open: the first real PR run
should confirm the cache mapping and the `apt-get` valgrind install time; perfproof has no `densitybench` workload (those
figures are taken by hand).

## C-PARITY
`parity/README.md`: discrete outcomes exact; continuous values within 2e-6. The harness must fail when a rule changes
(`a_changed_rule_is_caught`).

## Change log
- Efficiency and lock-in passes (merged at `b326676`; E-sim, E-pub, E-backlog, E-simplify, E-sight, L-envelope, L-durable, L-sim,
  L-v4): C-NET moved to protocol v4 (ADR 0011: append-only varint masks, actor kind and the id namespace, the reserved State
  message, the admission ticket, the Result kept across a resume) and gained the frozen cross-version envelope and the Unity
  API rule; C-PERSIST gained the surrogate `profile_id`, the versioned match record, tolerant blobs, the `schema_compat` gate and
  append-only durable ids; C-DET gained the build and content headers, the `ContentMismatch` refusals and the derived sight
  memo; C-POLICY moved to contract v2 (`MatchStart`); C-OBS gained the optional damage source (a sourceless kill credits nobody)
  and C-TICK `FighterIx` addressing; C-NUM records the kernel fast paths as bit-identical. Evidence:
  [sweep/README.md](sweep/README.md), "Efficiency and lock-in pass".
- Stage 1: initial contracts.
- Core sweep complete (P10c merged at `ae0c37b`): C-NET moved to protocol v3 (per-connection Delta frames encoded in the
  writer task, deferred never-dropped Resync with forced Fulls spaced by 20 ticks, `v3.json` replaces `v2.json`, the room
  counters `snapshotsFull`/`snapshotsDelta`/`snapshotBytesSent`); ADR 0010 is implemented. The status table now names the
  revision each H-sim cell was validated on. Evidence: [sweep/README.md](sweep/README.md).
- Core sweep, H-sim record (merged at `2e8682c`): C-DET gained the restore refusal rules (two layers,
  refusal and saturating arithmetic) and `restore_real.rs`, which replaces the "not done yet" note on `next_id`; C-INPUT
  records the opaque `Command` and the replay format check. H-server-2 renamed the `/info` closed-room keys to camelCase (`stepUsP50`, `frameRefusals`, ...; C-NET), and its other
  fixes (no session for a gone room, duplicate result reports give their lease back) changed no contract text.
- Core sweep, final record (P8, P9, CI, P10b measurement and H-server merged at `3ad072b`):
  C-DET gained the derived state hash, `rh-replay/2` and the layout rule and lints; C-RNG records that the state hash is
  server-private (it depends on `spawn_seed` through `spawn_rng`); C-OBS gained exhaustive event visibility and class,
  per-ordered-pair sight and per-step catch-up filtering; C-POLICY gained due-only observation and the bounded event
  accumulation (256, oldest dropped); C-PERSIST was rewritten around owner tokens, lease states and one admission
  deadline (the earlier "4 x `LEAVING_WAIT`" worst case is gone); C-NET gained the Ping/Pong bucket charge, reader
  fairness, bounded Welcome and Reject sends, refusing Events/Fx encoders and stricter decoders; C-TICK gained the
  overload drain; C-HOST gained room-crash safety; C-PERF is new. Protocol v3 was accepted (ADR 0010) and shipped later by P10c.
  Evidence: [sweep/README.md](sweep/README.md).
- Core sweep, first record (P2b, P10a, P7a, P5b, P5c, P7b, P5d merged; P8, P9, P10b, CI pending at that time): C-TICK gained the executable schedule,
  hooks, the same-tick `payLater` seam and the biased room loop; C-NET moved to protocol v2 and gained batched egress, the
  biased reader, the batch `SEND_TIMEOUT` and the telemetry description; C-DET gained `rh-checkpoint/3` and the
  zero-allocation step; C-INPUT gained `Cx::submit`; C-PERSIST gained the bounded rejoin wait. Evidence:
  [sweep/README.md](sweep/README.md).
- Stage 1 exit review: C-PERSIST and C-HOST statuses corrected after independent review found defects (fixed, with
  regression tests); C-NET gained liveness and connection identity; C-RNG records the tie-outcome observability.
