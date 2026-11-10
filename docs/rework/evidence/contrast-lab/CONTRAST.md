# Character contrast gate

Generated 2026-11-10T11:17:12.953Z. Gate: EDGE p10 over 16 contour sectors >= 3; markers (hp bar, faction footprint, faction insignia) >= 4.5. Definition and caveats: docs/rework/CONTRAST_GATE.md.

GPU: ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version). Frames: 4 normal + 3 ground averaged per page.

## Pass counts

| config | zone | cells | EDGE p10 >= 3 | EDGE min >= 3 | core p10 >= 3 | markers >= 4.5 | unmeasured |
|---|---|---:|---:|---:|---:|---:|---:|
| 1920x1080/high | fire | 182 | 0 | 0 | 1 | 0 | 0 |
| 1920x1080/high | sentenced | 78 | 0 | 0 | 0 | 0 | 0 |
| 1920x1080/high | plague | 130 | 0 | 0 | 13 | 19 | 0 |
| 1920x1080/high | frost | 130 | 0 | 0 | 39 | 32 | 0 |
| 1920x1080/high | holy | 130 | 0 | 0 | 5 | 0 | 0 |
| 1920x1080/high | coliseum | 52 | 0 | 0 | 18 | 23 | 0 |
| 1920x1080/ultra | fire | 182 | 0 | 0 | 1 | 0 | 0 |
| 1920x1080/ultra | sentenced | 78 | 0 | 0 | 0 | 0 | 0 |
| 1920x1080/ultra | plague | 130 | 0 | 0 | 14 | 19 | 0 |
| 1920x1080/ultra | frost | 130 | 0 | 0 | 40 | 32 | 0 |
| 1920x1080/ultra | holy | 130 | 0 | 0 | 5 | 0 | 0 |
| 1920x1080/ultra | coliseum | 52 | 0 | 0 | 17 | 23 | 0 |
| 2560x1440/high | fire | 182 | 0 | 0 | 2 | 0 | 0 |
| 2560x1440/high | sentenced | 78 | 0 | 0 | 0 | 0 | 0 |
| 2560x1440/high | plague | 130 | 0 | 0 | 10 | 13 | 0 |
| 2560x1440/high | frost | 130 | 0 | 0 | 26 | 29 | 0 |
| 2560x1440/high | holy | 130 | 0 | 0 | 3 | 1 | 0 |
| 2560x1440/high | coliseum | 52 | 0 | 0 | 13 | 15 | 0 |
| 2560x1440/ultra | fire | 182 | 0 | 0 | 1 | 0 | 0 |
| 2560x1440/ultra | sentenced | 78 | 0 | 0 | 0 | 0 | 0 |
| 2560x1440/ultra | plague | 130 | 0 | 0 | 12 | 16 | 0 |
| 2560x1440/ultra | frost | 130 | 0 | 0 | 27 | 27 | 0 |
| 2560x1440/ultra | holy | 130 | 0 | 0 | 3 | 0 | 0 |
| 2560x1440/ultra | coliseum | 52 | 0 | 0 | 12 | 16 | 0 |

## EDGE by zone

Cell = worst case over every pose, facing, size and quality of: EDGE p10 / EDGE min / BODY, then [core p10] (the edge of the sprite and its dark outline alone, ignoring the light rim). A mark means EDGE p10 below the gate in at least one run. Plain-ground cells only; props are below.

### fire

