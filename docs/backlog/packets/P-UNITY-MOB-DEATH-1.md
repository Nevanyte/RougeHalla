# P-UNITY-MOB-DEATH-1: a killed mob plays its death clip in full

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (Unity UI packets); owner direction 2026-11-10 (MIGRATION checkpoint)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (presentation) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Killed mobs often look translucent, stick on the first frames of their death clip and vanish. Cause (read from code,
not reproduced): the server reissues creature ids on almost every snapshot (`crates/rh-sim/src/actor_refs.rs:226-245`)
and keeps a dead mob in the observation for 1.5 s; the client carries a living creature's art across the id change but
releases a dead one at once, so the new id fades in from 0 and restarts the clip each time. When this lands a dead
creature keeps its art and its death start time across id changes, an actor that arrives already dead does not fade in,
and the clip plays once to its end.

## 2. Dependencies
none

## 3. Relevant legacy paths
- `packages/client/src/render/MobView.ts`: legacy death presentation (shrink and 450 ms fade); the owner wants the Unity
  death clip instead, so this is the reference for timing only (oracle author: cite the lines)

## 4. New paths
- none expected

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/VisionFade.cs` (`:31-38`) and its synced copy
- `client-unity/UnityProject/Assets/Scripts/Presentation/SpriteActorPresenter.cs` (`:206-209` release, `:259-260` death
  clip restart, `:317` grey tint)
- `client-unity/UnityProject/Assets/Scripts/Presentation/SpriteActorPresenter.Fade.cs` (`:66-90`, `:131-153`)
- `client-unity/UnityProject/Assets/Tests/Editor/MobContinuityEditModeTests.cs` (the pinned case `:85-92`)

## 6. Contracts and references
- C-OBS: continuity is matched only from what the observation shows (look, position, status); no hidden id is used.
- The continuity rule for living creatures (`MobContinuityTests.cs`) stays as it is.

## 7. Behaviour to preserve
- Living creatures: ghost and adoption behaviour unchanged.
- A mob that leaves sight while alive still fades out.
- Players' death presentation unchanged.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-MOB-DEATH-1` passes (full).
- Unit tests in `client-unity/RoguehallaNet.Tests/MobContinuityTests.cs`: a dead creature whose id disappears and
  reappears nearby with the same look is classed as the same body (adopted, death start kept); an actor first seen dead
  enters at full alpha; a dead body with no successor is released when the server drops it.
- EditMode: `MobContinuityEditModeTests` case `:85-92` replaced by "a dead creature is carried over and its clip is not
  restarted".

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/MobContinuityTests.cs`
- `client-unity/UnityProject/Assets/Tests/Editor/MobContinuityEditModeTests.cs`

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/sync-net.sh --check`
- Unity EditMode batch run (Editor closed; command in `docs/rework/PERF_REPORT.md`). Not part of the gate: report
  whether it was run.

## 10. Risk and suggested model tier
Sonnet. The decision moves into the library where it is unit-tested; the presenter change is small.

## 11. Known traps
- Two mobs of the same look dying next to each other: adoption must be one-to-one (nearest first, each ghost used once).
- The grey 65% tint reads as fading: apply it only after the clip ends, or not at all (state which in the hand-off).
- `knight` (the dummy and fallback look) has no death clip (`Assets/Resources/Showcase/Catalog.asset:54`): it keeps the
  plain fade.

## Notes from previous attempts
