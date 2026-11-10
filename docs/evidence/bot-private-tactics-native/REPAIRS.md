# HOLD-repair round (Root independent initial review `a54533b8`)

This document records the bounded repair of the three worked groups in Root's independent HOLD review
(`docs/evidence/bot-private-tactics-admission-review/README.md`, committed `a54533b8`, inspected cut
`f252b8697cbff3afcee71711cf33db40c411399a`). The reviewed cut and its receipts remain in the history above; this file binds
the repaired candidate. No fixture, source expectation, tolerance or production behavior was changed: all edits in this
round are in the test-only harness/comparator/decoder modules and the private evidence.

## Group 1 — one real checked apply entry and meaningful non-advance

Repair:
- New single checked typed-intake producer `source_decode::decode_declaration_checked(declaration, suite, config)` (the
  same `decode_declaration` path the case decoder uses; full strict validation preserved, not an injection-only branch).
- New single apply boundary `source_tests::CaseRunner::apply_checked(declaration)`: it decodes the supplied declaration
  first and only on success resets the per-operation trace, applies the declared `env`, and executes the real native
  method. A rejected declaration leaves the trace (full ordered encoding), env, Memory, retained counters, decide
  ordinal, path stats/budget and reached Percept untouched.
- **Normal replay now goes through this same entry for every operation** (`replay_case`), instead of executing a
  predecoded operation after resetting state. `execute_native`/old split were removed; the changed-input and partial
  replay controls also use the same entry.
- `NativeSnapshot` now covers actual state, not just counters: full delivered-Memory snapshot; retained suite counters;
  full ordered callback/RNG transcript string; decide-draw ordinal **and** the independently replayed next decide value
  (bit pattern); direct retained Knowledge fingerprint (all weapon-edge answers from the real admitted instance); path
  service `searches/hits/fallbacks` **and budget-left**; current declared path environment; the complete reached
  `TacticPercept`. In addition, every non-advance control executes the complete unchanged remaining history on the
  reached runner through the same entry and requires its transcript to equal uninterrupted execution exactly (this
  exposes nested Fight/Orb/Reflex/Retreat/World timers/plans/caches behaviorally without fabricating source getters).
- Controls: 8 malformed operation declarations (nonfinite/missing consumed field, unsupported enums, duplicate field,
  NaN/Infinity clocks/geometry) injected on a reached runner after 2 real chronologically applied operations. Each
  names the consumed field in the typed error, leaves the full pre/post snapshot identical, and then resumes the exact
  remaining transcript. Plus 1 case-level config intake rejection (`tierValues.orbwalk.p` removed) through the same
  typed decoder before any runner state exists.

## Group 2 — tagged order at every specialized boundary

Repair:
- Specialized comparators now check the ordered key sequence of every carried tagged `MethodValue` object **before** any
  field lookup or approved-leaf-tolerant comparison: act/check result roots, Intent objects (including the tolerated
  `move.to` derived point, which must still be an ordered `x,y` object), each callback/RNG event object, `paths.walk`
  result objects, the root Memory section object, and the plain derived-point helper.
- The only main-corpus exclusion remains the plain fixed-schema `drawCounts` envelope (parsed through the serde
  envelope map, which does not preserve JSON object order); it compares as a consumed key set and arrays/values stay
  exact. Documented in `source_trace`/`source_tests`.
- The **compatibility corpora** (`bot-fight`/`bot-reflex` plain JSON) are a separate documented path: their captured
  objects are canonical **sorted-key** plain JSON (`{attacking,intents,status}`, `{at,kind,priority,target,timing,why}`),
  so JSON property order there is a serialization artifact, not carried source insertion order. Their comparisons run
  with `CompareCtx.ordered = false` (key sets, array/Map/Set order, values and identities still exact). This exclusion is
  stated in `compat_tests.rs`; the frozen tagged witness keeps full ordered tagged comparison.
