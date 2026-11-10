# Character contrast gate

Generated 2026-11-10T10:03:39.215Z. Gate: EDGE p10 over 16 contour sectors >= 3; markers (hp bar, faction footprint, faction insignia) >= 4.5. Definition and caveats: docs/rework/CONTRAST_GATE.md.

GPU: ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version). Frames: 4 normal + 3 ground averaged per page.

## Pass counts

| config | zone | cells | EDGE p10 >= 3 | EDGE min >= 3 | core p10 >= 3 | markers >= 4.5 | unmeasured |
|---|---|---:|---:|---:|---:|---:|---:|
| 1920x1080/high | fire | 182 | 0 | 0 | 2 | 0 | 0 |
| 1920x1080/high | sentenced | 78 | 0 | 0 | 0 | 0 | 0 |
| 1920x1080/high | plague | 130 | 0 | 0 | 12 | 18 | 0 |
| 1920x1080/high | frost | 130 | 0 | 0 | 43 | 35 | 0 |
| 1920x1080/high | holy | 130 | 0 | 0 | 4 | 0 | 0 |
| 1920x1080/high | coliseum | 52 | 0 | 0 | 16 | 22 | 0 |
| 1920x1080/ultra | fire | 182 | 0 | 0 | 3 | 0 | 0 |
| 1920x1080/ultra | sentenced | 78 | 0 | 0 | 0 | 0 | 0 |
| 1920x1080/ultra | plague | 130 | 0 | 0 | 16 | 19 | 0 |
| 1920x1080/ultra | frost | 130 | 0 | 0 | 41 | 36 | 0 |
| 1920x1080/ultra | holy | 130 | 0 | 0 | 3 | 0 | 0 |
| 1920x1080/ultra | coliseum | 52 | 0 | 0 | 16 | 22 | 0 |
| 2560x1440/high | fire | 182 | 0 | 0 | 2 | 0 | 0 |
| 2560x1440/high | sentenced | 78 | 0 | 0 | 0 | 0 | 0 |
| 2560x1440/high | plague | 130 | 0 | 0 | 10 | 13 | 0 |
| 2560x1440/high | frost | 130 | 0 | 0 | 30 | 27 | 0 |
| 2560x1440/high | holy | 130 | 0 | 0 | 3 | 0 | 0 |
| 2560x1440/high | coliseum | 52 | 0 | 0 | 12 | 16 | 0 |
| 2560x1440/ultra | fire | 182 | 0 | 0 | 3 | 0 | 0 |
| 2560x1440/ultra | sentenced | 78 | 0 | 0 | 0 | 0 | 0 |
| 2560x1440/ultra | plague | 130 | 0 | 0 | 10 | 15 | 0 |
| 2560x1440/ultra | frost | 130 | 0 | 0 | 37 | 32 | 0 |
| 2560x1440/ultra | holy | 130 | 0 | 0 | 3 | 0 | 0 |
| 2560x1440/ultra | coliseum | 52 | 0 | 0 | 12 | 15 | 0 |

## EDGE by zone

Cell = worst case over every pose, facing, size and quality of: EDGE p10 / EDGE min / BODY, then [core p10] (the edge of the sprite and its dark outline alone, ignoring the light rim). A mark means EDGE p10 below the gate in at least one run. Plain-ground cells only; props are below.

### fire

