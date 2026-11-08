# P-ARENA-2: training rooms and the `train` console

Status: **DONE-VERIFIED on this branch's stack (all five slices).** Round 1: the training world lifecycle, the dummy
actor kind and the practice setup. Round 2: the `train` console (the sixth schedule row) with its caps/gaps/refusals and
owner-only toasts, plus OBS 15 → 16 (the public training fact and `SeenEvent::Toast`). Round 3: the complete protocol-8
C-NET set (Train wire command, Snapshot training head/delta bit, Toast wire event, dummy actor kind on the wire, the
regenerated `protocol/fixtures/v8.json`, both decoder mirrors, the JS probe and the browser proof). Round 4: the server
training-room lifecycle (director isolation, one seat, no bots/results/banking/telemetry, the 300 s accepted-input idle
close). Round 5: the pinned-container actual-source capture corpus, the native parity test over it and eight killed
mutants. Base: `deepseek/p-cards-2` @ `2895e05a`; branch `deepseek/p-arena-2`; stack P-ARENA-2 on P-CARDS-2 on P-MOBS-1 on
P-TERRAIN-1 on P-ABIL-1 on P-FACTION-1 on P-CARDS-1 on P-CONTENT-1 over `856618eb` `optimization_port`. The only
outstanding item is the coordinator's protocol-9 spine merge/renumber (designated, not this branch's code).

## Lead-approved decisions (2026-11-07, as executed)

1. Base `p-cards-2` @ `2895e05a` with the prerequisite chain as an ancestor: done. The approved local protocol 7 → 8
   transport, its C-NET set and the browser proof are complete on this branch; the protocol-9 spine collision/renumber is
   designated for the coordinator (see the collision note).
2. Room admission: RoomConfig/room behaviour + native `rh-server` tests are implemented and the director refuses a training
   profile; the public creation route stays deferred to P-HOST-1/P-NET (no client route was invented).
