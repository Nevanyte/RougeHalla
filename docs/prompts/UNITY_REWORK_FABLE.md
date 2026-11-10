# Fable prompt: Unity client rework ("bring Roguehalla to life")

Owner direction recorded 2026-11-09, revised the same day after a fact-check of the codebase and a second decision round, and again during the run (lighting by zone, gothic Sentenced, Holy temple, launch screen in scope, Tab map and minimap). Paste everything below the line into the Fable agent. Nothing above it is part of the prompt.

---

You are the coordinator for the Roguehalla Unity rework. Work in `/Users/nevinmckinnon/Documents/Projects/RogueHalla` on branch `optimization_port`. Read `CLAUDE.md`, `docs/MIGRATION.md`, `docs/ORDER_OF_OPERATIONS.md`, `docs/CONTRACTS.md`, `docs/VISUAL_DIRECTION.md`, `docs/art/CURRENT_ASSET_STATUS.md`, `docs/art/PERFORMANCE.md`, `docs/art/PALETTE.md`, `client-unity/README.md`, and `docs/adr/` (especially 0007, 0008, 0009, 0011, 0012) before you plan. Where this prompt and a document disagree, this prompt is the owner's current direction for this effort, except where it is flagged below as a conflict you must record rather than silently resolve.

## 1. Goal

The Rust server is nearly complete. The Unity browser client is far behind the legacy game in feel and polish. Make the Unity client a lively, bright, modern-fantasy game with a distinct look and sound per region, controls that feel right, and a HUD that matches the legacy layout. Done means: the owner opens the Unity WebGL build, enters a match, and sees and hears the five-region look (art, lighting, particles, music) with fixed controls and hitboxes and the legacy HUD layout, running real Rust gameplay at the performance target in section 4.

Out of scope:
- Quests and bot quality (both get a full rework next update). The quest panel is re-skinned in its legacy position but not reworked. For playtesting, fill matches using only the options that already exist (`--fill-bots N`, `--min-players N`, `--fill-seconds S`, `--lobby-seconds S`, `--first-playable`, `--runtime core|source-arena|training`). Add no bot work unless a bot fix is a one-liner.
- Gamepad, touch and key rebinding. Controls work covers keyboard and mouse only.
- Body blocking between characters. Characters walk through each other today and continue to.
- New character or mob art. The current character and mob sprites are frozen for this effort (section 4, Assets).
- Weapon hit shapes. Weapons are not hitboxes: do not redesign melee arcs or ranges.

## 2. Authority and hard rules

- You are the coordinator for this effort. You may edit the shared status records (MIGRATION checkpoint, CONTRACTS status table), `Cargo.lock`, and `docs/ORDER_OF_OPERATIONS.md` (add this rework as a new owner direction: Unity visuals and feel first; Rust frozen except the hitbox, projectile-height and archetype changes in section 4). Write ADRs for decisions (next number after the highest existing).
- The legacy game in `packages/` is READ-ONLY. You may read it and copy or port functions out of it into the Rust or Unity code. You may not edit any file under `packages/`. Before every commit run `git diff --stat -- packages/` and confirm it is empty.
- Commit to a feature branch cut from `optimization_port`. Never push. Never merge to `main` or `optimization_port`. Merging happens only after Gate 3 approval. The GitHub repository is public, which is why the purchased-asset rule in section 4 exists.
- Keep every non-negotiable in `CLAUDE.md`: Unity has no game rules (only the narrow, Rust-mirrored movement prediction); `rh-sim` stays pure, fixed 20 Hz, legacy tick order never reordered; all actors act through `validate` + `Sim::submit`; observations never leak hidden state; every ported mechanic keeps fixtures and a parity test; wire changes bump `PROTOCOL_VERSION` and regenerate `protocol/fixtures/v<N>.json` (`cargo run -p rh-protocol --bin protocol-fixtures`) and the Rust, C# and JS decoders must all pass; no ML, models, datasets, Python bindings or inference services.
- Do not touch git worktrees outside `/Users/nevinmckinnon/Documents/Projects/`. Existing unmerged worktrees live in `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/`. Do not delete any of them; read them only.
- Unity Editor: the owner is not using it during this run. You and your sub-agents may open and quit Unity from the terminal as often as needed (batch-mode builds need the Editor closed for that project copy; some checks need it open). Coordinate it: at most one Unity process per project copy (each worktree has its own copy and lock); a sub-agent quits only the Unity process it started; before a batch build, confirm no Unity process holds that copy. Record who holds which copy in the state file (section 6).
- Treat the facts in section 3 as a survey that may be stale or wrong. Verify each one against the code before relying on it, and say in your Gate 1 report where reality differed.

