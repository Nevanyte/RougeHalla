# UI verification checklist (fourth UI pass)

Rows are the audit rows of `LEGACY_INDICATORS.md` that are built or matching (55 rows); "seen" means a real match on the merged build, looked at by the author (Read tool) and judged right. **Seen: 22 of 55; not seen: 33** (reason in Notes). Evidence in `evidence/ui4/`; harness `client-unity/UnityProject/Tools/ui-scenarios.cjs`. Blocked-by-wire rows (B1-B19) are not listed.

| ID | Indicator | Seen in real match | Evidence | Notes |
|---|---|---|---|---|
| P1 | Body disc / local ring | yes | tabmap and all frames (e.g. full-container-label-interact-1920.jpg) | sprite character by decision; local ring under the fighter seen |
| P4 | Health bar tones | yes | crop-remote-cluster-damage-number.jpg | red bar at 25 percent on a remote Plague bot; green on full |
| P5 | Barrier bubble | no |  | no barrier source reached in staged fights |
| P6 | Own Wish icon beside the name | no |  | shown only in ui3 evidence (indicators-own-wish-icon); not re-seen this pass |
| P7 | Bounty crown and number | no |  | no actor held a bounty in any run (needs kills) |
| P9 | Mark text cues | no |  | no taxed/suppressed/exec-blocked state reached |
| P15 | Hidden fighter (Swarm) | no |  | Swarm not cast |
| P16 | Hit flash (Hit clip) | no |  | clip, not isolated in a frame |
| P17 | Hover ring and lock ring | yes | crop-lock-and-hover-ring.jpg, crop-lock-ring-2.jpg | hover ring (white ellipse) and red lock ring on creatures/dummies; wand locks, melee does not |
| S1 | Status glyph: stunned | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only |
| S2 | Status glyph: rooted | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only |
| S3 | Status glyph: silenced | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only |
| S4 | Status glyph: slowed | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only |
| S5 | Status glyph: attack-slowed | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only |
| S6 | Status glyph: anti-heal | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only |
| S7 | Status glyph: damage over time | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only |
| S8 | Status glyph: untargetable | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only |
| S9 | Status glyph: hidden | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only |
| S10 | Status glyph: zoned | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only |
| S11 | Status glyph: last stand | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only |
| S12 | Status glyph: haste | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only |
| S13 | Status glyph: casting | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only |
| G1 | Signature chilled | yes | crop-lock-and-hover-ring.jpg | snowflake glyph on chilled creatures |
| G2 | Signature burning | yes | crop-lock-and-hover-ring.jpg | orange glyph on burning imps |
| G3 | Signature diseased | yes | crop-remote-cluster-damage-number.jpg | icon beside the remote Plague bot |
| G4 | Signature execute | no |  |  |
| G5 | Taxed / suppressed named | no |  |  |
| G6 | Signature exec-blocked | no |  |  |
| M1 | Role mark on the disc | yes | crop-lock-and-hover-ring.jpg | swarm dots on Ember Imps |
| M2 | Mob hp bar only when hurt | yes | crop-lock-and-hover-ring.jpg | calm creatures show no bar, hurt ones do |
| M3 | Mob names | yes | crop-lock-and-hover-ring.jpg | overprinting names of a tight camp are now suppressed (presenter pass), seen in build before the merge |
| M4 | Elite rings and star | no |  | no elite met |
| M5 | Elite emblem layers | no |  |  |
| M6 | Mob death shrink and fade | no |  |  |
| M7 | Training dummy | yes | full-container-label-interact-1920.jpg |  |
| F1 | Damage numbers | yes | crop-remote-cluster-damage-number.jpg | small red number beside a remote bot hp bar; hard to catch (700 ms) |
| F2 | Damage-over-time number | no |  |  |
| F5 | Hurt vignette | yes | hurt-vignette-peak-1920.jpg | red edge tint on a heavy hit; hits under 2 percent of max hp do not flash (legacy rule) |
| F8 | Death X decal and death line | yes | crop-death-line.jpg | X at the fall, YOU DIED on a dark plate, results card 1.5 s later (legacy delay, fixed this pass) |
| W1 | Container highlight ring (gold) | yes | full-container-label-interact-1920.jpg |  |
| W2 | Container label | yes | full-container-label-interact-1920.jpg | "Shield" plate over a ground weapon |
| W3 | Reward chest ring and seconds | yes | crop-reward-chest-ring.jpg | ring plus "12s" on a plate |
| W4 | Interact hint | yes | full-container-label-interact-1920.jpg | "F swap Wand for Shield" |
| W5 | Quest giver ! / ? / Turn in | yes | crop-quest-query-mark.jpg | "?" and name on dark plates after this pass; "!" seen earlier without a plate (fixed, not re-shot unobstructed); Turn in here not reached |
| W6 | Quest item markers | no |  | no fetch quest completed |
| W8 | Trader marker in the world | no |  | merchant was delivered (probe) but its marker was not framed; panel verified |
| W9 | Plague corpse puddle | no |  | mob kills left no corpse prop; needs a player kill by a Plague fighter |
| W13 | Route preview | no |  | out of scope |
| W15 | Edge threat glows | no |  |  |
| W17 | Sentenced hunt picker and ring | yes | crop-hunt-picker.jpg, crop-hunt-tracking.jpg | picker and Tracking state seen (new this pass); the violet world ring was not distinct under click pings |
| W18 | Sudden death line | no |  |  |
| H1 | Champion name and weapon (faction icon) | yes | full-hitzone-demo-flag-1920.jpg | bracket mark replaced by the faction pictogram |
| H2 | Wish row | yes | full-hitzone-demo-flag-1920.jpg |  |
| H3 | Attack/Passive values | no |  | blocked B18; multipliers shown |
| H5 | Build cells (Gained) | yes | crop-hunt-picker.jpg |  |

