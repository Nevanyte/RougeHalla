# P-UNITY-HUD-BUILD-3: the champion panel and weapon slots draw the numbers the server now delivers

- **Serves:** owner decision 7 (2026-11-10: the HUD presents the same information as legacy: bottom-left panel,
  weapon slots); the Unity follow-up of P-WIRE17-HUD-2b and P-WIRE17-HUD-2c
- **Implementer tier:** implementer-sonnet (Unity UI; pure text in `RoguehallaNet`)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof against the legacy client's text · no wire change (everything is delivered)

## 1. ID and outcome
P-UNITY-HUD-BUILD-2 drew the bottom-left champion panel from owner panel codes 0-22 and left blank every legacy
fragment nothing delivered. The wire now carries them and no HUD code reads them:
- **Welcome HUD block** (`WireHudContent`): per-weapon scaling rows and constant terms 0-22.
- **Owner panel codes 23-27** (state key 13): Fire roam speed bonus and burst damage, hit multiplier, physical and magic
  weapon scaling.

When this lands the Unity HUD shows, with legacy's wording and number formats:
1. the **weapon slot's scaling line** and slot tooltip line "Scales with ..." (biggest term first, "(the higher)" for dominant);
2. the **auto row's scaling line** (fixed order, `N× label`, a different legacy format from item 1) and the auto row's
   **tooltip sentences** with the new numbers (attack-speed mirror, weapon scaling with hit multiplier);
3. the **Wish row** (ability name, value line, scaling line) for the player's faction (Frost = Freeze);
4. the **Fire roam sentence** with the move-speed percent and the armed burst (pinned legacy quirk: armed right after a
   reset reads `(0% move speed)`).

Correction of the first draft of this brief: the auto row's scaling line is `championCombatModel.ts:119-122`
(`scaleTerms`); the slot line and the tooltip "Scales with" line use `buildModel.ts:204-213`. They are two formats.

## 2. Dependencies
- P-WIRE17-HUD-2b and P-WIRE17-HUD-2c merged (on the integration branch).

## 3. Relevant code and legacy (read by the oracle author)

### C# API that exposes the data (this branch)
- `client-unity/RoguehallaNet/Protocol/WireHudContent.cs`: `WireHudContent.ScalingOf(byte id)` (:61, null when no row),
  `Term(HudTerm code)` (:53, `double?`, null when not carried), rows `WireWeaponScaling{Id,Ad,Ap,BonusHp,BonusDefense,Dominant}` (:20-30),
  codes `HudTerm` 0-22 (:11-17); weapon id = `WeaponId` (0 sword, 1 bow, 2 wand, 3 shield, 4 axe, 5 fists, `Net/Views.cs:50`).
- Where the block lives: `ServerMsg.Welcome.Hud` (`Protocol/Messages.cs:1078, :1239`), reached as `Session.Welcome?.Hud`
  (`Net/Session.cs:70`; Session has no `Hud` accessor, only `Weapons`, `Vision`, `Archetypes`). `MatchHud` holds `_session`.
- Owner panel: `Collections.Summary` (`WireBuildSummary.Panel`, `WirePanelValue{Code, Value}` in 1e-4 quanta, `Hud.PanelCodeCount` = 28,
  `Protocol/State.cs:105-124`). `ChampionPanelText.Rows` (`Net/Ui/ChampionPanelText.cs:37-85`) copies codes into `q[code]` (`:41-43`, drops
  codes >= 28 by code, not position) and reads codes 0-22 only. The attack-speed mirror is `SelfView.OwnerCombat?.AsMilli` (`Net/Views.cs:112`,
  1000 = 1x; legacy `decodeMult` divides by 1000).

### What Unity draws today, and what is blank
- `ChampionPanelText.Rows` (auto row value and detail; passive row; `Roam` = "Fire Roam is N/1000 charged" with the literal 1000 and no percent,
  `ChampionPanelText.cs:55-58`). `ChampionRow.Scaling` of the auto row is "" (`:75-81`): **blank, no source before this packet**.
- `MatchHud.IconPresentation.cs:46-70` `ApplyChampionRows` writes label/value/scaling of rows 0 and 1 and `_damageHint.Text`
  (= `DamageUnavailable` + `Auto.Detail` + `Roam`). Row 2 (Wish): `MatchHud.Legacy.cs:482-483` writes `"<Ability> · charges/max"` and nothing in
  `_championScaling[2]`; its label stays "Wish" (`:269`). `RefreshWishTile` is the separate R tile (untouched).
