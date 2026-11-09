# C52 CI step21: NPC documentation-provenance drift

**Concrete static cause found: changed CONTRACTS.md provenance hash.** Failed run42688104027/job129400631974 is not green. No World/capture/check/reproduction, Node/container/build/test, source edit or cache action occurred in this review. Full failing CI/raw oracles remain unchanged.

Compared immutable failed source `c52e41a633c91f8402e3f68724e9202351d1cdb3` and current main `5e19ef1b801ef363a83217ddecd768c5aba71cac` with both original JSON fixtures. Results are identical at both cuts:

| Fixture | Exact matching pin groups | Only changed pin |
|---|---|---|
| npc-continuity |333source +9config +6tool|profile.contractInputs[docs/CONTRACTS.md]|
| npc-runner-callsite |333source +9config +8support +5tool|profile.contractInputs[docs/CONTRACTS.md]|

Original continuity oracle:13952630B SHA256 `15c3dbc1f5d718859413e8dbb9891602dd49870f10dae4f12dc3152e2c57de96`; original runner oracle:30636484B SHA256 `0c9344109283d2cf848c83892924071e9277f163d79e69e3c634c3d19c7f4a58`. Keep both immutable.

Recorded CONTRACTS hash: `2c9e0b9b562752ec907fe8ffa0e67986e6f6005a11c744f657fd67863de6e7cd` (actual197926 blob). C52/current CONTRACTS hash: `456652ccc0b8441f39464513fdf31843b9882e0bcece44958e7d620a987d359a`. REQUIREMENTS remains matching SHA256 `45f4a590c36bae776ed213297b2468cdbda0edc788946c670c04335923fb51c4`.

The exact doc diff adds six lines before the old native28 paragraph: native29 admission/status and proof descriptions, private socket/Training/resume/CI scope notes, and a label identifying the following paragraph as prior composition. No previous contract-rule sentence changes. These status/provenance bytes are not passed to World/Frame/Memory inputs. capture.mts reads their hashes only when building the final profile metadata, after actual history/consumers execute.

## Actual failing assertion and next gate

Continuity capture.mts93 asserts the **entire serialized JSON string**, including live docs hashes. CI raw excerpt shows that assertion and truncated actual/expected strings, after the preceding source checks succeeded. Changed doc hash guarantees the entire-string assertion cannot pass. **Static inventory does not prove that it is the only fresh output difference**; no full new actual output has yet been retained/compared.

Runner has the same outer live doc hash. More importantly, source-history.mts104–105 regenerates the unchanged continuity capture into a private temp file;132–133 then require its complete hash/bytes equal the original continuity fixture **before** actual runner profiles proceed. That nested check will also reject this doc drift, even if only the outer runner comparator is repaired. Runner was not reached after continuity's shell failure; do not invent a runner execution result.

Adding files inside either original tool directory changes its recursively collected tool pins. Do not edit/add there, refresh the old14MB oracle, ignore arbitrary profile metadata or replace any gameplay/code/config pin.

## One proposed initial reproduction, requiring Root release

Use a new **external** tools/evidence namespace and exact frozen c52 source/container Node22.23.4/linux/amd64 digest already used by CI. Run the unchanged continuity capture once with `--write` to a NEW external raw-output file under ordinary **current** documentation bytes. Preserve full stdout/stderr, exit and raw JSON bytes/hash **before validation**. No change to original fixture or capture scripts; no assertion bypass or rerun-as-pass.

External checker must first prove all333source/9config/6tool pins, old oracle bytes, exact historical/current doc blobs and exact six-line document diff, then permit only the reviewed old→current CONTRACTS hash at the one named profile.contractInputs key. Validate both JSON paths and alter only that known64-byte value for comparison (or compare the two fixed byte spans around it); every other byte/order/number/tag must match original. No rounding, record dropping, ID normalization or global JSON reformat. REQUIREMENTS stays exact. If anything else differs or a precondition fails, retain FAIL and stop. This is a reviewed metadata overlay, not a new gameplay oracle or automatic future-doc exemption.

This one reproduction would settle whether current continuity output differs **only** in declared historical documentation provenance. It does not itself repair/admit the runner check or grant a new source campaign.

## Small source-preserving CI repair proposal

After that result, Root can review an external, exact provenance-overlay wrapper for these two original witnesses. Minimal way to preserve runner's nested exact guard without modifying its hashed tools: execute unchanged captures in a readonly source namespace with **only CONTRACTS.md mounted from the exact historical197926 blob**. Separately preflight and record the exact actual current CONTRACTS bytes/hash and explicit reviewed overlay in the new wrapper's receipt. All actual gameplay/config/tool code remains the current byte-identical pins. First retain fresh raw continuity/runner output in external owned files, then compare every output byte against the original fixtures; runner's original nested comparator remains intact.

This must be named honestly: **current identical source pins replayed at pinned historical documentation-provenance context**, not current-doc-byte-exact capture. It does not apply historical normative rules to gameplay; docs are metadata-only here. Both current and historical doc hashes remain enforced, with no permissive fallback. A future doc change requires a new explicit review/overlay; it cannot silently pass. New CI wrapper/receipt must pin its own source separately and remain outside both recursively walked original tool directories. No root/shared doc edit or old oracle rewrite is needed.

If Root instead requires actual current-doc metadata throughout the runner, it needs a separately reviewed external source-history adapter that validates this same narrow metadata overlay at the **inner** regenerated-continuity comparison, plus explicit new wrapper provenance. Merely adjusting the outer runner check is insufficient; silently claiming its original byteExact:true would be false. Do not choose that larger adapter without Root's source review.

No checker/wrapper has been written and no reproduction run. Root owns the single reproduction release and final CI repair/integration decision. The historical first red and all original14MB/30MB data/code pins remain preserved.
