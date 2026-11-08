# CI browser-provenance chain repair — accepted metadata chain, verified

Base `a894574f8f46938cafef7f4103877be58c602905`. Branch `deepseek/ci-browser-provenance-chain`, isolated worktree
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-ci-browser-provenance`. Final head is reported in the coordination
report; this README's commit is the evidence commit. No production TS/native/browser source, expected semantics, protocol,
Unity, Cargo.lock or shared-status change; no merge/push.

## Root cause

The CI rust job failed card-catalog canonical bytes because the canonical `parity/card-catalog/source.json` protected
map still pinned `tools/browser-proof/proof.mjs` at `a49aa61c…` while the reviewed browser-proof fix changed the actual
tool to `6aea6679…`. Root confirmed every other protected pin currently matches. This is the same class of stale
protected-tool metadata as the earlier protocol-js check-vector leaf, not a mechanic change.

## Catalog recapture: exactly one protected leaf

Pinned image `node:22.23.4-bookworm-slim@sha256:aaa4b5ba…` linux/amd64, repo mounted read-only, external output. Recapture
produced the new canonical catalog `2ddb8f85…` (1,045,681 bytes, same size). Recursive old/new comparison found exactly
one differing leaf:

- `/protectedSha256/tools/browser-proof/proof.mjs`: `a49aa61cdb1adeef60031b3e87407233c85f3203b7a6c464c4b5119c8bd1850f` -> `6aea66795ed18edd941a4bc65c62070d6a6e2fce1b57cd98d0238db134fcfd66`

All 409 cases/family counts, 325 protected entries and the three inventory entries are identical; semantic digest
`bbfef8a0aa8bea212c5cca6c865ab4a7fc3448d9688d63b2b7ce590ea1e53a64` is unchanged. Positive catalog `--check` exits 0.

## Runtime and witness accepted chain

New exact metadata (old c14 line -> new): runtime source `80516466…`/53,034,288 -> `9e357ed421c876de39c004236a83563116b390fc9d75043af24047dc952fe049`/53,034,795;
runtime INPUT `84ffcc7f…`/24,239 -> `4dd8dff0f8474e7cc312b1a9588560fe06984e42bb878ee0dd40182bd32a968e`/24,865; witness source
`5df81afe…`/174,278 -> `59fdc1ccabd5b15d2251272cd7a10e41e3b9858203a9a61bd877a10c28917ebe`/174,689; witness INPUT
`b8aab2f8…`/31,787 -> `2e89b83e5aee298d423b320f12d419b9077edae73a3688275be3211ccc8e9249`/32,222; runtime capture tool
`5ca446a1…`/6,927 -> `508e4ed7…`/7,416; witness capture tool `a67e3c15…`/10,614 -> `3faf321d…`/10,994.

The explicit chain records original, prior accepted effective and new effective hashes (catalog: `d50c03e4…` -> prior
`9e76292b…` -> effective `2ddb8f85…`, accepted leaves protocol-js check-vectors and browser-proof proof.mjs; witness:
runtime source/INPUT/tool original -> prior -> effective). The proxies assert only the current effective hash and reject
original/prior/unknown stale files; `FROZEN_PINS.json` remains byte-identical (`7ed10869…`, 15 pins / 11 tools /
`frozenSourceSha256 c2e5d1a0…`) and the original pins remain emitted and inspectable. The existing documentation overlay
for `parity/card-runtime/README.md` is unchanged.

Genuine external runtime recapture: recursive old/new differences are exactly 8 provenance leaves (catalog reference
sha, runtime tool harness sha, accepted overlay chain fields), zero forbidden; semantic digest
`a086c168…` old==new; counts 65 cases / 6,236 ordinary steps / 3,179 private oracle records; `--check` exits 0.
Witness: exactly 24 provenance leaves (witness tool harness sha, three overlay chain entries, three `actualPinnedInputs`
effective/bytes fields), zero forbidden; semantic digest `0ef72417…` old==new; 2 cases / 33 private records; `--check`
exits 0. FROZEN_PINS is untouched. No expected payload, private record, clean control, comparison or source pin changed.

## Fast read-only chain auditor

New `tools/provenance/check-card-chain.mjs` audits without refreshing: catalog source hash and every protectedSha256
entry vs actual files; the fail-closed catalog `sourceSha256` (78 entries) and `harnessSha256` (5 entries) inventories
with required presence, exact count, object/shape validation and per-entry actual hashes (missing/empty/unknown-shaped
inventories cannot silently pass); runtime source/INPUT hashes, immutable catalog reference and explicit
chain; runtime/witness harness/source pins vs actual files; witness original FROZEN byte/content, all 15 original pins
(with only the explicit docs/provenance overlays for README/runtime source/INPUT/runtime tool), and exact overlay paths.
It lists accepted provenance overlays separately from failures, rejects unknown/mismatched overlay paths and stale
original/prior effective values, never writes or rewrites pins, and exits nonzero on any mismatch. Positive run: exit 0,
accepted overlays listed, zero failures.

## Controls

Positive pinned bytechecks: catalog `2ddb8f85…`, runtime `9e357ed4…`, witness `59fdc1cc…` all `--check` exit 0.
Negative semantic output controls (canonical bytes untouched): catalog `/cases/0/id` changed
(sha `279ebd6c…`) -> exit 1 `canonical bytes differ`; runtime `/cases/0/final/label` changed (sha `f52fc78a…`) -> exit 1
`one canonical source runtime recapture`; witness `/cases/0/expected/name` changed (sha `90346039…`) -> exit 1.
Disposable-worktree controls (fresh git worktree at child HEAD `39f7657e`; no in-place mutation of active source):
the unmodified disposable worktree audit exits 0. Changing the protected `tools/browser-proof/proof.mjs` bytes in that
disposable copy (sha `d634dedf…`) makes the auditor exit 1 with exactly `catalog-protected-sha`,
path `tools/browser-proof/proof.mjs` (expected `6aea6679…`, mutated actual) — this is the pre-CI browser mismatch class.
Adding an unknown `tools/unknown/extra.mjs` accepted-overlay entry to the disposable witness source makes it exit 1 with
`witness-overlay-count` and `witness-overlay-unknown-path` (plus the expected witness-source hash failure from the
modified disposable file), proving unknown/mismatched overlay paths are rejected. Catalog inventory controls in the same
child-HEAD disposable worktree: clean audit exit 0; appending a byte to the unprotected source
`packages/shared/src/abilities.ts` (sha `f64fdf81…`) makes it exit 1 with `catalog-source-sha` at that path (and the
runtime/witness sourceInputs failures that legitimately consume the same file); appending to the harness leaf
`tools/card-catalog-fixtures/README.md` (sha `c11024d1…`) makes it exit 1 with exactly `catalog-harness-sha`; deleting
`sourceSha256` fails closed with `catalog-sourceSha256-missing`; replacing `harnessSha256` with `{}` fails closed with
`catalog-harnessSha256-count`. No active source was mutated; the disposable worktree was removed. These tracked logs are
from the child-HEAD re-run; the earlier pre-commit parent worktree run produced the same failure kinds but its logs were
replaced for traceability.

## Evidence, logs and limits

Small raw logs/diffs are explicitly tracked under `logs/` and `diffs/` (listed in `SHA256SUMS`), not broken links; no
large corpora/captures are committed. Complete old bytes, fresh outputs and logs remain in the external
`/tmp/ci-browser-provenance/` workspace. No TS/native/browser/protocol/Unity/Cargo/status edits, no expected semantic
change, no map/full-workspace/Web/cloud/ML campaign. Root owns merge, status, lock and identities; a separate checker
independently reproduces the recaptures, recursive equality, auditor positive/negatives and chain narrowness (result
appended by the final evidence commit).
