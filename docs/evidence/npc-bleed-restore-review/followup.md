# Earned regional NPC bleed restore — bounded follow-up review

2026-11-10. **RELEASE for the three prior HOLD groups at the inspected WIP cut**, base `1163f18ec2a31c97d8b62b9855b887654eabb106`. This is a read-only code/receipt review. No probes or tests were run, no Rust was authored, and private World/checkpoint/state/hash comparisons were not copied into Git. This releases the reviewed bounded change for Root's seal/admission decision; it is not itself a Root seal or Card numeric/privacy admission.

## Cut identity

The inspected checkout was `/Users/nevinmckinnon/.codex/tools/roguehalla-backend-20261109/card-bleed-design-probe/repo`, HEAD `1163f18ec2a31c97d8b62b9855b887654eabb106`, with the intended two code paths modified/new and the new evidence README. The exact code SHA256 values at review start and end match:

- `crates/rh-sim/src/systems/mob_checkpoint.rs`: `10262155531cc4621e07c19307dcaa152d91557d58e902ac4bd8ad70d5a31002`
- `crates/rh-sim/src/systems/mob_checkpoint/bleed_tests.rs`: `ffd5502dde18bb2b8bd82b68cf8f40d938a0e8e25105b52fcc53d8e1921393ff`

These match `target/npc-bleed-restore-private/code-sha256-v2.txt` and the private command receipt. No file movement occurred during review.

## Prior HOLD groups

1. **Clock domain:** the predicate no longer requires `started_at == tag_tick * TICK_MS`. The accepted Lifecycle-Off reader validates its generic clock range/tick maximum without that relation. Both retained-clock tests start from the ordinary constructor, declare an offset/fractional or large `server_time`, serialize and successfully restore that baseline before real Attack input, and then exercise the produced bleed plus Release and accepted post-hit restore. The fractional test explicitly proves the produced `started_at` differs from tag-tick time. Generic validation remains unchanged.
2. **Duration operation:** the helper compares `until == started_at + ms`, matching the producer's forward binary64 addition, rather than reverse subtraction or an epsilon. The regression asserts the real row's producer result; the accepted large-clock case exercises the forward addition at a large finite clock. No tolerance or new range cap was added.
3. **Card witness gate:** the final scoped receipt includes the unchanged `card_witness_tests::the_witness_cases_reproduce_the_source_landed_amounts` (1 passed), `kill_augments::tests` corpus consumer (6 passed), and `cards::on_hit` producer source-shape tests (6 passed). The source README is careful that no dedicated native replay consumes the named 93-step `onhit-bleed-physical` source case; this is not presented as such a replay. It also includes the separate real native regional-NPC Attack/Release probe lineage, now reproduced through checkpoint restoration.

## Predicate, producer path, and receipts

The helper narrowly admits the producer-derived no-ability Dot shape: canonical `bleed:<tick>` with a positive tick no later than `world.tick`; exact Hemorrhage row duration using the producer addition; finite nonnegative persisted value without a magnitude cap; physical-only shares and default remaining payload; retained typed player source, roster-label match, and no owner. Generic validation and known-actor history still run. It does not require the source to remain present, alive, or to retain Hemorrhage.

The promoted regression reaches Hemorrhage through the normal card grant and validated/budgeted Attack/Release path against a surviving regional NPC. The checkpoint reader accepts the earned state; original, Clone and restored Sims continue for 60 ordinary steps with event/state-hash equality and periodic complete checkpoint equality. A departure case verifies the legitimate retained roster/known-actor source after ordinary `remove_player`. Controls cover malformed producer shape, no-card acceptance, finite `1e300` acceptance, and unchanged generic rejection paths. The private raw comparison material remains ignored and was not copied.

The retained author receipt reports five new tests passed; unchanged Blaze (1), generic status checkpoint (6), PvE restore (1), checkpoint unit suite (31), Card corpus (6), Card witness (1), and Card on-hit tests (6) passed; default/all-feature strict Clippy and fmt passed. These are the recorded author runs in `target/npc-bleed-restore-private/final-scoped-tests-v2.log`, `clippy-default-v2.log`, `clippy-all-features-v2.log`, and `commands.log`; I did not independently rerun them.

## Scope limits

This is a checkpoint-reader acceptance expansion for an already-produced valid NPC bleed only. It does not change the stored shape, arithmetic, step order, hashes, version/content identity, public visibility, or numeric closure. It does not prove full Card runtime parity, full 93-step physical case replay, all NPC statuses, public privacy, or any broader restore/lifecycle behavior. The source-corpus Docker recapture and full workspace suite were not run and are not required by the bounded packet.

Reviewed references: the private [candidate evidence README](/Users/nevinmckinnon/.codex/tools/roguehalla-backend-20261109/card-bleed-design-probe/repo/docs/evidence/npc-bleed-restore/README.md) and the prior [independent pre-review HOLD](/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-gameplay-quests/docs/evidence/npc-bleed-restore-review/README.md).

## Root final delta and isolated admission

Root sealed the completed worker as `0be00f95b4c9879dd7ee2ec57e6bbd70931117d9` and integrated it as `dedb8658`.
The production predicate SHA remains `10262155531cc4621e07c19307dcaa152d91557d58e902ac4bd8ad70d5a31002`.
The final test SHA is `125af1504c9e2736e861d93e0078477e2bc49c8e0e2707e3f44cce3e913921a1`: the delta from the
reviewed cut adds a focused forward-addition/reverse-subtraction binary64 example and explanatory comments, without
production changes. Root read that delta and accepts its explicitly bounded claim: it constructs a predicate input,
not an installed status/checkpoint trajectory. The separate actual accepted-clock producer trajectories remain the
runtime evidence. This releases the narrow repair for integration; it does not admit Card B3/report/privacy work.
