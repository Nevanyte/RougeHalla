# Regions pass 3 evidence (branch `rework/regions3`)

Owner feedback this pass answers: "the square region of Holy [should be] inside of one large temple, not a bunch of little tiny temples on a box" and "the trees in
Plague appear to be cut off on the right and left edges". Everything else was judged good and is untouched.

Two kinds of images, both JPEG:

- `browser/`: headed Chromium 1920 x 1080 against `rh-server` (seed1 on 127.0.0.1:7907, `?fx.quality=high`), the Unity Web build of this branch, captured by
  `client-unity/UnityProject/Tools/atmosphere-shots.cjs --temple` (it right-clicks the minimap to walk the hero, retries matches until the random spawn is near the tour start, and
  shoots in place with `name:here`). These are the final judgement. The raid ends 30 to 250 s after it starts and bots kill an idle hero, so only places near the spawn
  could be shot: the portal and outside views are a minute of walking from a spawn at the south end, the apse is NOT in a browser frame (it is in the Editor frames).
- `editor/`: `AtmospherePreviewCapture` (Unity batch, no server, particles on, `fx.brightness=1.4`). The Editor renders darker than the browser and the haze sprites look
  heavier; use these for layout and the whole-footprint views, not for brightness.

## What the interior is now

One building, seen from above with the roof removed (`TempleLayout`, `TempleStyle`, the temple branch of `Resources/Regions/RegionGround.shader`, `RegionWallAtlas` Temple style,
`RegionPropArt.Temple.cs`). The footprint detection is unchanged (51 x 51 at (63,4) = 52.7% of Holy on seed1, 48 x 48 at (59,1) = 46.7% on seed2).

- **Structural grid.** The 3 x 3 wall blocks stand 6 tiles apart: they are the great piers; the open floor between them is a grid of 3 tile aisles. The plan snaps to the aisle
  crossing nearest the footprint centre ("the great crossing", under where a main dome would be): the nave runs north-south through it, the cross axis east-west.
- **Piers.** Same stone as the floor (one palette, `TempleStyle`), no dome, no roof, nothing raised on top: a cut-ashlar cap with a coping, a voussoir fan (arch springer) at the
  middle of each side and engaged column tops at the corners; faces with a lit plinth moulding, fluted engaged columns with bases and capitals, a blind pointed arch on impost blocks, a
  cornice. Real wall tiles that lie inside the footprint (the generator's small buildings) are dressed the same way, as solid temple wall with blind arches.
- **Vaulting as light and shade on the floor, never geometry.** Between neighbouring piers a soffit strip crosses the gap with lit rims and the cast shade falling away from the sun, a
  gilt keystone mark at its middle; groin ribs run from each pier corner to the bay centre; a rosette marks each bay; an apron and a gilt ring sit round every pier. Strips and ribs
  exist only where the piers on both ends exist (a one-texel-per-tile pier mask, `_TempleTex`).
- **Floor plan.** Large polished slabs with soft mottling (no noisy texture); carpet runners with gilt borders along the nave and the cross axis; a great eight-pointed star (two
  squares) round the crossing and concentric border lines inside the promenade; the 16-point medallion with the Holy faction icon at its centre; a stepped half-round dais in the apse
  with a gold arc, flanked by braziers and two pierced screens, closed by a mihrab niche (nested pointed-arch outlines and an orb of light; no crossing lines, no real-world religious symbol).
- **Perimeter.** Seen from outside: a continuous three-tread plinth with relief and a cast shade on the sand to the south and east, a slim colonnade every 3 tiles on an open arcade
  line (gaps of at least 3 tiles; nothing on the footprint boundary tiles, which stay ordinary floor), heavy gate jambs flanking grand portals on the south, east and west axes (a portal is
  moved to the next aisle line when a real wall is in the way, and omitted if none is clear), and a minaret at each corner. The north end is the apse, not a portal.
- **Light.** The interior atmosphere profile is cooler and softer (cool ivory sun, cooler ambient), the stone is desaturated compared with the sand, light enters as slanted shafts of
  coloured glass light along the one sun direction (north and west arcade bays, some bay centres, long soft shafts with dust motes drifting in them), a pool of coloured light under the
  medallion, warm pools at lamp stands, glowing gold inlay lines (aisle centres, runner borders, star, medallion) with a very slow pulse and a glimmer travelling along the runners, a soft dark
  threshold band just inside every portal. Holy-light terrain (a gameplay surface) is drawn as a translucent pool on the stone inside the temple so the medallion stays readable; its terrain
  kind and `SurfaceMap` answer are unchanged. Lamp stands are sites for the existing pooled, camera-culled accent lights (same cap and culling as the Sentenced lanterns).
- **Props inside** (sparse): lamp stands, braziers, urns, benches, screens; all temple props except urns and benches are tall and use the existing fade-near-actors rule.
- **Hook.** `TempleLayout.InsideTemple(Vector3 world)` and `SurfaceMap.InsideTemple(world)` / `InsideTempleTile` (geometry, so it is true over a holy-light tile too) for the audio ambience to switch on later.

## How overhead elements avoid hiding actors

There is no geometry over the floor between piers: arches, vaults and the lamp light are floor shading only. What stands above the floor (columns, gate jambs, minarets, mihrab, lamp stands,
screens, braziers) is a prop flagged `Tall`, which `RegionProps` fades to 30% while any actor stands behind it (same rule as trees), tested (`OverheadPropsFadeWhenAnActorStandsBehindThemAndNothingHidesAnActor`). Piers
are the generator's own wall blocks and keep the legacy wall behaviour. Nothing is drawn on a walkable boundary tile that could read as collision (test: every temple prop at least 1.4 tiles inside the edge,
columns at least 2 tiles apart, every open portal has a clear 3 tile corridor).

