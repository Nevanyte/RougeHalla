# P-FROST-NPC-RECIPIENTS-1 evidence (repair continuation)

Player Frost sources chill the existing source-born basic Fire/Holy/Plague regional NPC recipients with the same source
semantics as factions.ts updateChill: strongest engaged source, Iron Will resistance through the folded victim accessor,
the near/ranged minimum and quantization for movement, exposure/thaw episodes and cooldown/draw correction. The repair
continuation keeps the delivered base corpus immutable and adds a bound profile, a stronger typed-provenance consumer,
an additive boundary corpus, and the smallest Frost validation adapters for the other admitted actor forms.

## Fix and helpers (crates/rh-sim/src/systems/frost.rs)

- Recipient access in ranged_hits, after_damage and after_weapons is generalized through fighter_idx/core/core_mut/
  standing, reusing FighterCore.signature and the actor-reserved scratch.attack_started populated by generic weapons. No
  serialized field, duplicate NPC Frost runtime, new command, config, clock, RNG stream or module order was added; chiller
  sources remain roster player ids.
- The instant attack_started hook stays player-only exactly like the source (c.kind !== "player"); an NPC attack started
  this tick is corrected in after_weapons. The extracted pure helpers resisted_attack_chill and resisted_move_mult keep
  their delivered arithmetic/signatures (the lead re-uses them for content registration).
- after_damage rebuilds each victim's chiller list by scanning the standing fighters in source order instead of allocating
  a per-tick buffer, so the zero-allocation gate stays green.
- Bound profile: the native Sim used by the source consumers now sets consumables=false (the capture's installer list
  omits that installer; the delivered code wrongly enabled it), quests=false, abilities=Off (installer present but no
  producer used in the bounded cases), lifecycle=Off (the 3600 s source timers are outside the bounded window), hazards
  Off, initial_loot=false, regen=false, training/dummies=false, PvE + the four admitted factions, and min_players/lobby/
  fill bound from the source config. The consumer asserts this binding and the source profile's structured config/inert
  list; it does not claim full-world equality.

## Source/native proof

- parity/frost-npc/source.json is byte-identical to the delivered corpus (sha256 4d1fafe91f8bbf61518c420c88017d69be3ab0d4c4aca1fdf042e435ad0cd20a);
  the delivered capture.mts/capture.sh are unchanged. The three original semantic payloads are therefore immutable; the
  repair is additive.
- Additive harness tools/frost-npc-fixtures/capture-boundary.mts + capture-boundary.sh produce parity/frost-npc/
  boundary.json (rh-frost-npc-boundary-source/1, sha256 c4b967b9440fb44c59519c8d3c17cfca6ffe7369c1ee385014ea7b45f1c3fded):
  four cases, all replayed by the same consumer. Plague case: real source-born Plague recipients and genuinely admitted
  NPC bow draws (the Plague camp weapon is a bow), 160 frames. Holy case: a Frost bow near+ranged overlap and the
  thaw/exposure timeline, 170 frames. Death/lifecycle control: a non-Frost Fire/Plague DoT kills a camp NPC and the camp
  alive count drops, 104 frames (its small Fire DoT/heal damage drift is documented and excluded from the Frost claim;
  the consumer stops strict comparison at the control's phase divergence). No-Frost Plague control: every NPC stays
  unchilled with unchanged movement, 120 frames.
- Strong consumer on both corpora: resolves every source actor key through typed birth provenance (camp, elite, catalog
  type, home), never a contiguous-id assumption, and fails on an unexpected/missing signature actor; compares players/NPCs
  on position/facing/hp/maxHp/status/weapon/readyAt/drawStartedAt, NPC brain mode/target/holding/home/path, camp alive/
  clearedAt/respawnAt/type/elite, landed hits (by/victim/weapon/sig/amount), source fx windup/swing/hit/projEnd/heal/
  stagger/block/death counts against the typed native events, and the restored state's next four reward draws as the
  continuation witness. Containers, the full private event queue, DoT tick details and the source draw count are outside
  the compared scope; no all-world/RNG equality is claimed. The missing-actor comparator control is asserted, and a
  provenance-only metadata mutation is a NON-kill control.
- Strict restore/continue after every source frame for every case, malformed tuple/source/AP refusals (chill 0.4 below
  the reachable image, non-roster chiller, forged AP target) and the preserved basic gear/Mark checks are retained from
  the delivered consumer.

## Smallest Frost validation adapters (other admitted actor forms)

- crates/rh-sim/src/systems/training.rs validate_actors now calls frost::validate_signature for every training practice
  mob and dummy before restore, so a chilled training actor's tuple is validated instead of silently skipped (map_err to
  the existing static refusal; no other private rule weakened).
- crates/rh-sim/src/systems/mob_checkpoint.rs owned-zombie branch now calls frost::validate_signature on the zombie's
  shared signature before its continue; the regional gear/Mark checks stay skipped exactly as before.
- The same file's chilled-NPC Draw form allows started_at past server_time only when the action is a Draw, the NPC is
  actually chilled (signature.chill < 1) and started_at <= lands_at: that is the source-produced afterWeapons/afterDamage
  stretched Draw form. Every kind/weapon/target/share/finiteness rule is unchanged.
- Existing suites gate these adapters (training 14/14, checkpoint 6/6, replay 6/6, the zombie-filtered test 1/1); a
  dedicated Frost-tuple training/zombie refusal test is not yet added (reported as remaining work, not claimed).

## Checks and mutants

- frost module 14/14 (includes both strong source consumers, the restored player-only hook timing test and the malformed
  refusals); signatures PvE 4/4; training 14/14; zombie-filtered 1/1; checkpoint 6/6; replay 6/6; content 21/21;
  no-allocation 1/1; both strict clippy modes clean; cargo fmt --check clean.
- Base capture --check byte-identical (exit 0) and boundary capture --check byte-identical (exit 0); both tool runs are
  deterministic double runs.
- Compiled semantic mutants: 01 missing NPC recipients, 02 instant-NPC hook timing and 03 NPC-restore rejection are all
  killed against the actual consumer outputs (3/3); the unchanged Frost control passes. Provenance-only metadata remains a
  NON-kill control.

## Compatibility and remaining prerequisites

No serialized schemas, checkpoint/replay format tags, hash coverage, content registration, schedule/format tables,
protocol/server/client files, Cargo.lock or shared statuses were changed. The reachable NPC/zombie/practice Frost state
is the already-hashed FighterCore.signature; identity fold/content registration stays with the lead.

Explicit remaining gaps (not hidden):

1. Return-mode coverage is still open. Bounded source runs (including a low-hp death/return attempt) produced idle/fight
   only, so the corpus does not claim brain.mode "return" parity. A dedicated long leash/return capture is required
   before that packet requirement can be marked closed.
2. The full NPC Frost/Sentenced source admission stays held; the five strict Wish-case prerequisites remain the five
   full-signature-source-born-{holy,fire,plague,frost,sentenced}-wish-recipients cases.
3. Training/owned-zombie Frost-tuple adapters are exercised only by their existing suites; dedicated test cases for the
   newly reachable tuples are still to add.
