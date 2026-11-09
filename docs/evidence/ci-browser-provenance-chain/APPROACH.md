# CI browser-provenance chain — approach (recorded before edits)

Base a894574f8f46938cafef7f4103877be58c602905. Fresh isolated worktree
/Users/nevinmckinnon/Documents/Projects/RogueHalla-ci-browser-provenance, branch deepseek/ci-browser-provenance-chain.
The owner-combat source worker is a separate worktree and is not touched.

Root cause: the card-catalog canonical corpus is pinned at 9e76292b...; a reviewed browser-proof fix changed
tools/browser-proof/proof.mjs from a49aa61c... to 6aea6679..., so the canonical catalog's protectedSha256 map is stale.
The CI rust job fails catalog canonical bytes even though all other protected pins match.

Plan: genuine pinned catalog recapture to an external directory; prove the sole recursive difference is
/protectedSha256/tools/browser-proof/proof.mjs and that all 409 cases/source/harness/inventory leaves are identical;
refresh canonical catalog metadata. Then update the explicit runtime and witness accepted-provenance chain to the new
catalog/tool/corpus hashes (recording original, prior accepted effective and new effective values; guards accept only
the current effective and reject unknown/stale paths), genuinely recapture runtime and witness externally, and prove
their old/new differences are provenance-only with identical cases/private records/clean controls/comparison.
FROZEN_PINS.json stays byte-identical and original pins remain inspectable. Add a fast read-only
tools/provenance/check-card-chain.mjs that audits catalog source/protected hashes, runtime references/harness/overlay,
and witness overlays/original FROZEN pins; it lists accepted overlays separately, rejects unknown or mismatched overlay
paths and never refreshes data. Run positive bytechecks/auditor, negative semantic-output controls and (after commit)
disposable-worktree controls for changed protected hash and unknown overlay path. Preserve prior c14 lineage/evidence;
no TS/native/browser source edits, no expected semantic changes, no broad map/workspace/Unity/cloud/ML campaigns.
Root owns merges/identities.
