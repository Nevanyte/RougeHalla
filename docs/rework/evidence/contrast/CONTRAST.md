# Character contrast gate

Generated 2026-11-10T17:38:14.690Z. Gate: EDGE p10 over 16 contour sectors >= 3; markers (hp bar, faction footprint, faction insignia) >= 4.5. Definition and caveats: docs/rework/CONTRAST_GATE.md.

GPU: ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version). Frames: 4 normal + 3 ground averaged per page.

## Pass counts

| config | zone | cells | EDGE p10 >= 3 | EDGE min >= 3 | core p10 >= 3 | markers >= 4.5 | unmeasured |
|---|---|---:|---:|---:|---:|---:|---:|
| 1920x1080/high | fire | 242 | 203 | 154 | 205 | 207 | 0 |
| 1920x1080/high | sentenced | 90 | 84 | 80 | 84 | 81 | 0 |
| 1920x1080/high | plague | 212 | 191 | 174 | 191 | 173 | 0 |
| 1920x1080/high | frost | 166 | 153 | 134 | 153 | 153 | 0 |
| 1920x1080/high | holy | 166 | 148 | 127 | 148 | 134 | 0 |
| 1920x1080/high | coliseum | 55 | 54 | 52 | 54 | 55 | 0 |
| 1920x1080/ultra | fire | 242 | 200 | 151 | 202 | 206 | 0 |
| 1920x1080/ultra | sentenced | 90 | 85 | 78 | 85 | 81 | 0 |
| 1920x1080/ultra | plague | 212 | 191 | 175 | 191 | 170 | 0 |
| 1920x1080/ultra | frost | 166 | 151 | 137 | 151 | 152 | 0 |
| 1920x1080/ultra | holy | 166 | 150 | 128 | 150 | 137 | 0 |
| 1920x1080/ultra | coliseum | 55 | 54 | 51 | 54 | 55 | 0 |
| 2560x1440/high | fire | 242 | 203 | 145 | 205 | 203 | 0 |
| 2560x1440/high | sentenced | 90 | 82 | 78 | 83 | 81 | 0 |
| 2560x1440/high | plague | 212 | 194 | 173 | 194 | 168 | 0 |
| 2560x1440/high | frost | 166 | 152 | 134 | 152 | 152 | 0 |
| 2560x1440/high | holy | 166 | 152 | 127 | 152 | 138 | 0 |
| 2560x1440/high | coliseum | 55 | 54 | 51 | 54 | 55 | 0 |
| 2560x1440/ultra | fire | 242 | 205 | 144 | 207 | 204 | 0 |
| 2560x1440/ultra | sentenced | 90 | 83 | 79 | 83 | 81 | 0 |
| 2560x1440/ultra | plague | 212 | 189 | 175 | 189 | 172 | 0 |
| 2560x1440/ultra | frost | 166 | 153 | 132 | 153 | 153 | 0 |
| 2560x1440/ultra | holy | 166 | 154 | 125 | 154 | 138 | 0 |
| 2560x1440/ultra | coliseum | 55 | 54 | 51 | 54 | 55 | 0 |

## EDGE by zone

Cell = worst case over every pose, facing, size and quality of: EDGE p10 / EDGE min / BODY, then [core p10] (the edge of the sprite and its dark outline alone, ignoring the light rim). A mark means EDGE p10 below the gate in at least one run. Plain-ground cells only; props are below.

### fire

