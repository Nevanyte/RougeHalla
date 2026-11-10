# Unity rework: gate reports

Direction: [UNITY_REWORK_FABLE.md](UNITY_REWORK_FABLE.md). Live state: [UNITY_REWORK_STATE.md](UNITY_REWORK_STATE.md). Branch `feature/unity-rework`, unmerged and unpushed.

---

## Gate 1: direction (2026-11-09)

Gate 1 is report-and-continue. Work carries on with the recommended answers below.

### Decisions that need your attention

| # | Decision | What I did | Change it by |
|---|---|---|---|
| 1 | **Parity conflict (flag).** Foot/body boxes and chest-height projectiles depart from the parity non-negotiable in `CLAUDE.md` and from D1. | Recorded as owner-approved in [ADR 0024](../adr/0024-hitbox-archetypes.md) and D10 in `ORDER_OF_OPERATIONS.md`. Default sim mode stays `legacy_circle`, so all 122 parity scenarios stay byte-identical; only the live server opts in. | Telling me to stop before the live switch. |
| 2 | **Melee is measured at the target's chest height, not the attacker's.** | You chose "attacker's chest" so reach would be even in all directions. The architect showed that is only even when both characters are the same size (hero against antlion is lopsided by 38 units). Target-chest is always even, so I built that. | Saying "attacker's chest". |
| 3 | **Protocol goes 14 to 16, not 15.** | The unmerged netcode branch `claude/peaceful-babbage-rtsgq6` already uses 15 with its own `v15.json`. If it merges after this work it renumbers to 17. | Naming a different number. |
| 4 | **Balance shifts with the new boxes.** | Hero-versus-hero melee reach grows about 23 units north/south; an east/west arrow's vertical target grows from 38 to 84 units. Plague and Holy players (mage sprites) get smaller boxes than Fire, Sentenced and Frost. The live switch waits on a headless balance run in both modes. | Asking for equal-size player boxes regardless of sprite. |
| 5 | **A 2 px dark outline on faction markers is required.** | Without it, a faction accent on its own region's ground can fall to 1.01:1 contrast. With it, all 240 faction-on-ground pairs pass. | n/a (rendering requirement). |
| 6 | **Chat and kill feed are not being built.** | Neither exists in the legacy game, so "keep the legacy layout" means leaving them out. The prompt listed chat among HUD elements. | Asking for chat as a new feature. |
| 7 | **Ranged release pause is not predicted yet.** | Firing a bow or wand while walking rubber-bands, because the server stops you for 200 ms and the client doesn't mirror it. Fixing it extends the Rust-mirrored prediction contract, so it is written up as a proposal (`docs/rework/RANGED_PAUSE_PREDICTION.md`) for architect review before code. I intend to implement it with Rust vectors unless you object. | Saying "leave it". |
| 8 | **No purchases requested yet. Running total: $0 of $100 / $150.** | Three candidates are shortlisted ($54.97 total) but their contents could not be confirmed from the store pages, and the free placeholders have not been judged in-game. Requests come at Gate 2 if still justified. | n/a |

### Where the prompt's facts were wrong

- **The map is 160 x 160, not 136 x 136.** Full five-region maps are `crates/rh-sim/src/mapdata/fixtures/seed1.map.json` and `seed2.map.json`, served with `--runtime source-arena --map <file>`.
- **`--first-playable` cannot show Frost.** Its 48 x 40 map has 4 Frost tiles and 4 Sentenced tiles. All region work is tested on the seed map.
- **Sprite "heights" are scale factors, not heights.** Visible heights at the 1.15 scale range from 41 to 72 sim units, so the archetype table was measured from the opaque pixel bounds of the actual frames.
- **Vertical scale is 41 sim units per Unity unit, not 32.** The ground is drawn squashed by 0.78.
- **Arrows stop at the first *enemy* body.** Allies never block each other's shots; that existing behaviour is kept.
- **Almost all of the "unmerged" UI branches are already in `optimization_port`** as re-committed copies, including the navy-glass styling. The skin job is stripping it out, not avoiding it.
- **`showcase-profile.cjs` asserts protocol 11** and will not run against protocol 14 or 16 until updated (workstream G).
- **`build-web.sh` was broken** by a change in the `unity` CLI's output format. Fixed (one line).
- **Environment:** `cargo` and `dotnet` are not on the default PATH; port 7777 is held by an older server (PID 63281) and an older Editor (PID 9075) is open on `RogueHalla-unity-art`. I left both alone and use port 7787.

