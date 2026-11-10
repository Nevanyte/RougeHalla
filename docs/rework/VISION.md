# Vision: fog of war and graceful exit/entry (Unity client)

Presentation only. The server decides what a player sees and sends only those actors (C-OBS). The client explains it: a fog on the
world, minimap and Tab map that agrees with where actors stop being delivered, and actors that fade instead of popping.

## The server's rule (rh-sim `vision.rs`, `observe.rs`)

* Radius `VISION_RADIUS` = 900 u. Tile `TILE` = 32 u.
* Blockers: only the wall class (tile value 1, `MASK_SIGHT` = 0b01). LOW cover (2), fences, lava, crevasses, bushes, terrain features do
  not block sight. Off the map blocks.
* Ray test `scene_line_blocked` (legacy `hasVisionLineOfSight`): grid walk from the eye; the first wall face is visible; crossing a corner
  next to either wall blocks; the walk stops on reaching the end tile. It is not symmetric (a to b can differ from b to a).
* **It is a per-tile trail, not a per-actor ray.** Every `VISION_UPDATE_MS` (100 ms) the viewer's eyes stamp every tile whose centre is
  within the radius and in line of sight (plus the standing tile, plus the whole coliseum rectangle while standing in it). A tile stays
  seen for `VISION_TRAIL_MS` (30 s) after the last stamp (exclusive). An actor is delivered when it stands on a seen tile (or in the
  live direct line), so an actor can be sent behind a wall that the player looked past a few seconds ago, and disappears when its tile
  expires. This is what the legacy fog drew too (`RaidVision.ts`: `VisionFog` dims every tile `canSee` rejects, 0x070d18 at 0.62).
* Other sources: the owner's wards (a camp centre becomes a transient eye), the Sentenced hunt target (that actor only, through fog and
  bush), a dead viewer sees nothing, bush occupants are hidden from outside their bush (per actor, 64 u reveal), Swarm "hidden" actors.
* On the wire: only the actors (and props, projectiles, fields) the viewer may see, per snapshot. **No visibility mask, no radius, no
  rules, no explored state, no last-known positions.** "Departed" in a snapshot delta only means "not in this observation": it does not say
  whether the actor walked out of sight, died, or left.

## What the client mirrors (`client-unity/RoguehallaNet/Net/Vision.cs`, engine-free, unit-tested)

* `VisionRule`: the constants (marked MIRRORED; asserted equal to Rust by `protocol/fixtures/sight_v1.json`), `LineBlocked` (the exact
  `scene_line_blocked`), `RevealsTile` (the exact `reveals_tile`, including the standing tile and the coliseum rectangle derived from the
  region plane).
* `VisionField`: the 30 s per-tile trail rebuilt from the player's own delivered position, sampled every 100 ms of server time,
  recomputed only when the position changed, with a dirty rectangle.
* `FogMask`: one byte per tile, blurred (2 passes; 1 on Low) so the edge is soft, then carved clear around every delivered actor.

Proof: `cargo test -p rh-sim vision::golden` samples the real private Rust functions on seed 1 (4,209 line queries and 48 reveal sets of
about 3,700 tiles, including coliseum origins) and writes `protocol/fixtures/sight_v1.json`; `SightGoldenTests` replays every row in C#.

## Fail safe

The client cannot reconstruct: wards, the hunt target, gates that lock (the locked map has extra wall tiles), a trail older than the
client's own join, bush concealment, hidden actors. It does not try. **Any actor the server delivers is drawn fully visible with a clear
area around it** (`FogMask.Compose`, `SpriteActorPresenter.CollectClearings`), whatever the client's own rule says; a fading actor keeps
its clearing only as long as it is visible. The fog can only dim; nothing it does adds information.

## Exit and entry

`VisionFade` classifies a departure from what the client was told: the last delivered status, a Death event naming the actor, the match
phase, and any timeline cut. Only a living player leaving a running match fades (260 ms smoothstep, frozen at the last drawn pose with its
bar, markers, shadow and footprint); died, left-the-match and resets keep their own presentations. A new player fades in over 120 ms.
Creatures do not fade: the server renews a creature's observer handle on almost every observation, so a "departed" creature is usually the
same creature under a new id and the client is told never to infer continuity from position.

## Cost and settings

One quad, one `Texture2D` (160 x 160 RGBA32, bilinear). The reach is recomputed at most every 100 ms and only when the player moved (about
3,500 rays); the blur touches only the dirty rectangle; the per-frame work is carving the actor clearings and, only when something changed,
one 25,600-pixel upload (about 100 KB). No per-frame allocations. Low quality blurs once instead of twice; no preset switches the fog off.
There is no animation (nothing to reduce for reduced motion). Minimap and Tab map reuse the same texture through a UI shader.

## Not reconstructed (fails safe)

Wards, the Sentenced hunt target, locked coliseum gates (extra wall tiles not on the wire), the first 30 s after joining mid-match (the earlier
trail is unknown), bush concealment (per actor, no bush data on the wire), hidden actors, a dead viewer (fog is off while dead). Delivered
props, projectiles and fields are not given clearings (actors only).

## Values that should move into Welcome (protocol 16)

`VISION_RADIUS` 900, `VISION_TRAIL_MS` 30000, `VISION_UPDATE_MS` 100, `MASK_SIGHT` 0b01, `TILE` 32, the coliseum rectangle (x, y, w, h), and a
rules version byte. Until then they live in `VisionRule` (marked MIRRORED) and are asserted against `protocol/fixtures/sight_v1.json`.

See [evidence/vision](evidence/vision/README.md) for captures and measured agreement.
