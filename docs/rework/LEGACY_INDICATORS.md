# Legacy indicators audit (world and actor-attached) and the Unity pass

Scope: every marker, bar, ring, readout and screen effect the legacy Phaser client draws in the world or attached to an actor, plus the
HUD readouts `docs/rework/LEGACY_LAYOUT.md` does not cover. Owner direction (binding): a final UI pass against the legacy version, "such
as the indicators above someone's head about what stat they have most of, or secondary weapon indicator". Keep the legacy information
hierarchy; replace only the look (settled skin: slate/cream/gold, generated sprites, Cinzel/Nunito). Read-only extraction from
`packages/` (code wins over `docs/legacy/*`). Protocol checked: **16** (`Wire.ProtocolVersion`).

Legacy units: world px = screen px at zoom 1 (900 world px visible top to bottom). Constants: `PLAYER_RADIUS` 12, `FIGURE_RADIUS` 13.2
(`PlayerView.ts:23`), `BODY_LIFT` 14 (`projection.ts:6`), `Y_SCALE` 0.8 (`constants.ts:617`). The feet are (0,0); the body disc centre is
`-BODY_LIFT`. Name plate bottom `LABEL_Y = -BODY_LIFT - 13.2 - 18` = **-45.2** (`PlayerView.ts:65`); hp bar top `-BODY_LIFT - 13.2 - 8` =
**-35.2** (`PlayerView.ts:285`, `MobView.ts:22`).

## 0. What the wire really delivers for an actor (protocol 16)

This decides every "data" cell below. Remote actor row (`WireActor`, `Protocol/Messages.cs:646`; `InterpActor`, `Net/SnapshotBuffer.cs:8`):
id, x, y, facing, **bounty**, faction, **hp percent (0..100)**, status, **held weapon only**, kind (player / regional mob / zombie / dummy /
quest giver), displace seq, mob type code, **sig** byte (chilled 1, burning 2, diseased 4, execute 8, exec-blocked 64), **effects** u16
(the legacy `EFFECT_*` bits 1..4096), **barrier percent**, barrier ring step, archetype id. Self row (`WireSelf` -> `SelfView`,
`Net/Views.cs:93`): the above plus exact hp/maxHp, kills, gv, hunt target and stacks, barrier, Wish (ready/charges/cast), owner combat
(attack lock target, attack-ready time, attack/windup/speed multipliers in milli). State collections (`Net/Collections.cs`): own
inventory (both slots and the active one), own build (card ids, boosts), props (focus handle, chests, ground weapons, corpses, quest
items), camps (type, elite, alive, state, respawn), reward chests, quests (givers, own accepted/progress, objectives), trade (merchants
with position and name), arena clocks, fields. **Not on the wire for anyone**: names, bot flag, the off-hand weapon of a remote player,
any build/stat mirror of a remote player, mark tier/brand/tax, Wish ready time of a remote player, immunity, roam charge, windup/draw
telegraphs of remote actors, crit and heal fx, ward ownership, camp territory, mob stat rewards, weapon reach numbers.

## 1. The two indicators the owner named

### 1.1 "Which stat they have most of" (overhead stat marks)

Legacy: `PlayerView.drawBuildMarks` (`PlayerView.ts:453`), fed by `combatReadability(p).investedStats` (`shared/src/combatReadability.ts`).

- Eligible for every drawn player, remote or local, always (no threshold other than a score above 0.01).
- Scores (one unit is roughly one base-card tier of that stat): ad `adBonus/12`, ap `apBonus/12`, damage `generic damage/0.01`,
  health `(maxHp/baseHp - 1)/0.09`, attackSpeed `(asMult - 1)/0.09`, armor `armorBonus/15`, mr `shieldBonus/15`, speed
  `(speedMult - 1)/0.06`, leech `lifesteal/0.05`. The mirrors (`adBonus`, `asMult`, ...) and the card, mob-stat and camp-clear counts are
  public synced state in legacy.
- Chosen: every score above 0.01, sorted descending; **the top two** are drawn (`investedStats.slice(0, 2)`, `PlayerView.ts:454`). Equal
  scores keep the fixed key order ad, ap, damage, health, attackSpeed, armor, mr, speed, leech.
- Icon: an 18 x 18 dark rounded square (`0x101820`, alpha .95, radius 4), 1 px border in the stat colour, the stat glyph at 13 px in the
  stat colour (`combatIcons.ts` `STAT_ICON_COLORS`: ad `ffb074`, ap `c4a0ff`, damage `ffd36a`, health `62d889`, attackSpeed `ffdc78`,
  armor `d5e0e8`, mr `75cfff`, speed `80d6ff`, leech `f05260`). Tooltip name `"<label>: <score 2dp>"`.
