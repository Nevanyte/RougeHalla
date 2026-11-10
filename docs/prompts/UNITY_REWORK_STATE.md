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
| `rework-sim-crash` | `rework/sim-crash` | Opus | reproduce headlessly and fix the second room panic (`state.rs:1149`, stale fighter index), audit the family, regression tests | running |
| `rework-launch` | `rework/launch` | Sonnet | launch screen + hub to legacy arrangement in the HUD skin, title, region backdrop, error states (ports 7847/8147) | running |
| `rework-atmosphere` | `rework/atmosphere` | Sonnet | region lighting/post, snow and other screen particles, per-region music from StreamingAssets, `AtmosphereQuality` switchboard (ports 7827/8127) | running |

Merged and removed: `rework/controls` (`73f3df89`), `rework/hud`, `rework/skin`, `rework/regions`, `rework/perf` (`29fc2045`), `rework/map-hud` (Tab map, zone tint, right-click minimap walk, crisp icons; EditMode 311/311, C# 1021).

Perf baseline (pre-rework visuals, 2560x1440 @ 144 Hz verified): High and Ultra both p50 6.90 / p95 7.50 / p99 7.80 ms, worst-1% 127.8 fps, 0 dropped frames. The literal "p95 <= 6.94 ms" criterion cannot pass under vsync (rAF timestamps jitter about +-1.5 ms around the 6.94 ms cadence). Decision to make at Gate 2: judge pacing by dropped frames at 144 Hz plus a vsync-off headroom measurement (p95 <= 6.94 ms uncapped). Only dynamic lights cost clearly above noise (about 0.9 ms). Build: 102.4 MB raw, 48.1 MB gzip, 41.0 MB brotli. EditMode after the fix: 217/217 on the perf branch. Tool: `node client-unity/UnityProject/Tools/perf-run.cjs --quality ultra --region frost --seconds 60 --url ... --server ... --out <dir> [--attribution]`.

Known open crash: `state.rs:1149` index out of bounds still panics rooms on the full map with bots even with `2bfdc57b`.

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

## Owner direction received mid-run (2026-11-09, after seeing the Frost screenshot)
Liked Frost. Asked for a real lighting system, now part of the atmosphere scope (sent to the atmosphere agent):
- One consistent sun across the map whose hue and brightness grade gradually by position as you cross zones (Frost bright white, Holy golden, Plague dim green, Sentenced little sun, Fire low to none).
- Environment shadows from props, walls and actors along the sun direction.
- Light-emitting terrain: lava lighting Fire, glowing bogs in Plague, Holy light zones.
- Slightly translucent lake ice in Frost.
- Other zone-specific touches where cheap.

Second owner message (same day): HUD and UI "look incredible". Hold the Tab map to the same standard; show zones on the minimap (hue per zone); right-clicking a spot on the minimap must walk the character there. Assigned to `rework/map-hud`.

Further owner messages (same day), all relayed to the agents named:
- Lighting only needs to be rendered for what the camera sees (cull lights and shadow chunks by camera rect, works while scouting). -> atmosphere agent.
- The launch/opening screen is "a bit of a mess" and joins the rework now, not at the end. Queued: starts when `rework/map-hud` merges (same UI files). Brief: legacy layout from `docs/rework/LEGACY_LAYOUT.md`, HUD-standard skin, remove duplicated station grid, cramped left panel, near-black cells, the "Arena is unavailable" message on a normal local visit; title treatment and region-art backdrop.
- The current build is FAR too bright (Fire lava blown out). Hard requirement: lower luminance everywhere, restrained bloom, ground albedo back to palette lightness, luma checks per region, a global world-brightness scalar. -> atmosphere agent.
- Sentenced becomes gothic dungeon/graveyard: flagstone tiles, wrought-iron graveyard fences, gothic masonry, tombstones, dead trees, lanterns. This replaces the earlier "haunted farmland, harvest dusk" look (still the one muted zone). -> atmosphere agent.

- Zone themes approved as a start, with two changes. (1) Passive lighting floor in every zone (vision system must not depend on region effects); Fire and Plague get a small passive level, a little sunlight in Plague marshes is welcome. -> atmosphere agent. (2) **Holy temple**: a golden temple generated over the dense square zone of Holy, sand outside, mosque/cathedral-style architecture; pick a roughly square area covering 35-70% of the Holy region as the generated terrain allows. QUEUED as "region art pass 2", to start when `rework/atmosphere` merges (same files). Facts for the brief: the generator already emits a Holy `hall` feature (seed1: bbox 39 x 39 tiles at (70,14), 998 pillar tiles, about 31% of Holy's 4,936 tiles); features are not on the wire, so the client detects the pillar grid from `Tiles` + `Regions` and grows a square to 35-70% where terrain allows. Presentation only, no Rust change. Use architectural motifs (domes, arches, colonnades, geometric tile, stained glass) and the Holy faction icon, not real-world religious symbols. Same pass: coliseum props, Plague bog pools, map zone-border staircase, `[]` glyph in weapon-counter labels.

## Facts found while orienting (differ from the prompt's section 3)
- The full five-region map is **160 x 160**, not 136 x 136: `crates/rh-sim/src/mapdata/fixtures/seed1.map.json` and `seed2.map.json` (rh-map/2, 4,936 tiles per region, 50 camps, terrain kinds 1-7, 86 features). Serve with `rh-server --runtime source-arena --map <file>`.
- `--first-playable` (48 x 40) has only 4 Frost and 4 Sentenced tiles, so it cannot show Frost. Region playtests use the seed maps.
- `dotnet` lives at `~/.dotnet/dotnet`, `cargo` at `~/.cargo/bin`.
- `docs/DEVIATIONS.md` exists: intentional departures from legacy add a row there.

## Next
Gate 1 report, then workstream B (Rust) in a worktree with Opus review, A/D/E/G Unity work in parallel worktrees (max 4).
