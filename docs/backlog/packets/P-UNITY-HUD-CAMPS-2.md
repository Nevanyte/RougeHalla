# P-UNITY-HUD-CAMPS-2: camp reward badges and ward beacons on the maps and in the world

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5 minimap, P-UI-6 Tab map); owner direction 2026-11-10
  (MIGRATION checkpoint, decision 3: "Camp logos (stat buff) and timers dont show on minimap and tab map"; "this includes
  camp timers vision wards etc."); follow-up named by P-UNITY-HUD-CAMPS-1
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
P-UNITY-HUD-CAMPS-1 draws a marker and a respawn clock per camp. Two legacy facts are still missing on screen: which
stat a camp's mobs give (the "camp logo": a stat icon with the amount, over the living camp in the world and on the
maps), and the vision wards (a beacon at a warded camp with its remaining time, yours distinguished from another
player's, and the ward's sight shown on the minimap). The camp row now carries both facts (P-WIRE17-HUD-1:
`CampView.Reward`, `CampView.Ward`, `CampView.WardExpiresAt`). When this lands every camp marker row carries its reward
badge and its ward state, the minimap, Tab map and world draw them, and a pure function with tests decides the text,
the icon key and when each shows.

## 2. Dependencies
- P-UNITY-HUD-CAMPS-1 and P-WIRE17-HUD-1 merged (both are)

## 3. Relevant legacy paths
- `packages/client/src/render/CampBuffs.ts` (world badge: one per living, visible camp group; stat icon + amount; elite
  augment drop shown beside it)
- `packages/client/src/render/CampWards.ts` (ward beacon and its timer text; the same file holds "RESPAWN Ns")
- `packages/client/src/ui/minimapMarkers.ts`, `minimap.ts`, `mapPainter.ts`, `planning.ts` (reward glyph and ward mark on
  the maps; ward-fed vision on the minimap)
- `packages/shared/src/mobStats.ts` (`mobStatReward`: stat key and amount text), `packages/client/src/ui/combatIcons.ts`
  (`STAT_ICON_COLORS`)
(the oracle author verifies the lines and pins texts, number formatting, colours and the show/hide conditions)

## 4. New paths
- none required: extend `client-unity/RoguehallaNet/Net/Ui/CampMarks.cs` (rows gain reward and ward members) or add
  `CampBadges.cs` beside it; the oracle author chooses and fixes the signatures in a stub

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/CampMarks.cs` (and a new sibling file if the oracle adds one), their synced copies
  and `.meta` files
- `client-unity/UnityProject/Assets/Scripts/UI/TacticalMapMarks.cs`, `TacticalMapController.cs` (camp layer)
- `client-unity/UnityProject/Assets/Scripts/Presentation/CampRespawnLabels.cs` (world badge and beacon beside the
  respawn label) and its hook in `client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs`
- EditMode tests under `client-unity/UnityProject/Assets/Tests/Editor/` for the camp layer

## 6. Contracts and references
- C-OBS: the ward is a verdict for this viewer (none, yours, other) plus its expiry; the owner's identity is never on
  the wire and is never guessed. The reward is the row's stat code and amount, drawn as sent.
- No game rule in Unity: the remaining ward time is expiry minus server time, drawn only. Unity does not widen the
  player's sight from a ward; it draws the ward's sight circle on the minimap only when legacy does, from the public
  ward radius (name the source constant in the brief; if the radius is not on the wire or in content, say so in the
  hand-off and draw the beacon without the circle).
- Camp rows: `client-unity/RoguehallaNet/Net/Collections.cs` (`CampView`, `WardVerdict`), `WireCampReward`
  (`Protocol/State.cs`; `Value` = amount x `Hud.Quantum`).

## 7. Behaviour to preserve
- Everything P-UNITY-HUD-CAMPS-1 draws (markers, states, clocks, world respawn label) and the existing map marks and
  their draw order.
- `CampMarks.Markers` and `WorldLabels` keep their signatures and results for rows with no reward and no ward.
- No allocation per frame in the map mark pass.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-CAMPS-2` passes; the Unity EditMode suite passes.
- Unit tests on the pure model: a living camp with a reward gives a badge with the legacy icon key and amount text; a
  cleared camp gives none (pin what legacy does); an elite camp's badge (pin what legacy shows beside it, or record that
  the fact is not on the wire); ward verdict none gives no beacon; yours and other give the two legacy looks; the ward
  timer text and its rounding; an expired ward (expiry at or before now) gives no beacon; training or inactive match
  hides what legacy hides.
