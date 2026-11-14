# P-UNITY-LANDMARK-ROOF-RETURN-1: a landmark's roof comes back when nobody the viewer sees is inside

- **Serves:** owner decision 4 (2026-11-10: one landmark per zone); screenshot round 9 (2026-11-13, Web build of `1ac2b2a76`),
  defect 1
- **Implementer tier:** implementer-sonnet (Unity view code)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework after the five landmark arts
- **D-rules touched:** D1 n/a (DEV-020) · no wire change · no game rule in Unity · C-OBS: the roof may react only to
  actors the server is showing the viewer now

## 1. ID and outcome
Seen in the running Web client (session scratchpad, `shots9/`): the Frost cave's roof is opaque before the player
enters (shots 90, 91), fades when the player is inside (05, 92), and is still gone after the player has left: 5 seconds
after (94) and 30 seconds after, 8 tiles away (95). The roof is the landmark: without it the cave is a ring of walls.
The rule (P-UNITY-LANDMARK-1, fact F3) is that the roof fades while an actor the viewer can see stands inside.
`LandmarkView.NoteActor` is called for every actor `ArenaView` draws (`ArenaView.cs:303`, `:322`, `:492`), and
`LandmarkView.Tick` fades the roof if any was noted that frame. **Suspected, not established:** the camp inside the
cave is drawn after the player leaves as something that is not a live, currently visible actor (a lingering track of a
mob last seen there, ADR 0025; a corpse; a mob still delivered through the mouth), and each of those is noted. The
oracle author establishes which, by reading and by a test that reproduces it.

When this lands: the roof is faded exactly while at least one LIVE actor that the server is delivering to this viewer
in the current snapshot stands on a tile that fades it (the local player included); lingering tracks, corpses, and
anything drawn from memory do not hold the roof open; once the last such actor leaves or stops being delivered, the
roof returns at the usual fade rate. If the established cause is that live camp mobs remain delivered to a viewer
standing outside (so the roof is open whenever the player is near), say so in the brief with the vision facts and
stop for a ruling: that is a design question (the roof would rarely be seen from close by), not a bug to patch.

## 2. Dependencies
P-UNITY-LANDMARK-1 and P-UNITY-LANDMARK-SEAMS-1 (merged).

## 3. Relevant legacy paths
none (DEV-020)

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs`: only the three `_landmarks.NoteActor` call sites
- `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/LandmarkView.cs` (if the rule moves there)
- not the tall-prop fade (`RegionProps.NoteActor`): if it has the same fault, report it; it is its own packet
- not any existing test

## 7. Behaviour to preserve
- The roof fades for the local player and for any live visible actor inside, at once; nothing per frame allocates;
  every existing landmark test stays green.

## 8. Acceptance checks
- EditMode, through the real `ArenaView` path the three call sites sit on (a test that calls `LandmarkView.NoteActor`
  directly proves nothing here): with a cave on the map, a live visible mob inside fades the roof; when that mob
  becomes whatever the established cause is (a lingering track, a corpse), the roof returns to opaque within the fade
  time; the local player walking in and out fades and restores it. Red today for the cause found.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-LANDMARK-ROOF-RETURN-1` passes.

## 9. Validation commands
- `bash client-unity/UnityProject/Tools/editmode.sh`; then `git checkout --` any modified font asset under
  `client-unity/UnityProject/Assets/Resources/Showcase/`.

## 10. Risk and suggested model tier
Sonnet. The cause is not established; the oracle author reproduces it first.

## 11. Known traps
- The same three call sites feed `RegionProps.NoteActor`: do not change what tall props do in this packet.
- A dead actor's art lingers on purpose (P-UNITY-MOB-DEATH-1): the fix is about what counts for the roof, not about
  what is drawn.

## Notes from previous attempts
