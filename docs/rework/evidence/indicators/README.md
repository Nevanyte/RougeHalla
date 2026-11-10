# Indicator evidence (final UI pass)

Captured with `client-unity/UnityProject/Tools/indicator-shots.cjs` against a fresh `rh-server` (protocol 16, 7 bots) and the Web build of
branch `rework/indicators`, headed Chromium. Raw PNGs stay outside the repo. `?hitzone.demo=1` (hit-zone shapes: TEST DATA read from
`crates/rh-sim/src/content.rs:256-302`) and `?indicators.demo=1` (the local actor is driven with test values: bounty 90, cycling status
bits, the lock ring) were on for these captures; the off-hand badge, mob names, hp tones, quest and trader marks, gold interact ring are real
delivered data. Both flags are off by default.

| File | What it shows |
|---|---|
| `cluster-1920x1080-dark-to-bright.jpg` | four crops of the local cluster, darkest to brightest ground (Sentenced dark, sand, Holy), 1920x1080 |
| `cluster-2560x1440-dark-to-bright.jpg` | the same at 2560x1440 (Sentenced character, lava, sand) |
| `zoom-cluster-dark-1920.jpg`, `zoom-cluster-bright-1920.jpg` | 4x detail of the cluster on dark and bright ground |
| `full-1920x1080-hitzone.jpg` | a whole frame: swung hit zones, cluster, mob names, HUD |

Measured marker contrast (WCAG ratio of every theme token used for a glyph or text against its opaque `OutlineDark` plate; plates are
opaque, so the ground behind does not change it): lowest **7.67:1** (Danger red) over all 42 captured frames, split bright ground
(L>.25, 25 frames) 7.67, mid ground 7.67, dark ground (L<=.08, 14 frames) 7.67. The plate edge against the ground is lower on
dark ground (about 1.2:1 on the darkest): glyphs read by their own fill on their plate, and the plate has no light rim.

Weak points, stated plainly: the lock ring, rooted and zoned ground rings and hit-zone fill are translucent ground marks without a
contrast guarantee (the hit zone has a dark under-edge); the overhead cluster of remote players was only captured on real bots in the
non-demo path (no statuses, bounty or off-hand weapon appear for them because the wire does not carry the off-hand, and bounty and
statuses did not occur naturally in the short runs); damage numbers, heal numbers and the quest `?` mark were not captured in a clean
frame; hit zones were not captured on every zone (Frost bright was; Fire dark was; Plague and Holy partly).