## 3. Starting facts (surveyed 2026-11-09; verify first)

**Engine and rendering.** Unity 6000.0.85f2 with WebGL support, `unity` CLI on PATH. URP 17.0.4 with the 2D Renderer, HDR on. Lighting and post-processing already exist, built in code: `Scripts/View/ArenaView.cs` adds a global `Light2D` and a global `Volume` (colour adjustments, tonemapping, bloom from `Resources/Showcase/Atmosphere.asset`); point-light torch prefabs exist (`Scripts/Presentation/ShowcasePointLight.cs`). Quality presets already exist in `Scripts/Presentation/ShowcaseSettings.cs`: Low, Medium, High, plus Adaptive/Manual. There is no Ultra. Extend these; do not build a parallel system.

**Build.** `client-unity/UnityProject/Tools/build-web.sh` runs a batch-mode WebGL build. It first fetches `contentHash` from a running rh-server (`RH_SERVER_INFO_URL`, default `127.0.0.1:7777/info`), so a server must be up, and the Editor must be closed for that project copy. CI has no Unity build. Last recorded size: about 54.3 MB compressed (WASM 16.4 MB + data 37.9 MB gzipped), 106.5 MB decoded.

**Proof tooling.** `tools/browser-proof/proof.mjs` does NOT load Unity: it drives the protocol probe page headless, takes no screenshots and measures no frame times. Keep running it as the protocol check. The Unity tools are in `client-unity/UnityProject/Tools/`: `showcase-profile.cjs` (headed, 2560 x 1440, fullscreen option, logs frame-time percentiles and GPU ms, takes screenshots, has a vsync-off diagnostic mode), plus `profile-web.cjs`, `profile-m5-b.cjs`, `profile-hub14.cjs`. Use `showcase-profile.cjs` or extend it for screenshots and frame-time logs.

**Display.** `docs/art/PERFORMANCE.md` records an earlier capture on a 1920 x 1080, 60 Hz display and says the 144 fps gate "remains incomplete". The owner states a 2560 x 1440, 144 Hz monitor is connected now. Confirm the actual refresh rate before any performance measurement (section 4, Performance).

**Assets.** `client-unity/UnityProject/Assets/Art/` holds about 176 PNGs, 32 OGGs and 3,008 character frames (Flare-based, mixed CC BY-SA 3.0 / CC BY 3.0 / CC0; `client-unity/THIRD_PARTY_ASSETS.md`, which covers only Flare and omits fonts). Props, five biome floor studies and four terrain-effect studies exist but are not placed in the game. Only two music tracks and one ambience loop exist, with no per-region music. Particles are procedural (`Scripts/Presentation/AssetReadinessEffects.cs`, `docs/art/PARTICLE_KIT.md`). The branch `codex/unity-frozen4-editor-idle` (worktree `RogueHalla-worktrees/unity-art`) has one unmerged commit with frozen VFX, biome props and ambience candidates.