## Screens

| Screen | Seen | Evidence | Notes |
|---|---|---|---|
| Hub room / stations | yes | hub-shop-1920.jpg | all five stations open as panels on the plain page; Escape restores the button set (escape-report-hub.json) |
| Records (scrim) | yes | hub-records-scrim-fixed-1920.jpg | launch panel no longer dimmed |
| Guide champions (faction icons) | yes | guide-champions-faction-icons-1920.jpg |  |
| Guide counters | yes | guide-counters-1920.jpg |  |
| Resume dialog | yes | hub-resume-1920.jpg | re-verified after the dock change |
| Sign-in | yes | hub-signin-1920.jpg |  |
| Shop / Wardrobe / Titles | yes | hub-wardrobe-1920.jpg, hub-titles-1920.jpg |  |
| Chest choice panel | yes | chest-panel-keyboard-focus-1920.jpg, chest-picked-1920.jpg | legacy arrangement; C focus ring; pick |
| Traders | yes | traders-barter-1920.jpg | legacy wording, no coordinates, dark rows |
| Quest journal detail pane | yes | quest-journal-detail-1920.jpg | slate well, not near-black |
| Results card | yes | results-card-1920.jpg |  |
| Tab map 1280x800 | yes | tabmap-1280x800.jpg | weapon counters fit |
| Tab map 1920x1080 | yes | tabmap-1920x1080.jpg |  |
| Tab map 2560x1440 | yes | tabmap-2560x1440.jpg |  |
| Escape in match (help, settings, journal, build) | yes | escape-report-match.json | each closes and restores the button set |
| Hit zone (demo flag) | yes | full-hitzone-demo-flag-1920.jpg | `?hitzone.demo=1` only; weapon table not wired |

Not staged: natural creature or player leaving sight (the walk-away runs tracked drifted/off-screen targets; `vision.fadeDemo` withheld a player far off-screen), Plague corpse, bounty, elites.
