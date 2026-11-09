# Slow Starter native e618fe2d — independent review

Verdict: **NATIVE COMPONENT RELEASE** for `e618fe2df8324a08be741d1f270b92a9db6135b9`. No blocking defect found in the bounded implementation. This is not final identity/content/tape admission or a claim that all optional-card acquisition and lifecycle paths are executable.

Review was static/source/artifact only: no Cargo/build/test/capture/Editor process was started and no repository file or ref was changed. Executed-result statements below refer to retained author receipts, independently checked against the frozen code and artifacts.

## Exact seal and scope

Reviewed `codex/slow-starter-native29` in `return-cleanup-2026-11-08/wrapup-final-native/repo`. Clean head is e618fe2d; its sole parent is `4813510551dfa12c1cad3cdba975077b8930bc03`, whose parents are exact Root prerequisite `dfca7746dab87407bfd1dec2920322446c5a5598` and released source assessment `fdf4227bdebbe1c119bfd42f4ef9db9bb6497e34`.

All **35** manifest entries match both working bytes and sealed Git blobs. Manifest SHA256 is `216d4be4b4b675002944e204bb93770449889af2ef2e155fde1e1da7da0c8e63`. Source assessment corpus remains byte-identical to fdf, SHA256 `10681ab8a9be45a194e665de7206ac49c2813663412f9590b5df191996d4afdc`; old source fixtures/tools are unchanged.

Native diff is limited to `abilities/checkpoint.rs`, `cards/{fight_clock.rs,fight_clock_tests.rs,mod.rs,runtime.rs}`, `modifiers/mod.rs`, `systems/items.rs`, and the approved one-line predicate in `checkpoint.rs`. Remaining additions are this packet's evidence and compiled-mutant driver. No worker edits to identity headers, content registry/golden, hash coverage, tapes, lockfile, protocol, clients or shared status. Root's inherited dfca identity/constant edits are distinct prerequisites.

## Production correctness

- `cards/fight_clock.rs:6–59` derives watch from actual flattened FightTime rows. `touch` resolves the exact ID only in the real player store: no alive filter, NPC-owner credit, weapon/ability/DoT/amount filter, or fake watched NPC. Memory is lazy and inline. Every landed entry touches by then victim; duplicate touches are idempotent. Equality at 3000ms restarts, while holds requires strict recent gap and the source age threshold. Expired clock retention is intentional.
- `systems/items.rs:32` consumes the completed landed list once at the existing late mods entry. The existing schedule places ledger payment first; `modifiers/mod.rs:327–348` then reads the clock during refold. Source cached-hit behavior at 2950/3000/3050 is preserved, including the already-paid high hit at 7050 before restart/refold. The producer's zero post-share landed rows are not incorrectly filtered a second time.
- `cards/runtime.rs:28–49` preserves fight through generic cardHooks reset while retaining existing Wish/streak/etc reset behavior. Row loss clears only fight and canonicalizes the genuinely empty owner to None, preserving Wish. Grant/refold never rescans the previous landed list. Production rows come from the build; the pre-existing extra-row overlay remains diagnostic-only.
- `abilities/checkpoint.rs:69–117` validates fight independently and scopes every former whole-Runtime Wish restriction to `wish_cast`, including Full-before-start. Existing Off stock refusal and Wish spend/stock/cooldown/refund equations remain. Empty Some, required Option fields and unknown-field refusal are preserved/enforced. No current-time refold installs a replacement cached result.
- `fight_clock.rs:62–88` rejects missing watch, nonfinite/reversed/negative/future clocks. Absolute 50ms grid restriction applies only to Source lifecycle, whose clock already has that domain; Baseline/Off actual fractional clocks remain legal. Watch without clock, stale/dead watched players and retained expired clocks are not forbidden.
- `checkpoint.rs:702` changes only spacing to `next >= previous + TICK_MS`. It follows the actual producer's addition, accepts actual 50.1→100.1 without epsilon, and retains the first-equal/Blaze exception and finite/future/body checks. This is the approved repair, not clock rounding or post-state history replacement.

## Proof adequacy and limits

`fight_clock_tests.rs:73–190,236–430` uses the immutable **seven actual-source cases**. Native setup mirrors declared constructor seeds, profiles, real player grants and player-only bootstrap. Inputs use validate plus budgeted submit; the Training NPC is genuinely born. It installs no expected hit, death, clock, holds, HP, phase or RNG outcome. Every retained ordinary frame compares exact watch/clock/holds, source-tolerance cached damage/HP/positions/landed amounts, actor IDs/counts/statuses, coliseum state and the stated combat/lifecycle event-type/recipient order. Main/reward generator state matches each recorded prefix; all recorded draws are regenerated exactly. This is not an all-payload or whole-transport event comparison.

Recorded canonical checks total **21 distinct passes**: six new focused tests, explicit warm allocation test, five existing Wish repair tests, two Wish Training tests, one mid-fight checkpoint test and six replay tests. Default and trusted-probe lib/test strict lint and fmt receipts pass. Original compile/RNG/fractional/dhat mistakes remain retained as red evidence; they are not counted as passes.

The four actual fractional epochs 0.1, 1/3, 100000.1 and 100000+1/3 restore and continue from real attacks/histories. Separate malformed next-minus-one-ULP, reversed, 25ms-dense and future histories are refused for their intended reasons; existing Blaze/equal-time controls remain. Source/mode checkpoints include no-clock, started/mature/expired/restarted, Off/Full fight-only and genuine Full Wish+fight. Produced-checkpoint continuation uses JSON ReplayInput commands, matching clone/restore events and private hashes with repeated restores. Hash sensitivity changes each clock leaf independently.

All five mutation bytes were independently reconstructed in memory and matched recorded original/mutant SHA256 values. Retained logs show genuine compiled assertion failures for constant-false holds, missing victim touch, incorrect gap equality, retained row-loss clock and generic-reset clock loss; no compilation error substitutes for a kill. Driver restores exact originals in finally blocks; final file pins and canonical rerun bind the restored candidate. These differ from the earlier source-assessment damaged-observation checks.

The explicit allocation receipt measures **180 actual attacking steps**, 60 each original/clone/restore after warming, with zero measured block allocations. Construction/restore/warm work is outside each measured section. This is not latency/FPS or cold-zero-allocation evidence.

## Root integration obligations

1. Compose this frozen leaf with Root's MarkTax/PackLeader work, preserving the one late note_fights call, independent clock ownership and approved history predicate. Do not move touches before paid ledger or reset fight through the cardHooks owner.
2. Complete the private **checkpoint29/replay23** union admission with final content golden, complete canonical hash coverage, predecessor refusal and affected derived native tapes. dfca already registers the separate CARD_FIGHT_GAP_MS=3000 constant; this leaf does not authorize a competing bump or obsolete28/22 tape acceptance.
3. Preserve source corpus bytes and the exact scope of results. Existing replay proof is a produced checkpoint plus recorded command fragment; ordinary SlowStarter acquisition remains unsupported by current interactive card doors. Do not label it full-from-lobby optional-card replay or silently widen those doors.
4. Same-world exported startRaid, Training death/revive and unsupported actor remove/readd remain explicitly static/unrun lifecycle observations. No additional whole-source/workspace campaign is demanded by this finite review. Public deployment, full-port bot/flow acceptance and matched performance remain separate.

No further changes are requested from this packet's author before Root composition.
