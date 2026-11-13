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
- listed by the oracle author on `packet/P-BOT-TUNER-2`

## 10. Risk and suggested model tier
Sonnet. Also fold in the one item P-BOT-LEARN-TUNE-fix left: a tuned tournament's report shows the shipped reaction
and APM columns (`tournament.rs` `tier_params` reads the compiled tables): pass the plan's tables to the aggregate.

## Notes from previous attempts
