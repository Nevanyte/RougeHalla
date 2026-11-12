# P-UNITY-INSPECTOR-1: the enemy inspector card on hover

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-7 combat presentation); owner direction 2026-11-10 (MIGRATION
  checkpoint, decision 7: the HUD presents the same information as legacy); plan lane B, packet 7
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Legacy shows a small card when the cursor rests on another fighter: its kit line ("{Faction} · {Weapon} · {role}"), its
health ("Health {hp} / {maxHp}"), a build line (card power, PvP factor, growth), damage-share chips ("{label} N%") and
its Offense / Soul Offence gains. Unity has no such card. When this lands Unity shows the card for the fighter under
the cursor, built by a pure function from the actor row the client already has, with every line legacy shows that the
wire carries. A line whose fact is not on the wire is left out (never a placeholder, never "not delivered") and listed
in the brief.

## 2. Dependencies
none

## 3. Relevant legacy paths
- `packages/client/src/ui/opponentInspector.ts` (survey: `:57` kit, `:58` health, `:60` card power line, `:77` damage
  chips, `:83-84` offense gains; the oracle author verifies the lines and pins texts, order, rounding and when the card
  shows and hides: hover delay, mobs versus players, hidden or dead fighters)
- `docs/unity/PROTOCOL_GAPS.md` rows P12 / B2 (remote build facts that are not on the wire)

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/InspectorCard.cs` (pure: an actor view in, the card's lines out) and its test file
- `client-unity/UnityProject/Assets/Scripts/UI/InspectorCardView.cs` (draws the card near the cursor)

## 5. Exclusive write scope
- the two new files, the library file's synced copy and `.meta` files
- the hover hook only: `client-unity/UnityProject/Assets/Scripts/View/ActorPick.cs` (expose the actor under the cursor
  if it does not already) and the one place the view is created (`ArenaView.cs` or the HUD root; name it)
- a new EditMode test file under `client-unity/UnityProject/Assets/Tests/Editor/`
- not the `MatchHud*.cs` files (other packets are editing them)

## 6. Contracts and references
- C-OBS: only facts in the hovered actor's delivered row; nothing inferred about a fighter the viewer cannot see (a
  hidden fighter has no card).
- No game rule in Unity: percentages are formatted from delivered values, not recomputed from a build.
- Actor rows: `client-unity/RoguehallaNet/Net/Collections.cs` (player and mob views), `Protocol/State.cs` (`WireActor`).

## 7. Behaviour to preserve
- Target picking and the wand lock (`TargetPick`), the lock ring, tooltips of HUD elements.
- No allocation per frame while the card is shown and the actor's row has not changed.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-INSPECTOR-1` passes; the Unity EditMode suite passes.
- Unit tests on the pure function: a player row gives the kit and health lines with legacy text and rounding; each
  legacy line whose fact is delivered appears in legacy order; a line whose fact is not delivered is absent; a mob row
  gives what legacy gives for a mob (pin it, including "no card"); a dead or hidden actor gives no card.
- One EditMode case: hovering an actor shows the card with the model's lines; moving off hides it.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-INSPECTOR-1`

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`
- `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Small: one pure model and one view.

## 11. Known traps
- The card must not cover the fighter it describes or the cursor: follow legacy's offset and its screen-edge flip.
- Faction, weapon and role names: use the client's existing name tables (find them; do not add a second list).

## Notes from previous attempts
