# P-UNITY-HUD-STATUS-1: the top line, consumable timers and cooldown text read as legacy

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5 HUD); owner direction 2026-11-10 (MIGRATION checkpoint,
  decision 7); plan lane B, packet 6 ("lobby/planning countdown text")
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Three HUD texts differ from legacy. (1) The top line: legacy reads "Waiting for players n/min — run starts in Ns",
"Planning Ns", "Alive a/b · Run GV n" during the run (with the coliseum line), and "Run over — X is victorious";
Unity drops "/min" (it passes 0), has no "Alive a/b · Run GV n" and no run-over line. (2) Consumables: legacy shows
"Healing xN Ns" while a healing potion runs, "+50% speed" / "Active Ns" for the wind emblem; Unity shows counts only.
(3) Ability slots: legacy shows "Ready in m:ss" and a seconds badge on a cooling ability; Unity shows a timer for the
Wish only. When this lands pure functions produce each legacy text from delivered state and the HUD draws them. A text
whose fact is not delivered (the room's minimum players until the wire carries it) keeps today's form and is listed.

## 2. Dependencies
- P-UNITY-HUD-TERRAIN-1 merged or not running (same HUD files: strictly serial)

## 3. Relevant legacy paths
- `packages/client/src/ui/hud.ts:41-56` (top line), `:258-285` (coliseum / sudden death)
- `packages/client/src/ui/weaponBar.ts:48,93,145-148` (potion and emblem texts)
- `packages/client/src/ui/abilitySlot.ts:131,149,276-297` (cooldown format, "Ready in", badges)
(the oracle author verifies the lines and pins texts, rounding and the m:ss format)

## 4. New paths
- none required: extend `client-unity/RoguehallaNet/Net/Ui/Indicators.cs` (`PhaseLine`) and add
  `client-unity/RoguehallaNet/Net/Ui/SlotText.cs` (consumable and cooldown texts) with tests

## 5. Exclusive write scope
- `Indicators.cs` (`PhaseLine` / `ArenaLine` only), the new `SlotText.cs`, synced copies and `.meta`
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs` (the ability and potion text call sites, around `:317`,
  `:357`, `:377`), `MatchHud.Features.cs` (the top line call, around `:171`), `MatchHud.IconPresentation.cs` (`:77-80`)
- EditMode tests that pin the old texts

## 6. Contracts and references
- Every number is delivered state minus server time, formatted only. Alive counts come from the roster rows the
  client holds (`StateKey.Roster`), GV from the player's own row.
- `Indicators.PhaseLine` is pinned by `IndicatorFactsTests`: tests that pin text this packet changes are replaced by
  the oracle, not edited by the implementer.

## 7. Behaviour to preserve
- "Coliseum m:ss" counting down to the gate lock and to sudden death (P-UNITY-TIMER-1).
- No allocation per frame: texts rebuilt when the shown second changes.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-STATUS-1` passes; Unity EditMode passes.
- Unit tests: each phase's top line with legacy text; "n/min" when the minimum is known and today's text when it is
  not; healing and emblem timer texts and when they hide; cooldown "m:ss" at 0, 9, 59, 60 and 125 seconds.
- One EditMode case: a cooling ability slot shows the model's text.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/HudStatusTextTests.cs` (top line, new `PhaseLine` overload)
- `client-unity/RoguehallaNet.Tests/SlotTextTests.cs` (`SlotText`)
- Stubs (the implementer replaces): `Net/Ui/SlotText.cs` (new, all bodies empty), the 7-argument `Indicators.PhaseLine` overload
  (delegates to the old one), synced copies and `SlotText.cs.meta`. `PhaseLineTests.cs` / `IndicatorFactsTests.cs` are unchanged and
  still pass: the 6-argument `PhaseLine` keeps today's behaviour; no existing case is replaced.

## Legacy rules as verified
- Top line, `hud.ts:41-56` statusLine: lobby `Waiting for players {n}/{min} — run starts in {m:ss}` (:44); planning `Planning {m:ss}`
  or bare `Planning` without `planEndsAt` (:46-48); active `Alive a/b · Run GV n` (:50-52); ended `Run over — {winner} is victorious`
  or bare `Run over` (:55). fmtSeconds is ceil, `m:ss` (hud.ts:15-18; `Indicators.FmtSeconds` already does it).
- **The active status line is never visible in legacy**: `this.status.hidden = active` (`hud.ts:199`), the Coliseum line
  (`:258-285`) is what shows during a run. So the oracle pins the active line as the Coliseum line only and does NOT ask for
  "Alive a/b · Run GV n". GV already shows in Unity's combat stats line (`MatchHud.cs:317`).
- Winner label: `winnerLabel` (`render/displayName.ts:42-47`): a bot winner reads "[BOT] name" (= `Indicators.DisplayName(name, true)`).
- Cooldown, `abilitySlot.ts:129-133`: `max(0, ceil(s))`; under 60 plain seconds ("9", "59"), from 60 `m:ss` ("1:00", "2:05").
  NOT zero-padded minutes:seconds below a minute, contrary to the brief's "m:ss" shorthand. `Ready in {cooldown}` at `:149`; the
  seconds text shows only while `secondsLeft > 0` (`:276`); the charge badge is `charges` only when `maxCharges > 1`, class
  `empty` at 0 (`:286-290`).
- Consumables, `weaponBar.ts:145-148`: `{large} large · {small} small`; `Healing[ xN] {ceil s}s` only while `healingUntil > now`
  (x shown when count > 1); `+50% speed` / `Walk over emblems`; `Active {ceil s}s` while `speedBoostUntil > now`.

## Not on the wire
- Room minimum players (`state.minPlayers`): pass 0, the text drops "/min" (pinned by `PhaseLineTests` and the lobby case here).
- Alive count and `startedWith` as a standing count: roster rows carry id/name/bot only; snapshot actors are interest-filtered
  (C-OBS), so "Alive a" cannot be computed. Moot for legacy parity (line hidden when active).
- Healing end time (`healingUntil`) and wind-emblem end (`speedBoostUntil`): only `InventoryView.PotionsHealing` is delivered;
  `EventKind.WindEmblem` carries no time. Call sites use `HealingStatus(count, null, now)` (count-only, today's text) and show
  no wind emblem timer. Do not estimate.
- Winner: delivered in the `MatchEnded` event (`WireEvent.Winner`, roster id; `Draw`), but `Session` keeps no copy: the HUD must
  remember it from the event (`Session.cs:529`) and resolve the name with `Collections.RosterName(id)`; bot flag from `RosterEntry.Bot`.
- Charged-ability timing (`abilitySlot.ts:99-117`, the Wish lock vs next charge) is not pinned here: the call site feeds
  `SlotText.Cooldown` the `ReadyAt` / `NextChargeAt` remaining time Unity already holds in `WishView`.

## Unity call sites the implementer changes
- `UI/MatchHud.Features.cs:171`: call the 7-argument `PhaseLine` with the winner label (null while not ended); phase `Ended` must
  reach it (the method returns early unless `SessionState.InMatch`, around :166; allow `Ended`).
- `UI/MatchHud.cs:357` (`FormatWishCard`): use `SlotText.Cooldown` / `ReadyIn` and `ChargeBadge` for the timer text; keep the
  card's other lines.
- `UI/MatchHud.IconPresentation.cs:77-80`: `_healText` from `SlotText.PotionCounts`, `_healStatus` from `SlotText.HealingStatus(count, null, now)`.

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`,
  `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Small to medium: three texts, one HUD class.

## 11. Known traps
- The winner's name in "Run over" must come from delivered results, not from the last living row the client saw.
- Healing and emblem timers need delivered end times: if only counts are delivered, list the gap; do not estimate.

## Notes from previous attempts