- One EditMode case: the tactical map draws a reward badge and a ward beacon for a row that has them.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/CampBadgesTests.cs` (11 cases)
- The stub commit fixes the model, a new sibling of `CampMarks.cs` (existing `CampMarks`, `CampMarkRow`, `CampWorldLabel` and
  `CampMarksTests.cs` are untouched): `client-unity/RoguehallaNet/Net/Ui/CampBadges.cs`, its synced copy and `.meta` under
  `UnityProject/Assets/RoguehallaNet/Net/Ui/`. Implementers fill in the bodies only; types, fields and signatures stay:
  - `enum CampSurface { Minimap, TabMap, World }`
  - `struct CampBadgeRow { Index, WorldX, WorldY, IconKey, IconRgb, AmountText, EliteIconKey, EliteIconRgb, EliteText }`
  - `struct CampWardRow { Index, WorldX, WorldY, Look (WardVerdict), BeaconRgb, TextRgb, WorldText, Countdown }`
  - `CampBadges.IconKey(byte stat)`, `IconRgb(byte stat)`, `AmountText(WireCampReward)`, `const KillStacks = 3`
  - `CampBadges.Rewards(MapCamp[] camps, IReadOnlyList<CampView> rows, bool active, CampSurface surface, Func<double,double,bool> canSee, List<CampBadgeRow> into)`
  - `CampBadges.Wards(MapCamp[] camps, IReadOnlyList<CampView> rows, double serverNowMs, bool active, List<CampWardRow> into)`
  - Both fill methods clear `into` and fill it (caller-owned; a row-count mismatch gives an empty list, no exception).
- Not an oracle file (implementer work): the Unity presenters and the EditMode case in section 8.

## Stat order (the table the wire uses)
The camp reward's stat byte is the `HudStat` index, declared in `crates/rh-sim/src/observe.rs:325-337` (also
`crates/rh-protocol/src/state.rs:930-932`, C# `Protocol/State.cs` `Hud`): 0 Offense, 1 Soul Offense, 2 Damage, 3 Attack speed,
4 Life steal, 5 Health, 6 Defense, 7 Soul Defense, 8 Move speed. It is the legacy GAINED strip order; the model maps it to
legacy icon keys in that order, not through a new list.

## Legacy rules as verified (pinned by the oracle)
- Icon keys: wire 0..8 -> `ad, ap, damage, attackSpeed, leech, health, armor, mr, speed` (`CampBuffs.ts:90-104`
  `mobRewardIcon`; same table `planning.ts:161-174`); any other code -> `damage` (the `default` arm, `CampBuffs.ts:101`).
- Icon colours (`combatIcons.ts:23-26` `STAT_ICON_COLORS`): ad `ffb074`, ap `c4a0ff`, damage `ffd36a` (the world badge forces
  the same for damage, `CampBuffs.ts:79`), health `62d889`, attackSpeed `ffdc78`, armor `d5e0e8`, mr `75cfff`, speed `80d6ff`,
  leech `f05260`.
- Amount text: Tab-map badge shows `/^\+([^ ]+)/` of the reward's per-KILL text (`planning.ts:183`), i.e. `+3%`, `+1.5%`,
  `+0.75%`, `+3`, `+3.75`, `+4.5` (`mobStats.ts:90-96`: stat rows `perKill*100` with at most two decimals and `%`, flat rows
  the plain number; `perKill = value x MOB_KILL_STACKS`, `mobStats.ts:11`). The wire carries the per-STACK value (`observe.rs:413-418`
  `amount: r.value`, farm table `farm.rs:37-59`), so the model multiplies by `KillStacks = 3`. See Legacy doubts.
- World badge (`CampBuffs.ts`): drawn only while `active` (`:30-31`); one per camp group with a living mob the viewer can see
  (`:24-29`), never for state 2 or no living mob or no reward row (`:38`); idle and engaged both show; ICON ONLY, the text is just
  the marker's accessible name (`:83-84`), so `AmountText` is null in the world.
- Elite, world: a living elite adds a second icon `ap` (colour `c4a0ff`) with no amount, beside the stat icon
  (`CampBuffs.ts:44-46`; the elite has no stat reward). An elite camp whose row has no stat reward shows the `ap` icon alone.
- Tab map (`planning.ts:688-691`, `:594`): badge built from the camp's type for EVERY camp whatever its state, visible or not,
  hidden only by the map mode (not by `active`, not by sight); an elite camp adds `eliteChestBadge` (`:189-193`): chest glyph
  with the text `Aug`; the chest is not tinted by `STAT_ICON_COLORS`.
- Ward beacon (`CampWards.ts:38-57`): only while `active` (`:15`, `:38`); for every camp with an owner and `now < wardExpiresAt`
  (strict: expiry == now gives none, `:40`), whatever the camp's state or the viewer's sight. Text `YOUR WARD ${s}s` /
  `WARD ${s}s` with `s = ceil((wardExpiresAt - now) / 1000)` (`:55-56`; 91001 vs 1000 -> 91, 91000 -> 90, 1 ms left -> 1).
  Yours: ring/pole/arrow `66e4ef`, text `66e4ef`; another player's: `9aa9bd`, text `b9c6d7` (`:45`, `:51`). The wire verdict
  replaces the owner compare (`wardOwner === localId`).
- Respawn label and beacon share the file but are independent: a cleared camp can show "RESPAWN Ns" and a ward at once.

## Owner direction, not legacy (pinned by the oracle, flag for review)
- Minimap reward badge: legacy minimap draws no reward glyph (`minimapMarkers.ts` has none). Owner direction asks for it: the model
  gives an icon-only badge (no amount) for camps that are not cleared, only while `active`, because legacy lets a camp have ONE
  badge and the respawn clock replaces it for a cleared camp (`minimapMarkers.ts:69-70`). Ward on the maps: legacy draws no ward
  mark on the minimap or Tab map (only ward-fed vision, `RaidVision.ts:46-55`); the model supplies `Countdown` (bare whole seconds,
  same rounding as the beacon) and the look so the maps can draw a ward mark beside the camp marker; it is not a second
  respawn clock, and it does not replace the one-badge rule (the ward mark sits beside the badge or clock).

## Not on the wire
- Ward sight radius: legacy ward-fed vision reveals `VISION_RADIUS = 900` (`packages/shared/src/constants.ts:69`,
  `RaidVision.ts:53`) around the camp, for the viewer's OWN ward only. Neither the radius nor any vision rule is on the wire or in
  Unity content, so the ward sight circle is not drawn and not in the oracle (draw the beacon without it, per section 6).
- Per-mob visibility: legacy hides the world badge unless a living mob of the camp is visible and places it over the group centre
  (`CampBuffs.ts:25, 58-61`). The row has only the camp position and an alive count, so the model tests `canSee` at the camp's map
  position. This is an approximation; position is the presenter's choice.
- Elite augment drop detail: the chest itself (loot, timer) is not in the camp row; only the row's `Elite` flag is. The model shows
  legacy's static second badge from that flag.
- Whether the elite or the normal mobs are the ones still alive: `Alive` is a count, so an elite camp shows its second badge while
  any mob lives.

## Legacy doubts
- Per-kill vs per-stack: the wire amount is the per-STACK value (`observe.rs:413`, 1% for Damage) while legacy's badge text is per
  kill (+3%, `MOB_KILL_STACKS = 3`, `mobStats.ts:11`, `farm.rs:37`). The brief said "drawn as sent"; the oracle pins legacy
  (x3 inside `CampBadges.AmountText`). If the owner wants the raw per-stack amount, change `KillStacks` and the nine cases of
  `AmountTextIsThePerKillAmount`, or have the server send the per-kill value (wire change, out of scope).

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`
- `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Medium: two facts over three surfaces, one pure model.

## 11. Known traps
- The stat code on the wire is a byte: map it through the same stat order the build summary uses (name the table in the
  brief), not through a new list.
- Legacy shows the world badge only for a camp group the viewer can see; the maps show map knowledge. Pin each.
- A camp can have a reward chest up, a respawn clock and a ward at once: follow legacy's one-badge rule for the minimap
  and say where the ward mark goes.
- Zone-themed camp buffs are a later packet: the badge must read the row's reward, never a per-mob-type table in Unity.

## Notes from previous attempts
