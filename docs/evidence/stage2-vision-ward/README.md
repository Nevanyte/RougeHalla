# Rust camp-ward sight (P-VISION-1 remainder)

Branch: `deepseek/p-vision-1`, based on `origin/deepseek/p-arena-1` (`1fd4bb44`, wire protocol 8).

Stack note: `origin/deepseek/p-mobs-1` appeared during the slice but is a **parallel sibling** line off the faction head
(`91d2dc52`, wire protocol 7), not a descendant of the arena transport. This slice does not depend on the new mob
roster/AI work: the camp ward producer and the published camp state it reads already exist on the arena line. It is
therefore opened against the protocol-8 arena head as instructed, and not rebased onto `p-mobs-1` (which would drop
protocol 8).

## Packet assessment (verified from code and git before writing)

P-VISION-1's "remaining scope" listed four open producers/behaviors. Their verified status on the arena-line base:

- **Owned ward producer: already ported.** `systems/mob_life.rs` sets `CampLife.ward_owner`/`ward_expires_at` at the
  camp clear from the final mob's whole-fight killer (`CAMP_WARD_MS`); `systems/mobs.rs` clears it on respawn;
  `tests/hash_coverage.rs` already records the invariant. The **consumer** was missing: no vision or projection path
  consulted the ward (`grep -i ward crates/rh-sim/src/vision.rs` was empty; the source clause is
  `packages/server/src/sim/vision.ts:56-62`, and its three installed consumers are the targetability queries and the
  private projections). This slice implements it.
- **Ability-cast exposure producer: already wired.** `vision::cast_exposure` is called from the ability cast intake
  (`systems/abilities/mod.rs`) and shares the attack producer's delayed queue (`attack_started` -> `apply_exposures`);
  the bush/coliseum parity scenario already covers the exposure path. No remainder here.
- **Dynamic gate/teleport behavior: already implemented and captured.** P-ARENA-1's arena source fixture carries the
  `gate-history-open-lock-unlock` vision transition (same-tick teleport reveal + the retained per-variant expiry
  table); `systems/planning/source_tests.rs` compares the actual hook's before/after private memory, and
  `vision_arena_tests.rs` pins the helper-level expiry retention across the geometry change. The ward clause this
  slice adds uses the current collision variant, matching `isInVision(collisionMap, ...)`.
- **Hunter reveal: blocked by P-FACTION-4.** `schedule.rs` registers `ActionId::HuntTarget` as
  `Run::Pending("P-FACTION-4")` and no Sentenced hunt target state exists, so there is no legitimate public target
  record to resolve a private actor from yet. Nothing this slice may implement.
- **Training behavior: blocked by P-ARENA-2.** `settle:training` is still `pending("settle:training", Gate::Training,
  "P-ARENA-2")` and `SimConfig` has no training-world admission; the source's `config.training` branch (unrestricted
  sight, bush concealment skipped) cannot be reached in Rust yet.
- **Target-locking C3 correction: already ported.** `vision::gameplay_actor_visible` computes the prospective due
  pre-movement self-origin view independently of candidate existence and the authoritative lock path commits the due
  sample via `refresh_player`; the source-helper probes are in `systems/planning/source_tests.rs`.

## What landed

**Ward sight through the single visibility boundary.** `vision::WardSight` is a borrowed view of the admitted camp defs
and `MobRuntime.life` (no copy, no allocation on the hot path) threaded into `point_with`, `actor_with`,
`point_visible`, `actor_visible`, `gameplay_actor_visible`, `TileVisionCache::sees` and `Sim::can_see_point`. It
reproduces the source clause exactly:

- owner-exact (`ward_owner == viewer`) and exclusive expiry (`now < ward_expires_at`; the source test is strict);
- the camp's **map centre** as a transient current origin: 900-unit radius plus the existing first-wall-face sight
  trace on the **current collision variant** (so gate locking applies), never the viewer's own origin;
- **never remembered**: ward sight does not append to `vision.reveals`, and the captured `VisionMemory` probes prove
  the source trail stays empty;
