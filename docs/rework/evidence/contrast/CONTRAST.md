# Character contrast gate

Generated 2026-11-10T22:11:57.850Z. Gate: EDGE p10 over 16 contour sectors >= 3; markers (hp bar, faction footprint, faction insignia) >= 4.5. Definition and caveats: docs/rework/CONTRAST_GATE.md.

GPU: ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version). Frames: 4 normal + 3 ground averaged per page.

## Pass counts

| config | zone | cells | EDGE p10 >= 3 | EDGE min >= 3 | core p10 >= 3 | markers >= 4.5 | unmeasured |
|---|---|---:|---:|---:|---:|---:|---:|
| 1920x1080/high | fire | 242 | 1 | 0 | 1 | 0 | 0 |
| 1920x1080/high | sentenced | 90 | 0 | 0 | 0 | 0 | 0 |
| 1920x1080/high | plague | 212 | 2 | 0 | 2 | 0 | 0 |
| 1920x1080/high | frost | 166 | 41 | 3 | 41 | 0 | 0 |
| 1920x1080/high | holy | 166 | 9 | 1 | 9 | 1 | 0 |
| 1920x1080/high | coliseum | 55 | 9 | 0 | 9 | 0 | 0 |

## EDGE by zone

Cell = worst case over every pose, facing, size and quality of: EDGE p10 / EDGE min / BODY, then [core p10] (the edge of the sprite and its dark outline alone, ignoring the light rim). A mark means EDGE p10 below the gate in at least one run. Plain-ground cells only; props are below.

### fire

| appearance | Basalt | Ember | Lava |
|---|---:|---:|---:|
| knight | 1.01 / 1.00 / 1.02 [1.01] ✗ | 1.03 / 1.01 / 1.34 [1.03] ✗ | 2.02 / 1.10 / 4.64 [2.02] ✗ |
| goblin | 1.05 / 1.00 / 1.24 [1.05] ✗ | 1.03 / 1.00 / 1.04 [1.03] ✗ | 1.49 / 1.15 / 3.52 [1.49] ✗ |
| skeleton | 1.03 / 1.03 / 1.03 [1.03] ✗ | 1.04 / 1.00 / 1.14 [1.04] ✗ | 1.37 / 1.13 / 2.70 [1.37] ✗ |
| hero | 1.04 / 1.02 / 1.00 [1.04] ✗ | 1.06 / 1.01 / 1.13 [1.06] ✗ | 1.55 / 1.17 / 2.93 [1.55] ✗ |
| hero@sentenced | 1.02 / 1.01 / 1.08 [1.02] ✗ | 1.10 / 1.00 / 1.10 [1.10] ✗ | 1.50 / 1.14 / 2.91 [1.50] ✗ |
| hero-female | 1.02 / 1.01 / 1.03 [1.02] ✗ | 1.04 / 1.01 / 1.10 [1.04] ✗ | 1.70 / 1.36 / 2.54 [1.70] ✗ |
| mob-goblin-elite | 1.06 / 1.00 / 1.02 [1.06] ✗ | 1.05 / 1.01 / 1.02 [1.05] ✗ | 1.08 / 1.04 / 3.28 [1.08] ✗ |
| mob-antlion | 1.00 / 1.00 / 1.01 [1.00] ✗ | 1.10 / 1.00 / 1.32 [1.10] ✗ | 1.63 / 1.03 / 4.21 [1.63] ✗ |
| mob-skeleton-archer | 1.03 / 1.01 / 1.01 [1.03] ✗ | 1.06 / 1.01 / 1.17 [1.06] ✗ | 1.23 / 1.02 / 3.07 [1.23] ✗ |
| mob-skeleton-mage | 1.04 / 1.00 / 1.00 [1.04] ✗ | 1.06 / 1.03 / 1.23 [1.06] ✗ | 1.32 / 1.07 / 2.92 [1.32] ✗ |
| mob-zombie | 1.03 / 1.01 / 1.01 [1.03] ✗ | 1.09 / 1.01 / 1.39 [1.09] ✗ | 1.41 / 1.34 / 3.52 [1.41] ✗ |
| mage | 1.03 / 1.01 / 1.50 [1.03] ✗ | 1.03 / 1.00 / 1.12 [1.03] ✗ | 1.37 / 1.00 / 2.90 [1.37] ✗ |
| mage-female | 1.02 / 1.00 / 1.43 [1.02] ✗ | 1.06 / 1.02 / 1.07 [1.06] ✗ | 1.56 / 1.02 / 2.37 [1.56] ✗ |