| appearance | Basalt | Ember | Lava |
|---|---:|---:|---:|
| knight | 11.99 / 10.41 / 1.24 [11.99] | 3.81 / 2.23 / 1.00 [3.81] | 3.96 / 2.57 / 5.73 [3.95] |
| goblin | 11.32 / 4.06 / 3.03 [11.32] | 1.77 / 1.48 / 1.26 [1.72] ✗ | 4.12 / 2.15 / 3.94 [4.12] |
| skeleton | 8.56 / 6.11 / 2.00 [8.56] | 1.53 / 1.04 / 1.42 [1.53] ✗ | 3.58 / 1.17 / 4.74 [3.58] |
| hero | 11.84 / 9.28 / 2.72 [11.84] | 2.37 / 1.86 / 1.66 [2.37] ✗ | 3.55 / 1.70 / 4.36 [3.55] |
| hero@sentenced | 12.19 / 9.53 / 2.66 [12.19] | 2.74 / 2.04 / 1.66 [2.74] ✗ | 4.05 / 2.18 / 4.68 [4.05] |
| hero-female | 11.80 / 10.60 / 4.78 [11.80] | 2.54 / 1.12 / 3.29 [2.54] ✗ | 3.66 / 1.87 / 4.43 [3.66] |
| mob-goblin-elite | 11.90 / 10.81 / 3.42 [11.91] | 2.50 / 1.88 / 2.47 [2.50] ✗ | 3.70 / 2.83 / 4.59 [3.76] |
| mob-antlion | 10.13 / 7.83 / 1.66 [10.13] | 2.20 / 1.69 / 1.24 [2.20] ✗ | 4.55 / 3.03 / 5.40 [4.55] |
| mob-skeleton-archer | 11.34 / 9.88 / 7.30 [11.47] | 2.27 / 1.08 / 4.30 [2.27] ✗ | 4.21 / 4.04 / 4.74 [4.21] |
| mob-skeleton-mage | 10.78 / 9.39 / 4.37 [10.78] | 2.19 / 1.89 / 2.75 [2.19] ✗ | 4.25 / 4.03 / 5.43 [4.25] |
| mob-zombie | 11.70 / 9.52 / 1.44 [11.70] | 2.62 / 1.41 / 1.01 [2.62] ✗ | 3.37 / 1.94 / 4.71 [3.37] |
| mage | 12.05 / 9.51 / 3.04 [12.05] | 2.35 / 1.85 / 2.05 [2.35] ✗ | 4.17 / 3.35 / 5.17 [4.17] |
| mage-female | 12.23 / 11.08 / 4.05 [12.23] | 2.54 / 1.62 / 2.81 [2.54] ✗ | 4.01 / 3.34 / 5.00 [4.01] |

### sentenced

| appearance | Flagstone |
|---|---:|
| knight | 10.55 / 9.63 / 1.50 [10.55] |
| goblin | 9.36 / 3.06 / 4.01 [9.36] |
| skeleton | 9.60 / 5.90 / 2.70 [9.60] |
| hero | 12.18 / 11.01 / 3.17 [12.18] |
| hero@sentenced | 12.05 / 9.90 / 3.47 [12.05] |
| hero-female | 9.77 / 9.58 / 5.56 [9.77] |
| mob-goblin-elite | 10.15 / 9.14 / 4.19 [10.15] |
| mob-antlion | 10.03 / 9.62 / 2.14 [10.03] |
| mob-skeleton-archer | 9.42 / 8.03 / 7.20 [9.42] |
| mob-skeleton-mage | 11.27 / 10.25 / 5.21 [11.27] |
| mob-zombie | 9.21 / 8.51 / 1.64 [9.21] |
| mage | 9.96 / 8.63 / 4.12 [9.96] |
| mage-female | 10.83 / 10.27 / 5.52 [10.83] |

### plague

| appearance | Mud | ShallowWater | Bog |
|---|---:|---:|---:|
| knight | 10.75 / 8.93 / 1.01 [10.75] | 3.46 / 3.35 / 1.03 [3.46] | 2.33 / 1.75 / 1.30 [2.33] ✗ |
| goblin | 10.29 / 3.58 / 2.38 [10.29] | 5.18 / 5.00 / 1.42 [5.18] | 1.92 / 1.83 / 1.01 [1.92] ✗ |
| skeleton | 6.82 / 3.67 / 1.65 [6.82] | 4.33 / 2.25 / 1.19 [4.33] | 1.69 / 1.36 / 1.15 [1.69] ✗ |
| hero | 10.29 / 8.34 / 1.85 [10.29] | 3.97 / 3.68 / 1.21 [3.97] | 3.87 / 2.46 / 1.06 [3.87] |
| hero@sentenced | 10.45 / 8.34 / 1.89 [10.45] | 3.55 / 3.21 / 1.19 [3.55] | 3.96 / 2.94 / 1.23 [3.96] |
| hero-female | 6.53 / 6.29 / 3.52 [6.53] | 1.07 / 1.03 / 1.26 [1.07] ✗ | 4.26 / 3.81 / 1.59 [4.26] |
| mob-goblin-elite | 7.24 / 5.17 / 2.33 [7.24] | 6.04 / 4.91 / 1.77 [6.04] | 2.19 / 1.28 / 1.11 [2.28] ✗ |
| mob-antlion | 8.01 / 4.80 / 1.35 [8.01] | 2.46 / 1.73 / 1.07 [2.46] ✗ | 4.57 / 3.36 / 1.02 [4.57] |
| mob-skeleton-archer | 10.80 / 9.94 / 5.59 [10.80] | 4.48 / 4.05 / 2.93 [4.48] | 4.11 / 3.17 / 2.08 [4.11] |
| mob-skeleton-mage | 11.27 / 10.26 / 3.66 [11.27] | 4.16 / 4.03 / 1.45 [4.16] | 2.78 / 1.98 / 1.02 [2.78] ✗ |
| mob-zombie | 10.50 / 7.60 / 1.02 [10.50] | 2.25 / 1.10 / 1.04 [2.25] ✗ | 2.22 / 1.51 / 1.04 [2.22] ✗ |
| mage | 10.17 / 9.99 / 2.34 [10.17] | 2.48 / 1.21 / 1.23 [2.48] ✗ | 4.02 / 2.15 / 1.00 [4.02] |
| mage-female | 10.66 / 10.12 / 3.39 [10.66] | 1.77 / 1.02 / 1.08 [1.77] ✗ | 2.86 / 2.11 / 1.38 [2.86] ✗ |

