# P-UNITY-HUD-STATUS-2: the HUD shows the lobby's "n/min", the healing and wind-emblem timers, and the RESTING chip

- **Serves:** owner decision 7 (2026-11-10: the HUD presents the same information as legacy); the Unity half cut from
  P-WIRE17-HUD-3 by its oracle author (2026-11-12)
- **Implementer tier:** implementer-sonnet (Unity UI, engine-free text in `RoguehallaNet`)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework at or after `1fa56f47` (P-WIRE17-HUD-3 merged: observation 28)
- **D-rules touched:** D1 loose proof (legacy text read, one test per line) · no wire change · no game rule in Unity

## 1. ID and outcome
P-WIRE17-HUD-3 delivers three facts the client does not draw yet (`CollectionsView`: `InventoryView.HealingUntil`,
`InventoryView.SpeedBoostUntil`, `ArenaView.MinPlayers`). When this lands the HUD reads as legacy in four places:
1. **Lobby line:** "Waiting for players n/min — run starts in Ns" (`packages/client/src/ui/hud.ts:44`, `:193`), with
   the room's minimum, where today's line has no "/min".
2. **Healing slot:** "Healing xN Ns" while healing potions run: the count as today, the seconds from `HealingUntil`
   against the server clock, rounded up (`packages/client/src/ui/weaponBar.ts:144-148`); no "xN" when N is 1.
3. **Wind emblem:** "+50% speed · Active Ns" while the boost runs, from `SpeedBoostUntil`; the idle text as legacy
   when it does not (same lines of `weaponBar.ts`).
4. **RESTING chip:** client-derived, as legacy derives it (`packages/client/src/ui/terrainFeedback.ts:51`; the rule
   and its caveats are in `P-WIRE17-HUD-3.md`, section "Rest state"): shown when the rule holds, never "x2".

## 2. Dependencies
- P-WIRE17-HUD-3 merged (it is). P-UNITY-HUD-STATUS-1 and P-UNITY-HUD-TERRAIN-1 merged (the lines and chips this edits).

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/**` (the text builders: the oracle author names the files), the synced Unity copy
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud*.cs` only where a call site passes the new values
- not `Protocol/**`, not `Presentation/**`

## 7. Behaviour to preserve
- Every existing HUD text when the three facts are absent (an older server frame is refused anyway; within a match the
  clocks are simply not running); the terrain chips' order and colours; no per-frame garbage (the HUD's no-garbage
  tests).

## 8. Acceptance checks
- Engine-free tests (`RoguehallaNet.Tests`): each of the four texts against the legacy string for a stated input,
  including the boundaries (N = 1, the last second rounds up to "1s", a clock in the past shows the idle text, minimum
  players 1, 2 and 8), and the RESTING rule's true and false cases.
- EditMode: the lobby line, the healing slot and the emblem slot show the text from a `CollectionsView` carrying the
  values; the RESTING chip appears and disappears with the rule.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-STATUS-2` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-HUD-STATUS-2`

## 10. Risk and suggested model tier
Sonnet. The server clock the seconds are measured against must be the same one the lobby countdown already uses.

## 11. Known traps
- The clocks are owner-only: a spectator or another seat has none; the texts must not assume they exist.
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.

## Notes from previous attempts
