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
| `rework-hitbox` | `rework/hitbox` | Opus | ADR 0024 packets P-HB-0..6 + P-HB-9 flags; protocol 16, obs 22, checkpoint 30, replay 24, policy 16, content `d9479b6612616984` | DONE at `c54c7a18`, NOT merged: waiting on the Opus review, then merge (expect rh-sim conflicts with the crash fixes) |
| (review, no worktree) | reads `rework/hitbox` | Opus, high | independent review of the hitbox diff `8f677cb5..c54c7a18` and crash fixes `2bfdc57b`, `a1f1d129` | running |
| `rework-wish-fx` | `rework/wish-fx` | Sonnet | animation and VFX for the five Wishes, HUD Wish tile, SFX (ports 7857/8157) | running |
| `rework-vision` | `rework/vision` | Sonnet | fog of war mirroring the Rust sight rule (golden vectors `sight_v1.json`), fade on leaving/entering sight, minimap/Tab map visibility (ports 7867/8167) | running |
| `rework-regions2` | `rework/regions2` | Sonnet | SurfaceMap (first commit), Holy temple, Plague mud/grass/shallow water, Fire dark basalt, Sentenced black tiles, contrast >= 3:1 / 4.5:1, coliseum props, TerrainMode honesty (ports 7877/8177) | running |

Merged and removed: `rework/controls`, `rework/hud`, `rework/skin`, `rework/regions`, `rework/perf`, `rework/map-hud`, `rework/sim-crash`, `rework/launch`, `rework/atmosphere` (merge `2ffe468d`; EditMode 369/369, C# 1022, palette-check 396/396 after fixing the checker's token source).

Queue (start as slots free, max 4 agents):
1. After the hitbox review: fix findings, merge `rework/hitbox`, rebuild server + client at protocol 16, then **P-HB-7** (C# `Footprint`, `LocalMotion` own foot box, tests against `pathfinding_v2.json` / `server_walk_v2.json`) and **P-HB-8** (Unity chest aim in `MatchClient`, projectiles drawn at height, sprite from archetype key, delete Unity `MobLooks`, debug box overlay). Then rest of P-HB-9: parity-report label + guard test, headless balance verdict both modes, bot hit-rate check. `tools/unity-browser-reload-proof` pins the old content hash.
2. **Surface effects** (after `feat(view): SurfaceMap` exists on `rework/regions2`; cherry-pick it to the feature branch first): footprints in sand and snow, ripples/wake in shallow water and bog, footstep sounds per surface. Only for delivered (in-sight) actors.
3. If the vision agent says so: vision parameters into Welcome inside protocol 16.
4. **UI pass 3**: station panels (shop, wardrobe, progress, guide) still old look; results screen never captured; Tab-map zone-border staircase; `[]` glyph in weapon-counter labels; pedestal arc; hub room empty at 2560; re-shoot the launch screen now that lighting is merged; chest and trader screens (Gate 3).
5. Ranged-release pause prediction (`docs/rework/RANGED_PAUSE_PREDICTION.md`): architect review, Rust vectors, then C#.
6. Performance: `perf-run.cjs` at 2560x1440 with everything merged, attribution table; decide the pass rule (dropped frames at 144 Hz + vsync-off headroom). `HardMaxLights` is 6 while the Ultra row asks for 12.
7. Gate 2 report once hitboxes are live in the browser.

Known gaps from the lighting pass (assigned to `rework/regions2`): Holy clips 2.1-2.6% (> 2% aim); Fire ground still reads saturated orange in `fire-lava-glow.png`; Sentenced flagstones read medium purple-grey; sprite-edge contrast as low as 2.7:1 (Sentenced) and bars 3.6-4.3:1 (Plague/Fire); mobs unmeasured; 2560x1440 cost unmeasured. Audio: eleven MP3s (8.7 MB, CC0 except Fire's music CC BY 3.0) under StreamingAssets, fetched after match start; never listened to.

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

- FINAL zone brightness order (supersedes earlier notes): Holy (darker sand, bright rays; temple interior decent passive) > Frost (white sun) > Plague (medium, marshy, lots of rays, green through brush) > Fire (darkest passive, lava brightens) > Sentenced (darkest, lamps/torches). Written into `UNITY_REWORK_FABLE.md` section 4 and sent to the atmosphere agent.

- Tuning: Plague greens darker (deep fern/moss); Sentenced tiles black/dark grey, not light grey; character-versus-ground contrast is a hard requirement in every zone (outline + rim, measured per region). -> atmosphere agent.
- Wishes need animation (missed in the plan): find assets or build them. -> `rework/wish-fx`. Added to `UNITY_REWORK_FABLE.md` scope.

- Vision: characters pop out of sight in one frame behind walls and nothing on screen shows line of sight. Owner wants a fog of war aligned with the Rust vision system and a subtle exit from vision. -> `rework/vision`. Rust: `VISION_RADIUS` 900 u, `sight.rs`/`vision.rs`/`observe.rs`; legacy `RaidVision.ts`. If vision parameters need to reach the client, add them to Welcome inside the protocol 16 bump (after `rework/hitbox` merges), not as a second bump.

- Ground patterns: Fire, Sentenced and Plague share one floor pattern in different colours. Keep Fire. Sentenced = square castle/dungeon tiles (sent to atmosphere agent). QUEUED for region art pass 2 with the Holy temple: Plague ground as a mix of mud, grass and dark-green shallow water that can be walked through and is clearly distinct from bog; water and bog get interesting lighting, opacity and reactive effects when walked through (ripples, wake); darker footprints in sand, prints in snow; different footstep sounds per surface.

## Facts found while orienting (differ from the prompt's section 3)
- The full five-region map is **160 x 160**, not 136 x 136: `crates/rh-sim/src/mapdata/fixtures/seed1.map.json` and `seed2.map.json` (rh-map/2, 4,936 tiles per region, 50 camps, terrain kinds 1-7, 86 features). Serve with `rh-server --runtime source-arena --map <file>`.
- `--first-playable` (48 x 40) has only 4 Frost and 4 Sentenced tiles, so it cannot show Frost. Region playtests use the seed maps.
- `dotnet` lives at `~/.dotnet/dotnet`, `cargo` at `~/.cargo/bin`.
- `docs/DEVIATIONS.md` exists: intentional departures from legacy add a row there.

## Next
Gate 1 report, then workstream B (Rust) in a worktree with Opus review, A/D/E/G Unity work in parallel worktrees (max 4).
