# P-UNITY-HUD-STATUS-2: the HUD shows the lobby's "n/min" and the healing and wind-emblem timers (RESTING cut to a follow-up)

- **Serves:** owner decision 7 (2026-11-10: the HUD presents the same information as legacy); the Unity half cut from
  P-WIRE17-HUD-3 by its oracle author (2026-11-12)
- **Implementer tier:** implementer-sonnet (Unity UI, engine-free text in `RoguehallaNet`)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework at or after `1fa56f47` (P-WIRE17-HUD-3 merged: observation 28)
- **D-rules touched:** D1 loose proof (legacy text read, tests per line) · no wire change · no game rule in Unity

## 1. ID and outcome
P-WIRE17-HUD-3 delivers three facts the client does not draw yet (`CollectionsView`: `InventoryView.HealingUntil`,
`InventoryView.SpeedBoostUntil`, `ArenaView.MinPlayers`). When this lands the HUD reads as legacy in three places:
1. **Lobby line:** "Waiting for players n/min — run starts in m:ss" (`packages/client/src/ui/hud.ts:44`, minimum from
   `state.minPlayers` at `:193`), where today's line has no "/min" because the call passes 0.
2. **Healing slot:** "Healing xN Ns" while healing potions run (`packages/client/src/ui/weaponBar.ts:147`): "xN" only when
   N > 1, seconds `ceil((healingUntil - now) / 1000)`, nothing once the end is at or before now.
3. **Wind emblem:** "+50% speed · Active Ns" while the boost runs (`weaponBar.ts:146,148`), "Walk over emblems" otherwise.

**Item 4 (the RESTING chip) is cut** from this packet: see "Item 4: why it is cut" below.

Brief corrections, found while reading legacy:
- The lobby countdown in legacy is **`m:ss`** (`hud.ts:15-18` `fmtSeconds`: `ceil`, clamped at 0, minutes unpadded: "0:40",
  "2:05"), not bare "Ns". Unity already prints that (`Indicators.FmtSeconds`); the oracle pins m:ss.
- The terrain rule lives at `packages/client/src/render/zoneArt/terrainFeedback.ts:51`, not `ui/terrainFeedback.ts`.
- Legacy draws the wind emblem as two spans (`speedCount` "+50% speed" / "Walk over emblems", `speedStatus` "Active Ns").
  Unity has one label (`_windText`), so the oracle joins them with " · " (U+00B7): a presentation choice, not legacy text.

## 2. Dependencies
- P-WIRE17-HUD-3 merged (it is). P-UNITY-HUD-STATUS-1 and P-UNITY-HUD-TERRAIN-1 merged (the lines and chips this edits).

## 3. Relevant legacy paths (read by the oracle author)
- `packages/client/src/ui/hud.ts:44` `Waiting for players ${s.playerCount}/${s.minPlayers} — run starts in
  ${fmtSeconds(s.lobbyEndsAt - serverNow)}`; `:15-18` `fmtSeconds`; `:193` `minPlayers: state.minPlayers` (the em dash is U+2014).
- `packages/client/src/ui/weaponBar.ts:146-148`: `speedCount` = `speedBoostUntil > serverNow ? "+50% speed" : "Walk over
  emblems"`; `healStatus` = `healingUntil > serverNow ? "Healing" + (healing > 1 ? " x" + healing : "") + " " +
  Math.ceil((healingUntil - serverNow) / 1000) + "s" : ""`; `speedStatus` = `speedBoostUntil > serverNow ? "Active " +
  Math.ceil(...) + "s" : ""`. Legacy reads `serverNow` per frame, so the seconds count down every second.
- `packages/client/src/render/zoneArt/terrainFeedback.ts:51` (rest rule), `:116-158` `CombatMemory`; see item 4.

