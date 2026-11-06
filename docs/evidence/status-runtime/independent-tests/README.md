# Independent status review tests

These five new test/capture files supplement the reviewed P-STATUS-1 candidate and its final overlay. They contain no production implementation change.

- `status_privacy_review.rs`: one test replays 14 newly captured source privacy cases through the actual feature-only Harness/Sim, checks public facts, repeated observation neutrality and five ordinary continuation steps; one test accepts a real deleted field reference but rejects a forged future field reference at restore.
- `status_alloc_review.rs`: 24 distinct source/tag keys exceed the initial reservation; all remain present. Warm real FIFO apply/refold/remove cycles allocate zero blocks without truncation.
- The immutable privacy fixture is bound by exact bytes and exact ordered names in the native test. The full source frame and source/runtime hashes remain in the fixture. Expected public output never supplies native setup.
- `status-probes-privacy-observer.ts` is the frozen v1 recorder byte-for-byte plus `export { rig };`; no source game function body changed. The capture script calls actual `perceive` and `canPlayerSee`, with genuine split-map visibility and cloned/untapped ordinary continuation. Raw source field IDs are removed only in the explicitly approved ADR0017 public comparison. Source bot viewport clipping is not introduced as native camera policy.

Apply `required-features.patch` separately to the coordinator's Cargo manifest. It makes an explicit invocation without `trusted-status-probes` fail instead of reporting zero tests. Both missing-feature refusals and feature-enabled tests were executed privately; the shared candidate Cargo manifest was restored unchanged afterward.

Run from an integrated repository:

```
cargo test --offline --locked -p rh-sim --features trusted-status-probes --test status_privacy_review --test status_alloc_review
```

Canonical source reproduction uses cached Docker `c86ecead9e55 --pull=never --platform linux/amd64`, source read-only, executable node_modules tmpfs, and the pinned Linux x64 Node22.23.4 binary. Inside that environment:

```
/node/bin/node --import tsx tools/status-fixtures/privacy-independent.ts
```

The capture writes `/out/privacy-source.json`; compare its bytes with `parity/status/independent-privacy.json`. Dependency: the exact source-v1 recorder/inventory/source packages bound in the main source manifest. Full reproducible Docker argv is preserved in the independent `canonical-privacy-bytecheck.py` and its result JSON. The capture helper is review evidence, not a gameplay input or production CLI.
