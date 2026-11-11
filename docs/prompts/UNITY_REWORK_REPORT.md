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

### Gate 2 addendum (2026-11-10, later): the contrast picture is worse than item 5 says

The contrast lab landed after this report. It measures the outermost 2 pixels of each character's drawn silhouette against the ground around it, for every character and mob on every surface in every zone. On its baseline (older art, before the latest zone passes) **no case out of 2,808 reached 3:1**; the median was 1.14. The figures in the table above (2.8 to 9.6) came from a looser spot-check statistic that picks the darkest or lightest pixels inside the character, so they overstated readability and should not be read as the gate.

Cause: characters have no real outline. On dark ground a dark outline cannot exceed about 2:1, and on pale ground a half-transparent pale halo covers the dark outline.

Fix under way (`rework/contrast`): an opaque neutral outline whose colour is chosen against the ground behind it, black on bright ground and white on dark ground. One of the two always gives at least about 4.5:1 on any ground, so the landscape does not have to change. Faction-coloured outlines are not used. The gate tool must exit clean on the full matrix before Gate 3.

## Gate 3: complete (2026-11-11)

Branch `feature/unity-rework`, verified at `b43e19f5` (the polish pass merges after this and is recorded in the addendum below). Nothing has been
pushed. `optimization_port` and `main` have not been moved. `packages/` is untouched.

### Decisions and facts that need your attention

1. **The 3:1 contrast gate is not met, by your decision.** You ruled out the line outline ("a lot of visual artifacts", then "lets have no outline
   for now") and accepted the risk. Strict edge contrast at 1080p High: 62 of 931 cases pass with no outline (428 with the thin outline, 251 with
   the inner rim). Body contrast is fine on snow and the temple floor (medians 6.9 and 4.4) and poor on dark ground (about 1.4 in Fire, Sentenced
   and Plague). Both variants stay available behind `?fx.outline=1` and `?fx.rim=1`. Numbers and captures: [CONTRAST_GATE.md](../rework/CONTRAST_GATE.md),
   [evidence](../rework/evidence/contrast/README.md).
2. **Hit boxes differ by faction, and the refit widened the gap.** Boxes follow the sprite of the look, and looks are fixed per faction. After
   stripping the baked shadow and refitting widths, body half-width by faction is Fire and Sentenced 17, Plague 16, Holy 14, Frost 13; half-height
   is 35 for Fire, Sentenced and Frost and 28 for Plague and Holy. The largest box (Fire, Sentenced) has about a third more area than the smallest
   (Holy). This is live. It follows your rule that the hit box matches the sprite, but it is a balance asymmetry in a competitive game; a single
   player box for all factions would remove it. Not changed without your say.
3. **Lighting flicker and lights switching off: parked by you.** Leading explanation, not confirmed: the default automatic quality mode steps
   down when frames are missed on an overloaded machine (20, 12, 6 then 0 local lights). `?quality=ultra` pins the quality. Unfinished experiments
   are on branch `rework/flicker`, unmerged.
4. **Bots stand on the player** and read as a doubled character; you deferred a bot stand-off to a later cycle. The hit-box review also found a
   bot loop (one seed: bots swinging at targets far beyond reach), a bot-policy defect for the backend backlog.
5. **The roster names every seated player** (as legacy did), including players you cannot see. This widens the observation contract on purpose and
   needs your wording in CONTRACTS.
6. **Browser reach.** The build targets newer WebAssembly features for speed: Chrome and Edge 95, Firefox 100, Safari 16.4 or newer. Only Chromium was
   run. `RH_WEB_WASM2023=0` builds for older browsers. You chose Chrome for now.
7. **Second-tier indicators are deferred** (camp badges, wards, patience outline, quest carrier flag, champion HUD attack and passive numbers, own mob
   bonuses). The HUD shows only what the server delivers.
8. **Deviations awaiting your sign-off:** DEV-009 (hit boxes), DEV-010 (shots at chest height), DEV-011 (mob spacing), DEV-012 (build marks omit the
   unported Holy camp-lifesteal term).
9. **Repository size.** The branch history holds old screenshot blobs and the backend union adds about 84 MB of files (mostly evidence and parity
   fixtures). Squash when merging into `optimization_port`.