3. Toasts: owner-only `Event`/`SeenEvent` plus the protocol-8 Toast wire event, as part of the 8 bump.
4. Scope: all six schedule rows, the dummy actor kind, lifecycle + guards, the console, the room, the pinned capture corpus,
   parity and mutants, evidence and one stacked PR (#48) — all delivered.
5. Acceptance: full gate + clippy `-D warnings` + fmt on the final tree; the wire set completed end-to-end before
   `PROTOCOL_VERSION` was bumped; no `docs/MIGRATION.md`, `docs/CONTRACTS.md` status table or `Cargo.lock` edits; no legacy corpus
   regenerated from Rust output.
## Verified slices (DONE-VERIFIED)

### Training configuration and gates

- `SimConfig` gains `training` and `dummies` (serde default; `skip_serializing_if` false so every existing config's
  JSON and statics digest stay byte-identical — confirmed by the ability hash tape below).
- `schedule::Gates::of` returns `Gates::TRAINING` for a training world, so the already-recorded `TRAINING_PLAN` is now
  reachable; its training-only rows run at their recorded positions (C-TICK, no reorder).
- `systems/mobs::initialize` gives a training world the shared actor runtime with **empty** map-camp rosters and
  `combat: true` (legacy `camps.ts install`: never for training), and draws no roster RNG.

### Dummy / practice actor kind (the blocker P-MOBS-1 deferred)

- `mob_runtime::MobKind` {Regional, Practice, Dummy}; `ActorOrigin` gains append-only `Practice` and `Dummy` variants
  (existing variant indices unchanged); `Mob.mob_type` becomes `Option<MobTypeId>` (absent only for a dummy);
  `Mob::born` builds all three kinds.
- A dummy is exactly the source's: hp/max `DUMMY_HP` 5000, no catalog type, no camp, no brain, placeholder faction for
  storage/wire while `World::base_sheet` pins its armor/shield to 0 (source has no faction sheet), optional shield in hand,
  faces the spawn, and `point_damage` keeps a reflected shield packet unmodified.
- Dummy damage (legacy `mobs.ts damageMob`): a hit that would reach ≤0 refills to max, records `lastHitAt`, never dies,
  no camp/threat/payout; `mobs.resetDummies` heals to full after `DUMMY_RESET_SECONDS` 3 s unhit; corpse regen skips dummies.
- Practice mobs use camp refs 101..255 beyond the map's camps (legacy `PRACTICE_CAMP_FIRST..LAST`): the training hurt path
  skips all map-camp roster/contributor/life state (the legacy code tolerates a camp with no map entry), while camp-wide
  aggro by camp equality (D24) still works. Training checkpoint admission is a separate validator
  (`systems/training.rs::validate_actors`): empty rosters, no map-born mobs, dummy/practice identity and bounds; the map-camp
  validators reject training actors explicitly.
- Wire/observation: dummy actors are observed with the dummy actor kind (2) and no catalog type; practice actors keep
  kind 1 + type. (The wire decoder/vector half of the actor-kind addition remains with the protocol step.)

### Training lifecycle and the practice setup

- Five of the six schedule rows are flipped in place: `settle:training` (ACTIVE, after `hooks:systems`),
  `mobs.resetDummies` (SYSTEMS), `training.<arrow>` dropBody `Replace` link, `mobs.spawnTraining` raidStarted link
  (`Gate::Dummies`) and `training.<arrow>` raidStarted link (`Gate::Training`, clears the patience deadline). The sixth
  (`ActionId::Train`) stays `Run::Pending("P-ARENA-2")` — no handler is faked.
- `training::settle` replaces the arena settle in a training world: nobody's run is settled or banked; a dead fighter is
  revived where they fell at full health, at rest (history/slip/path reset, weapons runtime reset, fate/last-hit cleared).
  A down inside a tick and a between-tick down that already resolved a result both end up revived; a removed player is
  gone and a `mia` player stays mia. The tick path performs no allocation (no new `Vec`/`String`).
- `training::spawn_training` (raidStarted, after the faction links): per player a plain dummy, a shield dummy facing the
  spawn and a rack of one loose weapon of every loop id, 3–6 tiles away on free floor reachable from the spawn, preferring a
  visible tile for the dummies; a five-tile row/column when the floor allows, else nearest tiles; spawns/players/
  containers/mobs and every piece placed keep their tiles across players. Deterministic; draws nothing from any RNG.
- Source-position training guards: regional spawn skips training (`systems/mobs::raid_started`), practice kills pay no
  GV/feed/stat/weapon/drop/chest but still emit the death fx, fire `fighterOut` and wake the camp
  (`mob_life::kill_training_mob`), `pay` and `respawn` return in training, and dummy hits never touch the ledger's kill path.

### Evidence and tests

- New native tests (5): the active-from-tick-1 training world with plain + shield dummy and the five-weapon rack at 3–6
  tiles; the arena control (no dummies/rack); a dummy never dying and healing exactly at the 3 s reset boundary; a down
  player revived where they fell at full health with their weapons, both inside a tick and between ticks; a 400-tick
  training run never resolving or ending.
- The ability hash tape was re-recorded with its documented ignored driver (`--ignored record_ability_hash_tape`): the two
  new `SimConfig` switches are part of the statics digest (the hash layout rule forbids `skip_serializing_if` on hashed
  state), so every recorded case's fold moves once; the actor-kind extension additionally moves the seven mob-bearing
  cases. All 57 tape entries are regenerated by that driver, never edited by hand (`parity/abilities/hash-tape.json`;
  the prior precedent on this line re-recorded the tape per layout change, e.g. P-CARDS-1/P-ABIL-1 commits). The
  `TRAINING_PLAN` scheduling test and the capture plan's systems list were updated for the flipped rows (`resetDummies`
  is installed in every world, as in the source). The round-2 `World.practice` field (a serialized Option on the hashed
  world) moves the state hash of every world once more: the tape was re-recorded again with the same ignored driver, and
  `tests/hash_coverage.rs` documents the two coupled leaves it adds (`world.practice` filled in an arena checkpoint is
  refused by the arena actor validators; the training config switch is admitted only with the training runtime/origins).
