# P-UNITY-HUD-BUILD-3: the champion panel and weapon slots draw the numbers the server now delivers

- **Serves:** owner decision 7 (2026-11-10: the HUD presents the same information as legacy: bottom-left panel,
  weapon slots); the Unity follow-up of P-WIRE17-HUD-2b and P-WIRE17-HUD-2c
- **Implementer tier:** implementer-sonnet (Unity UI; pure text in `RoguehallaNet`)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof against the legacy client's text · no wire change (everything is delivered)

## 1. ID and outcome
P-UNITY-HUD-BUILD-2 drew the bottom-left champion panel from the owner panel codes 0 to 22 and left blank every
legacy fragment nothing delivered. Since then the wire carries them and no HUD code reads them:
- **Welcome HUD block** (`WireHudContent`, P-WIRE17-HUD-2b/2c): per-weapon scaling rows (ad, ap, bonus hp, bonus
  defense, the "higher of" flag) and constant terms 0 to 22 (the Wish row's numbers per faction; the Fire roam
  constants).
- **Owner panel codes 23 to 27** (state key 13, P-WIRE17-HUD-2c): Fire roam speed bonus and burst damage, the hit
  multiplier, the physical and magic scaling of the held weapon.

When this lands the Unity HUD shows, with legacy's wording and number formats:
1. the weapon slot's scaling line and the auto row's "Scales with ..." line (legacy
   `packages/client/src/ui/weaponBar.ts:167`, `buildModel.ts:204-213` and `:224`, `championCombatModel.ts:119-122`:
   note the two legacy formats: one keeps non-zero terms in fixed order, the other positive terms biggest first with
   "(the higher)": each where legacy uses it);
2. the Wish row's numbers for the player's faction (`championCombatModel.ts`, the Wish section after `:140`; Frost
   is Freeze today);
3. the Fire roam line's move-speed percent while charging and the armed burst (`championCombatModel.ts:114-121`
   `fireRoamText`; pinned legacy quirk: armed right after a reset reads 0%);
4. the auto row's tooltip numbers that have a source now (hit multiplier, physical and magic scaling; the
   attack-speed mirror comes from `WireOwnerCombat.as_milli`).
Fragments that still have no source stay blank and are listed in the hand-off, not invented.

## 2. Dependencies
- P-WIRE17-HUD-2b and P-WIRE17-HUD-2c merged (both are on the local integration branch).

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/{ChampionPanelText.cs,SlotText.cs,BuildHudText.cs}` (and a new pure text file
  beside them if needed) with the synced copy
- `client-unity/UnityProject/Assets/Scripts/UI/{MatchHud.Legacy.cs,MatchHud.Features.cs}` and the panel/slot scripts
  the oracle author names; not `Presentation/**`, not the Tab map

## 7. Behaviour to preserve
- The panel's existing rows and layout (P-UNITY-HUD-BUILD-2, VISUAL-FIX-2, TEXTSCALE-1 oracles stay green: rows fit at
  text scales 1 and 1.5; the GAINED plate is untouched).
- Unity holds no rules: every number is formatted from a delivered value; nothing is computed that the server
  decides (the only arithmetic is legacy's display arithmetic, e.g. percent from a multiplier).

## 8. Acceptance checks
- Unit (RoguehallaNet.Tests), text from the committed golden vectors (`welcome*` with the HUD block and
  `state_build_summary_panel_tooltip` in `protocol/fixtures/v17.json`): the scaling line for one weapon per class in
  both legacy formats; the Wish row for each of the five factions; the Fire roam line at a charging value, at full
  charge armed, and armed after a reset (0%); a non-Fire owner shows no roam fragments; a missing HUD block or panel
  code leaves the fragment blank (no "0", no "NaN").
- EditMode: the new lines fit their rows at scales 1 and 1.5 at 1280x720 and 1920x1080 (measured after
  `MatchHud.ApplyTextScale`); the weapon slot's scaling line fits the slot.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-BUILD-3` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-HUD-BUILD-3`

## 10. Risk and suggested model tier
Sonnet. The risk is wording drift: every string is quoted from the legacy file with its line in the test.

## 11. Known traps
- Term and panel codes are appended over time (Frost Wall will add more): read by code, never by position.
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.
- Hand-off includes `git diff --stat packet/P-UNITY-HUD-BUILD-3`.

## Notes from previous attempts
