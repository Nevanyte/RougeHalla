# Hitbox archetypes in the Unity client: browser evidence (ADR0024 P-HB-7 and P-HB-8)

Real Chromium (headed, Playwright), the IL2CPP Web build of `rework/hitbox-client`, against `rh-server --runtime source-arena --hitboxes
archetypes` (port 7897) and `--hitboxes legacy` (port 7898), seed-1 map, 7 fill bots. The page is driven like a player (keyboard and mouse). Positions come
from the opt-in latency trace the client already has; the screen mapping is calibrated from the client's own target marks. Tools:
`client-unity/UnityProject/Tools/hitbox-proof.cjs`, `hitbox-proof-steps.cjs`, `hitbox-aim-analyze.cjs`. Raw captures (PNG) are not in the repo; the
numbers are in `data/`. Console errors in every run: 0.

Nothing here replaces the Rust vectors: the dotnet tests check the C# against `pathfinding_v2.json` and `server_walk_v2.json`
(300 queries, 954 waypoints, maximum coordinate error 0; 3 corner walks of 240 ticks, maximum drawn-versus-server error 3.1e-4 u).

## 1. Walking up to a wall from the south (`wall-approach.jpg`, `data/wall-*.json`)

Feet-to-wall-face gap in sim units, after a right-click 2 u south of a wall face, and after holding W into the wall.

| mode | click 2 u from the face | hold W |
|---|---|---|
| archetypes (foot box 10 x 6) | 6.000 and 6.000 (two walls) | 6.66 and 6.03 |
| legacy (12 u disc) | 12.000 | 19.98 |

In archetype mode the foot box touches the face (the box half-height is 6), the body box (65 u tall for the hero) reaches over the face, and the
sprite's head overlaps the wall art. In legacy mode the disc stops 12 u short. Holding W stops within 1 u of the limit because `KeyboardSteer` now
finishes a box approach with 1 u steps (the legacy disc keeps the 8 u steps, hence up to 20 u). The legacy "hold W" screenshot shows the results screen (the player had died by then), so it is not in the sheet; the number was recorded before.

## 2. No snap-back (`data/walk-*.json`)

30 s of fixed key script (W, W+D, D, S+D, S, S+A, A, W+A, W, D, S, A, held 1 to 1.4 s each, plus a right-click every fifth step) with `?inputlat=1`, three
runs per mode. "Correction" is a reconciliation sample whose model-versus-server error exceeded 0.5 u; "big" exceeded 4 u. The counter is
`LocalMotion.ReconSamples/ReconCorrections/ReconBig/ReconMaxErr` (diagnostic only), printed once a second as `[recon]`.

| | samples | corrections > 0.5 u | big > 4 u | max error | mean error | snaps (> 96 u) | walked (u) |
|---|---|---|---|---|---|---|---|
| archetypes, 3 runs | 1855 | 125 (6.7 %) | 26 (1.40 %) | 9.8 u | 0.21 u | 0 | 14037 |
| legacy, 3 runs | 1700 | 148 (8.7 %) | 51 (3.00 %) | 36.6 u | 0.37 u | 0 | 10976 |

Per 1000 u walked: archetypes 8.9 corrections and 1.9 big; legacy 13.5 and 4.7. Archetype mode is not worse than legacy. (Every run starts at a
different random spawn and match seed, so single runs vary: archetypes 32 to 47 corrections, legacy 26 to 64.)

## 3. Chest aim (`chest-aim-frames.jpg`, `data/aim-analysis.json`)

The player picked up a bow from the ground (a ranged weapon had to be found by touring the map; a training server with a weapon rack needs an
account-owned join the diagnostic client cannot make), then clicked 14 times with the cursor on a skeleton-mage's torso (the centre of its body box).
- 14 clicks, 14 aim lines, 11 arrows in flight (3 clicks fell inside the bow's draw time).
- The aim the client sent was `atan2(cursorY + 30 - feetY, cursorX - feetX)` (chest 30 for the hero): for example feet (2819.84, 4289.23), cursor
  (3087.36, 4187.49), angle -0.26201 rad.
- Every arrow's first drawn sample is at the shooter's feet raised by exactly the chest height (height 30, ground point 0.09 u from the feet).
- The raised line of every arrow passes the cursor within 0.081 u (worst case over all 11 arrows and all their samples).
- The arrows ended where they hit the body box (about 7 u from the cursor, which is the box centre).
- Hits (confirmed Hit effects by the local player) against that mob: 5 for 11 arrows in flight, 14 clicks. The mob walked toward the player and died
  after the fifth hit, and later arrows flew at empty ground.

## 4. Overlay screenshots (`looks-overlay.jpg`)

`?hitboxes=1`: foot box cyan, body box yellow. The own look of each of the five factions (hero, hero, mage, hero-female, mage-female) and
nine mob looks (mage-female, mage, skeleton, goblin, mob-goblin-elite, mob-skeleton-archer, mob-skeleton-mage, mob-zombie, mob-antlion). The overlay is read
from the delivered table and drawn at the sprite's actual position, so the picture is the agreement test.

## Sprite fit (EditMode test `EverySpriteSitsInsideItsBodyBoxWithinTwoSimUnitsAtMedian`)

Opaque sprite bounds as drawn (frame mesh bounds about the foot pivot x `WorldHeight`, + the 0.08 body lift, x the 1.2 actor scale, in sim units) against
the body box, median over the 8-direction Idle frames. Tolerance: top and bottom within 2 u, half width (N and S facings) within 2 u, horizontal centre within
7 u of the feet (heroes and the knight carry a weapon or shield on one side).

| look | top (box) | below feet (box) | half width (box) | centre x |
|---|---|---|---|---|
| hero | 65.0 (65) | 5.6 (5) | 15.9 (16) | 4.1 |
| hero-female | 67.6 (68) | 2.5 (2) | 14.8 (15) | 6.0 |
| mage | 53.1 (53) | 3.3 (3) | 16.6 (17) | 2.4 |
| mage-female | 54.9 (55) | 1.6 (1) | 17.0 (17) | 2.1 |
| knight | 71.6 (72) | 2.0 (2) | 17.6 (18) | 5.0 |
| goblin | 41.1 (41) | 3.4 (3) | 17.3 (17) | 1.9 |
| skeleton | 70.7 (71) | 9.1 (9) | 23.4 (18, the knight's width on purpose: two-handed weapon) | 2.2 |
| mob-goblin-elite | 33.7 (34) | 1.6 (2) | 13.3 (13) | 1.5 |
| mob-antlion | 29.0 (29) | 8.2 (7) | 20.2 (20) | 0.0 |
| mob-skeleton-archer | 45.3 (45) | 2.8 (3) | 14.1 (14) | 1.8 |
| mob-skeleton-mage | 43.7 (44) | 2.4 (2) | 13.7 (14) | 1.4 |
| mob-zombie | 42.1 (42) | -0.1 (0) | 8.7 (9) | 3.4 |

Largest median error: 1.2 u (antlion below the feet). The box was measured from the same art, so the vertical and width errors are rounding. No scale or
pivot needed fixing; the boxes were not changed. The worst single frames (any facing) deviate up to 7.8 u at the top and 13.2 u below the feet (skeleton),
and up to 7.1 u in width (hero) for attack-pose frames.
