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

## Established facts (oracle author, 2026-11-13): the cause is (d), a design ruling, NOT a bug to patch
**Status: BLOCKED for a ruling. No oracle test is written, on purpose.** Established by reading (no EditMode reproduction was
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

Consequence for this packet: with the brief's rule ("faded exactly while a live actor the server is delivering stands inside")
the roof is faded today by definition, so the client already implements it; there is no failing assertion to write. A fix is
a design change: pick one (owner and coordinator):
  1. Leave as is (the roof means "someone you can see is inside"; it is open near the mouth axis and for 30 s after leaving).
  2. Fade only for the local player (and allies), ignoring other actors; trivial: drop the NPC and remote notes at `:303` and
     `:492`, keep `:322`. The cave then never shows what is inside to an outside viewer.
  3. Fade for the local player, and for other actors only while the viewer is also inside the cover (the roof hides the
     interior from outside viewers although the server shows them). A view rule only, no wire change; tell the owner it
     draws mobs the viewer sees as a roof-hidden shape, which is a visible-information question for C-OBS.
  4. Trim the memory part only: no client change can do this (the client cannot see the trail); Rust-side, out of scope.
Whichever is chosen, the oracle then is: fixed-map EditMode test through the real `ArenaView` path (rig:
`TrainingHudRig.cs`; map as `LandmarkViewEditModeTests`): live mob inside + local player outside; local player in, then out.

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

## Oracle files (read-only for implementers)
none yet: blocked for a design ruling (see Established facts); no test file was added.

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
