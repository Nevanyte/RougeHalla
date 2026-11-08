# P-SENTENCED-NPC-SOURCES — draft for independent review

This is a proposed next Rust packet, not authorization, a version reservation or a gate change. Its prerequisite is the
reviewed Frost-source candidate `e38d16c30cde16bddfa7eef038076527fdabf433`, composed separately onto frozen
`1310ae002870bf3fc674c7b65f38ff5ea55a7d75`. The current protocol-13 browser milestone stays independent. The Frost
continuation privately uses checkpoint26/replay20; a further serialized Mark layout needs an explicit coordinator
format decision before implementation. Content registration, tapes, shared statuses and Cargo.lock remain lead-owned.

## Concrete remaining dependency

All five immutable `full-signature-source-born-{holy,fire,plague,frost,sentenced}-wish-recipients` cases in
`parity/abilities/source.json` use `rosterSignatures`, four actual Fire/Frost/Sentenced/Holy players and source-born camp
NPCs. Their common declared setup puts the first NPC into Return at HP500 and another at HP0.05, then submits normal
Fire, Frost and Sentenced Wishes and runs forty steps. Their declared placement/Return/HP setup must stay labeled;
their ordinary timeline/hook/event/RNG outputs must stay unchanged. Frost sources alone do not discharge them: each
case includes a Sentenced player attacking/marking NPC targets, and the Sentenced-zone case also has Sentenced NPCs.

Current blockers, with exact production seams:

- `systems/sentenced.rs`: `before_damage`, `qualifies`, `after_damage`, swap/denial hooks, public-tier/owner selectors and
  `validate` use player slots and a singleton player target. NPCs cannot produce Mark and player→NPC Mark is excluded.
- `fighter.rs::Mark` stores tier/hits/progress/swaps/denied/far_since/amp_until, with no stable group or original size.
  `systems/signatures.rs::before_damage` consequently clears a missing focused member rather than retaining a group.
- `modifiers/mod.rs::mark_pulse` accepts Player and player mirrors/stacks/Hunt. Generic NPC arithmetic must preserve
  the source distinction; passing a fake Player or folding player bonuses into NPCs is incorrect.
- `systems/ledger.rs::{Pass,apply}` and `TickScratch.mark_denials` hold eight singleton denial owners/foes.
  `sentenced::Denied` and Final Verdict return staging also assume eight sources. Merely extending producer loops
  leaves denial victims, group members and queued payouts incomplete.
- `systems/mob_checkpoint.rs` explicitly refuses any mob Mark/AP history. `abilities/effects.rs::Zone` recognizes
  only the caster's exact focused player target when selecting convicted radius. A group-aware Trial query is needed.
- `systems/mobs.rs::admit_factions` still correctly refuses Sentenced seats/camps/Full PvE. Preserve that refusal until
  the full packet is proven; do not create an Off or singleton-only profile and call the five cases complete.

## Required source semantics

Use the unchanged pinned `packages/server/src/sim/factions.ts`, particularly `signatureDamage`, `markHitsOf`,
`markStep`, `recordPulse`, `rebuildMarkIndex`, `markTierOn`, `afterDamage` and `onWeaponSwapped`; read its combat
ledger denial caller and `combatant.ts` standing/evading/classification alongside it. Important independent rules:

1. Source owners are every standing non-returning/non-evading Sentenced combatant. No mob→mob trade or Mark hit is
   introduced. Qualifying hits exclude signature/ability/DOT/passive/derived/final/arena rows, nonpositive rows and
   immune/evading victims. Preserve original ledger prefix/order before appending pulses.
2. Typed group identity is `camp:<source camp>` for a mob with positive camp, otherwise `fighter:<actor>`. Retain the
   original group size, captured at first Mark from standing non-returning group members. Live pulsed members are
   standing group mobs inside the owner's existing TARGET_RANGE leash and not returning. These are different sets.
3. Each qualifying hit advances hits/progress by the source MarkRate / prior cached chill floor. A grouped camp pays
   at most one pulse per live member that tick, even with multiple qualifying hits; singleton hits remain per-hit.
   Member share is min(1,1/sqrt(original size)); surviving members never grow stronger when siblings die.
4. The target pool is sheet faction HP for regional mob/elite recipients; player/dummy/owned-zombie singleton pools
   use actual maxHP. NPC owners have no player sentence/Hunt/bonus-mirror multipliers. Preserve source weapon weight,
   tier/denial amplifier, near/far and the owner's Trial-ring near exception.
5. Same-group contact preserves progress while changing focus. Source pre-pass and post-pass survivor selectors are
   distinct: preserve each exact returning/evading predicate and lexical source-ID tie order from the pinned code.
   Do not replace them with numeric ID order or a fresh reconstructed graph on restore.