- Position: a row of three fixed spots centred at x = 0: the **secondary weapon at x = -18, stat 1 at x = 0, stat 2 at x = +18**, row
  centre y = `LABEL_Y - 27` = **-72.2**; when a bounty crown shows, the row sits above the crown at
  `CROWN_BASE_Y - 13 * crownScale - 14` (`PlayerView.ts:458`).
- Redrawn only when the secondary weapon or the rounded scores change.

### 1.2 Secondary weapon indicator

Same function. `secondary = heldWeapon({weapon0, weapon1, slot: slot === 1 ? 0 : 1, faction}) ?? FISTS`: the weapon in the slot that is **not**
in hand; an empty slot reads as **fists** (a fighter with a faction always has fists). Drawn for every player, always, in the left spot, as
the same 18 px dark square with a border in the weapon's colour (`WEAPONS[w].color`) and the weapon silhouette scaled 0.33
(`BUILD_MARK_WEAPON_SCALE`). Tooltip name `"Secondary weapon: <name>"`. For the local fighter the slot is the predicted one (so a Q swap
shows at once).

**Unity today**: neither exists. Data: the secondary weapon of the **local player** is delivered (`InventoryView.Slot0/Slot1/ActiveSlot`);
for **remote players it is not** (`WireActor` carries the held weapon only). The stat scores are not computable on the client for anyone
without inventing card formulas (Unity holds only card display strings, `CardDisplayCatalog.cs`; the wire carries card ids, not mirrors),
and the remote build is not delivered at all. See section 4 (B1, B2).

## 2. Audit table

Columns: **ID** | indicator and when | exact legacy presentation | source | data needed -> Unity receives? (field) | Unity status
before this pass | action. Status words: *match* (present, same information and placement, new skin), *differs*, *missing*, *n/a*.

### 2.1 Player overhead and body

