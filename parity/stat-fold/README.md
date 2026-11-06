# Stat-fold capture schema

`canonical.json` is the compact, ordered actual-TypeScript oracle corpus (`rh-stat-fold/1`). Canonical generation and byte checking require Linux x64 Node 22.23.4:

```sh
node --import tsx tools/stat-fold/capture.ts --preset canonical
node --import tsx tools/stat-fold/capture.ts --preset canonical --check
```

`--check` never rewrites the file. Host captures require both `--diagnostic` and an explicit noncanonical `--output`. CI and soak captures are ephemeral and also require `--output`; they contain exactly 4096 and 100000 semantically distinct cases respectively. `inventoryBatch(preset, offset, count)` exposes deterministic bounded slices for the later runner.

## Corpus and numeric representation

Top-level keys are exactly `format`, `preset`, `provenance`, `coverage`, and `cases`. Case order is significant. Every case has exactly `id`, uint32 `seed`, `origin`, unique `tags`, `kind`, closed `input`, and complete `expected`. Semantic identity is the recursively key-normalized `{kind,input}`; metadata and expected answers do not participate in duplicate detection.

Every float input and output is `{"f64":"16 lowercase hex"}`, the exact big-endian IEEE-754 binary64 bit pattern. This preserves NaN payloads, infinities, and signed zero without JSON number conversion. In codec and mirror inputs only, `null` means an absent/`undefined` legacy field. Other nullable fields explicitly mean omitted context or an omitted per-stat boost.

Numeric records are fixed arrays, not objects:

- `STAT_KEYS`: `maxHp, attackSpeed, moveSpeed, damage, windup, lifesteal, markRate, healTaken, damageTaken, cooldown, executeBand, slowResist, lifestealMult, lifestealDot, critChance, healBarrier, armor, shield, ad, ap` (20).
- `MULT_KEYS`: `asPost, hit, dot, returned, ap, wishCooldown, hpRace, linger` (8).
- `MIRROR_FIELDS`: `asMult, windupMult, speedMult, armorBonus, shieldBonus, adBonus, apBonus` (7).
- `BOOST_STATS`: `ad, ap, armor, shield, maxHp, attackSpeed, moveSpeed, lifesteal` (8).
- `CONVERT_FROMS`: `ad, maxHp, bonusAttackSpeed, bonusMoveSpeed` (4). `CONVERT_TOS` is `STAT_KEYS` without `maxHp` (19), including the explicit no-op product target `lifestealMult`.

`fold.input` has `rows`, `farmRows`, `holds`, `farmHolds`, `owned`, `baseMaxHp`, `boosts`, `source`, and `farmAsEfficiency`. `holds` and `farmHolds` have one entry per corresponding row: a boolean at each `while` row location and `null` elsewhere. `owned:null` means no ownership callback; an empty array is an installed callback that owns nothing. `boosts` is null or eight nullable entries in boost order. `source` has `asMult`, `speedMult`, `windupMult`, `armor`, and `shield`.

`fold.expected` has 20-element `plain`, `sums`, and `farmSums`; 8-element `mults`; first-insertion-ordered `flags`; `maxHp`; and 7-element `mirrorsFromSums`, `mirrorsFromFold`, `encoded`, and `decoded`.

The other case kinds are:

| `kind` | Input | Expected |
| --- | --- | --- |
| `statFold` | `rows`, location-aligned `holds`, `owned` | 20-element `sums` |
| `requirements` | full `row`, `owned` | `met` boolean |
| `boostBonus` | `picks` | `bonus` |
| `boostGain` | `stat`, `picks`, `current` | `gain` |
| `multCodec`, `flatCodec` | independent nullable `value` and `wire` | `encoded`, `decoded` |
| `mirrors` | independent 7-element nullable `values` and `wire` | complete 7-element `encoded` and `decoded` |

All effect rows use the closed legacy payloads with float wrappers. This includes full `vs`, `scale`, `onHit`, and `trigger` payloads and every nested trigger action. Capture validates these payloads before calling the unchanged exports. The Rust comparator may subsequently project each validated row to a typed ignored marker retaining its kind; it must not treat an unknown kind or malformed ignored payload as ignorable. Farm `convert`, `mult`, and `flag` rows remain present in capture and are ignored by the actual stat fold.

`provenance` records canonical/diagnostic mode, reproducible capture command, commit, packet base, exact runtime, and SHA-256 for the five legacy source files and five capture tools. `coverage` is an ordered, unique `{id,count}` table; strict admission recomputes every count from case tags and requires all stat/mult/flag, requirement, while, conversion, interaction, codec, direct-kind, and actual card default/faction entries. Expected outputs are never supplied to `captureCase` or used as kernel inputs.