6. Swap counts apply to every mark whose stored group matches the swapping actor. Pass-start denial membership stays
   frozen throughout the ledger and deferred payouts, then survivor cleanup/rebuild precedes public presentation.
   Player-only credit/notices/flags remain player-only; NPC ownership must not access seat arrays or gain sentence GV.
   Keep C-OBS owner eligibility before public owner selection; source lexical identity is a private parity diagnostic,
   never a new human/policy identity field. No hidden source/group membership becomes a decision input.

## Bounded storage and allocation decision

Reuse `FighterCore.signature`, retained actor provenance, map camp definitions, actual fighter ordering, typed birth/
practice/zombie constructors and the generic engagement/Frost recipient loops. Add a typed optional Mark group plus
original positive group size, not a fabricated per-member history list. Reset semantics must mirror source null/size1
and preserve amplifier linger. Canonical restore validates retained actor/camp provenance and domain bounds, not current
presence, current standing, current camp survivors or today's folded stats. Keep existing historical tier/MarkRate
envelopes and real mid-Mark card-grant/training-removal coverage.

Use retained ephemeral typed owner→member denial edges and reusable selection/pulse bookkeeping, prepared at actual
actor growth, restore and clone. No fixed eight/256 source cap or temporary per-tick Map/Vec/Set. A slot bitmap can
deduplicate the current owner's camp pulses; clear it between owners. Do not persist a derived Mark index.

Before coding the ledger hunk, prove a checked reserve from actual source domains: at most eight normal player owners,
each of whose one marked camp is bounded by that camp's declared spots (training's live practice bound replaces map
camps), plus regional/practice NPC owners each marking only a player singleton. Dummies/zombies are singleton
recipients and never Sentenced sources. This avoids assuming either an eight-edge bound or allocating a dense N²
matrix for arbitrary validated maps. Preserve synthetic benchmark domains separately if those APIs exercise this path.
Queued denial amounts must have retained owned storage through payout; report the exact per-owner reusable bank/
queue return seam and lifetime before replacing the current Copy array. No truncation, leaked work between ticks or
recomputation of membership after earlier victims die is acceptable.

## Proposed write scope and proof sequence

Necessary `rh-sim` Mark state/reset, Sentenced kernel, engagement/group selection, ledger denial/payout scratch,
modifiers pulse adapter, mob/training restore checks, source-tier Trial query and narrow diagnostic/parity consumers;
focused tests and additive source tools/corpora/evidence. No new NPC AI, movement, weapons, Wish mechanics, schedule,
public schema/client, bot strategy, ML or unrelated quest work. Report additional required production seams first.

Reviewable seam A is genuine typed NPC→player Mark with base arithmetic and generic denial ownership; keep PvE Full
closed. Seam B completes player→camp groups, historical storage, survivor/Trial behavior and all-fighter publication.
Only their complete reviewed union can justify existing Sentenced/Full gate admission. Inherited training choices
must remain usable; do not add a training refusal to conceal missing Sentenced behavior.

Required additive pinned-source witnesses and native comparisons:

- Actual catalog-rolled Sentenced melee and ranged camp NPCs attacking real players through ordinary AI/steps;
  reciprocal Frost and MarkRate/card controls, with declared construction inputs separate from expected outputs.
- Player→multi-member camp: multiple hits in one tick, original-size capture, once/member pulses, pool distinction,
  sibling death/Return/leash escape, focus handoff and fresh respawn IDs. Include lexical source IDs crossing a
  base36/numeric ordering boundary. Include player/dummy/zombie/campless practice singleton recipients.
- Tier-four pass-start denial from multiple owners/foes, death earlier in the same pass, exact amounts/queue order,
  player-only Final Verdict/credit/notices, and Trial convicted-radius/near exceptions on an unfocused group member.
- Uninterrupted versus freshly restored ordinary continuation, clone without input, reset/teleport/reap, each new
  serialized leaf hashed, malformed target/group/size/timer/counter/origin refusals, and no reconstruction of history.
- Warm allocation gates on the real source/group domain after birth/restore/reset; more than eight active edges,
  no dummy narrowing. Compiled mutants must expose per-hit duplicate group pulses, current-survivor size scaling,
  wrong regional pool, lost focus continuity, player bonuses on NPCs and mutable rather than frozen denial membership.

Existing five strict cases and expected files stay byte-exact and pending during both seams. At final integration,
adapt their native `rosterSignatures` setup and full comparator honestly (typed actor/gear/Mark/provenance plus every
ordinary timeline, event/hook and RNG continuation). Remove pending entries only when the exact five pass the complete
source profile; never flatten their FactionMode or substitute a weaker synthetic witness. The next packet's final
admission also needs independent source/native review and coordinator content/format/tape registration.