10. **Process files.** Another session rewrote `CLAUDE.md` and `AGENTS.md` and added `.claude/agents/`, `docs/agent/` and nested instruction files in
    this checkout. They are uncommitted and not part of this branch.

### What was delivered

- **Controls and feel:** WASD and mouse aim kept; the client now mirrors the server's own attack pause (wand from the server's wind-up event, bow from
  two values the server already sends). Browser pull-back per shot: bow 34.0 u to a median of 0, wand 34.2 u to 0.17
  ([note](../rework/RANGED_PAUSE_PREDICTION.md), ADR 0008 amendment).
- **Hit boxes (ADR 0024):** foot box for walls, body box for hits, shots at chest height, live by default (`--hitboxes legacy` restores the disc;
  parity runs the disc and is unchanged). Widths refitted to the shadow-free sprites (change 23).
- **Mob spacing:** packs of any size come to rest without stacking where room exists; chasing packs fan out. Stacked-while-engaged share on the full
  map: 15.3% to 4.6%.
- **Fog of war and vision:** aligned with the server's rule; fighters and creatures fade at the edge instead of popping.
- **Zones:** Holy is one temple interior with sand outside; Sentenced gothic flagstone with lanterns; Plague dark greens with walkable water and bog;
  Frost white sun with translucent ice; Fire lit by lava. One sun whose colour and strength grade across zones; baked wall shadows, light cookies,
  wind, cloud shadows, water caustics, fireflies, embers ([render evidence](../rework/evidence/render/README.md)).
- **Characters:** no outline, no ghost copies, baked ground shadow stripped from all 12 actor atlases, our own contact and cast shadows from the one
  sun.
- **Combat readability:** weapon hit-zone drawn from the server's weapon table; wind-up telegraph for creature attacks and wand casts; projectile
  trails, impact sparks, Wish effects with light.
- **HUD and UI in the legacy layout and new skin:** launch screen, planning, in-match HUD, Tab map with zone tint and right-click-to-walk, chest
  panel, traders, quest journal, hunt picker, results card, hub panels; overhead indicators incl. names, off-hand weapon, top-two stats, Wish
  ready, mark plate, statuses, elites, bounty, crit and heal numbers; credits page. An indicator gallery (`?uilab=1`) shows every row on dark,
  bright and snow ground ([verification](../rework/UI_VERIFICATION.md)).
- **Audio:** per-zone music and ambience with crossfades, footsteps per surface, levels evened; measured by a browser probe
  ([evidence](../rework/evidence/audio/README.md)).
- **Surface effects:** footprints in sand and snow for 10 seconds, ripples in water and bog.
- **Backend union:** the finished backend (quests, cards, private bot Brain not wired to live bots, host bundle packager) is merged in.

### Verification on the final tree (`b43e19f5`)

| Check | Result |
|---|---|
| `cargo test --workspace` with Postgres | 2,508 passed, 0 failed, 21 ignored |
| `parity-report` | 109 slice scenarios + 13 capture-only, 300 pathfinding queries: all MATCH |
| `cargo clippy --all-targets --all-features -D warnings`, `cargo fmt --check` | clean |
| Fixtures regenerated (`protocol-fixtures`, `hitbox-fixtures`) | no diff |
| `dotnet test client-unity/RoguehallaNet.Tests` | 1,311 passed |
| JS: `check-vectors`, `check-first-playable`, reload-proof tests | v16 agrees (54,205 checks); 66 checks; 33 of 33 |
| Browser proof (`tools/browser-proof/proof.mjs`) | PASS |
| Palette check | 396 of 396 |
| Unity EditMode | 592 of 592 at `6e51235f`; re-run after the polish merge (addendum) |
| WebGL build | builds with no shader errors; 53.7 MB compressed (limit 150 MB) |
| Real matches in the browser, all five factions, Ultra | start, play, correct music per zone, console clean |

Identities: protocol 16, observation 24, `rh-checkpoint/31`, `rh-replay/25`, policy 18, content hash `7d2d84b827af3ddc`.

### Performance ([full report](../rework/PERF_REPORT.md))

