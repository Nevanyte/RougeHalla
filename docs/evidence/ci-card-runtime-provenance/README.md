# CI card-runtime provenance reconciliation — accepted metadata overlay, verified

Base: `df0d7bb82bd681747d94a985df6cf5083a8e577f`. Branch: `deepseek/ci-card-runtime-provenance` in
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-ci-card-provenance` (isolated; the human-eligibility source worker's
worktree is separate and untouched). Final branch head is reported in the coordination report; the commit containing
this README is the evidence commit.

**Status: mechanical provenance reconciliation complete.** No gameplay, TypeScript production, native, protocol,
browser, cloud/ML or shared-status/lock change. Expected data was not refreshed or relaxed; no expected
gameplay/poststate/private tuples were installed. The catalog change this absorbs is the already-reviewed protected
metadata leaf `/protectedSha256/tools/protocol-js/check-vectors.mjs` in
`docs/evidence/ci-card-catalog-protocol13/{README.md,receipt.json}` (catalog corpus `d50c03e4…` -> `9e76292b…`).

See `APPROACH.md` (recorded before edits).

## CI failure and root cause

`tools/card-runtime-fixtures/capture.mts` pinned `parity/card-catalog/source.json` at
`d50c03e471f9d11ff790cac0f31d4ab82b5bb45f1b963b41725d58814cc6f74e`; the admitted catalog corpus is
`9e76292b7ae74d305da2729a2ceba63965e64aa9fd670ab85568ae7909270507` (1,045,681 bytes). A pristine worktree at the base
reproduces the CI failure exactly: exit 1, `AssertionError: parity/card-catalog/source.json immutable reference`
(`logs/pristine-ci-failure.log`). No TypeScript mechanic differed.

## Changed files (only these six, plus this evidence directory)

| file | old sha256 | new sha256 | bytes old -> new |
|---|---|---|---|
| `tools/card-runtime-fixtures/capture.mts` | `24df22055a3c77b75e01b478d04a477a57690d7f71220916d0816551102fff9e` | `5ca446a1934846ffa14e561a10b06230b55a73f924d7853c5c9ecec79b13857d` | 6,091 -> 6,927 |
| `tools/card-runtime-witness-fixtures/capture.mts` | `09796001fc5033499ff481402db5b1e3a5ff1b7b1d2fccc13e46f6efbcc576a2` | `a67e3c151af164e7a1dd44ae6162bd998f67fbcc265a36c461e21a08bd391d24` | 8,516 -> 10,614 |
| `parity/card-runtime/source.json` | `c2e5d1a071f3f7a05a6c3e8bf46fbdba8f0c7ae47d4de1aea8e62a1726ecd019` | `80516466ca231b88d16cd0d187f90260f141042ba59b37322b99016ebcae33e1` | 53,033,468 -> 53,034,288 |
| `parity/card-runtime/INPUT_SHA256.json` | `2ea71ac15addc60e406aebbb7defedf8492c135d0a787a15808b69e4bc34d39a` | `84ffcc7ff49536cc0d1d542a25f42994b68c049f28877d9375da08aa73186e79` | 23,376 -> 24,239 |
| `parity/card-runtime-witness/source.json` | `c6ca8218b6958c41a3a17908066c007984646d94ec01f904f4f79a22721fc111` | `5df81afe05fa6bd22711ff9dfa80bff68a06a5d1824577c823380f332597c197` | 171,853 -> 174,278 |
| `parity/card-runtime-witness/INPUT_SHA256.json` | `36abc9240ed5cc863ef4c87520ae92b25ad84a90623ad199cc4fa6b98daed68f` | `b8aab2f85670e9f45049640abb3090f839d7033a6de0708ad2e7a496328b8c98` | 29,046 -> 31,787 |

`tools/card-runtime-witness-fixtures/FROZEN_PINS.json` is **byte-identical** (`7ed1086915fafd5fa129669270d6d53090f4b81052660a18318df60cab8b3023`;
`frozenSourceSha256` `c2e5d1a0…`, base revision `64052f09…`, all 15 files / 11 tool pins original). The 65 original
witness cases/source and 11 tool pins remain sealed and inspectable; nothing was weakened, removed or blindly re-pinned.

## Accepted-provenance overlay (narrow, fail-closed)

- Runtime tool: records the original catalog hash (`d50c03e4…`), the effective admitted hash (`9e76292b…`), the exact
  accepted change (the protected checker leaf above; all 409 catalog cases/inputs/outcomes/inventory and 78 source + 5
  harness pins identical) and the evidence path. It asserts the effective hash and rejects any other catalog hash.
- Witness tool: keeps the existing documentation overlay and adds three explicit accepted-provenance entries — runtime
  `source.json` (`c2e5d1a0…` -> `80516466…`), runtime `INPUT_SHA256.json` (`2ea71ac1…` -> `84ffcc7f…`) and the pinned
  runtime capture tool (`24df2205…` -> `5ca446a1…`). Only original/effective pairs are accepted for those paths; every
  other FROZEN pin remains strictly immutable; `actualPinnedInputs` records frozen original, actual and overlay status.
  The original pins remain in the untouched FROZEN_PINS.json and are emitted as `frozen65:pins` unchanged.

## Genuine pinned recapture and exact recursive equality

Both corpora were genuinely recaptured from the unmodified source in the official pinned image
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292` (`--platform
linux/amd64`, repo read-only, external output mounts), not hand-edited. A fresh checkout needs the empty ignored
`node_modules` mountpoint required by the read-only/tmpfs layout (documented in the catalog repair too); the first local
Docker attempt failed at that mount, then the unchanged workflow ran.