### frost

| appearance | Snow | Ice |
|---|---:|---:|
| knight | 8.49 / 3.70 / 10.65 [8.49] | 6.47 / 3.51 / 7.64 [6.47] |
| goblin | 5.23 / 3.53 / 8.43 [5.23] | 6.10 / 2.74 / 4.73 [6.10] |
| skeleton | 5.68 / 4.28 / 8.62 [5.68] | 4.92 / 1.92 / 5.29 [4.92] |
| hero | 7.40 / 3.01 / 9.98 [7.40] | 7.43 / 3.02 / 7.94 [7.43] |
| hero@sentenced | 6.28 / 3.13 / 8.53 [6.28] | 6.20 / 2.87 / 6.37 [6.20] |
| hero-female | 7.54 / 3.67 / 9.06 [7.54] | 4.88 / 3.06 / 5.55 [4.88] |
| mob-goblin-elite | 9.87 / 5.12 / 10.73 [9.83] | 6.56 / 4.34 / 7.25 [6.56] |
| mob-antlion | 7.03 / 5.30 / 8.17 [7.03] | 6.92 / 6.08 / 7.56 [6.92] |
| mob-skeleton-archer | 8.95 / 6.13 / 8.37 [8.95] | 6.60 / 6.43 / 5.69 [6.60] |
| mob-skeleton-mage | 9.02 / 4.36 / 9.45 [9.02] | 8.27 / 6.34 / 8.54 [8.27] |
| mob-zombie | 6.19 / 4.08 / 8.68 [6.19] | 5.49 / 3.75 / 6.71 [5.49] |
| mage | 7.88 / 7.66 / 7.52 [7.88] | 6.19 / 6.00 / 6.06 [6.19] |
| mage-female | 7.84 / 4.47 / 7.94 [7.84] | 6.16 / 4.95 / 5.92 [6.16] |

### holy

| appearance | Sand | HolyLight |
|---|---:|---:|
| knight | 4.35 / 3.04 / 5.32 [4.35] | 7.06 / 3.17 / 8.23 [7.06] |
| goblin | 3.96 / 2.20 / 3.52 [3.96] | 7.49 / 2.89 / 5.62 [7.49] |
| skeleton | 3.93 / 1.86 / 3.66 [3.93] | 4.60 / 2.32 / 6.24 [4.60] |
| hero | 4.40 / 2.83 / 4.27 [4.40] | 6.81 / 2.08 / 7.15 [6.81] |
| hero@sentenced | 4.18 / 2.84 / 4.04 [4.18] | 5.04 / 2.18 / 6.62 [5.04] |
| hero-female | 4.56 / 3.07 / 4.32 [4.56] | 6.15 / 2.77 / 6.82 [6.15] |
| mob-goblin-elite | 4.55 / 4.24 / 4.16 [4.49] | 6.12 / 3.58 / 7.36 [6.04] |
| mob-antlion | 1.34 / 1.03 / 4.33 [1.34] ✗ | 8.79 / 7.61 / 8.18 [8.79] |
| mob-skeleton-archer | 4.57 / 3.82 / 3.91 [4.57] | 8.19 / 7.97 / 7.30 [8.19] |
| mob-skeleton-mage | 4.33 / 1.16 / 4.69 [4.33] | 9.07 / 5.91 / 8.58 [9.07] |
| mob-zombie | 4.24 / 3.61 / 4.93 [4.24] | 5.68 / 2.56 / 8.10 [5.68] |
| mage | 4.19 / 3.20 / 4.32 [4.19] | 8.85 / 4.79 / 7.19 [8.85] |
| mage-female | 4.18 / 3.63 / 3.93 [4.18] | 7.56 / 4.72 / 7.14 [7.56] |

