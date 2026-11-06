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
CI now runs `bash tools/ability-fixtures/capture.sh --check`; a future CI result is separate from these observed checks.

The coordinator corrected one accepted documentation finding: zero-time cast-hook and due-batch snapshots are
transient assertions, not ordinary checkpoint boundaries. Corpus/harness bytes remain frozen. The packet also preserves
phase-specific target/trail/DoT recipients and void-aware restoration: source clocks can advance while a voided match's
pending casts stay frozen. A separate focused source extension is still needed for that latter restore domain.

The reviewed implementation direction uses one canonical cast owner, source-exact atomic landing, both stock/refund
clocks, private target resolution and the arena collision/history view. Native implementation has started privately.
This source integration does **not** prove native Wishes, card/training/full-NPC-signature prerequisites, genuine native
arena refund, public transport/client support or full P-ABIL-1 completion. The [packet](../../backlog/packets/P-ABIL-1.md)
retains those gates; no deployed build or protocol changed.
