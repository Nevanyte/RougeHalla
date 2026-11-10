# Palette: research, method and checks

Status: proposed palette v1, checked numerically only. Nothing here has been rendered in Unity; the lighting and "beautiful lighting" half of the brief still needs in-engine tuning against these colours. Direction source: `docs/prompts/UNITY_REWORK_FABLE.md` section 4 ("Theme and layout", "Palette"): Legend-of-Zelda / modern-fantasy brightness with vibrant colour, still closely matching the feel of the pre-port game, Sentenced the one deliberately muted zone, Holy and Plague with plenty of greenery.

Machine-readable source of truth: [`palette.json`](palette.json) (colours authored in OKLCH). Checker: `node tools/art/palette-check.cjs` (reads `palette.json`; `--legacy-only` / `--palette-only` select one half). The tables in "Check output" below are the unedited output of that command.

## 1. Legacy colours the palette descends from

Extracted from the TypeScript game before any design work. Hue is kept within 30 degrees of these wherever the legacy colour is chromatic (check 2 in the output); lightness is deliberately raised, because the legacy world was dark ("floors stay dark in every zone, CIE L* 15 to 35", `packages/client/src/render/zoneArt/palette.ts`) and the brief asks for a bright world.

| Role | Legacy value | Source |
|---|---|---|
| Faction colours | fire `#FF7043`, sentenced `#9575CD`, plague `#9CCC65`, frost `#4FC3F7`, holy `#FFF176` | `packages/shared/src/factions.ts` (`color`); matched by `ShowcasePalette.cs` |
| Fire zone | floor `#2D2622`, wall top `#5B4A66` (purple obsidian), accent `#FF6A1A`, particle `#FFB74D`, lava `#FF5A14` | `ZONE_PALETTE.fire`, `TERRAIN_PALETTE` |
| Sentenced zone | floor `#3A3B42`, wall top `#7B7E8A`, accent `#7E57C2`, gallows wood `#6E553A` | `ZONE_PALETTE.sentenced`, `SHAPE_PALETTE.gallows` |
| Plague zone | floor `#2A3326`, wall top `#6D7F4A`, accent `#B5E35A`, bog `#8FC25A`, moss `#9BC05A` | `ZONE_PALETTE.plague`, `SHAPE_PALETTE.mound` |
| Frost zone | floor `#34495E`, wall top `#D4EDF9`, wall front `#6F9FBD`, accent `#4AA3DF`, snow `#E3ECF2` | `ZONE_PALETTE.frost`, `SHAPE_PALETTE.snow` |
| Holy zone | floor `#4A4234`, wall top `#E9DFC0`, accent `#D4AF37`, particle `#FFF2B0` | `ZONE_PALETTE.holy`, `SHAPE_PALETTE.pier` |
| Coliseum | floor `#2A3038`, coliseum floor about `#4D4D4A`, neutral wall tint `#8A9099` | `NEUTRAL_PALETTE`, `WALL_TINT_NEUTRAL` |
| UI surfaces | panel `#14181E`, card `#161B21`, hover `#1B2128`, line `#2B323C` / `#3A434F` / `#4A5563` | `packages/client/src/style.css` custom properties |
| UI text | text `#E6E9ED`, soft `#CFD5DC`, muted `#AEB7C2`, dim `#8D99A6` | same |
| UI accents | accent gold `#FFE082`, gold `#FFD54F`, ok `#66BB6A` / text `#A5D6A7`, danger `#EF5350` / text `#EF9A9A`, warn `#FFCC80` | same |

The legacy theme is therefore: dark slate-blue UI with warm gold accents, and five zones each defined by one signature hue (ember orange, judgment violet, bog lime, glacier blue, sanctum gold) over a dark floor. The new palette keeps every one of those signature hues and the slate-blue UI, and lifts the floors.

## 2. Method and sources

1. **Perceptual space: OKLCH.** Every colour is authored as OKLCH (lightness L, chroma C, hue h) and converted to sRGB with the OKLab matrices published by Bjorn Ottosson, "A perceptual color space for image processing" (2020), <https://bottosson.github.io/posts/oklab/>; OKLab/OKLCH is also defined in CSS Color Module Level 4, <https://www.w3.org/TR/css-color-4/#ok-lab>. OKLab was chosen over CIELAB because lightness and hue stay perceptually uniform when only chroma changes, which is what the "same lightness, less chroma" Sentenced zone and the per-region lightness ladder rely on. Gamut: a colour is "in gamut" only if its unclipped linear sRGB is within 0.001 of [0, 1]; nothing is silently clipped, so the stored hex equals the authored value.
2. **60/30/10.** Each region has a 60% base (ground and large surfaces), 30% secondary (structures, foliage) and 10% accent (emissive or faction). This is a designer's rule of thumb, not a measured result; it is used here to structure the swatches and to weight the chroma comparison in check 5. Each region also gets four lighting colours: key light, ambient, shadow tint and fog/haze, ordered key > ambient > shadow in lightness (check 3).
3. **Contrast: WCAG 2.x.** Relative luminance and contrast ratio per WCAG 2.2, <https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio>: 4.5:1 for body text (SC 1.4.3), 3:1 for large text and for UI components and graphical objects (SC 1.4.11). The script linearises with the 0.04045 threshold used by the existing checker (WCAG text says 0.03928; the difference is below one 8-bit step). Because HUD panels are semi-transparent over a bright world, text is also checked on the panel composited over each region's base colour (sRGB-space blend, as a GPU blends).
4. **Colour-vision deficiency.** Severity 1.0 protanopia, deuteranopia and tritanopia via the Machado, Oliveira and Fernandes matrices already used by this script, applied in linear RGB: Machado, Oliveira, Fernandes, "A Physiologically-based Model for Simulation of Color Vision Deficiency", IEEE TVCG 15(6), 2009, DOI 10.1109/TVCG.2009.113. Distances are Euclidean OKLab distance (dE); about 0.02 is the usual just-noticeable difference for OKLab (the figure used for deltaEOK in CSS Color 4). WCAG sets no CVD threshold. The thresholds used here (dE >= 0.07 between any two faction accents in every simulated view, >= 0.05 in grayscale) are this project's own engineering choices, recorded in `palette.json` so they can be argued with.
5. **Not hue alone.** WCAG SC 1.4.1 (use of colour) applies: faction identity is carried first by silhouette and icon (table in section 4), second by lightness steps, third by hue.