### coliseum

| appearance | Limestone |
|---|---:|
| knight | 6.24 / 3.37 / 9.41 [6.24] |
| goblin | 5.42 / 3.05 / 7.04 [5.42] |
| skeleton | 6.50 / 2.23 / 7.51 [6.50] |
| hero | 3.62 / 1.44 / 9.00 [3.62] |
| hero@sentenced | 4.67 / 2.86 / 8.14 [4.67] |
| hero-female | 5.48 / 3.43 / 7.72 [5.48] |
| mob-goblin-elite | 7.30 / 4.92 / 8.25 [7.30] |
| mob-antlion | 7.87 / 6.37 / 9.40 [7.87] |
| mob-skeleton-archer | 8.14 / 5.59 / 7.53 [8.14] |
| mob-skeleton-mage | 6.95 / 4.85 / 8.76 [6.95] |
| mob-zombie | 7.65 / 4.00 / 9.07 [7.65] |
| mage | 8.25 / 5.30 / 7.77 [8.25] |
| mage-female | 7.79 / 4.45 / 8.57 [7.79] |

## Props, boundaries and seams (in front of / beside the zone's most common props; straddling a surface change `edge:A|B` or a zone seam `seam:a|b`)

| zone | prop | mode | cells | EDGE p10 pass | worst EDGE p10 | worst appearance | markers pass |
|---|---|---|---:|---:|---:|---|---:|
| fire | fire.crystal | front | 12 | 12 | 6.12 | hero-female | 12 |
| fire | fire.stump | beside | 8 | 8 | 9.06 | mob-antlion | 8 |
| fire | fire.rocks | front | 20 | 20 | 10.85 | hero | 20 |
| fire | fire.spire | beside | 24 | 24 | 10.28 | mob-skeleton-mage | 24 |
| fire | fire.rocks | beside | 16 | 16 | 10.06 | knight | 16 |
| fire | fire.spire | front | 12 | 12 | 11.29 | mob-skeleton-archer | 12 |
| fire | fire.crystal | beside | 4 | 4 | 12.59 | mage | 4 |
| fire | fire.stump | front | 8 | 8 | 11.23 | mob-antlion | 8 |
| fire | edge:Ember | Basalt | 48 | 26 | 1.81 | mob-goblin-elite | 31 |
| fire | edge:Lava | Basalt | 48 | 17 | 1.13 | mob-skeleton-archer | 9 |
| fire | edge:Basalt | Lava | 48 | 22 | 1.17 | hero-female | 26 |
| fire | edge:Ember | Basalt | 48 | 38 | 1.86 | mob-zombie | 40 |
| fire | seam:fire | sentenced | 48 | 48 | 3.78 | hero@sentenced | 27 |
| sentenced | sent.deadtree | front | 16 | 16 | 5.28 | mob-goblin-elite | 16 |
| sentenced | sent.lantern | beside | 12 | 12 | 5.21 | hero-female | 8 |
| sentenced | sent.lantern | front | 20 | 4 | 1.34 | mage | 0 |
| sentenced | sent.deadgrass | beside | 28 | 20 | 1.17 | mage | 20 |
| sentenced | sent.deadgrass | front | 16 | 16 | 7.26 | hero@sentenced | 16 |
| sentenced | sent.deadtree | beside | 12 | 11 | 2.47 | skeleton | 12 |
| sentenced | seam:sentenced | plague | 48 | 47 | 2.35 | mob-skeleton-mage | 44 |
| plague | plague.tree | front | 24 | 20 | 1.06 | mob-skeleton-archer | 16 |
| plague | plague.fern | beside | 36 | 21 | 1.04 | hero | 22 |
| plague | plague.column | front | 4 | 4 | 7.62 | skeleton | 0 |
| plague | plague.bush | front | 24 | 16 | 1.00 | mob-zombie | 14 |
| plague | plague.tree | beside | 4 | 4 | 7.54 | mob-antlion | 4 |
| plague | plague.bush | beside | 8 | 4 | 1.32 | skeleton | 8 |
| plague | plague.column | beside | 4 | 4 | 6.75 | mage-female | 4 |
| plague | edge:Grass | Bog | 48 | 42 | 1.07 | mob-goblin-elite | 40 |
| plague | edge:Mud | Grass | 48 | 28 | 1.01 | hero@sentenced | 35 |
| plague | seam:plague | frost | 48 | 41 | 1.07 | goblin | 28 |
| frost | frost.drift | front | 16 | 12 | 1.90 | mage | 16 |
| frost | frost.pine | beside | 12 | 8 | 1.34 | goblin | 4 |
| frost | frost.pine | front | 20 | 4 | 1.50 | hero@sentenced | 16 |
| frost | frost.rock2 | beside | 12 | 11 | 2.92 | mob-skeleton-archer | 12 |
| frost | frost.drift | beside | 16 | 16 | 7.00 | knight | 16 |
| frost | frost.drift2 | front | 16 | 12 | 2.10 | mob-zombie | 12 |
| frost | frost.drift2 | beside | 12 | 12 | 4.31 | skeleton | 12 |
| frost | edge:Ice | Snow | 48 | 40 | 2.03 | hero-female | 30 |
| frost | edge:Snow | Ice | 48 | 44 | 1.53 | mob-antlion | 46 |
| frost | seam:frost | holy | 48 | 34 | 1.08 | mob-goblin-elite | 30 |
| holy | holy.grass | front | 16 | 14 | 2.57 | mob-zombie | 13 |
| holy | holy.grass | beside | 28 | 13 | 1.04 | hero | 12 |
| holy | holy.palm | front | 16 | 12 | 1.12 | skeleton | 3 |
| holy | holy.flowers | front | 16 | 16 | 3.22 | mage | 6 |
| holy | holy.palm | beside | 12 | 4 | 1.02 | mob-zombie | 0 |
| holy | holy.flowers | beside | 12 | 11 | 2.84 | mob-skeleton-mage | 5 |
| holy | holy.pillar | front | 4 | 4 | 5.56 | goblin | 4 |
| holy | edge:HolyLight | Sand | 48 | 39 | 1.47 | mob-zombie | 37 |
| holy | edge:Sand | HolyLight | 48 | 32 | 1.16 | skeleton | 20 |
| holy | seam:holy | coliseum | 48 | 44 | 1.04 | mob-zombie | 44 |
| coliseum | col.banner | front | 4 | 4 | 3.81 | knight | 4 |
| coliseum | col.rack | beside | 4 | 4 | 5.44 | goblin | 4 |
| coliseum | col.rack | front | 4 | 0 | 2.03 | skeleton | 4 |

