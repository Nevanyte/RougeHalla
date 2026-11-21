# balance-camps: camp-clear bench under both hitbox modes

`camp_bench` (`crates/rh-headless/src/bin/camp_bench.rs`, packet P-BALANCE-2) puts one fighter (one faction, one
weapon, no cards) against one camp of each of the 30 catalog camp kinds on the seed1 map, under `LegacyCircle` and
under `Archetypes` (mob spacing `Auto`, the live setting), and prints one JSON report. It changes no rule and no number.

## Run

```
cargo run --release -p rh-headless --bin camp_bench -- --quick --seed 1   # 16 cells: Frost,Holy x Sword,Wand x 2 kinds x 2 modes
cargo run --release -p rh-headless --bin camp_bench -- --seed 1           # 1800 cells (5 x 6 x 30 x 2)
cargo run --release -p rh-headless --bin camp_bench -- --list             # inventory only, runs nothing
```

Flags: `--seed N` (default 1), `--max-ticks N` (default 1800 = 90 s, the legacy campDuel cap), `--quick`, `--list`,
`--with-nospacing` (adds the measurement-only mode `archetypes-nospacing`; the server refuses spacing off), and the
test-only `--control-weapon-swap a=b` (cells labelled weapon `a` run with weapon `b`; a negative control).
Stdout is one JSON object; same seed and flags give identical bytes. It exits 0 whenever it ran: it is evidence, not a gate.

## Reading the report

* `cells`: one per faction x weapon x kind x mode. `outcome` is `cleared`, `died` (the fighter's hp reached 0; not a
  clear) or `truncated` (cap reached). `ticks_to_clear` is the tick of the last camp death, of the fighter's death, or
  the cap. `damage_dealt` / `damage_taken` sum hit, ability, signature and card-bleed events (taken is floored by the hp
  ledger, since burn is reported in batches). `healing_received` sums `Heal` events. `chill_seconds` is slow/root/stun
  applied by the fighter plus 0.05 s per tick per mob chilled by the fighter.
* `comparisons`: per scenario, the six metrics with `rel_delta = (archetypes - legacy) / legacy` (0 when both are zero,
  `null` when legacy is zero and archetypes is not).
* `out_of_band`: scenarios listed first by `outcome` (when the modes end differently), then each metric with
  `|rel_delta| > BAND` (`const BAND: f64 = 0.10`) or an undefined delta.

## Caveats

* The fighter is the scripted `Brawler`: it walks to the nearest actor and swings from 80 u whatever the weapon's reach
  (sword and axe swing at air until the mob closes; bow and wand fire at close range). The table is "Brawler with
  weapon W", not optimal play; both modes use the same policy, seed, camp and start point, which controls for that.
* One camp per kind (the first of its zone with that roster, no elite for normals), one seed, 10 tiles of approach.
* `LegacyCircle` is parity-proven on `parity/fixtures/mob_camp` and `crowded_8` only; it is the legacy stand-in here.
* `packages/server/bench/campDuel.ts` is the conceptual legacy cross-check, not a numeric oracle.
* Regen, consumables and quests are off, so lifesteal healing is not mixed with other healing.

## Elite mode (packet P-ELITE-BENCH-1)

`camp_bench --elite` puts one fighter against each of the 10 elite camps (2 per zone) for every faction x weapon x seed,
under `SimConfig::live_content()` (augments and elites `Rework`), once per build **column**, and prints a JSON report on
stdout and a death-rate table on stderr (per camp and overall: samples, then one death rate per column; the owner target
is 10-20% for an average minute-5 build). It needs the feature: a build without it prints that and exits 2.

```
cargo run --release -p rh-headless --features elite-bench --bin camp_bench -- --elite --seed 1 --fighter both > elite.json 2> elite-table.txt   # the owner command: three seeds, all cores
cargo run --release -p rh-headless --features elite-bench --bin camp_bench -- --elite --quick     # Frost,Holy x Sword,Wand x 2 elites x 1 seed
cargo run --release -p rh-headless --features elite-bench --bin camp_bench -- --sample-builds --seeds 1..81 > tools/balance-camps/minute5_builds.json
```