### Baseline (before any change)

| Check | Result |
|---|---|
| `cargo test --workspace` (with Postgres) | 2,096 passed, 0 failed |
| `cargo run -p rh-parity --bin parity-report` | 109 scenarios + 13 capture-only + 300 pathfinding queries, all MATCH |
| `dotnet test client-unity/RoguehallaNet.Tests` | 956 passed, 0 failed |
| `node tools/browser-proof/proof.mjs` | PASS |
| WebGL build | succeeds; 102 MB uncompressed (WASM 58.6 MB, data 47.9 MB) |
| Display | 2560 x 1440 at 144 Hz confirmed |
| Unity EditMode tests on unmodified code | running; result recorded in the state file |

Baseline screenshots from the built client against the full map: [menu](../rework/evidence/gate1/baseline-menu.jpg), [planning](../rework/evidence/gate1/baseline-planning.jpg), [in match at a Frost spawn](../rework/evidence/gate1/baseline-match-frost-spawn.jpg). The match view is the "before" picture: one grey brick ground everywhere, no region identity, navy panels.

Not measured yet: frame time and input-to-motion delay in the browser. The profiler needs its protocol update first, and the input-latency hook exists only on the controls branch. Both are Gate 2 items.

### Controls audit ([full audit](../rework/CONTROLS_AUDIT.md))

Derived from code, not yet measured: key press to local sprite movement is about 17 to 33 ms at 60 fps (prediction is on); other players see you after about 72 ms on LAN.

| # | Finding | Status |
|---|---|---|
| 1 | WASD sends a move order to a point 64 units ahead without checking it is reachable, so you cannot slide along walls and may path around a thin wall. | Fixed on `rework/controls` (legacy `keyboardMoveGoal` ported). |
| 2 | Backward walk plays the forward cycle. | Fixed: animation chosen from the movement/facing angle; over 112.5 degrees plays the walk reversed. |
| 3 | Shooting while walking rubber-bands (see decision 7). | Proposal written. |
| 4 | Camera had no smoothing and updated after input was read, skewing aim by a frame. | Fixed: follow runs first, 35 ms smoothing as in legacy. |
| 5 | Right-click hold did nothing after the first press; own swing animation waited a round trip; Stop could be dropped silently. | Fixed on the branch. |

The branch passes 987 C# tests (31 new). It has not been played in a browser yet.

### Hitbox and projectile design ([ADR 0024](../adr/0024-hitbox-archetypes.md))

- **Foot box:** 10 x 6 half-extents for every archetype. It fits inside the old 12-unit circle, so every check that keeps the 12-unit value (spawns, placement, bot ranges) remains safe.
- **Body boxes**, measured from the sprites (sim units):

| Look | Half-width | Height | Chest |
|---|---|---|---|
| hero | 16 | 65 | 30 |
| hero_female | 15 | 68 | 33 |
| mage | 17 | 53 | 25 |
| mage_female | 17 | 55 | 27 |
| knight | 18 | 72 | 35 |
| goblin | 17 | 41 | 19 |
| skeleton | 18 | 71 | 31 |
| goblin_elite | 13 | 34 | 16 |
| antlion | 20 | 29 | 11 |
| skeleton_archer | 14 | 45 | 21 |
| skeleton_mage | 14 | 44 | 21 |
| zombie | 9 | 42 | 21 |

- **Mob mapping** moves from Unity into Rust; Unity picks the sprite from the archetype key it receives.
- **Homing shots** steer for the target's body centre, otherwise they would circle short targets.
- **Version bumps:** protocol 14 to 16, observation 21 to 22, checkpoint 29 to 30, replay 23 to 24, policy contract 15 to 16.
- **Fixtures:** new `v16.json`, `archetypes_v1.json`, `pathfinding_v2.json`, `server_walk_v2.json`. No existing fixture changes; the v1 prediction vectors stay as the circle oracle. The exact list of changed files will be attached at Gate 3.

Implementation is in progress on `rework/hitbox`.

### Palette ([PALETTE.md](../art/PALETTE.md), data in `docs/art/palette.json`)