## 4. New paths
- `client-unity/RoguehallaNet.Tests/HudStatusClocksTests.cs`, `client-unity/UnityProject/Assets/Tests/Editor/MatchHudStatusTextsEditModeTests.cs`
  (+ `.meta`).

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/Indicators.cs` (new `PhaseLine` overload: stubbed, implement), `client-unity/RoguehallaNet/Net/Ui/SlotText.cs`
  (new `HealingSlot`, `WindEmblem`: stubbed, implement), and their synced copies under `client-unity/UnityProject/Assets/RoguehallaNet/Net/Ui/`
  (`bash client-unity/sync-net.sh`; the stub commit already synced the stubs).
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Features.cs` (`TickMetrics`, line 196: passes `0` for the minimum),
  `MatchHud.IconPresentation.cs` (`UpdateInventoryHints`, lines 109-114: `HealingStatus(key.Healing, null, 0d)`, the potion cache key),
  `MatchHud.Legacy.cs` (the wind chip, line 437 `_windText`: fit for the longer text; comment at 436), `MatchHud.cs` (`RefreshCollections`
  :412, `RefreshOwnerPresentation` :314) only where a call site passes the new values.
- not `Protocol/**`, not `Presentation/**`, not the wire, no existing test.

## 6. Contracts and references
- R-AUTH (no game rule in Unity; the texts are pure functions of delivered facts), C-OBS (the clocks are owner-only), ADR 0008.
- **The clock "now"** is `Session.ServerTimeMs` (`Session.cs:109`, `Latest.ServerMs`): the accepted server clock the lobby countdown already uses
  (`MatchHud.Features.cs:196` passes `_session.ServerTimeMs` to `Indicators.PhaseLine`), also what `RefreshOwnerPresentation` receives
  (`MatchHud.cs:220,287`). `LobbyEndsAt`, `HealingUntil`, `SpeedBoostUntil` are all match-relative server milliseconds in that clock.

## 7. Behaviour to preserve
- Every existing HUD text when the three facts are absent: no `MinPlayers` (0) drops "/min"; no `HealingUntil` keeps the count-only
  "Healing" / "Healing xN" (`SlotText.HealingStatus` with a null end); no `SpeedBoostUntil` reads "Walk over emblems". The guards below pin this.
- Seams that existing tests bind to **must keep their signatures**: `UpdateInventoryHints(InventoryView?)` (a delegate is created over it in
  `ChampionPanelNoGarbageEditModeTests.cs:87`, and that test runs with `_session == null`), `RefreshCollections(CollectionsView)`
  (`ShowcaseStateEditModeTests.cs:38,40,68,74`, also with no session), `RefreshOwnerPresentation(SelfView, double)`. With no session the clock is 0
  and no clock is shown; nothing may throw.
- The existing `Indicators.PhaseLine` overloads (explicit `minPlayers`) stay: `HudStatusTextTests.cs:21-27`, `PhaseLineTests.cs:11`,
  `IndicatorFactsTests.cs:118-123` call them.
- No per-frame garbage: the HUD's no-garbage tests (`ChampionPanelNoGarbageEditModeTests`, the new one below) with the clocks running.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-STATUS-2` passes, and the full gate before hand-off.
- `RoguehallaNet.Tests/HudStatusClocksTests.cs` and `MatchHudStatusTextsEditModeTests.cs` green; `sync-net.sh --check` clean.

## Existing tests whose expectation would have to change
None. No existing assertion contradicts the new texts: every existing test passes `minPlayers` explicitly or runs without a delivered clock.
`HudTextScaleEditModeTests.cs:196-198` measures the old label texts ("Healing x5", "+50% speed") and does not list "+50% speed · Active 5s"; it is
not edited (the new EditMode test asserts that the longer wind text fits its label instead).

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/HudStatusClocksTests.cs` (engine-free)
- `client-unity/UnityProject/Assets/Tests/Editor/MatchHudStatusTextsEditModeTests.cs` and its `.meta` (EditMode; rig: `Fix3Transport` from
  `HudVisualFix3EditModeTests.cs`, a real `Session`, the HUD built through its private `Create*` calls; seams `RefreshCollections`,
  `RefreshOwnerPresentation`, `UpdateInventoryHints`, `TickMetrics`)

Red today (assertion failures, 19 engine-free, 7 EditMode): the lobby line with a minimum (4 engine-free cases, 3 EditMode) and the countdown
sequence; every healing text with a clock (6 cases, plus "end at or before now shows nothing", 3 cases, engine-free; 3 EditMode incl. the allocation
test, which fails on its text first); the wind emblem with a running boost (5 engine-free, 1 EditMode incl. the fit assertion).
Guards, green today, must stay green (labelled `GUARD`): minimum 0, healing without a clock or inventory, wind idle for an ended or absent boost.

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests --filter FullyQualifiedName~HudStatusClocksTests`
- `bash client-unity/UnityProject/Tools/editmode.sh` (whole suite; afterwards `git checkout -- client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset`, never commit it)

