# P-UNITY-WISH-TEXT-1: in a Frost Wall room every text about Frost's Wish says Frost Wall, with the wall's numbers

- **Serves:** owner beta follow-up decision 2 ("Frost Wall replaces Freeze") and decision 7 (the HUD presents the same
  information as legacy)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework at `25d76d1a3` (the live world plays Frost Wall; the Welcome's HUD block
  carries terms 23-29; `WireHudContent.FrostWish`, `CarriesFrostWish`, `FrostWall` exist). The packet branch starts there.
- **D-rules touched:** D1 loose proof against the unreleased legacy patch `78dd8bd4` / `cde6f785` (read with `git show`;
  not merged into `packages/`) · D2 n/a · D5/D6/D9 none · no wire change, no game rule in Unity (text only)

## 1. ID and outcome
A reviewer found `HudContentText.Wish` (`client-unity/RoguehallaNet/Net/Ui/HudContentText.cs:69-71`) hard-codes
`name = "Freeze"` with "Ns stun · R range", so a Frost player in a Wall room reads "Freeze · 1.25s stun · 450 range" in
the champion panel. Reading the whole client for the same fault found two more places (section 3b).

When this lands, for a Welcome whose HUD block has term 23 = 1 (`FrostWish == Wall`): the Frost Wish row's name, value
line, scaling line and the Wish tooltip's lines are the wall's, built from the wall's numbers in the block; the card
and cast lines name the Wish "Frost Wall". For Freeze (term 23 absent or not 1, or no block) every string is exactly
today's. Other factions' Wish rows are unchanged under both.

## 2. Dependencies
none (everything it reads is in the base).

## 3. Relevant legacy paths
Legacy wording, from `git show 78dd8bd4` (`origin/claude/adoring-edison-mxt8ab`) and `git show cde6f785`:
- `packages/client/src/ui/championCombatModel.ts` `wishRow` (78dd8bd4, the added line right after the `case "freeze"` line,
  about :222): `case "frostWall"`: `name: def.name` = **"Frost Wall"** (`shared/abilities.ts` `frostWall.name`);
  `value: \`${fmt(FROST_WALL_MS / 1000)}s wall · ${fmt(FROST_WALL_RANGE)} range\``; `scaling: "No damage scaling"`; its
  `tooltip` is the blurb plus a sentence (no delivered source for the blurb in Unity, so the row's `Detail` stays "",
  as for every other Wish; see section 7). `fmt` is `championCombatModel.ts:74`, `Math.round(n * 100) / 100` printed
  without trailing zeros: the same rule as `HudContentText.Fmt`.
