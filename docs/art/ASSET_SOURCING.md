# Asset sourcing shortlist (free CC0 / CC BY, OFL fonts, optional Asset Store)

Researched 2026-11-09 for the Unity client rework. Rules: `docs/prompts/UNITY_REWORK_FABLE.md` section 4 and [`LICENCE_LEDGER.md`](LICENCE_LEDGER.md). Allowed: CC0 and CC BY for art and audio, SIL OFL for fonts, Unity Asset Store purchases (never committed, `client-unity/UnityProject/Assets/Licensed/`). Anything below that is not one of those is listed under "Rejected" so nobody re-adds it.

## How to read this document (verification status)

- **Nothing was downloaded.** No asset file was fetched; only listing pages and metadata.
- **Licence and author were read from the item's own page** (OpenGameArt pages fetched with a browser user-agent because the tool-level fetch gets HTTP 403 there; Freesound, itch.io, kenney.nl, incompetech `pieces.json` and the Google Fonts repository fetched directly). Where an OpenGameArt page lists several licences (for example "CC-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0"), the row says which one is elected; the election must be recorded in the ledger when the file is added.
- **Nothing was listened to or viewed.** Fit to a region is judged from title, tags and description only. Every pick needs an audition or visual check before it is committed. Treat each as a candidate, not a decision.
- Prices for Asset Store packs were read from the store listings today; contents and art style could not be confirmed from those pages (descriptions were empty in the fetched text), so purchases need a preview check by the owner first.
- "OGA" = OpenGameArt. File sizes are as listed on the page.

## Perspective: the honest mismatch risk

Existing characters and mobs are Flare sprites: painted, 8-direction, rendered at an isometric (2:1 dimetric) camera. The Flare tile definitions confirm the footprint: dungeon tile rectangles are 192 x 96 px (`tileset_dungeon.txt`, `tile=16,1438,2644,192,96,96,48`). Characters are frozen for this effort, so new environment art must read as the same camera.

| Projection | Fits Flare sprites? | Notes |
|---|---|---|
| Isometric 2:1 painted or rendered (Kenney Isometric series, rubberduck packs) | Best fit | Tile aspect of each Kenney set is not stated on its page; confirm 2:1 footprint (not true 30 degree isometric) before importing |
| Isometric 2:1 pixel art (isoTile Universe, IKSLM desert) | Camera fits, style clashes | 32 to 64 px pixel art next to painted high-resolution sprites will look mismatched |
| Top-down / 3/4 orthogonal pixel (Kenney Tiny Town, Roguelike/RPG pack: both 16 x 16, CC0) | Poor | Different projection and a tenth of the resolution. Fine for icons and UI props, not for ground or walls |

