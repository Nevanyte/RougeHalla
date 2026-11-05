# Bounded Plague source proofs

These programs import the original TypeScript modules. They do not patch `packages/`, replace damage arithmetic, or install the auxiliary faction producers. Use Node 22.23.4 from the repository's established capture environment:

```sh
node --import tsx tools/plague-fixtures/hidden-history.ts parity/plague/hidden-history.json
node --import tsx tools/plague-fixtures/ledger-matrix.ts parity/plague/ledger-matrix.json
node --import tsx parity/legacy-capture/capture.ts --only plague_thresholds_swap
node --import tsx parity/legacy-capture/capture.ts --only plague_wand_pause
node --import tsx parity/legacy-capture/capture.ts --only plague_multisource_lethal
node --import tsx parity/legacy-capture/capture.ts --only plague_departure_early_end
```

`hidden-history.ts` reproduces the temporal privacy counterexample using the same original vision module singleton as ordinary targeting. All three actors bootstrap at the remote point (320,320) before trusted scenario placement. The viewer moves from tick 2; the two hidden attacks begin on ticks 3 and 6. The observer reads the retained memory OR current circular sight; it never calls the refreshing getter after placement. The bootstrap getter and every later probe assert that every expiry cell and private update timestamp remain unchanged. The fixture records complete setup, bootstrap positions, per-tick positions/visibility/HP/bits/landed rows and private chunks. Both private totals differ as recorded in ADR 0013; eligible visible contributions are identical. `rh-sim/tests/plague.rs` reproduces these exact binary64 values through actual simulation commands and verifies equal anonymous projected output.

`ledger-matrix.ts` calls the real `recordHit`, `applyLedger`, and the actual installed faction after-damage function. It records twelve cases: shared disease/execute budget, mixed hit/DoT, two sources, entry permutation, partial/full barriers, immunity, player overkill, source departure, disabled PvP, zero/scaled entries, and distinct victims. Captured hooks are observational taps chained after the real hooks. The Rust unit comparison checks every landed row, player HP/barrier/status, and private bucket exactly (JSON integer spelling is normalized to binary64). Hook taps additionally prove the partial-barrier pre/post split; hook payloads are trusted diagnostic evidence, not a new public event API.

The four gameplay fixtures use the explicit installer list and `player-engagement-holy-plague/1` provenance. Every raw entry (including private execute qualification), post-barrier landed row, engagement state, pause, bit, private bucket, and flush clock is compared. The old 72 files and full Fire/Plague capture-only classifications are unchanged. Unknown or missing diagnostics and changed installer provenance fail comparison. Every one of the 449 new gameplay ticks has a checkpoint continuation test.

The public correction is deliberately different from legacy chunk filtering: contribution eligibility is frozen at its completed tick; hidden sources merge anonymously before keys, order, first-weapon selection, and exact sum rounding. Raw totals retain source order and source arithmetic. This does not claim arbitrary legacy-session or private FX tape migration.

Protocol 5 omits the new signature-qualified effect and signature-state bits. It never converts Disease to an ordinary Hit. OBS8/policy5 expose the typed fields; CP11/replay9 preserve private faction mode, clocks, pause and buckets. The new mode remains default Off, and the live server keeps it Off until the later protocol/product slice is implemented and verified.
