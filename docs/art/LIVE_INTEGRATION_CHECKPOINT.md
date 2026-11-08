# Presentation asset checkpoint — 2026-11-08

This is an isolated source and asset checkpoint on `codex/unity-presentation-integration`, based on `5769e273`. It is not a new Web build or performance acceptance. UI/HUD, Bootstrap, MatchClient, protocol, gameplay and shared migration status were not edited.

## Prepared and bound

- Twelve coherent Flare appearances, 3,008 persistent frame subassets, eight-direction authored coverage (the static knight intentionally has only idle). Five faction appearance mappings, backed faction/role/elite identities and an actor contrast rim. Thirty canonical mob type mappings use explicit creative art reuse; this is not thirty unique species artworks.
- Fixed the older 224px compositor clipping by reimporting the five base appearances from retained Raw files into a separate 388px-cell source catalog. Recovered 95,138 unique opaque source sites across frames, with a required two-pixel transparent clearance. Original Raw and legacy derived assets remain unchanged.
- Compact live catalog bound to Resources. Independent PNG comparison checked every one of 3,008 packed frames: no pixel changes, no dropped opaque input pixels, no resampling, pivot error below 0.00001px. Atlas area is 75,038,720 pixels versus 414,270,976 source pixels (81.887% reduction). These are source texture-area measurements, not measured runtime memory or FPS.
- Added 24 pinned, free Flare sound clips in 21 cue groups, provenance, exact credit ledger and importer. Catalog binds the audio library and cave wind ambience. New per-event sound mappings are pending; existing generic audio remains functional.
- Added original Unity-generated biome surface/normal art, four terrain emission-mask studies and an opt-in no-network environment study. These compile but await visual acceptance. Current protocol map facts only expose Floor/Wall/Low: live floor art remains neutral stone, with brighter obstacle contrast; no lava/healing/ice placements are inferred.
- Added 35 cached original Unity icon sprites for use by the separate UI lane; no UI implementation.

## Verification

Existing Unity 6000.0.85f2 Editor PID 9075, URP 17.0.4, WebGL target. Compile completed with no errors. Explicit domain reload validated all 12 appearances, 3,008 persistent frames, 1,424 frame resolver checks, and 24 non-null audio variants. All 62 existing presentation EditMode tests passed, including projection, hidden-actor cleanup and quality/motion checks. Receipts and independent pixel-comparison script are in `docs/art/evidence/live-integration-2026-11-08/`.

## Still open

Live expanded audio mappings, prop catalog, visual review and lighting tuning, an actual native Unity match screenshot, and later composition with the coordinator's account/UI source gate. The previous frozen protocol-13 Web archive is preserved and was not rebuilt. Physical 144Hz/1440p performance acceptance remains open.