- the viewer must be alive and seated (the existing boundary's status rule).

Every consumer that decides what a player may see now passes the same context: targetability
(`systems/targeting.rs`, `systems/abilities/mod.rs`, `systems/items.rs`) and every private projection
(`observe.rs`, `item_view.rs`, `projectile_view.rs`, `reward_chests/observer.rs`, the ability-field projection and
the fx report), plus the `actor_with` path used by event catch-up. Camp life is the authority, so there is **no new
serialized private state**: no checkpoint, replay, state-hash, content-hash or schedule-row change. The tick order is
untouched (C-TICK: no link added, moved or reordered). No wire change: `crates/rh-protocol`, the protocol fixtures and
the C#/JS decoders are untouched and `PROTOCOL_VERSION` stays 8.

## Captured source evidence

`tools/vision-fixtures/ward-sight.ts`, captured only in the pinned Linux x64 Node 22.23.4 container
(`c86ecead9e55`, read-only `/repo`, committed fixture `parity/vision/ward-sight.json`, byte-identical after a fresh
re-capture). The program installs the real gameplay assembler, places the seats and runs the **actual producer chain**
`mobLife.hurtMob` -> `killMob` -> `camps.campMobDied` on the certified seed-1 generated map; every verdict is the
exported `canPlayerSee` / `canPlayerSeeActor` / `VisionMemory` answer (1,353 probes over five cases):

| Case | Coverage |
|---|---|
| `producer_and_two_camps` | two camps cleared by two different owners through the actual kill path; published camp/ward fields after **every** mob death; a 15x15 tile-centre grid around each camp for both viewers; exact 900-unit boundary points; ward-visible actor probes; empty private trail |
| `engaged_only` | camp engaged but not cleared: no ward, every probe false |
| `expiry_boundary` | `wardExpiresAt - 1` visible, `wardExpiresAt` invisible, `wardExpiresAt + VISION_TRAIL_MS` invisible (no residual trail) |
| `dead_missing_locked` | dead owner, absent viewer id, and the same grid with `gatesLocked` |
| `ward_bush_actor` | a bush point visible through the ward while the actor standing in it stays concealed (`bushConceals` after point visibility) |

The Rust test (`crates/rh-sim/src/vision_ward_tests.rs`) replays each case through `Sim::reset_active` (mob PvE mode,
the same certified map), performs the same kills through the ported `mob_life::hurt` producer and compares the
published camp/ward fields after every death, then every captured verdict through `Sim::can_see_point`, the private
observation actor list and the ported trail. Public sampling must leave the state hash identical. A mutation guard
clears the captured expiry and moves the owner to an unknown seat and requires both to change the verdict.

## Verification

- Whole-workspace gate: `cargo test --workspace --all-features --locked` (PostgreSQL via `tools/pgtest/start.sh`,
  pinned Rust 1.97.0 toolchain): **1,426 passed, 0 failed, 3 ignored across 151 test binaries, exit 0**.
- `cargo fmt --all --check` clean; `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`
  clean.
- `cargo run -p rh-parity --bin parity-report`: **97 slice scenarios + 13 capture-only, 300 pathfinding queries: all
  MATCH** (no tolerance widened; the original `vision_trail_wall` / `vision_bush_coliseum` slice fixtures still
  match).
- Focused: `cargo test -p rh-sim --lib vision::ward` **2/2 passed** — 1,353 captured source verdicts, the producer
  field-by-field replay and the owner/expiry mutation guard.
- Capture: `parity/vision/ward-sight.json` sha256 `b38058f8b2ad43280a2fee2659d3db7892a25017aeeed84e1cf28b6212b9bba4`,
  reproduced byte-for-byte by a fresh pinned-container capture.
- Pull request: [#42](https://github.com/Nevanyte/RougeHalla/pull/42) (base `deepseek/p-arena-1`, the protocol-8
  arena head). Mechanics head `20acb6fe`; the range is `1fd4bb44..20acb6fe`.
- No wire change, so the C#/JS/browser wire suites were not required: `PROTOCOL_VERSION` remains 8 and
  `protocol/fixtures/v8.json` plus the Rust/C#/JS decoders are untouched. No schedule row was added, moved or
  reordered.


## Remaining work (the packet stays INCOMPLETE)

- **Hunter reveal** (P-FACTION-4): needs the Sentenced `huntTarget` action/state and its legitimate-public-target
  resolution before `canPlayerSeeActor`'s hunter exception can be ported.
- **Training worlds** (P-ARENA-2): the unrestricted-training vision branch needs training-world admission first.
- The client-side ward fog is presentation only (the source client rebuilds ward light locally from the published camp
  state); this slice is the authoritative server boundary. Publishing ward visuals on the Rust wire is not part of the
  packet and is not claimed.