**Characters.** The sprite catalog (`Assets/Resources/Showcase/Catalog.asset`, `Scripts/Presentation/ShowcaseCatalog.cs`) has 12 keys, but only five are player looks: `hero` (Fire, Sentenced), `mage` (Plague), `hero-female` (Frost), `mage-female` (Holy), `knight` (default/dummy, Idle only). The other seven are mob looks (`goblin`, `skeleton`, `mob-goblin-elite`, `mob-antlion`, `mob-skeleton-archer`, `mob-skeleton-mage`, `mob-zombie`). The sim has 30 mob types (`crates/rh-sim/.../mob_catalog/mod.rs`, six per region) sharing those looks; quest givers are entities drawn as a neutral silhouette. Sprites have 8 facing directions and the clips Idle, Walk, Attack, Block, Hit, Death, Cast, Shoot. There is no backward or strafe walk clip. Sprite heights come in three sizes: 1.15 world units (heroes, knight, goblin, skeleton), 0.894 (mages), 0.671 (other mobs), each multiplied by `ActorVisualScale` 1.2. Sprites are pivoted at the feet, and the feet sit on the sim position. `SpriteActorPresenter.cs` picks Walk whenever the actor moves and takes the direction from facing, which causes the backward-walk bug in section 4.

**Collision.** `PLAYER_RADIUS` = 12 u (`crates/rh-sim/src/constants.rs`), tile = 32 u, Unity scale 1/32. It is used in about 50 places across 29 files: wall movement (`movement.rs` into `terrain/walk.rs`), pathfinding, spawn/placement clearance, melee (`melee.rs`, `in_arc(..., PLAYER_RADIUS)`), projectiles (`projectiles.rs`, swept segment against the target point with reach `PLAYER_RADIUS` + `ARROW_RADIUS` or `RANGED_SLACK`), and AI range checks (`mob_ai.rs`, `bruiser.rs`, `signatures.rs`, `combat_policy.rs`, `cannons.rs`). There is no body blocking between actors. Each entity is a single point. Projectiles spawn at the owner's position.

**Prediction.** Unity prediction (`Assets/RoguehallaNet/Net/LocalMotion.cs`, `Pathfinder.cs`) walks an A* path planned with a hard-coded `PlayerRadius = 12.0`; it has no per-step collision. The Rust-generated vectors are `protocol/fixtures/pathfinding_v1.json` and `protocol/fixtures/server_walk_v1.json`, checked by `crates/rh-parity/tests/pnet1_goldens.rs` and by the C# tests in `client-unity/RoguehallaNet.Tests/`.

**Protocol.** `PROTOCOL_VERSION` = 14. `MapBlob` already carries an optional per-tile `regions` plane (values 0-6: 1-5 faction regions, 6 coliseum) and a `terrain` plane; the server sends them and the C# decoder exposes them, but no Unity gameplay script reads them. Per-region ground therefore needs Unity work, not a protocol change. The planes are present only for maps with layers; check whether the `--first-playable` map has them, and playtest on a map that does.

**UI.** uGUI + TextMeshPro, built in code (`Scripts/UI/MatchHud.cs`, 78 files in `Scripts/UI`), one scene `Assets/Scenes/Main.unity`. Current look is dark navy glass. Fonts: Liberation Sans (body) and Cinzel Decorative (four HUD headings), both SIL OFL; the build copies the Liberation notice but not the Cinzel one. Unmerged UI work: `codex/unity-ui-hub` (50 commits: hub, cosmetics, compact HUD, input/mouse-capture fixes), `codex/unity-ui-modernization` (14 commits: "mythic" HUD, Build drawer), `codex/unity-ui-acceptance` (8). A combined candidate failed 9 of 34 tests with a Build-drawer rendering defect (F-04).

**Controls.** `Scripts/Net/MatchClient.cs` `ReadInput`: WASD/arrows to an 8-way destination steer, cursor aim streamed every frame (from the local sim position to the cursor projected on the ground plane), left click attack, right click move, Shift + right click attack-move. Rust (`movement.rs`, `weapons.rs`) already separates facing (from aim, fresh for `AIM_STALE_MS` = 1000) from movement, so backward walking and strafing work server-side.