| appearance | Basalt | Ember | Lava |
|---|---:|---:|---:|
| knight | 1.01 / 1.00 / 1.20 [1.09] ✗ | 1.01 / 1.00 / 1.38 [1.02] ✗ | 1.26 / 1.00 / 4.26 [2.37] ✗ |
| goblin | 1.01 / 1.00 / 1.02 [1.06] ✗ | 1.03 / 1.00 / 1.04 [1.02] ✗ | 1.22 / 1.00 / 3.35 [1.79] ✗ |
| skeleton | 1.02 / 1.01 / 1.18 [1.04] ✗ | 1.06 / 1.00 / 1.01 [1.07] ✗ | 1.21 / 1.04 / 3.06 [1.71] ✗ |
| hero | 1.06 / 1.01 / 1.09 [1.06] ✗ | 1.03 / 1.01 / 1.07 [1.08] ✗ | 1.09 / 1.05 / 2.63 [1.46] ✗ |
| hero@sentenced | 1.00 / 1.00 / 1.01 [1.01] ✗ | 1.05 / 1.00 / 1.00 [1.05] ✗ | 1.28 / 1.02 / 3.13 [1.80] ✗ |
| hero-female | 1.09 / 1.01 / 1.03 [1.20] ✗ | 1.04 / 1.01 / 1.02 [1.14] ✗ | 1.23 / 1.00 / 3.10 [1.34] ✗ |
| mob-goblin-elite | 1.01 / 1.01 / 1.04 [1.04] ✗ | 1.03 / 1.00 / 1.04 [1.07] ✗ | 1.14 / 1.01 / 2.67 [1.46] ✗ |
| mob-antlion | 1.02 / 1.01 / 1.30 [1.19] ✗ | 1.03 / 1.00 / 1.37 [1.14] ✗ | 1.54 / 1.18 / 4.09 [2.54] ✗ |
| mob-skeleton-archer | 1.02 / 1.00 / 1.08 [1.03] ✗ | 1.05 / 1.00 / 1.08 [1.05] ✗ | 1.18 / 1.00 / 2.54 [1.06] ✗ |
| mob-skeleton-mage | 1.04 / 1.00 / 1.16 [1.03] ✗ | 1.06 / 1.00 / 1.23 [1.03] ✗ | 1.32 / 1.01 / 3.54 [1.68] ✗ |
| mob-zombie | 1.05 / 1.01 / 1.19 [1.14] ✗ | 1.03 / 1.00 / 1.38 [1.10] ✗ | 1.30 / 1.08 / 3.77 [1.84] ✗ |
| mage | 1.03 / 1.00 / 1.02 [1.11] ✗ | 1.08 / 1.00 / 1.02 [1.07] ✗ | 1.27 / 1.00 / 2.70 [1.44] ✗ |
| mage-female | 1.07 / 1.02 / 1.12 [1.12] ✗ | 1.04 / 1.00 / 1.01 [1.05] ✗ | 1.10 / 1.00 / 2.86 [1.19] ✗ |

### sentenced

| appearance | Flagstone |
|---|---:|
| knight | 1.03 / 1.00 / 1.00 [1.02] ✗ |
| goblin | 1.03 / 1.00 / 1.25 [1.02] ✗ |
| skeleton | 1.02 / 1.00 / 1.06 [1.04] ✗ |
| hero | 1.03 / 1.00 / 1.04 [1.14] ✗ |
| hero@sentenced | 1.03 / 1.00 / 1.10 [1.08] ✗ |
| hero-female | 1.02 / 1.00 / 1.02 [1.10] ✗ |
| mob-goblin-elite | 1.02 / 1.00 / 1.01 [1.02] ✗ |
| mob-antlion | 1.01 / 1.00 / 1.05 [1.06] ✗ |
| mob-skeleton-archer | 1.03 / 1.00 / 1.03 [1.04] ✗ |
| mob-skeleton-mage | 1.03 / 1.00 / 1.02 [1.03] ✗ |
| mob-zombie | 1.03 / 1.01 / 1.03 [1.03] ✗ |
| mage | 1.10 / 1.00 / 1.30 [1.12] ✗ |
| mage-female | 1.03 / 1.00 / 1.38 [1.08] ✗ |

### plague

