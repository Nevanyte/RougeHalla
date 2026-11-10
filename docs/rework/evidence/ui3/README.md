# Third UI pass evidence (branch `rework/ui3`)

All images are real captures of the Unity Web build against the Rust server (`source-arena`, seed1 map, 7 bots, protocol 16), headed Chromium,
one resolution per screen plus one 2560 sample, JPEG at most 1600 px wide. Raw PNGs stay outside the repo. Capture script:
`client-unity/UnityProject/Tools/hud-shots.cjs` (steps `launch` with `RH_SHOTS_LAUNCH_SHORT=1|hub`, `match`, `map`, `fight`, `panels`, `results`, `mobaudit`).

| File | What it shows |
|---|---|
| hub-1280x800 / 1920x1080 / 2560x1440 | hub room: even pedestal arc (legacy `hubLayout.ts` spots), room capped at 1.15x so a big window gets margin, not a bigger empty floor |
| shop / wardrobe / titles / achievements / leaderboard / profile-records / guide-champions / resume (1920x1080) | the hub panels in the shared dock (right of the launch panel, under the wordmark), Cinzel headings, framed tabs |
| guide-champions-1280x800, guide-counters-2560x1440 | the guide at the other sizes; its pages were blank before (a stencil `Mask` over a transparent graphic) |
| results-defeated / results-victory | the real end-of-run card (never captured before): the first from a player killed in the coliseum, the second from a match that ended with the player last |
| quest-journal / traders / notices | the in-match journal flow, re-skinned in place |
| map-1920x1080 | Tab map: soft zone borders (blurred region weights, same recipe as the ground shader) and generated weapon icons (counters panel) |
| indicators-own-wish-icon, indicators-zone-ring | own Wish icon beside the head cluster (ready: faction colour), secondary weapon badge, status glyphs, the Trial zone ring, the new champion HUD multipliers (Atk speed / Move speed) |
| mob-audit-continuity-on.log / -off.log | creature art create/destroy counts per second from `?mob.audit=1` (and `&mob.continuity=0` for the old behaviour) |

## Creature continuity measurement (real match, 1920x1080)
- Old behaviour (`mob.continuity=0`), 12 creatures in sight: **240 art creates and 240 art destroys per second** (every handle renewal).
- New behaviour, 8 creatures in sight for ~75 s: **0 creates and 0 destroys per second** in steady state (8 creates in total at first sight, 0 destroys);
  ~100-170 renewals per second were continued onto existing art.
- A real departure (creature leaves delivery while alive) fades over 260 ms at its last position; covered by `MobContinuityEditModeTests`
  and `MobContinuityTests`, not seen on screen in these runs (the player stood still near camps).

## Not captured from a real match (honest list)
Remote-actor clusters with statuses and mid-fight damage numbers (the player never met bots while the capture ran; the local actor's own
statuses are shown instead), the quest `?` mark over a giver (needs an accepted quest), the reward chest ring and choice panel (no camp was cleared),
the Plague corpse puddle, container labels, hunt ring, hover ring and death X (no stage for them in these runs: covered by EditMode tests).
The browser console shows only 404s for audio assets that this static build does not serve (audio pass, not mine).
