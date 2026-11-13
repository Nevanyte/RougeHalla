# P-BOT-TUNER-2: the search's output can tell an improvement from noise

- **Serves:** owner decision 8 (a light offline tuner producing a reviewed, checked-in table); reviewer-opus note 2
  on P-BOT-TUNER-1 (2026-11-13)
- **Implementer tier:** implementer-sonnet (rh-headless, one area)
- **Reviewer:** reviewer-opus (bot tuning)
- **Integration base:** feature/unity-rework (P-BOT-TUNER-1 merged)
- **D-rules touched:** R-ML: offline, seeded, existing numbers only, one reviewed table · no live change

## 1. ID and outcome
The search file holds one scalar per candidate. In a short run every candidate tied the baseline, and nothing in the
file can separate noise from improvement, so no table can be adopted on its evidence. When this lands the file
records, for the baseline and for the best table: per tier the wins and games with a Wilson interval (the
`Proportion` the tournament report already computes: k, n, lo, hi), the persona spread, and a re-score of the best
table against the shipped tables on a held-out `--tournament-seed` the search never used, with the same per-tier
intervals. The binary prints a one-line verdict per tier: better (intervals do not overlap), worse, or not
distinguishable. Nothing applies a table; the shipped numbers stay until the owner checks one in.

## 5. Exclusive write scope
- `crates/rh-headless/src/tune.rs`, `crates/rh-headless/src/bin/tune.rs`, a new test file

## 7. Behaviour to preserve
- The search itself: the same seed and plan give the same best table as today (pin it); every existing golden.

## 8. Acceptance checks
- The output carries the fields above; a seeded run is byte-identical on 1 and 2 workers; the held-out seed differs
  from every search seed (refused otherwise); the verdict line is "not distinguishable" for a table equal to the
  shipped one.
- `scripts/gate.sh --quick --oracle packet/P-BOT-TUNER-2` passes.

## Oracle files (read-only for implementers)
- `crates/rh-headless/tests/tune_evidence.rs` (the packet file itself is also read-only once committed)

## 10. Risk and suggested model tier
Sonnet. Also fold in the one item P-BOT-LEARN-TUNE-fix left: a tuned tournament's report shows the shipped reaction
and APM columns (`tournament.rs` `tier_params` reads the compiled tables): pass the plan's tables to the aggregate.

## Oracle author's completion (2026-11-13)

### 3. Relevant legacy paths
- None to port: legacy `tune.ts` has no search. The interval is `tournament.rs:836 wilson` (`Proportion { k, n, p, lo,
  hi }`, z = 1.96), the one the report's `win_rate` uses (`tier_agg`, `:1251`).

