# Saved work and deferred items

## Current work (2026-10-28)

The redesign is complete in code, including camp-wide marks with reduced per-member pulse damage, tier/status nameplates, Sentence stacks and the Trial ring. The branch integrates the latest `main` combat upgrade (`ebd3514`), rather than the unrelated Kimi checkout. Final integrated validation and release status are recorded below after the release checks.

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
