# Licence ledger: third-party files in the Unity project

Scope: every non-code file under `client-unity/UnityProject/Assets` that is not original project work, as of branch `feature/unity-rework` (surveyed 2026-11-09 against the working tree and `git ls-files`: 353 non-C#, non-`.meta` files, all tracked, none local-only). Starting points: [`client-unity/THIRD_PARTY_ASSETS.md`](../../client-unity/THIRD_PARTY_ASSETS.md), [`AUDIO.md`](AUDIO.md), [`AUDIO_EXPANSION.md`](AUDIO_EXPANSION.md), [`ARMOR.md`](ARMOR.md), [`ASSET_EXPANSION.md`](ASSET_EXPANSION.md), [`PROP_CATALOG_IMPORT.md`](PROP_CATALOG_IMPORT.md), [`TYPOGRAPHY.md`](TYPOGRAPHY.md), the per-folder `asset-manifest.json` / `manifest.json` files and the captured Flare credits ledger (revision `61939e26d397b51c0c36da8cb861f89c8bf1d6db`, edited 2026-04-05T03:05:38Z). Licence names below are exactly what those records state; where a record states nothing for a file, the cell says so instead of inferring an author.

This is an engineering record, not legal advice. Items marked **replace-later risk** are CC BY-SA and are the owner-accepted "may stay for now" set from `docs/prompts/UNITY_REWORK_FABLE.md` section 4.

## Policy going forward

| Kind | Allowed licences | Committed? |
|---|---|---|
| Art, audio | CC0, CC BY (credit the author; keep the attribution in the build) | Yes, committed, with a row in this ledger |
| Fonts | SIL OFL 1.1 only (ship the OFL text and copyright notice) | Yes |
| Unity Asset Store purchases | Asset Store EULA | Never. They live in git-ignored `client-unity/UnityProject/Assets/Licensed/` (already in `client-unity/UnityProject/.gitignore`; the folder does not exist yet). The ledger records pack name, version, store link and which files came from it. The project must build and run with the folder absent, using a free placeholder |
| Anything else (CC BY-SA, CC BY-NC, GPL-only, "royalty-free" custom licences, unclear terms) | Not allowed for new additions. Nothing new may be derived from the Flare CC BY-SA assets | n/a |

Every added file gets a row here in the same change that adds it.

## Risk summary

| Risk | Count / extent | Action |
|---|---|---|
| CC BY-SA 3.0 or later (**replace-later risk**): Flare art | 22 + 3 + 12 + 5 source PNGs, 3 tilesets (dungeon, cave, grassland), their definition `.txt` files, 88 derived PNGs and 42 candidate crops (205 MB under `Assets/Art/Derived`) | Keep for now. New art must not be derived from them. Replace environment, props, UI and effects first (sprites of characters and mobs are frozen for this effort) |
| CC BY-SA 3.0: Flare audio | 12 clips: `battle_theme`, `dungeon_theme` (remaxim), `shoot` (remaxim), `goblin_hit`, `goblin_die` (MaximB), `melee_attack` (no author in ledger), `melee_attack_2`, `melee_attack_3`, `heal`, `burn`, `freeze`, `cave_wind_loop` (project default, no author) | Replace with CC0/CC BY (see `ASSET_SOURCING.md`). Music first: it is the most audible |
| CC BY 3.0 attribution not shipped | Brandon Morris (Augmentality), Michel Baradari, artisticdude, plus art contributors (Blender Foundation, Lamoot, Hythlodaeus, TiZiana and others) | `Tools/build-web.sh` does not copy any Flare notice into `Build/Web/Licenses/`, and there is no in-game credits screen. CC BY requires attribution to travel with the work. See "Build notices" |
| OFL notice for Cinzel Decorative | One file | Shipped as `Licenses/CinzelDecorative-OFL.txt`; `Tools/build-web.sh` fails the build if it is missing |
| EmojiOne sprite sample: licence unverified | `EmojiOne.jpg`, `EmojiOne.asset`, `EmojiOne.json`; enabled as TMP default sprite asset with emoji support on | The only record is Unity's one-line note "review their licensing terms"; no licence text is in the repo and EmojiOne has changed licence between versions, so I could not establish that it is CC0/CC BY. Treat as not allowed until verified. Preferred fix: remove the sprite asset and the default-sprite reference if no `<sprite>` tags are used (none found in `Assets/Scripts`) |
| Mixed-licence composite atlases | `tileset_dungeon.jpg`, `tileset_grassland.jpg` | Contain CC BY and public-domain renders (and, for grassland, two CC BY-SA textures) inside a CC BY-SA sheet. Handle as CC BY-SA as a whole |

## Fonts and TextMesh Pro

| Path or glob | What | Source | Author | Licence | Committed / local | Notes |
|---|---|---|---|---|---|---|
| `Assets/TextMesh Pro/Fonts/LiberationSans.ttf` | Body and HUD font | Unity's TextMesh Pro Essential Resources import (Liberation Fonts) | Digitized data (c) 2010 Google Corporation; (c) 2012 Red Hat, Inc. (reserved font name "Liberation") | SIL OFL 1.1 | Committed | OFL text in `Fonts/LiberationSans - OFL.txt`; the build copies it to `Build/Web/Licenses/LiberationSans-OFL.txt` |
| `Assets/TextMesh Pro/Fonts/LiberationSans - OFL.txt` | Licence text for the above | same | same | n/a (licence text) | Committed | Shipped in build |
| `Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF.asset`, `... - Fallback.asset`, `... - Drop Shadow.mat`, `... - Outline.mat` | Generated SDF atlas and materials for Liberation Sans | Generated by TMP from the font above | Derived from the font | SIL OFL 1.1 (derivative of the font) | Committed | Covered by the same OFL notice |
| `Assets/Art/ThirdParty/Fonts/CinzelDecorative-Regular.ttf` | Display font for four HUD headings | `google/fonts` commit `86aced91de05cd4f96a06838124cca45be337b2b`, `ofl/cinzeldecorative/`; SHA-256 `5b862be3...330b10b8` | Natanael Gama (c) 2012; reserved font name "Cinzel" | SIL OFL 1.1 | Committed | Shipped as `Licenses/CinzelDecorative-OFL.txt` (`RhBuild.CopyNotices`; `build-web.sh` verifies it). |
| `Assets/Art/ThirdParty/Fonts/OFL-CinzelDecorative.txt` | Licence text and copyright for Cinzel Decorative | same | same | n/a (licence text) | Committed | Must ship with the font in the build |
| `Assets/Resources/Showcase/CinzelDecorative.asset` | Generated TMP SDF atlas of Cinzel Decorative | Generated in-project from the TTF | Derived from the font | SIL OFL 1.1 (derivative) | Committed | Under the OFL a modified version may not use the reserved name "Cinzel" as its primary name; the asset keeps the font's name. Low risk for a baked atlas, but worth a check when the font is next regenerated |
| `Assets/Art/ThirdParty/Fonts/Nunito-Regular.ttf`, `Nunito-Bold.ttf` | HUD body font (Nunito, rounded sans) | `google/fonts` on GitHub, `ofl/nunito/Nunito[wght].ttf` at commit `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5` (<https://github.com/google/fonts/tree/main/ofl/nunito>); upstream <https://github.com/googlefonts/nunito>. Upstream file SHA-256 `bb55a5ca5c2042335b3991af27c4d0705d0ef41cac6164ac737fd8f2a1e85207` | The Nunito Project Authors (c) 2014 (no reserved font name) | SIL OFL 1.1 | Committed | The upstream file is a variable font whose default instance is ExtraLight, so these two static instances (wght 400 and 700) were cut from it with fontTools `varLib.instancer.instantiateVariableFont(font, {"wght": 400 or 700}, updateFontNames=True)`; no outlines were edited. The OFL permits this modification |
| `Assets/Art/ThirdParty/Fonts/OFL-Nunito.txt` | Licence text and copyright for Nunito | same, `ofl/nunito/OFL.txt`, SHA-256 `580df76c95a1ec5ab878ceb25bb3d85c6a076804e9c970c8c6972aea775fdf65` | same | n/a (licence text) | Committed | Shipped in the build as `Licenses/Nunito-OFL.txt` (`Assets/Editor/RhBuild.cs`) |
| `Assets/Resources/Showcase/NunitoRegular.asset`, `NunitoBold.asset` | Dynamic TMP SDF font assets of the two TTFs above | Generated by `Assets/Editor/UiFontBuilder.cs` (`-executeMethod Roguehalla.Editor.UiFontBuilder.Build`) | Derived from the font | SIL OFL 1.1 (derivative) | Committed | Glyphs are rasterised from the shipped TTF at runtime (the asset clears its dynamic data on build); Liberation Sans is the fallback for glyphs Nunito lacks |
| `Assets/Scripts/UI/UiPaletteTokens.cs` | UI colour tokens | Generated by `tools/art/gen-ui-theme.cjs` from `docs/art/palette.json` | Project (generated) | Project licence | Committed | `node tools/art/gen-ui-theme.cjs --check` fails when it drifts from the palette |
| Panel, frame, gloss and button sprites | 9-sliced UI frames | Generated procedurally at runtime by `UiSprites.cs` (no imported art) | Project (generated) | Project licence | n/a | No file on disk |
| `Assets/TextMesh Pro/Shaders/**`, `Resources/TMP Settings.asset`, `Resources/Style Sheets/*`, `Resources/LineBreaking *.txt`, `License.Unity.md` | TextMesh Pro package resources (Essential Resources) | Unity `com.unity.ugui` / TextMesh Pro | Unity Technologies | Unity Companion License (see `License.Unity.md`) | Committed | Not art; permitted only for Unity-dependent projects, which this is. Build copies the licence to `Licenses/Unity-Companion.md` |
| `Assets/TextMesh Pro/Sprites/EmojiOne.png`, `EmojiOne.json`, `Resources/Sprite Assets/EmojiOne.asset` | TMP sample emoji sprite sheet | Unity TMP Essential Resources; upstream <https://www.emojione.com/> | EmojiOne | **Not established.** Unity's note says only "review their licensing terms" | Committed | Licence unverified, not on the allowed list. `TMP Settings.asset` sets this as `m_defaultSpriteAsset` with `m_enableEmojiSupport: 1`. See Risk summary |
| `Assets/TextMesh Pro/Sprites/EmojiOne Attribution.txt` | Unity's attribution note for the sheet | same | n/a | n/a | Committed | Shipped in build as `EmojiOne-Attribution.txt` |

## Flare art: source files (CC BY-SA, replace-later risk)

Source for all rows in this section: Flare: Empyrean Campaign, <https://github.com/flareteam/flare-game>, pinned commit `af6eee6d339ac98011864bfe89da837fe7769c28`; credits ledger <https://github.com/flareteam/flare-game/wiki/Credits>. Upstream states art is **CC BY-SA 3.0, later versions allowed**, unless the ledger lists a per-file exception. Unmodified originals are under `Raw/` with SHA-256 hashes in the manifests.

| Path or glob (under `Assets/Art/ThirdParty/`) | What | Author | Licence | Committed / local | Notes |
|---|---|---|---|---|---|
| `Flare/Raw/images/avatar/male/*.png`, `.../female/*.png` (22 PNG) | Player base layers (head, chest, hands, legs, feet), plate armour layers (helm, cuirass, gauntlets, greaves, boots), shortsword | Not individually credited in the ledger; none inferred | CC BY-SA 3.0 or later (project default). **Replace-later risk** | Committed | Characters are frozen for this effort, so these stay |
| `Flare/Raw/images/enemies/goblin.png`, `skeleton.jpg`; `Flare/Raw/images/npcs/knight.png` | Mob and NPC sheets | Not individually credited | CC BY-SA 3.0 or later. **Replace-later risk** | Committed | Frozen |
| `Flare/Raw/images/tilesets/tileset_dungeon.png` (6.9 MB) | Dungeon tileset atlas | Flare project; ledger also credits Hythlodaeus (3D modeler, sarcophagus render, CC BY 3.0) and TiZiana (stone textures, CC BY 3.0) for parts rendered into the sheet | CC BY-SA 3.0 or later for the sheet. **Replace-later risk** | Committed | Environment art that clashes with the bright look; first to replace |
| `Flare/Raw/animations/**/*.txt`, `Flare/Raw/tilesetdefs/*.txt` | Animation and tileset definition data | Flare project | CC BY-SA 3.0 or later (data) | Committed | Frame and anchor definitions |
| `Flare/Raw/LICENSE.txt`, `Flare/Raw/CREDITS.txt` | Upstream licence text and credits | Flare project | n/a (licence texts) | Committed | Not shipped in the build |
| `Flare/sprite-frame-metadata.json`, `Flare/armor-manifest.json` | Frame rectangles, anchors, layer map | Project-authored from Flare definitions | Repo licence for the JSON; frame data comes from Flare definitions | Committed | Keeps Flare provenance |
| `FlareExpansion/Raw/images/avatar/male/*.png`, `.../female/*.png` (12 PNG) | Mage layers (boots, hood, skirt, sleeves, vest, staff) | Not individually credited | CC BY-SA 3.0 or later. **Replace-later risk** | Committed | Frozen |
| `FlareExpansion/Raw/images/enemies/*.png` (5 PNG) | antlion, goblin_elite, skeleton_archer, skeleton_mage, zombie | Not individually credited | CC BY-SA 3.0 or later. **Replace-later risk** | Committed | Frozen |
| `FlareExpansion/Raw/images/tilesets/tileset_cave.png` | Cave tileset atlas | Not individually credited | CC BY-SA 3.0 or later. **Replace-later risk** | Committed | Environment; replace |
| `FlareExpansion/Raw/animations/**`, `Raw/tilesetdefs/tileset_cave.txt`, `CREDITS.md`, `CREDITS_CAPTURE.*`, `LICENSE.txt`, `asset-manifest.json` | Definitions, captured credits, licence, manifest | Flare project | CC BY-SA 3.0 or later / licence texts | Committed | |
| `FlareProps/Raw/images/tilesets/tileset_grassland.png` | Grassland tileset atlas | Composite; credits: Blender Foundation (plants, CC BY 3.0), Lamoot (CC BY 3.0), Lattice, p0ss, Zuendholz (3D renders), Bart K (bark/straw textures, CC BY-SA 3.0, via OpenGameArt), Sindwiller (brick texture, CC BY-SA 3.0), TiZiana (CC BY 3.0), Yughues (rock textures, public domain). Exact terms per row in the captured ledger | CC BY-SA 3.0 or later for the sheet. **Replace-later risk** | Committed | Environment; replace |
| `FlareProps/Raw/tilesetdefs/tileset_grassland.txt`, `Raw/CREDITS_CAPTURE.*`, `Raw/LICENSE.txt`, `asset-manifest.json`, `candidate-tiles.json` | Definition, captured credits, licence, manifest, crop list | Flare project / project-authored | as above | Committed | |
| `FlareProps/Candidates/*.png` (42 PNG: 19 dungeon, 14 grassland, 9 cave) | Direct crops of the three atlases above | as the source atlas | CC BY-SA 3.0 or later. **Replace-later risk** | Committed | |

## Flare art: derived files (CC BY-SA, share-alike travels with them)

All generated by project tooling (`Assets/Editor/FlareCatalogImporter.cs` and related) from the Flare source above. They are adaptations, so they carry CC BY-SA 3.0 or later and the source credits. **Replace-later risk** for every row.

| Path or glob (under `Assets/Art/Derived/`) | What | Source | Licence | Committed / local | Notes |
|---|---|---|---|---|---|
| `Flare/*.png` (6) | Composite actor atlases: hero, hero-female, knight, goblin, skeleton, props | `ThirdParty/Flare/Raw` layers | CC BY-SA 3.0 or later | Committed | Documented in `ARMOR.md` |
| `FlareFullBase/Versions/ca4ea04cc36d8687/Actors/*.png` (5), `FlareFullBase/Catalog.asset`, `receipt.json` | Full-base actor atlases and catalogue | same | CC BY-SA 3.0 or later | Committed | `.asset` and JSON are project metadata |
| `FlareExpansion/Actors/*.png` (7), `FlareExpansion/Environment/*.png` (12), `FlareExpansion/AssetReadiness.asset` | Mage and mob atlases; extracted cave floor, wall and prop tiles | `ThirdParty/FlareExpansion/Raw` | CC BY-SA 3.0 or later | Committed | Environment tiles first to replace |
| `FlareProps/Tiles/*.png` (42), `FlareProps/ShowcasePropCatalog.asset` | Extracted dungeon, grassland and cave prop tiles | `ThirdParty/FlareProps` | CC BY-SA 3.0 or later (grassland tiles include CC BY-SA textures) | Committed | Environment; replace |
| `ShowcaseLive/Atlases/*/*.png` (16), `ShowcaseLive/Catalog.asset`, `OriginalSourceCatalog.asset`, `receipt.json` | Baked runtime actor atlases | Derived atlases above | CC BY-SA 3.0 or later | Committed | These are what the live renderer draws |

## Audio

Source for all rows: Flare repository at the pinned commit, `mods/fantasycore/music` and `soundfx`; per-file credits from the captured ledger (also in each folder's `manifest.json` / `asset-manifest.json`). Files are unmodified. All paths under `Assets/Art/ThirdParty/`.

| Path or glob | What | Author | Licence | Committed / local | Notes |
|---|---|---|---|---|---|
| `Flare/Audio/music/battle_theme.ogg` | Combat music | remaxim | CC BY-SA 3.0. **Replace-later risk** | Committed | |
| `Flare/Audio/music/dungeon_theme.ogg` | Dungeon music | remaxim | CC BY-SA 3.0. **Replace-later risk** | Committed | |
| `Flare/Audio/ambience/bird_twitter_loop.ogg` | Ambient birds | Chris Castiglione (alienistcog) | CC0 | Committed | |
| `Flare/Audio/sfx/melee_attack.ogg` | Melee swing | None identified in the ledger | Project default CC BY-SA 3.0 (no per-file entry). **Replace-later risk** | Committed | |
| `Flare/Audio/sfx/zombie_hit.ogg` | Hit | Ljudbank | Public Domain / CC0 | Committed | |
| `Flare/Audio/sfx/inventory_book.ogg` | UI interaction | Cori Samuel | Public Domain / CC0 | Committed | |
| `Flare/Audio/sfx/inventory_object.ogg` | Item pickup | Michel Baradari | CC BY 3.0 | Committed | Attribution required; not shipped |
| `Flare/Audio/sfx/inventory_coins.ogg` | Coin pickup | artisticdude | Public Domain / CC BY 3.0 (ledger states both) | Committed | Treat as CC BY until the owner decides |
| `FlareAudioExpansion/Raw/soundfx/melee_attack_2.ogg`, `melee_attack_3.ogg` | Melee swings | None identified | Project default CC BY-SA 3.0. **Replace-later risk** | Committed | |
| `.../powers/shoot.ogg` | Arrow shot | remaxim | CC BY-SA 3.0. **Replace-later risk** | Committed | |
| `.../powers/heal.ogg`, `burn.ogg`, `freeze.ogg` | Spell effects | None identified at these exact paths (root-level entries of the same name do not match) | Project default CC BY-SA 3.0. **Replace-later risk** | Committed | |
| `.../enemies/goblin_hit.ogg`, `goblin_die.ogg` | Mob sounds | MaximB | CC BY-SA 3.0. **Replace-later risk** | Committed | |
| `.../environment/cave_wind_loop.ogg` | Ambience loop | None identified | Project default CC BY-SA 3.0. **Replace-later risk** | Committed | |
| `.../powers/block.ogg`, `shock.ogg`, `quake.ogg`, `shield.ogg`; `.../level_up.ogg` | Spell, UI and reward effects | Brandon Morris (Augmentality) | CC BY 3.0 | Committed | Attribution required; not shipped |
| `.../enemies/antlion_hit.ogg` | Mob hit | Michel Baradari | CC BY 3.0 | Committed | Attribution required; not shipped |
| `.../powers/fireball.ogg` | Spell effect | artisticdude | Public Domain / CC BY 3.0 | Committed | Treat as CC BY |
| `.../powers/arrow_wall.ogg`, `.../flying_loot.ogg` | Effects | Iwan "qubodup" Gabovitch | Public Domain / CC0 | Committed | |
| `.../enemies/skeleton_hit.ogg`, `skeleton_die.ogg`, `antlion_die.ogg`, `zombie_die.ogg`, `zombie_critdie.ogg` | Mob sounds | Ljudbank | Public Domain / CC0 | Committed | |
| `.../inventory/inventory_potion.ogg` | Potion use | Stephan | Public Domain / CC0 | Committed | |
| `Flare/Audio/NOTICE.txt`, `manifest.json`; `FlareAudioExpansion/LICENSE.txt`, `CREDITS_CAPTURE.*`, `asset-manifest.json`; `Derived/FlareAudioExpansion/ShowcaseAudioLibrary.asset` | Attribution notice, manifests, licence and credit captures, the Unity library asset that references the clips | Project-authored / Flare | n/a | Committed | The notice file is not shipped in the build |

## Original project work (no third-party licence)

For completeness, so a reader can see what the ledger intentionally leaves out. These are covered by the repository MIT licence (`LICENSE`, (c) 2026 RougeHalla contributors) unless noted.

| Path or glob (under `Assets/`) | What | Notes |
|---|---|---|
| `Scripts/**`, `RoguehallaNet/**`, `Editor/**`, `Tests/**`, `Plugins/WebGL/*.jslib` | Project C# and JavaScript | Includes procedurally generated icon and identity sprites (`ShowcaseIconArt.cs`, `ShowcaseIdentityAssets.cs`): no external images |
| `Resources/Shaders/RhVertexColor.shader`, `Resources/Showcase/` assets, materials, prefabs and `Audio.mixer` (Atmosphere, Catalog, Sprite materials, Torch prefabs) | Project shaders, materials, prefabs, audio mixer | No external textures referenced that are not listed above |
| `Resources/Account/*.json` | Cosmetics and achievements data | Project data |
| `Scenes/Main.unity`, `WebGLTemplates/Roguehalla/index.html`, `DefaultVolumeProfile.asset`, `UniversalRenderPipelineGlobalSettings.asset`, `Settings/*.asset` | Scene, WebGL page template, URP settings | URP assets are Unity-generated; the URP package itself is under Unity's package licence |

## Build notices: what ships today

`Assets/Editor/RhBuild.cs` (`CopyNotices`) writes `Build/Web/Licenses/` with `Roguehalla-MIT.txt`, `Flare-CC-BY-SA-3.0.txt`, `Flare-Credits.txt`, `Flare-Audio-Notice.txt`, `CinzelDecorative-OFL.txt`, `Third-Party-Assets.md`, `Unity-Companion.md`, `LiberationSans-OFL.txt` and `EmojiOne-Attribution.txt`. `Tools/build-web.sh` adds the notices `CopyNotices` lacks (`FlareExpansion-*`, `FlareProps-*`, `FlareAudioExpansion-*` licence and captured-credit files) and then fails the build if any required notice is missing or empty.

Still open:

1. A credits screen or link in the game for the CC BY / CC BY-SA attribution (the files ship with the build, but nothing in the UI points to them).
2. A decision on EmojiOne. The only record in the repository is Unity's one-line note ("review their licensing terms"); no licence text or version is present, so its terms cannot be confirmed from the repo. It stays in place until the owner decides (remove, or document a verified licence).

## Asset Store purchases

None recorded. Format for future rows, to be added here (never committed to git, folder `client-unity/UnityProject/Assets/Licensed/`):

| Pack name and version | Store link | Price paid | Files used (paths under `Assets/Licensed/`) | Free placeholder it replaces | Date |
|---|---|---|---|---|---|
| (none yet) | | | | | |

## Region atmosphere audio (streamed, not in the first-load data)

Added on `rework/atmosphere`. Files live in `client-unity/UnityProject/Assets/StreamingAssets/Audio/`; `RhBuild.BuildWeb` moves the folder out of the project while Unity packs `Web.data` and copies it to `Build/Web/StreamingAssets/Audio/` afterwards, so the player fetches them on demand (`AtmosphereAudio`, UnityWebRequestMultimedia) after the match starts. Retrieved 2026-11-09. Licences were read from each item's own page (OpenGameArt "License(s)" field; Freesound licence link) before download. Processing: ffmpeg 7.1 (libmp3lame, 112 kbps stereo music / 64 kbps mono ambience, 44.1 kHz; MP3 rather than Ogg because the Unity WebGL player rejects Ogg with "Streaming of 'ogg' on this platform is not supported"), loop crossfade 1.5-3 s, EBU R128 two-pass loudnorm to -17 LUFS (music) and -26 LUFS (ambience), true peak -1.5 dBTP. Credit text ships as `Licenses/Atmosphere-Audio-Credits.txt`.

| Path (under `Assets/StreamingAssets/Audio/`) | Title | Author | Source URL | Licence | Bytes | Notes |
|---|---|---|---|---|---|---|
| `music_fire.mp3` | Shrine to the Smoldering Volcano | Mega Pixel Music Lab | https://opengameart.org/content/shrine-to-the-smoldering-volcano | **CC BY 3.0** (elected; page also lists CC-BY-SA 3.0, GPL 3.0/2.0, OGA-BY 3.0) | 1,499,106 | Attribution required and shipped. Trimmed 3:12 to 1:47 |
| `music_sentenced.mp3` | MonsterVania - Ghost Land | HydroGene | https://opengameart.org/content/monstervania-ghost-land | CC0 | 766,214 | |
| `music_plague.mp3` | Village Ruins | isaiah658 | https://opengameart.org/content/village-ruins | CC0 | 1,499,106 | Trimmed 2:24 to 1:47 |
| `music_frost.mp3` | Icy Realm - (Seven and Eight) | cynicmusic | https://opengameart.org/content/icy-realm-seven-and-eight | CC0 | 1,107,792 | |
| `music_holy.mp3` | Desert theme | yd | https://opengameart.org/content/desert-theme | CC0 | 1,336,729 | Very quiet source (-31 LUFS), normalised |
| `music_coliseum.mp3` | Battle Theme A | cynicmusic | https://opengameart.org/content/battle-theme-a | CC0 | 1,301,620 | |
| `amb_frost.mp3` | wind whoosh loop | SketchMan3 | https://opengameart.org/content/wind-whoosh-loop | CC0 | 36,196 | Only 6 s source: repetition will be audible |
| `amb_fire.mp3` | Lava Loop 4 | Fission9 | https://freesound.org/s/474852/ | CC0 | 300,973 | Freesound HQ preview mp3 (originals need a login) |
| `amb_plague.mp3` | Swamp Environment Audio | LokiF | https://opengameart.org/content/swamp-environment-audio | CC0 | 464,604 | 60 s excerpt (from 20 s); source is very quiet and was boosted about 15 dB |
| `amb_sentenced.mp3` | Crickets Ambient Noise - loopable | Wolfgang_ | https://opengameart.org/content/crickets-ambient-noise-loopable | CC0 | 80,500 | 11 s source |
| `amb_holy.mp3` | Looping Gentle Wind Ambience on an Open Desert Plain | dhallcomposer | https://freesound.org/s/697217/ | CC0 | 313,930 | Freesound HQ preview mp3 |

Not listened to (no audio output available to the author): fit to each region is judged from the source descriptions only. The existing Flare CC BY-SA beds stay as the fallback until a streamed track is audible, then are muted (`ShowcaseSoundscape.LegacyMusicMuted`).

Other additions on this branch carry no third-party files: all atmosphere textures (soft flakes, motes, embers, spores, light shafts) are generated in code (`AtmosphereTextures`), and the shaders and shadow bake are original.

Regions pass 2 (branch `rework/regions2`) adds no third-party files: the Holy temple (floor shader, wall skin, minaret, dome and brazier props), the Plague ground and the coliseum props (banner, rack, torch stand) are generated in code (`RegionPropArt.Temple.cs`, `RegionWallAtlas.cs`, `RegionGround.shader`) and the temple emblem is the existing Holy faction glyph. Nothing is derived from Flare or other CC BY-SA work.
