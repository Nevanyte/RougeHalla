# Wish source integration

The independently accepted [source corpus](../../../parity/abilities/README.md) freezes all five real legacy Wishes:
Freeze, Swarm, Trial, Fire's Blaze Step and Last Stand. It adds63 cases,6,318 ordinary50ms steps and1,237 full frames.
The source worker completed a fresh pinned Linux amd64 Node22.23.4 capture and one exact comparison; the reviewer
verified all ten proposal files,132 unchanged source inputs, seven harness inputs and patch applicability without
repeating that campaign. Existing terrain and arena corpora remain unchanged.

The frozen corpus SHA256 is `8629c08fa42ac9fb15b21c52416658997c7d8969a6962cf59b71cebedd571330`.
The proposal manifest SHA256 is `439a6829ca7db1f7c6449151326f80ad5143771f61cdb42144acfb172388d036`;
the accepted review SHA256 is `8056a5fe2814a75b1eb1928c6f93b65740df18ccc082aba5caf592ef84e0db33`.
[Coordinator integrity checks](integration.json) retain the actual integrated file digests and the sole README overlay.
CI now runs `bash tools/ability-fixtures/capture.sh --check`.
[Run42222451955](https://github.com/Nevanyte/RougeHalla/actions/runs/42222451955) is in progress at `d3418f17`;
its eventual result is separate from the observed checks above.

The coordinator corrected one accepted documentation finding: zero-time cast-hook and due-batch snapshots are
transient assertions, not ordinary checkpoint boundaries. Corpus/harness bytes remain frozen. The packet also preserves
phase-specific target/trail/DoT recipients and void-aware restoration: source clocks can advance while a voided match's
pending casts stay frozen. The separately accepted [two-case source companion](../../../parity/ability-void/README.md)
now covers unrelated-player and target abandonment with24 ordinary steps. Its corpus SHA256 is
`cb8bec8f8a8e1e72db22ff86c6f6e4eecb9cf449a1a5e0636c1c4939b7f7eef5`; independent review SHA256 is
`cea90e53a44918ad57e8df681e9402c9f47e4cf26118db437b44f8830a66e5d5`.
[Companion integrity checks](void-integration.json) record exact integrated/provenance digests. Native restore remains
an implementation gate. The original63-case corpus and all seven original harness inputs are unchanged.

The reviewed implementation direction uses one canonical cast owner, source-exact atomic landing, both stock/refund
clocks, private target resolution and the arena collision/history view. Native implementation has started privately.
This source integration does **not** prove native Wishes, card/training/full-NPC-signature prerequisites, genuine native
arena refund, public transport/client support or full P-ABIL-1 completion. The [packet](../../backlog/packets/P-ABIL-1.md)
retains those gates; no deployed build or protocol changed.
