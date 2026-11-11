# Polish pass evidence (branch `rework/polish`)

Real WebGL build, headed Chromium (Apple M5 Pro, ANGLE Metal), 1920x1080, against `rh-server` seed1 (content hash `7d2d84b827af3ddc`, tree merged with `feature/unity-rework` at `e985f3d5`).
Spawn is random, so before/after use the same spawn tile where a ratio is quoted. Numbers are mean luma and the share of pixels above 0.9 luminance, whole frame with the HUD.

* `fog-<zone>.jpg`: fog of war before (left, Dim .62 / Lift .40) and after (right, Dim .70 / Lift .08 plus the grey/cool grade), debug ring `?vision.debugRadius=7` (fogs everything past 7 tiles; delivered actors keep a clearing).
  Unseen / lit linear luminance on open ground (same pixels, same spawn, ring versus ring pushed out of view): Sentenced 0.42 before, 0.29 after (second spawn 0.34); Plague 0.56 to 0.62 before, 0.32 to 0.39 after; chroma kept 0.8 to 0.9 before, 0.4 to 0.6 after.
  Frames behind walls or around fighters are already fogged or cleared in both captures and are not quoted. Temple and coliseum frames could not be paired (no open-ground window).
* `frost-before.jpg`: Frost spawn (119, 130) before: mean 0.65, 9.5% above 0.9. `frost-after.jpg`: same spawn after (sun .80, contrast 0, bloom .15): 1920x1080 Ultra mean 0.60, 0.90% above 0.9, High 0.66%; 2560x1440 Ultra 0.95%, High 0.98%. Holy sand (exposure -.1, contrast 2) 0.27% Ultra / 0.22% High (was 1.1 to 2.1%); temple floor (exposure -.1, contrast 0) 0.08% / 0.47% (was 2.1%).Frost still has the highest mean luma (0.60 vs Holy 0.49 to 0.52), as before (0.65 vs 0.51).
* `sentenced-corner-before-after.jpg`: bottom-left corner of the Sentenced spawn at tile (141.5, 83.5).
* `trader-giver-plates.jpg`, `gallery/`: trader figure (W8), quest giver label without the hp bar through it (W5), quest item token with its plate (W6), elite star plate (M4/M5).

Tools: `atmosphere-shots.cjs` gained live variants for `--temple` shots (`RH_SHOTS_VARIANTS`, needs `&perf=1`) and `RH_SHOTS_SETTLE_MS`; `ui-scenarios.cjs` gained `windupcrit`.
Diagnostics-only `atm.<zone>.<field>` flags (RegionAtmosphereTable.Overrides) re-tune a zone row live; they do nothing unless given.
