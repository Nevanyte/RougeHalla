# P-KIMI-FOLD-1: pure Rust stat fold with bounded differential stress tests

## ID and outcome

You are Kimi Code working on Roguehalla. Port the existing **pure stat-fold kernel** to Rust, then exercise it with a
large, deterministic, bounded differential inventory against the actual TypeScript functions. This is a prerequisite
of P-CARDS-1, not the whole cards/status/combat system. The deliverable is reusable typed Rust arithmetic, captured
legacy evidence, a strict verifier and useful failure localization.

Use a separate checkout on `kimi/stat-fold-kernel`, based on current `origin/optimization_port` containing
`5b1a7aae24fce2be97a075acf04675f95f86e169`. Record the actual base SHA. Open one PR to `optimization_port`; do not merge.
Read `AGENTS.md`, `docs/MIGRATION.md`, `docs/CONTRACTS.md`, `docs/sweep/PACKAGES.md`, `crates/rh-sim/README.md` and this
packet first. Follow the source when comments disagree. Work through the fixed inventory systematically; do not expand
into a new gameplay packet or change another worker's checkout.

## Dependencies

The kernel has no dependency on pending status/card runtime or map generation. No AWS, Cloudflare, Unity or database
login is needed. No new Rust/npm dependencies. Reuse locked test tools and the existing pinned legacy capture runtime.
Claude owns only the separate placement durability packet; Codex retains maps and gameplay/runtime integration.

## Relevant legacy paths (verified)

- `packages/shared/src/mods.ts`: identity sums/products, `foldStatRows`, `foldRows`, conversions, source/farm mirrors,
  `encodeMult`, `decodeMult`, `encodeFlat`, `decodeFlat`, `encodeMirrors`, `decodeMirrors`.
- `packages/shared/src/effects.ts`: stat/product/mult/flag registries, typed rows and `requirementsMet`.
- `packages/shared/src/chestBoosts.ts`: numeric `chestBoostBonus`/`chestBoostGain`, definitions and counted-pick behavior.
  `packages/shared/src/constants.ts` owns imported numeric rules.
- `packages/shared/test/{mods,effects,chestBoosts}.test.ts`: existing reference edge cases; verify names locally.
- `packages/shared/src/cards.ts`: real row examples for capture only. `packages/server/src/sim/mods.ts` shows future
  wiring, which is excluded. `crates/rh-sim/src/{content,schedule}.rs` and `systems/items.rs` show the current neutral
  sources/axe fold. Preserve them. `tools/map-fixtures/README.md` documents canonical Linux x64 Node22.23.4 capture.

## New paths

- `crates/rh-sim/src/stat_fold/**`: typed pure kernel, single rule definition/visitor and module documentation.
- `crates/rh-sim/tests/stat_fold*.rs` and `parity/stat-fold/**`: strict fixture tests and compact checked-in canonical corpus.
- `tools/stat-fold/**`: actual-source capture, deterministic inventory, strict comparison/stress runner and README.
- `docs/evidence/stat-fold/**`: concise results and handoff; do not commit a huge generated soak corpus.

## Exclusive write scope

Own only those new paths, plus the single module declaration/export in `crates/rh-sim/src/lib.rs` needed to compile
`stat_fold`. No new dependencies and no `Cargo.lock`, manifest, source TypeScript, existing fixture, CI workflow, protocol,
Unity, server or placement edits. Do not edit `content.rs`, state/checkpoint/observe/schedule, weapons, ledger, hooks,
existing item fold or shared status records. Supply a minimal proposed content-registration hunk in the handoff for Codex;
the coordinator integrates it with other content changes. Implement `visit_content` now with tests that mutate each
numeric policy field. The kernel is deliberately not wired into live gameplay by this packet.

## Contracts and references

C-NUM/C-DET/C-PARITY: binary64, source operation order, no FMA/fast-math, `rh-sim::math`/libm where needed. The core
reads no files, clock or entropy. Test/capture I/O stays outside production kernel functions. Use existing parity policy
for continuous values, but encode/decode outcomes, integer-valued mirrors, identities, flags, branch/cap decisions and
inventory membership must agree exactly. Do not let a broad tolerance hide a different quantized result. No ML work.

## Behaviour to preserve

1. Port only stat/flat/while summation, product-stat accumulation, requirements, one-pass conversions, mult/flag folding,
   max-HP floor, caps, AP multiplication, farm rows, stat-chest numeric boosts, source modifiers, farm-AS efficiency and
   mirror encoding/decoding. Include their direct pure identity/helper functions. Exclude weapon timing helpers, barrier/
   lifesteal/slow/crit helpers, reward RNG/options, full card catalog/hooks and all world runtime/event behavior.
2. Use closed typed keys and rows. A while decision is an injected caller answer associated with that exact row; this
   packet does not implement condition evaluation. Ownership is an injected set/predicate. Preserve row order and default
   false semantics. Known `vs`/`scale`/`onHit`/`trigger` rows are intentionally ignored by this fold, as in the source;
   distinguish them explicitly from an unknown/malformed row. Document any projection of those ignored payloads.
3. Conversions read the original plain/farm sums, not earlier conversion outputs; preserve per-row then aggregate caps,
   product identities, AP ordering, earned rows outside card/source ceilings and boost gains from one pre-boost sheet.
   Cap attack speed before `asPost`; keep the source's treatment of positive versus negative farm efficiency contributions.