## 3. Design decisions

**Lightness ladder for grounds.** Region base lightness is spread so regions differ in lightness or chroma, not hue alone: fire 0.38, plague 0.52 (deeper greens, revised from 0.58), sentenced 0.36 (charcoal flagstones, revised from 0.64; the check output below predates these revisions and was re-run clean: 396 of 396), coliseum 0.72, holy 0.68 (rich golden sand, revised from 0.80 so the light shafts carry the brightness), frost 0.88. Fire is the dark "under the mountain" region; the rest are bright. Grounds in roughly the 0.41 to 0.49 band are avoided on purpose (derived from the contrast arithmetic, not measured on screen): a light accent stops reaching 3:1 directly once the ground is lighter than about 0.41, and the dark outline ink only reaches 3:1 against grounds lighter than about 0.49, so a mid-lightness ground is the worst case for any marker. Every ground in the palette sits below or above that band (check 8).

**Characters on bright grounds need an outline.** The faction accents are light (0.67 to 0.96), so on the bright grounds (frost, holy, coliseum, plague, sentenced) a bare accent has almost no contrast with the ground: the worst direct case is 1.01:1 (frost accent on snow). The palette therefore requires every faction mark (ring, mantle, pip, name) to be drawn with a 2 px outline ink, dark `#0D111B` on bright grounds. With the halo, all 240 faction/ground/vision combinations reach 3:1; without it, many do not. This is a rendering requirement, not an option. Character sprites are frozen; the rule applies to the faction overlays in `IDENTITY_KIT.md`, ground rings, name plates and minimap pips.

**Sentenced is muted by chroma, not by lightness.** Its 60/30/10 weighted chroma is 0.042 against 0.073 to 0.108 for the other four regions (ratio 0.58), while its base/secondary contrast (3.01) is the highest of the five regions and its accent/base contrast (2.45) is above the weakest other region (holy 2.13). Muted means "less colourful", and the check proves it is not "less readable".

**Plague and Holy greenery.** Plague's base is a moss-teal (hue 170) and its secondary a deep fern green (150): the ground and the structures are both green; only the 10% accent is the toxic lime glow. Holy's base is sand (hue 85, bright) and its 30% secondary is lush oasis green (hue 135), so garden pockets are a full structural colour and not a decoration. Its accent is a deeper gold chosen darker than the sand so that gilded trim is visible on it (a lighter gold cannot reach 1.8:1 against L 0.80 sand).

**Lighting.** Warm key against cooler or violet shadow tints in the bright regions (frost shadow is violet-blue 275, holy shadow a plum 320, coliseum shadow a slate 280), which gives the Zelda-like coloured shadows while keeping shadows dark enough that nothing in sight disappears. Fire's key is orange (62) with a crimson shadow (12). Sentenced has a low-chroma amber key (72, C 0.07) for the harvest dusk and a lavender shadow, with a pale straw haze. Suggested use in URP 2D (to be tuned in engine, not verified): ambient -> global Light2D colour; key -> a large soft Light2D or the post-process highlights tint; shadow tint -> post-process shadows tint; fog/haze -> a screen-space or tilemap-overlay tint. The key and fog colours must never hide an in-sight actor (docs/VISUAL_DIRECTION.md); that is why shadow lightness bottoms out at 0.24 and fire is the only region below 0.4 on the ground.

**UI skin.** Same layout, same dark slate-blue panels as the legacy UI (hue 255, the legacy panel is 258), with a slightly more saturated surface and a warm cream text colour (hue 90) instead of cool grey-white, plus gold accent. A dark UI is kept because a bright world needs a high-contrast HUD; it is the one place the "bright" brief is not applied, and it matches "keep the legacy layout and information hierarchy". The border is brighter than the legacy line (L 0.60 against 0.45) so that panel and control edges reach the 3:1 UI-component ratio against the bright world.

## 4. Faction identity beyond hue

| Faction | Accent (hex) | Silhouette / shape cue | Weapon icon | ASCII mark | Legacy colour |
|---|---|---|---|---|---|
| Fire | `#FE825C` | Triangle with a pointed flame; split shoulders, twin horns | axe | `[F]` | `#FF7043` |
| Sentenced | `#A183D4` | Diamond with paired chain loops; faceted mantle | sword | `[S]` | `#9575CD` |
| Plague | `#9DDA4F` | Three linked lobes; ragged cowl with spores | bow | `[P]` | `#9CCC65` |
| Frost | `#A3E2FF` | Six-spoke crystal; angular plates, three-point crown | shield | `[I]` | `#4FC3F7` |
| Holy | `#FFF5A5` | Ring with cross and four diagonal rays; halo arch | wand | `[H]` | `#FFF176` |

Shapes follow `docs/art/IDENTITY_KIT.md`; icons follow `docs/art/SHOWCASE_ICON_ART.md` (weapon-to-faction mapping from `docs/prompts/UNITY_REWORK_FABLE.md` section 3). The accents sit on a lightness ladder (sentenced 0.67, fire 0.74, plague 0.82, frost 0.88, holy 0.96) so adjacent steps differ by at least 0.06 in OKLab lightness; that is what keeps pairs that collapse in hue under dichromacy (fire, plague, holy; sentenced, frost) apart. Cost: Frost is a pale ice-cyan (chroma 0.075, the most the sRGB gamut allows at that lightness), noticeably less saturated than the legacy `#4FC3F7`; Frost's identity relies more than the others on its crystal shape and its 6-spoke icon.

## 5. Results at a glance

Run on the committed `palette.json`: **396 checks, 396 pass, 0 accepted exceptions, 0 fail.** Breakdown from the output below:

| Check | Result |
|---|---|
| 1 Gamut, 58 authored colours (60/30/10, lighting, UI, faction, inks) | 58 of 58 in gamut |
| 2 Descent from legacy, 29 colour references | all within 30 degrees (largest shift 26 degrees, plague secondary) |
| 3 Region roles and lighting order (6 regions) | 6 of 6 pass |
| 4 Region separation by lightness or chroma (15 pairs) | 15 of 15 pass |
| 5 Sentenced muted but readable | chroma ratio 0.58 (limit 0.6); contrast kept |
| 6 UI text/component contrast (30 pairs) and panel-over-world (6 grounds) | all pass; lowest body-text pair 4.64:1 (Sentenced label on raised), lowest panel-over-world 4.83:1, border 3.70:1 on raised |
| 7 Faction accent distance, 10 pairs, normal + 3 CVD + grayscale | 10 of 10 pass; tightest margins: fire/plague under deuteranopia dE 0.075 (limit 0.07) and plague/frost in grayscale dE 0.053 (limit 0.05) |
| 8 Faction accent on 12 grounds, 4 vision modes (240 combinations) | 240 of 240 pass, using the outline halo where noted |

Honest caveats on what "pass" means:

- Several region pairs are close in luminance contrast (sentenced/plague 1.21, frost/holy 1.32, holy/coliseum 1.32, sentenced/coliseum 1.36). They pass because chroma or lightness in OKLab differs by the stated minimum, not because they are dramatically different in grayscale. Regions are spatially separate zones around the coliseum, so they rarely touch, but the minimap and any transition ground should add a non-colour cue.
- Check 8 passes only with the outline halo. Directly, accent against ground is as low as 1.01:1.
- Thresholds for CVD distance, region separation and the 60/30/10 role ratios are project choices (see `thresholds` in `palette.json`); only the 4.5:1 and 3:1 values come from WCAG.
- The CVD model is a population model of full dichromacy, not a clinical test; real anomalous trichromacy varies. These checks flag hue-only collisions in flat colours and cannot establish that a rendered scene, with lighting, bloom and particles, is accessible. Review rendered frames at gameplay scale and re-run the existing `docs/art/COLOR_REVIEW.md` captures after the new palette is wired in.
- Lighting colours (key, ambient, shadow, fog) are gamut- and order-checked only. How they combine with the sprites in URP is untested.

## 6. Unity token values (applied)

Applied to the in-match HUD and the planning screen: `UiTheme.Skin()` reads `Assets/Scripts/UI/UiPaletteTokens.cs`, which `node tools/art/gen-ui-theme.cjs` generates from `palette.json` (`--check` fails on drift and on any text role under 4.5:1; the derived tokens, namely sunken/hover/selected/disabled surfaces, strong border, accent-dim, info, the eight build-stat tints and the scrim, follow fixed OKLCH rules in that script). `ShowcasePalette` forwards to the theme. The values are:

| Token | New hex | OKLCH |
|---|---|---|
| Panel / surface | `#141B25` | 0.22 0.022 255 |
| PanelRaised | `#202A36` | 0.28 0.026 255 |
| PanelStroke / border | `#728295` | 0.60 0.035 255 |
| Text | `#F2EEE3` | 0.95 0.015 90 |
| MutedText | `#B2BFCE` | 0.80 0.025 250 |
| Gold / accent | `#F4D576` | 0.88 0.120 92 |
| Success | `#89DA9B` | 0.82 0.120 150 |
| Warning | `#F8C384` | 0.85 0.100 70 |
| Danger (new) | `#F68482` | 0.74 0.140 22 |
| Faction Fire, Sentenced, Plague, Frost, Holy | `#FE825C`, `#A183D4`, `#9DDA4F`, `#A3E2FF`, `#FFF5A5` | see output |
| Outline ink dark / light | `#0D111B` / `#F9F5EA` | 0.18 0.020 265 / 0.97 0.015 90 |

Region swatch and lighting hex values are in check 3 of the output. After changing any value in `palette.json`, re-run the script, paste the new tables here, and treat a non-zero exit code as a failed check (an intentional exception must be listed under `accepted` in `palette.json` with a reason).

## 7. Check output

Command: `node tools/art/palette-check.cjs --palette-only` (exit code 0). Verbatim, headings demoted one level.

#### Output
Colours are authored as OKLCH [L, C, h]; hex is the 8-bit sRGB the client uses. Contrast uses WCAG 2.x relative luminance.