Defined in OKLCH, descended from the legacy theme (every hue within 30 degrees of its legacy source). `node tools/art/palette-check.cjs` passes 396 of 396 checks: sRGB gamut, WCAG contrast (lowest body-text pair 4.64:1), and colour-blind and grayscale distance for all ten faction pairs.

| Region | Ground | Structures and foliage | Accent | Light |
|---|---|---|---|---|
| Fire | dark basalt | purple obsidian | lava orange | warm ember key, crimson shadow |
| Sentenced | straw, low chroma | barn-wood brown | violet banners | amber dusk, lavender shadow |
| Plague | moss teal | deep fern green | toxic lime | green key, teal shadow |
| Frost | snow blue | glacier-blue rock | deep glacial blue | cold white key, violet shadow |
| Holy | sand | oasis green | gold | golden key, plum shadow |
| Coliseum | limestone | shadowed stone, timber | burgundy | neutral |

Two margins are tight and need an in-game look: Fire against Plague under deuteranopia (0.075 against a 0.07 limit) and Plague against Frost in grayscale (0.053 against 0.05). Frost's accent is pale, so Frost leans on its crystal icon more than the others lean on theirs. The checks are numeric; nothing has been rendered in Unity yet.

### Assets and licences ([ledger](../art/LICENCE_LEDGER.md), [sourcing](../art/ASSET_SOURCING.md))

- 353 third-party files are inventoried. All Flare art, the atlases derived from it and 12 Flare audio clips are CC BY-SA and flagged replace-later.
- **Licence notices missing from the build:** Cinzel's OFL text and all Flare credit files. These will be added to `build-web.sh`.
- **Unverified:** the EmojiOne sprite sheet that ships as the TextMesh Pro default. I plan to remove it from the build unless its licence can be confirmed.
- **Free picks to audition:** CC0 and CC BY music for Frost, Holy, Plague and the menu; CC0 lava and desert-wind loops; Kenney isometric landscape and block sets and a CC0 isometric plant pack; Nunito (OFL) for body text beside Cinzel.
- **Gap:** no free lava or snow ground was found, so those start as tinted or procedural ground.

### HUD and UI ([layout spec](../rework/LEGACY_LAYOUT.md), [triage](../rework/UI_TRIAGE.md))

The current Unity HUD departs from legacy in most places: health bar bottom-left where legacy has it top-left; build HUD about 384 x 216 against 224 x 70 with 8 cells where legacy has 9; minimap 108 px from the right edge where legacy has 12; weapon bar 427 px wide against 284 and missing the swap chip, Wish tile and consumables row; champion combat HUD missing; settings and help as large centred modals where legacy uses a 320 px card and a 560 px tabbed card; no death line or edge-threat glows.

The rebuild on `rework/hud` lays out at the legacy 1280 x 800 reference with the legacy scale formula, so one canvas unit is one legacy CSS pixel, and routes every colour and font through one theme object so the palette drops in.

From the unmerged branches I am taking only the minimap mouse-capture fix and test, the tabbed help guide (restyled), the hub avatar size fix and a few logic files. One triaged commit adds a file under `packages/`; that file is skipped.

### Phase plan

1. **Now, in parallel:** Rust hitboxes and protocol 16 (`rework/hitbox`); controls fixes (`rework/controls`, done, awaiting merge); HUD layout and theme seam (`rework/hud`).
2. **After those merge:** C# foot-box prediction and Unity chest aim, projectile height and sprite-from-archetype; Opus review of all `rh-sim` changes; headless balance run, then the live switch.
3. **In parallel with 2:** region ground from the existing region plane (Frost first); lighting and snow particles on the existing light and post-processing setup; placeholder music per region; the Ultra preset and the profiler's protocol update.
4. **Gate 2:** Frost slice playable in the browser with screenshots, an input-delay measurement and a frame-time log at 2560 x 1440 and 144 Hz.
5. **Then:** the other four regions, hub and remaining screens, audio pass, performance report, Gate 3.

---

## Gate 2: vertical slice (2026-11-10)

Report-and-continue. The slice is playable in the browser from one merged branch (`feature/unity-rework`, still unmerged and unpushed) with fixed controls, the new hitboxes live, the legacy-layout HUD in the new skin, and all five zones lit, not only Frost. Work continues on the items listed at the end. Purchases requested: none. Running total: $0 of $100 / $150.

### Decisions and facts that need your attention