| ID | Indicator / when | Legacy presentation | Source | Data -> Unity | Before | Action |
|---|---|---|---|---|---|---|
| P1 | Body disc in faction colour with a dark rim; the local player has a white rim and a white 2 px ring on the ground (always) | disc r 13.2, rim 2 px `111111` a.8 (local `ffffff` a.95); local ring ellipse 34.8 x 27.8, `ffffff` a.9 | `PlayerView.ts:51,60-61,118` | faction, local id -> yes | differs by decision: sprite character, faction footprint outline on the ground (owner: no coloured outlines around sprites) | keep |
| P2 | Name plate (always) | 11 px system-ui, `#eceff1` (local `#b9f6ca`), black stroke 2, centre-anchored, bottom at y -45.2; `[BOT] name` for bots | `PlayerView.ts:65,189`, `displayName.ts:13` | name, bot flag -> **no** | missing | blocked (B3) |
| P3 | Level / GV plate | **none in legacy** (GV is only in the HUD plate and the results; see LEGACY_LAYOUT 6) | `PlayerView.ts` (no field) | n/a | n/a | none |
| P4 | Health bar (always for players; fights/hurt/elite rule for mobs, see M2) | 28 x 4 px (players), top y -35.2, back black a.6; fill **green `66bb6a` above 50%, amber `ffca28` above 25%, red `ef5350` at or below 25%** of max hp (the colour follows hp, not the shrunk bar); the barrier is a **`81d4fa` segment appended after the hp fill on the same bar**, the bar rescales so hp + barrier fit (`hpBarFractions`); no ticks | `FighterArt.ts:362-394`, `buffTheme.ts:4` | hp pct, barrier pct (self: exact) -> yes | differs: bar is 1 unit wide, **fill is the faction colour** (self mint) and the barrier is gold; no threshold colours | fix |
| P5 | Barrier bubble (own barrier > 0) | circle r 16 at body centre: fill `81d4fa` a .10 + .14 * s, 2 + s px stroke a .45 + .5 * s; `s` = step/8, 8 steps of a full shield (`barrierStrength`) | `PlayerView.ts:412` | barrier ring step (0..8) -> yes | present: 8 gold ring segments above the head (different look, same step data) | restyle to barrier blue token |
| P6 | Faction Wish icon beside the name (not in lobby) | 15 px ability glyph left of the name, colour when ready, grey when not; at y `LABEL_Y - 6.5` | `PlayerView.ts:394-410` | remote Wish ready time -> **no**; self -> yes (`SelfView.Wish.ReadyAt`) | missing | self: weapon-bar R slot already shows it (kept there); remote blocked (B4) |
| P7 | Bounty crown + number (bounty > 0, alive) | gold crown `ffd54f`, edge `5d4037`, 22 x 13, scales `1 + 0.5 * min(1, bounty/150)`, base y -61.2 (`LABEL_Y - 15`), centred; number 11 px bold `#ffe082`, black stroke 3, just above the crown | `PlayerView.ts:34-39,483` | bounty -> yes (`InterpActor.Bounty`, `SelfView.Bounty`) | missing | build |
| P8 | Mark plate pips (Sentenced marks, tier 1..4, active run) | 4 pips 5 x 3 px, gap 4, at `LABEL_Y - 12`: colours `9e9e9e`, `ffb300`, `e53935`, `171717`; lit up to the tier, others a .2; dimmed to a .28 beyond 300 units unless in the Trial; top lit pip outlined white a .7 | `MarkPlate.ts:4,25-37`, `markPresentation.ts:2` | mark tier -> **no** | missing | blocked (B5) |
| P9 | Mark text cues (Taxed / Suppressed / exec blocked) | 9 px bold white, stroke 2, right of the name: `AS -N%`, `DMG -N%`, `EXEC BLOCKED` | `MarkPlate.ts:39-44` | tax % -> no; sig bits 16/32/64 -> bits 16, 32 are not in the Unity known mask (`SpriteActorPresenter.cs` `KnownSignatureMask`); 64 yes | exec-blocked has a signature icon; taxed/suppressed fall into "unknown" | build what bits allow (exec-blocked text glyph kept as icon); tax % blocked (B5) |
| P10 | Title under the feet (cosmetic) | 10 px bold in the title colour, y +9 | `PlayerView.ts:72,187` | look word -> **no** | missing | blocked (B6) |
| P11 | Golden faction halo / outline mix (cosmetic look) | gold fill circle a .2 + 2 px ring, pulses .7..1 every 350 ms | `PlayerView.ts:76,380` | look word -> no | missing | blocked (B6) |
| P12 | Strength glow (card power) | soft gold perimeter, 8 steps of `readability.power` | `PlayerView.ts:439` | build power -> no | missing | blocked (B2) |
| P13 | Teleport-immunity ring (arrival in the coliseum) | 3 px ring `4fc3f7`, r 24, alpha .35 + .65 * left/1500 ms | `PlayerView.ts:290-296` | `immuneUntil` -> **no** | missing | blocked (B7) |
| P14 | Fire roam-ready glow | pulsing orange double ring r 17..20 when Fire's roam is armed | `PlayerView.ts:309` | `roamReady` -> **no** | missing | blocked (B8) |
| P15 | Hidden fighter (Swarm): remote not drawn, local drawn at alpha .45 | alpha 0.45 | `PlayerView.ts:58,246` | effects bit 256 -> yes | missing (remote hidden actors are still drawn) | fix: hide remote, 0.45 for own |
| P16 | Hit flash | body painted white 120 ms on a landed hit | `PlayerView.ts:25,146`, `FighterArt.ts:463` | Hit fx victim -> yes | present as the Hit clip (`SpriteActorPresenter` `HitUntil`); no white flash | keep (the clip carries it) |
| P17 | Local attack lock ring and hover ring | hover: 1.5 px ring `eceff1` a .85, 37.2 x 29.8 under the fighter a click would lock; lock: red `ff5252` fill a .2 + 4 px ring + inner ring `ff8a80`, breathes (3.5% over 1.7 s), lands with a 1.6x pulse and a white flash ring over 180 ms | `TargetRings.ts:17-71` | lock target -> yes (`OwnerCombatView.Lock.Target`); hover -> client-only pick (`ActorPick`) | missing | build lock ring; hover ring built from the existing pick |
| P18 | Weapon range ring (local, active run) | ground fill `b6e6ef` a .04 (circle .018) + 6 px a .055 + 1 px a .23; arc sector (melee), lane (bow), circle (wand); depth under all actors | `WeaponRangeView.ts:8,69-96` | reach / half-arc / range numbers -> **no** (weapon catalog is not on the wire; Unity must hold no rule constants) | missing | blocked (B9) |

### 2.2 Status icons and signatures (drawn on the fighter they act on; players and mobs)

Legacy layers, in draw order, from the synced `effects` bits (`StatusArt.ts:36`). Unity receives all 13 bits for every actor; before this
pass it drew 13 generic repeated sigils in a row at y 2.0 coloured by 4 groups (not distinguishable per status).