### 1. Gamut (every authored colour must be inside sRGB without clipping)
| Colour | OKLCH (L C h) | Hex | In gamut | Max C at this L,h |
|---|---|---|---|---|
| fire.base | 0.38 0.085 38 | #68301E | yes | 0.128 |
| fire.secondary | 0.28 0.060 320 | #361E3B | yes | 0.139 |
| fire.accent | 0.74 0.178 55 | #FD8616 | yes | 0.182 |
| fire.key | 0.86 0.095 62 | #FFC390 | yes | 0.096 |
| fire.ambient | 0.50 0.070 32 | #87544A | yes | 0.192 |
| fire.shadow | 0.24 0.080 12 | #3D0815 | yes | 0.102 |
| fire.fog | 0.52 0.090 45 | #93573B | yes | 0.150 |
| sentenced.base | 0.64 0.030 85 | #958B78 | yes | 0.132 |
| sentenced.secondary | 0.38 0.035 60 | #503E2F | yes | 0.091 |
| sentenced.accent | 0.44 0.140 300 | #603B93 | yes | 0.237 |
| sentenced.key | 0.84 0.070 72 | #E7C499 | yes | 0.131 |
| sentenced.ambient | 0.55 0.035 290 | #716E85 | yes | 0.270 |
| sentenced.shadow | 0.32 0.050 305 | #392C47 | yes | 0.170 |
| sentenced.fog | 0.70 0.030 80 | #A89D8A | yes | 0.146 |
| plague.base | 0.58 0.085 170 | #3E8B73 | yes | 0.115 |
| plague.secondary | 0.36 0.090 150 | #0D4A22 | yes | 0.101 |
| plague.accent | 0.86 0.200 128 | #ABE841 | yes | 0.225 |
| plague.key | 0.90 0.100 150 | #AEF1BB | yes | 0.182 |
| plague.ambient | 0.55 0.070 185 | #3B7F77 | yes | 0.098 |
| plague.shadow | 0.28 0.050 215 | #002F38 | yes | 0.052 |
| plague.fog | 0.66 0.070 170 | #65A08C | yes | 0.131 |
| frost.base | 0.88 0.050 232 | #B7DEF3 | yes | 0.072 |
| frost.secondary | 0.66 0.100 240 | #549AC9 | yes | 0.152 |
| frost.accent | 0.62 0.128 235 | #1191C8 | yes | 0.132 |
| frost.key | 0.97 0.015 230 | #EBF7FD | yes | 0.018 |
| frost.ambient | 0.78 0.050 245 | #9DBBD6 | yes | 0.120 |
| frost.shadow | 0.52 0.100 275 | #5863A2 | yes | 0.271 |
| frost.fog | 0.92 0.025 235 | #D5E8F3 | yes | 0.046 |
| holy.base | 0.80 0.095 85 | #DAB975 | yes | 0.164 |
| holy.secondary | 0.58 0.130 135 | #578B35 | yes | 0.171 |
| holy.accent | 0.60 0.120 80 | #A57710 | yes | 0.125 |
| holy.key | 0.93 0.088 90 | #FFE6A4 | yes | 0.090 |
| holy.ambient | 0.74 0.070 95 | #B8AB78 | yes | 0.152 |
| holy.shadow | 0.52 0.090 320 | #805789 | yes | 0.251 |
| holy.fog | 0.86 0.050 85 | #E0CFAC | yes | 0.154 |
| coliseum.base | 0.72 0.025 75 | #AEA394 | yes | 0.152 |
| coliseum.secondary | 0.36 0.030 60 | #493A2D | yes | 0.087 |
| coliseum.accent | 0.46 0.130 10 | #913147 | yes | 0.186 |
| coliseum.key | 0.95 0.050 85 | #FEEDC9 | yes | 0.053 |
| coliseum.ambient | 0.70 0.030 80 | #A89D8A | yes | 0.146 |
| coliseum.shadow | 0.45 0.050 280 | #505271 | yes | 0.274 |
| coliseum.fog | 0.82 0.025 80 | #CDC3B2 | yes | 0.170 |
| ui.surface | 0.22 0.022 255 | #141B25 | yes | 0.082 |
| ui.raised | 0.28 0.026 255 | #202A36 | yes | 0.098 |
| ui.border | 0.60 0.035 255 | #728295 | yes | 0.199 |
| ui.textPrimary | 0.95 0.015 90 | #F2EEE3 | yes | 0.064 |
| ui.textSecondary | 0.80 0.025 250 | #B2BFCE | yes | 0.105 |
| ui.accent | 0.88 0.120 92 | #F4D576 | yes | 0.168 |
| ui.danger | 0.74 0.140 22 | #F68482 | yes | 0.159 |
| ui.success | 0.82 0.120 150 | #89DA9B | yes | 0.226 |
| ui.warning | 0.85 0.100 70 | #F8C384 | yes | 0.118 |
| faction.fire | 0.74 0.160 38 | #FE825C | yes | 0.163 |
| faction.sentenced | 0.67 0.120 300 | #A183D4 | yes | 0.207 |
| faction.plague | 0.82 0.180 130 | #9DDA4F | yes | 0.221 |
| faction.frost | 0.88 0.075 228 | #A3E2FF | yes | 0.076 |
| faction.holy | 0.96 0.100 102 | #FFF5A5 | yes | 0.102 |
| ink.dark | 0.18 0.020 265 | #0D111B | yes | 0.132 |
| ink.light | 0.97 0.015 90 | #F9F5EA | yes | 0.038 |

Gamut: 58 of 58 in gamut.

### 2. Descent from the legacy theme (hue shift of chromatic references must stay within the limit)
Limit: hue shift <= 30 deg where the legacy colour has OKLCH chroma >= 0.04.
| New colour | New OKLCH | Legacy | Legacy OKLCH | dh (deg) | dL | dC | Result |
|---|---|---|---|---|---|---|---|
| fire.base | 0.38 0.085 38 | #2D2622 | 0.28 0.013 52 | n/a (near neutral) | 0.10 | 0.072 | pass |
| fire.secondary | 0.28 0.060 320 | #5B4A66 | 0.44 0.050 312 | 8 | -0.16 | 0.010 | pass |
| fire.accent | 0.74 0.178 55 | #FF6A1A | 0.70 0.199 43 | 12 | 0.04 | -0.021 | pass |
| sentenced.base | 0.64 0.030 85 | #3A3B42 | 0.35 0.012 279 | n/a (near neutral) | 0.29 | 0.018 | pass |
| sentenced.secondary | 0.38 0.035 60 | #6E553A | 0.47 0.052 68 | n/a (near neutral) | -0.09 | -0.017 | pass |
| sentenced.accent | 0.44 0.140 300 | #7E57C2 | 0.55 0.162 298 | 2 | -0.11 | -0.022 | pass |
| plague.base | 0.58 0.085 170 | #2A3326 | 0.31 0.026 136 | n/a (near neutral) | 0.27 | 0.059 | pass |
| plague.secondary | 0.36 0.090 150 | #6D7F4A | 0.57 0.079 124 | 26 | -0.21 | 0.011 | pass |
| plague.accent | 0.86 0.200 128 | #B5E35A | 0.86 0.172 126 | 2 | 0.00 | 0.028 | pass |
| frost.base | 0.88 0.050 232 | #E3ECF2 | 0.94 0.013 237 | n/a (near neutral) | -0.06 | 0.037 | pass |
| frost.secondary | 0.66 0.100 240 | #6F9FBD | 0.68 0.068 237 | 3 | -0.02 | 0.032 | pass |
| frost.accent | 0.62 0.128 235 | #4AA3DF | 0.69 0.123 241 | 6 | -0.07 | 0.005 | pass |
| holy.base | 0.80 0.095 85 | #E9DFC0 | 0.90 0.042 92 | 7 | -0.10 | 0.053 | pass |
| holy.accent | 0.60 0.120 80 | #D4AF37 | 0.77 0.139 91 | 11 | -0.17 | -0.019 | pass |
| coliseum.base | 0.72 0.025 75 | #4D4D4A | 0.42 0.005 107 | n/a (near neutral) | 0.30 | 0.020 | pass |
| faction.fire | 0.74 0.160 38 | #FF7043 | 0.71 0.185 38 | 0 | 0.03 | -0.025 | pass |
| faction.sentenced | 0.67 0.120 300 | #9575CD | 0.63 0.132 299 | 1 | 0.04 | -0.012 | pass |
| faction.plague | 0.82 0.180 130 | #9CCC65 | 0.79 0.143 130 | 0 | 0.03 | 0.037 | pass |
| faction.frost | 0.88 0.075 228 | #4FC3F7 | 0.77 0.127 231 | 3 | 0.11 | -0.052 | pass |
| faction.holy | 0.96 0.100 102 | #FFF176 | 0.95 0.144 103 | 1 | 0.01 | -0.044 | pass |
| ui.surface | 0.22 0.022 255 | #14181E | 0.21 0.013 258 | n/a (near neutral) | 0.01 | 0.009 | pass |
| ui.raised | 0.28 0.026 255 | #1B2128 | 0.24 0.016 252 | n/a (near neutral) | 0.04 | 0.010 | pass |
| ui.border | 0.60 0.035 255 | #4A5563 | 0.45 0.027 255 | n/a (near neutral) | 0.15 | 0.008 | pass |
| ui.textPrimary | 0.95 0.015 90 | #E6E9ED | 0.93 0.006 255 | n/a (near neutral) | 0.02 | 0.009 | pass |
| ui.textSecondary | 0.80 0.025 250 | #AEB7C2 | 0.78 0.019 253 | n/a (near neutral) | 0.02 | 0.006 | pass |
| ui.accent | 0.88 0.120 92 | #FFE082 | 0.91 0.119 92 | 0 | -0.03 | 0.001 | pass |
| ui.danger | 0.74 0.140 22 | #EF9A9A | 0.77 0.102 20 | 2 | -0.03 | 0.038 | pass |
| ui.success | 0.82 0.120 150 | #A5D6A7 | 0.83 0.083 146 | 4 | -0.01 | 0.037 | pass |
| ui.warning | 0.85 0.100 70 | #FFCC80 | 0.87 0.110 76 | 6 | -0.02 | -0.010 | pass |