| # | Item | What I did | Change it by |
|---|---|---|---|
| 1 | **New hitboxes are the live default.** | You approved this as an accepted risk. Parity tests still run the old circle and all match. | Saying "back to legacy by default"; `--hitboxes legacy` already exists. |
| 2 | **Three hitbox rulings, which you accepted.** | Melee cannot hit a target behind the attacker; a point-blank shot that starts inside someone's body box uses the old ground rule; all players share one chest height (30 units) so a shot's height does not give away the shooter's faction. | n/a (recorded in ADR 0024). |
| 3 | **Known edge cases when two characters overlap.** | Two rules meet at the edge of a body box, so a melee hit can flip over about 2 units (a target 34 units to the side misses, 36 hits) and a point-blank shot flips once along its flight line. Recorded in ADR 0024, changes 14 and 15. | Asking for a single blended rule; it needs design work. |
| 4 | **No balance harness exists.** | The harness the project rules call for (P-BALANCE-1) was never written, so duel outcomes and time-to-kill per faction are unmeasured. The comparison below is from 40 bot matches per mode. | Commissioning the harness. |
| 5 | **Plague fails your 3:1 contrast rule in my captures.** | A Plague character on Plague grass measured 2.8 to 2.9:1 at the silhouette edge (the rule is 3:1). Every other zone I captured passed (5.8 to 9.6). You ruled out faction-coloured outlines, so this stays open until ground tuning fixes it. The contrast lab that measures every character on every surface is still being built. | n/a (open). |
| 6 | **Performance on the merged build is not measured.** | Six agents were building at once, so any frame-time number taken now would be meaningless. The only numbers are the pre-rework baseline from Gate 1 work. | n/a (scheduled when the machine is idle). |
| 7 | **Mobs still pop out of sight.** | Players fade out and in. Mobs do not, because the server gives each mob a new identity almost every update. | n/a (follow-up: match mobs by position on the client). |
| 8 | **Audio defects found.** | The client requests the Fire and coliseum tracks at match start whatever zone you spawn in, and the music code floods the console with audio warnings in some runs. Nobody has listened to any track. | n/a (fix scheduled). |
| 9 | **Backend still lacks the second crash fix.** | `optimization_port` has only my first patch. Commit `a1f1d129` (with tests in `406279b3`) is needed there before any launch. Details in `docs/coordination/CLAUDE_UNITY_REWORK_HANDBACK.md`. | n/a (for Codex). |

### What is in the slice

- **Controls:** WASD slides along walls, the backward walk plays reversed, the camera follows before input is read, right-click hold re-issues the move, the swing animation starts on click.
- **Hitboxes (ADR 0024):** foot box for walls, body box for hits, projectiles simulated from the chest, archetype table and vision settings delivered in the protocol 16 welcome message. The client predicts with the foot box and aims from the chest.
- **HUD and screens:** in-match HUD at the legacy layout, Tab map with zone tint and right-click to walk, launch screen and hub.
- **Zones:** Frost (snow, pines, translucent lake ice, long shadows, snowfall), Fire (dark basalt lit by lava), Sentenced (charcoal square tiles, wrought-iron fences, tombstones, lanterns), Plague (mud, deep grass, shallow water distinct from bog, light shafts), Holy (one temple interior on the pillar hall, sand outside), Coliseum (props).
- **Lighting:** one sun whose colour and strength grade by position, cast shadows, a passive light floor in every zone, lights and shadows only where the camera looks.
- **Vision:** fog of war that mirrors the Rust sight rule, and fades for players entering and leaving sight.
- **Wishes:** all five animated from server data.
- **Audio:** music and ambience per zone, loaded after the match starts.
- **Server fix:** the two room-killing panics found during this work.

### Verification on the merged branch

| Check | Result |
|---|---|
| `cargo test --workspace` (with Postgres) | 2,136 passed, 0 failed |
| `cargo run -p rh-parity --bin parity-report` | 109 scenarios + 13 capture-only + 300 pathfinding queries, all MATCH |
| `cargo clippy --workspace --all-targets --all-features` | clean |
| `dotnet test client-unity/RoguehallaNet.Tests` | 1,096 passed, 0 failed |
| JS decoder against `v16.json` | agrees (65 server vectors, 220 malformed, 24 chains) |
| `node tools/browser-proof/proof.mjs` | PASS |
| Unity EditMode | 444 of 444 |
| `rh-server` tests after the live-default switch | 225 of 225 |
| WebGL build | succeeds; 112.6 MB raw, 57.2 MB compressed against the 150 MB budget |