- Weapon slots: `MatchHud.Legacy.cs:321-322` creates `Name` and a `Scaling` label per slot (`Slot1/Scaling/Label`, 96 wide x 11, `SizeMicro`) with
  **no field and no text ever written**; `MatchHud.Features.cs:450,462` and `IconPresentation.cs:87-88` set the name ("Empty" for an empty slot) and
  hint text `"N · Weapon · equipped / Select weapon slot"`. `SlotText.cs` holds potion/cooldown text only (no scaling).
- `BuildHudText.cs` is the GAINED strip and mob rows; nothing in this packet needs it (no edit).

### Legacy templates (read-only `packages/client/src/ui/`)
- `championCombatModel.ts:74` `fmt = Math.round(n*100)/100` printed without trailing zeros (non-finite -> "0"; Unity leaves the fragment blank instead).
- `:119-122` auto `scaling`: filter coefficient != 0 over `[ad "Offense"], [ap "SO"], [hp "bonus HP"], [def "bonus defense"]`, each
  `` `${fmt(c)}× ${label}` ``, `.join(dominant ? " or " : " + ") || "none"`.
- `:128` tooltip sentence: `` `Weapon scaling (${scaleTerms}) adds ${fmt(scalingValues.phys)} physical and ${fmt(scalingValues.magic)} magic before the ${fmt(hitMult)}× hit multiplier. ` ``
  (codes 26, 27, 25); `:127` `` `Attack rate uses your current attack-speed mirror (${fmt(mirrors.asMult)}×) and this weapon's interval. ` ``;
  `:126` the parts sentence (codes 0-2, already drawn); `:129` the fixed "This raw packet excludes target defenses, outgoing damage bonuses, conditional effects, critical hits, Plant Your Feet, and player-versus-player scaling." then `fireRoamText`.
- `:114-116` `fireRoamText` (leading space dropped here): `` `Fire Roam is ${roamReady ? "armed" : `${fmt(min(MAX, max(0, charge)))}/${MAX} charged`} (${fmt((fireRoamSpeedMult(charge) - 1) * 100)}% move speed); after ${fmt(RAMP_MS/1000)} s out of combat, the next landed basic attack adds ${fmt(burst)} physical (${BURST_BASE} + ${fmt(AD_SHARE)}× Offense). Incoming damage resets partial charge but does not cancel an already armed burst; Defense mitigates the burst. ` ``
  Fed by panel codes 8, 9, 23 (`speedMult - 1`, so percent = code 23 x 100), 24, and terms 19-22. Quirk: the server zeroes `roamCharge` on a hit
  and keeps `roamReady`, so "armed" can read `(0% move speed)`; pinned.
- `:219-228` `wishRow`, name = ability name (`abilities.ts:175,185,199,212,226`: Freeze, Swarm, Trial, Blaze Step, Last Stand; faction map `abilities.ts:240` frost/plague/sentenced/fire/holy):
  Freeze `` `${fmt(T0/1000)}s stun · ${fmt(T1)} range` `` / "No damage scaling"; Swarm `` `${fmt(T2/1000)}s hidden · ${T3} radius` `` / "No damage scaling";
  Trial `` `${fmt(T4/1000)}s zone · ${fmt((1-T5)*100)}% less dealt` `` / `` `${fmt((1-T6)*100)}% slower · +${fmt((T7-1)*100)}% taken · ${fmt(T8/1000)}s exit stun` ``;
  Blaze `` `${T11} true DPS · ${fmt(T12/1000)}s trail` `` / `` `${T13}–${T14} blink · fixed damage` `` (en dash);
  Last Stand `` `${fmt(T15/1000)}s floor at 1 HP · +${fmt(T16*100)}% move` `` / `` `${fmt(T17*100)}% of held damage healed back` `` ("1 HP" is literal).
  Radius and distance terms are printed raw (`${n}`), the others through `fmt`.
- `buildModel.ts:193-215` `weaponScalingText` (drawn at `weaponBar.ts:167`): labels Offense, SO, bonus HP, "bonus Defense/SD"; positive terms only, sorted by
  coefficient descending, ties by order ad, ap, hp, def; `scale(v)` = `toFixed(1)` when `|v*10 - round(v*10)| < 1e-9`, else `toFixed(2)`; joined " or " (dominant) or " + ",
  dominant gets a trailing " (the higher)"; "No scaling" when no term. `:222-229` `weaponTipText` = name, `` `Scales with ${weaponScalingText}` ``, then tag text.