| appearance | Mud | Bog |
|---|---:|---:|
| knight | 1.21 / 1.01 / 2.91 [1.91] ✗ | 1.31 / 1.00 / 4.46 [2.57] ✗ |
| goblin | 1.10 / 1.01 / 1.88 [1.53] ✗ | 1.26 / 1.05 / 3.31 [1.99] ✗ |
| skeleton | 1.14 / 1.04 / 1.93 [1.54] ✗ | 1.29 / 1.23 / 2.94 [2.02] ✗ |
| hero | 1.07 / 1.01 / 1.71 [1.45] ✗ | 1.15 / 1.05 / 2.63 [1.39] ✗ |
| hero@sentenced | 1.15 / 1.04 / 2.02 [1.66] ✗ | 1.24 / 1.02 / 3.00 [2.17] ✗ |
| hero-female | 1.01 / 1.00 / 1.76 [1.01] ✗ | 1.21 / 1.00 / 2.68 [1.24] ✗ |
| mob-goblin-elite | 1.03 / 1.01 / 2.54 [1.12] ✗ | 1.24 / 1.10 / 3.35 [1.45] ✗ |
| mob-antlion | 1.38 / 1.17 / 2.77 [2.18] ✗ | 1.57 / 1.39 / 4.80 [3.30] ✗ |
| mob-skeleton-archer | 1.02 / 1.00 / 1.51 [1.03] ✗ | 1.18 / 1.00 / 2.31 [1.08] ✗ |
| mob-skeleton-mage | 1.11 / 1.01 / 2.36 [1.28] ✗ | 1.34 / 1.15 / 4.28 [1.85] ✗ |
| mob-zombie | 1.17 / 1.03 / 3.07 [1.29] ✗ | 1.27 / 1.17 / 4.78 [2.43] ✗ |
| mage | 1.02 / 1.00 / 1.63 [1.03] ✗ | 1.30 / 1.02 / 2.47 [1.58] ✗ |
| mage-female | 1.02 / 1.01 / 1.74 [1.03] ✗ | 1.13 / 1.02 / 2.55 [1.16] ✗ |

### frost

| appearance | Snow | Ice |
|---|---:|---:|
| knight | 1.06 / 1.04 / 7.75 [2.68] ✗ | 1.02 / 1.01 / 4.29 [2.28] ✗ |
| goblin | 1.08 / 1.04 / 5.14 [2.66] ✗ | 1.04 / 1.01 / 2.83 [1.97] ✗ |
| skeleton | 1.09 / 1.03 / 5.00 [2.59] ✗ | 1.07 / 1.01 / 2.91 [1.54] ✗ |
| hero | 1.08 / 1.05 / 4.46 [2.40] ✗ | 1.05 / 1.01 / 2.43 [1.69] ✗ |
| hero@sentenced | 1.08 / 1.07 / 4.27 [2.65] ✗ | 1.04 / 1.00 / 2.96 [2.00] ✗ |
| hero-female | 1.09 / 1.02 / 4.54 [2.07] ✗ | 1.06 / 1.01 / 2.68 [1.48] ✗ |
| mob-goblin-elite | 1.10 / 1.07 / 6.08 [2.34] ✗ | 1.03 / 1.00 / 3.50 [1.37] ✗ |
| mob-antlion | 1.13 / 1.09 / 7.14 [3.50] ✗ | 1.13 / 1.01 / 4.03 [2.55] ✗ |
| mob-skeleton-archer | 1.10 / 1.06 / 3.92 [1.52] ✗ | 1.05 / 1.00 / 2.37 [1.12] ✗ |
| mob-skeleton-mage | 1.10 / 1.05 / 4.98 [2.60] ✗ | 1.07 / 1.02 / 4.08 [1.82] ✗ |
| mob-zombie | 1.10 / 1.06 / 6.14 [2.94] ✗ | 1.05 / 1.00 / 4.03 [2.39] ✗ |
| mage | 1.11 / 1.08 / 3.99 [2.20] ✗ | 1.08 / 1.00 / 2.20 [1.68] ✗ |
| mage-female | 1.11 / 1.08 / 4.16 [2.14] ✗ | 1.06 / 1.02 / 2.25 [1.20] ✗ |

### holy

