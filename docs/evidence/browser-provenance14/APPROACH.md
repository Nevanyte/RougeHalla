# Final two-leaf browser provenance admission: pre-edit map

Recorded before source/tool/corpus changes. Exact base
`58f476763128a84b2acb28d2d7e41cb60a1c20e5`; isolated branch `codex/browser-provenance14`.
The initial unmodified auditor intentionally refuses exactly two stale protected pins; its full
output is [initial-old-pin-refusal.txt](logs/initial-old-pin-refusal.txt). No other audited pin fails.

## Exact proposed file/field map

| File | Permitted fields/changes |
| --- | --- |
| `parity/card-catalog/source.json` | Exactly `/protectedSha256/tools/protocol-js/check-vectors.mjs`: `3c96f5b013d7ee647b4d4b67c762e5db5b38dc8fd7e669c7a4b139c9a0778a90` → `1173a06fa8b2d0017367795f4a07c82bfe87285cbcc300df197aa5ee80aa47b3`; `/protectedSha256/tools/browser-proof/proof.mjs`: `6aea66795ed18edd941a4bc65c62070d6a6e2fce1b57cd98d0238db134fcfd66` → `9d9a5f64a59ecc048653975f5b60fa9a74e71edffc983037c64aea96ac74d8a7` |
| `tools/card-runtime-fixtures/capture.mts` | Existing `acceptedProvenanceOverlay` literal only: retain original/path/rejects; set prior accepted catalog hash to current `2ddb8f85…`, effective to new catalog `e2de5226…`, the two acceptedChanges from/to/evidence to this exact update, and preservedPriorLineage to the complete historical chain/receipts. No producer/execution/input changes |
| `parity/card-runtime/source.json` | `/provenance/harnessInputs/2/sha256` for that capture tool; `/provenance/immutableReferences/0/sha256` for catalog; exactly the above changed overlay fields under `/provenance/acceptedProvenanceOverlay` |
| `parity/card-runtime/INPUT_SHA256.json` | Same metadata at `/harnessInputs/2/sha256`, `/immutableReferences/0/sha256` and `/acceptedProvenanceOverlay` |
| `tools/card-runtime-witness-fixtures/capture.mts` | Existing three `acceptedProvenanceOverlay` entries only: retain paths/originals/scopes; shift prior to current accepted source/INPUT/runtime-tool hashes, effective to resulting exact hashes, evidence to this packet. No change to executable witness/controls/inspection/pins |
| `parity/card-runtime-witness/source.json` | `/provenance/harnessInputs/1/sha256`; for the existing three overlays only `priorAcceptedEffectiveSha256`, `effectiveSha256`, `evidence`; for existing actualPinnedInputs indices1/3/6 only `sha256`, `bytes`, `acceptedProvenanceOverlay/effectiveSha256`, `acceptedProvenanceOverlay/evidence` |
| `parity/card-runtime-witness/INPUT_SHA256.json` | Identical witness metadata paths without `/provenance` prefix |
| `tools/provenance/check-card-chain.mjs` | Corresponding explicit current hash literals, immediate prior literals, and the exact two admitted leaves' from/to constants; keep existing exact-count/presence/unknown-path/missing/negative checks |
| `docs/evidence/browser-provenance14/` | New approach/plan, field-wise diffs, check/control logs, receipt/manifest and any bounded offline verification helpers |

No other file is permitted. Both protected JS tools themselves remain byte-identical to the base.
All original FROZEN_PINS bytes and prior receipts remain untouched. The immediate-prior fields move
forward one admitted generation; original hashes remain fixed and the complete older catalog chain
is retained explicitly with its historical receipts. No permissive set of alternative current hashes
or generic overlay mechanism is introduced.

## Before/after semantics, calculated before edits

[PLAN.json](PLAN.json) records full semantic field lists, current overlays and inventories.
The proposed update touches metadata only, so these planned digests are identical on both sides;
the final field-wise verifier must independently recompute them from the actual edited bytes.
Digests are SHA-256 of `JSON.stringify(Object.fromEntries(fields.map(...)))` in the listed order.

| Corpus | Before and proposed after semantics SHA-256 | Unchanged payload |
| --- | --- | --- |
| Catalog | `a6dea59a42669c8b2aa88a642c17dda7b630de3b51cbd447badc4da5712a80f7` | 409 cases, inventory/environment/baseRevision; all78 source and five harness pins; other323 protected pins |
| Runtime | `a086c168baa3e0844a5524662e9fc68675b7335e95248db5ced95bc863878fe7` | 65 cases,6236 ordinary steps,3179 private records, profiles/roles/noninterference |
| Witness | `0ef72417008fab778bd68dc05aed90134415eb3411db6406d12b697bc921c9c4` | 2 cases,33 private records, controlCorrection/cleanControls/comparison/roles/definition |

Catalog whole-file hash will change from `2ddb8f85114ff6e8e70c2d70b8207ed3f32c71431845f3cce1007be494e39792`
to `e2de5226d31fc7fe4f23d8cd0552ad73be44855bb3109ebed8042b2fd899b9c3`.
Other final metadata/tool hashes follow deterministically in catalog→runtime→witness order.
Every other recursive field, including all provenance fields not listed above, must remain equal.

### Serialization correction after the first catalog check

The original PLAN-initial-compact.json projected catalog hash used compact JSON; the unchanged producer uses
two-space formatting. That check refused bytes before runtime/witness ran. The original failed PLAN-initial-compact.json,
compact transformation/diff and failed check are retained explicitly. Preserving the producer's
original formatting yields catalog SHA-256
`e2de5226d31fc7fe4f23d8cd0552ad73be44855bb3109ebed8042b2fd899b9c3`.
The exact two-field map, all semantic digests and permitted downstream metadata fields are unchanged.
This is a correction to this packet's transformation, not a producer or gameplay/source-pin change.

## Bounded validation

The already accepted producer mechanism supports these literal metadata overlays without changing
gameplay/source pins. After the exact metadata transformation and field-wise check, run each existing
pinned Linuxamd64 Node22.23.4 catalog/runtime/witness `capture.sh --check` once, in that order.
These reproduce source bytes for comparison; no expected gameplay output is recaptured or rewritten.
The image is already present locally. Source mounts and expected-output mounts remain read-only.

Run the read-only auditor on the candidate and a pristine disposable copy, then meaningful isolated
protected-byte, unknown-overlay, source/harness pin, missing-inventory/count and stale-effective
controls. Offline semantic mutation controls must fail the field-wise verifier without another source
campaign. Keep portable tracked logs. No World-wide campaign, native build, Editor, actual browser
proof, cloud/deployment or shared status/identity change. Any need to widen the map is a stop seam.