4. Preserve float mirror arithmetic: half-up via `floor(x*scale+0.5)`, multiplier lower bound, no obsolete 20 ceiling,
   overflow guards, negative flat values and each function's actual non-finite fallback. Do not cast float mirrors to a
   narrow integer. Preserve signed zero/NaN/infinity classifications where the source exposes them.
5. Define constants/tables once. Reuse existing canonical Rust rules where they already exist; do not invent a second
   balance catalog. Expose the remaining new numeric rules through one definition plus content visitor. Use fixed typed
   sums/flags; do not add a dynamic framework or speculative caches. Live no-allocation/tick rules remain unchanged.

## Acceptance checks

**SUCCESS — all of these must hold:**

- All in-scope functions are mapped to source symbols in an inventory. Rust output includes complete plain/sums/farm/
  mults/flags/maxHP, unencoded mirrors, encoded mirrors and decoded values. A final digest alone is insufficient.
- Capture calls the **actual unchanged TypeScript exports**, with source checksums, commit, exact command and runtime
  provenance. Canonical checked-in capture uses Linux x64 Node22.23.4; host-only probes are labelled diagnostic. Special
  float tags/bit encodings must round-trip without JSON converting NaN/infinity to null. Rust never reads expected answers
  as inputs. An independent recapture `--check` fails on any byte difference without rewriting fixtures.
- A fixed `ci` inventory has at least 4096 nonduplicate cases and an explicit coverage table: every stat/mult/flag,
  requirements absent/all/partly owned, each while condition true/false, every conversion source and admitted target,
  row-order interactions, farm/boost/source combinations, cap neighborhoods and encoding ties/overflow/non-finite inputs.
  Include actual card row inputs and deliberately labelled synthetic boundary cases; do not invent captured gameplay.
- A separate `soak` preset runs at least 100000 reproducible cases in bounded batches with explicit seed/count limits,
  at most two workers and a documented timeout. Keep the routine CI workload short and measure runtime before finalizing
  it. Do not saturate all cores while other agents work. Store only compact evidence and first-failure reproduction.
- The comparator rejects empty, missing, duplicate, reordered or extra cases, bad types, unknown keys/variants and any
  mismatch. CLI rejects zero work, unknown/duplicate arguments and out-of-range counts. Fail nonzero with case/seed,
  function/field, inputs, expected/actual and minimal replay command. No hidden skips or fallback expected values.
- Negative controls kill at least these eight behavior changes: additive product stat; conversions feeding later rows;
  cap after `asPost`; farm rows included inside a card ceiling; per-pick self-compounding boost gains; missing requirements;
  reversed while decision; ties-to-even/narrow integer mirror encoding. Each unchanged control passes and each mutation
  fails for a semantic mismatch, not a compile error. Add fixture-integrity negatives for an empty/duplicate/missing case.
- Focused tests, canonical recapture, CI inventory, bounded soak, formatting, strict Clippy and existing parity pass.
  Report exact base/head/toolchain/commands, actual case counts, runtime, mutation results, content-integration hunk and
  known limits. Existing authoritative fixtures and hashes remain unchanged until coordinator registration.

**FAILURE — return incomplete with preserved evidence if any apply:** hand-written replacement TypeScript oracle;
expected answers generated by Rust; changed reference/fixtures to mask a mismatch; partial inventory/unknown rows silently
skipped; tolerance hides different mirror/cap/flag outcomes; soak is unbounded or merely repeats identical cases; gameplay
wiring/shared files changed; source capture or required tests unavailable/skipped. Do not claim the whole card system works.

## Validation commands

Existing commands:

```sh
cargo fmt --all --check
cargo test -p rh-sim --test stat_fold
cargo clippy -p rh-sim --all-targets --all-features -- -D warnings
cargo run -p rh-parity --bin parity-report
```

The `stat_fold` test target, canonical capture/bytecheck and `ci`/`soak` commands are **to be created by this packet** and
documented in `tools/stat-fold/README.md`. Reuse the existing lockfile and pinned runtime; no global tool changes. Once
focused checks pass, run the existing workspace gate once. Report any unavailable environment honestly.

## Risk and suggested model tier

Medium, with a narrow scope and strong reference: suited to Kimi's Rust implementation and repetitive test generation.
When a rule or numeric boundary is uncertain, preserve the smallest source-backed failing case and ask the coordinator
instead of guessing or widening scope. Codex independently reviews before integration.

## Known traps

- Product-stat identity is 1, not 0. Farm rows and boosts intentionally exceed some card/source caps.
- `MOD_MULT_MAX` is retained legacy presentation data, not an encoder ceiling. Flat values remain float64 wire units.
- Conversions and boosts each use their own source-defined snapshot; sorting rows or re-associating sums changes behavior.
- The boost mutant must change arithmetic, such as recomputing the base after each pick (AD current 25, two picks gives
  source 9 versus erroneous 9.8). Reordering independent distinct-stat gain calculations alone is equivalent, not a bug.
- Known ignored effect kinds are not unknown input. Missing/non-finite mirror fields have function-specific behavior.
- This kernel does not activate cards, statuses, conditions or client prediction. No Unity game rules are authorized.
