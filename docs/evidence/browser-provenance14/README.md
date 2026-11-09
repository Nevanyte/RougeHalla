# Final protocol14 browser-tool provenance candidate

This private review candidate admits exactly two already-reviewed protected tool hashes:
`tools/protocol-js/check-vectors.mjs` `1173a06fa8b2d0017367795f4a07c82bfe87285cbcc300df197aa5ee80aa47b3`,
and `tools/browser-proof/proof.mjs` `9d9a5f64a59ecc048653975f5b60fa9a74e71edffc983037c64aea96ac74d8a7`.
Neither tool is edited here. Base is exact `58f476763128a84b2acb28d2d7e41cb60a1c20e5`, branch
`codex/browser-provenance14`. Source commit is `8d13c297b125fb395e6894cf228424e29b119d04`; the separate evidence commit seals this receipt.
[receipt.json](receipt.json) identifies the source commit and [MANIFEST.json](MANIFEST.json) seals bytes.

## Exact scope and unchanged semantics

The pre-edit [APPROACH.md](APPROACH.md) and [PLAN.json](PLAN.json) show the field map, initial stale-pin
refusal and proposed semantic digests. [metadata-diff.json](metadata-diff.json) records every actual
recursive difference. No blanket allowance for all provenance fields was used.

| Artifact | Exact changed fields | Before = after semantic SHA-256 |
| --- | --- | --- |
| Catalog source | Two protectedSha256 leaves | `a6dea59a42669c8b2aa88a642c17dda7b630de3b51cbd447badc4da5712a80f7` |
| Runtime source / INPUT | 11 / 11 provenance fields | `a086c168baa3e0844a5524662e9fc68675b7335e95248db5ced95bc863878fe7` for source |
| Witness source / INPUT | 22 / 22 provenance fields | `0ef72417008fab778bd68dc05aed90134415eb3411db6406d12b697bc921c9c4` for source |

Catalog409 cases/inventory,78 source and5 harness pins and the other323 protected entries are
field-wise unchanged. Runtime65 cases/6236 ordinary steps/3179 private records, profiles and
noninterference are unchanged. Witness2 cases/6 ordinary steps/33 private records, controlCorrection,
cleanControls, comparison, roles and definition are unchanged. All other fields, including source
inventories and nonlisted provenance metadata, are equal. The semantic field lists and digest method
are recorded, and full recursive equality outside the explicit allowlists is checked independently
of those digests. The offline verifier refuses altered cases and private records.

Only existing acceptedProvenanceOverlay literals change in the two runtime/witness capture tools;
every byte outside those literals remains equal to the base. No engine, case, diagnostic, inspection,
gameplay/configuration/source pin or expected outcome changed. The unchanged producers reproduce
the admitted bytes through `--check`; no capture mode or native-derived expected outcome was used.

The current-only catalog chain is original `d50c03e4…` → accepted `9e76292b…` → accepted `2ddb8f85…`
→ new `e2de5226…`. Immediate prior/effective fields and exactly two current-to-final leaf transitions
are explicit. Historical receipts remain byte-identical and referenced; PLAN preserves the previous
full catalog overlay. The witness's three existing upstream overlay paths retain original hashes,
shift immediate priors to the previously accepted generation and admit only the new effective bytes.
Original [FROZEN_PINS.json](../../../tools/card-runtime-witness-fixtures/FROZEN_PINS.json) stays
SHA-256 `7ed1086915fafd5fa129669270d6d53090f4b81052660a18318df60cab8b3023`, with15 original files/11 tools.
The README documentation overlay is unchanged. No arbitrary new allowed hash or overlay path exists.

## Bounded checks and controls

The three final source reproduction checks pass, in catalog→runtime→witness order, using the existing
scripts and pinned Linuxamd64 Node22.23.4 image
`sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`.
Both repository and expected-output mounts are read-only; npm dependencies are temporary container
data. [reproduction-results.json](reproduction-results.json) records commands, exits and durations.

- [Catalog check](logs/catalog-check.txt):409 cases; exact canonical SHA `e2de5226…`.
- [Runtime check](logs/runtime-check.txt):65 cases,6236 ordinary steps,3179 private records; SHA `f67417ff…`.
- [Witness check](logs/witness-check.txt):2 cases,6 ordinary steps; SHA `744dbf74…`.
- [Final auditor](logs/check-card-chain-positive-final.txt): zero failures; [syntax check](logs/check-card-chain-node-check-final.txt) passes.

The auditor retains required78/5 source/harness inventories, immutable original pins, exact overlay
counts/paths/from/to/prior/effective hashes and unknown/missing refusal. This candidate additionally
makes the325 protected count, both required tool entries, new evidence refs and full prior-lineage
text explicit. All15 isolated negative controls pass; initial and final pristine audits have zero failures. The
[full report](auditor-controls.json), [log](logs/auditor-controls.log) and scope hashes are listed in the receipt.
Controls operate on copied files in a disposable directory, restore each mutation and require a
pristine pass before and after; no active source file is mutated and no extra source campaign runs.

## Retained failed attempts

The [initial old-pin refusal](logs/initial-old-pin-refusal.txt) is intentional and fails exactly the
two stale protected-tool hashes. A separate [Docker launch refusal](logs/catalog-launch-refusal.txt)
occurred because a fresh checkout lacked the empty ignored `node_modules` mountpoint; no producer
started. Creating the empty directory resolved that environment prerequisite.

The first metadata transformation mistakenly compacted the catalog instead of preserving its
two-space serialization. The [catalog byte refusal](logs/catalog-format-refusal.txt), original PLAN-initial-compact.json,
initial compact metadata diff and transform log are retained honestly. The two-field semantic map
was already correct; only this packet's serialization/downstream hashes were corrected. The
intermediate compact auditor positive is labelled as such and is not the final reproduction proof.
There were two actual catalog executions (the formatting failure and final success), one runtime
and one witness execution. The failed container launch is separate. No gameplay/source-pin change,
producer widening or broad rerun followed from the failure.

## Remaining admission

This is a private technical QA draft for coordinator review/merge. It changes no native identity,
content hash, tape, Cargo.lock, shared status, protocol fixture, browser checker/proof behavior,
probe, client, server or workflow. Prior browser receipts remain historical. The current proof
script's new1..11 join/resume expectations were admitted as bytes; no actual browser proof ran here.
Final hosted/browser acceptance, matched clean-build identities and public activation remain held.
No Editor, cloud/deployment, full workspace, World-wide capture or performance campaign was run.
