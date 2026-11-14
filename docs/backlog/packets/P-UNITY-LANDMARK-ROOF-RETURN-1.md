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

**Owner ruling (chat, 2026-11-13).** Offered three options (partial fade; the local player only; leave as is), the owner
answered: "1, fade to about 10% (mostly see through) still should roughly see the fact that you are in the cave". Option 1
(leave the rule that other delivered actors count, but make it partial) was chosen. The rule, for every landmark roof and
canopy (the framework, not only the cave):
- The LOCAL PLAYER stands on a tile that fades the roof (`Landmark.Fades`): the roof goes to `RoofFadedAlpha` (0.1, kept; pinned
  greater than 0 and at most 0.15, so the player can still tell they are under a roof).
- The local player is NOT on such a tile and at least one other live actor the server delivers in the current snapshot is: the
  roof goes to the new `RoofPeekAlpha` (0.5; pinned between 0.4 and 0.6), so the actor can be seen and the building still reads
  as roofed.
- Nobody delivered is on such a tile: opaque (1), reached at the usual fade rate (`PropFade.FadeRate`).
- Both hold: the local player's rule wins (faded).
This does not remove the long hold seen in shots 94 and 95 (the server delivers those mobs, see the facts); it makes it a
half-transparent roof instead of a nearly absent one. Lingering tracks, corpses and memory-drawn art still never count.

API chosen: `LandmarkView.NoteActor(Vector3)` keeps its signature and now means the LOCAL PLAYER's note (full fade, behaviour
unchanged, so every existing test that notes "an actor" stays valid); new `LandmarkView.NoteOtherActor(Vector3)` is any other
delivered actor (peek). `ArenaView` keeps `NoteActor` at the local-player site (about `:322`) and uses `NoteOtherActor` at the two
others (`:303`, `:492`).

## Established facts (oracle author, 2026-11-13): the cause is (d), live delivered mobs; ruled by the owner (above)
Established by reading (no EditMode reproduction was
needed: three of the four candidates cannot reach the call sites at all).

What the three call sites iterate (`ArenaView.cs`):
- `:291-305` `remote` (the `Present` argument): once a membership exists, only `ActorKind.Player` rows whose id is in
  `_membership` (`:294`, `:297`); `:322` the local player drawn from `me`/`motion` (`:307`); `:485-492` `PresentLatestNpcs`
  over `_latestNpcs`, filled in `RetainObservedActors` (`:392-401`) from `Snapshots.Sample(NewestMs)` (`:376-379`).
- Every row of those sets is an actor in the NEWEST snapshot the server delivered. `Emit` (`SnapshotBuffer.cs:132-166`) copies
  exactly the wire actors; nothing the client remembers is added.

Candidates:
- (a) lingering tracks: not actors. ADR 0025's "tracks" are footprints (`FootTracker`, `SurfaceFx`), drawn by the surface
  layer; no mob "last seen" record feeds either loop. Cannot hold the roof.
- (b) corpses: a dead mob is delivered only for `MOB_CORPSE_MS = 1500` ms (`crates/rh-sim/src/constants.rs:329`); the
  presenter's lingering death art (P-UNITY-MOB-DEATH-1) is not noted. At most 1.5 s of hold, not 30 s. Not the cause.
- (c) memory-drawn art (vision-fade tail, ghosts, `MobContinuity` candidates): they live in the actor presenter and are never
  passed to `NoteActor`. Not the cause.
- (d) LIVE camp mobs the server keeps delivering to a viewer outside: **this is the cause.** Two server rules:
  1. `crates/rh-sim/src/observe.rs:1097-1117`: every mob that passes `vision::point_visible` is delivered
     (unless hidden by a status). `point_with` (`vision.rs:357-370`) is true when the point is within
     `VISION_RADIUS = 900 u` (28.1 tiles; `TILE = 32 u`, `constants.rs:65,73`) on a clear `MASK_SIGHT` line
     (`scene_line_blocked`, `vision.rs:303-355`; only `TILE_WALL` blocks, `TILE_LOW` does not), OR when the point lies in
     the viewer's reveal trail, OR in an owned ward's sight.
  2. The reveal trail (`vision.rs:127-216`, `VISION_TRAIL_MS = 30_000`, `constants.rs:85`): every tile the viewer could see
     from any origin in the last 30 s stays visible for 30 s from that origin (refreshed about every `VISION_UPDATE_MS`).
     So for 30 s after the player has stood inside the cave, a camp mob standing on a tile seen from there is still delivered
     live, walls or not.