| appearance | Basalt | Ember | Lava |
|---|---:|---:|---:|
| knight | 1.01 / 1.00 / 1.20 [1.10] ✗ | 1.02 / 1.00 / 1.37 [1.04] ✗ | 1.24 / 1.00 / 4.33 [2.16] ✗ |
| goblin | 1.01 / 1.00 / 1.02 [1.06] ✗ | 1.02 / 1.00 / 1.01 [1.01] ✗ | 1.24 / 1.03 / 3.20 [1.80] ✗ |
| skeleton | 1.02 / 1.01 / 1.18 [1.04] ✗ | 1.06 / 1.00 / 1.02 [1.06] ✗ | 1.34 / 1.19 / 3.20 [1.76] ✗ |
| hero | 1.06 / 1.01 / 1.09 [1.06] ✗ | 1.03 / 1.00 / 1.06 [1.08] ✗ | 1.17 / 1.01 / 2.74 [1.56] ✗ |
| hero@sentenced | 1.00 / 1.00 / 1.01 [1.01] ✗ | 1.05 / 1.00 / 1.00 [1.05] ✗ | 1.15 / 1.06 / 3.20 [1.88] ✗ |
| hero-female | 1.09 / 1.01 / 1.03 [1.20] ✗ | 1.06 / 1.00 / 1.02 [1.16] ✗ | 1.26 / 1.03 / 3.01 [1.36] ✗ |
| mob-goblin-elite | 1.01 / 1.01 / 1.04 [1.04] ✗ | 1.02 / 1.00 / 1.03 [1.07] ✗ | 1.22 / 1.00 / 2.71 [1.38] ✗ |
| mob-antlion | 1.02 / 1.01 / 1.30 [1.19] ✗ | 1.03 / 1.00 / 1.38 [1.16] ✗ | 1.42 / 1.21 / 4.06 [2.70] ✗ |
| mob-skeleton-archer | 1.02 / 1.00 / 1.08 [1.03] ✗ | 1.05 / 1.01 / 1.08 [1.04] ✗ | 1.20 / 1.11 / 2.58 [1.23] ✗ |
| mob-skeleton-mage | 1.04 / 1.00 / 1.16 [1.02] ✗ | 1.04 / 1.00 / 1.24 [1.04] ✗ | 1.22 / 1.01 / 3.52 [1.68] ✗ |
| mob-zombie | 1.05 / 1.01 / 1.19 [1.14] ✗ | 1.03 / 1.00 / 1.38 [1.11] ✗ | 1.20 / 1.01 / 3.71 [1.69] ✗ |
| mage | 1.03 / 1.00 / 1.02 [1.11] ✗ | 1.08 / 1.01 / 1.01 [1.10] ✗ | 1.28 / 1.02 / 2.74 [1.46] ✗ |
| mage-female | 1.07 / 1.02 / 1.12 [1.12] ✗ | 1.06 / 1.01 / 1.02 [1.07] ✗ | 1.14 / 1.00 / 2.92 [1.29] ✗ |

### sentenced

| appearance | Flagstone |
|---|---:|
| knight | 1.03 / 1.00 / 1.00 [1.03] ✗ |
| goblin | 1.03 / 1.01 / 1.25 [1.02] ✗ |
| skeleton | 1.03 / 1.00 / 1.06 [1.04] ✗ |
| hero | 1.03 / 1.00 / 1.04 [1.13] ✗ |
| hero@sentenced | 1.03 / 1.00 / 1.10 [1.03] ✗ |
| hero-female | 1.03 / 1.00 / 1.01 [1.08] ✗ |
| mob-goblin-elite | 1.03 / 1.00 / 1.01 [1.01] ✗ |
| mob-antlion | 1.02 / 1.00 / 1.04 [1.06] ✗ |
| mob-skeleton-archer | 1.03 / 1.00 / 1.00 [1.04] ✗ |
| mob-skeleton-mage | 1.03 / 1.00 / 1.02 [1.01] ✗ |
| mob-zombie | 1.02 / 1.00 / 1.03 [1.03] ✗ |
| mage | 1.11 / 1.00 / 1.30 [1.07] ✗ |
| mage-female | 1.04 / 1.00 / 1.38 [1.07] ✗ |

### plague

| appearance | Mud | Bog |
|---|---:|---:|
| knight | 1.24 / 1.02 / 2.90 [1.86] ✗ | 1.33 / 1.02 / 4.61 [2.63] ✗ |
| goblin | 1.07 / 1.01 / 2.00 [1.49] ✗ | 1.23 / 1.11 / 3.08 [2.05] ✗ |
| skeleton | 1.08 / 1.00 / 1.96 [1.26] ✗ | 1.34 / 1.21 / 2.88 [1.75] ✗ |
| hero | 1.09 / 1.02 / 1.70 [1.45] ✗ | 1.17 / 1.02 / 2.42 [1.46] ✗ |
| hero@sentenced | 1.13 / 1.05 / 2.03 [1.59] ✗ | 1.23 / 1.01 / 3.06 [2.18] ✗ |
| hero-female | 1.01 / 1.00 / 1.84 [1.01] ✗ | 1.21 / 1.01 / 2.72 [1.33] ✗ |
| mob-goblin-elite | 1.03 / 1.00 / 2.73 [1.36] ✗ | 1.17 / 1.01 / 3.38 [1.40] ✗ |
| mob-antlion | 1.41 / 1.17 / 2.77 [2.37] ✗ | 1.56 / 1.46 / 4.73 [3.15] ✗ |
| mob-skeleton-archer | 1.07 / 1.01 / 1.47 [1.13] ✗ | 1.10 / 1.02 / 2.45 [1.08] ✗ |
| mob-skeleton-mage | 1.11 / 1.01 / 2.46 [1.26] ✗ | 1.31 / 1.08 / 4.00 [1.82] ✗ |
| mob-zombie | 1.15 / 1.00 / 3.02 [1.55] ✗ | 1.28 / 1.09 / 4.80 [2.11] ✗ |
| mage | 1.03 / 1.01 / 1.60 [1.02] ✗ | 1.33 / 1.01 / 2.45 [1.50] ✗ |
| mage-female | 1.03 / 1.00 / 1.70 [1.04] ✗ | 1.16 / 1.00 / 2.83 [1.19] ✗ |

