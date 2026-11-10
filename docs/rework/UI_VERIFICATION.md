# UI verification checklist (fourth UI pass, plus the UI lab gallery)

Rows are the audit rows of `LEGACY_INDICATORS.md` that are built or matching (55 rows); "seen" means a real match on the merged build, looked at by the author (Read tool) and judged right. **Seen: 22 of 55; not seen: 33** (reason in Notes). Evidence in `evidence/ui4/`; harness `client-unity/UnityProject/Tools/ui-scenarios.cjs`. Blocked-by-wire rows (B1-B19) are not listed.

| ID | Indicator | Seen in real match | Evidence | Notes | Seen in gallery | Gallery evidence (`evidence/uilab/<cell>__<ground>.jpg`) and judgement |
|---|---|---|---|---|---|---|
| P1 | Body disc / local ring | yes | tabmap and all frames (e.g. full-container-label-interact-1920.jpg) | sprite character by decision; local ring under the fighter seen | yes | P1_P6.own, P1.plain: right: local footprint ring reads on all three grounds (thin on snow, still visible). |
| P4 | Health bar tones | yes | crop-remote-cluster-damage-number.jpg | red bar at 25 percent on a remote Plague bot; green on full | yes | P4.green, P4.amber, P4.red: right: tones follow hp, bar readable on all grounds. |
| P5 | Barrier bubble | no |  | no barrier source reached in staged fights | yes | P5.remote, P5.full: FIXED: eight ticks above the head collided with the status row and vanished on snow; now the legacy bubble round the body, reads on all three. |
| P6 | Own Wish icon beside the name | no |  | shown only in ui3 evidence (indicators-own-wish-icon); not re-seen this pass | yes | P1_P6.own, P5_P6_P7.recharging: right: glyph on a dark plate, faction colour when ready, grey while recharging. |
| P7 | Bounty crown and number | no |  | no actor held a bounty in any run (needs kills) | yes | P7.25, P7.80, P7.150, P7.all: FIXED: digits sat half outside their plate (unreadable on sand and snow); now centred on it. Crown scale correct. |
| P9 | Mark text cues | no |  | no taxed/suppressed/exec-blocked state reached | yes | P9_G5.taxed, P9_G5.suppressed, P9_G6.execblocked: FIXED: sig 16 and 32 drew an unnamed glyph; now TAXED / SUPPRESSED / EXEC BLOCKED text on a plate (the percentage is not on the wire, B5). |
| P15 | Hidden fighter (Swarm) | no |  | Swarm not cast | yes | P15.remote, P15_S9.own: right: a hidden remote is not drawn; the own fighter is drawn faint. |
| P16 | Hit flash (Hit clip) | no |  | clip, not isolated in a frame | yes | P16.a040, P16.a120, P16.a200: right: impact ring and the Hit clip at three ages; no separate white flash (the clip carries it). |
| P17 | Hover ring and lock ring | yes | crop-lock-and-hover-ring.jpg, crop-lock-ring-2.jpg | hover ring (white ellipse) and red lock ring on creatures/dummies; wand locks, melee does not | yes | P17.lock, P17.hover, P17.lockmob: right: red lock ring reads everywhere; the white hover ring is the weakest on snow and sand (visible, not strong). |
| S1 | Status glyph: stunned | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only | yes | S1: right: yellow star glyph on a plate. |
| S2 | Status glyph: rooted | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only | yes | S2: marginal on snow: the white ground ring is thin there. |
| S3 | Status glyph: silenced | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only | yes | S3: right. |
| S4 | Status glyph: slowed | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only | yes | S4: right. |
| S5 | Status glyph: attack-slowed | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only | yes | S5: right. |
| S6 | Status glyph: anti-heal | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only | yes | S6: right. |
| S7 | Status glyph: damage over time | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only | yes | S7: right. |
| S8 | Status glyph: untargetable | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only | yes | S8: right: a white ring glyph; close to S11 (gold) at small size. |
| S9 | Status glyph: hidden | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only | yes | S9.remote, P15_S9.own: right: a hidden remote is not drawn; own fighter faint. |
| S10 | Status glyph: zoned | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only | yes | S10: right: blue ground ring; weak on snow. |
| S11 | Status glyph: last stand | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only | yes | S11: right: gold rim and beam. |
| S12 | Status glyph: haste | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only | yes | S12: right. |
| S13 | Status glyph: casting | no |  | none of the 13 effect bits occurred in staged play; unit/EditMode tested only | yes | S13: right. |
| G1 | Signature chilled | yes | crop-lock-and-hover-ring.jpg | snowflake glyph on chilled creatures | yes | G1: marginal: small snowflake detached above-left of the head, legible on all grounds; the same glyph as the Frost rune. |
| G2 | Signature burning | yes | crop-lock-and-hover-ring.jpg | orange glyph on burning imps | yes | G2: FIXED: was an orange diamond; now a flame in the legacy colour. |
| G3 | Signature diseased | yes | crop-remote-cluster-damage-number.jpg | icon beside the remote Plague bot | yes | G3: FIXED: was the Plague faction trefoil; now a droplet in the legacy green. |
| G4 | Signature execute | no |  |  | yes | G4: FIXED: sword glyph in dark purple was invisible on flagstone; now a lime skull (legacy c6ff00). |
| G5 | Taxed / suppressed named | no |  |  | yes | P9_G5.taxed, P9_G5.suppressed: FIXED with P9: named text cue. |
| G6 | Signature exec-blocked | no |  |  | yes | P9_G6.execblocked: FIXED with P9: skull glyph and EXEC BLOCKED text. |
| M1 | Role mark on the disc | yes | crop-lock-and-hover-ring.jpg | swarm dots on Ember Imps | yes | M1.swarm, M1.skirmisher, M1.caster, M1.brute, M1.grunt: FIXED: the role badge sat at a fixed height and short creatures had it half covered by the name plate; it now rides the body height. |
| M2 | Mob hp bar only when hurt | yes | crop-lock-and-hover-ring.jpg | calm creatures show no bar, hurt ones do | yes | M2_M3.calm, M2_M3.hurt, M2.hurtred: right: no bar while calm, bar with tone when hurt. |
| M3 | Mob names | yes | crop-lock-and-hover-ring.jpg | overprinting names of a tight camp are now suppressed (presenter pass), seen in build before the merge | yes | M2_M3.calm, M2_M3.hurt: right: dark plate keeps every name readable. |
| M4 | Elite rings and star | no |  | no elite met | yes | M4_M5.elite1 .. elite10: FIXED: elites had only a small emblem; added the gold double ring on the ground and the star over the name. |
| M5 | Elite emblem layers | no |  |  | yes | M4_M5.elite1 .. elite10: right: ten distinct emblem glyphs beside the role badge (small, but distinct). |
| M6 | Mob death shrink and fade | no |  |  | yes | M6.a000, M6.a120, M6.a240, M6.a400: right: death clip (no shrink); FIXED: the faction insignia plate no longer floats beside a dead creature. |
| M7 | Training dummy | yes | full-container-label-interact-1920.jpg |  | yes | M7: right. |
| F1 | Damage numbers | yes | crop-remote-cluster-damage-number.jpg | small red number beside a remote bot hp bar; hard to catch (700 ms) | yes | F1.others120, F1.others300, F1.big, F1.byme, F1.onme: FIXED: grey digits vanished on sand and snow; now on a dark plate. Colours by me / on me / others correct. |
| F2 | Damage-over-time number | no |  |  | yes | F2.a120, F2.a300: right: small passive number (same plate); colour by damage kind is not on the wire (B11). |
| F5 | Hurt vignette | yes | hurt-vignette-peak-1920.jpg | red edge tint on a heavy hit; hits under 2 percent of max hp do not flash (legacy rule) | yes | F5: right: red edge tint on all grounds. |
| F8 | Death X decal and death line | yes | crop-death-line.jpg | X at the fall, YOU DIED on a dark plate, results card 1.5 s later (legacy delay, fixed this pass) | yes | F8.a300, F8.a1300: right: X under the actor, opaque then fading; hidden by a corpse lying on it, as in legacy depth order. |
| W1 | Container highlight ring (gold) | yes | full-container-label-interact-1920.jpg |  | yes | W1: FIXED: the gold focus ring vanished on sand and snow; a dark hairline now sits under it. |
| W2 | Container label | yes | full-container-label-interact-1920.jpg | "Shield" plate over a ground weapon | yes | W2.weapon, W2.chest, W2.body, W2.unfocused: right: labels on plates; unfocused chest has none. |
| W3 | Reward chest ring and seconds | yes | crop-reward-chest-ring.jpg | ring plus "12s" on a plate | yes | W3.far, W3.near, W3.urgent: right: ring drains, seconds only when near, red when late. |
| W4 | Interact hint | yes | full-container-label-interact-1920.jpg | "F swap Wand for Shield" | no | not coverable: HUD hint, not a world mark |
| W5 | Quest giver ! / ? / Turn in | yes | crop-quest-query-mark.jpg | "?" and name on dark plates after this pass; "!" seen earlier without a plate (fixed, not re-shot unobstructed); Turn in here not reached | yes | W5.offer, W5.accepted, W5.turnin: right: ! / ? / Turn in here on plates, unobstructed. |
| W6 | Quest item markers | no |  | no fetch quest completed | yes | W6.crate, W6.token, W6.focused: right: gold marker above the item, label when focused. |
| W8 | Trader marker in the world | no |  | merchant was delivered (probe) but its marker was not framed; panel verified | yes | W8.stats, W8.barter: FIXED: the marker floated over empty ground; a figure and shadow now stand under it. |
| W9 | Plague corpse puddle | no |  | mob kills left no corpse prop; needs a player kill by a Plague fighter | yes | W9, W9.label: right: puddle reads on all three grounds. |
| W13 | Route preview | no |  | out of scope | no | not coverable: route preview: out of scope |
| W15 | Edge threat glows | no |  |  | yes | W15: FIXED in the view: the glow fell off squared (tiny); now the legacy linear gradient. NOT FED in a real match (stub: UpdateEdgeThreatsStub). |
| W17 | Sentenced hunt picker and ring | yes | crop-hunt-picker.jpg, crop-hunt-tracking.jpg | picker and Tracking state seen (new this pass); the violet world ring was not distinct under click pings | yes | W17.hunt: right: violet ring reads on all grounds. |
| W18 | Sudden death line | no |  |  | no | not coverable: the legacy "Coliseum - sudden death" line is not drawn in the client at all (HUD shows RAID mm:ss only) |
| H1 | Champion name and weapon (faction icon) | yes | full-hitzone-demo-flag-1920.jpg | bracket mark replaced by the faction pictogram | no | not coverable: HUD panel |
| H2 | Wish row | yes | full-hitzone-demo-flag-1920.jpg |  | no | not coverable: HUD panel |
| H3 | Attack/Passive values | no |  | blocked B18; multipliers shown | no | not coverable: blocked B18 |
| H5 | Build cells (Gained) | yes | crop-hunt-picker.jpg |  | no | not coverable: HUD panel |

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


