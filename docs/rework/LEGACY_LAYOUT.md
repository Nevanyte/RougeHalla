# Legacy layout specification (TypeScript/Phaser client, `packages/client`)

Purpose: a build-ready description of where every legacy UI element sits and what it contains, so the Unity HUD and screens can be
re-skinned onto the same layout and information hierarchy (owner direction, binding: keep the legacy layout exactly, replace
only the look). Read-only extraction; nothing under `packages/` was changed. "Legacy" = the runnable Phaser client; code wins over
`docs/legacy/CLAUDE_LEGACY.md` and `docs/legacy/INVENTORY.md` where they differ. All sizes are CSS px of the legacy **overlay**
(`#ui`) unless a row says "world px".

Scope and phasing from the owner: in-match HUD first (chrome buttons, minimap, weapon bar, champion HUD, build HUD, settings; chat,
see 0.4), then hub/lobby, chest, trader and planning screens; the quest panel is re-skinned in place only (section 12 records its
legacy layout for reference, but it is not to be moved).

## 0. Reference frame

### 0.1 Reference viewport and scaling (this is what "CSS px" means)

`#ui` is not laid out at the window size. `view/viewport.ts` lays it out at a fixed design size and scales it
(`packages/client/src/view/viewport.ts:17-24,82-107`, applied by `view/viewportManager.ts:172-176`, `view/stage.css:36-49`):

| Quantity | Value | Source |
|---|---|---|
| Base (reference) viewport | **1280 x 800** | `UI_BASE_W/H`, viewport.ts:18-19 |
| Overlay scale `s` | `clamp(min(stageW/1280, stageH/800), 0.8, 1.5)` | viewport.ts:91, 20-21 |
| Overlay layout size | `uiW = stageW / s`, `uiH = stageH / s` (CSS vars `--ui-w`, `--ui-h`) | viewport.ts:104-105 |
| Stage | the window, but never wider than **21:9** (`MAX_ASPECT`); wider windows get a centred strip with body-colour bars | viewport.ts:10,74-80 |
| `html[data-ui-short]` | set when `uiH < 760` | viewport.ts:23, viewportManager.ts:175 |
| `html[data-ui-narrow]` | set when `uiW < 600` | viewport.ts:24, viewportManager.ts:176 |
| World zoom (for in-world art) | everyone sees 900 world px top-to-bottom; width gets at least 4:3 | viewport.ts:9,11,90 |

Nothing inside `#ui` uses `vw`, `vh` or a size `@media`; sizes use `--ui-w`/`--ui-h` and the two attributes above
(`ui/chrome.css:1-3`, `style.css:62-66`). Worked layout sizes:

