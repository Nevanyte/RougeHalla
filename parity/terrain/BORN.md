# Normal source-born NPC terrain extension

`born-source.json` (`rh-terrain-born-source/1`) appends21 bounded cases and88 action
frames to the original terrain witness. Every original v1 file remains byte-identical,
including all66 runtime cases and the five trusted NPC/reset cases. Original fixture
SHA256: `e6f870eca04de9ae537f2e367f32b357dada7c6d56b6d3d3712bc095486f1030`.

The extension executes unchanged legacy source in the same pinned official Linux amd64
Node22.23.4 image. It uses the existing `tools/pve-dot/declared-map-input.json` fixture
(copied byte-for-byte to `tools/terrain-fixtures/born-map-input.json`) and the same exact
zone-swap procedure already used by the Basic PvE parity consumer. Each case declares a
single floor-terrain overlay at tile(7,7), whose centre is(240,240). The complete original
map is present as `constructorInputMap`; the per-case zone and overlay are inputs, not
changes inferred from expected actor output. Map class compatibility and normal mapdata
admission remain required; this synthetic map is not a generated-map terrain certificate.

## Construction boundary for native consumers

1. Apply the declared zone swap to the complete input map: swap its Fire region with the
   selected zone, update that camp's region/id/weapon, swap matching region-grid codes and
   spawn-pool zone values, put region records back into canonical faction order, then derive
   the map's spawns from that order. Apply the declared terrain overlay to the existing floor.
2. Build the actual world with main `mulberry32(12)`, reward salt `[1,2,3,4]`, quest salt
   `[5,6,7,8]`, sequential item IDs and the exact listed module order. Faction signatures are
   absent (`FactionMode::Off`); this preserves normal NPC catalogs while admitting all five
   factions. The selected Basic PvE modules include normal roster rolling and life/AI hooks.
3. `constructed` records the result before players join: actual rosters, entity and item
   counters, order/hash salts and every main/reward/quest draw in consumption order.
   Nothing seeds or replaces an already-advanced source RNG. The source constructor consumes
   its normal order-salt/loot prefix before the normal roster reward draws.
4. Add the two declared players normally, then call one actual50ms `step`. The actual
   `raidStarted` chain must spawn the complete three-NPC camp roster. `born` snapshots every
   actor before any scenario placement, including actual catalog type, max HP, weapon,
   camp, birth order, home coordinates/facing and brain state. Source IDs are normal
   `mob1`, `mob2`, `mob3`; native IDs should use the existing legacy-ID mapping, not a
   new fabricated actor namespace.
5. Apply the declared player placements, as `Sim::reset_active` does; then replay each
   declared action against those already-born actors. `setupBorn` may position an actor,
   reset its position history/slide, set a path or an explicit HP/mode boundary. It never
   alters NPC ID, type, faction, max HP, camp, birth order, home/homeFacing, threat, RNG or
   provenance. The harness asserts unchanged birth identity after every action. A native
   comparator should use its normally constructed world and mirror these same named
   trusted setup operations, retaining strict checkpoint provenance validation.

This boundary supplies actual birth history; reading expected mob fields and constructing
substitutes from them would defeat it. No new native actor-admission exception is justified
by these fixtures. Ordinary valid restores must still be checked after source-matching
setup/actions and across continuations.

## Actions and coverage

Every `frames[i]` is the state after `input.actions[i]`. Initial constructed/born/player
placement snapshots are separate. `state` contains the actual source schema output;
`private` contains path/history/slide, weapon, statuses, brain and credit details. All of
these private values and RNG tapes are test evidence, never a client projection.
`arenaHurt` contains the actual source hook's victim/source/HP report after the original
hook has run; it is an observational tap. Nonfinite clocks retain explicit string encoding.

- Ten short cases cover all five normally born NPC factions on ember in Map and All modes,
  including source home exemption, actual ledger shape, damage statistics, no combat contact
  and ordinary continuation. Each has one50ms and one12.5ms direct burn pass, then a normal
  50ms tick. The returning case separately proves burn exclusion while ordinary return
  regeneration and walking continue.
- The death-credit case enqueues a real player's sword attack through actual
  `enqueueClientMessage`, then uses an explicit existing-NPC HP boundary. The real hit's
  accumulated threat gives the environmental finishing kill its source credit: the elite
  dies, the actual death callback names the player and the actual source awards29GV.
  No threat or contributor list is inserted by setup. One normal tick follows the death.
- Ice cases cover Frost Map/All home behavior, actual history-carried velocity, traction,
  crossing off the one-tile surface, regrip, Holy return motion and normal AI/input/tick
  continuation. A full source `teleported` hook then resets the NPC to its original home.
- Plague Bog Map/All cases call actual `applyBog`, `slipAccelOf` and `surfaceOf` on the
  normally born NPC, keeping the source home-rule distinction explicit.
- Holy Light Map/All cases start a normally born NPC and its player at100HP. They call
  only the actual installed terrain system, so mob regeneration does not confound light
  eligibility. The player heals; the NPC remains100HP. The source Holy boost is preserved
  in Map and removed in All.
- Two normal-born reset cases call the terrain-only teleport/raid-start functions obtained
  through the exported terrain installer on an isolated deterministic hook-only world.
  Those functions are executed against the actual source-born world. The isolation avoids
  accidentally calling the full raid-start chain a second time and spawning a second camp.
  All actual-born player/NPC slides and the terrain clocks/accumulation are observed.

Direct `burn` actions execute actual `markTickStart`, installed `beforeDamage` functions
and actual `applyLedger`. Direct `walk` actions execute actual `walkFighter` with the
explicit supplied multiplier. Ordinary `step` actions always advance exactly50ms and
execute the normal module pipeline. Input actions are real queued player messages;
there are no manually calculated source expected values.

## Event recorder boundary

The original v1 player ordinary-light wrapper assigned the returned event array back to
`world.events`. It therefore retains the first three genuine heal events, generated at
1000ms, in each of the last five captured frames (15 entries if those arrays are flattened).
This is a v1 recorder queue-reuse artifact; its gameplay and private numeric state are
unaffected. The original ordinary ember/bog traces have no events. Keep v1 immutable and
compare its genuinely new event suffix, or explicitly reproduce that declared recorder
queue behavior; do not claim repeated retained entries were independently emitted.

The new born recorder passes returned events directly to its snapshot and never reinserts
them. Direct-action event queues are drained once. These new event arrays are per-action
outputs and can be compared directly.

## Canonical check

```sh
tools/terrain-fixtures/born-capture.sh --check
```

Capture and check each execute the harness exactly once. `RH_TERRAIN_BORN_DIRECTORY`
selects a different output directory. This extension does not replace the v1 capture or
re-run its canonical comparison. Native runtime, strict restore/hash coverage, public
privacy and headless/policy verification remain the implementation consumer's gates.