### Fragments that still have no delivered source (stay blank)
- Wish row tooltip (`wishRow` `tooltip`, with `def.blurb` prose) and `aria-label`; the weapon tooltip's tag line (`weaponSpecialText`) and hit-type line
  (`weaponDamageTypeText`); attack-speed sentence when `OwnerCombat` is not delivered; the Fire/Plague/Holy/Sentenced tooltip-only numbers listed under
  "Deliberately left out" of P-WIRE17-HUD-2c; the slot line of an **empty** slot (legacy shows Fists dimmed; Unity keeps "Empty", draws no scaling line).

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/HudContentText.cs` (stub committed; pure functions, bodies to fill) and its synced Unity copy + `.meta`.

## 5. Exclusive write scope (corrected)
- `client-unity/RoguehallaNet/Net/Ui/HudContentText.cs` (the stub's bodies) and `bash client-unity/sync-net.sh` copy.
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Legacy.cs` (slot `Scaling` label field and layout, Wish row via `ApplyWishRow`, label sizes),
  `MatchHud.IconPresentation.cs` (`ApplyChampionRows`, `UpdateInventoryHints`), `MatchHud.Features.cs` (`RefreshBuildIcons` slot text),
  `MatchHud.cs` (feed `HudContent` from `_session.Welcome?.Hud`; pass `OwnerCombat?.AsMilli`).
- Not `ChampionPanelText.cs` / `SlotText.cs` / `BuildHudText.cs` (their tests stay green and pin the no-block output), not `Presentation/**`, not the Tab map.

## 6. Contracts and references
- R-AUTH / ADR 0008: Unity formats delivered values; the only arithmetic is legacy's display arithmetic (`/1000`, `x100`, `1 - mult`).

## 7. Behaviour to preserve
- Existing `ChampionPanelTextTests`, `SlotTextTests`, `BuildHudTextTests`, `HudTextScaleEditModeTests` (63-label inventory), `ChampionRowNameFitEditModeTests`
  stay green and are not edited. `ChampionPanelText.Rows` still returns its current text with no block (the HUD replaces `Roam`/detail with `HudContentText` only when `HudContent` is non-null).
- Missing block, row, term or panel code: the fragment is "" (no "0", no "NaN"). Codes and terms are read by code, never by position.

## 8. Acceptance checks
- `dotnet test client-unity/RoguehallaNet.Tests` (`HudContentTextTests`, vectors `welcome` and `state_build_summary_panel_tooltip` from `protocol/fixtures/v17.json`).
- EditMode `ChampionPanelNumbersEditModeTests`: drawing (auto line + tooltip, Wish row per faction, fallback without block, slot line and hint, empty slot) and the fit test
  at text scales 1 and 1.5 x stages 1280x720 and 1920x1080 after `MatchHud.ApplyTextScale`. At the stub the fit test already fails on real clipping, so the layout must change:
  the Wish value ("5s floor at 1 HP · +30% move") needs `MinSize` 8 (needs 136.6 at 10 of 134 usable); the slot scaling label (96 x 21 at the stages, floor size 6)
  needs word wrapping (two lines fit the box height) for "Offense 1.0 or SO 1.0 (the higher)" and "bonus Defense/SD 0.4 + SO 0.3".
- `bash client-unity/sync-net.sh --check`; `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-BUILD-3`.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/HudContentTextTests.cs`
- `client-unity/UnityProject/Assets/Tests/Editor/ChampionPanelNumbersEditModeTests.cs` (+ `.meta`)

Stub (implementer edits): `client-unity/RoguehallaNet/Net/Ui/HudContentText.cs` (+ Unity copy and `.meta`), `MatchHud.Legacy.cs` (`public WireHudContent HudContent`, `ApplyWishRow`).

## 9. Validation commands
`export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests`; `client-unity/UnityProject/Tools/editmode.sh` (then
`git checkout -- client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset`, never commit it).

## 10. Risk and suggested model tier
Sonnet. Wording drift is pinned by quoted legacy strings. Size: about 200 lines of implementation, one packet.

## 11. Known traps
- Term and panel codes are appended over time (Frost Wall): read by code.
- JS `Math.round` is floor(x + 0.5): `(1 - 0.8) * 100` is 19.999999999999996 and must print "20"; mirror `fmt` with doubles, not decimals.
- `ApplyWishRow` takes over the Wish-row lines of `RefreshLegacyHud` (`MatchHud.Legacy.cs:482-483`); without a block its output is exactly today's.
- Do not add labels to the 63-label `HudTextScaleEditModeTests` inventory; the slot `Scaling` label is found by path `Slot1/Scaling/Label`.
- Hand-off includes `git diff --stat packet/P-UNITY-HUD-BUILD-3`.

## Notes from previous attempts
