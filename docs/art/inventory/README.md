# Original-game asset inventory and unfinished work

Audited original/Unity snapshot: `70579162ce41a1325aaed1a65a34b65b779ad1e7`. Prepared expansion assets added after this snapshot are documented separately in [ASSET_EXPANSION.md](../ASSET_EXPANSION.md).

**The full original presentation is not port-ready.** The source audit tracks 125 presentation cues/families, 176 visual source modules, 57 cosmetic entries and 80 card IDs. These are different units; they must not be summed into a fabricated asset-completion percentage.

## All original visual elements

- [World, characters, weapons, map art, combat, statuses and VFX](legacy-world.md): named factions, mob identities/roles/elites, Wishes, fields, statuses, terrain/features/props, camps, loot, quests, targeting and vision.
- [Every interface family, hub, cosmetics, cards and audio](legacy-interface.md): menus, planning/map, HUD, rewards, results, reconnect/loading, help/settings, training, hub panels and all cosmetic/card IDs.
- [Machine checklist and complete source index](asset-checklist.json): all 125 original presentation entries with source references, actual Unity status and integration dependencies.

No imported binary media library exists in the original client; its shapes, sprites, icons and many effects are drawn/generated in code. The Unity replacement uses licensed Flare sprites plus original Unity-drawn presentation elements.

## What is incomplete

| Area | Current state | Remaining work |
|---|---|---|
| Players/factions | Two animated hero bodies; five palette/insignia treatments | Stronger five-way silhouette/garment/weapon identity, cosmetic set, final visual review |
| Enemies/elites | Goblin/skeleton coarse reuse; role/elite art absent | More creature/role families, role glyphs, elite emblems, all 30 named type coverage |
| Environment | Procedural floor/walls; three extracted dungeon props | Authored biome floors/wall faces, 34 prop families, landmark/gate/hub dressing, ground-contact/footprint review |
| Combat/VFX/particles | Delivered swing/hit/block/status/field/Wish paths | Distinct polished weapon/Wish shapes, impact variety and bounded particles; many windup/terminal/status details await public facts |
| Audio | Eight licensed clips, three mixer groups, volumes/unlock | Full coherent cue library, biome ambience and listening/masking pass |
| UI | Join, basic HUD/build/reward/result/settings/reconnect | Full original hub/planning/minimap/inspectors/cards/quest/trade/training/help/leaderboard surfaces |
| Authoritative integration | Protocol13 all-five-Wish and Trophy proof accepted | Separate missing data/mechanic contracts; no local guessing or gameplay rules in presentation |
| Final showcase acceptance | Existing browser proof is revision-specific | New asset import/animation/preview checks, then approved live integration and measured High 1440p/144Hz acceptance |

Every row in the machine checklist remains **partial**, **missing**, or **new-partial** against the full original-game art target. Functional browser proof and art completeness are separate. No family is signed off merely because server facts are available.

## Work begun with Luna

1. Source-backed world/actor/combat and interface audit, exact catalogs, incomplete list and source index.
2. Imported free Flare expansion: five additional creatures, two composed mage appearances (1,896 animation sprites) and 12 cave samples; isolated catalog/importer/workshop with source hashes and credits.
3. Implemented five presentation-only faction particle studies; 32-particle cap each, persistent non-hue marks and reduced-motion controls. Authoritative live binding is a separate step.

[Actual Unity render and verification report](evidence/README.md). The workshop is an art review tool; its displayed sample sizes do not establish live world scale or obstacle footprints.

This inventory does not alter gameplay, protocol, shared migration status or the accepted protocol13 Web artifact.
