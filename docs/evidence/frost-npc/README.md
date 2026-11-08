# P-FROST-NPC-RECIPIENTS-1 evidence (repair continuation, closed)

Player Frost sources chill the existing source-born basic Fire/Holy/Plague regional NPC recipients with the same source
semantics as factions.ts updateChill. The repair continuation keeps the delivered base corpus immutable, binds the actual
source profile, adds additive Plague/bow-draw/death and genuine Return-mode corpora, strengthens the consumer, and adds
dedicated Frost-tuple restore tests for the training practice/dummy and owned-zombie adapters.

## Fix and helpers (crates/rh-sim/src/systems/frost.rs)

- Recipient access in ranged_hits, after_damage and after_weapons is generalized through fighter_idx/core/core_mut/
  standing, reusing FighterCore.signature and the actor-reserved scratch.attack_started populated by generic weapons. No
  serialized field, duplicate NPC Frost runtime, new command, config, clock, RNG stream or module order was added; chiller
  sources remain roster player ids. The instant attack_started hook stays player-only exactly like the source; NPC attacks
  started this tick are corrected in after_weapons. The extracted pure helpers resisted_attack_chill/resisted_move_mult
  keep their delivered arithmetic/signatures. after_damage rebuilds each victim's chiller list without per-tick allocation.
- Bound profile: native Sim consumers set consumables=false (delivered code wrongly enabled the omitted installer),
  quests=false, abilities=Off, lifecycle=Off, hazards Off, initial_loot=false, regen=false, training/dummies=false, PvE
  and the four admitted factions, with min_players/lobby/fill bound from the source config; profile/inert scope asserted.
- No source mode, path or outcome is injected, and no weapon is written into the world after construction. The
  additive Plague-bow/Holy-wand boundary cases select their zone through a DECLARED PRE-WORLD MAP VARIANT: the capture
  clones the declared pve-dot map and applies the same zone-swap construction the delivered base capture uses for its
  Holy case (region id / camp zone / region grid / spawn pool, plus the region-view camp weapon hint), before
  createWorld; the native Rust consumer applies the same declared variant before reset_active. The source's unchanged
  camp generator then spawns the swapped zone's own roster types and their carried weapons - the captured Plague camp is
  Rat Ogre (elite, bow) + Miasma Witch (wand), the Holy camp is Blood Saint (wand) + Zealot (sword). The transform is
  pinned by the recorder hash and the declared-map input hash; there is no post-world/poststate injection, and the frames
  observe real source state and commands only. Shipped source Plague rosters natively include bow roles (Plague Rat,
  Bloatfly, Rot Monk, Rat Ogre), so the separate Plague/admitted-bow coverage is a declared map-variant substitute rather
  than an unknown-role claim.

## Source/native proof

- parity/frost-npc/source.json is byte-identical to the delivered base corpus
  (sha256 4d1fafe91f8bbf61518c420c88017d69be3ab0d4c4aca1fdf042e435ad0cd20a); the delivered capture.mts/capture.sh are
  unchanged, so the original three semantic payloads are immutable.
- Additive boundary corpus parity/frost-npc/boundary.json (sha256 a4161772b993b9781ad5e278d58a37c585d0c22ebea7eb233ea885cc71ab368f): declared pre-world map-variant Plague
  recipients and source roster-generated NPC bow draws (160 frames), Holy Frost bow near+ranged overlap/thaw (170),
  non-Frost DoT death/camp alive lifecycle control (104, documented damage drift), no-Frost Plague control (120). The
  metadata polish changed only the profile label: boundary profile.config.minPlayers is the resolved 2 (with a separate
  minPlayersFormula field and a weaponSource label); the four case payloads are byte-identical to the previous corpus
  (canonical case sha256 7ec82bae3ffa0fecff8e9b3af8d1a7171dabe83723699a6bf1b6431d8394a2c7), and the base source.json is
  untouched.
- Additive Return corpus parity/frost-npc/return.json (rh-frost-npc-return-source/1): a Frost bow player pulls the Fire camp
  across the camp's real 192-unit territory leash and dies; the two far observers keep the run active, the source mobAI
  drops the target and genuinely emits brain.mode "return" frames walking home (13 frames observed; homeward path,
  target=null, holding=false), followed by the idle/reset home state. The no-Frost puller control repeats the Return
  lifecycle. Nothing about the mode is fabricated or injected: it is read from the source state after the source's own
  give-up path. The consumer compares the return/brain/path/home/holding facts and the puller-death/phase lifecycle.
- Strong consumer on all three corpora: typed birth-provenance actor keys (camp/elite/catalog type/home), fail on
  missing/unexpected actors; compares position/facing/hp/maxHp/status/weapon/readyAt/drawStartedAt, brain mode/target/
  holding/home/path, camp alive/clearedAt/respawnAt/type/elite, landed hits, typed fx windup/swing/hit/projEnd/heal/
  stagger/block/death counts, and restored next-4 reward draws as the continuation witness; strict restore per frame;
  malformed tuple/source/AP refusals and preserved gear/Mark checks; missing-actor negative control; provenance-only
  NON-kill control. Containers/full private event queue/DoT detail/draw count stay outside the compared claim.

## Smallest Frost validation adapters and dedicated tests

