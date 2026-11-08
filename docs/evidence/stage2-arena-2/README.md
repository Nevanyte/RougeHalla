# P-ARENA-2: training rooms and the `train` console

Status: **INCOMPLETE at packet level; this branch delivers a verified native slice.** The training world lifecycle, the
dummy actor kind and the practice setup are implemented and tested; the `train` console, the wire/observation transport
(protocol 8), the server training-room lifecycle and the pinned-container capture corpus remain (exact list below). Base:
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
  is installed in every world, as in the source).
- Content registry: the training/dummy gameplay numbers are appended to `content!` (the documented rule for a new
  gameplay number), so the content identity moves once — the new `content_hash` is `408b43a687105dc6` and the pinned
  `GOLDEN_CONTENT_HASH` was updated with it. No runtime behaviour outside training changes, and no protocol/vector bytes
  move (protocol stays 7).
- Hash coverage (`tests/hash_coverage.rs`) gained three documented restore-refused validations for the new leaves: the
  training config switch (admitted only with the training actor runtime/origins), and a mob's kind/catalog type (coupled to
  its retained birth origin and the world's admission). All other new leaves perturb the state hash.

## What remains for P-ARENA-2 (exact, not approximated)

1. **The `train` console (sixth row).** `ActionId::Train` stays Pending: no `TrainCommand` in the input model, no
   card/stat/camp/chest/clear handlers, no toasts, no `TrainingRuntime` (spawned/150 cap, per-camp/per-chest 300 ms gaps,
   next camp ref 101..255, alive cap 12, chest cap 6). The source bodies and limits are recorded at
   `training.ts` l.75-359, `shared/training.ts` l.6-32 and `inputs.ts` l.48-52/191-236/357-363; the Rust data
   primitives already present are `cards::CardCatalog`/build counts, `modifiers::farm` (kill stacks/max count),
   `reward_chests::{insert, augment_pool, roll_with}`, `items::add_container`, `projectiles` and `mob_life`.
2. **Wire/observation (approved protocol 7→8).** Client `Train` command → `PublicCommand::Train`; public training fact on
   the Snapshot (append-only head bit); owner-only `Toast` event + observation `SeenEvent`; dummy actor kind value with
   Rust/C#/JS/probe/golden-vector updates; `protocol/fixtures/v8.json`; `OBSERVATION_VERSION` 15→16 and the policy pin;
   browser proof. Protocol stays 7 in this slice (no wire change made).
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
  **1,436 passed, 0 failed, 3 ignored, 151 test binaries, exit 0**.
- `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`: **clean, exit 0**.
- `cargo fmt --all -- --check`: clean.
- The new training tests and the re-recorded hash tape are included in the workspace run; no protocol/C#/JS vectors were
  touched (protocol stays 7), so the C# mirror and JS/probe suites are unchanged by this slice.
- No edits to `docs/MIGRATION.md`, the `docs/CONTRACTS.md` status table or `Cargo.lock`; no legacy corpus regenerated
  from Rust output.