## Plague trees

Cause: sprites were authored in a fixed atlas cell (`plague.tree` 148 x 204 px) but the canopy lumps reach about 98 px each side of the trunk, so the left and right edges were sliced flat by the
cell. The same happened, more mildly, to `frost.reeds`, `fire.rocks`, `fire.vent`, `holy.shrub`, `col.rack` (and glow or shadow tails of many props were cut at the bottom). Fix (`RegionPropArt`,
`RegionCanvas`): every prop is painted on a canvas padded 44 px at the sides and top and 18 px below the nominal cell, then cropped to its opaque bounds plus 3 px, pivot unchanged; the
fade footprint (`Width`) now uses the cropped width. Test: every prop cell has at least 2 px of transparent margin on all four sides (alpha above 0.03) and a test lists which props used to
overhang their cell. `editor/plague-tree-before-after.jpg` (before = `-atmPropPad 0`), `browser/plague-trees-before-regions2-build.jpg` (the previous build, trees cut at the right) and
`browser/plague-trees-after.jpg` (same spawn, whole canopies).

## Numbers (browser, `browser-luma-contrast.json`, `contrast-measurements.json`)

Luma (Rec.709 of the sRGB frame) on Holy shots: mean 0.52 to 0.59, p95 0.75 to 0.81, clipped (> 0.9) 0.04 to 0.09% (regions2 Holy: mean 0.45 to 0.63, clipped 0.04 to 0.31%; limit 2%).
Plague frames: mean 0.21, clipped 0.04%. Brightness order tests pass (`PassiveLightRankingFollowsTheBrief`, `PassiveLightOrderingStillHolds`, temple interior still above 0.8 x Frost).

Contrast (WCAG; gate 3:1 silhouette edge, 4.5:1 hp bars), every visible character in the frame measured by hand with the same definition as the script:

| Where | Who | Ground luma | Edge | Bar |
|---|---|---|---|---|
| medallion | hero (Holy mage) | 0.62 | 4.94 | 8.29 |
| carpet | 3 brown mobs | 0.52 to 0.53 | 5.64 to 7.72 | 6.86 to 9.08 |
| floor beside the carpet | 2 brown mobs | 0.44 to 0.45 | 4.90 to 5.60 | n/a |
| cross aisle beside a pier | hero | 0.48 | 6.14 | 8.37 |
| plain pale floor | 3 silver-armoured mobs | 0.53 to 0.55 | 7.63 to 8.84 | 8.56 to 8.66 |
| carpet | hero | 0.50 | 5.24 | 6.85 |
| portal threshold band (carpet) | hero | 0.37 | 5.83 | 6.93 |
| sand outside the plinth | hero, 2 mobs | 0.28 to 0.44 | 5.43 to 7.05 | 6.76 |

Every edge is at or above 4.9 and every bar at or above 6.8. Body contrast (median of the sprite against the ground) is 1.0 to 1.8: as in regions2 the EDGE carries the gate (outline halo and rim),
not the body.

## Tests

`dotnet test client-unity/RoguehallaNet.Tests`: 1060 passed. Unity EditMode: 433 run, 432 pass; the one failure, `VisionPresentationEditModeTests.A_new_actor_fades_in_quickly_and_a_pooled_art_comes_back_opaque`
(contact shadow alpha 0.85, expected 1.0), also fails on the unmodified base commit 41175b87 (verified by stashing this branch), is in the fog-of-war code this task may not touch. New: `RegionPropMarginEditModeTests` (3),
`TempleInteriorEditModeTests` (grid alignment, no dome/roof on piers, nothing on piers, overhead props tall and fading, open boundary and portal corridors, interior hook, lamp sites and the pooled cap). `node tools/art/palette-check.cjs`: 396 / 396, 0 fail.

## Not done / weak

- The apse and the mihrab are only in Editor frames (the browser raid ended before the hero got there); the browser frames are seed1 matches plus one seed2 frame (`browser/seed2-west-portal-hero.jpg`: hero at the west portal, mean luma 0.53, clipped 0.04%, edge 4.53, bar 6.31; there the piers stand flush on the boundary and act as the temple wall).
- On seed1 the west portal is not on the cross axis (a real building stands in front of it), so the west carpet runs into that building's wall.
- Piers are the engine's low wall blocks (0.67 tile face): they read as massive masonry piers with engaged columns, but they are not tall. Hanging lamps and chandelier rings were not drawn (they would hide actors); the light they would give is on the floor.
- Mobs measured are the ones that happened to be in frame (brown and silver-armoured); no contrast-lab run (the tool had not landed). Shader cost in the temple was not profiled in the browser.
- The hero's HUD hp bar in the Plague frames measured 4.46 and 4.96 (a bright sun ray crosses the bar window); regions2 measured 6.8 to 7.8 there. Plague ground and lighting were not touched.
