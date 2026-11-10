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
All under `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/`. Remove each after merging into `feature/unity-rework`. Max 4 Unity worktrees.
| Worktree | Branch | Owner | Scope | Status |
|---|---|---|---|---|
| `rework-contrast-lab` | `rework/contrast-lab` | Sonnet | serverless contrast lab stage (`?contrastlab=1`), `contrast-gate.cjs` (edge >= 3.0, markers >= 4.5, exit code), `docs/rework/CONTRAST_GATE.md`, baseline numbers (ports 7887/8187) | running |
| `rework-surface-fx` | `rework/surface-fx` | Sonnet | 10 s tracks, water/bog ripples and wake, footstep sounds per surface, `?surfacefx=1` log, ripple-position API (ports 7917/8217) | running |
| `rework-render` | `rework/render` | Sonnet, high | rendering-features pass (Breath of the Wild reference): relief lighting, shadow-casting local lights, cookies/volumetrics/emissive, water/ice/heat, wind and cloud shadows, grading, light for Wish FX, projectile trails and impacts; `docs/rework/RENDER_PLAN.md`; per-feature cost at 2560x1440 (ports 7927/8227) | running |
| `rework-vision-wire` | `rework/vision-wire` | Sonnet, low | `VisionRule` reads radius/tile/trail/update/mask/coliseum rect from Welcome's vision block; unknown rules version = no fog | running |
| `rework-indicators` | `rework/indicators` | Sonnet | final UI pass vs legacy: audit `docs/rework/LEGACY_INDICATORS.md`, overhead indicators (dominant stat, secondary weapon, statuses), every legacy world marker the wire supports, weapon hit-zone indicator against an empty-by-default `WeaponShapes` provider (ports 7937/8237) | running |
| `rework-mob-spacing` (Rust only, no Unity Library; 5th worktree, allowed because the 4-worktree limit was about Unity copies; disk 106 GB free after clearing 61 GB of stale agent build caches) | `rework/mob-spacing` | Opus | (A) mobs keep foot-box room from each other, Archetypes mode only, legacy bit-identical; (B) weapon table (reach, half-arc) in the protocol-16 Welcome with C#/JS codecs and vectors | running; needs an independent Opus review before merge |
| done | `docs/adr/0025-lingering-tracks.md` | Opus | design-only ADR for server-side tracks: players only, a print every 36 u, world list capped 1024, visible by the projectile `point_visible` rule, no identity, reliable State key 12, about half the hitbox change; would be protocol 17 | committed |

Merged and removed since the last table: `rework/hitbox` (merge of review fixes: all ten findings, vision block in Welcome, `LIVE_DEFAULT_HITBOXES` one-line flip, `hitbox_compare` tool; protocol 16 / observation 22 / policy 16 / checkpoint 30 / replay 24 / content `026f083d8473fa4b`), `rework/hitbox-client` (merge `d1345720`), `rework/regions3` (one temple interior; prop cells padded). Merged tree: C# 1093, JS vectors agree, palette 396/396; full verification (cargo with Postgres, parity, proof, clippy, EditMode, server + WebGL build at protocol 16 with `--hitboxes archetypes`) running in the main checkout as background job.

Hitbox numbers (40 bot matches per mode, same seeds, legacy -> archetypes; NO balance harness exists, P-BALANCE-1 was never written): hits 44875 -> 43896; player deaths 269 -> 270; mob deaths 819 -> 758; mean match 4196 -> 4326 ticks; bot bow hit rate .541 -> .600, bot wand .958 -> .966, mob bow .837 -> .924, mob wand .336 -> .488; bot sword .910 -> .930, bot axe .923 -> .977. Bot/mob aim unchanged (no pair measurably misses). Known edge behaviour at overlap range (ADR changes 14, 15): melee flips for a target beside the attacker around the box boundary (34 u north misses, 36 u hits); a shot flips once along the flight line; a body walking onto an arrow between steps is decided by the ground test.

