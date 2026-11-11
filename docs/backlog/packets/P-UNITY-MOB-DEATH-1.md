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
- `packages/client/src/render/MobView.ts:23-25` (`DEATH_MS = 450`, `DEATH_SHRINK = 0.45`), `:80-82` (`diedAt`, the server time
  of the patch that first said dead, `-1` while alive), `:139-149` (visibility and alpha/scale from `deathFade`),
  `:197-205` (`deathFade`: `1 - (renderT - diedAt) / DEATH_MS`, clamped; resets when the mob is alive again). Reference for
  timing only: legacy keeps one view per mob id, so a death start never restarts. The owner wants the Unity death clip, not
  the shrink.
- Server (verified): `crates/rh-sim/src/actor_refs.rs:221-245` renews every NPC handle whenever the tick changed or the cue
  list changed (`renew = sampled != Some(tick) || cues != current.cues`), so ids are reissued on practically every new
  snapshot; `crates/rh-sim/src/constants.rs:327` `MOB_CORPSE_MS = 1500` with `systems/mob_life.rs:569-571` keeps a dead mob
  until then.

### Root cause, checked against the code (the reading holds)
`SpriteActorPresenter.Retain` -> `Evict` (`SpriteActorPresenter.cs:200-205`) calls `TryBeginExit` (`.Fade.cs:131-143`), which
classifies a last-delivered `Dead`/`Mia` as `Died` (`VisionFade.cs:31-38`) and returns false, so the art is released at once
(`:206-209`). The corpse's new id then reaches `Present` with no art, `TryContinue` finds no ghost (only living creatures
become ghosts), a fresh `Art` is made, `BeginEnter` fades it in from 0 (`Fades(kind)` is true for creatures) and
`dead && !a.Dead` stamps `DeadAt = now` (`SpriteActorPresenter.cs:259-260`), restarting the clip. Repeated each snapshot.
Two further facts: `NoteDeath` (`.Fade.cs`) releases any ghost with the dead id, and `TryBeginExit` consults `_deaths`; a
Death event naming the old id must not cancel a parked body (see traps). `DeadAt` uses `Time.unscaledTime`, not `Now()`.

## 4. New paths
- none. New members, all in already-listed files: `MobCandidate.Dead/DiedAt/Claimed`, `MobContinuity.Adopt`
  (`Net/MobContinuity.cs`), `VisionFade.EnterStartAlpha` (`Net/VisionFade.cs`), `SpriteActorPresenter.TryDeathStart` /
  `TryOpacity` (`.Fade.cs`, test seams, already real).

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/VisionFade.cs` (`EnterStartAlpha` stub; `:31-38` classification stays) and
  `client-unity/RoguehallaNet/Net/MobContinuity.cs` (`Adopt` stub), plus their synced copies under
  `UnityProject/Assets/RoguehallaNet/Net/` (run `bash client-unity/sync-net.sh`)
- `client-unity/UnityProject/Assets/Scripts/Presentation/SpriteActorPresenter.cs` (`:206-209` release, `:259-260` death
  clip restart, `:317` grey tint)
- `client-unity/UnityProject/Assets/Scripts/Presentation/SpriteActorPresenter.Fade.cs` (`:66-90`, `:131-153`)

## 6. Contracts and references
- C-OBS: continuity is matched only from what the observation shows (look, position, status); no hidden id is used.
- The continuity rule for living creatures (`MobContinuityTests.cs`) stays as it is.

## 7. Behaviour to preserve
- Living creatures: ghost and adoption behaviour unchanged.
- A mob that leaves sight while alive still fades out.
- Players' death presentation unchanged.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-MOB-DEATH-1` passes (full).
- Unit tests in `client-unity/RoguehallaNet.Tests/MobContinuityTests.cs` (the decision, engine-free): `Adopt` continues a
  dead body with its original `DiedAt`; a creature found dead after being last seen alive takes `now`; a living sighting
  never takes a corpse; range, age and look rules as for living creatures; one-to-one claiming; `EnterStartAlpha` is 1 for
  Dead and Mia, 0 otherwise; a body nobody continues is not adopted after `StaleSeconds`.
- EditMode (`MobContinuityEditModeTests`, not gate-run, not run by the oracle author): the pinned case
  `A_dead_creature_keeps_the_plain_release_and_is_never_ghosted` is replaced by four cases: carried over with the clip start
  kept and no fade-in; first seen dead at full opacity (a living arrival still fades in); two side-by-side bodies each
  carried once; an unclaimed body is parked then released after `MobContinuity.StaleSeconds`.
- Scope of the opacity rule: creatures only. `EnterStartAlpha` is a library seam; the presenter applies it for
  `IsCreature(kind)` so players' death presentation is unchanged.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/MobContinuityTests.cs` (gate-run; 4 new cases fail on assertions, the rest pin kept
  behaviour: death-between-snapshots, range/age/look, release when dropped)
- `client-unity/UnityProject/Assets/Tests/Editor/MobContinuityEditModeTests.cs` (not gate-run; written against the test
  seams and uncompiled by Unity; the implementer must make it compile and, if the Editor can be closed, run it)

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/sync-net.sh --check`
- Unity EditMode batch run (Editor closed; command in `docs/rework/PERF_REPORT.md`). Not part of the gate: report
  whether it was run.

## 10. Risk and suggested model tier
Sonnet. The decision moves into the library where it is unit-tested; the presenter change is small.

## 11. Known traps
- Presenter flow to implement: park a dead body on eviction (a ghost with `Dead`, `DiedAt = DeadAt`, no fade, clip keeps
  playing; expire after `StaleSeconds` then release), call `MobContinuity.Adopt(..., dead, ...)` in `TryContinue` for both
  living and dead sightings, keep `DeadAt` when adopting, and start dead arrivals at `EnterStartAlpha(status)`.
- `NoteDeath` and `_deaths` name the old id: they must not release a parked body or send it to a fade.
- A body that is parked and then released pops on the frame it expires (the server drops the corpse at 1.5 s, the clip is
  normally over). The oracle pins only that it is released; whether it fades is the implementer's call, state it.
- Two mobs of the same look dying next to each other: adoption must be one-to-one (nearest first, each ghost used once).
- The grey 65% tint reads as fading: apply it only after the clip ends, or not at all (state which in the hand-off).
- `knight` (the dummy and fallback look) has no death clip (`Assets/Resources/Showcase/Catalog.asset:54`): it keeps the
  plain fade.

## Notes from previous attempts