## 10. Risk and suggested model tier
Sonnet. Two real traps: (a) the seconds must **redraw as the clock advances** while the potion counts are unchanged: today `UpdateInventoryHints`
caches on the counts only and `RefreshCollections` runs only when a collections message arrives, so a count-only key would freeze "5s". Key the
cache on the shown second (and re-run from the per-frame owner refresh) so unchanged frames allocate nothing. (b) the wind label is 100 units wide
and not auto-sized; "+50% speed · Active 5s" overflows it unless it is fitted like the heal labels.

## 11. Known traps
- The clocks are owner-only: a spectator or another seat has no `Inventory`; the texts must not assume it (`InventoryView?`, null clocks).
- `healing > 1` decides "xN"; N = 0 with a live clock is unreachable (the sim zeroes both together) and is not pinned.
- `HealingStatus` (existing) returns "" for a count of 0; use `HealingSlot` for the slot.
- The EditMode run touches `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.
- The lobby line is shown by `TickMetrics`, which needs `_uiPrefs` (the test rig sets it; the running client does in `InitializeFeatures`).

## Item 4: why it is cut (to a follow-up, proposed `P-UNITY-HUD-RESTING-1`)
Legacy derives the chip on the client (`terrainFeedback.ts:51`): `resting = healShare(surface under the fighter) > 0 && player && alive &&
(healing || (!combat && hurt))`. What Unity already has: the terrain plane and mode (`MapBlob.Terrain`, light = code 7, `TerrainMode`, read by
`TickTerrain`); faction, `Hp`/`MaxHp`, `Status` (`SelfView`); `Heal` fx for the owner (`FxKind.Heal`, `Id` = the healed fighter, once per second, only
when the light actually healed: `terrain/mod.rs:160-169`); `Hit` fx with `Victim` and `By`.

What it lacks, so the rule cannot be derived faithfully:
1. **`combat` (legacy `CombatMemory.note`) counts a hit only when its attacker is non-null.** On the wire `By == u32::MAX` means *either* "unseen
   (redacted) attacker" *or* "damage dealt by the arena" (`crates/rh-sim/src/observe.rs:267`, `by.filter(|&source| can_see(source))`). Legacy
   (no redaction) told the two apart; Unity cannot. Counting every hit on the owner as combat is wrong for arena damage; ignoring `By == MAX`
   is wrong for a fighter hitting from out of sight (legacy: combat, no resting). Either choice is an approximation of legacy.
2. The server's own lockout (`terrain/mod.rs:126-130,144-149`) stamps every landed hit incl. signature and ability damage, while legacy's memory only
   saw `hit` fx; `SigHit` is delivered but legacy ignored it. Which rule to port is a decision, not a read.
3. Fx are droppable under backpressure: a dropped `Hit` leaves the chip up for up to 3 s while the server heals nothing; only a `Heal` fx corrects
   it, and only in the other direction.
The light's boost under map mode ("x2" for Holy) must never print: live mode `All` passes no faction (`systems/terrain/mod.rs:19`).
Smallest faithful fix, if the owner wants the chip: a wire fact (the lockout end, or "healing now") from `w.terrain.combat_at`, which is a wire
packet (Opus), not this one. Pinning an approximation here was refused.

## Notes from previous attempts