There is **no verified free CC0 or CC BY painted 2:1 set for lava/volcanic floors or for snow/ice ground**. The plan for those two regions is to tint and re-light CC0 Kenney grass/stone/block tiles (modifying CC0 art is allowed) plus shader effects, and to treat a paid isometric biome pack as the proper fix (see the Asset Store section). Do not use anything derived from Flare (so not Clint Bellanger's Flare-origin packs, see Rejected).

## 1. Music: per-region placeholder loops

Seven slots: Fire, Sentenced, Plague, Frost, Holy, Coliseum, Menu. Convert to OGG and load after the match starts (download budget). "Loop" status is as claimed on the page; verify the loop point before use.

| Slot | Primary pick | Author | Licence (page) | Size | Alternates |
|---|---|---|---|---|---|
| Fire (volcanic, warm) | [Shrine to the Smoldering Volcano](https://opengameart.org/content/shrine-to-the-smoldering-volcano) | Mega Pixel Music Lab | CC-BY 3.0 elected (page also lists CC-BY-SA 3.0, GPL 3.0, GPL 2.0) | 3.8 MB mp3 | [Theme of Com-Mecha](https://opengameart.org/content/theme-of-com-mecha) by Matthew Pablo, CC-BY 3.0, 12 MB, orchestral volcanic (attribution instructions at matthewpablo.com/services); incompetech "Firesong" (below). Do not use "Tower of Lava": 35.4 MB |
| Sentenced (haunted farmland, dusk) | [MonsterVania - Ghost Land](https://opengameart.org/content/monstervania-ghost-land) | HydroGene | CC0 | 2.3 MB mp3 | incompetech "SCP-x6x (Hopes)" (haunting cello) and "Southern Gothic" |
| Plague (overgrown ruins) | incompetech "Willow and the Light" (page text: dark overgrown forest, "can loop perfectly") | Kevin MacLeod | CC BY 4.0 | n/a | CC0: [Swamp Theme Loop](https://opengameart.org/content/swamp-theme-loop) (beardalaxy, 306 KB ogg, very short), [Village Ruins](https://opengameart.org/content/village-ruins) (isaiah658, 2.2 MB ogg) |
| Frost | [Beyond the Frozen Veil](https://opengameart.org/content/beyond-the-frozen-veil) (ambient, ethereal, "loop, flac") | Synth-thetic | CC0 | 23.8 MB 7z of FLAC (re-encode to about 3 MB ogg) | [Icy Realm - (Seven and Eight)](https://opengameart.org/content/icy-realm-seven-and-eight) cynicmusic, CC0, 3.3 MB; [Snowy Village](https://opengameart.org/content/snowy-village) Louswan, CC-BY 3.0, "loopable"; incompetech "Frost Waltz" |
| Holy (desert, oasis) | [Desert Overworld](https://opengameart.org/content/desert-overworld) (tags: desert, oasis, overworld) | KarateStudios | CC0 | 10.9 MB flac (re-encode) | [Desert theme](https://opengameart.org/content/desert-theme) yd, CC0, 2 MB ogg; [The Desert of Dreams](https://opengameart.org/content/the-desert-of-dreams) Insydnis, CC-BY 3.0; incompetech "Tabuk" |
| Coliseum | [Battle Theme A](https://opengameart.org/content/battle-theme-a) (strings and horns) | cynicmusic (credit text: cynicmusic.com, pixelsphere.org) | CC0 | 3.3 MB mp3 | incompetech "Heroic Age" (Action, Bright, Epic; 1:37) |
| Menu | [Beyond The Clouds (Orchestral Theme)](https://opengameart.org/content/beyond-the-clouds-orchestral-theme) (tags: bright, hero, fantasy, overworld; closest to the Zelda-bright brief) | Matthew Pablo | CC-BY 3.0 | 5.7 MB mp3 | [Adventure Time](https://opengameart.org/content/adventure-time) Scribe, CC0, 1.4 MB |

**incompetech (Kevin MacLeod)**: licence page <https://incompetech.com/music/royalty-free/licenses/> offers a free Creative Commons tier that requires credit; the FAQ gives the credit form `"Title" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 https://creativecommons.org/licenses/by/4.0/`. The catalogue is machine-readable at <https://incompetech.com/music/royalty-free/pieces.json> (1,443 pieces); track pages are `https://incompetech.com/music/royalty-free/index.html?isrc=<ISRC>`. I could not load an individual track page without a browser (it is built by script), so confirm "CC BY 4.0" on the page when adding each track. ISRCs: Willow and the Light `USUAN1100591`; Firesong `USUAN1100598`; SCP-x6x (Hopes) `USUAN2000012`; Southern Gothic `USUAN2300004`; Frost Waltz `USUAN1100516`; The Snow Queen `USUAN1100872`; Tabuk `USUAN1100818`; Desert of Lost Souls `USUAN1800001`; Heroic Age `USUAN1100848`; Decay `USUAN1100512`.

## 2. Ambience loops

| Region | Pick | Author | Licence (page) | Length / size | Notes |
|---|---|---|---|---|---|
| Frost (wind, snow) | [ContinuousHighWindLoop.wav](https://freesound.org/people/zimbot/sounds/350678/) | zimbot | CC BY 4.0 (Attribution 4.0) | 18 s, seamless per description | Synthetic strong wind; low-pass it for gentler snow. CC0 alternate: [wind whoosh loop](https://opengameart.org/content/wind-whoosh-loop), SketchMan3, 252 KB ogg (not auditioned). CC BY alternate: [Wind Loop](https://opengameart.org/content/wind-loop), AntumDeluge, CC-BY 3.0 |
| Fire (lava rumble) | [Lava Loop 4](https://freesound.org/s/474852/) | Fission9 | CC0 | 39.5 s, "loops seamlessly" | Slowed boiling-liquid recording. Alternate: [Lava loop.wav](https://freesound.org/people/Audionautics/sounds/133901/), Audionautics, CC BY 3.0, 1:14 (corn-syrup recording). Layer with [Fire Crackling](https://opengameart.org/content/fire-crackling), AntumDeluge, CC0 |
| Holy (desert wind) | [Looping Gentle Wind Ambience on an Open Desert Plain](https://freesound.org/s/697217/) | dhallcomposer | CC0 | 41 s | Gentle, reverberant; pair with bird or insect layer for the oasis pockets |
| Plague (swamp, ruin drips) | [Swamp Environment Audio](https://opengameart.org/content/swamp-environment-audio) | LokiF | CC0 | swamp.ogg 1.3 MB | Add [Dripping water loop](https://opengameart.org/content/dripping-water-loop), Independent.nu, CC0, for ruin drips. Neither auditioned for loop quality |
| Sentenced (eerie farmland) | [Night Ambiance](https://freesound.org/s/248103/) | DidntGoToFilmSchool | CC0 | 19.5 s, "designed to loop easily" | Field recording, almost no wind. Add the CC BY 4.0 [eerie_forest.mp3](https://freesound.org/s/70100/) (gregswinford, 7:25) for the creaking layer, and [Crickets Ambient Noise - loopable](https://opengameart.org/content/crickets-ambient-noise-loopable) (Wolfgang_, CC0, 184 KB) |

## 3. Environment: tilesets and props by region

All rows are isometric (see "Perspective") unless stated. Reality check: only the greenery, ruins, desert and generic ground are covered well; lava floor and snow ground are gaps.

| Use | Pack | Author | Licence (page) | Size | Fit and risk |
|---|---|---|---|---|---|
| Base ground, grass, stone, water, all regions (tint per palette) | [Isometric Landscape](https://opengameart.org/content/isometric-landscape) | Kenney | CC0 | 1.1 MB | Rendered 3D-to-2D landscape tiles per the Kenney description. Tile aspect not stated on page |
| Blocks, walls, ledges | [Isometric Blocks](https://opengameart.org/content/isometric-blocks) | Kenney | CC0 | 7.3 MB | Same caveat; usable to build ice walls and basalt with tinting |
| Buildings (Sentenced barns, Plague houses) | [Isometric Buildings #1](https://opengameart.org/content/isometric-buildings-1) | Kenney | CC0 | 1.7 MB | |
| Indoor/coliseum corridors, props | [Isometric Miniature Dungeon](https://kenney.nl/assets/isometric-miniature-dungeon) | Kenney | CC0 | 70 files, 14.2 MB zip | Dungeon interiors; page confirms isometric |
| Holy: desert | [Sketch Desert](https://kenney-assets.itch.io/sketch-desert) | Kenney | CC0 | 240+ sprites, 1.9 MB | Sketchy outline style; page tags it "Isometric" |
| Holy and Plague: trees, bushes, grass, cacti (the greenery) | [Free isometric plants-pack](https://opengameart.org/content/free-isometric-plants-pack) | rubberduck | CC0 | 24.5 MB, 18,800 downloads | Strongest candidate for the "plenty of greenery" brief; Blender renders, so close to Flare's render look |
| Plague, Sentenced: ruined walls | [Free isometric ruins](https://opengameart.org/content/free-isometric-ruins) | rubberduck | CC0 | 3.3 MB | |
| Sentenced farm, Frost village: buildings and props (snow/winter tags) | [isometric medieval buildings](https://opengameart.org/content/isometric-medieval-buildings), [isometric medieval props](https://opengameart.org/content/isometric-medieval-props) | rubberduck | CC0 | 25.5 MB / 6.9 MB sheets | Source Blender files are included, so winter and dusk variants can be re-rendered |
| Plague, Sentenced: dark ruins | [Dark Ruins Tilesets - Isometric](https://opengameart.org/content/dark-ruins-tilesets-isometric) | Cethiel (page tags credit several other artists) | CC0 | 4.9 MB | Compilation. Check the original authors of each sheet before committing; if any is Flare-derived or not CC0, drop it |
| Plague: ruins in forest | [RPG - Forest Ruins - Isometric](https://opengameart.org/content/rpg-forest-ruins-isometric) | 2DPIXX | CC-BY 3.0 | 582 KB | Needs credit |
| Holy: oasis tiles | [Oasis isometric tiles](https://opengameart.org/content/oasis-isometric-tiles) | Ironthunder | CC-BY 3.0 | 1.7 MB | Page tags credit other artists (Snabisch, looneybits, YaYu); confirm upstream licences before use |
| Holy, Sentenced: cacti and dead trees | [Isometric Cactus Variants](https://opengameart.org/content/isometric-cactus-variants), [Isometric dead trees](https://opengameart.org/content/isometric-dead-trees) | Varkalandar | CC-BY 3.0 elected (also lists CC-BY-SA 3.0, OGA-BY 3.0) | 2 to 3 MB per sheet | Elect CC-BY 3.0 and record it |
| Holy: pixel desert (style clash) | [Desert isometric tiles](https://opengameart.org/content/desert-isometric-tiles) | IKSLM | CC0 | 187 KB | 32 px pixel art derived from Dungeon Crawl tiles; low priority |
| VFX, extras | [Fireball Effect](https://opengameart.org/content/fireball-effect), other Cethiel effects | Cethiel | CC0 | about 0.5 MB each | Optional |
| Fire floor, Frost ground | **No verified free source** | | | | Tint Kenney Landscape/Blocks; ember and snow particles and a lava shader carry the look; or buy a biome pack (below) |

## 4. UI kit (panels, buttons, icons)

The layout is unchanged; only the look is replaced. None of these were viewed, so "bright fantasy" fit is judged from tags.

| Use | Pack | Author | Licence (page) | Notes |
|---|---|---|---|---|
| Panels, buttons, sliders | [UI Pack - Adventure](https://kenney.nl/assets/ui-pack-adventure) | Kenney | CC0 | 130 files; tags: button, panel, slider |
| Panels, buttons, ticks (RPG look) | [UI pack: RPG extension](https://opengameart.org/content/ui-pack-rpg-extension) | Kenney | CC0 | 214 KB |
| Buttons, medieval | [Medieval Game Button Pack](https://opengameart.org/content/medieval-game-button-pack) | pzUH | CC0 | 4.7 MB plus an SVG source |
| Bright, rounded GUI | [Free Game GUI](https://opengameart.org/content/free-game-gui) (tags: cute, vector, kawaii) and [GUI](https://opengameart.org/content/gui-2) (JanaChumi, CC0 elected from CC-BY 4.0 / CC-BY 3.0 / CC0) | pzUH / JanaChumi | CC0 | Vector sources; may be too casual in tone |
| Game icons (tintable) | [Game Icons](https://kenney.nl/assets/game-icons) | Kenney | CC0 | 105 files |
| RPG icons | [700+ RPG Icons](https://opengameart.org/content/700-rpg-icons) | Lorc | CC-BY 3.0 | Black and white, tinted per faction palette; credit required |
| RPG pixel icons | [496 pixel art icons](https://opengameart.org/content/496-pixel-art-icons-for-medievalfantasy-rpg) | Henrique Lazarini (7Soul1) | CC0 | Pixel style; use only if UI stays pixel |

## 5. Fonts (SIL OFL only)

Licence read from each font's `METADATA.pb` in `google/fonts` (`license: "OFL"`), designer as stated there. Ship the OFL text and copyright notice for each in the build (the Cinzel one is currently missing, see the ledger).

| Role | Font | Designer (per METADATA) | Source | Notes |
|---|---|---|---|---|
| Display (existing) | Cinzel Decorative | Natanael Gama | already in repo | Keep for the four title strings |
| Display, readable | [Cinzel](https://github.com/google/fonts/tree/main/ofl/cinzel) | Natanael Gama | <https://fonts.google.com/specimen/Cinzel> | Same family as the existing font, so one OFL notice covers the family intent; more legible at HUD sizes than the decorative cut |
| Display alternates | [Almendra](https://github.com/google/fonts/tree/main/ofl/almendra) (Ana Sanfelippo), [Metamorphous](https://github.com/google/fonts/tree/main/ofl/metamorphous) (James Grieshaber), [MedievalSharp](https://github.com/google/fonts/tree/main/ofl/medievalsharp) (Wojciech Kalinowski) | | | Warmer, more storybook; check glyph coverage for the HUD strings |
| Body (recommended) | [Nunito](https://github.com/google/fonts/tree/main/ofl/nunito) | Vernon Adams, Cyreal, Jacques Le Bailly | <https://fonts.google.com/specimen/Nunito> | Rounded, friendly, suits the bright direction; replaces Liberation Sans for body copy |
| Body (accessibility option) | [Atkinson Hyperlegible](https://github.com/google/fonts/tree/main/ofl/atkinsonhyperlegible) | Braille Institute, Applied Design Works and others | <https://fonts.google.com/specimen/Atkinson+Hyperlegible> | Best for dense numeric HUD (hp, damage, cooldowns) |
| Body alternates | [Alegreya Sans](https://github.com/google/fonts/tree/main/ofl/alegreyasans) (Juan Pablo del Peral, HT Fonts), [Lora](https://github.com/google/fonts/tree/main/ofl/lora) (Cyreal) | | | |

TMP SDF atlases generated from these are OFL derivatives; keep the reserved-font-name caveat in mind when regenerating.

## 6. Unity Asset Store shortlist (optional; nothing may depend on a purchase)

Prices read from the store listings on 2026-11-09. None of these pages had a usable description in the fetched text, so contents and art style are inferred from keywords and from search-result summaries. **Preview each in the Asset Store before the owner buys.** Each needs a free placeholder in the same slot first (the sections above), so a purchase is a drop-in swap.

| # | Pack | Publisher | Price | Link | Replaces | Why free falls short | Caution |
|---|---|---|---|---|---|---|---|
| 1 | isoTile Universe v2.4 | Daniel Kole Productions | $19.99 | <https://assetstore.unity.com/packages/2d/environments/isotile-universe-245686> | Free gaps: Fire volcanic floor, Frost snow/tundra, Plague swamp and blighted land, desert | The creator's itch page lists forest, burnt forest, swamp, snowy forest, tundra, desert, volcanic (ash, lava, rocky) and blighted lands, roughly 450 tiles at 64 x 128 px | Pixel art, so it clashes with painted Flare sprites; 2.0 MB. The Asset Store EULA covers it; do not use the itch.io copy (informal licence) |
| 2 | Orchestral Fantasy RPG Music | Adam Morton | $14.99 | <https://assetstore.unity.com/packages/audio/music/orchestral/orchestral-fantasy-rpg-music-227532> | The seven music placeholders | A search summary says 20 loopable tracks, about 27 minutes, with choir, dulcimer and pan flute; free tracks vary in loudness, style and loop quality | Only 3 reviews; track list not confirmed on the page. Listen to the preview first |
| 3 | Classic Fantasy RPG - UI Kit v1.01 | PONETI | $19.99 | <https://assetstore.unity.com/packages/2d/gui/classic-fantasy-rpg-ui-kit-193841> | UI panels, frames and icons | A single cohesive painted kit beats mixing Kenney and pzUH sheets; 180 favourites | 582 MB download (import only the sprites needed; build size budget is about 150 MB); URP compatibility not stated; style (keywords: hand-painted) unverified |
| 4 | Dreamy Fantasy GUI Pack - Colorful Game UI Assets v1.3 | Midknight GameDev | $8.99 | <https://assetstore.unity.com/packages/2d/gui/dreamy-fantasy-gui-pack-colorful-game-ui-assets-329970> | Optional alternative to #3 for a lighter, colourful tone | Brightest UI option found | Listing says Built-in pipeline compatible, URP and HDRP not (UI sprites usually still work, untested); keywords suggest a cute beach and sea theme; no ratings |
| 5 | 2D Isometric Ice-Dungeon | Golden Skull Art | $25.00 | <https://assetstore.unity.com/packages/2d/environments/2d-isometric-ice-dungeon-176227> | Frost interiors only | Hand-painted isometric (326 tiles per a search summary) | Dungeon, not open snow plains; lowest priority |

Budget (owner guidance: about $100 comfortable, $150 absolute): #1 + #2 + #3 = **$54.97**; adding #4 = $63.96; adding #5 as well = $88.96. Recommended order if buying: #2 music (most audible gain), #1 biome tiles only if the tinted Kenney set looks wrong, #3 UI only if the free kits do not look cohesive. Not recommended: Complete Fantasy RPG Music Bundle (Marcin Szmuc, $149.99, 4.3 GB), which would consume the whole budget by itself.

## 7. Rejected, with reasons

| Item | Reason |
|---|---|
| OGA "64x128 Isometric Hand Painted Tiles", "Desert 01" music, snow music tagged ice/mountains | CC BY-SA (4.0): not allowed |
| OGA isometric ruin tileset incl. winter variant, and isometric desert tileset "built by modifying Flare's grasslands" | CC BY-SA 3.0 and derived from Flare: not allowed |
| Clint Bellanger (Flare's author) packs such as "Cave Tileset", "Grass and Water Tiles" (CC-BY 3.0 on OGA) | Licence is acceptable but origin is Flare art; excluded by the "nothing derived from Flare" rule. Lamoot's "RPG GUI construction kit v1.0" (CC-BY 3.0) is by a Flare contributor; use only after confirming it is an independent work |
| Freesound "Drizzly Swamp Afternoon" (KevinSonger) | CC BY-NC 4.0: non-commercial |
| ambient-mixer.com mixes | Creative Commons Sampling Plus 1.0: not allowed |
| Mixkit volcano/desert/night effects | Mixkit's own licence: not allowed |
| Anything whose only free-use licence is "OGA-BY 3.0" (for example the CraftPix packs) | OGA's own licence, not CC BY |
| Golden Skull Art itch.io copies (for example 2D Isometric World Tileset, $20) | Custom licence ("No redistribution of package, its contents, altered or derived versions"): only the Asset Store version of a pack is acceptable, and only as a local-only purchase |
| itch.io "Free Isometric Tileset CC0 For Prototyping" (the-outlander) | The page says it is AI-generated; policy is human-made art |
| Uploads shown as "Anonymous (not verified)" on OGA | Authorship cannot be credited |
| OGA "Lava loop" (Blender Foundation, CC-BY 3.0) | The listing is a zip of unknown content (not confirmed to be audio); skipped |

## 8. Next actions

1. Audition the seven music picks and five ambience picks; replace any that do not loop cleanly.
2. Pull the Kenney Isometric Landscape/Blocks sets and confirm the tile aspect against the 2:1 Flare footprint before any import.
3. For each file added: ledger row (author, URL, licence as elected, date fetched), credit string in the build's `Licenses/` folder, and a credits entry (CC BY requires it). Use the incompetech credit form above for Kevin MacLeod tracks.
4. Put the Asset Store request in the next gate report with name, price, link, replacement slot and why free fell short; keep the running total (currently $0 spent).
