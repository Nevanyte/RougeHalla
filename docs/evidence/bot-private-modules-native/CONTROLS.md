# Intake and semantic controls

Two distinct control families are required and both are present: (A) strict atomic-intake negatives that prove no
partially converted case/reaction can be constructed, and (B) bounded semantic controls that mutate **native** inputs
and prove the native decisions/state actually move for the risky branches (they do not replay source answers and do not
mutate the frozen source).

## A. Strict atomic-reader controls (24/24 rejected; matches `verify.mjs readerControls: 24`)

File: `crates/rh-policy/src/bots/temporal_percept/modules/controls_tests.rs` (strict section) and the reader's own
`source_input::tests::strict_negatives_reject_mutated_body` (13 negatives) — one control per distinct validation layer:

| # | Negative | Rejected by |
|---|---|---|
| 1-2 | raw JSON duplicate keys: `{"format":1,"format":2}` and escaped `{"a":1,"\u0061":2}` | `parse_raw` |
| 3 | unsupported tag `{$:"future"}` in an input position | typed conversion |
| 4 | tag object with extra fields `{$:"undefined",x:1}` | closed tag fields |
| 5-6 | duplicate typed `map`/`object` entry keys | typed conversion |
| 7 | number tag spelling `"Infinity"` (only `-0`/`NaN`/`+Infinity`/`-Infinity`) | tag validation |
| 8 | `u8` tag value 256 | u8 range |
| 9-10 | `callable`/`instance` substituted into a declared input | input-vs-diagnostic mode |
| 11-13 | envelope `format:"future"`; extra envelope field; duplicate case id | envelope validation |
| 14-19 | observe: `now` tagged +Infinity; self missing consumed `readyAt`; unknown self `status`; unknown cfg token; `viewT` tagged NaN; nondecreasing Memory clock violated | declaration validation |
| 20-24 | `tierValues` missing a consumed field; absent cfg map label; terrain u8 one byte short; hook name `"future"`; chest row missing `takenBy` | module fact validation |

Every negative asserts exactly one mutation → a path-bearing `Err` (never a panic), and that the untouched body still
loads (255 cases / 3,259 ops / 8 maps / 80 cards / 5 abilities). The admitted reader additionally rejects raw/unescaped
duplicate keys and trailing/truncated JSON. `Undefined`, `Null`, absent and `-0` remain distinct; only the source-
sanitized learned-bias fields admit declared nonfinite values.

## B. Bounded semantic controls (28 native tests, all green)

File: `modules/controls_tests.rs`; owner-module witnesses are in `modules/wishes.rs` (16), `modules/hazards.rs` (11),
`modules/chests.rs` (6), `chest_hunt.rs` (7), `choice.rs` (8), `bots/planning.rs`/`planning_core_tests.rs`, and
`bots/wish/source_core.rs` (12).

| Source mutation control id (frozen source KILL) | Native control witness |
|---|---|
| `choice-first-tie` | first equal score/taken/free option order (controls_tests) |
| `choice-tradeoff-risk` | cost card refused at 0.499999, exactly 5.0 at 0.5 |
| `choice-danger-boundary` | danger augment -Infinity at risk 0.7 exactly, `3+2*0.700001` bits above |
| `choice-prerequisite` | conditional without base -Infinity, 6.0 with base; unique held -Infinity |
| `hunter-hold` | birth hold 149 → no pick/no walk, 150 → exact Pick |
| `hunter-cache` | callback counts 1/1/2 at now 0/249/250 (null cached too) |
| `hunter-distinct-clocks` | expiry/server clock 9000 vs now 50000 picks; server 10000 → none |
| `hunter-stall` | 7×500ms → gaveUp 1/tried/cleanup, exact log strings; strict progress 24 |
| `chests-panel-reset` | owner chests tests: panel close clears readable+asks only; reopen/ask window replay |
| `chests-count-dedup` | owner chests tests + replay `chests-boost-count-dedup-max` (count once/cap3/max-not-sum) |
| `chests-build-max` | owner chests tests: delayed build `Math.max` merge vs sum; replay build-distinguishing |
| `chests-race-limit` | owner chests tests: same-option retry vs changed max3/4000 window; replay panel-race |
| `chests-temporary-hunter` | owner chests tests + replay `chests-goals-vs-act` (goals never spends retained stall) |
| `planning-event-clock` | controls_tests: first deal scheduled from declared event time; shifting event time moves read_until by exactly the shift; later deals draw 0 |
| `planning-resend-boundary` | controls_tests: three asks with reaction.mu, spent/latch boundaries |
| `planning-lapse` | controls_tests: forced lapseP=1 takes lapse branch (2 lapse/0 decide draws) vs argmax |
| `planning-learned-bias` | controls_tests: NaN/±Inf sanitized to +0; finite bias moves boon pick both directions; clamp bits |
| `wish-availability` | owner `wish/source_core` + `modules/wishes` witnesses (Easy one-draw-per-edge) + replay |
| `wish-lastCast` | owner witnesses: real-Memory lastCast armed/pending/cast+700/hidden; replay slip-lastcast |
| `wish-partial-retention` | owner witnesses: armed expiry retains from/leg; replay pending-expiry 2499/2500 |
| `wish-leg-keep` | owner witnesses: keep1200/arrive60; replay arrival-keep 1199/1200/1201 |
| `wish-gated-landing` | replay `wish-blink-gate-crossing-{true,false}` + `wish-blink-real-gates-*` through real open/collision maps and gate flag |
| `hazard-kept-before-map` | owner hazards witnesses: retained step offered before collisionMap; guards no-map; replay held-step |
| `hazard-redirect-threshold` | owner hazards witnesses: 4*TILE strict threshold; replay adjust-planning-alive |
| `hazard-unchanged-identity` | owner hazards witnesses + replay: original-list identity, empty-list collisionMap, ordered redirects |
| `registry-replacement-order` | controls_tests: equal-id replacement keeps position; hooks inventory; policy identity; reset |

The remaining control ids are **not** claimed as native controls: they are covered by the complete frozen replay
individual cases named in the source `controls.json` receipts (e.g. `chests-boost-count-dedup-max`,
`wish-blink-gate-crossing-true`, `hazard-held-step`) and by the owner-module witnesses above. Nothing is called a
survivor or omitted silently.

## First failures retained

Development first-failures were kept in the run log and fixed without weakening assertions: (1) map DTO deserialize
`0.0 expected u64`; (2) `cfg.learned.entries` nonfinite exemption missing; (3) own-`undefined` mob `type` rejected by the
admitted Memory reader; (4) per-HelperName self shapes (activeWeapon only weapons); (5) contexts keyed by cfg id instead
of token; (6) planning no-deal ready adapter panic; (7) registry absent/absent policy identity; (8) Send-compat Arc
migration. None was resolved by tolerances or expected-value edits.

## Commands

```
cargo test -p rh-policy --lib --locked --offline -j1 controls_tests::
=> ok. 28 passed; 0 failed
cargo test -p rh-policy --lib --locked --offline -j1 source_input::
=> ok. 5 passed; 0 failed
cargo test -p rh-policy --lib --locked --offline -j1 frozen_private_modules_source_replay -- --nocapture
=> 255 cases / 3259 ops / 0 failures
```
