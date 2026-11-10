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

## Continuation after 4b58dbf3

Live expanded sound mappings are now bound for delivered swing/hit/block/WishLanded/death and explicit potion notices. Sound-family reuse follows canonical validated type/faction and the authored appearance family, preserving current-observation gates and reset cleanup. Stored potions use pickup audio; used potions use potion audio. The existing timeline test now expects the new-epoch Wish landing plus Hit (two queued cues) rather than only the formerly supported Hit. All 62 tests passed on this updated source, distinct from the earlier 4b58 checkpoint.

Imported 42 pinned free prop candidates, preserving source pixels and pivots with transparent padding. All 42 imported sprites have zero physics shapes. They are prepared outside Resources; live placements await authoritative map facts. Nine additional original gap props are staged externally and still await Unity import/visual review.

Fixed mantle size/sorting so it sits behind the body, stopped particle systems before deterministic seed assignment, improved lava channels, Holy radiance and transparent ice over visible underlying stone, and added bounded optional light/soft radiance. The no-network study has a private Bloom tuning profile; live Atmosphere asset was not changed. High/reduced-motion study captures are actual Unity renders. Reduced motion reported zero live decorative particles while essential shapes remain visible. Fresh console had zero warnings/errors.

Actual native Unity proof used the pinned server SHA28101b…ed27 on owned loopback7788, protocol13/content67183626db240b6a, 12×8 duel layer hash ab72bea5. Both ordinary native clients reached Phase1 with alive self views. First input window delivered three swings and three hits. A separate sRGB capture pass delivered three swings with zero hits. The actual combat camera render is `evidence/live-integration-2026-11-08/native-combat.jpg` (2560×1440); its source-file hashes, script, server binding and counters are retained. Wish input was submitted but no Wish FX arrived: this is not a new Wish proof. A first HDR-to-PNG linear readback was too dark; it remains external and was replaced by a new live sRGB render, with no image editing. A helper callsign initially exceeded the server's 16-character limit and was corrected before the successful runs.

Owned server PID35897 exited and port7788 is free. Play stopped, background behavior restored, auto-tick off. No new Web build or unchanged browser campaign was run; no performance claim is made. Existing frozen Web artifacts remain intact. The coordinator is preparing a separate combined account/UI source gate.

All 24 audio sources were independently decoded and measured: no clipping, no material cave-loop click seam. Cave wind/shock are quiet and quake comparatively loud; optional gain candidates remain external for context review. This is not a completed final mix.