Flags: `--seed S` (first seed, default 1; it is both the map-roll seed and the world seed), `--seeds N` (default 3 for a
full run, 1 for `--quick`), `--max-ticks N` (1800), `--builds PATH` (default the checked-in bot sample),
`--fighter brawler|duelist|both` (default `brawler`, P-ELITE-BENCH-1's run; the owner command passes `both`), and
`--kind ID[,ID]` and `--weapon W[,W]` (restrict the elite kinds and the weapons, also under `--quick`; unknown values
are an error), and `--jobs N` (default all cores): independent fights run on N std threads and the output is byte-identical for any N.
One seed with one fighter is 1500 fights (5 factions x 6 weapons x 10 elites x 5 columns); `--fighter both` doubles it.
A seed that rolls no camp of an elite is listed in `skipped`.

### The fighters

* `duelist` (the **reference**): a bench-local scripted policy (`src/elite_bench/duelist.rs`) that acts only through
  `PublicCommand`s (validate + `Sim::submit`). It targets only the camp's members (mob type in the camp's types, within
  800 u of the camp centre, nearest first; with none visible it walks to the centre). Melee weapons close to 0.9 x reach
  and swing; ranged weapons walk to 0.8 x range and then stand and shoot: they never step back (see the give-up rule below). It casts its Wish when it has a charge, the ready time has passed and no cast is
  running, and the target is valid (unit ability: within its range; self: a member within 250 u or the fighter lost hp in
  the last 2 s; point or placed: within 400 u).
  The Wish is locked for the first 45 s (about tick 900), so short fights never cast. It never retreats and does not read
  dodges.
* `brawler`: the upper bound. P-ELITE-BENCH-1's `Brawler` (walk to the nearest actor, swing from 80 u whatever the
  weapon, no abilities, no heals). It moves into `upper_bound` under `--fighter both`.

The report's `per_camp` and `overall` describe the reference fighter's `banked_12` column (`reference_fighter`,
`reference`); the Brawler's are under `upper_bound`. A cell carries `fighter`, `engaged`, `actions` (commands submitted by
kind), `attack_ticks`, `attack_dist_mean` (mean distance to the nearest living member on ticks it attacked) and `resets`
(times a living member of the camp left fight mode while the fighter lived: a give-up). The top-level `by_weapon` block
holds the same column fields per fighter, weapon and column.

### Outcome accounting

Each column reports `samples`, `engaged`, `deaths` (died), `cleared`, `truncated` and `no_engage`. A fight is **engaged**
when the fighter dealt damage to, or took damage from, a member of the target camp (read from the hit, ability, signature
and bleed events). A fight that is not engaged is `no_engage` whatever else happened; the Brawler's fights all count as
engaged (a Brawler that never arrives is `truncated`). `death_rate` = died / engaged and `clear_rate` = cleared / engaged,
with `ci95` the Wilson interval of died / engaged. `decided` = died + cleared, `decided_rate` = died / decided with
`decided_ci95`: the rate with the truncated fights taken out, printed as `decided <fighter> <column>:` lines, and per weapon
as `weapon <fighter> <weapon> banked_12:` lines; all three are `null` when nothing engaged. The `ci95` spread is over
faction x weapon x seed within the seeds run, with one camp placement per elite kind (the map is fixed; seeds vary the
fight and the banked draw). The stderr table ends each fighter block with one `counts <fighter> <column>:` line.

### The banked-camp model (why the reference is not the bot sample)

The reference build follows the design workbook (`Augment_Value`, assumption `banked`): 12 normal camps already banked at
minute 5, one camp = 12 stacks of the stat its kills pay (`camp_buffs` under `Themed`, else the camp's own mob type).
`banked_camp_build(probe, seed, N)` draws N non-elite camps of the world with replacement and merges stacks by stat; no
cards, no boosts. Columns: `banked_0` (the bare fighter, the negative control), `banked_6`, `banked_12` (the
**reference**: `per_camp` and `overall` report its rate as their own), `banked_18`, and `bot_sample`. Every column fights
the same camp from the same start with the same seed. Each column carries a Wilson 95% interval (`ci95`).

Why not just the bots' minute-5 builds: measured over seeds 1..80, all 56 sampled builds hold 0 cards (cards come only
from elite chests, so a first elite fight has none) and 39 of 56 hold no stacks. Bots bank far fewer camps than the
workbook player, so `bot_sample` is the bots' reality and `banked_12` the design target, and they are not comparable. In
the quick run the first sample builds are empty, so `bot_sample` equals `banked_0` there.

