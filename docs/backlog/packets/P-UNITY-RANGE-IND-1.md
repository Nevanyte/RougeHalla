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

## 3. Relevant legacy paths (verified)
- `WeaponRangeView.ts:19-43` `weaponRangeGeometry(weapon, aim)`: melee `:23-35` is a fan from the origin, radius `reach`, from
  `aim - halfArc` to `aim + halfArc`; ball projectile (wand) `:36-39` a circle of radius `range`, 64 steps; any other
  projectile (bow) `:41-47` a rectangle from the origin to `range` ahead, half-width `hitReach = PLAYER_RADIUS + ARROW_RADIUS`
  (`:38`; 12 + 7, so width 38), rotated by `aim`. A non-finite aim counts as 0 (`:22`).
- Aim: `:80-83` the cursor angle, else the fighter's facing; a ball ignores it (aim 0, `:83`). Slot: the hand in use (`:70-71`);
  empty hand = fists (a melee arc, id 5 in the Welcome table).
- Style `:6-8`, `:90-92`: colour `0xb6e6ef`, fill alpha .04 (circle .018), then a 6 px stroke at alpha .055 and a 1 px stroke at
  alpha .23. Depth `-2.9e5` (`:7`): above ground fields, below every y-sorted actor, wall and the fog. The ground is Y_SCALE
  squashed when drawn (`:88-89`).
- Shown only when `phase == active`, the local fighter is alive, a finite position exists and the weapon is known (`:72`);
  hidden otherwise (not for dead, lobby, planning, ended, unknown weapon). RaidScene also hides it (`RaidScene.ts:1637-1638`)
  during map hold, peek, before a teleport, a pending death and the results panel. Local fighter only (`:1630-1640`; fed from
  `me` and the rendered position). Redrawn only when weapon or aim changes (`:84-87`); position moves the object only.
- Legacy test: `packages/client/test/weaponRangeView.test.ts` (lane = `[0,-hitReach]..[range,hitReach]` for the bow, circle
  radius = range for the wand, arc endpoints at `aim +- halfArc`, hidden cases above). It is a Phaser test, so only the geometry
  is ported as the oracle here.

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
- Width under Archetype hitboxes (ADR 0024: a flight is tested against the target's body box grown by the arrow radius). The
  legacy formula `2 x (body half-width + arrow radius)` is exactly that test for a body that is a half-width wide, so
  **recommendation: draw legacy's formula with `bodyHalfWidth` = PLAYER_RADIUS for a `legacy_circle` archetype (width 38) and
  the archetype's body box half-width otherwise** (hero: 2 x (17 + 7) = 48), arrow radius = `WireWeapon.Radius`. The tests pass
  `bodyHalfWidth` in, so the implementer chooses where it is read (`WireArchetype.Bx` / `R` ... check the units against
  `protocol/fixtures/archetypes_v1.json`). It would mislead only where the box is not centred on the foot: a body box has an
  offset (`bodyOffset`, e.g. hero y -30), and chest-height projectiles fly from the chest, so the lane is a ground aid, not the
  true box. Do not add height or offset; flag it if it looks wrong in play.
- **Open design point (flag to coordinator):** the wire row does not say whether a projectile is a ball (wand circle) or an
  arrow (bow lane). The API takes `bool ball`. Only the weapon id can tell (bow id 1, wand id 2 in the table), and that
  mapping would be a hard-coded number in Unity. Either accept one named weapon-id constant in the library with a note, or
  have the owner approve a wire flag (out of this packet). Rows carry `Radius` 7 (bow) and 2 (wand) but inferring from that
  is a guess; do not.
- Unity `.meta` files for the synced `WeaponRange.cs` are generated by the Editor, not by `sync-net.sh`.

## 7. Behaviour to preserve
- Wire bytes; existing swing and windup zones.
- Nothing is drawn for other players' weapons.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-RANGE-IND-1` passes (full).
- Unit tests: bow lane length equals the weapon's range and width equals the formula above for the fixture weapon rows;
  wand radius equals its range; melee arc equals reach and half-arc; the lane's direction follows the aim point; an
  unknown weapon gives no shape.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/WeaponRangeTests.cs`: signature fixed by the stub
  `WeaponRange.Of(WireWeapon row, float bodyHalfWidth, float aim, bool ball) -> WeaponRangeShape { Kind, Length, Width, HalfArc, Direction }`.
  Rows: `protocol/fixtures/v16.json` Welcome weapons (sword 112 / pi/4, bow 520 / speed 900 / radius 7, wand 640 / 380 / 2,
  shield 96 / pi/3, axe 112 / pi/2). Four tests fail on assertions; `UnknownOrShapelessWeaponGivesNoShape` passes against the
  stub and guards the implementation.

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
