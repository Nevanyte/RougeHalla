# P-ARENA-2: training rooms and the `train` console

Status: **INCOMPLETE at packet level; this branch delivers two verified native slices.** Round 1: the training world
lifecycle, the dummy actor kind and the practice setup. Round 2: the `train` console (the sixth schedule row) with its
caps/gaps/refusals and owner-only toasts, plus the observation bump (OBS 15 → 16: the public training fact and
`SeenEvent::Toast`). The wire transport (protocol 8), the server training-room lifecycle and the pinned-container capture
corpus remain (exact list below). Base:
`deepseek/p-cards-2` @ `2895e05a`. Branch: `deepseek/p-arena-2`. Stack: P-ARENA-2 on P-CARDS-2 on P-MOBS-1 on
P-TERRAIN-1 on P-ABIL-1 on P-FACTION-1 on P-CARDS-1 on P-CONTENT-1 over `856618eb` `optimization_port`. No packet file
exists for P-ARENA-2; scope derived from `docs/backlog/README.md` l.148, `packages/server/src/sim/training.ts`,
`packages/server/src/sim/mobs.ts`, `packages/shared/src/training.ts` and `packages/server/test/training*.test.ts`.

## Lead-approved decisions (2026-11-07)

1. Base `p-cards-2` @ `2895e05a`; the prerequisite chain must stay an ancestor. (This slice makes **no** wire change, so
   `PROTOCOL_VERSION` stays 7; the approved local 7→8 transport, the protocol-9 spine collision note and the renumbering
   by the coordinator apply to the transport step that remains.)
2. Room admission: implement RoomConfig/room behaviour + native `rh-server` tests; the public creation route is a
   coordinator decision deferred to P-HOST-1/P-NET. (Remains.)
3. Toasts: owner-only Event/SeenEvent + wire event inside the 8 bump. (Remains with the console.)
4. Scope: six schedule rows, dummy actor kind, lifecycle + guards, console, room, fixtures/parity/mutants, evidence.
   This slice delivers items 1–3 and part of 5 below; the rest is named precisely.

## Delivered in this slice (DONE-VERIFIED)

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

## What remains for P-ARENA-2 (exact, not approximated)

1. **Wire transport (approved protocol 7→8), the only remaining console-facing piece.** The console is native in this
   branch (`TrainRaw`/`TrainCommand`; the `PublicCommand::Train` shape exists but the wire codec does not carry it yet):
   encode the client `Train` in `rh-protocol` (tag 13; 12 is left to the pending P-ARENA-1 plan command and the
   coordinator renumbers against the protocol-9 spine), map it server-side to `PublicCommand::Train`, carry the public
   training fact on the Snapshot (append-only head bit; `SnapshotData` training flag + delta bit), encode the owner-only
   `Toast` event (tag 8) in place of the current explicit `Wire::Omitted`, let the dummy actor kind value 2 reach the
   wire, regenerate `protocol/fixtures/v8.json`, and update the Rust/C#/JS decoders, `tools/protocol-js` and the browser
   proof. The observation half (`OBSERVATION_VERSION` 15→16, `Observation::training`, `SeenEvent::Toast`) is already in
   this branch, so the wire step will not move it again.
2. **Dummy actor kind on the wire.** The observation carries kind 2 already; the server's protocol-7 encoder must pass the
   kind through (it currently collapses non-seats to 1) when the v8 vector is generated, with the C#/JS enum documented.
3. **Training room (server).** `RoomConfig` training mode, one human, no results/banking/telemetry, idle limit
   `TRAINING_IDLE_SECONDS` 300 on accepted inputs, arena matchmaking isolation, plus native `rh-server` tests; the public
   admission route stays deferred to P-HOST-1/P-NET (Lead decision).
4. **Pinned-container capture corpus + parity + mutants.** No `tools/training-fixtures/`/ `parity/training/` yet; the
   required case list was already scoped in the approved plan (setup layout, arena control, long run, dummy hit/reset,
   shield reflect/riposte revive, between-tick downs, console card/stat/camp/chest/clear incl. caps/gaps/refusals/toasts,
   the door, catalog bounds) with the legacy test line references.
5. **Integration note.** The protocol-9 spine (`p-cons-1c`) collision still applies once the wire step lands; this branch
   makes no protocol change, so the coordinator renumbers only when the transport/console step is integrated.

## Verification (this Mac, pinned toolchain, throwaway PostgreSQL)

- `cargo test --workspace --all-features --locked` (pinned toolchain, throwaway pinned PostgreSQL):
  **1,444 passed, 0 failed, 3 ignored, 151 test binaries, exit 0** (round-2 console slice; the round-1 run was
  1,436 passed before the console tests and observation bump).
- `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`: **clean, exit 0**.
- `cargo fmt --all -- --check`: clean.
- The new training tests and the re-recorded hash tape are included in the workspace run; no protocol/C#/JS vectors were
  touched (protocol stays 7), so the C# mirror and JS/probe suites are unchanged by this slice. The observation bump is
  pinned where the policy contract is: the frost policy test reads `OBSERVATION_VERSION` instead of a literal 15 (the
  policy's own contract version stays 12), and the server event encoder explicitly omits the native-only toast until the
  protocol-8 transport lands.
- No edits to `docs/MIGRATION.md`, the `docs/CONTRACTS.md` status table or `Cargo.lock`; no legacy corpus regenerated
  from Rust output.