### 3. Region palettes (60 base / 30 secondary / 10 accent) and lighting
| Region | Base 60% | Secondary 30% | Accent 10% | Key light | Ambient | Shadow tint | Fog/haze |
|---|---|---|---|---|---|---|---|
| fire | #68301E (0.38 0.085 38) | #361E3B (0.28 0.060 320) | #FD8616 (0.74 0.178 55) | #FFC390 (0.86 0.095 62) | #87544A (0.50 0.070 32) | #3D0815 (0.24 0.080 12) | #93573B (0.52 0.090 45) |
| sentenced | #958B78 (0.64 0.030 85) | #503E2F (0.38 0.035 60) | #603B93 (0.44 0.140 300) | #E7C499 (0.84 0.070 72) | #716E85 (0.55 0.035 290) | #392C47 (0.32 0.050 305) | #A89D8A (0.70 0.030 80) |
| plague | #3E8B73 (0.58 0.085 170) | #0D4A22 (0.36 0.090 150) | #ABE841 (0.86 0.200 128) | #AEF1BB (0.90 0.100 150) | #3B7F77 (0.55 0.070 185) | #002F38 (0.28 0.050 215) | #65A08C (0.66 0.070 170) |
| frost | #B7DEF3 (0.88 0.050 232) | #549AC9 (0.66 0.100 240) | #1191C8 (0.62 0.128 235) | #EBF7FD (0.97 0.015 230) | #9DBBD6 (0.78 0.050 245) | #5863A2 (0.52 0.100 275) | #D5E8F3 (0.92 0.025 235) |
| holy | #DAB975 (0.80 0.095 85) | #578B35 (0.58 0.130 135) | #A57710 (0.60 0.120 80) | #FFE6A4 (0.93 0.088 90) | #B8AB78 (0.74 0.070 95) | #805789 (0.52 0.090 320) | #E0CFAC (0.86 0.050 85) |
| coliseum | #AEA394 (0.72 0.025 75) | #493A2D (0.36 0.030 60) | #913147 (0.46 0.130 10) | #FEEDC9 (0.95 0.050 85) | #A89D8A (0.70 0.030 80) | #505271 (0.45 0.050 280) | #CDC3B2 (0.82 0.025 80) |

Role separation and lighting order (L = OKLab lightness, contrast = WCAG ratio):
| Region | contrast base/secondary (>= 1.3) | contrast accent/base (>= 1.8) | key L > ambient L > shadow L | Result |
|---|---|---|---|---|
| fire | 1.44 | 4.24 | yes (0.86 > 0.50 > 0.24) | pass |
| sentenced | 3.01 | 2.45 | yes (0.84 > 0.55 > 0.32) | pass |
| plague | 2.55 | 2.79 | yes (0.90 > 0.55 > 0.28) | pass |
| frost | 2.16 | 2.50 | yes (0.97 > 0.78 > 0.52) | pass |
| holy | 2.17 | 2.13 | yes (0.93 > 0.74 > 0.52) | pass |
| coliseum | 4.39 | 3.10 | yes (0.95 > 0.70 > 0.45) | pass |

### 4. Regions are distinguishable by lightness or chroma, not only hue
A pair of region base colours fails if dL < 0.06 AND dC < 0.04 (i.e. they would differ by hue alone). The Contrast column is the WCAG ratio of the two bases (what a grayscale view would show).
| Pair | dL | dC | dh (deg) | OKLab dE | Contrast | Result |
|---|---|---|---|---|---|---|
| fire / sentenced | 0.26 | 0.055 | 47 | 0.268 | 3.07 | pass |
| fire / plague | 0.20 | 0.000 | 132 | 0.254 | 2.53 | pass |
| fire / frost | 0.50 | 0.035 | 166 | 0.516 | 7.27 | pass |
| fire / holy | 0.42 | 0.010 | 47 | 0.425 | 5.51 | pass |
| fire / coliseum | 0.34 | 0.060 | 37 | 0.346 | 4.17 | pass |
| sentenced / plague | 0.06 | 0.055 | 85 | 0.107 | 1.21 | pass |
| sentenced / frost | 0.24 | 0.020 | 147 | 0.251 | 2.36 | pass |
| sentenced / holy | 0.16 | 0.065 | 0 | 0.172 | 1.79 | pass |
| sentenced / coliseum | 0.08 | 0.005 | 10 | 0.081 | 1.36 | pass |
| plague / frost | 0.30 | 0.035 | 62 | 0.308 | 2.87 | pass |
| plague / holy | 0.22 | 0.010 | 85 | 0.251 | 2.17 | pass |
| plague / coliseum | 0.14 | 0.060 | 95 | 0.166 | 1.65 | pass |
| frost / holy | 0.08 | 0.045 | 147 | 0.161 | 1.32 | pass |
| frost / coliseum | 0.16 | 0.025 | 157 | 0.175 | 1.74 | pass |
| holy / coliseum | 0.08 | 0.070 | 10 | 0.106 | 1.32 | pass |