- Training validate_actors now calls frost::validate_signature for every practice mob and dummy, plus the same AP
  provenance rule (valid history, known target) the basic actor admission enforces; the existing practice-camp/dummy
  private rules are unchanged. Test training_practice_and_dummy_frost_tuples_restore_and_refuse_malformed:
  actual Train camp command and training dummies, trusted bow loadout staging, actual enqueued bow attacks; the genuine
  tuple reaches a practice mob and a stationary dummy (chill/chillers, dummy exposure/last-near/ranged/move/SIG_CHILLED
  bits), restores through the training checkpoint and continues identically, and refuses chill 0.4, non-roster chiller,
  forged AP target and the existing malformed practice camp/max-HP states.
- Owned zombies: mob_checkpoint's typing branch calls frost::validate_signature and the AP provenance rule, without the
  regional gear/Mark checks. Test owned_zombie_frost_tuple_restores_and_refuses_malformed: the actual raise_or_grow
  constructor creates the companion, an actual Frost bow hit reaches it (chill/chillers, ranged, exposure/last-near,
  movement), the PvE checkpoint restores/continues it, and chill 0.4, non-roster chiller, forged AP and the existing
  unknown-owner rule are refused.
- Discovered while testing the owned-zombie form: the PvE camp alive-count check counted an owned zombie (camp 0) as a
  camp-0 roster member, so a legitimate owned-zombie PvE checkpoint could not restore. The smallest fix excludes
  zombie.is_some() actors from the camp alive count; zombies are still validated by their typed branch. No other private
  rule or faction admission gate was changed.
- The same file's chilled-NPC Draw allowance is bounded to the actual one-step Frost stretch described below; every
  other action clock/share rule stands.

## Checks and mutants

- frost module 17/17 (all three source corpora, the restored hook test, malformed refusals, and the two new adapter
  tests); signatures PvE 4/4; training 14/14; zombie-filtered 1/1; checkpoint 6/6; replay 6/6; content 21/21;
  no-allocation 1/1; cargo fmt clean; both strict rh-sim clippy modes clean.
- All three capture --check runs byte-identical: base source.json (4d1fafe9...), boundary.json (a4161772...), return.json;
  both doubles are exact.
- Compiled semantic mutants 3/3 killed against the actual consumers (01 missing NPC recipients, 02 instant-NPC hook
  timing, 03 NPC restore rejection); the unchanged Frost control passes; the provenance-only mutation remains NON-kill.

## Remaining prerequisites

No serialized schema/checkpoint/replay/hash-coverage/content/schedule/format/protocol/server/client/Cargo.lock/shared
status edits. The reachable NPC/practice/dummy/zombie Frost state is the already-hashed FighterCore.signature; identity
fold/content registration stays with the lead.

The full NPC Frost/Sentenced source admission stays held; the five strict Wish-case prerequisites remain the five
full-signature-source-born-{holy,fire,plague,frost,sentenced}-wish-recipients cases. The repair packet's Return-mode and
training/owned-zombie Frost-tuple items are covered by the additive corpora/tests above.

## Bounded future Draw clock repair

The original `ee07c9d0` allowance (`Draw`, `chill < 1`, `started_at <= lands_at`) also admitted arbitrarily distant finite
future start/landing pairs. The follow-up changes only PvE restore validation, one dedicated source-consumer test and
this evidence note; it changes no runtime producer, serialized field, identity, source fixture or admission mode.

`weapons::step_weapon` starts a newly ready action no later than `now + TIE_EPS_MS`; a retained action has already
advanced through the next 50 ms step. `frost::after_weapons` replaces the new start by an interpolation toward `now`,
so it cannot increase that upper bound. `frost::after_damage` then shifts a Draw's start by
`stretch_until(lands_at, now, 50, current_chill) - lands_at`. In both branches of `stretch_until`, this increment is at
most `(1 - current_chill) * 50`. It follows that a future start is bounded by
`now + (1 - current_chill) * 50`, plus weapon readiness and floating-point tolerance. Prior chill/resistance can change
within the step; recomputing the bound from prior/current stats or imposing the prior chill would reject valid history.
The validator uses the cached post-damage chill and `max(TIE_EPS_MS, 8 * f64::EPSILON * max(now, 1))` tolerance for the
short clock-arithmetic chain at every admitted clock magnitude. The existing `lands_at >= started_at` rule remains.

`source_npc_future_draw_stays_within_one_step_and_refuses_forged_future` replays all 160 frames of the unchanged actual
source Plague-bow case through validate/submit/step and the source comparator, restoring after every frame and continuing
from that restored state. All 15 real future Draw starts remain accepted. The source's first one changes chill from
0.68 to 0.505 within its producing step and is 24.75 ms in the future, so this witness also guards against a prior-chill
bound. For each real future Draw, ordered finite start/landing pairs shifted just outside the envelope, by 10 seconds,
and to 1e300 are refused specifically as `invalid mob pending attack`. The old production allowance accepts the first
forgery, making this regression fail semantically. This is a reachability bound, not a complete omitted-history proof.

Focused repair checks: `cargo test -p rh-sim --all-features --lib systems::frost::tests::` 18/18;
`systems::signatures::pve_tests::` 4/4; `checkpoint::tests::` 28/28; `cargo fmt --all -- --check` PASS;
`cargo clippy -p rh-sim --all-targets --all-features -- -D warnings` and the default-feature equivalent PASS.
The isolated check used its own Cargo target. No source capture, full-map campaign or unchanged broad suite was rerun.
The typed source-actor comparator follow-up remains a separate composition; these checks do not open Full NPC Frost or
the five strict source-born Wish recipient cases.
