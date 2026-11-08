# Pure mob catalog and roster leaf

Implemented in an isolated detached checkout of `49726d60fdd92e669c6605b13bac40c14ba56421`. This evidence concerns P-MOBS-CATALOG-1, not runtime mobs. The only existing source edit is the private checkout's `pub mod mob_catalog;` compilation seam. No dependencies, shared runtime, status, map, transport, protocol or TypeScript rules were changed.

The Rust module holds 30 typed catalog rows (20 normal, 10 elite), five ordered roles with full labels/blurbs/tags/multipliers, five region name/default-weapon rows, and roster/reach rules in one immutable `DEFINITION`. Type rows refer to their role definition rather than repeating its values. `visit_definition(&Definition, ...)` visits those actual rows; a copied definition can be perturbed by coordinator content tests. Typed role/tag/type spelling accessors support registration without an identity-only shadow table. This leaf supplies draw-injected roster helpers, not a random generator, actor store, combatant, faction sheet, spawn hook or world integration.

## Source oracle and inventory

The helper imports unmodified public exports of `packages/shared/src/mobs.ts` and `rosters.ts`. Its provenance hashes the complete 15-file static local import closure (13 shared source files, helper, package-lock), records the full base revision and canonical runtime. Source inputs are declared independently of fixture answers. Synthetic tapes are 49 values generated with explicitly specified unsigned LCG arithmetic in the helper; they are **test inputs**, not a port or proof of the private world's four-word sfc32/16-warmup stream. The native test independently generates the declared inventory and tape inputs, checks current source SHA-256, recursively rejects duplicate keys, admits a closed schema, and recomputes every expected result using Rust. Numeric comparison is exact f64 value comparison (JSON `1` and `1.0` have the same numeric value), without tolerance.

Canonical fixture: 322 cases, with ordered IDs and full inputs/outputs/draw continuations. Coverage is one catalog case, one regional-kind case, 204 camp-roster cases, 40 zone cases, six elite-roster cases and 70 spot-expansion cases. Catalog checks cover all 30 type IDs, five roles, 170 region/lookup pairs (known IDs, missing value and three explicitly declared unknown strings), default names/weapons, ordered per-region normal/elite lists and all reach multipliers. Unknown lookup strings are legitimate fallback cases; malformed typed region/type keys in roster inputs are refused.

Two hundred distinct declared stream tapes cover interleaved/repeated zones and varying first-seen order. Payload-only uniqueness is checked natively and independently over the 200 actual arrays encoded as 49 big-endian IEEE754 doubles; IDs, labels, seeds and answers are excluded. Additional cases cover empty maps, counts 0/1/4/10/12/13/25 in every zone, shuffle draws 0/0.25/0.5/0.75/(1-2^-32), elite wrap, missing/explicit cross-zone elite overrides and empty/negative/out-of-range elite spot indices. Across 320 tape cases: 9,360 consumed draws and 1,280 continuation values (exactly four per case). Elite and spot helpers consume zero draws. Full ordered per-case counts and tape payload hashes are in the external `coverage.json`.

## Commands and observed results

Canonical source capture/check uses Linux amd64 Node **22.23.4**, cached Docker image `c86ecead9e55 --pull=never`, an unchanged read-only repository, executable tmpfs node_modules/tmp and `npm ci --ignore-scripts --no-audit --no-fund`. Actual commands inside that environment:

```
node --import tsx tools/mob-fixtures/catalog-rosters.ts --capture --output /out/catalog-rosters.json
node --import tsx tools/mob-fixtures/catalog-rosters.ts --check
node --import tsx tools/mob-fixtures/catalog-rosters.ts --self-test
```

Installer evidence: npm 11.19.1 runs under the cached image's Node 24.22.2; the source runner explicitly uses the mounted Node 22.23.4 binary with tsx 4.23.15. Fixture provenance asserts that source runtime.

Capture bytes are copied to `parity/mobs/catalog-rosters.json`; check/self-test never rewrite a fixture. The helper requires exactly one mode, rejects duplicate/unknown/malformed/incompatible flags, and supports no subset filter: `--only absent` fails rather than selecting zero work. `--output` is only valid with capture. Canonical bytecheck re-evaluates unchanged source and exact full provenance/inventory/outputs; any missing/extra/duplicate case, stale hash, malformed fixture or byte drift fails. The Rust verifier requires no Node runtime.

Observed focused validation:

| Check | Result |
| --- | --- |
| `cargo test -p rh-sim --locked --test mob_catalog -- --nocapture` | 5 passed |
| Same test with `--all-features` | 5 passed |
| `cargo test -p rh-sim --locked --test no_alloc` | 1 passed; existing warmed tick still zero allocation |
| `cargo clippy -p rh-sim --locked --all-targets -- -D warnings` | passed |
| Same Clippy with `--all-features` | passed |
| `cargo fmt -p rh-sim -- --check` | passed |
| Canonical capture then `--check` | exact bytes reproduced |
| Canonical `--self-test` | 17 controls rejected |
| `cargo test -p rh-sim --locked --test content` | 20 passed; one expected coordinator registration failure below |

Rust 1.97 toolchain, incremental compilation disabled, two jobs, dev debug disabled, dedicated `mob-catalog-target` (about 231 MiB). No full workspace/map suite was run privately. Root owns broader integration checks.

The native strict-fixture test rejects 23 individually changed fixtures plus two recursive duplicate-key inputs and non-JSON NaN (26 controls). These are malformed-fixture/comparator checks, **not compiled implementation mutations**. Separately, 13 real compiled Rust mutations were all detected by the complete source parity test: catalog name, role HP, typed weapon, cross-zone fallback, case-folded unknown ID, reach multiplier, first-seen zone order, camp order, merged shuffle rounds, extra draw, erroneous empty-zone draw, elite wrap and bag wrap. Each ran a compiled test (no compile errors counted), left the source oracle/answers unchanged, and was restored. External patches/logs preserve every mutant and outcome.

## Coordinator seam and limits

`content` fails solely at `mob_catalog/mod.rs: DEFINITION (Definition)`, correctly detecting an unregistered gameplay definition. This is deliberately not suppressed. Coordinator must fold the actual visitor's role/type/region/rule fields, stable spellings and ordering into aggregate content identity; add the real table to `TABLES_FOLDED_BY_HASH` only after registration; add perturbation coverage and refresh the golden identity. The generic visitor supports copies for those perturbations. A proposed folding fragment and precise field checklist are in the external `content-seam.txt`. No full packet success is claimed until that shared gate and independent review pass.

Roster APIs admit typed faction/type IDs, nonnegative integer counts and signed integer elite indices, matching their intended source map/count domain; they do not model malformed JS faction IDs, fractional/NaN counts or runtime map admission. Draws must be finite in [0,1); helper/native admission rejects malformed/exhausted tapes. Vec allocation in these pure construction helpers is explicit; no claim is made about a future runtime spawn allocation boundary. Full source faction scaling/signatures, native sfc32, runtime actor/provenance/AI/combat/rewards/respawn, visibility/headless and shared content acceptance remain outside this leaf.

External immutable handoff: `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/mob-catalog-evidence/`. It contains own-file hashes, the patch, complete command/output/exit records, all first failures, canonical source provenance, ordered coverage and compiled mutations. Initial failures were environment mountpoint creation, a signed fixture-index compile error, integer/float JSON equality and const-address assumptions in the test harness, and a Clippy test-type alias warning. They were corrected; the expected content registration failure remains open.