### 5. Sentenced is deliberately muted: lower chroma, preserved lightness contrast
Chroma = 0.6 base + 0.3 secondary + 0.1 accent (the 60/30/10 weighted mean OKLCH chroma). Lightness contrast = WCAG ratio base/secondary and accent/base.
| Region | Weighted chroma | Base/secondary | Accent/base | Faction accent on base |
|---|---|---|---|---|
| fire | 0.087 | 1.44 | 4.24 | 4.22 |
| sentenced | 0.042 | 3.01 | 2.45 | 1.08 |
| plague | 0.098 | 2.55 | 2.79 | 2.44 |
| frost | 0.073 | 2.16 | 2.50 | 1.01 |
| holy | 0.108 | 2.17 | 2.13 | 1.69 |
| coliseum | 0.037 | 4.39 | 3.10 | n/a |

Muted-zone claim (sentenced): weighted chroma 0.042 vs lowest other 0.073 (must be <= 0.6 x that): pass.
Lightness contrast kept (>= 0.85 x the weakest other region on both ratios): pass.

### 6. UI text and component contrast (WCAG 2.x)
Required: body text 4.5:1, large text 3:1, UI component / graphical object 3:1.
| Foreground | Background | Kind | Ratio | Required | Result |
|---|---|---|---|---|---|
| ui.textPrimary (#F2EEE3) | ui.surface (#141B25) | body | 14.93 | 4.5 | pass |
| ui.textPrimary (#F2EEE3) | ui.raised (#202A36) | body | 12.53 | 4.5 | pass |
| ui.textSecondary (#B2BFCE) | ui.surface (#141B25) | body | 9.26 | 4.5 | pass |
| ui.textSecondary (#B2BFCE) | ui.raised (#202A36) | body | 7.77 | 4.5 | pass |
| ui.accent (#F4D576) | ui.surface (#141B25) | body | 12.06 | 4.5 | pass |
| ui.accent (#F4D576) | ui.raised (#202A36) | body | 10.12 | 4.5 | pass |
| ui.danger (#F68482) | ui.surface (#141B25) | body | 7.04 | 4.5 | pass |
| ui.danger (#F68482) | ui.raised (#202A36) | body | 5.91 | 4.5 | pass |
| ui.success (#89DA9B) | ui.surface (#141B25) | body | 10.36 | 4.5 | pass |
| ui.success (#89DA9B) | ui.raised (#202A36) | body | 8.69 | 4.5 | pass |
| ui.warning (#F8C384) | ui.surface (#141B25) | body | 10.82 | 4.5 | pass |
| ui.warning (#F8C384) | ui.raised (#202A36) | body | 9.08 | 4.5 | pass |
| ui.border (#728295) | ui.surface (#141B25) | ui | 4.40 | 3 | pass |
| ui.border (#728295) | ui.raised (#202A36) | ui | 3.70 | 3 | pass |
| ui.surface (#141B25) | ui.accent (#F4D576) | body | 12.06 | 4.5 | pass |
| faction.fire (#FE825C) | ui.surface (#141B25) | body | 7.06 | 4.5 | pass |
| faction.sentenced (#A183D4) | ui.surface (#141B25) | body | 5.53 | 4.5 | pass |
| faction.plague (#9DDA4F) | ui.surface (#141B25) | body | 10.36 | 4.5 | pass |
| faction.frost (#A3E2FF) | ui.surface (#141B25) | body | 12.26 | 4.5 | pass |
| faction.holy (#FFF5A5) | ui.surface (#141B25) | body | 15.54 | 4.5 | pass |
| faction.fire (#FE825C) | ui.raised (#202A36) | body | 5.92 | 4.5 | pass |
| faction.sentenced (#A183D4) | ui.raised (#202A36) | body | 4.64 | 4.5 | pass |
| faction.plague (#9DDA4F) | ui.raised (#202A36) | body | 8.70 | 4.5 | pass |
| faction.frost (#A3E2FF) | ui.raised (#202A36) | body | 10.29 | 4.5 | pass |
| faction.holy (#FFF5A5) | ui.raised (#202A36) | body | 13.04 | 4.5 | pass |
| ui.surface (#141B25) | faction.fire (#FE825C) | body | 7.06 | 4.5 | pass |
| ui.surface (#141B25) | faction.sentenced (#A183D4) | body | 5.53 | 4.5 | pass |
| ui.surface (#141B25) | faction.plague (#9DDA4F) | body | 10.36 | 4.5 | pass |
| ui.surface (#141B25) | faction.frost (#A3E2FF) | body | 12.26 | 4.5 | pass |
| ui.surface (#141B25) | faction.holy (#FFF5A5) | body | 15.54 | 4.5 | pass |

Panel text over the world: the HUD panel is drawn at alpha 0.94, so the world shows through. Worst case is the brightest ground under the panel; text is checked on the composite (sRGB-space blend, as the GPU does).
| Ground | Panel composite | Primary text | Secondary text | Faction labels (min) | Result |
|---|---|---|---|---|---|
| fire | #191C25 | 14.68 | 9.10 | 5.44 | pass |
| sentenced | #1C222A | 13.81 | 8.57 | 5.12 | pass |
| plague | #17222A | 13.95 | 8.65 | 5.17 | pass |
| frost | #1E2731 | 13.03 | 8.09 | 4.83 | pass |
| holy | #20242A | 13.45 | 8.34 | 4.98 | pass |
| coliseum | #1D232C | 13.63 | 8.45 | 5.05 | pass |

### 7. Faction accents: pairwise distance under colour-vision-deficiency simulation
Distance is Euclidean in OKLab (about 0.02 is a just-noticeable difference). Each pair must reach dE >= 0.07 in every simulated mode. Identity is carried by shape and icon first, hue second.
| Faction | Hex | Shape / silhouette cue | Icon / weapon | Text mark |
|---|---|---|---|---|
| fire | #FE825C | Triangle with a pointed flame; split shoulders, twin horns | axe | [F] |
| sentenced | #A183D4 | Diamond with paired chain loops; faceted mantle | sword | [S] |
| plague | #9DDA4F | Three linked lobes; ragged cowl with spores | bow | [P] |
| frost | #A3E2FF | Six-spoke crystal; angular plates, three-point crown | shield | [I] |
| holy | #FFF5A5 | Ring with cross and four diagonal rays; halo arch | wand | [H] |

The grayscale column (achromatopsia, lightness only) is held to the lower bar dE >= 0.05.
| Pair | normal | protanopia | deuteranopia | tritanopia | grayscale | Min over CVD | Result |
|---|---|---|---|---|---|---|---|
| fire / sentenced | 0.224 | 0.193 | 0.230 | 0.180 | 0.062 | 0.180 | pass |
| fire / plague | 0.258 | 0.186 | 0.075 | 0.255 | 0.111 | 0.075 | pass |
| fire / frost | 0.273 | 0.269 | 0.208 | 0.322 | 0.163 | 0.208 | pass |
| fire / holy | 0.265 | 0.282 | 0.207 | 0.287 | 0.242 | 0.207 | pass |
| sentenced / plague | 0.335 | 0.319 | 0.284 | 0.175 | 0.173 | 0.175 | pass |
| sentenced / frost | 0.243 | 0.253 | 0.216 | 0.238 | 0.225 | 0.216 | pass |
| sentenced / holy | 0.363 | 0.358 | 0.359 | 0.290 | 0.304 | 0.290 | pass |
| plague / frost | 0.214 | 0.211 | 0.198 | 0.078 | 0.053 | 0.078 | pass |
| plague / holy | 0.174 | 0.122 | 0.140 | 0.151 | 0.131 | 0.122 | pass |
| frost / holy | 0.176 | 0.154 | 0.181 | 0.142 | 0.079 | 0.142 | pass |

Simulated accent colours (hex) and OKLab lightness, per mode:
| Faction | normal | protanopia | deuteranopia | tritanopia |
|---|---|---|---|---|
| fire | #FE825C L0.74 | #A39558 L0.67 | #C1B05A L0.75 | #FF6B79 L0.71 |
| sentenced | #A183D4 L0.67 | #6F91D7 L0.66 | #7491D2 L0.66 | #9890A1 L0.67 |
| plague | #9DDA4F L0.82 | #E4CB3D L0.84 | #DBC75A L0.83 | #A1D1BD L0.82 |
| frost | #A3E2FF L0.88 | #D3DFFF L0.90 | #C5D4FF L0.87 | #82EBEB L0.88 |
| holy | #FFF5A5 L0.96 | #FFF09F L0.95 | #FFF5A8 L0.96 | #FFEBE1 L0.95 |

### 8. A faction-accented character must stay readable on every region ground
A marker (ring/mantle/pip) is readable on a ground if EITHER its fill reaches 3:1 against the ground directly (route "D"), OR it is drawn with the 2 px outline ink (dark #0D111B or light #F9F5EA) and both ink/ground and ink/accent reach 3:1 (route "H", halo). The table shows the best achievable ratio; the route in brackets. Evaluated on the normal and the three simulated views, for the 60% base and the 30% secondary of each ground.

normal:
| Faction | fire base | fire secondary | sentenced base | sentenced secondary | plague base | plague secondary | frost base | frost secondary | holy base | holy secondary | coliseum base | coliseum secondary |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fire | 4.2 [D] | 6.1 [D] | 5.6 [H] | 4.1 [D] | 4.6 [H] | 4.2 [D] | 7.7 [H] | 6.1 [H] | 7.7 [H] | 4.6 [H] | 7.6 [H] | 4.4 [D] |
| sentenced | 3.3 [D] | 4.8 [D] | 5.6 [H] | 3.2 [D] | 4.6 [H] | 3.3 [D] | 6.0 [H] | 6.0 [H] | 6.0 [H] | 4.6 [H] | 6.0 [H] | 3.5 [D] |
| plague | 6.2 [D] | 8.9 [D] | 5.6 [H] | 6.1 [D] | 4.6 [H] | 6.2 [D] | 11.3 [H] | 6.1 [H] | 10.0 [H] | 4.6 [H] | 7.6 [H] | 6.5 [D] |
| frost | 7.3 [D] | 10.6 [D] | 5.6 [H] | 7.2 [D] | 4.6 [H] | 7.4 [D] | 13.3 [H] | 6.1 [H] | 10.0 [H] | 4.6 [H] | 7.6 [H] | 7.7 [D] |
| holy | 9.3 [D] | 13.4 [D] | 5.6 [H] | 9.1 [D] | 4.6 [H] | 9.3 [D] | 13.3 [H] | 6.1 [H] | 10.0 [H] | 4.6 [H] | 7.6 [H] | 9.8 [D] |

protanopia:
| Faction | fire base | fire secondary | sentenced base | sentenced secondary | plague base | plague secondary | frost base | frost secondary | holy base | holy secondary | coliseum base | coliseum secondary |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fire | 3.9 [D] | 5.1 [D] | 5.5 [H] | 3.5 [D] | 5.0 [H] | 3.3 [D] | 6.3 [H] | 6.3 [H] | 6.3 [H] | 4.8 [H] | 6.3 [H] | 3.7 [D] |
| sentenced | 3.7 [D] | 4.9 [D] | 5.5 [H] | 3.4 [D] | 5.0 [H] | 3.2 [D] | 6.0 [H] | 6.0 [H] | 6.0 [H] | 4.8 [H] | 6.0 [H] | 3.6 [D] |
| plague | 7.1 [D] | 9.4 [D] | 5.5 [H] | 6.5 [D] | 5.0 [H] | 6.1 [D] | 11.6 [H] | 6.7 [H] | 9.5 [H] | 4.8 [H] | 7.5 [H] | 6.9 [D] |
| frost | 8.7 [D] | 11.5 [D] | 5.5 [H] | 7.9 [D] | 5.0 [H] | 7.5 [D] | 13.8 [H] | 6.7 [H] | 9.5 [H] | 4.8 [H] | 7.5 [H] | 8.4 [D] |
| holy | 10.0 [D] | 13.3 [D] | 5.5 [H] | 9.1 [D] | 5.0 [H] | 8.6 [D] | 13.8 [H] | 6.7 [H] | 9.5 [H] | 4.8 [H] | 7.5 [H] | 9.7 [D] |

deuteranopia:
| Faction | fire base | fire secondary | sentenced base | sentenced secondary | plague base | plague secondary | frost base | frost secondary | holy base | holy secondary | coliseum base | coliseum secondary |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fire | 4.4 [D] | 6.7 [D] | 5.7 [H] | 4.5 [D] | 4.4 [H] | 4.9 [D] | 8.6 [H] | 5.8 [H] | 8.6 [H] | 4.5 [H] | 7.7 [H] | 4.9 [D] |
| sentenced | 3.1 [D] | 4.7 [D] | 5.7 [H] | 3.2 [D] | 4.4 [H] | 3.4 [D] | 6.0 [H] | 5.8 [H] | 6.0 [H] | 4.5 [H] | 6.0 [H] | 3.4 [D] |
| plague | 5.6 [D] | 8.6 [D] | 5.7 [H] | 5.8 [D] | 4.4 [H] | 6.3 [D] | 11.1 [H] | 5.8 [H] | 10.4 [H] | 4.5 [H] | 7.7 [H] | 6.3 [D] |
| frost | 6.5 [D] | 10.0 [D] | 5.7 [H] | 6.7 [D] | 4.4 [H] | 7.3 [D] | 12.8 [H] | 5.8 [H] | 10.4 [H] | 4.5 [H] | 7.7 [H] | 7.3 [D] |
| holy | 8.6 [D] | 13.2 [D] | 5.7 [H] | 8.9 [D] | 4.4 [H] | 9.7 [D] | 12.9 [H] | 5.8 [H] | 10.4 [H] | 4.5 [H] | 7.7 [H] | 9.6 [D] |

tritanopia:
| Faction | fire base | fire secondary | sentenced base | sentenced secondary | plague base | plague secondary | frost base | frost secondary | holy base | holy secondary | coliseum base | coliseum secondary |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fire | 3.8 [D] | 5.4 [D] | 5.6 [H] | 3.7 [D] | 4.6 [H] | 3.8 [D] | 6.9 [H] | 6.3 [H] | 6.9 [H] | 4.6 [H] | 6.9 [H] | 4.0 [D] |
| sentenced | 3.4 [D] | 4.8 [D] | 5.6 [H] | 3.3 [D] | 4.6 [H] | 3.4 [D] | 6.1 [H] | 6.1 [H] | 6.1 [H] | 4.6 [H] | 6.1 [H] | 3.6 [D] |
| plague | 6.1 [D] | 8.7 [D] | 5.6 [H] | 6.0 [D] | 4.6 [H] | 6.1 [D] | 11.1 [H] | 6.3 [H] | 10.0 [H] | 4.6 [H] | 7.6 [H] | 6.4 [D] |
| frost | 7.5 [D] | 10.6 [D] | 5.6 [H] | 7.3 [D] | 4.6 [H] | 7.4 [D] | 13.3 [H] | 6.3 [H] | 10.0 [H] | 4.6 [H] | 7.6 [H] | 7.8 [D] |
| holy | 9.0 [D] | 12.9 [D] | 5.6 [H] | 8.9 [D] | 4.6 [H] | 9.0 [D] | 13.3 [H] | 6.3 [H] | 10.0 [H] | 4.6 [H] | 7.6 [H] | 9.5 [D] |

Actor-on-ground: 240 of 240 combinations pass.
Direct (no halo) readability, normal vision, minimum over all faction/ground pairs: 1.01:1 (frost@frost.base); this is why the outline halo is mandatory, not optional.

### Summary
Checks: 396 total, 396 pass, 0 accepted, 0 fail.


## 8. Legacy token preview (unchanged from before)

Run `node tools/art/palette-check.cjs` from the repository root. The script reads the five shipped faction `Color32` tokens from the `Faction` array in the generated `client-unity/UnityProject/Assets/Scripts/UI/UiPaletteTokens.cs` (`ShowcasePalette.cs` now only forwards to the UI theme); it fails if the expected five entries cannot be found. It prints grayscale and protanopia, deuteranopia, and tritanopia transforms, along with approximate CIELAB D65 lightness (L*) and chroma (C*ab). Pairwise ΔL* below 10 is flagged for visual review, not treated as a universal pass/fail threshold. The pre-existing UI contrast checks remain in `node tools/art/verify-presentation.cjs`.

The grayscale preview converts sRGB channel values to linear light, computes relative luminance with coefficients 0.2126/0.7152/0.0722, then encodes that luminance as neutral sRGB. CVD previews use the severity 1.0 dichromacy matrices associated with the physiologically based model by Machado, Oliveira, and Fernandes (2009), applied to linear RGB and clipped to displayable gamut. The model was experimentally evaluated and is a useful design aid; see the [authors' paper](https://profs.ic.uff.br/~laffernandes/content/publications/journal/2009_tvcg_15%286%29/machado_oliveira_fernandes-tvcg-15%286%29-2009-corrected.pdf) (DOI: 10.1109/TVCG.2009.113).

These are software previews of a population model, not a clinical test or a prediction of any one person's experience. Screens, rendering, ambient light, display gamut clipping, adaptation, anomalous trichromacy severity, and individual variation affect perception. The L*/C* figures summarize transformed flat token colors and do not model outlines, adjacent surfaces, shading, anti-aliasing, or the spatial size of an in-game mark. The checks therefore expose likely hue-only collisions, but cannot establish that a complete game scene is accessible.

Treat faction hue as a supporting cue. Keep faction names or ASCII-safe marks available and give faction actors visibly distinct silhouettes or insignia so identity remains readable when hues merge or color is unavailable. Re-run the command whenever palette tokens change, then review the actual rendered scene at gameplay scale.