### frost

| appearance | Snow | Ice |
|---|---:|---:|
| knight | 1.06 / 1.04 / 7.41 [2.76] ✗ | 1.04 / 1.01 / 4.08 [2.18] ✗ |
| goblin | 1.09 / 1.03 / 5.50 [2.71] ✗ | 1.05 / 1.00 / 2.86 [1.97] ✗ |
| skeleton | 1.08 / 1.02 / 5.00 [2.56] ✗ | 1.07 / 1.01 / 3.00 [1.57] ✗ |
| hero | 1.07 / 1.05 / 4.17 [2.39] ✗ | 1.05 / 1.01 / 2.36 [1.69] ✗ |
| hero@sentenced | 1.08 / 1.07 / 4.26 [2.67] ✗ | 1.05 / 1.02 / 2.91 [2.00] ✗ |
| hero-female | 1.09 / 1.02 / 4.07 [2.02] ✗ | 1.05 / 1.01 / 2.59 [1.49] ✗ |
| mob-goblin-elite | 1.10 / 1.07 / 5.96 [2.31] ✗ | 1.07 / 1.01 / 3.62 [1.36] ✗ |
| mob-antlion | 1.13 / 1.09 / 6.60 [3.42] ✗ | 1.13 / 1.00 / 4.20 [2.83] ✗ |
| mob-skeleton-archer | 1.09 / 1.06 / 4.14 [1.50] ✗ | 1.05 / 1.01 / 2.34 [1.10] ✗ |
| mob-skeleton-mage | 1.10 / 1.05 / 4.57 [2.48] ✗ | 1.05 / 1.01 / 3.94 [2.05] ✗ |
| mob-zombie | 1.11 / 1.06 / 6.26 [2.54] ✗ | 1.06 / 1.02 / 4.07 [2.15] ✗ |
| mage | 1.11 / 1.08 / 4.26 [2.21] ✗ | 1.08 / 1.01 / 2.22 [1.69] ✗ |
| mage-female | 1.11 / 1.08 / 4.35 [2.19] ✗ | 1.08 / 1.01 / 2.27 [1.21] ✗ |

### holy

| appearance | Sand | HolyLight |
|---|---:|---:|
| knight | 1.07 / 1.02 / 4.56 [2.12] ✗ | 1.09 / 1.06 / 3.80 [1.91] ✗ |
| goblin | 1.08 / 1.00 / 3.11 [1.81] ✗ | 1.09 / 1.08 / 3.02 [1.80] ✗ |
| skeleton | 1.01 / 1.00 / 2.83 [1.64] ✗ | 1.10 / 1.08 / 2.92 [1.85] ✗ |
| hero | 1.08 / 1.01 / 2.54 [1.56] ✗ | 1.09 / 1.08 / 2.53 [1.76] ✗ |
| hero@sentenced | 1.09 / 1.01 / 2.78 [1.96] ✗ | 1.09 / 1.08 / 2.65 [1.91] ✗ |
| hero-female | 1.08 / 1.00 / 2.75 [1.46] ✗ | 1.09 / 1.07 / 2.65 [1.62] ✗ |
| mob-goblin-elite | 1.11 / 1.01 / 3.31 [1.67] ✗ | 1.09 / 1.07 / 2.94 [1.62] ✗ |
| mob-antlion | 1.03 / 1.00 / 4.32 [2.52] ✗ | 1.12 / 1.11 / 3.59 [2.18] ✗ |
| mob-skeleton-archer | 1.07 / 1.00 / 2.25 [1.23] ✗ | 1.10 / 1.08 / 2.44 [1.67] ✗ |
| mob-skeleton-mage | 1.09 / 1.04 / 3.58 [1.86] ✗ | 1.09 / 1.05 / 3.06 [1.77] ✗ |
| mob-zombie | 1.05 / 1.04 / 4.02 [1.83] ✗ | 1.10 / 1.08 / 3.49 [1.96] ✗ |
| mage | 1.11 / 1.02 / 2.60 [1.67] ✗ | 1.10 / 1.07 / 2.85 [1.78] ✗ |
| mage-female | 1.10 / 1.01 / 2.57 [1.37] ✗ | 1.10 / 1.09 / 2.79 [1.61] ✗ |

