# P-FROST-NPC-RECIPIENTS-1 evidence

Player Frost sources now chill the existing source-born basic Fire/Holy/Plague regional NPC recipients, with the same
source semantics as `factions.ts updateChill`: strongest engaged source, Iron Will resistance through the existing folded
victim accessor, the near/ranged minimum and quantization for movement, exposure/thaw episodes and cooldown/draw correction.

## Fix and helpers (crates/rh-sim/src/systems/frost.rs)

- Recipient access in `ranged_hits`, `after_damage` and `after_weapons` is generalized through the existing
  `fighter_idx`/`core`/`core_mut`/`standing` accessors, reusing `FighterCore.signature` and the actor-reserved
  `scratch.attack_started` populated by generic weapons. No serialized field, duplicate NPC Frost runtime, new command,
  config, clock, RNG stream or module order was added; chiller sources remain roster player ids.
- The instant `attack_started` hook stays player-only exactly like the source (`c.kind !== "player"`); an NPC attack
  started this tick is corrected in `after_weapons` instead. The extracted pure helpers used by the runtime are:
  `pub(crate) fn resisted_attack_chill(min_chill: f64, resist: f64) -> f64` and
  `pub(crate) fn resisted_move_mult(raw: f64, resist: f64) -> f64` (resistSlow then the source quantization), used at
  the same source positions/order.
- `after_damage` rebuilds each victim's chiller list by scanning the standing fighters in source order instead of
  allocating a per-tick buffer, so the zero-allocation gate stays green.
- NPC validation: no adaptation was needed. `mob_checkpoint` already calls `validate_basic`, which invokes the shared
  Frost validator; the tests prove a genuinely chilled basic NPC restores and continues, while unreachable chill,
  non-roster chiller sources and forged AP provenance are still refused, and the basic gear/Mark checks are unchanged.

## Source/native proof

- `tools/frost-npc-fixtures/capture.mts` + `parity/frost-npc/source.json`: pinned Linux-amd64 Node22.23.4 actual-source
  capture through the declared pve-dot map/config profile and the unchanged installers (including `bruiserPassives`, so
  Frozen Justice matches the native PvE config); real target/attack/release client messages; passive post-step
  observation only; complete source/tool/package-lock/map/image provenance; deterministic double run and byte-identical
  `--check`.
- Consumer test `actual_source_player_frost_chills_basic_npcs_with_strict_restore`: replays each source frame through the
  native PvE Sim and compares the source/native timeline for NPC chill, chillers, exposure/last-near, ranged chill window,
  frost movement multiplier, NPC readyAt/bufferedUntil/drawStartedAt/action clocks (proving the after_weapons clock
  correction), plus the strict restore of the actual chilled NPC state after every frame and a 3-step continue replay;
  the no-Frost case pins the unchanged control; chilled NPCs keep their basic gear and zero Mark/AP state.
- `instant_attack_started_hook_is_player_only_and_npc_timing_corrects_in_after_weapons`: an instant NPC swing is not
  corrected by the player-only hook but is corrected by after_weapons; the same instant player swing is corrected by the
  hook, pinning the source distinction.

## Mutants (compiled, actual output assertions)

`tools/frost-npc-fixtures/mutants/01-missing-npc-recipients.patch` (after_damage limits victims to players) -> the source
timeline parity consumer fails; `02-instant-npc-hook-timing.patch` (hook extended to NPCs) -> the player-only hook control
fails; `03-npc-restore-rejected.patch` (reject the newly reachable chilled NPC state in the Frost validator) -> the strict
restore/continue consumer fails. The runner applies each patch to a disposable copy, requires `test result: FAILED` for the
targeted consumer, restores, and then requires the unchanged 13-test Frost module control to pass.

## Compatibility and remaining prerequisites

No serialized fields or observation leaves were added; state/checkpoint/replay/hash-coverage/schedule/content/format
schemas and all earlier source expected bytes are unchanged (content 21/21, checkpoint 6/6, replay 6/6, hash-coverage
6/6, no-allocation 1/1). The reachable NPC Frost state is the already-hashed `FighterCore.signature`, and the identity
fold/content registration stays with the lead. The full NPC Frost/Sentenced source admission stays held, and the five
strict Wish-case prerequisites remain the five `full-signature-source-born-{holy,fire,plague,frost,sentenced}-wish-
recipients` cases (full five-faction source-born NPC signatures).