### sentenced

| appearance | Flagstone |
|---|---:|
| knight | 1.01 / 1.00 / 1.17 [1.01] ✗ |
| goblin | 1.05 / 1.02 / 1.55 [1.05] ✗ |
| skeleton | 1.01 / 1.00 / 1.21 [1.01] ✗ |
| hero | 1.01 / 1.00 / 1.26 [1.01] ✗ |
| hero@sentenced | 1.04 / 1.00 / 1.11 [1.04] ✗ |
| hero-female | 1.02 / 1.00 / 1.30 [1.02] ✗ |
| mob-goblin-elite | 1.02 / 1.01 / 1.19 [1.02] ✗ |
| mob-antlion | 1.01 / 1.00 / 1.20 [1.01] ✗ |
| mob-skeleton-archer | 1.04 / 1.00 / 1.17 [1.05] ✗ |
| mob-skeleton-mage | 1.06 / 1.00 / 1.22 [1.06] ✗ |
| mob-zombie | 1.01 / 1.01 / 1.10 [1.01] ✗ |
| mage | 1.03 / 1.01 / 2.10 [1.03] ✗ |
| mage-female | 1.05 / 1.00 / 1.79 [1.05] ✗ |

### plague

| appearance | Mud | ShallowWater | Bog |
|---|---:|---:|---:|
| knight | 1.02 / 1.00 / 1.10 [1.02] ✗ | 1.08 / 1.02 / 1.57 [1.07] ✗ | 1.26 / 1.15 / 1.87 [1.26] ✗ |
| goblin | 1.05 / 1.03 / 1.04 [1.05] ✗ | 1.03 / 1.01 / 1.10 [1.03] ✗ | 1.05 / 1.00 / 1.24 [1.05] ✗ |
| skeleton | 1.03 / 1.01 / 1.04 [1.03] ✗ | 1.08 / 1.02 / 1.14 [1.08] ✗ | 1.05 / 1.02 / 1.22 [1.05] ✗ |
| hero | 1.02 / 1.00 / 1.06 [1.02] ✗ | 1.11 / 1.01 / 1.00 [1.11] ✗ | 1.22 / 1.08 / 1.25 [1.22] ✗ |
| hero@sentenced | 1.05 / 1.00 / 1.07 [1.05] ✗ | 1.13 / 1.00 / 1.09 [1.13] ✗ | 1.12 / 1.06 / 1.24 [1.12] ✗ |
| hero-female | 1.03 / 1.00 / 1.03 [1.03] ✗ | 1.16 / 1.00 / 1.02 [1.16] ✗ | 1.07 / 1.04 / 1.29 [1.07] ✗ |
| mob-goblin-elite | 1.02 / 1.00 / 1.03 [1.02] ✗ | 1.07 / 1.04 / 1.43 [1.07] ✗ | 1.08 / 1.01 / 1.71 [1.08] ✗ |
| mob-antlion | 1.03 / 1.01 / 1.16 [1.03] ✗ | 1.16 / 1.07 / 1.69 [1.16] ✗ | 1.14 / 1.04 / 1.79 [1.14] ✗ |
| mob-skeleton-archer | 1.06 / 1.00 / 1.24 [1.06] ✗ | 1.05 / 1.01 / 1.08 [1.07] ✗ | 1.07 / 1.00 / 1.34 [1.07] ✗ |
| mob-skeleton-mage | 1.06 / 1.04 / 1.17 [1.06] ✗ | 1.06 / 1.04 / 1.15 [1.06] ✗ | 1.06 / 1.03 / 1.29 [1.06] ✗ |
| mob-zombie | 1.02 / 1.00 / 1.22 [1.02] ✗ | 1.08 / 1.02 / 1.67 [1.08] ✗ | 1.18 / 1.05 / 1.90 [1.18] ✗ |
| mage | 1.02 / 1.00 / 1.04 [1.02] ✗ | 1.15 / 1.09 / 1.18 [1.15] ✗ | 1.08 / 1.02 / 1.30 [1.08] ✗ |
| mage-female | 1.01 / 1.00 / 1.11 [1.01] ✗ | 1.07 / 1.00 / 1.30 [1.07] ✗ | 1.11 / 1.02 / 1.22 [1.11] ✗ |