**Palette.** `docs/art/PALETTE.md` already exists as an accessibility-check record using `tools/art/palette-check.cjs` (CIELAB, Machado colour-blind simulation). Extend it; do not start over.

**Legacy layout.** CSS under `packages/client/src/ui/*.css` and `packages/client/src/hub/hubLayout.ts`: chrome buttons top-right, minimap bottom-right, weapon bar bottom-centre, champion HUD bottom-left, build HUD 256 px wide, plus chest, quest, trader, planning and settings panels. `docs/legacy/CLAUDE_LEGACY.md` and `docs/legacy/INVENTORY.md` are the legacy reference.

**Regions.** Fire (under the mountain, Scorch / Crater Basins, axes), Sentenced (haunted farmland, the Gallows, swords), Plague (forgotten city, the Warren, bows), Frost (frozen plains, the Rime / Mere ice lakes, shields), Holy (the desert, the Sanctum, wands). Map is 136 x 136 tiles around a central coliseum (`docs/GAME_DESIGN.md`, `docs/ZONE_SHAPES_AS_BUILT.md`).

## 4. Owner decisions (settled, do not re-ask)

**Theme and layout.** Keep the legacy layout and information hierarchy exactly (where HUD, minimap, weapon bar, chat and menus sit). Replace only the look: colour, art, fonts, lighting, music. Do not invent new layouts. The target feel is Legend-of-Zelda / modern fantasy: vibrant colour and beautiful lighting. The Sentenced region is the one deliberately muted zone. Holy (desert) and Plague (forgotten city) must both have plenty of nice greenery: Holy as oasis and garden pockets, Plague as overgrown, marshy ruins with a sickly teal-green mood. Frost: cold blue-white with light snow particles on screen.

**Lighting by zone (owner direction 2026-11-09, supersedes earlier notes).** The first region build was far too bright; overall luminance comes down, with restrained bloom and no blown-out areas. One sun with a fixed direction lights the whole map; its hue and brightness grade gradually by position as you cross a zone. Props, walls and characters cast shadows along it. Every zone keeps a subtle passive light floor so the vision system never depends on region effects, and lighting is only computed for what the camera sees. Brightness order, brightest first:
1. **Holy:** darker, richer sand with bright golden rays for contrast. A golden temple is generated over the dense square pillar zone: sand outside, mosque/cathedral-style architecture inside with decent even passive light. The temple footprint is found from the generated map: a roughly square area covering 35-70% of the Holy region, as the terrain allows.
2. **Frost:** bright white sun, crisp shadows; lake ice slightly translucent.
3. **Plague:** medium. Marshy, not dark and not bright, with plenty of light rays and green light filtering through the brush.
4. **Fire:** the darkest passive light, made brighter locally by lava that lights its surroundings.
5. **Sentenced:** the darkest zone, lit by lamps and torches. Gothic dungeon and graveyard: flagstone tiles, wrought-iron graveyard fences, gothic masonry, tombstones.
Other light-emitting terrain: glowing bogs in Plague, light zones in Holy.

**Zone tuning and readability (owner direction 2026-11-10).** Plague uses dark, deep greens, not light ones. Sentenced tiles are black or dark grey, not light grey. Every zone must give clear contrast between characters and the ground: a dark outline and light rim (or contact shadow) on actors, verified by measurement in each zone.

**Wishes.** Each of the five Wishes (Freeze, Swarm, Trial, Blaze Step, Last Stand) gets a full animation: caster animation and telegraph, the effect in the world at its true server-given extent, status visuals on those affected, an end effect, and an animated HUD Wish tile. Find CC0/CC BY assets or build them in code.

Screens by gate: the in-match HUD (chrome buttons, minimap, weapon bar, champion HUD, build HUD, settings), the Tab map and the launch screen are required for Gate 2. Chest, trader and remaining screens are required for Gate 3. The Tab map is held to the same standard as the HUD; the minimap and Tab map tint each zone with its hue; right-clicking a spot on either walks the character there. Chat and a kill feed are not built (legacy has neither). The quest panel is re-skinned in place only.

