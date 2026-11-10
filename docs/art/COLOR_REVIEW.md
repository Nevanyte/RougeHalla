# Rendered color review

Open [color-review.html](color-review.html) locally to inspect the current **repaired staged showcase** (`evidence/repair/study.jpg`) and **live combat profile** (`evidence/repair/live.jpg`). Each is shown in original, grayscale, protanopia, deuteranopia, and tritanopia views. Use Fit for a page overview and 1:1 to inspect native image pixels, including insignias and labels. The HTML references the existing PNGs without modifying them and has no remote assets. Earlier evidence and its findings are retained below as a historical record.

## Method

The SVG `feColorMatrix` filters use `color-interpolation-filters="linearRGB"`, matching the linear-light basis used by `tools/art/palette-check.cjs`. The grayscale filter uses linear relative luminance coefficients 0.2126 / 0.7152 / 0.0722. The three CVD filters use the exact severity 1.0 dichromacy matrices in that checker. Their alpha output row is identity, so source alpha is preserved. These transforms are rendered previews; browser SVG filter implementations and display pipelines can still affect the final appearance.

The CVD matrices are associated with the physiologically based model described by Machado, Oliveira, and Fernandes, “A Physiologically-based Model for Simulation of Color Vision Deficiency,” *IEEE Transactions on Visualization and Computer Graphics* 15(6), 2009. [Paper (author-hosted PDF)](https://profs.ic.uff.br/~laffernandes/content/publications/journal/2009_tvcg_15%286%29/machado_oliveira_fernandes-tvcg-15%286%29-2009-corrected.pdf), DOI [10.1109/TVCG.2009.113](https://doi.org/10.1109/TVCG.2009.113). This is a population-model preview, not a clinical test or a prediction of an individual’s perception.

## Current repair review

**Status: BOUNDED REPAIR SAMPLE VISUAL CHECK SATISFIED, WITH LIMITATIONS. No game-wide accessibility pass is claimed.** The staged repair sample's non-hue marks and footprint geometry are visually distinguishable in this lineup. Coverage of all five factions in live play, crowded motion, and full telegraph readability remains OPEN.

The parent rendered the page in headless Chromium at DPR 1 and a 2560 × 1440 viewport. Fit plus ten native-scale captures were aligned to image origin (x=0, y=0) and visually reviewed. Runtime revision: `4f37e9f0`. Render log and captures: `/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/evidence/color-review-repair/` (`render-log.json`, `fit.jpg`, and ten per-variant PNGs). The staged image is 1280 × 900; the live profile is 2560 × 1440.

Current source capture dimensions and SHA-256 hashes:

| Capture | Native size | SHA-256 |
| --- | ---: | --- |
| Repaired staged showcase `evidence/repair/study.jpg` | 1280 × 900 | `be11b83b293fbc3e1ae9c5891ef550a279d610fabd021bb9a2e59bebd696d531` |
| Live combat profile `evidence/repair/live.jpg` | 2560 × 1440 | `e28deb66caa37d25ae52139baeeba0f121fbec26c701d95b19bc6b78e37382b5` |

Observed findings:

- All five staged faction sigils are readable against their solid backing. Triangle, square, trefoil, hexagon, and circle footprint geometry are distinguishable without hue in this lineup; marks remain clear of the actor body, health track, and signature.
- Hue collisions remain in protanopia and deuteranopia previews: Fire, Plague, and Holy appear in a yellow family; Sentenced and Frost appear blue. The repair does not establish palette separation under CVD simulation.
- In the live profile sample, Holy's circle/cross and Fire's triangle remain legible in all four transformed views. The Plague mark is visible just above the HUD, while its actor body is clipped by the HUD. This sample does not demonstrate all five factions in live combat.
- White HUD controls and text remain clear in the reviewed views.
- These are static samples. This review does not establish readability in crowded motion or across all combat telegraphs and animation states.

Remaining checks:

- [ ] Verify all five faction marks and silhouettes in live combat.
- [ ] Inspect full combat telegraphs and crowded motion states.
- [x] Visually inspect the repaired staged lineup's five non-hue marks at native scale across the five preview modes.

## Historical review of original captures

This earlier review is retained for traceability; its source screenshots were `evidence/art-study.jpg` and `evidence/live-combat.jpg`. It was rendered in headless Chromium at DPR 1 with a 2560 px viewport. The Fit view and ten native-scale filter captures (five views for each image) were visually inspected. Its render log is at `/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/evidence/color-review/render-log.json`.

Source capture dimensions and SHA-256 hashes:

| Capture | Native size | SHA-256 |
| --- | ---: | --- |
| Staged showcase `evidence/art-study.jpg` | 1280 × 900 | `24c545d9a37007daddbcf2c1110e419f8e25c82cb803d4931a75689e3df0c1b3` |
| Live combat `evidence/live-combat.jpg` | 2560 × 1440 | `bdfa1ffefa8580520a3ab1506727f928034d5fea06e254c5965cb008fb386720` |

Observed findings:

- Large HUD text, control shapes, health tracks, actors, and contact rings remain visible in all four transformed views.
- The staged screenshot labels all five identities. In protanopia and deuteranopia previews, Fire, Plague, and Holy shift into a gold/yellow family, while Sentenced and Frost remain pale blue. In grayscale, all five actor footprints read as similar ellipses; only two body designs are shown.
- The staged capture's small sigils above actors are approximately 8–12 px at native scale, too small for confident quick classification in this review.
- The live HUD remains clear, but the small player faction mark is difficult to infer without a legend. The live capture does not demonstrate all five factions.
- These captures are static samples. They do not establish readability of every combat telegraph, animation, or motion state.

Flat palette-token metrics in `PALETTE.md` are only a screening aid and do not establish scene accessibility. No accessibility pass or game-wide accessibility claim is made by either review.
