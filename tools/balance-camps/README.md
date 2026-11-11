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
