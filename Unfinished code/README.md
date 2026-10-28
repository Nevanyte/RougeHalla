# Saved work and deferred items

## Current work (2026-10-28)

The redesign is implemented and was released in `6f06d9d`. The balance follow-up on `codex/sentenced-balance` starts from that latest main, including the combat controls/readability upgrade; the unrelated Kimi checkout is not used.

Camp-wide marks retain reduced per-member pulse damage, tier/status nameplates, Sentence stacks and the Trial ring. The follow-up resolves both initial primary matchup misses: all four exact favourite shares are now 61.81–75.00%, with 17.22–32.28% median winner health. Every faction keeps its two intended wins and two losses across the six-weapon counter checks. Starter duel median is 25.7 s (within the existing 26 s tolerance), falling to 6.1 s at minute five.

Regression coverage totals 9,371 tests. Client/shared full suites pass; server’s six stale lifesteal expectations were corrected and their complete two-file rerun passes 94/94, with the other 5,500 server tests passing the full run. Typecheck, build, camp gates, unchanged identity/robustness gates, and exact 70-cell Python/TypeScript parity pass. The owner authorized merge and live deployment; final commit and deployment verification are in the task chat.

There is no unfinished Sentenced implementation here. Secondary weapon-health margins and the latest controls’ eight legacy kiting-model failures remain playtesting concerns, documented in `testing/TUNING_SENTENCED.md`. The unrelated tasks in section 2 remain deferred. The old Sonnet workflow and tuning scripts below are archived history.

## Original handoff (saved 2026-10-28)

The snapshot below records the stop point. The redesign has since been resumed with `gpt-6-luna` agents at low reasoning effort and the owner added camp-wide mob marking. Current rules are in `docs/SENTENCED_REDESIGN.md`; validation and balance evidence are in `testing/TUNING_SENTENCED.md`. `sentenced-workflow.js` and the optimization scripts are historical tools; their Sonnet-only prompts and paths describe the old run.

## Live state at the stop point
- main = `c977910` (zone shapes + balance pass + quests r2 + quest accept), live on play.roguehalla.com.
- Live server: port 2600 from `.claude/worktrees/site-live`; tunnel `cloudflared tunnel --no-autoupdate run --url http://localhost:2600 roguehalla` (start with nohup). Local: 2567 server + 5173 vite from `.claude/worktrees/main-merge`.

## 1. Sentenced redesign: original stop point
- Branch `claude/sentenced-redesign` (pushed to GitHub), worktree `.claude/worktrees/sentenced-redesign`.
- Commits: `9dce8c0` contract (`docs/SENTENCED_REDESIGN.md`, copy here), then WIP `74d002f`, `f18c08f`, `632e067` (mark.ts, tiers, tax, suppression, execute denial, sim wiring, Python model, number tuning).
- Done: contract, most of the core sim/shared/Python changes. The tuning search (`opt*.py` here) was running when stopped.
- Left: finish core and get tests green; client UI (tier pips, slowed/execute-blocked icons, "Sentence: k/5", Trial ring shrink, toasts); tune the four edges (beat Plague/Frost, lose to Fire/Holy, favourite 60-76%, ends 10-35% hp); review; merge, push, deploy.
- Original resume procedure: `sentenced-workflow.js` used Sonnet agents. For further work use the current contract and tuning evidence; do not replay its stale release instructions blindly.
- Orchestrator decisions are in that file (D1-D11): other factions' numbers from the repo; execute denial = a tier-4-marked target cannot execute its Sentenced; kill-stacks count player kills only; the tax is a mod source; no Respite; 5 new cards never name a faction (catalog 80); BEATS unchanged; Python oracle updated.

## 2. Deferred (owner said later)
- Balance re-measure on the 136x136 maps: farming pace (about one camp a minute assumed), cards at the first teleport, campDuel, e2e kill rate x6-8, questBench, and why the bandwidth bench has more fights with quests on (tolerance widened to 2 KB/s).
- Fill bots die very fast.
- Quest dialog nits: open J log covers the dialog; F with the dialog open always closes it; an accepted offer still takes Enter/1.
- questBench --quick under-reports fetch quests (the giver detour eats its 120 s cap).
- Rime cover was skipped by the owner.