NEXT ACTIONS for the coordinator, in order:
1. When the background verification finishes: read results; check the merged build in the browser with `?hitboxes=1` (wall approach, chest aim) and all zones; then FLIP `LIVE_DEFAULT_HITBOXES` to `Archetypes` in `crates/rh-server/src/runtime.rs` plus the pinned expectation in `tests::which_runtimes_default_to_which_hitbox_mode` (owner approved), rebuild, re-verify.
2. Update MIGRATION checkpoint and CONTRACTS status rows (C-OBS: projectile height reveals only player-look vs mob look; C-NET: protocol 16 Welcome carries archetype table and vision block; C-PARITY: parity runs LegacyCircle; C-DET: checkpoint 30, replay 24). `tools/unity-browser-reload-proof` still pins protocol 14.
3. Start the UI final pass (legacy indicators) when a worktree slot frees.
4. After the rendering pass: Opus performance-engineering pass; perf at 2560x1440; Gate 2 report (overdue: write it as soon as the hitbox default is flipped and verified).

Queue (start as slots free, max 4 agents):
1. After the hitbox review: fix findings, merge `rework/hitbox`, rebuild server + client at protocol 16, then **P-HB-7** (C# `Footprint`, `LocalMotion` own foot box, tests against `pathfinding_v2.json` / `server_walk_v2.json`) and **P-HB-8** (Unity chest aim in `MatchClient`, projectiles drawn at height, sprite from archetype key, delete Unity `MobLooks`, debug box overlay). Then rest of P-HB-9: parity-report label + guard test, headless balance verdict both modes, bot hit-rate check. `tools/unity-browser-reload-proof` pins the old content hash.
1b. **Contrast lab** (RUNNING as `rework/contrast-lab`): serverless stage reusing the launch backdrop's synthetic arena, stamps every appearance and mob look on every surface per zone, `contrast-gate.cjs` measures edge and body contrast in the real WebGL build and exits non-zero under 3:1.
1c. **Rendering-features pass** (after `rework/regions2` merges).
2. **Surface effects** (RUNNING as `rework/surface-fx`): footprints in sand and snow, ripples/wake in shallow water and bog, footstep sounds per surface. Only for delivered (in-sight) actors.
3. If the vision agent says so: vision parameters into Welcome inside protocol 16.
1d. **Region pass 3** (RUNNING as `rework/regions3`): Holy as ONE temple interior; Plague tree clipping; contrast-lab failures.
4. **UI pass 3 and the final legacy-parity UI pass** (overhead indicators: dominant stat, secondary weapon, statuses; every legacy HUD/world marker): station panels (shop, wardrobe, progress, guide) still old look; results screen never captured; Tab-map zone-border staircase; `[]` glyph in weapon-counter labels; pedestal arc; hub room empty at 2560; re-shoot the launch screen now that lighting is merged; chest and trader screens (Gate 3).
5. Ranged-release pause prediction (`docs/rework/RANGED_PAUSE_PREDICTION.md`): architect review, Rust vectors, then C#.
6. Performance (owner: optimise before cutting; Opus sub-agent on Unity efficiency: build/engine settings such as IL2CPP optimisation level, Wasm SIMD/native exceptions, stripping, incremental GC, disabling unused engine modules and background work, batching and culling audits): `perf-run.cjs` at 2560x1440 with everything merged, attribution table; decide the pass rule (dropped frames at 144 Hz + vsync-off headroom). `HardMaxLights` is 6 while the Ultra row asks for 12.
7. Gate 2 report once hitboxes are live in the browser.

Known gaps from the lighting pass (assigned to `rework/regions2`): Holy clips 2.1-2.6% (> 2% aim); Fire ground still reads saturated orange in `fire-lava-glow.jpg`; Sentenced flagstones read medium purple-grey; sprite-edge contrast as low as 2.7:1 (Sentenced) and bars 3.6-4.3:1 (Plague/Fire); mobs unmeasured; 2560x1440 cost unmeasured. Audio: eleven MP3s (8.7 MB, CC0 except Fire's music CC BY 3.0) under StreamingAssets, fetched after match start; never listened to.

## Gate 1 inputs
| Item | Status | Output |
|---|---|---|
| Hitbox / chest-height / protocol design | done | `docs/adr/0024-hitbox-archetypes.md` |
| Controls audit (code) | done | `docs/rework/CONTROLS_AUDIT.md` |
| UI triage + legacy layout | done | `docs/rework/UI_TRIAGE.md`, `docs/rework/LEGACY_LAYOUT.md` |
| Palette + ledger + sourcing | running (Sonnet, main checkout, uncommitted files under `docs/art/`, `tools/art/`) | `docs/art/PALETTE.md`, `palette.json`, `LICENCE_LEDGER.md`, `ASSET_SOURCING.md` |
| Baseline tests | parity all MATCH, C# 956/956, server builds; cargo rerun with Postgres + browser proof in flight | Gate 1 report |

After these merge: P-HB-7 (C# foot-box prediction) and P-HB-8 (Unity chest aim, projectile height, sprite from archetype), then workstreams E (region ground), F (lighting/particles/audio) and G (Ultra preset, profiling).

## Hitbox review (Opus, 2026-11-10): LAND AFTER FIXES
Legacy mode clean; all tests and decoders pass; crash fixes correct, no DEVIATIONS row needed, merge clean. Findings and rulings:
1. MAJOR live default flipped before client prediction/aim and the balance verdict exist -> default legacy now; coordinator flips after P-HB-7/8 + verdict.
2. MAJOR melee hit targets up to 34 u behind the attacker (origin inside the tall body box counted as a hit) -> inside the box, use the legacy arc test (12 u unconditional zone).
3. Point-blank shots flipped hit/miss on a 1 u offset -> a projectile starting inside a body box resolves that target with the legacy ground-plane test.
4. Restore accepted any projectile height. 5. NaN counted as a hit. 6. Wire vector gaps. 7. Parity guard missing. 9. `--hitboxes` silently ignored in some runtimes; soaks did not cover archetype mode.
8. Projectile height revealed the shooter's faction (per-faction chest heights 30/25/33/27) -> coordinator ruling: one chest height (30) for all players. Flag at Gate 2.
10. Bot/mob shots predicted to miss short targets -> measure, then apply the chest correction in archetype mode only.

## Owner pre-approvals before an 8-hour absence (2026-11-10)
1. **Gate 3 / merge:** "Also merge locally if green": finish everything; merge `optimization_port` into our branch when the backend lands and re-verify; run the Opus final review on the combined tree; if every check and the final review pass, merge our branch into `optimization_port` LOCALLY (squash). NO push, NO deploy. If the backend has not made its final merges, the combined final review cannot happen: stop at a merge-ready, fully verified branch and say so.
2. **Hitboxes live:** yes, balance shift accepted as risk (owner signs the DEVIATIONS rule 3 escape valve). Flip the live default to archetypes once client prediction and chest aim are verified; run and report the legacy-versus-archetypes comparison, but it does not block.
3. **Contrast last resort:** NOT approved. If an edge still fails 3:1 after ground tuning, contact shadow and the neutral outline, do not add faction-coloured outlines: report the failing combinations with numbers.
4. **Hitbox review rulings accepted:** melee cannot hit behind the attacker; point-blank shots use the legacy ground rule; one chest height for all players.
Keep-awake is on for the session (idle sleep only; a closed lid still sleeps).

## Launch readiness checklist (owner, 2026-11-10: "all planned work and visuals done here; everything perfected and verified here before the beta")
Nothing is called done until the coordinator has seen it in a real browser build of the merged branch and the numbers below exist. Tick only with evidence.
- [ ] Hitboxes: review fixes merged; client foot-box prediction matches Rust v2 vectors; chest aim; archetype mode live by default; balance comparison both modes; no snap-back worse than legacy (browser numbers).
- [ ] Vision: fog of war + fades verified on the merged build; vision params read from Welcome; mobs fade (position continuity) or the limit is documented.
- [ ] Zones: Holy is ONE temple interior; Plague trees not clipped; every zone matches the lighting order and owner tuning notes; coordinator captures of all five zones + coliseum at 1920x1080 and 2560x1440.
- [ ] Contrast gate: `contrast-gate.cjs` exits 0 (edge >= 3:1 for every appearance and mob on every surface in every zone at High and Ultra, both sizes; markers >= 4.5:1); body numbers reported; last-resort faction outline only if the owner approves.
- [ ] Rendering-features pass (Breath of the Wild reference) in at Ultra; every effect switchable and costed.
- [ ] Surface effects: 10 s tracks, ripples, footstep sounds per surface.
- [ ] Wish effects: light and bloom added; readable on every zone's ground.
- [ ] Combat QoL: mob spacing reviewed (Opus), merged, measured; weapon hit-zone indicator fed by the Welcome weapon table and verified in the browser.
- [ ] UI: final pass against legacy (overhead indicators, every legacy marker); station panels, results, chest and trader screens in the skin; Tab-map border staircase and `[]` glyph fixed; launch screen re-shot with lighting.
- [ ] Controls: input-to-motion delay measured in the browser; ranged-release pause prediction decided and done or documented.
- [ ] Performance: Ultra at 2560x1440 on the 144 Hz display measured with everything in; per-effect attribution; optimisation work (Opus) before any cut; build size under 150 MB compressed.
- [ ] Tests on the final merged tree: cargo workspace (with Postgres), parity-report, dotnet, JS vectors, browser proof, Unity EditMode, node tool tests; zero failures.
- [ ] Licences: ledger complete; every notice in the build; EmojiOne resolved; audio attributions shipped.
- [ ] Gate 2 and Gate 3 reports written; `optimization_port` merged into the branch and re-verified; owner approves Gate 3; merge (squash); Opus final review of the combined tree against the real deploy command.

## Evidence policy (set 2026-11-10)
Committed screenshots had reached 370 MB. Pruned to about 28 MB at `fc67e123` (JPEG, 1600 px max, one resolution per screen). From now on: evidence in the repo is JPEG only, a curated handful per pass (aim under 5 MB per folder); raw captures stay outside the repo; bulky agent branches are squash-merged and trimmed. Branch history still holds the old PNG blobs: at Gate 3 recommend a squash merge so they never reach the public repo.

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

- **HARD GATE: objective 3:1 character-versus-ground contrast** in the final visual pass, landscape still vivid. Levers in order: ground contrast/saturation, contact halo, neutral outline/rim, faction-colour outline + logo at feet as LAST RESORT. Definition (edge >= 3:1 hard; body reported) is in `UNITY_REWORK_FABLE.md` section 4. Sent to `rework/regions2`. QUEUED: a serverless **contrast lab** tool (every appearance on every `SurfaceKind` under each zone's lighting, real WebGL build, JSON + exit code). `feat(view): SurfaceMap` is cherry-picked onto the feature branch (`264b4515`).
- **"Push Unity's 2D renderer to the max, all the bells and whistles."** QUEUED as a rendering-features pass after `rework/regions2` merges (same shaders): normal-mapped lighting, shadow-casting point lights with soft shadows, cookies, volumetric shafts, emissive + HDR bloom, water/ice reflection-refraction, heat shimmer, cloud shadows, wind sway and reactive grass, per-zone grading. All behind Ultra and per-effect switches, costed at 2560x1440.

- Owner on the merged region pass: "everything looking good so far" except (1) **Holy temple is wrong**: they wanted the square region to be the INSIDE of ONE large temple, not small domed temples on each pillar block; (2) **Plague trees are cut off on their left and right edges** (sprite cell/atlas clipping). QUEUED as region pass 3 (first free slot): one grand interior (continuous floor, pillar blocks as great piers/columns with arches between them, open arcade at the perimeter so nothing reads as a blocking wall, focal altar/mihrab-like centre, carpets, stained-glass light on the floor, hanging lamps that fade near actors, no domes on blocks), plus the tree clipping fix and whatever the contrast lab fails.
- Owner added a **final UI pass against legacy**: overhead indicators (dominant stat, secondary-weapon indicator, statuses) and every other legacy HUD/world marker. Added to the queue as the last UI pass; audit legacy first, build what the wire delivers, list what it does not.
- Owner offered more detail on future developments; coordinator asked for: reference games/images for the target look, whether lingering footprints should be a tracking mechanic, music taste, and what to cut first if effects threaten 144 fps.

- Owner answers (2026-11-10): (1) **Reference = Breath of the Wild**: thematic zones, fun dungeons (spirit only, never assets). (2) **Tracks linger 10 s** behind a character; Rust first unless it is a big undertaking, else Unity client-side first and Rust later. Coordinator judgement: server-side tracks are a big undertaking here (new sim state, a new observation rule for what a viewer may see, wire and fixtures, determinism/checkpoint, a parity deviation and ADR), so: client-side now in the surface-effects pass (prints only from actors while delivered, lasting 10 s), plus a design-only ADR for server tracks (Opus) so it can follow as protocol 17. (3) Music choices fine for now. (4) **Never cut an effect to hold 144 fps before optimising**: find optimisations, use an Opus sub-agent on Unity efficiency, cut only as last resort after showing the measured limit.

- **Release plan (owner, 2026-11-10):** Codex and DeepSeek are finishing the backend; Claude finishes Unity and the front end. Once both have made their final merges and commits, launch an Opus sub-agent for a FINAL REVIEW of all parts together; if it passes, Codex launches the beta at https://play.rougehalla.com. The Gate 3 rule still stands: nothing of ours is merged or pushed before the owner approves Gate 3. Facts checked: `optimization_port` is at `4151b3af` (7 commits past our branch point; it cherry-picked only our FIRST crash patch, not `a1f1d129`, so backend servers can still hit the `state.rs:1149` panic); backend branches (`codex/backend-gameplay-quests` 81 commits ahead, `codex/deepseek-quest-backend`, bots) are still protocol 14 and touch quests/coliseum, no version bumps seen; the only textual conflict with us today is `crates/rh-sim/src/systems/frost.rs` (resolve in favour of `a1f1d129`). Hand-back note for Codex: `docs/coordination/CLAUDE_UNITY_REWORK_HANDBACK.md`. Owner decision 2026-11-10: the beta WAITS for the full Unity list (no early release candidate). Final sequence: backend merges first -> merge `optimization_port` into our branch and re-verify -> Gate 3 approval -> merge (squash) -> Opus final review against the exact deploy command.

- Combat QoL (owner, 2026-11-10): mobs bunch up and stack -> give them room (Rust, `rework/mob-spacing`); weapon hit-area indicator, white zone that follows the swing (Unity, `rework/indicators`, fed by a weapon table in Welcome from `rework/mob-spacing`). AFTER BOTH MERGE the coordinator connects `Welcome.Weapons` to `WeaponShapes.Set(...)`.

## Facts found while orienting (differ from the prompt's section 3)
- The full five-region map is **160 x 160**, not 136 x 136: `crates/rh-sim/src/mapdata/fixtures/seed1.map.json` and `seed2.map.json` (rh-map/2, 4,936 tiles per region, 50 camps, terrain kinds 1-7, 86 features). Serve with `rh-server --runtime source-arena --map <file>`.
- `--first-playable` (48 x 40) has only 4 Frost and 4 Sentenced tiles, so it cannot show Frost. Region playtests use the seed maps.
- `dotnet` lives at `~/.dotnet/dotnet`, `cargo` at `~/.cargo/bin`.
- `docs/DEVIATIONS.md` exists: intentional departures from legacy add a row there.

## Next
Gate 1 report, then workstream B (Rust) in a worktree with Opus review, A/D/E/G Unity work in parallel worktrees (max 4).