Run before the live-default switch and the vision-settings hookup except where stated; the switch changed one constant and three tests, and the hookup changed C# only (its own run: 1,096 C# and 444 EditMode). The full suite will be re-run on the final tree.

Browser checks by me on this build (headed Chromium, 1920 x 1080, High): all five zones entered; no room crash; hitbox overlay boxes sit on the sprites; minimap fog visible. Not yet done by me: a 2560 x 1440 pass, input-delay measurement, and listening to audio (not possible).

### Hitbox numbers

Client, archetype server against `--hitboxes legacy` (from the client agent's browser runs):

| | New boxes | Old circle |
|---|---|---|
| Feet stop this far from a wall | 6 units | 12 to 20 units |
| Server corrections over 0.5 units | 125 of 1,855 samples | 148 of 1,700 |
| Largest correction | 9.8 units | 36.6 units |
| Hard snaps | 0 | 0 |

The client's foot-box pathfinding agrees with all 300 Rust-generated queries and the three wall walks. Chest aim: the flight line passes within 0.08 units of the cursor.

Bots, 40 matches per mode, same seeds (old to new): bot bow hit rate 54% to 60%; mob bow 84% to 92%; mob wand 34% to 49%; bot sword 91% to 93%; bot axe 92% to 98%; player deaths 269 to 270; mob deaths 819 to 758; average match 4,196 to 4,326 ticks.

### Brightness and contrast in my captures of this build

| Zone | Mean brightness | Near-white pixels | Character edge | Health bar |
|---|---|---|---|---|
| Holy (temple) | 0.52 | 0.04% | 6.1 to 8.2 | 7.9 to 8.1 |
| Frost | 0.59 to 0.62 | 0.04 to 0.3% | 8.7 to 9.2 | 9.3 to 9.7 |
| Plague | 0.22 to 0.24 | 0.03% | **2.8 to 7.5** | 4.7 to 7.6 |
| Fire | 0.19 to 0.28 | 0.04 to 0.09% | 5.8 to 8.0 | 5.2 to 7.8 |
| Sentenced | 0.13 to 0.15 | 0.04% | 8.8 to 9.6 | 9.6 to 10.8 |

One character per capture, so this is a spot check, not the gate.

### Screenshots (this build)

[Frost](../rework/evidence/gate2/slice-frost.jpg), [Holy temple](../rework/evidence/gate2/slice-holy-temple.jpg), [Plague](../rework/evidence/gate2/slice-plague.jpg), [Fire with hitbox overlay](../rework/evidence/gate2/slice-fire-hitbox-overlay.jpg), [Sentenced with hitbox overlay](../rework/evidence/gate2/slice-sentenced-hitbox-overlay.jpg). Per-pass evidence: `docs/rework/evidence/` (`hud`, `launch`, `atmosphere`, `regions2`, `regions3`, `vision`, `wish`, `hitbox`).

### Frame-time log

Not available for this build (see item 6). The pre-rework baseline, display verified at 2560 x 1440 and 144 Hz: High and Ultra both p50 6.90 ms, p95 7.50 ms, p99 7.80 ms, worst 1% at 127.8 fps, 0 dropped frames. The pass rule I proposed (95th percentile at or under 6.94 ms) cannot be met under vsync because browser frame timestamps jitter about 1.5 ms around the interval; I will judge pacing by dropped frames at 144 Hz plus an uncapped headroom measurement, unless you prefer otherwise.

### Still to do before Gate 3

In progress: the rendering-features pass (Breath of the Wild reference); footprints with 10-second tracks, ripples and footstep sounds; the contrast lab; the final UI pass against legacy with the weapon hit-zone indicator; mob spacing and the weapon table in Rust (then an independent review).

Queued: contrast tuning until the gate passes; station panels, results, chest and trader screens in the skin; audio fixes; mob fades; ranged-pause prediction; performance at 2560 x 1440 with an Opus efficiency pass before anything is cut; MIGRATION and CONTRACTS status rows (held until the backend merge to avoid conflicts); merging `optimization_port` in and re-verifying; the Gate 3 report; the Opus final review.