| Window | `s` | `uiW x uiH` | Notes |
|---|---:|---|---|
| 1280 x 800 | 1.00 | 1280 x 800 | the design size |
| 1366 x 768 | 0.96 | 1423 x 800 | |
| 1920 x 1080 | 1.35 | 1422 x 800 | height-bound; `uiH` is 800 at every 16:9 size that is not clamped |
| 2560 x 1440 (the owner's display) | **1.50** (clamped from 1.80) | 1707 x 960 | `data-ui-short`/`narrow` off |
| 3440 x 1440 | 1.50 | stage 3360 x 1440 -> 2240 x 960 | stage clamped to 21:9; bars each side |

So at 1920 x 1080 one CSS px = 1.35 screen px. `data-ui-short`/`data-ui-narrow` therefore only fire on small windows.

### 0.2 Stacking ladder inside `#ui` (z-index; DOM order breaks ties)

`auto` HUD plate, minimap, weapon bar, mob/cards rows < **1** edge-threat glows (`ui/vision.css:1`) < **6** champion HUD
(`championCombatHud.css:4`) < **7** quest tracker (`questLog.css:73`), sentenced-hunt picker (`sentencedHuntHud.css:3`) < **8** chest
panel (`chestPanel.css:11`), trader panel (`traderPanel.css:1`) < **9** quest dialog (`questDialog.css:10`) < **10** map screens
(`planning.css:9`) < **11** quest log + launcher (`questLog.css:7,48`) < **15** connection banner + toasts (`style.css:441,473`) <
**20** chrome buttons (`chrome.css:12`) < **40** reload prompt (`reloadPrompt.css:5`) < **60** settings card (`chrome.css:68`) < **70** help
scrim (`chrome.css:177`) < **1000** boot/loading screen (`index.html:31`, outside `#ui`). The planning screen dims the world, so the
banner/toasts/chrome deliberately sit above it (`style.css:432-436`).

### 0.3 Interaction conventions every element shares

- `#ui > *` takes pointer events by default (`stage.css:47-49`); display-only elements (HUD plate, banner, toasts, weapon bar,
  death line, hud-center) turn it off so right-click move and left-click attack under them reach the canvas (`style.css:304`).
  Only buttons/inputs inside them re-enable it. Tooltips on click-through rows are found by rectangle hit-test, not `:hover`
  (`ui/rectTips.ts`).
- `[hidden]` always wins (`style.css:91`). Focus ring: 2px, `outline-offset:2px` (`style.css:94`).
- Keys are physical `e.code`; they are ignored while a text field has focus (`ui/chrome.ts:32-52`, `scenes/RaidScene.ts:1731`).

### 0.4 What the legacy client does NOT have

- **Chat: none.** No chat input, log, message type or CSS exists in `packages/client`, `packages/shared` or the protocol. Do not
  build one as "parity".
- **Kill feed: none.** Kills and gains arrive as toasts (bottom centre, section 8) and as `+N GV`/`Camp cleared` lines; the local death is the
  centred "YOU DIED" line (section 9). There is no scrolling list of eliminations.
- **Spectator mode: none.** A dead player keeps the HUD frame (empty plate, no weapon bar) and gets the results panel; Tab map is
  blocked while the results panel is up (`ui/mapHold.ts:42-44`).
- Dead CSS with no producer in the client today: `.sudden-death` and `.immune-line` (`style.css:341-368`); sudden death is only the
  red "Coliseum - sudden death" arena line (`ui/hud.ts:266-269`).

### 0.5 Legacy colour tokens (reference only; the new skin replaces all of these)

Dark flat surfaces `--panel rgba(20,24,30,.94)`, `--card #161b21`, lines `#2b323c / #3a434f / #4a5563`, text `#e6e9ed`, muted
`#aeb7c2`, dim `#8d99a6`, gold accent `#ffe082` (`--gold #ffd54f`), ok `#66bb6a`, danger `#ef5350`, warn `#ffcc80`, info `#4fc3f7`
(`style.css:5-72`). Font `system-ui`, base 14px, tabular numerals (`style.css:78-89`). Radii 4/6/8. Semantic roles worth keeping
in the new skin: hp green/amber/red, barrier blue, gold = reward/accent, red = danger/refusal, amber = own gains, teal = training.

## 1. Screen map at 1280 x 800 (in match)

```
+--------------------------------------------------------------------------------------+
|[HUD plate 240w]         [top-centre: Coliseum timer pill / connection banner]  [fps][fs][gear][?]
| hp bar + value                                                                  <- chrome, top 10 right 12
| Gained (build) cells                                  [chest panel 248w, right 12, top 56
| Cards & mob bonuses v                                  down to minimap top - 22]
| (J quest log hangs under the plate)
|[quest dialog 280w, left 12, vertically centred]
|
|                      world
|
|[champion HUD 250w, left 12, bottom 48]        [toasts, bottom 124, centred]
|[Quests - J launcher, left 12, bottom 12]  [weapon bar, centred, bottom 14]  [minimap 270sq, right 12, bottom 12]
+--------------------------------------------------------------------------------------+
```

## 2. Chrome buttons (top right)

| Item | Spec | Source |
|---|---|---|
| Cluster | `position:absolute; top:10px; right:12px; z-index:20; display:flex; align-items:center; gap:8px`; cluster is click-through, buttons are not. `data-ui-narrow`: top 8, right 8, gap 6 | chrome.css:8-18,60 |
| Order (left to right) | perf readout, then buttons **Fullscreen, Settings, Help** | chrome.ts:101-109 |
| Button | 30 x 30 (narrow 28 x 28), gap between buttons 6, radius 6, 1px border, bg `rgba(20,24,30,.82)`, 16 x 16 stroke icon (1.6 stroke, round caps) centred; hover brighter; `aria-pressed`/`aria-expanded` true = gold | chrome.css:19-37,61; chrome.ts:64-70 |
| Fullscreen | icon swaps enter/exit; hidden when the browser has no Fullscreen API; title "Fullscreen (Alt+Enter)" | chrome.ts:102,198-209 |
| Settings | gear-as-sliders icon; toggles the settings card | chrome.ts:104,157-163 |
| Help | circled "?" icon; title "Controls (H)"; toggles the help card | chrome.ts:105,165-172 |
| Perf readout | text pill `"144 fps - 32 ms"`: 11px, line-height 16, tabular, pad 4/8 (narrow 3/6, 10px), bg `rgba(20,24,30,.7)`, radius 6; fps and ping each `min-width:4.4em`, right aligned; tones: idle `#6f7b88`, good (fps >= 50) `#81c784`, warn (>= 30) `#ffd54f`, bad `#e57373`; each half shown only if enabled in Settings ("Show FPS", "Show ping"); fps counted over 500 ms windows | chrome.css:40-62; perfMeter.ts:7-49,164-166 |
| Visibility | whole session: hub, lobby, planning, run, practice, dead, results; never hidden by a panel | chrome.ts header comment |
| Keys | `Alt+Enter` fullscreen (works anywhere, even typing), `H` help (not while typing, no modifiers), `Esc` closes an open panel (consumed so the scene does not also leave practice) | chrome.ts:32-40,143-155 |

## 3. Minimap (bottom right)

| Item | Spec | Source |
|---|---|---|
| Anchor | canvas `position:absolute; right:12px; bottom:12px`; no z-index (auto) | minimap.css:4-7 |
| Size | square, `--mm-size` px, set by script: `base = clamp(round(uiH * 0.338), 195, 312)`, capped so it clears the centred bar: `<= floor(uiW/2 - 12 - 152)` (floor 110); then `x minimapScale` (setting: 0.75, **1**, 1.25, 1.5, 2), then `min(.., uiW*0.42, uiH*0.6)`. **270 at 1280x800 and at 1920x1080**; 312 at 2560x1440 | minimapMath.ts:13-47; minimap.ts:433; settings.ts:28 |
| Backing store | `min(size*s*dpr, 1280)` device px, so crisp at any scale | minimapMath.ts:50 |
| Frame | radius 6, bg `#111a22`, ring is a 1px **box-shadow** (`#384550`) plus soft drop shadow, not a border, so the drawn rect equals the hit rect; hover ring `#8fa3b8`; while left-held "peeking" ring 2px white; while right-held "steering" ring 2px mint `#69f0ae` | minimap.css:8-32 |
| Contents | cached terrain layer, vision cut-out, mobs as dots/counted clusters, enemy players coral, corpses, chest + camp clocks (gold seconds = chest, blue = respawn), camp states, ward timers, quest blips, view rectangle, planned route (faint), gates-locked tint, player marker. 150-unit overlay space for marker layout | minimap.ts; minimapLayout.ts:1-22; helpOverlay.ts "Minimap" rows |
| Input | right-click = move there; **hold left = peek** there, release snaps back; mouse capture stays on the minimap while dragging and ends on release anywhere; presses are stopped from reaching the world | minimap.ts:182,582-612; helpOverlay.ts |
| Neighbour constraint | the chest panel docks above it (`--mm-size` is also set on `#ui`) | chestPanel.css:14-16 |
| Visibility | always in the run scene (lobby, planning, active, dead); marker only when `alive|lobby`. Not shown in the hub | RaidScene.ts:799 |

## 4. Weapon bar (bottom centre)

Root `.weapon-bar`: `position:absolute; left:50%; bottom:14px; transform:translateX(-50%)`; flex column, centre aligned, gap 6;
`max-width: 0.96*uiW`; click-through; hidden unless the local player is `alive` (so hidden in lobby, planning-less states, and when dead)
(`weaponBar.css:1-15`, `weaponBar.ts:136-137`). Children, top to bottom:

| Row | Contents | Spec | Source |
|---|---|---|---|
| Tooltip | text of the slot under the pointer | absolute, `bottom: calc(100% + 6px)`, centred, max-width 0.5*uiW, 12/16px, pad 6/8, `white-space:pre-line` | weaponBar.css:88-108 |
| Pickup hint (`.wb-hint`) | `[F keycap] take <weapon>` or `swap <held> for <new>`; also quest "talk to ..." lines; hidden when nothing in reach | pad 3/12/3/8, radius 6, gold text 600, border `#8d7a2c` | weaponBar.css:16-29; weaponBar.ts:89,189 |
| Slot row (`.wb-row`) | **slot 1** [Q swap chip] **slot 2** [**Wish slot** docked at the right end] | flex, gap 6, centre | weaponBar.css:30; weaponBar.ts:70-90 |
| Weapon slot | **104 x 76** (narrow 88 wide); pad 6/4/5; content stacked from bottom, gap 4: **26 x 26 swatch** (weapon colour/icon), **name** 11px/14px ellipsis, **scaling line** 9px/11px ("Offense 1.0", "SO 1.2 + Offense 0.3"); key cap `1`/`2` absolute top 4 left 5, 10px; border 1px `#4a5563` radius 6 | weaponBar.css:31-86,130 |
| Slot states | `empty` opacity .5 and dashed swatch; `active` (in hand) opacity 1, gold border, warm bg, 12px gold glow, gold key cap | weaponBar.css:47-56,63 |
| Cooldown sweep | one shared attack cooldown wedge over both slots: conic gradient, dark 60%, shrinking clockwise from 12 o'clock | weaponBar.css:123-128 |
| Swap chip (`.wb-swap`) | between the slots: `Q` key cap over the word "swap" (9px caps, CSS `::after`) | weaponBar.css:110-121 |
| **Wish slot** | `abilitySlot` 64 x 64 (narrow 60), pad 6/4/5, key cap **R** top-left, 24 x 24 coloured icon, 10px name, seconds-left 15px bold centred over the icon (or blocking reason 11px red), cooldown sweep, 3px cast bar along the bottom edge, charge badge bottom-right (11px bold on black pill), ready state = border + soft glow in the ability colour, `casting` gold, `shut` red-brown. "Deny" line ("Out of range", "Ready in 4:59") floats above, right aligned, red pill, takes no layout room. Tooltip above, max 0.55*uiW | abilitySlot.css:5-127; RaidScene.ts:394 |
| Consumables row (`.wb-consumables`) | two chips, wrap + centre, gap 6: **Heal**: `[E] Heal  <large> large · <small> small  Healing xN 4s`; **Wind**: `Wind  Walk over emblems / +50% speed  Active 3s`. Chips fade to .55 when unusable. Heal text green `#72e5a2`, Wind `#80d6ff`, status gold | weaponBar.css:132-137; weaponBar.ts:92-96,150-157 |
| Controls line | static `WASD move · Click attack · R Wish` 11px on `#11171de6` | weaponBar.css:138; weaponBar.ts:99 |
| Width | two 104 slots + 6 + swap chip + 6 + 64 Wish slot = **284** (the minimap clearance maths assumes 142 each side of centre) | minimapMath.ts:23-27 |
| Vertical footprint | 14 bottom + 76 slots (+6 + consumables ~28 + 6 + controls ~20 when shown) (+6 + hint ~24). Toasts sit at `bottom:124` clear of the slots; the quest tracker at 112 | style.css:476; questLog.css:74 |
| Keys | `1`/`2` select slot (also numpad), `Q` swap, `E` drink potion, `F` pick up / interact, `R` cast Wish. All ignored while dead, in planning, or typing. (`abilitySlot.css` header and `abilitySlot.ts:1` still say "D"; the code binds **R**) | RaidScene.ts:1731-1752 |

## 5. Champion combat HUD (bottom left)

`#ui > .champion-combat-hud` (`<section aria-label="Combat overview">`): `left:12; bottom:48; z-index:6`, width
`min(250, 0.42*uiW)` (narrow: `bottom:118`, width `min(250, 0.62*uiW)`), `max-height: min(150, 0.3*uiH)` (short: 0.34), pad 6/8,
radius 7, 1px hairline border, bg `rgba(12,17,23,.9)`, text 11px/1.25, click-through (`championCombatHud.css:2-20,69-73`).
It sits directly above the Quests launcher (section 12).

| Part | Spec | Source |
|---|---|---|
| Head | flex row, baseline, space-between, mb 4: **champion name** (faction colour) 12px 700 ellipsis, **held weapon name** 10px gold | css:21-30; ts:38-60 |
| Rows (3, in order) | `auto` (basic attack), `passive`, `wish`. Each: 2-column grid `1fr / 1.15fr`, gap 1/6, pad 2/3, left rule 2px gold-ish, bg 3.5% white; **cell 1** label 10px 600 muted, **cell 2** value 12px-ish 700 tabular ellipsis; **line 2** scaling text 9px dim spanning both columns | css:31-44; ts:51-58 |
| Row tooltip | opens above the row (`bottom: 100%+4`), max min(280, 0.6*uiW), 10px; shown by rectangle hit-test | css:45-63 |
| Fire extra | Fire champion appends a roam-charge strip: 10px label + value (4ch, mono), 3px track, `Ready` pulse | fireRoamHud.css |
| Training | in a practice room the HUD lifts to `bottom:190` (340 when the tips panel is open; hidden while the practice build panel is open) | css:64-72 |
| Visibility | only while the local player is `alive` and (`phase==="active"` or practice). Hidden in lobby, planning, dead, results | championCombatHud.ts:71-80 |

## 6. HUD plate and health (top left)

This is the legacy home of **health, the build/"Gained" strip, the cards row and the mob-stats row**; nothing of these sits bottom-left.

| Item | Spec | Source |
|---|---|---|
| Plate (`.hud`) | `left:12; top:10`, width `min(240, 0.74*uiW)` (border-box: content width **224**), pad 5/7/6, bg `rgba(12,15,19,.58)` (no blur), 1px 6%-white border, radius 6, text-shadow `0 1px 2px #000`, click-through | style.css:289-303 |
| Not active (lobby / planning / training / over) | line 1 `hud-status` (600): lobby `Waiting for players 3/8 - run starts in 0:42`; planning `Planning 0:45`; training `TRAINING - nothing here is recorded: no GV, no stats` (teal `#80deea`); over `Run over - <name> is victorious`. Line 2 `hud-vitals`: `name - Faction (faction colour) - hp/max[+barrier] - status` (training: `... - <weapon> - hp`) | hud.ts:40-84,198-203; trainingBar.css:47 |
| Active (run, alive) | status and vitals lines **hidden**; shows the health row, build strip, cards/mob extras, terrain chips | hud.ts:197-202 |
| **Health row** (`.hud-health`) | flex, gap 6, mb 3: **`HP`** label 10px 700 spaced (muted), **meter** 8px tall, `flex:1 1 76`, min 40, **max 108** wide, radius 5, bg `rgba(0,0,0,.55)` + inset 1px hairline; fill `#66bb6a`, `low` (<= 35%) `#ffca28`, `critical` (<= 18%) `#ef5350`; **barrier** segment `#4fc3f7` drawn after the fill; width transitions 100 ms linear; then **value** `hp/max +barrier` 11px 600 tabular; then **bounty tag** ` - Bounty N` gold 10px when > 0 | style.css:309-318; hud.ts:213-245 |
| Shown when | `phase==="active"`, not practice, `me.status==="alive"`; whole row hidden once dead | hud.ts:199-202 |
| Build / "Gained" strip | section 7 | |
| Cards & mob bonuses | `<details class="hud-extras">`, summary `Cards & mob bonuses` 10px dim; inside: cards row (`GAINED`-style 10px label then chips: 11px/15px, left rule 3px muted, **dashed** = conditional, **gold** = augment, count in accent) and the mob-stats chips; shown only while active and alive | style.css:321-323; cardsRow.css; mobStatsHud.css |
| Terrain chips | under the strip, hidden while active (they live in the non-active/ extras area): pill chips `BURNING #ff8a3d`, `SLOWED #aed581`, `ICE #81d4fa`, `RESTING #ffd54f`, plus a home-ground note; 11px/16px caps tracked, max-width 256 | terrainChips.css; style.css:323 |
| Sentenced hunt picker | only for a living Sentenced: `left:12; top:128; z:7`, width `min(240, .72*uiW)`, max-height `min(190, .34*uiH)`, purple-tinted card, list of target buttons 24px high (narrow: top 120) | sentencedHuntHud.css:2-13,35 |
| Plate box for neighbours | `Hud.plate` reports the measured box; the quest log is placed under it | hud.ts:154-157 |

## 7. Build HUD ("Gained", 256 px declared)

`.hud-build` inside the plate, after the health row (`buildHud.css:5-50`, `buildHud.ts`, `buildModel.ts:14`).

| Item | Spec |
|---|---|
| Box | `margin-top:3`, `width:256; max-width:100%` - **inside the 224 px plate content box it is effectively 224 wide**; click-through |
| Label | `GAINED`, 10px/12px, caps, letter-spacing .06em, dim, mb 2 |
| Grid | `display:flex; flex-wrap:wrap; gap:3px 5px; align-items:center` |
| Cells (**9**, fixed order) | `ad` Offense, `ap` SO, `damage` "Damage gained", `as` Attack speed, `leech` Life steal, `health` Health gained, `armor` Defense, `mr` Soul Defense, `move` Move speed |
| Cell | `min-width:47`, pad 1/4, 10px/14px nowrap, bg `rgba(0,0,0,.28)`, **left rule 3px** in the stat colour, radius 3; inside: **13 x 13 stat icon** (`combatIcon`, `STAT_ICON_COLORS`) + name (dim) on the left, **value** tabular 700 on the right (`+24`, `+12%`); `dim` modifier (value is zero) turns the value muted weight 500 |
| Tooltip | per cell, opens **below** (`top: 100%+4`), max 0.34*uiW, 12px/16px, panel + hairline + pop shadow, via rectangle hit-test |
| Icons | green plus = health, blood drop = life steal, sword = Offense, sparkle = Soul Offence, bow = attack speed, shield = Defense, bubble = Soul Defense, boot = movement (`helpOverlay.ts` "Stat icons") |
| Visibility | active run, local player alive (`build.update(me, alive)`) |

## 8. Notifications, toasts, connection banner, status text

| Element | Spec | Source |
|---|---|---|
| **Toasts** (server lines, own gains, client errors) | stack centred at `left:50%`, `bottom:124`, `z:15`, flex column gap 6, `max-width 0.92*uiW`; max **3** visible (oldest dropped); each pad 6/14, radius 6, 1px `--line-hi`, pop shadow; tone `buff` (own gains: `Armed:`, `Camp cleared: +`, `Quest complete:`, `+N GV`) amber, `error` red (hold 4-8 s by length), `ok` green (2.2 s); default hold 1.8 s then 250 ms fade; repeats extend instead of stacking | style.css:470-505; toast.ts:11-50 |
| **Connection banner** | pill at top centre: `top:12; left:50%; z:15`, flex gap 8, pad 6/14/6/10, radius 999, 600 weight, nowrap, max 0.92*uiW; states: `reconnecting` (amber, 14 px spinner) `Connection lost - reconnecting...`; `reconnected` (green, check) `Reconnected` 1.8 s; `notice` (no icon); enters with 180 ms slide-down; click-through | style.css:438-468; banner.ts:3-62 |
| **Coliseum / arena line** (`hud-center`) | top centre `top:12`, column, gap 4: pill (pad 3/8, radius 6, plate bg, 13px 700) `Coliseum 4:59`; locked gates `Coliseum 1:12` (warn colour); after the deadline `Coliseum - sudden death` red `#ff8a80`. Only in `phase==="active"` and not practice; hidden when no deadline | style.css:328-340,319-320; hud.ts:259-286 |
| **Death line** | `YOU DIED`, centred in the viewport (`top:50% left:50%`), 44px 700, letter-spacing .14em, red `#e57373`, glow; 500 ms fade-in; hidden in practice and once the results panel is up | style.css:371-390; hud.ts:164-176 |
| **Edge threat glows** | radial blurred blobs (180 x 180, blur 8, opacity .55) hugging the screen edge toward visible enemies; colour green far -> yellow -> red near (`near 150`, `far = vision radius`); `z:1`, never takes input | vision.css; edgeThreat.ts:8-30 |
| **Opponent inspector** | right-top card `top:88; right:18`, width `min(330, 40vw)`, hover-driven detail of an enemy (champion, hp, investments, damage types, Wish text) | opponentInspector.css:1 |
| Kill feed | none (section 0.4) | |
| Training bar | bottom-left `left:12; bottom:14`, column gap 8, max-width `max(160, min(320, 0.5*uiW-140))`; tips card (teal border, 12px, fades after 1.5 s) + "Console" and "Leave (Esc)" buttons; console panel 296 wide | trainingBar.css:1-47; trainingConsole.css:15-30 |
| Reload prompt | fullscreen scrim `z:40` + card 420 wide ("new version" prompt) | reloadPrompt.css |

## 9. Hp / status bars and labels over actors (world space, Phaser)

World-space art, not DOM. Sizes are **world px** (900 of them span the screen height).

| Item | Spec | Source |
|---|---|---|
| Player hp bar | 28 wide x **4** tall, centred, `top = -BODY_LIFT(14) - FIGURE_RADIUS(13.2) - 8 = -35.2` above the actor origin; back black .6 alpha; fill colour by hp share **> 50% green `#66bb6a`, > 25% amber `#ffca28`, else red `#ef5350`**; barrier `BARRIER_COLOR` stacked after the fill | FighterArt.ts:354-394; PlayerView.ts:26,284 |
| Mob bar | 36 wide (elite 48); hidden for a mob at full health out of a fight | MobView.ts:19-21,175 |
| Name label | 11px system-ui, white (local player mint `#b9f6ca`), 2px black stroke, origin bottom-centre at `y = -BODY_LIFT - FIGURE_RADIUS - 18` (about 10 px above the bar); mobs 11px (elite 12px bold); crown + bounty text 11px gold; worn title 10px bold below the feet | PlayerView.ts:65,171-189; MobView.ts:109,247 |
| Status art | ring/glyph layer on the bar width (`HP_BAR_W/2` radius for signatures/status), barrier ring, shield ring, Wish icon, build marks, mark pips | PlayerView.ts:262-270 |

## 10. Chest choice panel (right edge)

`#ui > .chest-panel` (`chestPanel.css`, `chestPanel.ts`): opens by itself while a chest is within reach of the **latest server
position**, closes on walking away / expiry / pick. Not modal; box is click-through, only cards and Skip take the pointer.

| Item | Spec |
|---|---|
| Anchor | `right:12; top:56; bottom: --mm-size + 34` (so ~22 px above the minimap), `z:8` |
| Size | width `min(248 * textScale, 0.42*uiW)` (narrow `min(220*scale, 0.5*uiW)`); column, content centred vertically; font 13px*scale |
| Box | pad 8/10/9 (short 6/8/7), gap 6 (short 4), radius 8, panel bg, hairline, pop shadow, 180 ms rise-in; focused = gold ring |
| Head | title (700, ellipsis) + **timer** (gold, tabular; <= 5 s red, pulsing) + pool glyph 11 x 11 |
| Progress | 3px bar under the head, gold, width = time share |
| Cards | **3 cards** stacked, gap 4, each full width, pad 5/8/6: name (700) + **tier numeral** chip (accent border) top row; kind line (caps, 0.8em); text (0.92em); state line (0.88em, amber: taken / "Needs X" / "Already yours"); tag chips (0.74em pills; hidden when short); augment frames plain / silver / gold (+ flair glyph) |
| Skip | full-width button below the cards, `[0]` key cap + label |
| Footer | status line (min-height 1.3em) and hint `Press [C] to use the keyboard` / `[1][2][3] pick [0] skip [C] or [Esc] back` (hidden when short) |
| States | `mine` green, `taken` struck through, `blocked`/`unknown` dashed, `greyed` desaturated, `sending` accent border |
| Keys | `C` toggles keyboard focus into the panel; then `1/2/3` take card, `0` skip, `C`/`Esc` give it back (digits are weapon slots otherwise) |

## 11. Settings, help and results

### 11.1 Settings card (under the gear, NOT a modal)

`#ui > .settings-panel`: `top:48; right:12; z:60` (narrow `top:44; right:8`), width `min(320, uiW-24)`, `max-height uiH-60`, scroll-y, pad
12/14/14, 13px, panel bg `rgba(20,24,30,.96)`, 1px `#3a434f`, radius 8, large shadow (`chrome.css:65-83`). Closed by the gear, `Esc`, or the `x` (20px) in its
header. Content (`settingsPanel.ts:102-123`):

| Section (11px caps heading) | Rows |
|---|---|
| Display | Fullscreen (switch; note "Alt+Enter does the same." or "Not available in this browser."), Sharp rendering (switch) |
| Effects | Effects intensity (range 0-100%, gold value), Reduced motion (switch) |
| Readout | Show FPS, Show ping (switches) |
| Network | Draw remote fighters ahead (switch) |
| Map | Show route (switch), Minimap size (segmented 75/100/125/150/200%), Map text size (segmented 100/125/150%) |
| Footer | status line, "Saved in this browser." (11px dim) + **Reset to defaults** small button |

Row = 2-column grid `1fr auto`, pad 7/0, hairline between rows; label 13px, optional note 11px dim below; switch **36 x 20** (14 px knob, green when on); range full width, accent gold; segmented buttons pad 3/9, 12px, checked = green.

### 11.2 Help card

`#ui > .help-scrim` (inset 0, dim `rgba(8,10,14,.55)`, `z:70`, flex-centred; click outside closes) holding `.help-card`: width
`min(560, uiW-24)`, `max-height uiH-24`, pad 16/20/14 (narrow 12/14), 13px, scroll. Header: title 17px caps + `x`. Two **tabs**
(`Controls`, `Mechanics`): Controls = sections ("In a run and in practice", "Planning, before the run", "In the hub", "Anywhere") each a
2-column list (key caps | action; narrow: single column); Mechanics = glossary of terms (damage types, DoT, on-hit, Offense/SO, card
power and PvP factor, signatures, weapons). The game keeps running behind it. Keys `H`, `Esc`, button, outside click.
(`chrome.css:173-228`, `helpOverlay.ts:34-120`.) Full control list is the `HELP_SECTIONS` table at `helpOverlay.ts:34-110`.

### 11.3 Results panel

`.panel.results`: centred (`left/top 50%` translate), width `min(0.92*uiW, 440)`, flex column, top border 3px by outcome (won gold + glow, draw `#b0bec5`, died `#e57373`, mia `#ffb74d`)
(`style.css:122-138,391-402`; `results.ts:84-109`). Order: **h1** outcome (38px 800, tracking .16em; `VICTORY`, `DRAW`, `YOU DIED`, `LEFT THE RUN`) -> place line 17px -> "Killed by X" ->
fact tiles (**Time**, **Kills**: min-width 88, value 20px 700 over 11px caps label) -> **GV box** (rows `Reason +N`, zero rows faint; total row: label 12px caps + amount 32px 800 gold) -> withheld-bonus note -> "Achievements unlocked" box ->
primary button **Back to hub** (pad 10/14). Shown on result; the death line is replaced by it. There is no per-player scoreboard in legacy; the ranked roster is the Tab map's left column (section 13).

## 12. Quest UI (record only - re-skin in place, do not relayout)

| Element | Spec | Source |
|---|---|---|
| Launcher `Quests · J` | `left:12; bottom:12; z:11`, button pad 4/8, 11px, radius 5; hidden unless phase is `active` or `planning` | questLog.css:46-62; questLog.ts:56,126 |
| Quest log (`J` toggles) | `left = plate.left`, `top = max(20, ceil(plate.bottom)+8)`, width `clamp(round(0.34*uiW), 260, 370)` capped to `uiW-left-12`, max-height `max(96, uiH - top - 108)`, pad 12, radius 8, scroll; title `QUESTS` 16px caps + `J` badge; rows (card bg, left rule 3px quest colour, dashed when closed/expired, outline when tracked) with name 13px, kind 10px caps, time (gold tabular), giver/reward 11px, objective 12px, progress meter 4px, Accept state badge in words, Track/Talk buttons; footer "+N rumoured quests" | questLogLayout.ts:6-48; questLog.css:5-70 |
| Quest tracker | bottom centre `bottom:112; z:7`, one line (12px ellipsis) + Untrack button, max `min(640, uiW-32)` | questLog.css:71-90 |
| Quest dialog (`F` at a giver) | `left:12; top:50%; translateY(-50%); z:9`, width `min(280*qdText, 0.46*uiW)` (narrow 240/.5), box pad 9/11/10 with left rule 3px quest colour; click-through except Accept (`[Enter]`) and Close (`[Esc]`); hint `Press [F] to close`; keyboard focus keys Enter/1 accept, Esc/F close | questDialog.css:8-96; questDialog.ts:175-190 |
| Giver / item markers | world-space markers + minimap blips; Tab map shows quest rail under the weapon guide | planning.css; questMap.ts |

## 13. Planning, lobby preview and the hold-Tab map (`ui/planning.ts`, `planning.css`, `mapRoster.css`)

One component, three `data-mode`s, all inside `#ui > .planning` (`z:10`, font 13px*textScale):

| Mode | When | Layout |
|---|---|---|
| `preview` | lobby (before planning) | card at `left:12; bottom:12` (narrow `bottom:96`), column gap 8, pad 8/10/10, width `min(--pl-size+20, uiW-24)` where `--pl-size = clamp(floor(min(0.36*uiH, 0.34*uiW)), 150, 300)`; panel bg, hairline, radius 8; map + title + one-line legend (zones list hidden; info/people hidden when narrow). World keeps the pointer |
| `planning` | phase `planning` | whole screen: `inset:0`, bg `rgba(8,10,14,.84)`, `padding: 44 12 12 12` (clears the chrome), scroll; body centred; **map** square `--pl-size = clamp(floor(min(uiH-180-(scale-1)*80, uiW-340*scale-48)), 260, 780)` (narrow: `clamp(min(uiW-24, 0.46*uiH),180,520)` above the column); **side column** `340*scale` wide: `Ready` button + ready count, spawn options (2 cards `1`/`2`), boons, players list (name + "ready/planning"), route box (text, `Undo stop`, `Clear route`, note "Click the map or a camp to add a stop"), info line, status line. Head: title 1.35em caps + timer 1.9em gold + 4px progress bar |
| `map` (hold **Tab**) | active run, not practice, results not showing | `inset:0`, padding 12, bg `rgba(8,10,14,.5)`; body = 3-column grid `[roster 250*scale clamp 190-290] [map] [rail 250*scale clamp 190-290]`, gap 12, centred, `max-width uiW-24`, `max-height uiH-24`; **map side** `clamp(floor(min(uiH-200, uiW-48)), 240, 820)`, tab layout recomputed by `tabMapLayout` (stacked below uiW 900: map `min(uiW-24, 0.64*uiH)` on top, roster and rail below, 2 columns). **Left**: ranked roster (rank, name, champion, strength, 2 weapon chips 38 x 34 with slot digit, equip dot, stat chips with 17 px icons). **Right**: weapon counter wheel + quest list. Everything is click-through except route stops/camps/quest marks, the roster and the rail |

Map internals: three stacked canvases (base, fog, dynamic route) plus DOM zone labels (11px*glyph caps, zone shape = clip-path glyph), camp markers 22 px (elite 30) with reward badges (9px), chest badge "Aug", crown/elite glyph, cleared = dimmed + X, disturbed = small ring; actors (you = cyan disc 12 px, enemy = red diamond, corpse = green X) with 9px labels. Keys: `Tab` hold (browser focus walk suppressed only when allowed), `1`/`2` spawn, click add stop, `Delete` remove focused stop, arrows/PgUp/PgDn walk markers, `Enter` presses the focused button. Settings: "Map text size" 100/125/150% scales text via `--pl-text`.

## 14. Trader

`.trader-panel` (`traderPanel.css:1-9`, `traderPanel.ts`): **bottom-left card**, `left:16; bottom:116; z:8`, width `min(360, uiW-32)`, pad 16, gold border `#c8ac69`, radius 10, shadow. `h3` trader name 17px gold; description 12px/1.5; **choices** = grid gap 8 of full-width buttons (pad 10, 12px, left aligned, gold hover): stat trader shows 3 stat-exchange offers (or "Considering your build..." / "Your stat trade is complete for this run."); weapon trader shows `barterLabels(held)` incl. a small-potion-for-weapon option; close `x` top-right dismisses until you walk away. Opens automatically within `TRADER_RANGE` with line of sight; 700 ms pending lock after a pick.

## 15. Main menu, hub and lobby (`ui/menu.ts`, `hub/hubLayout.ts`, `scenes/HubScene.ts`, `ui/hub/*`)

The hub is a **walkable world scene** with a DOM menu panel over it - not a screen of buttons.

### 15.1 Menu panel (`.panel.menu`, `style.css:122-136,161-236`, `menuDock.css`)
- States: **centred** (default, `left/top 50%`, width `min(0.92*uiW, 520)`, max-height 0.88*uiH, pad 20/24, h1 `RAID` 22px tracking .08em) -> **docked** (`left:12; top:12; width:330; max-height uiH-24; pad 12/14`, h1 18px; only the picked faction card shows its detail; hint hidden when short) -> **collapsed** (`max-width min(300, uiW-24)`, pad 8/10, callsign + GV strip only, status line stays). Toggle: 26 x 26 `<`/`>` button in the header (`menuDock.css:10-25,33-70`).
- Column order (`menu.ts:191-205`): head (`RAID`, strip, dock toggle) -> **Callsign** row (input + `Load`) -> placeholder/loading -> `Champions & weapons - guide` button -> scrolling **body** [who/title line, **GV card** (balance 34px gold + "Glorious Victory", lifetime + this-month sub-stats), **stat tiles** (5-column grid), **Cosmetics** row (count + Shop / Wardrobe / Titles... small buttons), **Top this month** leaderboard (rank, name, GV), **faction picker** (5 cards, 4px faction-colour left rule, name 15px 700 + role + weapon pill; detail lines "beats / loses to"), rules text 12px, controls text 12px] -> **lobby activity** card (max 236 high; presence, capacity, per-game people lists) -> **actions** row: `Start Run` (primary, flex 1) + `Training` (pad 10/14, 600) -> status line (min-height 2.7em) -> hint "Playing in two tabs? ...".
- Hub panels (Shop, Wardrobe, Titles, Achievements, Leaderboard, Counters, Champions guide) open as a modal over a `--scrim` backdrop: `.hub-panel` width `min(0.94*uiW, 760)`, height `min(0.86*uiH, 680)`, pad 12/16/14, header (name 18px + GV 18px gold + `x` 22px), tab bar (6/12 tabs, selected = card bg + gold text), scrolling body with `repeat(auto-fill, minmax(138px, 1fr))` card grid gap 8 (swatch, name, price/owned tag), wardrobe = `168px | 1fr` with a sticky 56 px avatar preview. Clicking the backdrop closes.
- Visibility: shown in the hub scene and whenever no run is joined; replaced by the HUD in a run.

### 15.2 Hub world (`hubLayout.ts`, world px, TILE = 32)
Room 28 x 18 tiles = **896 x 576**; floor inset 1 tile; spawn (448, 408). Stations (interaction = within `PLAYER_RADIUS 12 + 20 = 32` of the footprint; key **E**; prompt `E: <verb>` 13px bold gold):
`arena` stairs 160 x 32 at top centre (448, 16) label "THE ARENA" 14px; `training` door 32 x 96 on the east wall at y = 288, "TRAINING GROUNDS"; four west kiosks 56 x 64 at x = 60, y = 100 / 204 / 308 / 412 (**SHOP, WARDROBE, ACHIEVEMENTS, LEADERBOARD**), sign 8 px east of the counter, 11px; `counters` decal 440 x 160 at centre (448, 288) "WEAPON COUNTERS"; five faction pedestals 48 x 48 on an arc at (248, 456), (348, 492), (448, 504), (548, 492), (648, 456), label 11px with role; four 32 x 32 pillars at (136, 128), (728, 128), (136, 472), (728, 472). The view centres the room in the space right of the docked menu (`HubScene.ts:293-320`). Controls: WASD/arrows, right-click walk (hold to steer), left-click a station to walk and use it, **E** use, **Shift** (held) in the champions guide shows detailed abilities.

## 16. Loading and boot

`#boot` (`index.html:29-52`, `ui/loading.css`, `ui/loading.ts`): full-window `position:fixed; inset:0; z:1000`, centred column gap 18 on a radial gradient `#1d232b -> #12161b`; **title `RAID`** 40px 800 tracking .32em gold; **spinner** 34 x 34, 3px ring, gold top arc, 0.9 s; **text** 15px muted (`Loading...`, then connect/join messages via `setText`); after 15 s with no bundle the text becomes "The game could not start. Check your connection and reload the page."; fades out in 220 ms and stops taking input as soon as it starts hiding. Self-contained (inline CSS) so it paints before any script. Not part of `#ui`.

## 17. Keyboard map (consolidated)

| Context | Keys |
|---|---|
| Anywhere | `Alt+Enter` fullscreen, `H` help, `Esc` close panel (settings/help/chest focus/quest dialog) |
| Run (alive, not planning) | `W A S D` / arrows move, left-click attack (hold repeat; wand locks), right-click move, `1` `2` slot, `Q` swap, `E` potion, `F` pick up / talk, `R` Wish, `J` quest log, `Enter` accept offer, `C` then `1 2 3` / `0` chest panel, **hold `Tab`** map, `Esc` leave practice |
| Planning | `1` `2` spawn, click map, `Tab`/arrows/PgUp/PgDn navigate, `Enter` activate, `Delete` remove stop |
| Hub | `WASD`/arrows, right-click, `E` station, hold `Shift` guide detail |
| Minimap | right-click move, hold left = peek |

## 18. Unity counterparts today, deviation, and canvas scaling

### 18.1 Canvas scaling in Unity (verified in code)

- One `Canvas` per `MatchHud`: `MatchUI`, **`RenderMode.ScreenSpaceOverlay`**, `CanvasScaler.uiScaleMode = ScaleWithScreenSize`, **`referenceResolution = 1920 x 1080`**, **`matchWidthOrHeight = 0.5`** (`client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs:67-76`). No other canvas scaler exists in `Assets/Scripts`.
- Layout is almost entirely **normalised anchors** (fractions of the whole screen, origin bottom-left), via helpers `Panel/Text/Button(parent, name, ..., x0, y0, x1, y1, size)` and `MythicUi.Panel/Text/Button/Rect(..., Vector2 min, Vector2 max)`. There are no pixel offsets from a corner, so every panel stretches with the screen's aspect ratio. Font sizes are TMP canvas units (e.g. 14-30) with an auto-size floor of 75% and a user text scale (`ShowcaseSettings.TextScale`, `MatchHud.cs:135-148`).
- Effective scale factor for `match=0.5` is `f = sqrt((w/1920) * (h/1080))`. Canvas units == screen px only at 1920 x 1080.

### 18.2 CSS px to canvas-unit conversion

Legacy `s` (section 0.1) and Unity `f` differ, so a single multiplier is exact only at 16:9 and an unclamped `s`:

| Window | legacy `s` | Unity `f` | **1 legacy CSS px = canvas units** (`s / f`) |
|---|---:|---:|---:|
| 1280 x 800 | 1.000 | 0.703 | 1.42 |
| 1366 x 768 | 0.960 | 0.711 | 1.35 |
| 1920 x 1080 | 1.350 | 1.000 | **1.35** |
| 2560 x 1440 | 1.500 | 1.333 | 1.125 |
| 3440 x 1440 (stage 3360) | 1.500 | 1.333 (full screen) | 1.125, plus stage width clamp |

**Recommendation** (decide with the owner; both satisfy "exact layout"):
1. **Preferred - reproduce the legacy scaler.** Replace the `ScaleWithScreenSize` scaler with `ConstantPixelSize` and set `scaleFactor = s = clamp(min(stageW/1280, stageH/800), 0.8, 1.5)` on every resolution change, with a "stage" RectTransform that is at most 21:9 wide and centred. The canvas is then `uiW x uiH` canvas units and **1 canvas unit = 1 CSS px** exactly; every number in this document (offsets such as `right:12`, `bottom:14`, widths 104/76/270/248) can be used literally with corner anchors and pixel sizes, `data-ui-short`/`-narrow` become `uiH < 760` / `uiW < 600` checks. Text sizes then also transfer 1:1 (11px, 13px, 15px ...).
2. **Fallback - keep the 1920 x 1080 scaler.** Author at 1920 x 1080 with **canvas units = CSS px x 1.35** (so `right:12` -> 16.2, `bottom:14` -> 18.9, weapon slot 104 x 76 -> 140 x 103, minimap 270 -> 365), anchored to corners rather than screen fractions, and accept that on non-16:9 or clamped windows the UI scales with the geometric mean rather than legacy's min-of-ratios.

### 18.3 Legacy element -> Unity file, and how far it deviates

Unity rectangles are the normalised anchors in the code, converted at 1920 x 1080 (1 u = 1 screen px; /1.35 = CSS px). "Legacy" is the section above.

| Legacy element | Unity counterpart (file:line) | Unity position / size (CSS px @1080p) | Deviation from legacy |
|---|---|---|---|
| Chrome buttons (fullscreen, settings, help; top right) | `MatchHud.cs:78-80` + `MatchHud.IconPresentation.cs:28-43` (three square buttons Help, Settings, Leave) | x .86-.981, y .93-.99: each ~50 x 48 CSS, pitch ~61 CSS, right inset 27, top 8 | **Medium.** 50 vs 30 px, gap 11 vs 6, right inset 27 vs 12. Different set and order (Help, Settings, **Leave**; legacy Fullscreen, Settings, Help); no fullscreen button and no fullscreen handling anywhere in `Assets/Scripts` or the WebGL template (grep: zero hits), perf readout is a separate line at top centre-right (`MatchHud.Features.cs:187`, x .40-.66, y .855-.92) instead of left of the buttons |
| Perf readout (fps/ping) | `MatchHud.Features.cs:187,TickMetrics` | x .40-.66, y .855-.92 (second row under the header, near top centre) | **High position, same content** ("FPS n . PING n ms"); legacy is a pill left of the chrome buttons |
| Minimap (bottom right) | `TacticalMapController.cs:103-108,141-147` (`_miniRoot`), surface `TacticalMapSurface.cs` | root x .705-.985, y .018-.378 = **398 x 288 CSS** landscape card incl. a `TAB . MAP` button strip; the square map (AspectRatioFitter FitInParent) is **~225 x 225** CSS, **108 px from the right edge and 66 px from the bottom** | **High.** Legacy 270 square, 12/12 from the corner, no button strip. Unity map is 83% of legacy size, floats ~96 px further left and ~54 px higher inside a wider card; scale choices .85/1/1.25 vs .75-2 |
| Weapon bar (slots, Q swap, Wish slot, consumables, hint, controls line) | `MatchHud.Features.cs:100-142` (`CombatActions` panel) | x .315-.615 = **427 x 96 CSS**, centre at **46.5%**, bottom 12 | **High (structure).** Legacy 284 x 76 slots centred at 50%, 14 from bottom. Unity is wider (427), 3.5% left of centre, merges Wish summary + pickup into a right column, adds a potion button, drops the Q swap chip between slots, the 26 px swatch, the scaling line, per-slot cooldown wipe and the consumables/controls rows |
| Wish slot (64 x 64, key R, cooldown, charges) | `MatchHud.Features.cs:101-109` (`WishInfo` button, "R . -") + hidden `WishPanel` (:111) | right column of the action panel | **High.** Text summary not a docked 64 px ability tile with sweep and cast bar |
| Pickup hint above the bar | `MatchHud.Features.cs:137` (`Pickup` button "F . PICK UP") | inside the action panel | **Medium.** Button inside the bar vs a transient hint pill above it |
| Champion combat HUD (bottom left, 250 w, auto/passive/wish rows) | **no equivalent**; nearest is `DamageOutputPanel` `MatchHud.IconPresentation.cs:45-60` | x .015-.285, y .018-.138 = 384 x 96 CSS, bottom 14, left 21 | **High (content).** Legacy shows champion + weapon + 3 stat rows with scaling and tooltips, 250 wide, bottom 48; Unity shows weapon / damage-per-hit only, and sits where the legacy Quests launcher is |
| HUD plate - health row (top left) | `MatchHud.Features.cs:90-98` (`VitalsPanel`, `OwnerVitalBar`) | x .015-.285, **y .146-.266 = bottom-left**, 384 x 96 CSS, bottom 117 | **Very high.** Legacy: top-left, 224 px wide plate, 8 px bar max 108 px wide. Unity moved it to the bottom-left in a 96 px-tall panel with a 22-unit text line (owner feedback 2026-11-08 asked for stats top-left, now superseded by "legacy exactly") |
| Lobby / training status line (plate line 1-2) | `MatchHud.cs:77` `Connection` text + `Features.cs:186` `PhaseTimer` | top-left (x .02-.30) and top-centre (x .31-.60), y .925-.99 | **Medium.** Content roughly equivalent ("RAID . mm:ss", "PRACTICE . ..."); legacy puts it in the top-left plate and Coliseum countdown at exact top centre |
| Build HUD (256 w, 9 cells, "Gained") | `MatchHud.Features.cs:143-169` (`BuildStrip`, 8 cells + `B . BUILD DETAILS` button), `BuildDrawer.cs` for details | x .015-.285, y .645-.915 = **384 x 216 CSS**, top 68, left 21 | **High.** Legacy 224 effective width x ~70 high, directly under the health row (top ~35). Unity: 4 x 2 grid of 8 stats (no `damage` cell, different labels OFF/SOUL/DEF/S.DEF/HP/ATK/MOVE/LEECH), a focus label and a big button; 1.7x wider, 3x taller, ~33 px lower |
| Cards row / mob bonuses | **no HUD equivalent**; folded into `BuildDrawer.cs` ("FIELD LEDGER", x .57-.985, y .025-.975, right drawer 590 x 760 CSS) | opened with B | **High.** Legacy keeps cards and mob stats in a collapsed `<details>` on the plate |
| Connection banner (top centre pill) | `MatchHud.cs:77,260-275` (`_banner` text) | x .02-.30, y .925-.99, top-left, plain text | **High.** Top-left text, no pill/spinner/tone states, no reconnected flash |
| Coliseum / arena timer (top centre) | `MatchHud.Features.cs:186` (`PhaseTimer`), `TickMetrics` | x .31-.60 (centre 45.5%), y .925-.99 | **Medium.** Shows `RAID . mm:ss` elapsed time, not the Coliseum countdown / sudden death line |
| Toasts / notices | `MatchHud.cs:85` `_notice` text; history in `OrderedNoticeFeed.cs:39-46` (`RecentServerNotices` x .405-.665, y .735-.845) | `_notice` x .32-.61, y .15-.22 = bottom ~120, centre 46.5% | **Medium.** Vertical spot matches (120 vs 124), but one line of plain text vs a stack of up to 3 toned pills, and 3.5% off centre. A second notice box sits mid-screen |
| Death line | not found in `Scripts/UI` (results panel only) | | **Missing** |
| Hp / name bars over actors | `Presentation/SpriteActorPresenter.cs:222-240`, `OwnerVitalBars.cs`, `FactionIndicators.cs` (world-space SpriteRenderers) | bar width .85 u world, 0.055-0.11 u tall, at y +1.8 u | **Medium.** Bar is faction/own coloured (`Hp.color`), legacy colours by hp share green > amber > red; no hp-tier colouring |
| Edge threat glows | not found | | **Missing** |
| Chest choice (right edge) | `MatchHud.cs:86-96` (`Rewards`, 3 options + Skip + `Next chest`) | x .70-.985, y .425-.915 = **405 x 392 CSS**, right 21, top 68, bottom 340 | **Medium.** Same side/vertical band, 1.6x wider than 248; has an extra "Next chest" button; legacy panel is anchored to the minimap top via `--mm-size` (Unity shifts `anchorMin` with minimap scale, `Features.cs:196-202`) |
| Quest panel (log / launcher / tracker / dialog) | `QuestJournalView.cs:53-70` (+ `MatchHud.PlayerFlows.cs:39` launcher `J . JOURNAL`) | journal x .12-.88, y .12-.915 = **1081 x 636 CSS centred modal**; launcher x .315-.395, y .855-.915 (top) | **Very high but out of scope:** owner says re-skin in place only. Legacy: 370 max docked log under the plate, launcher bottom-left, tracker bottom-centre, 280 dialog at left-centre |
| Trader | `TraderDialogView.cs:52-81` (tab of the same modal as quests/notices) | x .12-.88, y .12-.915 centred | **Very high** (legacy: 360 bottom-left card at 16 / 116; not automatic). Later phase |
| Settings (card under the gear) | `ModernSettingsView.cs:37-49` | x .16-.84, y .055-.945 = **967 x 712 CSS centred modal**, scrolling rows | **Very high.** Legacy: 320 wide card at top 48 / right 12, non-modal, five sections |
| Help card | `MatchHud.Features.cs:189-192` (`ControlsHelp`, plain text, no tabs) | x .18-.82, y .28-.90 = 910 x 496 CSS | **High.** Legacy 560 max card with Controls / Mechanics tabs |
| Results | `MatchHud.cs:97-103` (`Results`, scroll text, `Play again` / `Return to menu`) + `MatchHud.Settlement.cs` | x .22-.78, y .28-.85 = **796 x 456 CSS** | **High.** Legacy 440 wide, outcome-coloured top rule, 38 px title, fact tiles, GV box, achievements, one button |
| Tab map / planning | `TacticalMapController.cs:63-102` (`TacticalMap`, `PlanningDecisions`, `TacticalInformation` rails) | panel x .025-.975, y .155-.915 = 1351 x 608 CSS; map frame .02-.69; right rail .715-.98 | **Medium.** One big panel for planning and Tab map (legacy: planning full screen with 340 column; Tab = map flanked by 250 roster and 250 weapon-guide rails); Tab can be toggle or hold (`UiDisplayPreferences.MapToggle`); no lobby corner preview |
| Hub scene / walkable room | `HubAtriumView.cs:71` panel x .37-.98, y .17-.87 (cosmetic 2D "atrium", 868 x 560 CSS) | | **Different model.** Legacy hub is a 896 x 576 world-px room with kiosks/pedestals and a camera; Unity is a panel with station buttons and a small avatar |
| Main menu / join menu | `MatchHud.Accounts.cs:25-53` (`JoinMenu`) | x .015-.35, y .17-.91 = **476 x 592 CSS** left panel | **Medium.** Legacy docked 330 wide at left 12 / top 12 (or 520 centred); Unity is 1.45x wider and starts lower |
| Hub panels (shop, wardrobe, progress, guide) | `HubCosmeticsView.cs:157` (x .37-.98), `HubProgressView.cs:88-90` (card x .09-.91), `HubGuideView.cs:174` (x .065-.935, y .055-.945), `WeaponCounterGuide.cs` | near-full-screen cards | **High.** Legacy 760 x 680 max modal with tabs |
| Training console | `TrainingConsoleView.cs:36-62` (x .015-.48, y .18-.88, `CONSOLE` toggle) | 661 x 560 CSS | **High.** Legacy: bottom-left bar, 296 wide console panel |
| Loading / boot | not in `Scripts/UI`; WebGL template `Assets/WebGLTemplates/Roguehalla/index.html` (`#unity-loading-bar`, gold progress bar on dark) | | **Different** (progress bar, not title + spinner); skin work, not layout |
| Resume / settlement / sign-in / recovery dialogs | `MatchHud.Resume.cs:33-44`, `MatchHud.Settlement.cs:15`, `MatchHud.Accounts.cs:55-70`, `AccountRecoveryView.cs:29-34` | centred modals (22-78% wide) | **New in Unity** (account-backed hub); no legacy equivalent beyond the callsign field |
| Chat / kill feed | none in either client | | n/a - not to be built |

### 18.4 Summary of the largest deviations (inputs for the re-skin plan)

1. Health moved **top-left -> bottom-left** (legacy plate is top-left).
2. Build HUD: 1.7x wider and ~3x taller than legacy, plus a different cell set (8, not 9); cards/mob bonuses have no HUD home.
3. Minimap: landscape card with a button strip, map 83% of legacy size and ~96 px / ~54 px away from the corner.
4. Weapon bar: 50% wider, off-centre by 3.5%, no swap chip, no Wish tile, consumables/controls rows absent.
5. Champion combat HUD missing (a damage readout sits in its place, on top of the Quests launcher position).
6. Settings and Help are large centred modals, not a small anchored card / tabbed 560 card.
7. Chrome: wrong set/order (Leave instead of Fullscreen), 1.7x larger, fps readout detached.
8. Banner, toasts and death line: no pill/stack/tone model; death line and edge-threat glows absent.
9. Everything in Unity is laid out in screen **fractions**, so deviations also grow on ultrawide and shrink on 4:3; legacy keeps pixel offsets and clamps at 21:9.
