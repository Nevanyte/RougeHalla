# Actual-source Frost NPC source capture

The new corpus is `parity/frost-sources/source.json`, format `rh-frost-sources-source/1`.
Its SHA256 is `9f5c1a4836ac6ea59b48883eb4beea44ceabfd53e08368cb704aeea26f159b12` (10,440,745 bytes).

The pinned capture and separate read-only byte check use:

```sh
bash tools/frost-source-fixtures/capture.sh
bash tools/frost-source-fixtures/capture.sh --check
```

The constructor profile, declared pre-world map transforms, explicit setup, snapshot schema, runtime/helper boundary,
and exact diagnostic operations are documented in `tools/frost-source-fixtures/README.md`. Five runtime cases contain
940 ordinary 50ms frames; three separately labeled helpers contain ten observations. Runtime cases use normal AI and
validated player commands. All outputs are passive actual-source reads, including signature IDs/order, HP, positions,
weapon/action clocks, events, landed damage and reward RNG counts/continuations.

Runtime assertions cover reciprocal NPC/player source membership, NPC base chill versus boosted player-only chill,
a diagnostic proving positive NPC shield/haste mirrors do not deepen its base chill,
and genuine Frost NPC Return with subsequent source exclusion. Helper assertions cover eleven unique ordered sources
with a repeated reciprocal edge, both-direction Return exclusion, dummy/zombie/Fire/Holy/Plague recipients, source death,
corpse removal, camp respawn with fresh IDs and teleport reset. Source lifecycle helpers and clock jumps are declared
inputs, not ordinary runtime or client-ability claims.

The ten-spot helper map uses the declared row-major layout with index 5 replaced by `(208,112)` before world
construction, preserving the map contract that source spots do not overlap the camp chest `(112,112)`. This input repair
changes only the new, unadmitted corpus.

The TS source files and all existing fixture corpora remain unchanged. This source evidence makes no separate claim
about native restore/hash/allocation coverage or wider Full-faction admission.

The recorder installs a throwing `Math.random` trap before any case world is constructed. Both the pinned capture and
read-only byte check pass with the trap. The seven existing case inputs, initial states, frames and RNG continuations remain identical
to the preceding map-corrected capture. The eighth case is the additive ordinary runtime witness described below. The structured constructor profile still
pins world seed 1, Mulberry32 seed 12 and the declared reward/quest salts. Nonfinite source signature times are
intentionally serialized as JSON `null` by the passive `plain` adapter (documented in the tool README), never replaced
with fabricated finite times.

The additive `runtime-ten-frost-npc-sources` case runs 220 ordinary 50ms steps on the corrected ten-spot map. A Holy
Sword player at `(80,112)` with declared HP 4000 targets the first camp NPC at script tick 0 and attacks at script
tick 2; a far Holy observer keeps the run active. Normal source AI and combat produce ten NPC chillers on the player
at source tick 20 / server time 1000ms, without helper engagement/mode/clock writes. The recorder asserts the maximum
source count exceeds eight. This is actual runtime support for the full ordered-source domain, additional to the
eleven-source helper uniqueness/order and lifecycle diagnostics.
