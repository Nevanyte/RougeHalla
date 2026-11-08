# Card catalog CI provenance repair

Base: `198902f42970bd3d71d431931020819b0e36f008`. The Complete card catalog capture `--check` failure is a stale
protected-input hash, not a change to card behavior. A fresh pinned Linux/amd64 Node 22.23.4 capture, written to a
separate external output directory, differs recursively at exactly one JSON leaf:

`/protectedSha256/tools/protocol-js/check-vectors.mjs`

- Previous pin: `775ab7cf7738c421a9b858850153a2ca1008e3f7f726520d940be20698314f27`
- Current protocol-13 checker: `3c96f5b013d7ee647b4d4b67c762e5db5b38dc8fd7e669c7a4b139c9a0778a90`

The repair retains the same protected inventory; it changes only that hash in the genuinely recaptured corpus. All 409
case inputs and expected results are equal, as are the complete ordered case inventory/family counts, all 78 source
pins and all five harness pins. No untracked or ignored file exists in the enumerated shared-source or catalog-tool
input directories. The output remains 1,045,681 bytes. Corpus SHA256 changes from
`d50c03e471f9d11ff790cac0f31d4ab82b5bb45f1b963b41725d58814cc6f74e` to
`9e76292b7ae74d305da2729a2ceba63965e64aa9fd670ab85568ae7909270507`.

Verification used `tools/card-catalog-fixtures/capture.sh` and its pinned image without tool or source edits:

1. Fresh actual-source capture to `ci-card-catalog/fresh`, outside the canonical directory.
2. Recursive old/new comparison: the one metadata leaf above is the entire difference; all cases/inputs/inventory match.
3. Negative control: a separate fresh-output copy changes only the first case's expected title (one changed text line,
   `/cases/0/expected/title`). Its pinned `--check` fails with `canonical bytes differ`, exit 1. This is an expected-file
   rejection control, not a compiled source-semantic mutant.
4. Refreshed canonical pinned `--check` passes, exit 0, reproducing all 409 cases byte for byte.

The first local Docker invocation failed before running the capture: this new checkout lacked the ignored node_modules
mountpoint needed by the read-only `/repo` + tmpfs mounting layout. Creating that empty ignored directory allowed the
unchanged tool to run. That mount failure is preserved separately and is not the CI canonical-byte failure.

The old corpus, fresh output, complete recursive difference and raw logs remain under the external
`return-cleanup-2026-11-08/ci-card-catalog` workspace. `receipt.json` records their hashes and semantic comparison digest.
No TS production, native mechanic, catalog expectation, content definition, other golden, lockfile or shared status was
changed. The independent stale Observation-version CI guard is outside this repair. No workspace/map campaign ran.