- `packages/client/src/ui/combatTip.ts` `effectTip` (78dd8bd4, `case "wall"` after `case "blink"`, about :34):
  `` [`Wall: ${effect.length} u long for ${seconds(effect.ms)}`, "Blocks walking and melee swings; shots fly over it"] ``.
  `seconds` is `combatTip.ts:12` (`${num(ms / 1000)} s`) and `num` is `:8-11`: `Math.round(n * 10) / 10`, whole numbers
  print without a decimal, otherwise `toFixed(1)`. The length prints raw. This is **one decimal**, not the row's two
  (1250 ms is "1.3 s" in the tip and "1.25s" in the row): a legacy inconsistency, pinned as it is. `JS Math.round` is
  `floor(x + 0.5)`; do not use `ToString("F1")` (banker's rounding differences) or `Math.Round`.
- `packages/shared/src/abilities.ts` (78dd8bd4): `FROST_WALL_RANGE = 450`, `FROST_WALL_MIN_RANGE = 64`,
  `FROST_WALL_LENGTH = 224`, `FROST_WALL_MS = 4000`; the Wall's tip also has a shape line `Wall: ${length} u long`
  (`combatTip.ts` `abilityTip`, shape wall) that duplicates the effect line: Unity has no `abilityTip`, do not add it.
- `packages/client/src/ui/hub/championGuide.ts` (cde6f785): `wishGuide` scaling "Fixed 224 u wall for 4 s · no Offense/SO
  scaling." and the Frost blurb "Raise a wall of ice where you aim to cut off a chaser or split a fight: bodies and swings
  stop at it, shots fly over." See 3b, "hub guide": not in this packet.
- Today's Unity: `HudContentText.cs:63-103` (`Wish`, `Fmt`, `Raw`), `MatchHud.Legacy.cs:296-319` (`ApplyWishRow`).

### 3b. Every "freeze" hit, classified
`git grep -n -i freeze -- client-unity/RoguehallaNet client-unity/UnityProject/Assets/Scripts` (the synced copy under
`Assets/RoguehallaNet` repeats the library's hits and is regenerated, not edited):

IN SCOPE (a player-facing string describing Frost's Wish):
1. `RoguehallaNet/Net/Ui/HudContentText.cs:69-71`: the champion panel's Wish row (name, value, scaling).
2. `UnityProject/Assets/Scripts/UI/MatchHud.cs:371` `FormatWishCard`: `.Append(w.Ability)` prints the enum, so the
   Wish slot tooltip (`_wishHint.Text = _wishCardText`, `:345`) and the Wish card read "R · Freeze · 1/1 charges".
   Found by reading, not by "freeze" grep (the word is the enum value `AbilityId.Freeze`).
3. `MatchHud.cs:383`: the same card's `"Casting " + cast.Ability` ("Casting Freeze").
4. `MatchHud.Legacy.cs:317`: the fallback row when no HUD block exists, `wish.Ability + " · c/m"`. That branch has no block, hence
   no term 23, hence Freeze: leave it as it is (it needs no change; routing it through the new helper is harmless).

LEAVE:
- Icon, glyph and sound keys (a generic frost mark or an effect asset): `Presentation/ShowcaseIconArt.cs:32,115`
  (`wish.freeze` icon), `ShowcaseSoundscape.cs:445` (`wish.freeze` cue), `OverheadIndicators.cs:359,363`
  (`"snow"` glyph, faction index), `WishFxModel.cs:165,213` (faction index; clip choice), `ArenaView.cs:149,372,657`
  (the wall presenter's tint; `FrostWish`).
- The freeze EFFECT other abilities apply (stun styled as ice): `WishFxPresenter.cs:61-62,84,115,464,530,654-665`
  (`_freezeAt`, "IsIceStun"): drawing only, no string. `Indicators.Stunned` and the `"stun"` glyph are the stun STATUS
  that Trial's exit and other abilities also apply: not Frost's Wish.
- Trial's "exit stun" text (`HudContentText.cs:83`, `CardDisplayCatalog.cs:92` "stun"): Sentenced, not Frost.
- Code identifiers and comments: `Collections.cs:9` (`AbilityId.Freeze`, wire order, never renamed), `Indicators.cs:123`,
  `WishAim.cs:20`, `WireHudContent.cs` (`FreezeStunMs`, `FreezeRange`, `FrostWishKind.Freeze`), `MatchClient.cs:360`,
  `Messages.cs:1021`, comments. "Freezes" meaning "stops" (`LocalMotion.cs:943`, `PlanningSelections.cs:103`,
  `Messages.cs:36`, `HitZoneTests`, `PredictionLatencyTests`, `UiLab*`, `ContrastLab*`): unrelated.
- The enemy inspector card (`InspectorCard.cs`): no Wish text (stat names only). The weapon scaling line
  (`SlotScaling`, `AutoScaling`, `AutoTooltip`): weapons only, no Wish text. `HelpGuideView.cs:143` "Frost · Chill" is the
  passive. `ChampionPanelText.cs:72` Frost case is the passive ("Frozen Justice"). `Frost Wisp` and `Frostbow Sentry` are mobs.

NOT IN THIS PACKET, FLAGGED FOR THE COORDINATOR (the owner's call):
- `UnityProject/Assets/Scripts/UI/HubGuideView.cs:27` ("Frost Stun") and `:33` ("Stun the enemy nearest your cursor ...")
  are the hub's champion guide. It is drawn outside a room, so there is no HUD block to key on and the "in a Wall room"
  rule cannot apply. Legacy changed its guide unconditionally (cde6f785: "Raise a wall of ice where you aim ..."). Now that
  the live world plays the wall (DEV-029) the guide is wrong for every live player. Recommend a follow-up packet
  (P-UNITY-WISH-TEXT-2) that replaces the two strings with legacy's cde6f785 wording and name "Frost Wall", unconditionally.
  It changes no oracle here and the strings have no test today; it is not folded in because it is a different rule
  (unconditional) and a Unity-only file.

## 4. New paths
- `client-unity/RoguehallaNet.Tests/WishTextTests.cs` (the oracle; committed).

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/HudContentText.cs`: `Wish` (Frost case), `WishName`, `WishTip` (stubbed on the branch).
- `client-unity/UnityProject/Assets/RoguehallaNet/Net/Ui/HudContentText.cs`: only by `bash client-unity/sync-net.sh`.
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs`: `FormatWishCard` (take the block, use `HudContentText.WishName`
  for `w.Ability` and `cast.Ability`, append `HudContentText.WishTip(block, faction)` lines to the card), the `WishTextKey`
  (it must change when the block does, or the card never rebuilds: key on the block reference or `FrostWish`), and its one
  call site. `MatchHud.Legacy.cs`: only the `ApplyWishRow` fallback if routed through `WishName`.
  If `FormatWishCard` has no faction at hand, take it from `me.Faction` at the call site.
- Nothing else: no wire, no Rust, no `packages/`, no tests other than the new file.

## 6. Contracts and references
- C-PARITY (existing parity fixtures untouched), R-AUTH/ADR 0008 (text only, no rule), DEV-029 (the wall in the live world),
  `client-unity/AGENTS.md` (edit the library, then sync).

## 7. Behaviour to preserve
- For Freeze, a block without term 23, a null or empty block: every string byte for byte today's, including the existing
  `HudContentTextTests.TheWishRowIsTheLegacyNumbersOfTheFactionsWish` (Freeze: "Freeze", "1.25s stun · 450 range",
  "No damage scaling") and `ATermThatIsMissingBlanksOnlyTheFragmentThatNeedsIt`. `WishName` for any ability but Frost's Wish
  under Wall is the enum name as today; `WishTip` is "" for every faction but Frost under Wall.
- `Row.Detail` stays "" (the blurb has no delivered source), as for every Wish.
- A Wall block lacking the six numbers: name "Frost Wall", Value, Scaling, Detail and tip "" (never a stun number or "0").
  A Wall block always needs terms 24 and 27 for the row, and 26 and 27 for the tip; the tests pin the all-or-nothing cases only.
- `AbilityId` and wire codes keep `Freeze = 0` (it is Frost's Wish in both worlds).
- Legacy oddity pinned, not fixed: the tip's seconds use one decimal, the row's use two (section 3).
- Number formats, per the panel's convention: row seconds `Fmt(ms / 1000)`, range `Fmt(range)` (or `Raw`; identical for
  whole numbers), tip length `Raw(length)`, tip seconds one decimal + " s" (new private helper, `floor(x * 10 + 0.5) / 10`).

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-WISH-TEXT-1` passes (full).
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests --filter "FullyQualifiedName~WishTextTests"`: 11 of 11.
- `dotnet test client-unity/RoguehallaNet.Tests`: all green; `bash client-unity/sync-net.sh --check` clean.
- Read by the reviewer (no engine test): `FormatWishCard` and the cast line no longer print `w.Ability` / `cast.Ability`
  directly for Frost's Wish.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/WishTextTests.cs`

Baseline at `25d76d1a3` + the stub commit: `WishTextTests` 7 red (all on assertions), 4 green (the guards); the whole C#
suite 2103 passed, 7 failed (those seven only). The stub commit adds `HudContentText.WishName` (returns the enum name) and
`HudContentText.WishTip` (returns "") and the synced copy.

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests --filter "FullyQualifiedName~WishTextTests"`
- `dotnet test client-unity/RoguehallaNet.Tests`; `bash client-unity/sync-net.sh --check`
- `scripts/gate.sh --quick` while iterating.

## 10. Risk and suggested model tier
Low. Text builders with a 11-test oracle; `implementer-sonnet` because part of the change is in a Unity script that no
engine-free test reaches. Risk: the card's rebuild key (`WishTextKey`) not noticing a block that arrives later.

## 11. Known traps
- `Math.Round` / `ToString("F1")` round half to even or differently from JS; the 1250 ms case (1.3, not 1.2) is in the oracle.
- Term 23 = 1 exactly means Wall (`FrostWish`); numbers present without term 23 are Freeze (a guard pins it).
- A Wall block still carries the stun terms 0-1: do not read them for the wall row.
- Separators are " · " (U+00B7) as in the other rows.
- Edit the library file, then run `sync-net.sh`; never edit `Assets/RoguehallaNet`.

## Notes from previous attempts
<!-- Coordinator appends on escalation. -->
