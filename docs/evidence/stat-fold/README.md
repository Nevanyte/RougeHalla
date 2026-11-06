# Stat-fold kernel evidence

## Scope and provenance

The reviewed producer commit is `f14a89e87b4541c31076496935585d69c66ecddf`, based on `8e9e9e54a98145f80baa4cd15613f1afd6554b96`. The unchanged TypeScript reference is `de6f1c196f9b6a42e50dfdf19327d72bd3683fc8`. The independent repair overlay is bound separately by its frozen manifest and retains the original commit and failure artifacts.

The kernel is pure and unwired. This review does not establish cards/status runtime, condition evaluation, reward RNG, combat, networking, full gameplay or performance. Existing parity was rerun; the full workspace and map suite were not repeated in this bounded independent review.

## Independent findings and repairs

1. JavaScript treats a NaN max-HP chest gain as falsy. The original Rust branch treated it as true, changing source positive infinity to NaN. The repair excludes NaN from that branch; 240 freshly captured source boundary cases retain the exact reproducer.
2. Parsing nested inputs/expected outputs through `serde_json::Value` discarded duplicate object keys. A recursive reader now rejects duplicates before constructing typed cases. Source provenance requires the exact capture or runner filename set and the exact canonical runtime, with malformed/empty/renamed/missing controls in Rust and Node.
3. The original runner limited soak to 10,000 despite the packet's 100,000 requirement. The unsupported authorization claim is withdrawn. The complete 100,000-case inventory is restored with the original bounded batch, worker and deadline semantics.
4. The original output-corruption tests check the comparator; they do not mutate implementation. An actual additive-product implementation survived the original 463 cases because the designated factors coincidentally gave the same sum and product. Twelve new actual-source product witnesses distinguish these implementations. All ten compiled implementation mutants now fail semantically; no compile failure is credited.

5. Custom external failures now emit structured replay argv and the exact input-file environment. The generated runner converts replay back to its preset command only after matching ID and seed against its actual validated batch. Both failure paths were exercised with compiled arithmetic mutants, and executing each emitted replay produced the same complete failure; paths containing quotes and dollar signs were passed without shell interpolation.

## Verified results

- Original canonical corpus: 463 cases, 207 coverage entries, including 164 actual-card projections. Original bytes remain preserved. The repaired canonical artifact changes only the recorded `schema.ts` hash; all case inputs, expected outputs and coverage are identical. Official read-only `--check` passes against that proposed metadata artifact on Linux x64 Node22.23.4.
- Independent fresh fixtures: 240 boost/non-finite boundaries and 12 product witnesses, captured and repeated byte-for-byte on Linux x64 Node22.23.4. Complete outputs are compared; source answers are never native inputs.
- Canonical CI: 4096 cases, 32 batches, one native worker, 7.727 seconds including isolated source setup.
- Canonical soak: 100000 cases, 782 batches, at most two native workers and two pending source batches, 20.061 seconds including isolated source setup. Independent normalized `{kind,input}` identity confirms all 100000 inputs are distinct, excluding names, seeds, labels and expected values. Input-sequence SHA-256: `03274b4cf513c1e2079a12ddc7ad2f0476befc066d9021ee8948501e9a1cfd21`.
- Host Node25.8.1 macOS arm64 diagnostics: 4096 CI cases in 535 ms and 100000 soak cases in 5704 ms; these are diagnostic, not canonical source-runtime claims or benchmarks.
- Rust: 18 kernel tests and 15 fixture tests pass in default and all-feature modes. Eight Node runner tests pass. Formatting and strict default/all-feature all-target Clippy pass.
- Existing parity: 97 compared scenarios and 300 pathfinding queries MATCH; 13 scenarios remain capture-only.
- Actual implementation mutants killed: product addition, conversion chaining, cap after `asPost`, farm inside defense ceiling, per-pick boost compounding, missing ownership accepted, inverted while answers, ties-to-even encoding, narrow integer encoding, and NaN gain truthiness.

All finite canonical outputs, signed zero, infinities, branch/cap outcomes, identities, flags and mirrors compare exactly. NaNs compare by classification, not payload/sign. Host continuous diagnostic tolerance never relaxes discrete or mirror outcomes.

## Reproduction and coordinator boundary

Use the commands in `tools/stat-fold/README.md`. The independent handoff records full commands, toolchains, source hashes, batch hashes, original first failure, mutation logs and file hashes. The private evidence root is `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/stat-fold-independent-review`.

Apply the repair overlay and separately reviewed canonical metadata refresh after the producer commit. The coordinator owns content registration and the resulting golden identity. The leaf exposes `default_definition()` and `visit_content(&definition, word)`; the visitor has exhaustive 33-word perturbation coverage. The coordinator's separate seam folds this actual definition and actual runtime enum/index/category mappings. No live state, protocol, balance table or gameplay wiring is changed by this overlay.