### frost

| appearance | Snow | Ice |
|---|---:|---:|
| knight | 3.13 / 1.93 / 9.01 [3.13] | 2.60 / 1.82 / 6.93 [2.60] ✗ |
| goblin | 1.88 / 1.39 / 6.45 [1.88] ✗ | 1.38 / 1.12 / 4.00 [1.38] ✗ |
| skeleton | 2.97 / 1.61 / 6.50 [2.97] ✗ | 2.46 / 1.45 / 3.74 [2.46] ✗ |
| hero | 2.55 / 1.11 / 5.05 [2.55] ✗ | 2.22 / 1.62 / 4.56 [2.22] ✗ |
| hero@sentenced | 2.29 / 1.52 / 6.04 [2.29] ✗ | 2.24 / 1.45 / 4.17 [2.24] ✗ |
| hero-female | 2.49 / 1.69 / 5.71 [2.49] ✗ | 2.08 / 1.25 / 3.43 [2.08] ✗ |
| mob-goblin-elite | 1.48 / 1.09 / 8.81 [1.48] ✗ | 1.38 / 1.16 / 5.86 [1.38] ✗ |
| mob-antlion | 2.10 / 1.17 / 9.10 [2.10] ✗ | 1.64 / 1.20 / 7.29 [1.64] ✗ |
| mob-skeleton-archer | 1.64 / 1.41 / 6.08 [1.65] ✗ | 1.22 / 1.13 / 4.65 [1.21] ✗ |
| mob-skeleton-mage | 1.76 / 1.06 / 5.47 [1.76] ✗ | 1.85 / 1.50 / 4.87 [1.85] ✗ |
| mob-zombie | 2.40 / 1.11 / 8.19 [2.40] ✗ | 2.29 / 1.21 / 7.63 [2.29] ✗ |
| mage | 2.16 / 1.08 / 5.78 [2.16] ✗ | 1.86 / 1.18 / 3.80 [1.86] ✗ |
| mage-female | 1.73 / 1.08 / 6.42 [1.73] ✗ | 1.57 / 1.02 / 3.65 [1.57] ✗ |

### holy

| appearance | Sand | HolyLight |
|---|---:|---:|
| knight | 1.76 / 1.22 / 5.10 [1.76] ✗ | 2.37 / 1.56 / 7.35 [2.37] ✗ |
| goblin | 1.24 / 1.02 / 3.06 [1.24] ✗ | 1.65 / 1.21 / 4.90 [1.65] ✗ |
| skeleton | 1.69 / 1.03 / 2.75 [1.69] ✗ | 2.17 / 1.44 / 4.27 [2.17] ✗ |
| hero | 1.22 / 1.04 / 2.41 [1.22] ✗ | 2.07 / 1.66 / 4.03 [2.07] ✗ |
| hero@sentenced | 1.37 / 1.06 / 2.74 [1.37] ✗ | 2.02 / 1.86 / 4.27 [2.02] ✗ |
| hero-female | 1.48 / 1.18 / 2.56 [1.48] ✗ | 2.15 / 1.83 / 4.31 [2.15] ✗ |
| mob-goblin-elite | 1.07 / 1.00 / 3.69 [1.07] ✗ | 1.45 / 1.06 / 5.86 [1.45] ✗ |
| mob-antlion | 1.15 / 1.02 / 4.31 [1.15] ✗ | 2.03 / 1.33 / 7.45 [2.03] ✗ |
| mob-skeleton-archer | 1.14 / 1.03 / 2.56 [1.14] ✗ | 1.56 / 1.28 / 4.57 [1.56] ✗ |
| mob-skeleton-mage | 1.10 / 1.01 / 2.11 [1.10] ✗ | 1.70 / 1.39 / 4.03 [1.70] ✗ |
| mob-zombie | 1.33 / 1.05 / 4.13 [1.33] ✗ | 1.72 / 1.02 / 6.90 [1.72] ✗ |
| mage | 1.59 / 1.06 / 2.90 [1.59] ✗ | 1.96 / 1.24 / 4.25 [1.96] ✗ |
| mage-female | 1.34 / 1.08 / 2.64 [1.34] ✗ | 1.72 / 1.13 / 4.13 [1.72] ✗ |