The build is applied at tick 0 through `rh_sim::trusted_build::apply` and the fighter walks 4-10 tiles to the camp
(`start_dist`, `first_hit_tick` are reported), so Plant Your Feet's stillness clock is reset by the walk.

`minute5_builds.json` is written only by `--sample-builds` (never hand-edited): 8 `HumanBot` seats as
`examples/source_soak.rs`, `live_content()`, every bot still standing at tick 6000 contributes its cards, boosts and farm
stacks. `ended_early` lists the seeds whose match ended before minute 5; they contribute nothing.

Config overrides on top of `live_content()`: `lifecycle: ArenaMode::Off` (needed: `Sim::reset_active` refuses the Source
lifecycle), `min_players` 1 and a short lobby (a lone fighter), `regen` off and `quests` off (as the non-elite bench, so
no passive healing or quest reward mixes in). Everything else is the live world.

### The give-up rule

A fighting mob gives up after 20 s without hitting a player (`MOB_GIVE_UP_SECONDS`, `mob_ai.rs`) and in Return mode
regenerates to full in 2 s. A ranged fighter that steps back to stay out of reach therefore resets the camp and the fight
ends `truncated`. That is legacy behaviour, not a sim defect, so the duelist stands and shoots; `resets` shows when it
still happens.

### Caveats

* The Brawler is an **upper bound** (no abilities, no kiting, swings from 80 u). The duelist is nearer to a player but
  never retreats and does not read dodges, so its rates remain biased upward too. A ranged duelist kites and so
  `truncated` more often (a truncated fight is a non-death): ranged rows can understate deaths, which is why truncated
  and `no_engage` fights are counted, not hidden.
* Bots misvalue the reworked cards until P-AUG-BOTS-1, so the `bot_sample` builds are "what bots pick today".
* Survivorship in the bot sample: only about 3 in 8 matches reach minute 5, and builds are those of the players standing.
* Before P-ELITE-TUNE-1 the elite numbers equal legacy: the table is a baseline, not a result.

## Elite numbers: before and after P-ELITE-TUNE-1 (owner decision 2026-11-19, dmg 1.0, hp 1.5)

`camp_bench --elite --fighter both --seed 1` (3 default seeds, 900 samples a cell), stderr tables saved as
`elite_before.txt` (Rework elites at the legacy numbers, hp x2.0, dmg x1.5) and `elite_after.txt` (hp x1.5, dmg x1.0,
`k` unchanged). Release build with `--features elite-bench`. The Duelist at banked_12 is the owner's reference column.

| Duelist, banked_12 | before | after |
|---|---|---|
| overall (died / engaged) | 43.1% | **17.4%** (target 10-20%; the sweep predicted 18.3%) |
| decided (died / (died + cleared)) | 43.8% | 17.7% |
| Brawler (upper bound), overall | 46.2% | 20.6% |

Per weapon (Duelist, banked_12, decided rate): sword 32.0% -> 8.7%, bow 74.8% -> 47.5%, wand 63.0% -> 25.2%, shield
28.9% -> 6.7%, axe 23.3% -> 6.0%, fists 42.6% -> 14.3%. The ranged weapons (bow, wand) stay well above the target.

Per camp (Duelist, banked_12, overall): wyrmling 67.8% -> 25.6%, ashDrake 46.7% -> 22.2%, executioner 23.3% -> 2.2%,
gaoler 74.4% -> 23.3%, ratOgre 32.2% -> 8.9%, poxBehemoth 24.4% -> 14.4%, glacialWarden 53.3% -> 17.8%, avalancheTroll
84.4% -> 46.7%, bloodSaint 10.0% -> 6.7%, archon 14.4% -> 6.7%. The spread is wide: avalancheTroll (46.7%), wyrmling,
gaoler and ashDrake sit above the band, executioner, ratOgre, bloodSaint and archon below it. The numbers were not
tuned toward the sweep's figure.
