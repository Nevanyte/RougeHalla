# Two frozen Rust QA test repairs

Base: `3c2efb7b35e2772bbbaa779185a4000ae82cd73e`. Both exact tests independently reproduce their reported failures.
No production gameplay, validation, source corpus, expected result, header, tape, lockfile or shared status record changes.

- `49f2d99fd620796213bd67abc9f46d9d177bdad8`: the group source comparison read
  `regional_brain().mode` before checking Dummy. Dummies honestly have no regional brain. Move that read into the
  non-Dummy branch; keep mandatory JSON null, discrete/sparse snapshots and complete Mark pulse comparisons intact.
  The exact six-case source test now passes; no row/expectation is omitted.
- `d09848b20b9d9ea04e6f56dd68a06b10f5668c07`: the owned-zombie Frost fixture's original fresh zombie has
  76 HP (950 owner max HP × existing 0.08). Read-only temporary test logging confirms target6 receives an actual
  Frost Bow hit for 138.0102564102564 at tick37 and is then Dead, with chill1/no chillers/no ranged window.
  This is a lethal-hit setup failure BEFORE restore, not a restore error or a demonstrated moving-target miss.
  Source `packages/server/src/sim/factions.ts:860–873` builds standingCombatants and only applies ranged chill when
  that post-ledger victim survives. Native `frost::ranged_hits` correctly keeps the same survivor guard.

The Frost repair grants the Plague owner Vitality1 through the genuine existing `cards::grant` producer before the
existing `raise_or_grow`. The +9% max-HP fold and existing zombie stats derive 151.24 max HP, allowing the real hit to
leave a living chilled tuple. This is a trusted native method-level grant fixture, NOT ordinary reward acquisition,
C-INPUT acquisition or captured-source parity. No expected HP, hit, chill, status or outcome is installed directly.
The original fixed directional Bow driver, times and all tuple/restore/continuation/four malformed controls are unchanged.
Aim and wand-only Target semantics are unchanged; the stationary practice/dummy helper paths are unchanged and not rerun.
The failed free-aim diagnostic is summarized in frost-diagnostic.txt; temporary logging is absent from final code.

Commands use final-env.sh, a dedicated target, jobs1, debug0 and incremental0:

- `cargo test -p rh-sim --lib --features trusted-status-probes systems::sentenced::group_source_tests::closed_profile_kernel_source_six_cases_sparse_snapshots_and_complete_mark_pulse_tapes -- --exact`: before failed / after 1 passed (six actual source cases).
- `cargo test -p rh-sim --lib --features trusted-status-probes systems::frost::tests::owned_zombie_frost_tuple_restores_and_refuses_malformed -- --exact`: before failed / after 1 passed (all existing positive and four malformed checks).
- `cargo fmt --all -- --check` and `git diff --check`: passed.

No workspace/source campaign or source recapture was run. The immutable group corpus remains 555087 bytes,
SHA-256 `3808dac248d5fd01286ceb2abe4d2a179a1702e3b8c4bd863a02250654a3d5a3`.
