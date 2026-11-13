# P-UNITY-LANDMARK-1: the client draws a zone's landmark as a landmark (the framework, and the Frost cave first)

- **Serves:** owner decision 4 (MIGRATION, 2026-11-10: one landmark per zone) and the owner's standing direction
  (2026-11-12: show each zone's landmark, close and wide, once drawn and approved by a visual review); owner
  direction 2026-11-13 (the coordinator makes the Unity front end ready while the map generator session finishes
  generation)
- **Implementer tier:** implementer-sonnet (Unity view code)
- **Reviewer:** reviewer; then a visual review of screenshots before anything is shown to the owner
- **Integration base:** feature/unity-rework after P-WIRE17-MAP-3 (`MapBlob.Anchors`) and P-MAPGEN-SIG-SCALE-1 (the
  cave is the approved 29 x 29 drawing)
- **D-rules touched:** D1 n/a (no legacy counterpart: DEV-020) · no wire change · no game rule in Unity (a landmark's
  walls, ice, lava, bog and fence are the server's tiles; the art changes nothing a fighter can do)

## 1. ID and outcome
The client receives a landmark's tiles and draws them as ordinary zone tiles: the cave is a rock ring with ice in it,
indistinguishable from any wall cluster. P-WIRE17-MAP-3 tells the client where each landmark is
(`MapBlob.Anchors`: zone, kind, centre, footprint, front, entrance). When this lands:
1. **Framework.** One presenter builds landmark art once per map from an anchor and the delivered tiles INSIDE its
   footprint (which tiles are wall, floor, low, and their terrain), never from a copy of the blueprint grid: the
   generator places a blueprint in one of eight orientations and the anchor does not say which, so art that is
   derived from the tiles is right in all eight. It offers each landmark kind: the footprint, the entrance and the
   front direction in world space; the sets of wall tiles, interior floor tiles (floor enclosed by the landmark's
   walls, reached from the entrance) and special-terrain tiles; a roof layer that fades out while the local player
   stands on an interior tile and fades back when they leave (as tall props fade: P-UNITY-PROP-FADE-1); draw order
   against actors by y, as walls. A kind with no art registered draws nothing extra (today's tiles) and logs once.
   A map without anchors draws exactly as today.
2. **The Frost cave.** Rock-mass walls (a darker, rounded treatment of the cave's wall tiles so the ring reads as one
   body, not tile blocks), a cave-mouth arch on the entrance tiles facing the front, a rock roof over the interior
   that fades when the player is inside (so from outside it is a hill with a mouth; inside you see the ice, the rock
   pillars and the camp), a cold glow at the mouth. The ice floor stays the tile art it is. Mob and player names,
   bars and marks draw above the roof layer when their actor is visible.

## 2. Dependencies
- P-WIRE17-MAP-3 merged. P-MAPGEN-SIG-SCALE-1 merged (so a landmark-mode map has the real cave). The approved
  drawing for reference only: `docs/landmarks/blueprints/cave.txt`.
- The other four landmarks are P-UNITY-LANDMARK-2 (volcano), -3 (church with its churchyard), -4 (bog tree), -5
  (Holy hall): one packet each on this framework; each can start as soon as this lands, against a test map built
  from its approved drawing, before its generator packet has landed.

## 5. Exclusive write scope
- new files under `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/` (the presenter, the tile
  classification, the cave art), the one call in `View/ArenaView.cs` that builds and clears it, procedural art
  beside `RegionPropArt.cs` if the cave's textures are painted as the other region art is
- engine-free geometry (interior flood fill, the fade's "is inside" test) in `client-unity/RoguehallaNet/Net/Ui/`
  with its synced copy, so it is tested without Unity
- not `Protocol/**`, not `crates/**`

## 7. Behaviour to preserve
- A map without anchors, and every zone without a registered landmark art, look exactly as today; no per-frame
  garbage; the vision/fog rules: the roof never shows or hides anything the server did not deliver (a fighter inside
  the cave whom the viewer cannot see is not drawn; one the viewer can see is drawn above the roof or the roof fades:
  say which and why).

## 8. Acceptance checks
- Engine-free: the interior of a hand-made walled box with one opening is exactly its enclosed floor; a box with two
  openings; a box open to the map edge has no interior; all eight orientations of the approved cave grid give the
  same interior tile count.
- EditMode: a map with a Cave anchor builds one landmark object with a roof covering every interior tile and no tile
  outside the footprint; the roof's alpha goes to its faded value when the local player's tile is interior and back
  when it is not; a map without anchors builds none; an unknown kind builds none and logs once; a frame where nothing
  changed allocates nothing.
- Screenshots (the coordinator's round, after merge): the cave close and wide, from outside and inside, on a real
  landmark-mode map; a visual review signs them before the owner sees them.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-LANDMARK-1` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-LANDMARK-1`

## 10. Risk and suggested model tier
Sonnet. The look is a judgement no test makes: the packet is done when the tests pass, and shown to the owner only
after the screenshot round and its visual review.

## 11. Known traps
- The anchor's footprint is the blueprint box; a landmark's tiles can be fewer (the cave's corners are chamfered) and
  another feature never stands inside it, but plain floor inside the footprint and outside the walls (the ring round
  a building) is NOT interior.
- The decoration packet already draws server props and ground tints inside landmark bands: the landmark's own
  footprint gets no props from the rules, but check nothing is drawn twice.
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.

## Notes from previous attempts
