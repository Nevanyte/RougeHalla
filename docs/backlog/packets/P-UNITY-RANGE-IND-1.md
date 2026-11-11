# P-UNITY-RANGE-IND-1: weapon range indicator (bow lane, wand circle, melee arc)

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (Unity UI packets, P-UI-7 combat presentation); owner direction 2026-11-10
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (presentation) · D2 n/a · D9: an aid drawn from server-sent weapon facts; it decides nothing

## 1. ID and outcome
Legacy draws a faint range indicator under the actors for the held weapon: a lane for the bow (length = range, width =
twice the sum of the player radius and the arrow radius) that turns with the cursor, a circle for the wand and an arc
for melee. Unity has none, so the owner cannot see the arrow's range or hit width. When this lands Unity draws the same
three shapes for the local player from the weapon table the server already sends.

## 2. Dependencies
- P-UNITY-SWING-FOLLOW-1 merged (`HitZonePresenter.cs`, `ArenaView.cs`)

## 3. Relevant legacy paths
- `packages/client/src/render/WeaponRangeView.ts`: the three shapes and their sizes (survey: `:20-43`, `:68-95`; oracle
  author: verify and cite)
- `packages/client/src/scenes/RaidScene.ts`: where it is drawn and updated (survey: `:1631-1640`)

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/WeaponRange.cs` (pure geometry) and `client-unity/RoguehallaNet.Tests/WeaponRangeTests.cs`
- `client-unity/UnityProject/Assets/Scripts/Presentation/WeaponRangePresenter.cs`

## 5. Exclusive write scope
- the new paths above and the library's synced copy
- `client-unity/UnityProject/Assets/Scripts/Presentation/LegacyFacts.cs` (keep `Speed` and `Radius` from `WireWeapon`)
- `client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs` (create and tick the presenter)

## 6. Contracts and references
- Weapon facts come from `client-unity/RoguehallaNet/Protocol/WireWeapon.cs` (`Reach :28`, `HalfArc :30`, `Speed :32`,
  `Radius :34`); the body half-width comes from the archetype table. No number is hard-coded in Unity.
- Under Archetype hitboxes (ADR 0024) a flight is tested against the target's body box grown by the arrow radius: the
  lane width shown is the arrow's own width plus the legacy slack; say in the hand-off which width is drawn and why.

## 7. Behaviour to preserve
- Wire bytes; existing swing and windup zones.
- Nothing is drawn for other players' weapons.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-RANGE-IND-1` passes (full).
- Unit tests: bow lane length equals the weapon's range and width equals the formula above for the fixture weapon rows;
  wand radius equals its range; melee arc equals reach and half-arc; the lane's direction follows the aim point; an
  unknown weapon gives no shape.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/WeaponRangeTests.cs`

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/sync-net.sh --check`
- Unity EditMode batch run (Editor closed). Not part of the gate: report whether it was run.

## 10. Risk and suggested model tier
Sonnet. Small to medium; the geometry is pure and tested, the presenter is a thin mesh.

## 11. Known traps
- Draw order: under actors and above the ground, as legacy; it must not cover telegraphs.
- The indicator turns with the cursor every frame: no allocation per frame.
- Walls do not clip the legacy lane; do not add occlusion (that would be a new aid).

## Notes from previous attempts