- Content registry: the training/dummy gameplay numbers are appended to `content!` (the documented rule for a new
  gameplay number), so the content identity moves once — the new `content_hash` is `408b43a687105dc6` and the pinned
  `GOLDEN_CONTENT_HASH` was updated with it. No runtime behaviour outside training changes, and no protocol/vector bytes
  move (protocol stays 7).
- Hash coverage (`tests/hash_coverage.rs`) gained three documented restore-refused validations for the new leaves: the
  training config switch (admitted only with the training actor runtime/origins), and a mob's kind/catalog type (coupled to
  its retained birth origin and the world's admission). All other new leaves perturb the state hash.

### The `train` console (round 2)

- The sixth row is flipped in place: `ACTIONS[ActionId::Train]` is `Run::Ported(training::handle_train)` under
  `Gate::Training` (row order unchanged, C-TICK); an arena world never runs it and the submit door refuses a `train`
  command there with `Reject::InvalidTrain`.
- Input model: `WireCommand`-shaped `TrainRaw` → validated `TrainCommand` at the one door (`input::validate`):
  command byte 1 card / 2 stat / 3 camp / 4 chest / 5 clear, ids are catalog positions (unknown ids refused), counts are
  clamped to `TRAIN_MAX_CARD_COUNT` 9 / `TRAIN_MAX_MOB_STAT_COUNT` (2^53−1), a chest carries at most three chosen card
  positions. `Kind::Train` round-trips through `Kind::raw`/`validate` exactly (recorded replays keep their shape), and
  `ActionCmd::Train` maps to `ActionId::Train` in the action order.
- The handlers are the source's:
  * **card** (`trainCard`): only a live interactive augment (the catalog's augment kind + the source's interactive ids);
    a conditional needs its base in the build first (refusal toast "Title: Needs <Base>"); a unique card is held once;
    counts set/remove via `Build::set`; rows re-folded (`modifiers::recompute`), max hp synced; removing a card re-arms
    its once-per-run fires and drops the earned Tank hp unless a fortify trigger remains; the toast is the source's
    ("Title xN: text (not live yet: no effect)" / "Title removed").
  * **stat** (`trainStat`): a normal type's fixed-stat stacks set/cleared through `Farm::set` + re-fold/sync; the toast is
    the source's cumulative text ("Name: +X% damage total" with the per-stack values and the one-decimal/percent shape).
  * **camp** (`trainCamp` + `campSpots`/`nextCampRef`): 300 ms gap ("Slow down"), 12 alive cap, 150 spawned cap, camp refs
    101..=255 wrapping and skipping refs still in use (stored as the source's 0-based camp on the mob), a centre 5–9 tiles
    out preferring 7 that the player can see and walk to, then the tiles nearest it (≤2 tiles) for the other mobs; an
    elite type is a lone elite; the toast is "Practice camp: N x Name[(elite)]".
  * **chest** (`trainChest`): 300 ms gap, 6 chests cap, a free floor tile 1.5–3 tiles out (target 2) in view; the chosen
    options are filtered to live interactive augments, an empty choice list rolls the normal augment pool with the reward
    RNG in the source's draw order; the toast names the options with the not-live note.
  * **clear** (`trainClear`): build, mob-stat stacks, chest boosts, card memory (via `cards::runtime::reset_player`),
    barrier and Tank hp reset; rows re-folded and max hp synced; every practice mob and its in-flight projectiles and every
    reward chest removed (projectile "cleared" ends); the spawn counters stay (a clear does not refund the room), and the
    toast is "Cleared: cards, practice mobs and chests".
- `World.practice` (`PracticeRuntime`: spawned, last camp/chest times, next camp ref) is serialized, hashed and validated:
  a training world requires it and bounds it; the arena/PvE validators reject it. The tick's `settle:training` path stays
  allocation-free (the console allocates only on its own action, never per tick).
- Toasts are native core events: `Event::Toast { to, text }` is owner-only and `Class::Important`; `OBSERVATION_VERSION`
  moved 15 → 16 with the new public `Observation::training` fact (from `SimConfig.training`) and
  `SeenEvent::Toast { text }`. The server's protocol-7 encoder deliberately omits the toast (the wire transport is the
  deferred protocol-8 set), so no protocol/C#/JS/vector bytes move in this round.