- The cave geometry (`docs/landmarks/blueprints/cave.txt`; walls `#` and `R` are TILE_WALL, so sight is blocked): the camp
  centre is at (14, 7) of 29 x 29 and the mouth is the three tiles x = 13..15 at the bottom row (y = 28), on the camp's
  column, with a clear floor corridor between (columns 11..17 are plain floor). From a viewer outside on the mouth axis the
  camp centre is 21 tiles from the mouth plus the viewer's distance beyond it, so the camp centre is delivered while the
  viewer is at most 28.1 - 21 = about 7 tiles beyond the mouth, the nearer halo mobs (y 8..10, 18..20 tiles from the mouth)
  up to about 8-10 tiles, within a cone the mouth's width allows. Off the axis, or from any side of the closed walls, no mob
  inside is delivered by sight (this is why shot 90, roof opaque with the camp inside undelivered, is consistent).
- Match to the shots: 92 inside (faded, correct); 94 five seconds after leaving: inside the 30 s trail and near the mouth;
  95 "about 30 s" after, "8+ tiles" away: at the edge of the trail's 30 s and inside the sight cone beyond the mouth
  (the report's timings are estimates; the mouth axis points toward the coliseum, which is where the player walked).
- Not reproduced end to end (no running server in this job): the exact seconds in 94/95 and the player's bearing from the
  mouth are not recorded in the shots' notes. The rule above is from the code, and the client cannot tell these rows from any
  other live, visible mob: the Rust server deliberately delivers them (C-OBS: the viewer may see them).

`RegionProps.NoteActor` (tall-prop fade): called at the same three sites (`ArenaView.cs:302, :321, :491`) with the same
sets, so it reacts to the same delivered mobs. It has no separate fault; it would behave identically under any ruling.

Consequence: the old rule (any delivered actor fades the roof fully, P-UNITY-LANDMARK-1 fact 3) is replaced by the owner ruling
above. The four options listed before the ruling are dropped; the chosen one is the partial fade.

## 2. Dependencies
P-UNITY-LANDMARK-1 and P-UNITY-LANDMARK-SEAMS-1 (merged).

## 3. Relevant legacy paths
none (DEV-020)

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs`: only the three `_landmarks.Note*` call sites (`:303` and `:492`
  become `NoteOtherActor`; `:322` stays `NoteActor`)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/LandmarkView.cs` (the peek state, `NoteOtherActor`)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/Landmark.cs` (a second per-frame flag) if needed
- not the tall-prop fade (`RegionProps.NoteActor`): if it has the same fault, report it; it is its own packet
- not any existing test

## 7. Behaviour to preserve
- The local player inside fades the roof at once; nothing per frame allocates;
  every existing landmark test stays green.

## 8. Acceptance checks
- `LandmarkRoofPeekEditModeTests` green, and every existing landmark test green (three were amended to the ruling, see Oracle
  files). Red today: the peek and call-site tests.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-LANDMARK-ROOF-RETURN-1` passes.

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Assets/Tests/Editor/LandmarkRoofPeekEditModeTests.cs` (+ `.meta`): constants bounds; local inside is
  faded; only another inside is peek (drawn pieces carry it); nobody opaque; both is faded (either note order); leaving restores
  opaque from either state at the fade rate; peek to faded and back; on the real cave drawing and on a `SetCover` cover; a source
  check that `ArenaView` has three note call sites, the local one `NoteActor`, the two others `NoteOtherActor`.
- Existing tests amended in the `stub:` commit (the owner ruling changes what they pin; flagged to the owner):
  `LandmarkViewEditModeTests.AnyActorTheViewerMaySeeInsideFadesTheRoofSoItsNameAndBarsShow` (the mob note `NoteActor` to
  `NoteOtherActor`, expectation `RoofFadedAlpha` to `RoofPeekAlpha`, comment), `ChurchLandmarkEditModeTests`
  `TheRoofFadesForAnActorInsideTheBuildingAnd...` (last block: Camp note to `NoteOtherActor`, expectation peek) and
  `BogTreeLandmarkEditModeTests.TheCanopyFadesForAnActorOnTheDryGroundRoundTheTrunk...` (last block, same change). Every other
  existing test notes with `NoteActor` and keeps meaning "an actor that fades it fully", unchanged.
- Not pinned: a real `ArenaView` driven on a fake transport (too heavy for this); the call sites are pinned by the source check.
  Church art and the bog canopy are covered through the framework cover path and their own amended blocks, not a new stamp.

## 9. Validation commands
- `bash client-unity/UnityProject/Tools/editmode.sh`; then `git checkout --` any modified font asset under
  `client-unity/UnityProject/Assets/Resources/Showcase/`.

## 10. Risk and suggested model tier
Sonnet. The cause is established; the rule is the owner ruling above.

## 11. Known traps
- The same three call sites feed `RegionProps.NoteActor`: do not change what tall props do in this packet.
- A dead actor's art lingers on purpose (P-UNITY-MOB-DEATH-1): the fix is about what counts for the roof, not about
  what is drawn.

## Notes from previous attempts