| appearance | Sand | HolyLight |
|---|---:|---:|
| knight | 1.08 / 1.01 / 4.57 [2.20] ✗ | 1.09 / 1.06 / 3.81 [1.90] ✗ |
| goblin | 1.08 / 1.00 / 3.19 [1.84] ✗ | 1.10 / 1.07 / 3.05 [1.82] ✗ |
| skeleton | 1.03 / 1.00 / 2.89 [1.65] ✗ | 1.10 / 1.09 / 2.86 [1.81] ✗ |
| hero | 1.08 / 1.01 / 2.49 [1.57] ✗ | 1.09 / 1.08 / 2.49 [1.78] ✗ |
| hero@sentenced | 1.09 / 1.01 / 2.81 [1.99] ✗ | 1.09 / 1.08 / 2.68 [1.93] ✗ |
| hero-female | 1.08 / 1.00 / 2.71 [1.45] ✗ | 1.10 / 1.08 / 2.60 [1.62] ✗ |
| mob-goblin-elite | 1.11 / 1.01 / 3.39 [1.67] ✗ | 1.09 / 1.08 / 2.91 [1.61] ✗ |
| mob-antlion | 1.03 / 1.00 / 4.36 [2.64] ✗ | 1.12 / 1.11 / 3.54 [2.16] ✗ |
| mob-skeleton-archer | 1.07 / 1.00 / 2.27 [1.25] ✗ | 1.10 / 1.08 / 2.49 [1.67] ✗ |
| mob-skeleton-mage | 1.04 / 1.01 / 3.54 [1.86] ✗ | 1.11 / 1.09 / 3.08 [1.80] ✗ |
| mob-zombie | 1.05 / 1.04 / 4.18 [1.82] ✗ | 1.10 / 1.09 / 3.42 [1.95] ✗ |
| mage | 1.11 / 1.02 / 2.74 [1.71] ✗ | 1.11 / 1.08 / 2.73 [1.78] ✗ |
| mage-female | 1.13 / 1.01 / 2.66 [1.41] ✗ | 1.10 / 1.08 / 2.72 [1.61] ✗ |

### coliseum

| appearance | Limestone |
|---|---:|
| knight | 1.08 / 1.02 / 6.57 [2.64] ✗ |
| goblin | 1.10 / 1.03 / 4.36 [2.35] ✗ |
| skeleton | 1.07 / 1.01 / 3.90 [2.01] ✗ |
| hero | 1.09 / 1.06 / 3.45 [2.16] ✗ |
| hero@sentenced | 1.06 / 1.01 / 3.92 [2.18] ✗ |
| hero-female | 1.13 / 1.05 / 3.70 [1.56] ✗ |
| mob-goblin-elite | 1.13 / 1.06 / 4.80 [2.18] ✗ |
| mob-antlion | 1.06 / 1.01 / 6.25 [3.40] ✗ |
| mob-skeleton-archer | 1.07 / 1.00 / 3.15 [1.28] ✗ |
| mob-skeleton-mage | 1.11 / 1.07 / 5.34 [2.20] ✗ |
| mob-zombie | 1.08 / 1.01 / 6.43 [2.61] ✗ |
| mage | 1.14 / 1.02 / 3.56 [1.99] ✗ |
| mage-female | 1.07 / 1.03 / 3.58 [1.51] ✗ |

## Props (character in front of / beside the zone's most common props)

