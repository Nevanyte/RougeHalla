# Flare audio expansion (staged, opt-in)

This package adds 24 original Flare fantasycore sound effects and loops, plus a small independent `ShowcaseAudioLibrary` ScriptableObject and an Editor importer. Everything is staged for review under the external folder `live-integration-2026-11-08/audio/`; no repository files, Unity project state, mixer assets, or importer settings were changed here.

## Pinned provenance

- Upstream: [flareteam/flare-game](https://github.com/flareteam/flare-game), commit [`af6eee6d339ac98011864bfe89da837fe7769c28`](https://github.com/flareteam/flare-game/tree/af6eee6d339ac98011864bfe89da837fe7769c28).
- Exact captured attribution source: [Flare Credits wiki revision `61939e26d397b51c0c36da8cb861f89c8bf1d6db`](https://github.com/flareteam/flare-game/wiki/Credits/61939e26d397b51c0c36da8cb861f89c8bf1d6db), edited 2026-04-05T03:05:38Z. The captured HTML and text are retained beside the audio along with upstream `LICENSE.txt`.
- Per-file upstream paths, Git blob SHA-1, SHA-256, byte count, parsed Vorbis duration, source URL, license, credit and cue candidate are in `Assets/Art/ThirdParty/FlareAudioExpansion/asset-manifest.json`.
- Download price: USD 0; these are source files under Flare's published free licenses, not paid marketplace assets.

The project default for art is CC-BY-SA 3.0 or later. For an exact file with a named creator and license in the captured ledger, the manifest records that specific credit/license. Where the ledger does not name a creator for the precise file, the manifest says so and records the project default; it does not guess an individual. Retain attribution and the captured license/credits if relocating or distributing these files. The manifest does not transfer credits from similarly named files at different paths (for example, the ledger’s root-level `burn.ogg`, `freeze.ogg`, and `heal.ogg` entries do not match the selected `powers/` files).

## Contents and suggested semantic keys

| Cue key | Source clips | Preview role |
|---|---|---|
| `combat.melee.swing` | `melee_attack_2`, `melee_attack_3` | Two melee launch variants |
| `combat.block` | `powers/block` | Shield/block cue |
| `combat.ranged.launch` | `powers/shoot` | Bow/projectile launch candidate |
| `combat.magic.shock`, `combat.magic.heal` | `powers/shock`, `powers/heal` | Generic magic cues |
| `wish.freeze`, `wish.swarm`, `wish.trial`, `wish.blaze`, `wish.last-stand` | `powers/freeze`, `arrow_wall`, `quake`, `fireball` + `burn`, `shield` | One available thematic effect per Wish, with two Blaze variants |
| `mob.skeleton.hit/death`, `mob.antlion.hit/death`, `mob.zombie.death`, `mob.goblin.hit/death` | Four Flare enemy sound families | Species-labeled hit/death clips where available |
| `reward.pickup`, `reward.levelup`, `ui.potion` | `flying_loot`, `level_up`, `inventory_potion` | Generic reward and inventory candidates |
| `ambience.cave.loop` | `environment/cave_wind_loop` | Cave ambience candidate |

These are catalog labels only. They do not claim that all cues are currently backed by server events. A client can play them only when the presentation layer binds them to actual delivered facts; this staged package does not alter the existing Soundscape, catalog, HUD, event mapping or mixer routing.

## Import recipe

1. Copy `Assets/Art/ThirdParty/FlareAudioExpansion/Raw/soundfx/` into the matching Unity project path, retaining the supplied `LICENSE.txt`, captured Credits files, and manifest.
2. Copy `Assets/Scripts/Presentation/ShowcaseAudioLibrary.cs` and `Assets/Editor/ShowcaseAudioLibraryImporter.cs` into the corresponding project paths.
3. Let Unity import the source audio with the project defaults. The importer does not change `AudioImporter` settings or mixer structure.
4. Run **Roguehalla → Audio → Import Flare Audio Library**. It creates or updates `Assets/Art/Derived/FlareAudioExpansion/ShowcaseAudioLibrary.asset`.
5. The asset is outside `Resources` and is not loaded automatically. Bind it only through an explicit presentation integration after review.

## Known coverage gaps

- The bow clip is a launch candidate; no distinct bow impact was selected.
- No separately credited wand cast/impact pair was selected.
- The Wish clips are thematic Flare effects; there are no separate cast and landing clips for each Wish in this bounded set.
- Creature audio covers four recognizable source families, not every game mob. No clip is labeled as an ogre/elite-specific cue.
- UI/reward coverage is limited to a potion cue, generic flying-loot cue, and level-up cue. No confirmed separate pickup, reject, toast, menu-activate, or item-tier cue is asserted.
- Only cave wind ambience is included; no lava, ice, or holy ambience clip is represented.