Recursive old/fresh comparison (`diffs/*.json`, `diffs/*.out`) found **only** accepted provenance leaves:

| comparison | differences | forbidden | semantic digest |
|---|---:|---:|---|
| runtime `source.json` | 4 | 0 | old = new `a086c168baa3e0844a5524662e9fc68675b7335e95248db5ced95bc863878fe7` |
| runtime `INPUT_SHA256.json` | 4 | 0 | old = new `f915322254bf26c2e46a8f5783de73d70bbf08830b535b61ee9b3932c818860e` |
| witness `source.json` | 14 | 0 | old = new `0ef72417008fab778bd68dc05aed90134415eb3411db6406d12b697bc921c9c4` |
| witness `INPUT_SHA256.json` | 14 | 0 | old = new `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a` |

Runtime allowed leaves: `acceptedProvenanceOverlay` added; catalog reference `sha256`/`scope`; this runtime capture
tool's `harnessInputs` hash (and the same four in the runtime input inventory). Witness allowed leaves:
`acceptedProvenanceOverlay` added; witness capture tool `harnessInputs` hash; for `actualPinnedInputs[1]`/`[3]`/`[6]`
(runtime INPUT, runtime source, pinned runtime tool) exactly `sha256`, `bytes`, `acceptedProvenanceOverlayApplied`,
`acceptedProvenanceOverlay`; and the same set in the witness input inventory. No case input/expected output, private
oracle record, noninterference/clean control, profile, role or comparison leaf changed.

Semantic counts (old = new): runtime 65 cases, 6,236 ordinary steps, 3,179 private oracle records; witness 2 cases, 33
private oracle records. The runtime capture log reports the same 65/6236/3179 with the new sha.

## Positive checks

- Runtime: `bash tools/card-runtime-fixtures/capture.sh --check` exit 0 (`logs/runtime-check-pass.log`), sha
  `80516466…`, 53,034,288 bytes.
- Witness: `bash tools/card-runtime-witness-fixtures/capture.sh --check` exit 0 (`logs/witness-check-pass.log`), sha
  `5df81afe…`, 174,278 bytes, 2 cases/6 ordinary steps, extraDamage/sourceRatio unchanged (2.891037366083104 / 1.08).
- Both recaptures were written to external fresh dirs first and compared before the canonical metadata update.

## Negative controls (semantic rejection, canonical untouched)

- Runtime: fresh output copy with one non-provenance expected leaf changed (`/cases/0/final/label`
  `final` -> `final [negative-control]`, sha `fece907526118721e28fe318a85cb62d2d40e5010a1a3fc687f1953a7edca84d`) is
  rejected by the pinned `--check`: exit 1, `AssertionError: one canonical source runtime recapture`.
- Witness: fresh output copy with `/cases/0/expected/name` changed (sha
  `378839e2028bc126aff45287797c6b09a3c0c488b3fc567b9ac19a0d37504d7b`) is rejected by the pinned `--check`: exit 1.
- Canonical runtime/witness bytes remained the accepted hashes above; no expected data was refreshed.

## Preserved artifacts

External workspace `/tmp/ci-card-runtime-provenance/` preserves the complete old bytes (`old/`, `old/SHA256SUMS`), both
fresh output directories, all raw logs, and the recursive diff JSON/digests. This evidence directory carries the same
logs/diffs, the old checksum manifest, and the small analysis/negative-control scripts. Nothing old was overwritten in
place; the canonical update copied only verified fresh bytes.

## Limits

No native, TypeScript production, protocol, browser, map, full-workspace or unchanged-Web campaign ran; no cloud/ML,
account/access-mode, shared status or Cargo.lock edit. No expected gameplay/poststate/private tuple was installed and no
comparison was relaxed. Compile/setup errors were treated as failures. Root owns main merge, status, lock and final
identity; a separate checker independently reproduces the two pinned bytechecks, recursive equality, overlay narrowness
and the negative controls (result appended by the final evidence commit).