| zone | prop | mode | cells | EDGE p10 pass | worst EDGE p10 | worst appearance | markers pass |
|---|---|---|---:|---:|---:|---|---:|
| fire | fire.crystal | front | 12 | 0 | 1.02 | knight | 0 |
| fire | fire.stump | beside | 8 | 0 | 1.04 | goblin | 0 |
| fire | fire.rocks | front | 20 | 0 | 1.05 | hero | 0 |
| fire | fire.spire | beside | 24 | 0 | 1.02 | mob-zombie | 0 |
| fire | fire.rocks | beside | 16 | 0 | 1.01 | mob-goblin-elite | 0 |
| fire | fire.spire | front | 12 | 0 | 1.08 | mob-goblin-elite | 0 |
| fire | fire.crystal | beside | 4 | 0 | 1.19 | mage | 0 |
| fire | fire.stump | front | 8 | 0 | 1.05 | mage | 0 |
| sentenced | sent.tomb | front | 12 | 0 | 1.04 | mob-zombie | 0 |
| sentenced | sent.deadgrass | beside | 36 | 0 | 1.01 | goblin | 0 |
| sentenced | sent.deadtree | front | 24 | 0 | 1.01 | mage-female | 0 |
| sentenced | sent.deadtree | beside | 4 | 0 | 1.05 | hero | 0 |
| sentenced | sent.deadgrass | front | 16 | 0 | 1.02 | mob-skeleton-archer | 0 |
| sentenced | sent.tomb | beside | 12 | 0 | 1.04 | skeleton | 0 |
| plague | plague.bush | front | 12 | 0 | 1.07 | goblin | 0 |
| plague | plague.bush | beside | 20 | 0 | 1.04 | goblin | 0 |
| plague | plague.fern | front | 20 | 0 | 1.05 | mage-female | 0 |
| plague | plague.column | beside | 12 | 0 | 1.03 | hero-female | 0 |
| plague | plague.tree | front | 16 | 0 | 1.03 | hero-female | 0 |
| plague | plague.tree | beside | 12 | 0 | 1.01 | mob-skeleton-mage | 0 |
| plague | plague.fern | beside | 8 | 0 | 1.03 | mob-skeleton-archer | 0 |
| plague | plague.column | front | 4 | 0 | 1.05 | mage | 0 |
| frost | frost.drift | front | 16 | 0 | 1.06 | knight | 0 |
| frost | frost.pine | beside | 12 | 0 | 1.10 | mob-goblin-elite | 0 |
| frost | frost.pine | front | 20 | 0 | 1.02 | goblin | 4 |
| frost | frost.rock2 | beside | 12 | 0 | 1.15 | mob-skeleton-archer | 0 |
| frost | frost.drift | beside | 16 | 0 | 1.04 | mob-zombie | 0 |
| frost | frost.drift2 | front | 16 | 0 | 1.10 | mob-skeleton-archer | 3 |
| frost | frost.drift2 | beside | 12 | 0 | 1.11 | mage-female | 2 |
| holy | holy.grass | front | 16 | 0 | 1.07 | mob-skeleton-archer | 0 |
| holy | holy.grass | beside | 28 | 0 | 1.03 | hero | 0 |
| holy | holy.palm | front | 16 | 0 | 1.08 | skeleton | 0 |
| holy | holy.flowers | front | 16 | 0 | 1.05 | mage | 0 |
| holy | holy.palm | beside | 12 | 0 | 1.07 | mob-zombie | 1 |
| holy | holy.flowers | beside | 12 | 0 | 1.03 | mob-skeleton-mage | 0 |
| holy | holy.pillar | front | 4 | 0 | 1.28 | goblin | 0 |

## Markers (worst over every pose, facing, size and quality)

| zone | hp bar min | footprint min | insignia min | cells with all markers >= 4.5 |
|---|---:|---:|---:|---:|
| fire | 1.28 | 1.00 | 1.22 | 0 / 728 |
| sentenced | 1.14 | 1.00 | 1.20 | 0 / 312 |
| plague | 1.54 | 1.00 | 1.69 | 67 / 520 |
| frost | 2.29 | 1.03 | 1.86 | 120 / 520 |
| holy | 3.27 | 1.09 | 2.83 | 1 / 520 |
| coliseum | 8.15 | 1.42 | 5.82 | 77 / 208 |

## BODY distribution (median interior luminance vs the whole ring; reported, not gated)

| zone | n | min | p25 | median | p75 | max |
|---|---:|---:|---:|---:|---:|---:|
| fire | 624 | 1.00 | 1.20 | 1.38 | 3.33 | 5.28 |
| sentenced | 208 | 1.00 | 1.09 | 1.19 | 1.42 | 1.99 |
| plague | 416 | 1.51 | 2.66 | 3.25 | 4.38 | 7.30 |
| frost | 416 | 2.20 | 4.06 | 4.85 | 6.17 | 8.82 |
| holy | 416 | 2.27 | 3.01 | 3.43 | 3.92 | 5.27 |
| coliseum | 208 | 3.15 | 4.31 | 5.24 | 6.26 | 8.01 |

## Browser console errors

none
