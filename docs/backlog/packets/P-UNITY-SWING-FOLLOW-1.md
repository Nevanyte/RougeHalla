# P-UNITY-SWING-FOLLOW-1: the swing zone follows the moving attacker

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16a (D9 play loop, immediate presentation); owner direction 2026-11-10
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (presentation) · D2 n/a · D9: visual only; the hit is resolved by Rust at landing
  (`crates/rh-sim/src/systems/weapons.rs:211-231`), and the local player's zone is drawn at the predicted walk position

## 1. ID and outcome
In legacy the melee swing sector and the windup telegraph are re-placed every frame at the attacker's drawn position, so
they travel with a moving character. In Unity a landed swing zone is placed once at the position the server reported and
never moved; for the local player that position is behind the predicted on-screen position, so the zone appears where
the player was. When this lands every swing zone is re-placed each frame at its attacker's drawn position, and the local
player's uses the predicted position.

## 2. Dependencies
- P-UNITY-WAND-LOCK-1 merged (both edit `ArenaView.cs`)

## 3. Relevant legacy paths
- `packages/client/src/render/FxView.ts`: swing sector and windup telegraph re-placed per frame (survey: `:488-534`,
  `:786-823`; oracle author: verify and cite)
- `packages/client/src/scenes/RaidScene.ts`: the local player's own attack shown at click time (cite the lines)

## 4. New paths
- none expected

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/Presentation/HitZonePresenter.cs` (`Tick`, `:138`)
- `client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs` (swing zone start, `:647`)
- `client-unity/RoguehallaNet/Net/Ui/` (a pure "where is this zone now" helper if one is needed) and its synced copy
- `client-unity/RoguehallaNet.Tests/HitZoneTests.cs`
- `client-unity/UnityProject/Assets/Tests/Editor/HitboxPresentationEditModeTests.cs`

## 6. Contracts and references
- R-AUTH, ADR 0008, D9 and ORDER_OF_OPERATIONS Appendix A: Unity may present an attack at once; it never decides a hit.
- The zone's shape (reach, arc) still comes from the server's weapon table and swing events.

## 7. Behaviour to preserve
- Windup telegraphs already follow their attacker: unchanged.
- Remote attackers' zones follow their interpolated position, not a predicted one.
- Zone lifetime, colour and shape.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-SWING-FOLLOW-1` passes (full).
- Unit test: given a zone anchored to actor A and A's drawn position moving over three frames, the zone's origin equals
  A's drawn position on each frame; with A absent the zone keeps its last origin until it expires.
- EditMode: a landed swing for the local player is drawn at the predicted position, not the snapshot position.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/HitZoneTests.cs`
- `client-unity/UnityProject/Assets/Tests/Editor/HitboxPresentationEditModeTests.cs`

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/sync-net.sh --check`
- Unity EditMode batch run (Editor closed). Not part of the gate: report whether it was run.
- `node client-unity/UnityProject/Tools/hitbox-proof.cjs` against a local build, if a build is available.

## 10. Risk and suggested model tier
Sonnet. Small; the existing `Position` hook on zones is reused.

## 11. Known traps
- Facing: legacy rotates the sector with the attacker's facing at swing time, not the current facing; check and copy.
- A zone must not follow an actor that died or left sight into a wrong place: freeze at the last drawn position.
- Do not move the server-reported hit position used for hit numbers or impact FX.

## Notes from previous attempts