- New native tests (8): the arena door refusal, the training observation fact/version, card set/remove and the
  unsupported-card silence, the mob-stat stacks and text, the camp gaps/alive cap/new refs plus a 40-tick brain run,
  chosen chest options plus the gap and six-chest cap, and the full clear (dummies stay, counters do not refund).

### The protocol-8 wire set (round 3)

The approved 7 → 8 C-NET set is complete and verified end-to-end; %%PROTOCOL_VERSION%% is 8 and
%%protocol/fixtures/v8.json%% is regenerated by its bin (%%cargo run -p rh-protocol --bin protocol-fixtures%%).

- **Tags and numbering.** The practice console client command is tag **13**; tag 12 stays reserved for the pending
  P-ARENA-1 plan command (this training line and the arena/cons line each bump to their own 8 — see the collision note
  below). The owner-only toast is event tag **8**. The Snapshot training fact is **head bit 14** on a Full frame and
  **delta head bit 18**; both are append-only and absent for every ordinary match, so a non-training frame is
  byte-identical to v7 apart from the version number.
- **Rust protocol.** %%WireCommand::Train { command, id, count, options: [u8; 3], option_count }%% (command 1..5, options
  at most 3; the count is a full %%u64%% so the sim's 2^53−1 stat cap survives the wire); event %%WireEvent::Toast { text }%%;
  %%ServerMsg::Snapshot.training%%; %%SnapshotData::training%% with %%set_training%% (and the delta bit in the streamed and
  reference writers); every decoder/encoder/%%encoded_len%%/check arm; the format contract tests updated (undefined head bits
  are now 15/19, %%DH_KNOWN%% through bit 18) and the v4 pinned-bit table extended with the training bit.
- **Vectors.** New samples: %%input_train%% (all five console commands, a chest with three chosen card positions, the largest
  stat count), %%events_toasts%% (both source texts), %%snapshot_training%% (training bit + a dummy actor kind 2 with no
  catalog type) and %%snapshot_delta_training%% (the delta bit). %%protocol/fixtures/v8.json%% is committed; the Rust, C# and
  JS decoders all pass it byte-for-byte.
- **Server mapping.** %%wire::command%% maps %%WireCommand::Train%% to %%PublicCommand::Train(TrainRaw)%% (the sim's door then
  validates catalog ids/caps and refuses it outside a training world); %%checked_snapshot%%/the publisher set the training bit
  from the public observation (%%SnapshotData::set_training%% on the streamed frame); %%to_wire%% now maps
  %%SeenEvent::Toast%% to the protocol-8 event instead of omitting it; %%wire_actor%% already passes the observed actor kind
  through, so a dummy reaches the wire as kind 2. A new in-crate wire test covers the training snapshot, the Train mapping
  and the toast mapping.
- **C# mirror.** %%Codec.ProtocolVersion = 8%%; %%CommandKind.Train = 13%% with encode/decode/length; %%EventKind.Toast = 8%%
  with its text; %%WireSelf.HTraining%% (bit 14) on the Snapshot (length/encode/read); %%SnapshotDelta%% bit 18 and the
  %%SnapshotTracker%% carrying the fact into the resolved snapshot; three explicit protocol-8 tests (Train fields, training
  snapshot/delta, toast). The Unity asset mirror is resynced (%%client-unity/sync-net.sh%%); **275/275** C# tests pass.
- **JS probe and proofs.** %%crates/rh-server/web/probe.html%% speaks v8: Train decode/encode, toast event, both training head
  bits and the tracker's carry; %%tools/protocol-js/check-vectors.mjs%% passes **15,663 checks** on the v8 vectors (all 27
  server vectors, 89 malformed frames, 10 delta chains); %%tools/browser-proof/proof.mjs%% reports **PASS** against a real
  Chromium page and the Rust server (protocol 8, contentHash %%408b43a687105dc6%%, full-first-then-deltas, wrong-protocol
  refusal before state, two players, both results ok).
