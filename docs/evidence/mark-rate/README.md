# P-SENTENCED-MARK-RATE-1 — Gathering Storm drives actual Mark progress

Continuation from immutable `c5b11341cb4abe4149ddbf99f10223592c1a703a` (base) on `deepseek/p-sentenced-mark-rate`
(head in the coordination report). Bounded native/restore candidate: no schema/checkpoint/hash-coverage/content/
schedule/format/derived-tape/server/protocol/client changes, no new serialized field, RNG, command or module, no console
INTERACTIVE gate widening and no live activation.

## Defect and production change

Source `factions.ts::markStep` adds `markRateOf(c.s) / Math.max(f.chill, 0.05)` to `markProgress` per qualifying hit;
`mods.ts::markRateOf` is `max(0, 1 + folded MarkRate sum)`, and the ready unique Gathering Storm contributes +0.5. Native
`systems/sentenced.rs::before_damage` added `1 / chill.max(MARK_CHILL_FLOOR)`, so the offered card did nothing.
The port now reads a narrow folded accessor and uses shared pure helpers:

- `modifiers/mod.rs`: `Runtime::mark_rate()` = `mark_rate_of(&StatSums)` = `max(0, 1 + sums.markRate)` (existing Runtime
  cache, no StatView expansion and no unrelated literal call sites);
- `modifiers::mark_rate_of`, `modifiers::mark_progress_increment(rate, chill)` = `rate / chill.max(MARK_CHILL_FLOOR)`
  (source arithmetic order and the existing denominator floor preserved), and `modifiers::maximum_mark_rate()`, derived
  from the shipped catalog (base 1 + each card's MarkRate rows; unique cards once, stacking cards at the byte max);
- `systems/sentenced.rs::before_damage` computes the increment once per owner tick from the folded rate and prior-tick
  chill, then adds it per qualifying hit. Qualification, tick order, pulse counts, hit/swap counters, No Commutation/
  Swift Judgment promotion semantics and other faction effects are untouched; the production helper is the same one
  whose derived output the root can fold into the content identity.

The catalog scan proves the shipped MarkRate producer set is exactly `Gathering Storm` (+0.5, unique); no farm, trade,
status or other card row can produce a different rate. With the source's nonnegative `max(0, …)`, the reachable
historical rate is therefore in [1, 1.5].

## Restore bounds (actual reachable history)

`systems/sentenced.rs::validate` keeps all prior finite/nonnegative/zero-hit/counter/earned-tier/target/time/denial
checks and the Frost minimum-chill reasoning; only the progress ceiling now uses the derived catalog maximum rate:
`max_increment = mark_progress_increment(maximum_mark_rate(), min_chill)`, `max_progress = hits * max_increment`, slack
scaled by the same increment. Ordinary ownership only grows and may add Gathering Storm mid-Mark; past increments are
never recomputed from today's rate; Training Clear may remove the card without resetting the Mark, so history may span
both rates. The old 1.0-rate ceiling is not a validation bound any more; an over-catalog-rate progress is still refused.
`resistance_tests::malformed_mark_progress_and_other_invariants_still_refuse` was updated to that derived maximum (the
only existing test change; expected source corpora are untouched).

## Evidence produced

- Dedicated runtime tests `systems/sentenced/mark_rate_tests.rs`: helper/catalog derivation, real neutral vs Gathering
  Storm progress with unchanged counters/promotion, mid-Mark grant (past kept, new rate used), real Training Clear
  removing the card without resetting the Mark and the following hit using rate 1, derived restore bounds (over the old
  1.0 bound accepted; over the 1.5-derived bound refused; finite/zero-hit/counter refusals retained), and real
  checkpoint restore/continuation plus a recorded active replay with accumulated Mark progress.
- Pinned actual-source corpus `parity/mark-rate/runtime.json` (8 cases, 82,049 B, SHA256
  `b55227988496ab01717cbf08c26ee56750cb05db544f28a81272f25116847954`): declared player-only/no-mobs full-player
  faction profile (signatures:true, generated map seed1 attempt0), real `grantCard` and ordinary validated
  target/attack/swap inputs, 50 ms steps. Cases: neutral-rate, gathering-storm, mid-mark-grant, frost-resisted,
  frost-deepened, tier-flags (with a real target swap), opponent-card-control and training-clear-history. Frames record
  actual source public facts and private Mark/chill/tier/counter state; no expected progress/chill/tier/damage installed.
  Provenance records the image/platform/Node, capture tool hashes (`capture.mts`
  `46b6a1be…`, `capture.sh` `cfd6aee3…`, `run-mutants.sh` `adfcda53…`), package-lock hash `991869bd…`, the profile and
  all 127 imported source-file hashes (digest `e6efe7f3048659701a589433d1690651e8a43d28aa2610bedad744cc3705e1a1`).
  Pinned `capture.sh --check` is byte-identical.
- Native consumer `systems/sentenced/mark_rate_source_tests.rs` replays all eight captured cases through the real
  Rust profile/producers and compares the complete bounded timelines (public sig/markTier/brand/markBy/markTax + private
  Mark target/tier/hits/progress/swaps/denied/farSince/ampUntil/chill) within 1e-6; source start frames that predate the
  source factions runtime are compared on their player/public facts only.
- Semantic mutants (`tools/mark-rate-fixtures/run-mutants.sh`, compiled Rust): `01-mark-rate-missing`,
  `02-prior-chill-arithmetic-wrong`, `03-history-restore-broadened` — 3/3 killed by real semantic test failures
  (compiled, restored control passes).
- Checks: `cargo test -p rh-sim --lib --all-features systems::sentenced` 33 passed; `--test no_alloc` 1 passed (warm
  allocation gate); `cargo fmt --all -- --check` clean; both strict rh-sim clippy feature modes clean.

## Identity / publication / remaining

1. **Content identity is root-owned**: this packet adds no registered constant (the rate is derived from the shipped
   catalog and the helpers' actual outputs are the rule material), so it intentionally does not edit content
   registry/goldens/derived tapes. The root should register/fold the new helper outputs and derive the final combined
   identity; an unchanged candidate hash is not treated as compatibility proof.
2. **Observation/protocol publication** of MarkRate behavior remains a separate scope (native Obs18/protocol12 are other
   lead scopes); no schema/observation/wire change here.
3. **Replay limitation (precise)**: a direct `grantCard` is not a `ReplayInput`, so the recorded replay covers an
   accumulated-Mark active run at the neutral rate; card-specific continuation is proven by the real checkpoint
   restore/continuation and mid-Mark grant tests. A replay that includes a card acquisition must go through a real
   in-band acquisition producer (e.g. a chest choose), which this player-only bounded evidence does not add.
4. Console INTERACTIVE remains unchanged; Training Clear is the admitted removal path, and the training case uses the
   real Train Clear command. Full NPC/other full-port prerequisites remain separate.