- New bounded permutation controls (values identical, order only) prove RED for: act-result root; Intent entries; check
  result root; callback event object; `paths.walk` result object; root Memory sections; tolerated `flee` derived point.
  The existing controls still prove tagged Memory/self-argument order detection and the plain `drawCounts` key-set
  exclusion (with extra-key strictness retained).

## Group 3 — geometry tolerance bound to computed pickHoldSpot ancestry

Repair:
- `coliseum_spot` (the only tolerance that reaches a callback/argument point) is set only when the expected
  `to the coliseum spot` move target differs from the declared Hold goal endpoint, i.e. it is an actual computed
  `pickHoldSpot` leaf. A direct declared `Hold.at` walk keeps it false and its `paths.walk` argument 1 compares bit-exact,
  matching the output-Intent declared-endpoint rule.
- Controls: the three captured direct declared endpoints (`world-arrive-24.001-0` op2, `world-arrive-120.001-800` op2,
  `world-arrive-100-799` op2 — respectively `(1024.001,760)`, `(1120.001,760)`, `(1100,760)`) are perturbed by `1e-9` in
  the expected `paths.walk` argument and must compare RED; the genuine computed crowded-slot target in
  `hold-crowded-spot-stale` is perturbed by `1e-9` and must stay GREEN inside the approved `2e-6` derived-geometry leaf.
  No tolerance was widened and direct endpoints/route waypoints/status/flags/collision booleans/order/RNG/timers stay
  exact.

## Root-accepted design variance

Root accepted (verbatim in the HOLD review) the full-tier private `Reflexes` design variance: the admitted
`bots::reflex::Reflexes` selects `TierParams::by_id` from `TierId` and cannot express the resolved per-case witness
overrides, so the private source-derived Reflexes with real admitted Memory stimuli/feints and the existing
68-row/67-check compatibility overlap stands. The existing public component is unchanged; this grants no blanket
duplicate-engine authority.

## Full coverage preserved

- Frozen witness: **154 cases / 720 operations / 0 failures**, recreate **154/720 / 0 failures** (same corpus hashes as
  the released admission: `source.json` `5d27d1b4…`).
- Compatibility overlap: timings 90/90+6/6; orbs 6/6 cases/20/20 rows; direct Fight 1/1; fight/tactics 16/16 cases,
  47/47 rows; reflex 49/49 cases, 68/68 rows, 67/67 checks — all 0 failures with the documented plain-JSON order
  exclusion only.
- Native controls: 17/17 strict reader negatives; 1 envelope guard (154/720/70); 17 private/compat/control tests + 1
  decode smoke + 1 plain bridge = `private_tactics` filter **18 passed / 0 failed**; new specialized permulation and
  coliseum tiny-delta controls included.
- fmt exit 0; strict default and `--all-features` clippy with `-D warnings` exit 0.
- `focused-regressions.log` note: filters that selected 0 tests (`bots::orbwalk::`, `bots::humanizer::`, `bots::paths::`,
  `bots::knowledge::`, `bots::mob_hunt::`) are **not** regression proof; the authoritative coverage receipt is the full
  library run (`repair-full-regression.log`, post-repair; the earlier `full-regression-final.log` 236-pass run was the
  pre-repair production-identical run). See `focused-regressions-NOTE.md`.

## Repair-round receipts and identity

- `repair-private-tactics.log` (18 pass/0 fail, 6.00 s), `repair-focused.log` (compat 5, source 5, single-control exits 0),
  `repair-fmt.log`, `repair-clippy-default.log`, `repair-clippy-all.log`, and the post-repair full library run
  `repair-full-regression.log` (**238 passed / 0 failed**, 234.41 s, exit 0).
- Refreshed bytes/lines/SHA-256 for the whole native source: `source-inventory.txt` (regenerated after the final harness
  edits, superseding the stale pre-repair inventory). Fresh receipt SHA-256 values are in `receipt-identities.txt`.
- No source/tool/fixture edits; corpus hashes unchanged; no build artifacts in the source tree; candidate remains
  uncommitted for Root's seal.