| ID | Bit | Legacy look | Source | Before | Action |
|---|---|---|---|---|---|
| S1 | stunned 1 | three little `ffee58` crosses circling the head (r 13 x 4), far ones a .6; plane head (y -(14+13.2+11) = -38) | `StatusArt.ts:255` | generic sigil | build: stun-star glyph in the overhead cluster |
| S2 | rooted 2 | iron ring round the feet (r 17), front half only, `37474f` 4.5 px + `b0bec5` 2.2 px, two chain links | `StatusArt.ts:139` | generic | build: ground shackle ring sprite |
| S3 | silenced 4 | 11.6 px face disc `263238` with `ce93d8` rim and crossed-out mouth, at the head's right (x +21) | `StatusArt.ts:268` | generic | build: silence glyph |
| S4 | slowed 8 | pale-blue `4fc3f7` streaks dragging behind the body | `StatusArt.ts:224` | generic | build: slow glyph (drag streaks) |
| S5 | attack-slowed 16 | 11.6 px clock face, `80cbc4`, hand creeping, at the head's left (x -21) | `StatusArt.ts:278` | generic | build: clock glyph |
| S6 | anti-heal 32 | white square with a red cross `ef5350` and a crack, beside the hp bar's left end (x -(halfBar + 9)) | `StatusArt.ts:290` | generic | build: cracked-cross glyph left of the bar |
| S7 | damage over time 64 | small flames `ff7043` / `ffca28` licking up off the body | `StatusArt.ts:234` | generic | build: flame glyph |
| S8 | untargetable 128 | dashed pale outline round the body | `StatusArt.ts:201` | generic | build: dashed-ring glyph |
| S9 | hidden 256 | see P15 | `PlayerView.ts:246` | none | fix (P15) |
| S10 | zoned 512 (Trial) | purple `b39ddb` link chain round the feet r 22 | `StatusArt.ts:170` | generic | build: chain-ring glyph (ground) |
| S11 | last stand 1024 | gold rim + faint outer rim hugging the body, pulsing | `StatusArt.ts:193` | generic | build: gold rim glyph |
| S12 | haste 2048 | short `fff59d` streaks off both flanks | `StatusArt.ts:212` | generic | build: haste glyph |
| S13 | casting 4096 | soft warm glow round the body that breathes | `StatusArt.ts:187` | generic | build: glow glyph |
| G1 | sig chilled 1 | pale film + icy rim `e1f5fe` + six crystals | `SignatureArt.ts:170` | icon (frost key) | match (icon) |
| G2 | sig burning 2 | rim `ff7043` + six rising embers | `SignatureArt.ts:157` | icon | match (icon) |
| G3 | sig diseased 4 | green haze on the floor + motes | `SignatureArt.ts:73` | icon | match (icon) |
| G4 | sig execute 8 | toothed ring on the floor (r 19..31, `c6ff00`) + skull right of the bar | `SignatureArt.ts:88` | icon | match (icon) |
| G5 | sig taxed 16 / suppressed 32 | text cues (P9) | `MarkPlate.ts` | folded into "unknown" | fix: named, not "unknown" |
| G6 | sig exec-blocked 64 | `EXEC BLOCKED` text with a skull glyph | `MarkPlate.ts:42` | icon | match (icon) |
| G7 | brand 0..100 (Sentenced mark growth) | floor sigil with a ring that closes at 100 and a pentagram gaining a stroke per fifth, purple `b388ff`; full: pulses + body glow | `SignatureArt.ts:117` | none | blocked (B5) |

### 2.3 Mobs, zombies, dummies