## UI lab gallery (branch `rework/uilab`)

"Seen in gallery" means the row was drawn by the real presenters from synthetic view data in the serverless indicator gallery (`?uilab=1`, `Assets/Scripts/UiLab/`),
captured by `client-unity/UnityProject/Tools/ui-gallery.cjs` on three grounds (dark Sentenced flagstone, bright Holy temple floor, Frost snow) with time frozen mid-effect,
and looked at by the author (Read tool). It is NOT a real match: the "Seen in real match" column is unchanged. Evidence, index and the cell list: `evidence/uilab/`
(`index.json` names every crop, its quality and the legacy look it was judged against). Extra cells beyond the audit rows: X1 to X4, the natural leaving-sight and
arrival fades for a player and a creature (five ages each); the P1 / P6 / P5 own variants and the lock, hover and hunt rings need the local fighter and live on pages with one.

Found by the gallery and not fixable inside the client:
- W15 edge threat glows are built but never fed in a real match (`MatchHud.UpdateEdgeThreatsStub`); the vision radius it said was missing is now delivered (`WireVision.Radius`).
- W18: the client has no "Coliseum" timer or "sudden death" line; the arena clocks arrive (`ArenaView.SuddenDeathAt`) and nothing draws them.
- Vision fades: the character body ignored its alpha (the actor shader omitted `unity_SpriteColor`), so only the plates faded and the body popped; one line in `RegionActorLit.shader`.
