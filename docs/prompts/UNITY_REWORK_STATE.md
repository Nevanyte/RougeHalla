# Unity rework: coordinator state

Read this first after any context reset. Direction: [UNITY_REWORK_FABLE.md](UNITY_REWORK_FABLE.md). Gate reports: `UNITY_REWORK_REPORT.md`.

## Now
- **Phase:** between Gate 1 (report written 2026-11-09, commit `0975ac0a`) and Gate 2 (Frost vertical slice).
- **Feature branch:** `feature/unity-rework`, cut from `optimization_port` at `61f9f15f`. Never push, never merge.
- **Toolchain PATH:** `export PATH="$HOME/.cargo/bin:$HOME/.dotnet:$PATH"` (neither is on the default shell PATH).
- **Display:** confirmed 2560 x 1440 @ 144 Hz (`system_profiler SPDisplaysDataType`), plus a second 1080p/100 Hz panel.
- **Coordinator processes:** rh-server on 127.0.0.1:7787 (full seed1 map, 7 bots) and `python3 -m http.server 8087` serving the main checkout's `Build/Web`. Join URL needs `&diagnostic=1&token=t1` (loopback diagnostic join); then pick a spawn and click Ready in planning.
- **Ports in use by others, do not touch:** 7777 (old server PID 63281). Sub-agent ports: regions 7797/8097, perf 7807/8107.

## Unity processes
- PID 9075: an Editor the owner's earlier Codex lane left open on `/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/...`. Not ours. The handoff says do not save, reset or clean it. Leave it alone; it holds a different project copy.
- Main checkout project copy (`client-unity/UnityProject`): free.

## Worktrees opened by this effort
All under `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/`. Remove each after merging into `feature/unity-rework`.
| Worktree | Branch | Owner | Scope | Status |
|---|---|---|---|---|
| `rework-hitbox` | `rework/hitbox` | Opus | ADR 0024 packets P-HB-0..6 and the P-HB-9 server flag (Rust, protocol 16, C#/JS codecs) | running |
| `rework-perf` | `rework/perf` | Sonnet | Ultra preset + Quality API, `?perf=1` recorder, `perf-run.cjs`, build size, licence notices, EditMode global-light failures (ports 7807/8107) | running |
| `rework-atmosphere` | `rework/atmosphere` | Sonnet | region lighting/post, snow and other screen particles, per-region music from StreamingAssets, `AtmosphereQuality` switchboard (ports 7827/8127) | running |

Merged and removed: `rework/controls` (`73f3df89`), `rework/hud`, `rework/skin`, `rework/regions`.

Follow-ups owed after merges:
- Wire `AtmosphereQuality` to the perf branch's `Quality` API.
- P-HB-7 (C# foot-box prediction) and P-HB-8 (Unity chest aim, projectile height, sprite from archetype, debug box overlay) after `rework/hitbox` merges.
- Opus review of every `rh-sim` change (hitbox branch plus the `attack_started` crash fix `2bfdc57b`, which still needs a regression test).
- HUD weak spots from the skin pass: low-res icons, hub near-black cells, letterboxed planning map, uncaptured death line/chest/toasts.
- Regions weak spots: coliseum has no props, bog pools dark, terrain surfaces drawn even when terrain mode is Off, wall torches dropped on region maps, two unexplained "ERROR: Shader" console lines.
- Ranged-release pause prediction (`docs/rework/RANGED_PAUSE_PREDICTION.md`) needs architect review then Rust vectors.
- Join URLs must use the literal host 127.0.0.1 (with `localhost` the diagnostic join can be refused).

Unity EditMode baseline on unmodified code: 217 tests, 143 pass, 74 fail (73 "More than one global light", 1 BuildDrawer). The perf agent owns fixing these.

Server crash found and fixed (`2bfdc57b`): Plague zombie raised mid-tick overran the `attack_started` scratch in `frost::after_weapons`; rooms died about 105 s into full-map bot matches. Any server built before that commit will crash the same way.

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