### coliseum

| appearance | Limestone |
|---|---:|
| knight | 2.83 / 1.63 / 9.26 [2.83] ✗ |
| goblin | 1.41 / 1.15 / 5.67 [1.41] ✗ |
| skeleton | 2.25 / 1.32 / 4.40 [2.25] ✗ |
| hero | 1.45 / 1.02 / 4.45 [1.45] ✗ |
| hero@sentenced | 1.79 / 1.14 / 5.23 [1.79] ✗ |
| hero-female | 1.91 / 1.52 / 4.63 [1.91] ✗ |
| mob-goblin-elite | 1.27 / 1.07 / 5.44 [1.27] ✗ |
| mob-antlion | 1.45 / 1.01 / 7.35 [1.45] ✗ |
| mob-skeleton-archer | 1.35 / 1.10 / 5.14 [1.35] ✗ |
| mob-skeleton-mage | 1.71 / 1.41 / 3.71 [1.71] ✗ |
| mob-zombie | 2.55 / 1.02 / 9.12 [2.55] ✗ |
| mage | 1.69 / 1.08 / 5.15 [1.69] ✗ |
| mage-female | 1.81 / 1.02 / 5.04 [1.81] ✗ |

## Props, boundaries and seams (in front of / beside the zone's most common props; straddling a surface change `edge:A|B` or a zone seam `seam:a|b`)

| zone | prop | mode | cells | EDGE p10 pass | worst EDGE p10 | worst appearance | markers pass |
|---|---|---|---:|---:|---:|---|---:|
| fire | fire.crystal | front | 3 | 0 | 1.02 | hero-female | 0 |
| fire | fire.stump | beside | 2 | 0 | 1.03 | mob-antlion | 0 |
| fire | fire.rocks | front | 5 | 0 | 1.03 | skeleton | 0 |
| fire | fire.spire | beside | 6 | 0 | 1.01 | skeleton | 0 |
| fire | fire.rocks | beside | 4 | 0 | 1.05 | knight | 0 |
| fire | fire.spire | front | 3 | 0 | 1.07 | mob-zombie | 0 |
| fire | fire.crystal | beside | 1 | 0 | 1.06 | mage | 0 |
| fire | fire.stump | front | 2 | 0 | 1.05 | mob-antlion | 0 |
| fire | edge:Ember | Basalt | 12 | 0 | 1.01 | skeleton | 0 |
| fire | edge:Lava | Basalt | 12 | 0 | 1.04 | mob-zombie | 0 |
| fire | edge:Basalt | Lava | 12 | 0 | 1.06 | mage | 0 |
| fire | edge:Ember | Basalt | 12 | 0 | 1.02 | skeleton | 0 |
| fire | seam:fire | sentenced | 12 | 0 | 1.02 | mage-female | 0 |
| sentenced | sent.deadtree | front | 4 | 0 | 1.05 | knight | 0 |
| sentenced | sent.lantern | beside | 3 | 0 | 1.05 | goblin | 0 |
| sentenced | sent.lantern | front | 5 | 0 | 1.04 | hero | 0 |
| sentenced | sent.deadgrass | beside | 7 | 0 | 1.01 | hero | 0 |
| sentenced | sent.deadgrass | front | 4 | 0 | 1.05 | mob-zombie | 0 |
| sentenced | sent.deadtree | beside | 3 | 0 | 1.03 | mage-female | 0 |
| sentenced | seam:sentenced | plague | 12 | 0 | 1.04 | mob-zombie | 0 |
| plague | plague.tree | front | 6 | 0 | 1.03 | mage-female | 0 |
| plague | plague.fern | beside | 9 | 0 | 1.01 | goblin | 0 |
| plague | plague.column | front | 1 | 0 | 1.12 | skeleton | 0 |
| plague | plague.bush | front | 6 | 0 | 1.01 | mob-zombie | 0 |
| plague | plague.tree | beside | 1 | 0 | 1.17 | mob-antlion | 0 |
| plague | plague.bush | beside | 2 | 0 | 1.04 | skeleton | 0 |
| plague | plague.column | beside | 1 | 0 | 1.04 | mage-female | 0 |
| plague | edge:Grass | Bog | 12 | 0 | 1.09 | goblin | 0 |
| plague | edge:Mud | Grass | 12 | 0 | 1.03 | hero@sentenced | 0 |
| plague | seam:plague | frost | 12 | 2 | 1.04 | knight | 0 |
| frost | frost.drift | front | 4 | 1 | 1.40 | mage | 0 |
| frost | frost.pine | beside | 3 | 0 | 1.10 | goblin | 0 |
| frost | frost.pine | front | 5 | 0 | 1.07 | skeleton | 0 |
| frost | frost.rock2 | beside | 3 | 0 | 1.69 | mob-skeleton-archer | 0 |
| frost | frost.drift | beside | 4 | 0 | 1.95 | mob-zombie | 0 |
| frost | frost.drift2 | front | 4 | 0 | 1.38 | mob-zombie | 0 |
| frost | frost.drift2 | beside | 3 | 1 | 1.66 | mage-female | 0 |
| frost | edge:Ice | Snow | 12 | 4 | 1.62 | mob-skeleton-archer | 0 |
| frost | edge:Snow | Ice | 12 | 4 | 1.76 | goblin | 0 |
| frost | seam:frost | holy | 12 | 1 | 1.12 | mage-female | 0 |
| holy | holy.grass | front | 4 | 0 | 1.08 | mob-skeleton-archer | 0 |
| holy | holy.grass | beside | 7 | 0 | 1.02 | hero | 0 |
| holy | holy.palm | front | 4 | 0 | 1.08 | mob-goblin-elite | 0 |
| holy | holy.flowers | front | 4 | 0 | 1.03 | mob-skeleton-mage | 1 |
| holy | holy.palm | beside | 3 | 0 | 1.04 | hero-female | 0 |
| holy | holy.flowers | beside | 3 | 0 | 1.09 | mob-skeleton-mage | 0 |
| holy | holy.pillar | front | 1 | 0 | 1.14 | goblin | 0 |
| holy | edge:HolyLight | Sand | 12 | 0 | 1.18 | mob-zombie | 0 |
| holy | edge:Sand | HolyLight | 12 | 1 | 1.06 | mob-skeleton-mage | 0 |
| holy | seam:holy | coliseum | 12 | 3 | 1.19 | mob-goblin-elite | 0 |
| coliseum | col.banner | front | 1 | 0 | 1.87 | knight | 0 |
| coliseum | col.rack | beside | 1 | 0 | 1.53 | goblin | 0 |
| coliseum | col.rack | front | 1 | 0 | 1.12 | skeleton | 0 |

