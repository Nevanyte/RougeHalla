# Original faction, role and elite identity kit

`ShowcaseIdentityAssets.cs` and `ShowcaseIdentityOwner.cs` provide cached original Unity sprite geometry for the staged identity preview and an optional actor-root owner. They are presentation only. No image generation or third-party artwork is used. The source list mirrors `client-unity/RoguehallaNet/Net/Views.cs::MobTypeId` and the canonical legacy `packages/shared/src/mobs.ts::MOB_TYPES` rows; enum identity selects only authored art metadata.

## Visual language

The identity owner layers one faction mantle, one faction badge, a mob-role badge for known regional mobs, and a separate elite crest only for known elite mob types. Every badge uses an opaque near-black disk with a bright ivory border and a distinct white glyph, which leaves a strong luminance boundary even when faction color cannot be seen. The mantle carries the faction color and a dark vector cut detail; it is placed across the upper torso below the health and status rows. The badge row sits above the torso and below the overhead bar. It does not cover the held-weapon hand.

| Faction | Silhouette overlay | Glyph / shape cue |
|---|---|---|
| Fire | Split obsidian shoulders, twin upward horns, two vent cuts. | Pointed flame inside a triangle; ember-red color is secondary. |
| Sentenced | Faceted iron diamond mantle with hanging chain corners and chain-loop cut lines. | Diamond and paired loops; amethyst is secondary. |
| Plague | Ragged cowl, torn lower edge and three crown spores. | Three linked lobes; toxic green is secondary. |
| Frost | Angular shoulder plates and three-point crystal crown with crossed facets. | Sixfold crystal spokes; ice blue is secondary. |
| Holy | Ivory mantle with raised collar and halo arch. | Ring, cross and four diagonal rays; gold is secondary. |

Role glyphs use a distinct core geometry: shield/grunt, three motes/swarm, hex plate/brute, arrow/skirmisher, and staff-orb/caster. The role badge is separate from the elite badge, so an elite keeps both its ordinary role cue and its named crest.

## Canonical MobTypeId map

`TryGetMobInfo` uses explicit, checked enum-index rows. It does not derive faction from modulo or actor appearance. `TryGetEliteIndex` explicitly names the 10 elite ids.

| Zone/faction | Normal types and role | Elite types and role |
|---|---|---|
| Fire | Ember Imp—Swarm; Cinder Hound—Skirmisher; Magma Brute—Brute; Flame Caller—Caster. | Wyrmling—Grunt; Ash Drake—Caster. |
| Sentenced | Bailiff—Grunt; Chain Warden—Brute; Inquisitor—Skirmisher; Pardoner—Caster. | Executioner—Grunt; Gaoler—Brute. |
| Plague | Plague Rat—Swarm; Bloatfly—Skirmisher; Rot Monk—Grunt; Miasma Witch—Caster. | Rat Ogre—Brute; Pox Behemoth—Brute. |
| Frost | Frost Wisp—Swarm; Ice Golem—Brute; Rime Stalker—Skirmisher; Frostbow Sentry—Caster. | Glacial Warden—Grunt; Avalanche Troll—Brute. |
| Holy | Acolyte—Grunt; Seraph Shard—Swarm; Penitent—Skirmisher; Zealot—Brute. | Blood Saint—Grunt; Archon—Skirmisher. |

The named elite crests are distinct: Wyrmling horned shield; Ash Drake wings; Executioner axe; Gaoler key; Rat Ogre round ears and tusks; Pox Behemoth boil cluster; Glacial Warden three crystals; Avalanche Troll boulder shoulders; Blood Saint halo and drop; Archon eight-ray star.

## Owner API and lifecycle

- `ShowcaseIdentityOwner.Configure(groundedParent)` creates/reuses one fixed child renderer owner directly below an actor root. Configure once when that root is created.
- `Present(faction, kind, mobType, groundSortingOrder, visible)` receives already-delivered identity facts. A player uses its public faction. A regional mob uses only the `MobTypeId` catalog row to choose faction, role and elite emblem. It changes cached sprite references, renderer enabled states and sorting order without creating scene objects or strings.
- `Clear()` hides the fixed renderer set. Disabling the actor root also hides it through normal Unity hierarchy behavior. A pooled root should call `Present` with its new delivered identity after reuse and `Clear` when evicted.
- Unknown/future MobTypeId values, zombies without an admitted MobTypeId, training dummies and invalid faction values use the neutral mantle/glyph. They never borrow a neighboring type's art, infer an owner, or display an elite badge.
- `ShowcaseIdentityAssets` lazily creates each vector sprite once, stores it in a static cache, and uses the already-cached `ShowcaseSprites.Unlit` URP 2D material. Sprite/texture objects live for the application/editor domain; renderers are actor-root owned. The owner creates exactly seven renderers once and performs no per-frame allocations.

The helper is not wired to gameplay or visibility policy. A live caller must pass only current observer-visible actors and clear/disable the owner on hidden, removed, dead/pool-reset or reidentified roots. The parent renderer remains responsible for actor lifecycle and for avoiding any hidden-state reveal.