### 5. Exclusive write scope (widened by this oracle; the owner confirms)
- `crates/rh-headless/src/tune.rs`, `crates/rh-headless/src/bin/tune.rs` (the brief's scope)
- `crates/rh-headless/src/tournament.rs`: replace the `aggregate_with` stub; read the tables through a helper instead
  of `tier_params`/`table_reaction_mean` reading the compiled ones; `aggregate` stays and calls
  `aggregate_with(games, &BrainTables::COMPILED)`
- `crates/rh-headless/src/bin/tournament.rs`: call `aggregate_with` with the plan's tables when `--tune` is given;
  otherwise unchanged output
- The brief's scope named only the first two; point 4 (section 10) cannot be done without the other two.
- Not `rh-policy`, `rh-sim`, `rh-server`. Nothing applies a table anywhere.

### Stubbed on `packet/P-BOT-TUNER-2` (the `stub:` commit; the implementer replaces these)
`tune.rs`: `Verdict`, `verdict`, `TierComparison`, `compare_tables`, `HeldOut`, `Evidence`, `check_held_out_seed`,
`evidence`, `search_file_with_evidence`. `tournament.rs`: `aggregate_with`. `bin/tune.rs`: `--held-out-tournament-seed N`
parsed and ignored. No existing signature changes: `SearchConfig` gains no field (existing tests build it by literal),
`search_file` is untouched.

### The exact comparison (verdict)
Per tier, on per-bot wins (placement 1; the tier's bot-games are the denominator), Wilson 95% (z = 1.96):
- better: `best.lo > baseline.hi` (strict: touching is not better)
- worse: `best.hi < baseline.lo`
- not distinguishable: anything else, including a tier nobody played (n = 0, NaN interval).
Both tables play the SAME games (same plan and seed), so the two intervals are not independent samples; the rule is
therefore conservative.

### Output schema pinned (one new top-level key; every existing key unchanged)
`search_file_with_evidence(config, result, &evidence)` = `search_file(..)` plus
```
"evidence": {
  "interval": "wilson 95% (z = 1.96) of per-bot wins",
  "spread":   { "baseline": persona_spread(compiled), "best": persona_spread(best) },
  "search":   { "tiers": { "easy|normal|hard": TIER } },        // the search's own plan: in sample, optimistic
  "heldOut":  null | { "seed": u32, "tiers": { "easy|normal|hard": TIER } }
}
TIER = { "baseline": P, "best": P, "verdict": "better" | "worse" | "not distinguishable" }
P    = { "wins": k, "games": n, "p": k/n, "lo": .., "hi": .. }   // wilson(k, n, 1.96); games = the tier's bot-games
```
`heldOut` is `null` (key present) without the flag. `evidence(config, result, arena, sim, held_out_seed)` plays the
comparisons (baseline = `BrainTables::COMPILED`) and returns `Err` for a refused seed. `compare_tables(plan, arena, sim,
policy, baseline, candidate)` returns one row per tier of the lineup, in easy, normal, hard order. The held-out numbers
are pinned against a plain `play_tuned` + `aggregate` of each table on that seed.

### Held-out seed
Flag `--held-out-tournament-seed N` (the binary names the scoring seed `--tournament-seed` and the search's `--seed`).
Search seeds are those two. `check_held_out_seed` returns `Err` containing "held-out", the number and the colliding flag
(`--tournament-seed` or `--seed`); the binary exits 2 with that text on stderr BEFORE searching and writes nothing.

### Stdout
After the existing two lines, one line per tier: `"<tier>: <verdict> ..."` (anything may follow the verdict phrase),
using the HELD-OUT verdict when the flag is given and the in-sample verdict otherwise. The tests pin the prefix and that,
with the flag, it equals the file's held-out verdict.

### Point 4 (the tuned report's reaction and APM columns)
Callers of `aggregate(games)`: `tests/tournament.rs` (281, 758, 883, 932), `tests/tournament_runner_remainder.rs:395`,
`tests/tournament_learning.rs:378`, `tests/learn_tune_fix.rs` (41, 68, 77), `src/tune.rs:678`, `src/bin/tournament.rs`
(105, 116). `json_payload*` takes a `&Report`, so it needs no change. Changing `aggregate`'s signature would touch every
one of those test files; it does not need to. The ADDITIVE `aggregate_with(games, &BrainTables)` carries the tables;
`aggregate` delegates with `BrainTables::COMPILED`; no existing test is edited. The oracle pins `aggregate_with`
(patched `pooled.table`, `apm_limit`, and every `ReactionRow.table`; with COMPILED it equals `aggregate` byte for byte).
NOT pinned: that `bin/tournament.rs` passes the plan's tables under `--tune` (that path has no small test); the
reviewer checks the call site.

### Guards and their limits
- `guard_the_searchs_best_table_and_file_do_not_move`: FNV-1a digest of the pretty-printed best table and of the whole
  existing `search_file` (seed 5, plan seed 7, 3 generations x 2 proposals, Human seats, practice arena), computed on
  the current code. LIMIT: at every size small enough for the quick gate (Human and Brain runs tried, up to 5 x 4
  proposals on 4 games) no proposal beat the baseline, so the best table IS the shipped table. The file digest still
  pins every proposal's changed leaves (the RNG stream, bounds, redraw rule) and every score, but not the accept step.
  Digests produced on macOS arm64; not run on Linux x64.
- `guard_the_existing_fields_are_unchanged_by_the_evidence` and
  `guard_without_the_flag_the_binarys_existing_fields_are_the_librarys`.
- Legacy doubts: none. With Human seats the tables barely reach play, so a short run honestly says "not
  distinguishable".

## Notes from previous attempts