| ID | Indicator / when | Legacy presentation | Source | Data -> Unity | Before | Action |
|---|---|---|---|---|---|---|
| M1 | Role mark on the disc (always): swarm 3 dots, skirmisher chevron toward facing, caster inner ring, brute 5 px rim, grunt none | white over dark outline | `mobRole.ts:17-31`, `MobView.ts:254` | mob type -> yes | match (role badge, `ShowcaseIdentityOwner`) | keep |
| M2 | Mob health bar | 36 px wide (elite 48), shown **only when hurt or fighting**, always for elites and dummies; same colours as P4; mobs have no barrier | `MobView.ts:19,173-177` | hp pct -> yes; "fighting" (cooldown running / bow drawn) -> **no** | differs: always drawn | fix: hide at 100% for non-elites (fighting case blocked, B10) |
| M3 | Mob name (always) | 11 px `#b0bec5`, stroke 2, bottom y -45.2; faint (a .5) while calm; elite 12 px bold gold `#ffd54f` | `MobView.ts:23,177-183,242` | mob type -> yes (display name from `MobIdentityInfo`) | missing | build |
| M4 | Elite: gold double ring on the ground (r 20 and 25, `ffd54f`), gold 3 px body rim, 5-point star above the name (7/3 radius, `5d4037` edge) at y -68.2 | | `MobView.ts:32,112,242` | elite = type (last two of each zone) -> yes | present as the elite emblem badge | keep |
| M5 | Elite type emblem layers (wings, hood, halo...) | two baked layers under/over the disc | `eliteArt.ts:415` | type -> yes | match (elite glyph per type) | keep |
| M6 | Mob death: shrink to .45 and fade over 450 ms | | `MobView.ts:21,198` | status -> yes | present (death clip) | keep |
| M7 | Dummy: grey, bar and name always on | | `MobView.ts` | kind -> yes | present | keep |

### 2.4 Combat feedback and screen

| ID | Indicator | Legacy presentation | Source | Data -> Unity | Before | Action |
|---|---|---|---|---|---|---|
| F1 | Damage number | 700 ms rise 34 px; colour `ff5252` on me, `ffd54f` by me, `cfd8dc` otherwise; size 13 + min(7, floor(amount/40)) (+5 crit, shown `N!`); 5 lanes 9 px apart so simultaneous numbers do not overprint; starts at `BODY_LIFT + 12 + 20` above the feet | `FxView.ts:104-110,563-571` | Hit fx amount, victim, by -> yes; crit flag -> **no** | differs: one cream colour, fixed size, no lanes | fix |
| F2 | Damage-over-time number | 11 px per 500 ms chunk in the signature colour (burn `ffa040`, disease `b2d96c`, mark `d1a8ff`, backlash `ff7043`; bleed `e53935`) | `FxView.ts:111-120` | dot hits are not marked in the wire fx (`Passive` is) | missing | build only the distinction the wire carries (Passive -> small), colour blocked (B11) |
| F3 | Heal number `+N` and camp-heal ring | `81f78b`, 800 ms, starts higher (y +38), ignores < 1 | `FxView.ts:116,716,702` | heal fx -> **no** | missing | blocked (B12) |
| F4 | Impact bloom/dots, swing sector, windup telegraph | weapon-coloured sector (windup a .2 fill + 1.5 px line, wand: dot), swing sweep | `FxView.ts:489-540` | swing fx -> yes; windup (`ms`) -> **no** | swing: ring flash present; telegraph missing | blocked for remote windup (B13); own windup is local |
| F5 | Local hurt vignette | red vignette scaled by `damageFlash(amount, maxHp)`: min share .02, full .25, floor .25, linear decay 350 ms | `screenFeedback.ts:14-48`, `signatures.ts:160-173` | Hit fx victim = me, amount, self maxHp -> yes | missing | build (HUD overlay, reduced-motion aware) |
| F6 | Matchup tint (green/red screen tint vs nearest enemy) | up to a .16 | `screenFeedback.ts:19` | enemy stats -> **no** | missing | blocked (B2) |
| F7 | Camera shake on landed/taken hits | landed 0.0016 x 70 ms; hurt .0018..005 x 110 ms | `screenJuice.ts:19-59` | hit fx -> yes | not part of this pass (feel, not an indicator) | n/a |
| F8 | Death X decal on the ground where a player fell | 14 px half-width X, fades after 25% of life | `FxView.ts:84-92,687` | death event position -> not carried (event has id/by); last drawn position known | missing | build from last drawn position |
| F9 | Death / rampage announcements ("X was killed", "X is on a rampage - bounty N GV") | announce line | `FxView.ts:445-455` | names -> **no** | n/a (toast text covered by events) | blocked with names (B3) |

### 2.5 World objects and guidance