**Palette.** Choose palettes scientifically and record the research in `docs/art/PALETTE.md` (extend the existing doc and `tools/art/palette-check.cjs`). Method: define colours in a perceptual space (OKLCH), one palette per region on a 60/30/10 base/secondary/accent split, text contrast checked against WCAG, colour-blind simulation run, and faction identity carried by shape/icon and not hue alone (`docs/VISUAL_DIRECTION.md`). It must closely match the feel of the pre-port game's theme. The owner does not need to approve the palette; you do need the research and checks recorded.

**Assets.**
- Prefer human-made assets. Use minimal AI art, and only when needed for a demo.
- Allowed licences: CC0 and CC BY for art and audio; SIL OFL for fonts only; Unity Asset Store purchases. No other "royalty-free" or custom licences, including for music.
- Keep a licence ledger of every added file, and add the existing fonts to it. Ship every required licence notice in the build (the Cinzel OFL notice is currently missing).
- Existing CC BY-SA (Flare) assets may stay for now but are flagged in the ledger as a replace-later risk, and any new asset must not be derived from them.
- Character and mob sprites are frozen for this effort. Replace only environment, props, UI and effects that clash with the bright look; lighting and palette carry the brightness on characters.
- Free assets are committed to the repository. Purchased assets are never committed: they live in a git-ignored folder (suggest `client-unity/UnityProject/Assets/Licensed/`), and the ledger records pack name, version, store link and which files came from it. The project must build and run with that folder absent, falling back to a free placeholder.
- Purchases: you cannot buy anything. When a paid pack is justified, request it in a gate report with name, price, store link, what it replaces and why free options fell short. Build a free placeholder in the same slot first so the purchase is a drop-in swap, and keep working on everything else until the owner supplies it. No purchase ever blocks work. Budget across the whole effort: about $100 is comfortable; $150 is the absolute limit. Keep a running total in each gate report.
- Music: CC0 or CC BY placeholder tracks per region, swapped later. Audio must never block other work.

**Controls.** Keep WASD/arrows movement, mouse aim with the character facing the cursor, and the existing right-click move and attack-move. Start with an audit before changing anything: record what each input does, measure input-to-motion delay, and check whether prediction snaps the character back. Known bug: when the cursor is opposite the movement direction, the character plays the forward walk animation while moving backward. Fix: select the animation from the angle between movement and facing. No backward or strafe clips exist, so reverse the forward walk cycle. Do not create new art for this unless the reversed cycle looks wrong. Keep the Rust-mirrored prediction vectors green.

