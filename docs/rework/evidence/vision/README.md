# Vision evidence (fog of war, graceful exit and entry)

Captured with `client-unity/UnityProject/Tools/vision-shots.cjs` (headed Chromium, 1600x900, real Unity Web build, local `rh-server` with
7 bots on seed 1) and `vision-sheet.py`. Rules and design: [../../VISION.md](../../VISION.md). Page flags used by the harness:
`vision.audit=1` (console counters), `vision.debugRadius=N` and `vision.fadeDemo=1` (diagnostics, off by default, described below).

## Fog next to walls (real sight rule, no diagnostics)

* `fog-walls-sentenced-room-a.jpg`, `-b.jpg`: a walled room in the Sentenced (bright sand) zone. The area the walls hide is dimmed and
  desaturated with a soft edge; the room and the line of sight through the gap are clear.
* `fog-walls-holy-pillars-start.jpg`: the pillar field in the Holy (bright yellow) zone 11 s into a match, before any trail exists.
  The yellow ground is dimmed to tan except around the player and the delivered actors.

Honest note on how it looks: in open terrain the 900 u radius is wider than the screen and the 30 s trail keeps everything the player
walked past, so the world fog only shows behind walls, in rooms and shortly after a match starts. On bright ground (sand, snow) the dim
reads clearly. On the darkest ground (Fire basalt, base L 0.38) the same multiplicative dim is subtle in absolute terms; the minimap and
Tab map carry the information there. No real-rule wall fog was captured in the Fire or Frost zones (the spawn is random and the walls
there are few); instead the diagnostic ring below shows how the fog looks on those grounds.

## Diagnostic ring (`vision.debugRadius=8`)

`fog-debug-ring-frost.jpg` (bright snow), `fog-debug-ring-sentenced.jpg` (sand), `fog-debug-ring-fire-dark.jpg` (dark basalt): everything
farther than 8 tiles from the player is additionally fogged, so the fog pass, its soft edge and the clearings can be seen on open ground. This is
NOT the real rule; it only adds fog and delivered actors are still cleared.

## Minimap and Tab map

`minimap-a/b/c.jpg`, `tab-map-a/b/c.jpg`: the same fog texture. Ground the player's eyes reached in the last 30 s is lifted (cool, brighter,
legacy "brighter ground: vision"); the rest is veiled. The Tab map shows the line-of-sight lobes cast around walls. Contacts are drawn only
for delivered actors, as before.

## Exit and entry (`sequences/`)

Frames about every 50 ms from a CDP screencast, cropped around the actor; t = 0 is when the client logged the event. These use
`vision.fadeDemo=1`: every 6 s the nearest remote player is withheld for 2.5 s as if the server had stopped sending it (it goes through the
real departure path; the server did not remove it). On-screen departures behind a wall are rare to catch (the trail keeps tiles for 30 s).

* `leave-1-sheet.jpg` (+ `leave-1-frames/`), `leave-2-sheet.jpg`, `leave-3-sheet.jpg`: the actor, its health bar, markers, shadow and
  footprint fade out in place over about 250 ms; nothing moves.
* `enter-1-sheet.jpg`, `enter-2-sheet.jpg`: the actor fades in over about 120 ms.

## Agreement with the server (`agreement/`)

Per-match console logs and `summary.json` (18 matches, 14 of them walking, 4 standing/route, every delivered actor counted every frame):

| Measure | Result |
|---|---|
| Delivered live actors sampled (frame x actor) | 3,464,334 |
| Of those, on a tile the client's own rule also called seen | 99.922 % (2,719 on a tile it called fog) |
| Delivered live actors found under fog after clearing (must be 0) | **0** |
| Real arrivals (new delivery) | 26, of which 7 on a tile the client rule called fog (27 %) |
| Real departures (last delivered tile) | 9, of which 1 on a client-fog tile |

The arrival misses are the boundary cases: an actor appears exactly when the server's per-actor ray (exact position) clears while the
client's per-tile rule (tile centre) has not yet, or the 100 ms sample phase differs by one tick. The fail-safe clears them, so none is drawn
under fog. Departures cannot be checked against the true position (it is not sent): the log records the last delivered tile only.