| ID | Indicator | Legacy presentation | Source | Data -> Unity | Before | Action |
|---|---|---|---|---|---|---|
| W1 | Container (loot) highlight under the one F would take | ground ellipse r 24, fill `ffd54f` a .08, 2 px stroke a .95, flattened by 0.8 | `ContainerHighlight.ts:9-30` | prop focus handle -> yes (`PropView.Focused`) | differs: pale-white ring | fix: gold token ring |
| W2 | Container labels (body/chest names, highlighted shows) | text above the container, bodies always, others when highlighted; `Chest`, weapon names | `ContainerView.ts:111-113,200` | `BodyLabel`, `CorpseLabel`, weapon -> yes | missing in world (HUD prompt carries it) | build for the focused prop |
| W3 | Reward chest ring draining over its life + seconds text when near; turns red late; drop cue | ring r by `CHEST_PICK`; steps of .25 s | `ContainerView.ts:30-68,153` | `ExpiresAt` -> yes | missing | build ring + seconds |
| W4 | Interact hint: "[F] take X / swap A for B" above the weapon bar | | `weaponBar.ts:89,189` | focus + inventory -> yes | present in HUD (LEGACY_LAYOUT 4) | keep |
| W5 | Quest giver marker: gold/kind diamond over the giver, `!` (22 px bold, kind colour, bright) offer not accepted, `?` (a .6) accepted, name label 11 px, `TRACKED` 9 px, `Turn in here` 12 px bold `fff59d` | | `QuestView.ts:120-165` | quest row (giver pos, ownerAccepted, ownerReady), actor kind 4 -> yes | missing (a neutral silhouette only) | build `!`/`?`/turn-in over the delivered giver |
| W6 | Quest item marker (fetch crate / token diamond), label when highlighted/tracked | | `QuestView.ts:154-165` | quest-item props -> yes | present as a prop; no marker | build small marker |
| W7 | Quest carrier flag over the carrier | 14 x 12 px kind-coloured flag at y -62 | `QuestView.ts:167` | carrier roster id -> actor id mapping not delivered | missing | blocked (B14) |
| W8 | Trader figure with name (12 px, kind colour `ba9bed` stats / `e2bc72` barter) and "Trade panel open" hint in range 112 | | `TraderView.ts:30-43` | merchants (pos, name, kind) -> yes | missing in world (map + dialog only) | build marker + name |
| W9 | Plague corpse puddle (eligible Plague only, in sight) | green puddle ellipses + pale bones | `PlagueCorpseView.ts:58` | corpse props -> yes (`PropAppearance.Corpse`) | present as a stone | fix: generated puddle sprite |
| W10 | Camp buff badge over a living camp (icon-only, 22 px per stat) | 24 px dark pill `101820` a .96, border `d7e6f3`, one glyph per distinct reward; elites show the augment glyph | `CampBuffs.ts:70-94` | mob stat reward per type -> **no** (content table not on the wire) | missing | blocked (B15) |
| W11 | Camp patience outline (union of leashes) + seconds text | cyan `a9f4f5` 10 px | `CampPatience.ts` | territory -> **no** | missing | blocked (B16) |
| W12 | Camp wards: beacon + `YOUR WARD 12s` / `WARD 12s` | 11 px mono, `66e4ef` own / `b9c6d7` | `CampWards.ts:56` | ward owner, expiry -> **no** | missing | blocked (B17) |
| W13 | Ground route preview (planned path) | dashed line + cyan rings on camp stops, fades as walked | `GroundRoute.ts` | client-side pathing -> yes | present? (route drawn on the map screen only) | out of scope (guidance, not an actor indicator); noted |
| W14 | Zone border strips (dashed per zone) | 3 px strips | `zoneEdges.ts:11` | map -> yes | region renderer (another agent) | excluded |
| W15 | Edge-of-screen threat glows | one dot per visible enemy on the screen edge, hue 0 (near) to 120 (far) over 150..VISION_RADIUS | `edgeThreat.ts:8` | actor positions -> yes | present (`EdgeThreatView`) | keep |
| W16 | Trail cosmetic, terrain feet FX | | `TrailView.ts`, `zoneArt` | look word / terrain -> no / yes | other agents (rendering) | excluded |
| W17 | Sentenced hunt picker + target mark | HUD list; the hunted fighter's mark | `sentencedHuntHud.ts:9` | hunt target (self) -> yes | HUD only | covered by HUD; world mark = lock-style ring on the hunt target: build with P17 ring in violet |
| W18 | Sudden death arena line / timer pill | | LEGACY_LAYOUT 6 | arena clocks -> yes | present | keep |

## 3. Champion HUD and build HUD readouts

`LEGACY_LAYOUT.md` section 5 and 6 list the champion HUD (head: champion name in faction colour, held weapon name in gold; rows auto /
passive / wish with value and scaling line) and the build/mob-bonus rows. Re-checked at protocol 16:

| ID | Readout | Needs | Delivered? | Action |
|---|---|---|---|---|
| H1 | Champion name + held weapon | faction, weapon | yes | present |
| H2 | Wish row: ability name, charges, ready/cooldown | `SelfView.Wish` | yes | present |
| H3 | Attack row value ("N dmg" with scaling line) and Passive row | per-hit damage, scaling terms, passive numbers | **no** (`OwnerCombatView` carries multipliers in milli and ready times only) | blocked (B18); the multipliers that ARE delivered are shown as attack-speed and move-speed multipliers where the row said "not delivered" |
| H4 | Mob-bonus row ("Mob bonuses: ...") | `mobStats` counts | **no** | blocked (B19) |
| H5 | Build cells ("Gained") | card ids, boosts | yes (`BuildState`) | present |

## 4. Not buildable: missing facts and the smallest wire additions

The coordinator schedules these; nothing here was added to the wire or invented on the client. "C-OBS" says whether exposing the fact
shows hidden state. In legacy all of these are **public synced state**; whether the Rust fairness model keeps them public is an owner call.

| ID | Missing fact | Rust holds it | Reveals hidden state (C-OBS)? | Smallest wire addition |
|---|---|---|---|---|
| B1 | Off-hand (second slot) weapon of a **remote** player | `Player.weapon.weapon1` (`crates/rh-sim/src/state.rs:454`); `ActorView` (`observe.rs:68-90`) has only the held `weapon` | Public in legacy (`weapon1` in the schema). Not hidden from sight; it is a loadout fact | Actor mask bit `MWeapon1` + 1 byte (0 = empty -> fists, else weapon id + 1) |
| B2 | Stat investments of a remote player: top two of nine (`InvestedStatKey`), also strength glow power and the matchup tint | build and mirrors: `Player.build` (`state.rs:551`), stat folds under `crates/rh-sim/src/stat_fold/`; legacy formula `combatReadability.ts` | Card power and mirrors are public in legacy; it reveals an enemy's build summary, never hp or cooldowns | Actor mask bit `MTopStats` + 2 bytes (stat key 0..8 + 1, then a quantised score 0..255 = score x 16 capped), computed server-side so the client invents no formula; power glow: 1 more byte (0..8 step) |
| B3 | Display name and bot flag of every player | `Player.name` (`fighter.rs:223`); Welcome has none | Public in legacy | A per-player table in Welcome or a `Roster` state item: id -> (name <= 24 bytes, bot bit); actors already carry the id |
| B4 | Wish ready/cooldown of a remote player | `crates/rh-sim/src/abilities` (`OwnerView` is self only) | Legacy shows it to all (`wishReadyAt`); it tells an enemy when a Wish returns | One bit "Wish ready" per actor (not the time) |
| B5 | Sentenced mark tier (0..4), mark tax %, brand 0..100 | `mark_tier`, `brand`, `mark_tax` already in `ActorView` (`observe.rs:78-83`, set at `observe.rs:714`) | Public in legacy; already in the observation | Actor mask bit `MMark` + 3 bytes (tier, brand, tax) |
| B6 | Look word (title text/colour, skin core, outline, golden faction) | look is a join-time cosmetic word | No | Welcome table id -> look word (u32), once |
| B7 | Teleport-immunity deadline | `Fighter.immune_until` (`fighter.rs:93`) | Public in legacy | Actor bit "immune"; the client animates the ring from the arrival tick it already sees (`Teleport` fx) |
| B8 | Fire roam-ready | `roam_armed` (`state.rs:382`) | Legacy shows it to all | Effects/sig spare bit |
| B9 | Weapon reach, half-arc, range, projectile kind (range ring) | `WeaponSpec` arcs in `crates/rh-sim/src/content.rs:237-283` | No (static catalog) | Welcome weapon table: id, shape kind, reach, half-arc, range, colour index |
| B10 | "Fighting" flag of a mob (cooldown running / bow drawn) for the calm/aware hp-bar and name | mob `ready_at`, draw start | Legacy shows bars of fighting mobs | Actor bit "engaged" |
| B11 | Damage-over-time hit kind (burn / disease / mark / backlash / bleed) and crit flag | event `SignatureHit` (`fx_report.rs:130`), crit in hit resolution | No | Hit fx: 1 byte `kind` (sig enum) + crit bit |
| B12 | Heal fx (`+N`, camp heal ring with camp index) | `Event::Heal` (`events.rs:171`) | Legacy shows heals on others in sight | New `WireFx::Heal { id, amount, camp? }` |
| B13 | Windup telegraph of remote attackers (angle, duration) | schedule windup (`schedule.rs`) | Legacy shows enemy telegraphs; fairness-relevant (it is what a player can see) | `WireFx::Windup { by, weapon, a, ms }` |
| B14 | Quest carrier actor id | quest state carrier roster id -> actor | No | Quest row: carrier actor id (u32) |
| B15 | Mob stat reward per mob type (camp buff badge) | mob catalog / `mob_stat` rewards (`crates/rh-sim/src/mob_catalog`) | No (static) | Welcome mob table: type -> reward stat key + short text |
| B16 | Camp territory (leash union) | camp rest spots + leash in `state.rs` | No (map-static) | Map blob: camp leash radius per camp |
| B17 | Camp ward owner and expiry | camp ward state | Public in legacy (beacons) | `WireCamp`: ward owner roster id + expiry |
| B18 | Attack / Passive numbers of the champion HUD | damage packet and scaling terms (`packetFor`, `stat_fold`) | Self only | Owner group: per-hit damage (f32), scaling term list (stat key + coefficient), passive text id |
| B19 | Own mob-stat counts ("Mob bonuses") | `Player.mob_stats` | Self only | Owner group: counts by stat key |