## Markers (worst over every pose, facing, size and quality)

| zone | hp bar min | footprint min | insignia min | cells with all markers >= 4.5 |
|---|---:|---:|---:|---:|
| fire | 1.19 | 1.11 | 1.22 | 0 / 242 |
| sentenced | 1.02 | 1.53 | 1.08 | 0 / 90 |
| plague | 1.27 | 1.00 | 1.37 | 0 / 212 |
| frost | 1.99 | 1.00 | 1.39 | 0 / 166 |
| holy | 2.46 | 1.00 | 2.88 | 1 / 166 |
| coliseum | 8.39 | 1.01 | 5.01 | 0 / 55 |

## BODY distribution (median interior luminance vs the whole ring; reported, not gated)

| zone | n | min | p25 | median | p75 | max |
|---|---:|---:|---:|---:|---:|---:|
| fire | 156 | 1.00 | 1.17 | 1.42 | 3.16 | 5.64 |
| sentenced | 52 | 1.10 | 1.25 | 1.60 | 2.08 | 3.29 |
| plague | 150 | 1.00 | 1.21 | 1.39 | 1.84 | 4.17 |
| frost | 104 | 3.43 | 6.00 | 7.40 | 9.03 | 12.19 |
| holy | 104 | 2.11 | 4.03 | 4.87 | 6.31 | 8.53 |
| coliseum | 52 | 3.71 | 5.37 | 7.47 | 9.20 | 10.70 |

## Plan notes

- plague/Grass: no clean ground, nothing stamped
- plague/ShallowWater: only 46 of 52 cells fit on clean ground
- plague/ShallowWater: patch is mixed, cells sit on at least 50% pure ground
- coliseum: props pages hold 3 of the 26 wanted cells

## Browser console errors

none