Ultra at 2560x1440 with vsync on, on the 144 Hz display: 0% dropped frames in all 18 measured windows (six zones, standing, walking, map), 1% lows
115 to 120 fps. Each window is 4 to 6 seconds and the machine was busy with other builds, so vsync-off headroom (medians 3.4 to 6.7 ms) is an upper
bound; Frost and Holy are GPU bound and have the least headroom. Fixes kept every effect: the release code-optimisation setting, a per-frame resource
load, creatures drawn twice, lights sorted and culled to the view, damage numbers no longer rebuilding text every frame. Not measured: an idle
machine, Firefox, Safari, a multi-minute full-crowd match.

### Rust, protocol and fixture changes made by the Unity rework (for review)

| Change | Where | Record | Independent review |
|---|---|---|---|
| Room-killing crashes (attack list out of bounds; ledger victim slots shifting when a zombie is removed mid-pass) | `rh-sim` weapons, ledger; soak test in `rh-headless` | commits `a1f1d129`, `406279b3` | Opus: correct |
| Hit-box archetypes, foot and body boxes, projectile height, live default | `rh-sim` `archetype.rs`, movement, walk, pathfind, melee, projectiles, checkpoint, observe; `rh-server` runtime, `--hitboxes`; protocol 16 Welcome table | ADR 0024, DEV-009, DEV-010; `archetypes_v1.json`, `pathfinding_v2.json`, `server_walk_v2.json`, `v16.json` | Opus: land after fixes, fixes done |
| Vision parameters in Welcome | `rh-protocol`, `rh-server`; test-only `vision/golden.rs` | `sight_v1.json` | covered by the final review |
| Mob spacing and the Welcome weapon table | `rh-sim` `systems/mob_spacing.rs`, `mob_ai.rs`, `SimConfig::mob_spacing`; `rh-server` wire | ADR 0024 addendum, DEV-011 | Opus twice: land |
| Legacy indicator facts on protocol 16 (append-only) | `rh-sim` observe, events, kill augments, `fx_report.rs`; `rh-protocol`; `rh-policy` delivery; C# and JS decoders | ADR 0026, DEV-012; `v16.json`, `parity/build-marks/legacy.json` | Opus twice: land |
| Review follow-ups (tests, a debug assertion, comments) | `rh-sim`, `rh-policy` | commit `0fb8d3f4` | coordinator read the diff: no behaviour change |
| Attack-pause prediction vectors (no sim or wire change) | `rh-parity` test; `ranged_pause_v2.json` | ADR 0008 amendment | covered by the final review |
| Body half-widths refitted to the shadow-free sprites | `rh-sim` `archetype.rs` (ten values) | ADR 0024 change 23; content hash `7d2d84b827af3ddc` | Opus: land after doc fixes, done |
| JS tools repinned to protocol 16 | `tools/protocol-js`, `tools/unity-browser-reload-proof`, `probe.html` marker | `docs/MIGRATION.md` | none needed |

The backend union's own changes were reviewed in its lane ([evidence](../evidence/backend-unity-union/README.md)).

### Not done, and known defects

- Contrast gate not met (item 1). Faction box asymmetry (item 2). Lighting flicker parked (item 3). Bots overlap the player (item 4).
- Never seen on screen in a real match: a critical-hit number and a wind-up telegraph frame (both verified in the gallery and by tests).
- Performance proposals in the character-drawing code (look caching, change-guarded renderer writes, overhead text fades) are not implemented; they
  are not needed for 144 Hz on this machine and would help weaker ones.
- `client-unity/UnityProject/Tools/profile-hub14.cjs` still looks for the old probe marker; `tools/hitbox-measure/measure.mjs --check` encodes the
  older fitting rule and fails.
- No purchased assets were used or requested (CAD 0).

### Launch

Target: https://play.rougehalla.com on the repository's only deploy path, a disposable single AWS host (ca-west-1) with a hard expiry of at most 12
hours and no persistence, about CAD 10 (you accepted this on 2026-11-11). Order: polish merge, Opus final review of the combined tree, Linux server
binary and bundle built from that exact commit, local dry run, your AWS login and go-ahead for the AWS commands, Cloudflare A record (DNS-only) by
you, live check. The runbook is in [UNITY_REWORK_STATE.md](UNITY_REWORK_STATE.md).