## Markers (worst over every pose, facing, size and quality)

| zone | hp bar min | footprint min | insignia min | cells with all markers >= 4.5 |
|---|---:|---:|---:|---:|
| fire | 1.16 | 1.46 | 1.07 | 820 / 968 |
| sentenced | 1.01 | 1.15 | 1.55 | 324 / 360 |
| plague | 1.15 | 1.11 | 2.67 | 683 / 848 |
| frost | 1.97 | 1.30 | 2.51 | 610 / 664 |
| holy | 1.15 | 1.05 | 1.01 | 547 / 664 |
| coliseum | 8.52 | 6.13 | 4.89 | 220 / 220 |

## BODY distribution (median interior luminance vs the whole ring; reported, not gated)

| zone | n | min | p25 | median | p75 | max |
|---|---:|---:|---:|---:|---:|---:|
| fire | 624 | 1.00 | 2.87 | 4.60 | 5.83 | 12.58 |
| sentenced | 208 | 1.50 | 3.50 | 5.52 | 7.13 | 14.35 |
| plague | 600 | 1.00 | 1.50 | 2.17 | 3.36 | 11.64 |
| frost | 416 | 4.73 | 8.61 | 10.21 | 11.89 | 14.22 |
| holy | 416 | 3.52 | 5.84 | 7.32 | 8.98 | 11.43 |
| coliseum | 208 | 7.04 | 8.98 | 10.12 | 11.07 | 13.27 |

## Plan notes

- plague/Grass: no clean ground, nothing stamped
- plague/ShallowWater: only 46 of 52 cells fit on clean ground
- plague/ShallowWater: patch is mixed, cells sit on at least 50% pure ground
- coliseum: props pages hold 3 of the 26 wanted cells

## Browser console errors

none