### coliseum

| appearance | Limestone |
|---|---:|
| knight | 1.08 / 1.02 / 6.59 [2.64] ✗ |
| goblin | 1.10 / 1.01 / 4.41 [2.14] ✗ |
| skeleton | 1.07 / 1.01 / 3.93 [2.01] ✗ |
| hero | 1.09 / 1.01 / 3.48 [2.14] ✗ |
| hero@sentenced | 1.06 / 1.01 / 3.91 [2.19] ✗ |
| hero-female | 1.13 / 1.05 / 3.74 [1.53] ✗ |
| mob-goblin-elite | 1.08 / 1.01 / 4.70 [2.14] ✗ |
| mob-antlion | 1.06 / 1.01 / 6.26 [3.22] ✗ |
| mob-skeleton-archer | 1.07 / 1.00 / 3.21 [1.29] ✗ |
| mob-skeleton-mage | 1.08 / 1.00 / 5.34 [2.30] ✗ |
| mob-zombie | 1.09 / 1.01 / 6.67 [2.75] ✗ |
| mage | 1.14 / 1.02 / 3.51 [2.01] ✗ |
| mage-female | 1.08 / 1.01 / 3.52 [1.51] ✗ |

## Props (character in front of / beside the zone's most common props)

| zone | prop | mode | cells | EDGE p10 pass | worst EDGE p10 | worst appearance | markers pass |
|---|---|---|---:|---:|---:|---|---:|
| fire | fire.rocks | front | 44 | 0 | 1.03 | mob-goblin-elite | 0 |
| fire | fire.rocks | beside | 36 | 0 | 1.04 | hero@sentenced | 0 |
| fire | fire.spire | beside | 12 | 0 | 1.03 | mob-skeleton-mage | 0 |
| fire | fire.spire | front | 8 | 0 | 1.03 | mob-zombie | 0 |
| fire | fire.stump | beside | 4 | 0 | 1.06 | mob-skeleton-archer | 0 |
| sentenced | sent.deadgrass | front | 52 | 0 | 1.02 | mob-zombie | 0 |
| sentenced | sent.deadgrass | beside | 52 | 0 | 1.00 | mob-goblin-elite | 0 |
| plague | plague.fern | front | 52 | 0 | 1.01 | mob-goblin-elite | 0 |
| plague | plague.fern | beside | 52 | 0 | 1.02 | mage | 0 |
| frost | frost.drift | front | 44 | 0 | 1.05 | hero-female | 8 |
| frost | frost.drift | beside | 48 | 0 | 1.05 | mob-goblin-elite | 7 |
| frost | frost.drift2 | beside | 4 | 0 | 1.08 | mob-skeleton-mage | 0 |
| frost | frost.drift2 | front | 8 | 0 | 1.05 | mage-female | 2 |
| holy | holy.grass | front | 52 | 0 | 1.02 | hero@sentenced | 0 |
| holy | holy.grass | beside | 52 | 0 | 1.04 | mob-antlion | 0 |

## Markers (worst over every pose, facing, size and quality)

| zone | hp bar min | footprint min | insignia min | cells with all markers >= 4.5 |
|---|---:|---:|---:|---:|
| fire | 1.28 | 1.00 | 1.23 | 0 / 728 |
| sentenced | 1.20 | 1.00 | 1.21 | 0 / 312 |
| plague | 2.44 | 1.02 | 1.01 | 65 / 520 |
| frost | 1.86 | 1.00 | 3.80 | 130 / 520 |
| holy | 3.44 | 1.05 | 2.00 | 0 / 520 |
| coliseum | 8.03 | 1.43 | 5.81 | 75 / 208 |

## BODY distribution (median interior luminance vs the whole ring; reported, not gated)

| zone | n | min | p25 | median | p75 | max |
|---|---:|---:|---:|---:|---:|---:|
| fire | 624 | 1.00 | 1.19 | 1.37 | 3.34 | 5.24 |
| sentenced | 208 | 1.00 | 1.08 | 1.19 | 1.41 | 1.99 |
| plague | 416 | 1.47 | 2.68 | 3.29 | 4.31 | 6.78 |
| frost | 416 | 2.22 | 4.09 | 4.84 | 6.12 | 8.89 |
| holy | 416 | 2.25 | 3.03 | 3.43 | 3.89 | 5.24 |
| coliseum | 208 | 3.21 | 4.34 | 5.21 | 6.29 | 7.95 |

## Browser console errors

none