## 5. What this pass changed in Unity (branch `rework/indicators`)

Totals over the audit tables (77 rows: P1-18, S1-13, G1-7, M1-7, F1-9, W1-18, H1-5; hand count, rows with mixed status counted once):
about **24 matching, kept or not applicable**, **6 fixed** (hp tones, barrier blue, mob bar rule, hidden fighters, interact ring, damage
numbers), **18 built new** (bounty crown and number, own off-hand badge, mob names, attack lock ring, 12 status glyphs, quest `!`/`?`/turn-in,
trader mark; plus the owner-added melee hit zone), **about 9 deliverable but not built** (hover ring, hurt vignette F5, container labels
W2, reward-chest ring W3, quest item markers W6, plague corpse sprite W9, sentenced hunt ring W17, death X decal F8, own Wish icon P6,
champion HUD multipliers H3), and **about 20 blocked by missing wire data** (section 4, 19 wire additions B1-B19). The not-built set stays open for a follow-up pass.

How the two named indicators work in legacy and in Unity:
- **Dominant stat**: legacy shows the top two of nine invested stat scores (section 1.1) in 18 px dark squares at x = 0 and +18 beside the
  weapon spot. The wire carries no build or mirror for a remote player and Unity holds no card formulas, so nothing is drawn: blocked (B2).
- **Secondary weapon**: legacy draws the weapon of the slot not in hand (fists when empty) at x = -18. Unity draws it for the local player
  from the delivered inventory (`Indicators.SecondaryWeapon`, `CollectionsView.Inventory`); remote players are blocked (B1).

New code: `RoguehallaNet/Net/Ui/Indicators.cs` (pure rules and cluster layout), `Net/Ui/WeaponShapes.cs` (hit-zone seam: `WeaponShape`,
`WeaponShapes.Set/TryGet`, sector and sweep maths), tests `IndicatorsTests`, `HitZoneTests`; Unity `Presentation/OverheadIndicators.cs`,
`IndicatorArt.cs`, `WorldMarks.cs`, `HitZonePresenter.cs` and EditMode tests. Hit-zone numbers come only from `WeaponShapes` (empty by
default: no zone is drawn). The coordinator wires the Welcome weapon table with `Roguehalla.Net.Ui.WeaponShapes.Set(IReadOnlyList<WeaponShape>)`
(kind 1 = melee arc, reach in sim units, half-arc in radians) once the protocol branch merges, and may delete the `?hitzone.demo=1` filler
(`HitZonePresenter.FillDemoShapes`). Swing fx arrive at landing, so a remote swing's zone appears at the hit, not as a windup telegraph (B13).

Edits to shared files, by line: `SpriteActorPresenter.cs` (hooks only: `Art.Ind/IndFacts` fields, `Release` -> `Ind.HideAll`, `Create` -> new
`OverheadIndicators`, head-height `lift` added to bar/insignia/ring/signature y, hp tone and barrier colours, mob bar rule, hidden fighter
alpha and hide, a facts block at the end of `Present`, `SignatureSlotPosition` now adds the lift, new `PresentIndicators`); `SpriteActorPresenter.Fade.cs`
(one line: `art.Ind?.ApplyOpacity`); `ArenaView.cs` (hit-zone and world-mark fields, creation in `Awake`, `PendingFx` carries By/X/Y/A/Weapon/Passive,
`PresentFx` hit zone call and damage number style, three `PresentIndicators` call sites, inventory capture, gold focus ring, two diagnostics
flags). `ArenaPropCueEditModeTests` and `SpriteActorSignatureEditModeTests` were updated for the new focus ring (4 renderers) and the removed generic status cue.
