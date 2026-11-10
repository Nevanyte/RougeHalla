# Unity rework: coordinator state

Read this first after any context reset. Direction: [UNITY_REWORK_FABLE.md](UNITY_REWORK_FABLE.md). Gate reports: `UNITY_REWORK_REPORT.md`.

## Now
- **Phase:** Gate 1 (direction). Started 2026-11-09.
- **Feature branch:** `feature/unity-rework`, cut from `optimization_port` at `61f9f15f`. Never push, never merge.
- **Toolchain PATH:** `export PATH="$HOME/.cargo/bin:$HOME/.dotnet:$PATH"` (neither is on the default shell PATH).
- **Display:** confirmed 2560 x 1440 @ 144 Hz (`system_profiler SPDisplaysDataType`), plus a second 1080p/100 Hz panel.

## Unity processes
- PID 9075: an Editor the owner's earlier Codex lane left open on `/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/...`. Not ours. The handoff says do not save, reset or clean it. Leave it alone; it holds a different project copy.
- Main checkout project copy (`client-unity/UnityProject`): free.

## Worktrees opened by this effort
All under `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/`. Remove each after merging into `feature/unity-rework`.
| Worktree | Branch | Owner | Scope | Unity on its copy |
|---|---|---|---|---|
| `rework-hitbox` | `rework/hitbox` | Opus | ADR 0024 packets P-HB-0..6 and the P-HB-9 server flag (Rust, protocol 16, C#/JS codecs) | no |
| `rework-controls` | `rework/controls` | Sonnet | controls audit fixes 1,2,4,5, backward walk, input-latency hook | batch EditMode tests |
| `rework-hud` | `rework/hud` | Sonnet | theme seam, legacy canvas scale, in-match HUD at legacy layout | batch EditMode tests |

## Gate 1 inputs
| Item | Status | Output |
|---|---|---|
| Hitbox / chest-height / protocol design | done | `docs/adr/0024-hitbox-archetypes.md` |
| Controls audit (code) | done | `docs/rework/CONTROLS_AUDIT.md` |
| UI triage + legacy layout | done | `docs/rework/UI_TRIAGE.md`, `docs/rework/LEGACY_LAYOUT.md` |
| Palette + ledger + sourcing | running (Sonnet, main checkout, uncommitted files under `docs/art/`, `tools/art/`) | `docs/art/PALETTE.md`, `palette.json`, `LICENCE_LEDGER.md`, `ASSET_SOURCING.md` |
| Baseline tests | parity all MATCH, C# 956/956, server builds; cargo rerun with Postgres + browser proof in flight | Gate 1 report |

After these merge: P-HB-7 (C# foot-box prediction) and P-HB-8 (Unity chest aim, projectile height, sprite from archetype), then workstreams E (region ground), F (lighting/particles/audio) and G (Ultra preset, profiling).

## Decisions taken
- 2026-11-09: branch name `feature/unity-rework`.
- 2026-11-09: Gate 1 doc-only tasks share the main checkout (distinct files, no commits by sub-agents); code tasks get worktrees.
- 2026-11-09: protocol bump is 14 -> **16** (15 is used by the unmerged netcode branch).
- 2026-11-09: melee is measured at the **target's** chest height, not the attacker's: attacker-chest is lopsided when sizes differ, and even reach was the owner's stated goal. Flag at Gate 1.
- 2026-11-09: test environment: `PGBIN=/opt/homebrew/bin` for `tools/pgtest/start.sh`; `NODE_PATH=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/browser/node_modules` supplies Playwright.
- 2026-11-09: `ccf05e05` adds a file under `packages/`; that file is skipped (packages is read-only).
- 2026-11-09: the unmerged protocol-15 netcode WIP (`claude/peaceful-babbage-rtsgq6`) is not part of this effort; our bump is taken from 14 on this branch and the number clash is flagged at Gate 1.

## Facts found while orienting (differ from the prompt's section 3)
- The full five-region map is **160 x 160**, not 136 x 136: `crates/rh-sim/src/mapdata/fixtures/seed1.map.json` and `seed2.map.json` (rh-map/2, 4,936 tiles per region, 50 camps, terrain kinds 1-7, 86 features). Serve with `rh-server --runtime source-arena --map <file>`.
- `--first-playable` (48 x 40) has only 4 Frost and 4 Sentenced tiles, so it cannot show Frost. Region playtests use the seed maps.
- `dotnet` lives at `~/.dotnet/dotnet`, `cargo` at `~/.cargo/bin`.
- `docs/DEVIATIONS.md` exists: intentional departures from legacy add a row there.

## Next
Gate 1 report, then workstream B (Rust) in a worktree with Opus review, A/D/E/G Unity work in parallel worktrees (max 4).