**Hitboxes (a Rust change, the owner's explicit direction).** The visual size must stop disagreeing with the hitbox. The hitbox follows the sprite, not the other way around. Replace the single circle with rectangles from a data-driven archetype table.
- A small axis-aligned FOOT box, anchored at the feet, used for walls only. Because the game is 2.5D, a character must be able to walk up to a wall without its head stopping it. Wall movement and pathfinding switch to the foot box in Rust and in the mirrored C# pathfinder; regenerate the prediction vectors.
- A full-height axis-aligned BODY box used for taking projectile and melee hits.
- Boxes do not rotate with facing.
- The table lives in `rh-sim`: id, foot half-extents, body half-extents, offset, chest height (used below). Characters, mobs and quest givers reference an archetype id. The id travels in the protocol, and the table's values reach Unity from the Rust source (in the protocol or generated at build time), never as a hand-kept copy. Unity fits and draws sprites from that data.
- Scope of the table: one archetype per look that has art today, sized from the three sprite heights in section 3. Mobs are a low-effort pass: map each of the 30 mob types to the archetype of the look it currently draws, quest givers to the hero-sized default, and make sure the combat loop still feels right. Do not tune per-mob boxes and do not design new mobs.
- Keep a `legacy_circle` archetype (circle behaviour, chest height zero) so existing parity fixtures stay valid. Run parity tests against it. Live play uses the new archetypes.
- What does NOT switch: bot/mob AI range checks and spawn/placement clearance keep the existing 12 u value. Bot behaviour is out of scope.
- No body blocking between characters. Melee (axe, sword, shield) hits every target within its existing range and arc; nobody standing in between protects anyone. Arrows stop at the first body box they meet, so a character in front shields the one behind. Confirm arrows already stop on first hit; if they do not, report it at Gate 1 before changing it.
- Melee arcs and ranges are unchanged, but melee is measured from the attacker's chest height (the archetype chest height) against the target's body box, so reach is even in all directions. Measuring from the feet point against a tall body box would make reach lopsided north versus south; do not do that. Record this in the same ADR.

**Projectiles fire from the chest (a Rust change, the owner's explicit direction).** Projectiles are simulated, not just drawn, from chest height.
- Every projectile has a ground position and a height. The height is the shooter's archetype chest height.
- Walls are tested against the ground position, exactly as today. This is what stops a character standing against a north wall from firing into it.
- Bodies are tested against the raised position, against the target's body box, keeping the existing arrow radius/slack.
- Aim: the projectile as drawn flies from the shooter's chest straight through the cursor. Clicking an enemy's torso sends the shot through that torso. Bot and mob aiming keeps its existing logic unless it measurably starts missing; if so, apply the same chest correction and nothing more.
- Applies to every projectile (arrows, wand shots, mob shots). Unity draws projectiles at the simulated height.

**Parity conflict.** The hitbox and projectile-height changes depart from legacy parity (CLAUDE.md "parity" non-negotiable, and decision D1 in `docs/ORDER_OF_OPERATIONS.md`). They are owner-approved: record both in one ADR, regenerate affected fixtures, list every changed fixture and golden vector in your report, and flag the conflict to the owner in the Gate 1 report.

**Protocol.** One `PROTOCOL_VERSION` bump, to carry the archetype id (and the archetype table and projectile height if you send them on the wire). Per-tile region identity is already in protocol 14 and needs no bump. Regenerate the golden vectors and make the Rust, C# and JS decoders pass.

**Performance.**
- Target: the Ultra preset (full effects: lighting, particles, post-processing) holds 144 fps at 2560 x 1440 in Chrome on the owner's Mac.
- Pass/fail: a scripted 60-second run in a full bot-filled match, during a fight, in the heaviest region, with 95th-percentile frame time at or under 6.94 ms and the worst 1% of frames at or above 120 fps. Record the frame-time log.
- Before measuring, confirm the display is running 2560 x 1440 at 144 Hz. If it is not, do not claim the target: report a vsync-off frame-time measurement labelled provisional and say why.
- Add Ultra to the existing Low / Medium / High presets. Presets toggle particles, dynamic lighting and post-processing so weaker machines work, with the existing adaptive mode choosing a default from measured frame time.
- First-load download stays under about 150 MB compressed. Load larger assets (music, region art) after the match starts. Measure and report build size at each gate.
- If Ultra misses the target, record exactly which effect costs what and which toggle fixes it.

## 5. Workstreams (run all independent ones in parallel)

Run every workstream that does not depend on another's output at the same time, and serialise only genuinely dependent work. The workstreams below are a starting split; refine them.

A. Controls audit, animation fix, and prediction. (Needs nothing.)
B. Hitbox archetype table and projectile height in `rh-sim`, protocol bump, regenerated fixtures and prediction vectors, C# pathfinder, Unity sprite fit. (Rust first, then Unity.)
C. Palette research (extend `docs/art/PALETTE.md`), then asset/licence inventory and ledger. (Needs nothing.)
D. HUD and screens rebuilt to the legacy layout (read `packages/client/src/ui/*.css`, `hubLayout.ts`), with the new skin. Triage the unmerged `unity-ui-*` branches: keep functional, theme-neutral parts (input and mouse-capture fixes, hub logic, tests) and discard the old navy-glass styling. (Layout can start now; skin waits for C.)
E. Region ground, props and terrain effects, read from the existing `MapBlob.Regions` plane. (Needs nothing from B.)
F. Region lighting, particles (Frost snow first) and audio (placeholder music per region, shared SFX), built on the existing Light2D/Volume setup. (Needs C for colours.)
G. Performance harness: Ultra preset, frame-time logging through `showcase-profile.cjs`, build-size tracking. (Needs nothing to start.)

Use sub-agents heavily, as many as there are independent tasks:
- **Opus**: architecture, ADRs, protocol and archetype design, and review of every change to `crates/rh-sim` before it lands.
- **Sonnet**: Unity C#, UI, art and audio integration, palette and asset work.
- **Haiku**: small, well-specified Rust tasks only, such as filling the archetype table or writing tests. Every Haiku Rust change must pass `cargo test --workspace` and `cargo run -p rh-parity --bin parity-report`, and must be reviewed by an Opus sub-agent before it counts as done, because the sim core is deterministic and a cheap model can break it silently.
- Give each concurrent task its own git worktree under `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/`. Run at most 4 at once (a Unity worktree can be 5.5 GB). Remove each worktree once its work is merged into the feature branch. Never leave stale worktrees behind.

## 6. Gates and state

The owner is absent between gates. Gates 1 and 2 are report-and-continue: write the report, apply your own recommended answer to every open decision, log it, and keep working. Nothing before Gate 3 is irreversible because everything stays on the unmerged, unpushed feature branch. Only Gate 3 stops you.

At each gate, append a section to `docs/prompts/UNITY_REWORK_REPORT.md` with screenshots and frame-time numbers from the Unity build (`showcase-profile.cjs` or the browser), test results, purchase requests with the running total, and a list of anything you decided that the owner should know about.

- **Gate 1 (direction):** control audit findings with measurements; the hitbox archetype and projectile-height design and the protocol-bump proposal, including the parity conflict flag; asset and licence inventory; palette doc; triage result for the unmerged UI branches; where section 3 was wrong; the full phase plan.
- **Gate 2 (vertical slice):** playable in the browser with fixed controls and animation, the new hitboxes and chest-height projectiles live, the in-match HUD at the legacy layout with the new skin, and Frost finished (ground, props, cold lighting, snow particles, placeholder music), with screenshots and a frame-time log.
- **Gate 3 (complete, hard stop):** all five regions, the remaining screens, audio, quality presets and the performance report. Attach a clear list of every Rust, protocol and fixture change for review. Nothing is merged or pushed until the owner approves here.

Frost is the first region because it exercises particles, lighting, palette and music.

**State file.** This effort will outlast many context windows. Keep `docs/prompts/UNITY_REWORK_STATE.md` current and update it with every commit: current phase, feature-branch name, open worktrees and which sub-agent owns each, which project copy has Unity open, decisions taken and why, and what is next. After any context reset, read it before doing anything else.

## 7. Verification you must do yourself

Never ask the owner to check things manually. For every change: run `cargo test --workspace`, `cargo run -p rh-parity --bin parity-report`, `dotnet test client-unity/RoguehallaNet.Tests`, and `node tools/browser-proof/proof.mjs` (protocol probe only). After any protocol change, run the Rust, C# and JS golden-vector tests. For anything visible, build the WebGL client (`client-unity/UnityProject/Tools/build-web.sh`, with an rh-server running) and verify it in a real browser: screenshots, console errors and network errors checked. Report failures faithfully with output. If something is skipped or unverified, say so. Postgres-dependent tests need `eval "$(tools/pgtest/start.sh)"`.

## 8. Reporting

Keep the owner informed at the three gates only, unless something blocks the whole effort. Each report is short, evidence-first (screenshots, numbers, test results), and lists decisions needing the owner's attention with your recommended answer.
