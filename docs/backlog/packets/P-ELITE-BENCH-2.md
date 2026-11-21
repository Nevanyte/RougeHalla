# P-ELITE-BENCH-2: elite bench with a scripted `duelist` fighter, outcome accounting, parallel fights, honest caveats

- **Serves:** `docs/backlog/AUGMENT_ELITE_REWORK.md` wave 3, decision 8 and the Verification "Elites" line (owner target: 10-20% solo death rate at 12 banked camps, tuned by P-ELITE-TUNE-1). Measurement only.
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** `coord/int-62` at `5aaadea74` (adds P-AUG-POOL-1; no `rh-headless` change since P-ELITE-BENCH-1).
- **D-rules touched:** D1 loose proof (owner 2026-11-10) · D2 n/a · D5/D6/D9 none (headless runs never use client prediction)

> **REVISION 2026-11-19 (coordinator decision, after the oracle author's prototype): the live-bot fighter is dropped; the
> replacement is a bench-local scripted fighter, `duelist`.** Section 11 records why.

> **AMENDMENT 2026-11-19 (reviewer finding on `agent/sonnet/P-ELITE-BENCH-2` @ 93cd17880, coordinator decision): the ranged
> duelist never steps back; read "Amendment: the give-up rule" in section 11 first.** Where sections 8 and 11 below speak of
> stepping back or kiting, the amendment governs. The amendment is an `oracle-amend:` commit on `packet/P-ELITE-BENCH-2`
> (changed expectations in `tests/elite_bench_duelist.rs`, the packet's own oracle; no P-ELITE-BENCH-1 file changes).

## 1. ID and outcome
P-ELITE-BENCH-1's table measures a scripted Brawler. The reviewer found the counts right and the fighter unrepresentative, plus four honesty gaps. This packet adds, inside `rh-headless` only (`rh-policy` and `rh-sim` read-only):
1. a **duelist fighter** (`--fighter duelist`): a bench-local scripted policy that commits to the target elite camp and plays its kit (Wish, weapon range, kiting); `--fighter brawler` keeps today's fighter as the **upper bound**; `--fighter both` runs both. The reference is **duelist, banked_12**.
2. **outcome accounting** per column: `samples`, `engaged`, `deaths` (died), `cleared`, `truncated`, `no_engage`; death rate = died / engaged with its Wilson ci95; clear rate = cleared / engaged.
3. **`--jobs N`**: independent fights on N std threads (default `std::thread::available_parallelism()`), output byte-identical for any N; the owner command default becomes `--seeds 3`.
4. **honest caveats** in `CAVEAT`, the table and `tools/balance-camps/README.md`.

## 2. Dependencies
P-ELITE-BENCH-1 (merged): `elite_bench.rs`, `tests/elite_bench.rs`, the sample, `banked_camp_build`.

## 3. Relevant legacy paths
- Not a ported mechanic: no legacy numeric oracle. Conceptual cross-check `packages/server/bench/campDuel.ts:3-5,33-34,139-148`.
- Rust facts (read, and measured in prototypes):
  - `crates/rh-policy/src/scripted.rs:71-140` (and its observation path `decide_into`, `:166-211`): Brawler = Move toward the nearest visible actor, Attack within 80 u. Emits `Move`, `Attack`, `Plan`.
  - `crates/rh-headless/src/elite_bench.rs:327-420` (`fight`: Brawler on `Env::from_external_checkpoint` + `decide(&obs[0])`; the event tally), `:60-63` (`CAVEAT`).
  - Abilities: `crates/rh-sim/src/abilities/mod.rs:15-19` (`Slot::{Wish,Q,E}`), `:277-285` (`wish(faction)`: Frost Freeze, Plague Swarm, Sentenced Trial, Fire Blaze, Holy LastStand), `:287-` (`definition(id)`, `Target::{Unit(range), Self_, Point, Placed}`: Freeze Unit 450, Trial Unit 400, Swarm and LastStand Self_, Blaze Point), `:391-` (`definition_for(config, id)`: Frost Wall under `FrostWish::Wall`), `:426` (`ability_in_slot`: **Q and E have no ability; the Wish is the only ability a banked, card-less fighter has**), `:253` `WISH_LOCK_MS = 45000`: the Wish cannot be cast before about tick 900.
  - Readiness a client can see: `obs.me.wish: Option<OwnerView>` (`abilities/mod.rs:475`: `ready_at`, `charges`, `cast`) against `obs.server_time`; the command is `PublicCommand::Cast { slot, x, y, id, t, seq }` (`input.rs:100`).
  - Weapon reach: `rh_sim::content::weapon(id).shape` (`content.rs:249`): `Shape::Arc { reach }` for sword/axe/shield, `Shape::Projectile { range }` for bow and wand.
  - Camp members in an observation are `obs.visible` rows with `mob_type`, not marked by camp (C-OBS): the duelist is told its camp's centre and mob types by the bench and filters by them (within 800 u of the centre).
- Owner decisions (`docs/OWNER_DECISIONS.md`): row 2026-11-18 "Elite and augment rework" ("Measure, then tune"; numbers shown to the owner before P-ELITE-TUNE-1). No row decides a bench design; `--seeds 3`, the reference fighter and the duelist come from the coordinator's briefs for this packet (2026-11-19).

## 4. New paths
- `crates/rh-headless/tests/elite_bench_duelist.rs` (oracle).
- Optional: `crates/rh-headless/src/elite_bench/duelist.rs` if the implementer splits the policy out (a submodule of `elite_bench.rs`, `#[path]`-safe: the tests include `elite_bench.rs` by path, so a submodule must be declared with `#[path = "elite_bench/duelist.rs"] mod duelist;` or kept in `elite_bench.rs`).

## 5. Exclusive write scope
- `crates/rh-headless/src/elite_bench.rs` (replaces the stub) and the optional `src/elite_bench/duelist.rs`.
- `crates/rh-headless/src/bin/camp_bench.rs` only if flag routing needs it (non-elite behaviour byte-identical).
- `tools/balance-camps/README.md`.
- `crates/rh-headless/Cargo.toml` only if a dependency is truly needed (prefer std threads; none expected). Cargo.lock is the coordinator's.
- Not in scope: `lib.rs` (no `Env` change: the duelist runs on `Env::from_external_checkpoint` like the Brawler), any `rh-sim`/`rh-policy` file, `scripts/`, `.github/`, `hosting/`, `tests/elite_bench.rs`, the fixtures.

## 6. Contracts and references
- C-INPUT: the duelist acts only by returning `PublicCommand`s from `decide(&Observation)`; they go through `validate` + `Sim::submit` inside `Env::step`. It reads only its `Observation` plus what the bench tells it (camp centre, mob types: facts any client can see). `trusted_build::apply` is the one setup call, before the first step.
- It implements `rh_policy::Policy` (as the Brawler does) and lives in `rh-headless`.
- Feature isolation unchanged: `elite_bench.rs` is a module of the bin under `cfg(feature = "elite-bench")` and of the tests through `#[path]`; never in `lib.rs`; `elite-bench` stays out of `default` and of every dependency table.
- rh-sim stays single-threaded per sim; threads only run independent fights (one `Sim` per fight).
- No `HashMap` where output order matters.

## 7. Behaviour to preserve
- `camp_bench` without `--elite`/`--sample-builds`: byte-identical stdout (`tests/fixtures/camp_bench_quick_list.json`, `camp_bench_quick_400.json`).
- `run(args)` with no `--fighter` flag behaves as P-ELITE-BENCH-1 (Brawler only; `reference` stays `"banked_12"`); every assertion of `tests/elite_bench.rs` stays green. **No `oracle-amend` is needed.** The owner command passes `--fighter both`.
- The Brawler's fights, rates and goldens do not move.
- No RNG draw, rule or number in `rh-sim` changes. Exit 0 whenever the run reported; exit 2 only for bad arguments.

## 8. Acceptance checks
- `cargo test --locked -p rh-headless --test elite_bench_duelist --test elite_bench --test camp_bench` green; `scripts/gate.sh --quick --oracle packet/P-ELITE-BENCH-2` green; clippy workspace all-features and default.
- The implementer reports, from the release binary: the owner command's wall time (below), the `--jobs 1` vs default speed-up, and the duelist's engaged / truncated counts.

### Design the oracle fixes (the implementer must not deviate)

**CLI** (`elite_bench::run(args)` and `elite_bench::parse_options(args)`):
- `--fighter brawler|duelist|both`. Absent = `brawler` (so P-ELITE-BENCH-1's oracle holds). The owner command passes `both`.
- `--jobs N` (N >= 1; 0 or non-numeric is an error). Default = `std::thread::available_parallelism()` (1 if unknown). Never appears in the output.
- `--seeds N`: default **3** for a full run (`OWNER_DEFAULT_SEEDS`), 1 for `--quick`. Other flags unchanged.
- **Amendment:** `--kind ID[,ID...]` (restrict the elite kinds to those catalog ids, in any zone, also under `--quick`; an unknown id is an error) and `--weapon W[,W...]` (restrict the weapons, also under `--quick`; an unknown weapon is an error). They exist so the oracle can reach long fights (the quick zone's elites die in under 900 ticks, before the Wish unlocks) and the bow, which the quick weapons do not include. Without them `--quick` is unchanged.
- Owner command: `cargo run --release -p rh-headless --features elite-bench --bin camp_bench -- --elite --seed 1 --fighter both > elite.json 2> elite-table.txt` (seeds default 3, jobs all cores): 5 factions x 6 weapons x 10 elites x 3 seeds x 5 columns x 2 fighters = 9000 fights of at most 1800 ticks; budget **15 min wall, release, this machine**; the implementer reports the time and lowers the default seeds if over, saying so.

**The duelist** (`--fighter duelist`), a scripted `Policy` deciding every tick (interval 1) from its `Observation`. It was prototyped and measured by the oracle author; the rules:
- **Targets**: only `obs.visible` actors that are alive, whose `mob_type` is one of the target camp's types, and within 800 u of the camp centre; the nearest (ties by id). It never goes for anything else. With none visible it moves to the camp centre.
- **Wish**: when `obs.me.wish` has `charges > 0`, `server_time >= ready_at` and no `cast` in progress, and the target is valid for the ability: `Target::Unit(r)`: target within `r`, `Cast { slot: Wish, x, y at the target, id: Some(target.id) }`; `Self_`: cast at own position when a member is within 250 u **or the fighter was hit in the last 2 s** (hp fell between its observations; amendment: a ranged fighter standing at 0.8 x range is out of the 250 u rule, so this keeps Plague Swarm and Holy Last Stand in use; prototyped: Holy wand fights cast); `Point`/`Placed`: target within 400 u, cast at the target's position. (The Wish is the only ability: Q and E have none.) The Wish is locked for the first 45 s (about tick 900), so short fights never cast; that is the game, not a defect.
- **Melee** (`Shape::Arc`): move to the target until within `0.9 x reach`, then `Attack` toward it (`t: Some(server_time - 100.)` as the Brawler).
- **Ranged** (`Shape::Projectile`): **amended: approach to `0.8 x range`, then stand and shoot: `Attack` while within `0.8 x range`, `Move` toward the target beyond it. It never steps back** (the first draft stepped back 200 u when a member came within `0.4 x range`; that made camps give up, see section 11).
- **No retreat, no dodge-reading**: it fights to the end.
Numbers are as prototyped; the implementer may adjust within what the oracle asserts and must record the final numbers in the README.

**Engagement.** A fight is **engaged** iff the fighter dealt damage to, or took damage from, a member of the target camp (the implementer attributes from the events and documents how). A fight that is not engaged has outcome `no_engage`, whatever else happened. An engaged fight is `died` (hp reached 0, stops at once), `cleared` or `truncated` (cap). Brawler fights are all engaged (as in P-ELITE-BENCH-1: a Brawler that never reaches the camp is `truncated`, so its rates and tests do not move). The duelist is expected to be engaged in nearly all fights (prototype: 32 of 32).

**Report additions** (additive; a Brawler-only run is P-ELITE-BENCH-1's report plus the new fields):
- Top level: `fighter` (`"brawler"|"duelist"|"both"`), `reference_fighter` (`"duelist"` when the run has one, else `"brawler"`), `reference` stays the column name `"banked_12"`, `upper_bound` only under `both` (below).
- `cells[]`: all P-ELITE-BENCH-1 fields plus `fighter`, `engaged` (bool), `actions` (object: command kind -> count over the whole fight, by `PublicCommand` variant name, as submitted), `attack_ticks` (ticks on which the fighter submitted an `Attack`), `attack_dist_mean` (mean, over those ticks, of the distance from the fighter to the nearest living member of the target camp, from sim truth; `null` when `attack_ticks == 0`). `outcome` is `died|cleared|truncated|no_engage`. `seed` is the world seed. Cell order: faction, weapon, kind, seed, **fighter (duelist first, then brawler)**, column (5 innermost). A skipped place is listed once in `skipped`, with no fighter and no column.
- `columns[]` (in `per_camp[]`, `overall`, and the upper-bound block): `column camps samples engaged deaths cleared truncated no_engage decided death_rate clear_rate ci95 decided_rate decided_ci95`; `deaths` = died; **amendment:** `decided` = deaths + cleared, `decided_rate` = deaths / decided, `decided_ci95` = Wilson interval of deaths / decided (both `null` when `decided == 0`); `death_rate` = deaths / engaged, `clear_rate` = cleared / engaged, `ci95` = Wilson interval of deaths / engaged; all three `null` (not 0) when `engaged == 0`.
- `per_camp[]` and `overall` (`samples deaths death_rate`) describe the **reference fighter's reference column**. Under `both`, the Brawler is `upper_bound: {fighter:"brawler", per_camp:[...], overall:{...}}` (same shapes).
- **Amendment, per-weapon block and resets.** Top-level `by_weapon`: one row per fighter (duelist first), weapon (`WeaponId::ALL` order, only weapons run) and column (the five, in order), over all kinds and seeds, with the `columns[]` fields above plus `fighter` and `weapon`. Every cell gains `resets` (u64): the number of times a living member of the target camp left fight mode (the sim's `Mob::engaged()` went true to false: gave up and returned, or healed to full) while the fighter was alive and the camp not cleared, counted per member and tick transition from sim truth. A Brawler cell has it too.
- **Amendment, table lines** (in addition to the `counts` lines): per fighter and column `  decided <fighter> <column>: died=<n> cleared=<n> rate=<x>` and, for the reference column, per fighter and weapon `  weapon <fighter> <weapon> banked_12: died=<n> cleared=<n> truncated=<n> rate=<x>`; `<x>` is `{:.1}%` of the decided rate or `n/a`.
- Table (stderr): the caveat; one block per fighter (reference first; the Brawler block headed "upper bound"), rows as P-ELITE-BENCH-1; per fighter and column one line `  counts <fighter> <column>: samples=<n> engaged=<n> died=<n> cleared=<n> truncated=<n> no_engage=<n>` over the overall tally; a reference line naming `duelist` and `banked_12`; the owner target (10-20%).
- `CAVEAT` (also in the table) says: the Brawler is an **upper bound** (no abilities, no kiting, swings from 80 u, no heals); the duelist is nearer to a player but still scripted: it uses its Wish and weapon range, but **never retreats and does not read dodges**, so its rates remain biased upward; the **ci95 scope**: spread over faction x weapon x seed within the seeds run, with **one camp placement per elite kind** (the map is fixed; the world seed varies the fight and the banked draw, not where camps are); `truncated` and `no_engage` fights are counted, not hidden; **amendment:** the headline rate (died / engaged) counts truncated fights as non-deaths, so the **decided rate** (died / (died + cleared)) is printed beside it, and the caveat says that the legacy **give-up rule** (a fighting mob gives up after 20 s without hitting a player and regenerates to full in 2 s) makes pure kiting **reset** camps, which is why the duelist stands and shoots (legacy behaviour, not a sim defect); banked builds hold no cards, so the bots' misvaluing of reworked cards (until P-AUG-BOTS-1) does not enter.

**Threads.** `--jobs N` runs fights on N `std::thread`s over an indexed cell list; results go into slots by cell index and output is produced in cell order afterwards, so `--jobs 1` and `--jobs 4` give byte-identical JSON and table.

## Oracle files (read-only for implementers)
- `crates/rh-headless/tests/elite_bench_duelist.rs`
- `docs/backlog/packets/P-ELITE-BENCH-2.md`

**oracle-amend (for the owner), `tests/elite_bench_duelist.rs`:** replaced `the_duelist_casts_its_wish_and_the_brawler_never_does` by `the_brawler_emits_only_move_and_attack_and_never_casts` (quick sweep) and `the_duelist_casts_its_wish_once_it_unlocks` (long sweep, `--kind glacialWarden --weapon bow,wand`); range gap floor 150 u -> 100 u; `check_columns` also checks `decided`, `decided_rate`, `decided_ci95`; caveat words `give-up`, `reset`, `decided`; README words `decided`, `resets`, `give-up`; the flags test refuses a bad `--kind`/`--weapon`; new tests `a_ranged_duelist_stands_and_shoots_so_fights_are_decided_not_truncated`, `a_ranged_duelist_does_not_reset_the_camp`, `the_per_weapon_block_exists_and_its_books_balance`, `the_table_prints_the_decided_rate_beside_the_headline`. Reason: the amendment in section 11.

Existing tests that pin what this packet touches (none changed; no `oracle-amend`):
- `crates/rh-headless/tests/elite_bench.rs` (P-ELITE-BENCH-1): `caveat`/`table` contain "Brawler" (the new caveat does); `reference == "banked_12"`; 5 columns per fought cell and every outcome in `died|cleared|truncated` (hold when `--fighter` is absent); per-camp/overall/`ci95` consistency read `samples`/`deaths` (equal to engaged for the Brawler); the byte-identical goldens of the non-elite bench. They pass `--seeds` explicitly, so the new default does not change them.
- `crates/rh-headless/tests/camp_bench.rs`: inventory, determinism, `BAND`; untouched.

## 9. Validation commands
- `cargo test --locked -p rh-headless --test elite_bench_duelist --test elite_bench --test camp_bench`
- Owner command above (release), timed; `--jobs 1` vs default for the speed-up.

## 10. Risk and suggested model tier
Sonnet, reviewer. Care points: the duelist's kiting (it must not stall into truncation: see the measure below), the Wish gating, engagement counting from events, results collected by index across threads.

## 11. Known traps and measured facts

### Amendment: the give-up rule (reviewer finding on 93cd17880; coordinator decision 2026-11-19)
- **Finding.** A fighting mob gives up when `now - last_combat_at >= MOB_GIVE_UP_SECONDS` (20 s; `rh-sim/src/systems/mob_ai.rs:266`) or leaves its leash; in Return mode it regenerates to full in 2 s (`mob_life.rs:605-616`); `last_combat_at` is refreshed only when a mob hits a player (`ledger.rs:1218`). The stepping-back ranged duelist often went unhit for 20 s, so the camp reset. The owner run at duelist banked_12 (150 fights per weapon): wand 39 died / 31 cleared / 80 truncated; bow 71 / 17 / 62; fists 14 truncated; sword, axe, shield 0-1 truncated. Truncated ranged fights dealt 2-3x the damage the Brawler needed to clear. The headline 33.0% hid a decided rate of 40% (297 / 743).
- **Decision.** The ranged duelist walks to 0.8 x range and **stands and shoots; it never steps back**, so melee mobs reach and hit it and the camp stays in combat (what a real ranged player must do against this rule). Melee and the Wish rules are unchanged, except the `Self_` Wish also fires after a hit in the last 2 s.
- **Measured at a prototype of the new rule (release; `agent/sonnet/P-ELITE-BENCH-2` @ 93cd17880 with the step-back removed, the `Self_` hit rule and a `resets` counter added; throwaway, not committed):**

  | sweep | measure | step back (old) | stand and shoot (new) |
  |---|---|---|---|
  | `--quick --kind glacialWarden --weapon bow,wand --seeds 1 --max-ticks 1800`, duelist, 20 fights | truncated | wand 10 of 10 (5 truncated, 5 `no_engage`) | **0 of 20** (bow 0/10, wand 0/10) |
  | same | fights past 1000 ticks / that cast | n/a | 7 / all 7; Frost and Holy both cast |
  | `--quick --seeds 1 --max-ticks 1200`, both fighters, 20 wand fights each | wand mean attack distance | duelist 358 u vs Brawler 54 u | **duelist 202 u vs Brawler 50 u (4.1x, gap 152 u)** |
  | same | truncated, resets (duelist wand) | 6 of 16 truncated | **0 truncated, 0 resets** |
  | full sweep, duelist, seed 1, 1800 ticks, 1500 fights (250 per weapon) | truncated | see finding | wand 3, bow 5, sword/axe/shield 1 each, fists 0 |
  | same | fights with a reset | | wand 17 of 250 (81 resets), bow 5 (7), axe 3, others 0 |
  | same | died of decided | | wand 193/247, bow 208/245 (the decided rate rises a lot: the owner sees it) |

  The oracle floors: truncated share of the ranged duelist's long-sweep fights at most 15% (measured 0%); fights with a reset at most 10% of ranged duelist fights in both sweeps (measured 0%); range ratio at least 2.5 and gap at least 100 u (measured 4.1 and 152 u; the first draft's gap floor of 150 u was a knife edge and is lowered); every duelist fight of 1000 ticks or more casts, at least 4 such fights exist (measured 7 of 20); no cast before tick 900.
- **The quick sweep no longer casts.** With no step-back the quick zone's fights end in 175-900 ticks, before the 45 s Wish lock, so the quick `both` sweep has no cast. The cast test moved to the long sweep above (needs `--kind` and `--weapon`). If a run ever shows the long sweep with fewer than 4 fights past 1000 ticks, report it, do not lower the floor.
- **Not established:** the 2 s `Self_` hit rule is prototyped only on Holy (Last Stand); Plague (Swarm) is not in the quick factions. Bow is only tested at glacialWarden.

### Earlier measurements
- **Why not the live bot (decision 2026-11-19).** `HumanBot::decide_into` is a no-op (`bots/bot.rs:396-414`): it needs the delivered frame, so it cannot run through `from_external_checkpoint` + `decide`; `Env::new` places seats on `arena.spawns` with no weapon, so a livebot fight needs an `Env` change. Prototype (release, Normal tier, all four personas, Frost, default weapon, first Frost elite, seeds 1-4, start 320 u away): it **roams away** (ended 500-1400 u from the camp in 3 of 4 fights), approached the camp (minimum 12 u) in 1 of 4, and died elsewhere in 4 of 4; the four personas behaved identically. This is also why soak bots bank so few camps: a HumanBot alone roams instead of working camps (39 of 56 sampled minute-5 builds hold no stacks).
- **Duelist prototype (oracle author, release, banked builds 0/6/12/18, seed 1, Frost and Holy x Sword and Wand x the two zone-0 elites = 16 fights per weapon and fighter, `max_ticks` 1200):**

  | weapon, fighter | died | cleared | truncated | mean attack distance | Cast commands |
  |---|---|---|---|---|---|
  | sword, brawler | 4 | 12 | 0 | 51.5 u | 0 |
  | sword, duelist | 3 | 13 | 0 | 56.7 u | 0 |
  | wand, brawler | 14 | 2 | 0 | 54.4 u | 0 |
  | wand, duelist | 7 | 3 | 6 | 358.5 u (6.6x the Brawler's) | 9 (CastStarted in 2 fights) |

  Engaged: 32 of 32 duelist fights. Wider run (seeds 1-2, all five factions, bow/wand/sword/axe/shield, 1800 ticks, banked_12 only): the duelist's attack distance is bow 296 vs 43, wand 361 vs 44; melee weapons 52-57 vs 50. **The kiting duelist truncates often with ranged weapons** (bow 9 of 20, wand 3 of 20 at 1800 ticks; 6 of 16 wand fights at 1200 ticks): a truncated fight is a non-death, so ranged rows can understate deaths; the report counts them and the README says so. Wish casts need fights longer than the 45 s lock: none for sword, axe or shield (all end sooner), 17 of 20 bow and 5 of 20 wand fights cast in the wider run.
- **Seeds do not move camps.** Measured on P-ELITE-BENCH-1's bench, quick, seeds 1..3: each elite kind rolls the same camp index and start distance in every seed (the map is fixed). Seeds vary the fight streams and the banked draw. The oracle asserts three distinct seeds are fought, not that placement varies; the caveat says so.
- Plant Your Feet (`cards/mod.rs:141-167`) and the build-at-tick-0 rule of P-ELITE-BENCH-1 stand.
- A fight that kills the fighter stops at once and reports `died`.
- Threads: each fight owns its `Sim`; no shared mutable state; collect by index; never print from a worker.

## Notes from previous attempts
<!-- Coordinator appends on escalation. -->

## Doubts reported with the oracle
- (Superseded by the amendment: the quick sweep no longer casts.) The cast floor was thin: in the quick sweep at 1200 ticks only the wand fights live past the Wish lock; the prototype saw 9 Cast commands in 16 wand fights (2 fights started a cast). The oracle asks for at least one Cast command in the sweep (and no Cast before tick 900 is not asserted). If the implementer's kiting changes fight length, this floor is the first to move: report, do not loosen.
- Engagement attribution is the implementer's within the stated definition; the oracle checks internal consistency and `no_engage <= 10%` of duelist fights (measured 0).
- The range margin asserted is a ratio of at least 2.5 (measured 6.6) plus an absolute gap of at least 150 u (measured 304 u); the margin is wide, not a knife edge.