- **Observation.** OBS 16 (round 2) already carries the public %%training%% fact and %%SeenEvent::Toast%% to policies; the wire
  step did not move it again.

#### Protocol-9 spine collision (for the coordinator)

This line's %%training-8%% and the arena/cons line's %%arena-8%%/%%cons-9%% are siblings, not ancestors: the training line is
P-ARENA-1 on the cons spine vs P-ARENA-2 on the prerequisite spine, so the coordinator merges and renumbers:
- command tags: the arena line reserves **12** for its plan command and adds **13** only after this line's Train tag 13 is
  reconciled (rename one, or sit Train at 14) — the wire tags are append-only per line, not across the merge;
- observation versions: both lines bump OBS 15 → 16 independently (the arena line for its planning observation, this line for
  the training fact and toast), so the merged contract must bump to a single **17** and update the policy pin there;
- head bits: this line uses Full bit 14 and Delta bit 18 (append-only, absent when false); any bit the other line allocated in
  the same window must be reconciled in the merged head table, with the pinned-bit tests updated once.
None of this touches the code here (this branch's tree is self-consistent at 8); it is the integration step's renumber.

### The training-room lifecycle (round 4)

A room constructed with a training simulation config is the practice room; nothing invents a public route for it:

- **Admission isolation.** The matchmaking director refuses a training profile outright (`refuse_training_profile`, asserted
  before any hosting work), so the hosted path cannot start one; the public creation route stays deferred to
  P-HOST-1/P-NET and native tests construct a `Room` directly with a training config.
- **One human, no bots.** A second human join is refused (`RejectCode::MatchFull`); `fill_to` is forced to 0 even if the
  hosting config asks for bots, so the practice room is the source's solo seat.
- **No results, banking or telemetry.** `keep_results` and `report_results` return early in a training room; the wake filters
  `Event::Resolved` out before keeping, publishing or reporting, so a between-tick down (or a leaving player's MIA resolution)
  never becomes a result frame or a `RoomReport::Result`; the recorder is forced off even when `record: true`, so no replay is
  written. The sim never ends a training run, so the ended/linger path is never reached.
- **Idle close.** `TRAINING_IDLE_SECONDS` = 300; the clock starts at the room's open time and resets only on an **accepted**
  input (`RoomCmd::Input` counts a command only when `Sim::submit` accepts it, so a rejected no-op cannot keep the room up).
  When the limit elapses the room closes (`RoomReport::Closed`, no result, replay `None`); the normal reconnect grace still
  holds a dropped practice seat.
- **Tests (native, 5):** the room starts active with exactly one human, no bots and a live stream whose snapshot carries the
  training bit and the two dummies; a second join is refused; the idle limit closes the room with no result and no replay; an
  accepted input resets the idle clock; a leave during an active practice run never banks its MIA result; and the director
  refuses a training profile before matchmaking.
- **Wire untouched:** no protocol byte or observation version moves in this round, so the C#/JS/browser-proof set was not
  re-run (the wire round above remains the verified artifact).

### The pinned-container capture corpus and parity (round 5)

The last C-PARITY artifact is the actual-source witness for everything above, captured in the pinned
`node:22.23.4-bookworm-slim@sha256:aaa4b5ba…` linux/amd64 image:

- **`tools/training-fixtures/`** — `capture.sh` (capture / `--check`, pinned image, the complete
  `packages/server/src/sim` + `packages/shared/src` TypeScript closure hashed into the provenance, and a two-run
  byte-identical replay), `capture.mts` (the 17 scoped cases), the declared map input and `README.md`.
- **`parity/training/source.json`** — the committed corpus: expected values written only by the unmodified source;
  `capture.sh --check` reproduces it byte for byte. The profile records the seed, the drawn order salt, the reward
  salt, the declared map hash and the tool/source hashes.
- **`crates/rh-sim/src/systems/training/corpus_tests.rs`** — the native comparison: every case is replayed against the
  Rust training world through the same JSON projection and requires exact frame and event equality. Cases: setup and the
  arena control; a 400-tick training run; a lethal dummy hit refilling and the 3 s reset; a between-tick down revived; a
  sword riposte and a reflected arrow killing the shooter and being revived in the same tick; console card, stat, camp
  (300 ms gap, new ref, 12-alive cap, 150-spawn cap), chest (chosen options, the roll, the 6-chest cap) and clear; the
  door and catalog bounds (unknown ids, count clamps, duplicate/over-long chest options, the 1e9 stat toast); and the arena
  door. A forced ledger hit is a state witness only; every ordinary attack's events are compared exactly.
- **The corpus found and the fix integrates six source-fidelity corrections:** a player death names a killer only when a
  PLAYER landed the fatal damage (a mob-caused death carries no `by`); dummies have no brain in the source (never aggro,
  wake, fight or return home and reset their hp); a practice mob stores its camp ref as `ref` (source `placeMob` writes
  `camp + 1`); reward chests occupy their tile for the next drop; the door refuses a 0 stat count and duplicate chest
  options; and the console's player-facing numbers are grouped with the source's `toLocaleString` shape.
- **Mutants:** eight committed patches under `tools/training-fixtures/mutants/` with `run-mutants.sh`: dummy refill, dummy
  reset clock, practice camp ref, chest occupancy, number grouping, the 300 ms gap, the stat-0 door and mob-caused death
  attribution. The runner applies each patch, requires a semantic training-suite failure, restores the tree, and requires
  the unchanged control: **8/8 mutants killed; control passes**.
- **Documented scope note:** `DUMMIES=1` without `training` (an arena world with the practice setup) is not captured: that
  config combination has no compiled gate plan on this line (the dummies gate only comes with the training world). The
  console's internal stat removal (count 0) is unreachable from the wire in the source, so only the door refusal is
  witnessed.

## What remains for P-ARENA-2 (exact, not approximated)

1. **Integration renumber (coordinator only).** This branch is self-consistent and DONE-VERIFIED at protocol 8 / OBS 16 on
   its own stack; the protocol-9 spine merge renumbers as described in the collision note above (command tags 12/13, one
   merged OBS 17, head bits reconciled). No code change is pending on this branch for that; it is the integration step's
   work.
2. **Documented capture scope note (not a branch gap):** the arena-with-dummies config (`DUMMIES=1` without `training`) is not
   captured because that config combination has no compiled gate plan on this line; every Lead-scoped case is captured.

## Verification (final tree, this Mac, pinned toolchain, throwaway pinned PostgreSQL)

- `cargo test --workspace --all-features --locked`: **1,451 passed, 0 failed, 3 ignored, 151 test binaries, exit 0**
- `tools/training-fixtures/capture.sh --check`: **byte-identical** to the committed corpus; `run-mutants.sh`:
  **8/8 mutants killed; unchanged control passes**
- C# `dotnet test`: **275/275**; JS vector check: **15,663 checks**; browser proof: **PASS** (round-3 wire artifacts; the
  corpus round moves no wire byte, so they were not re-run — the JS check was re-run as a regression and passes)
- `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`: **clean, exit 0**;
  `cargo fmt --all -- --check`: clean
- No edits to `docs/MIGRATION.md`, the `docs/CONTRACTS.md` status table or `Cargo.lock`; no legacy corpus regenerated from
  Rust output (the training corpus is committed source output only).
