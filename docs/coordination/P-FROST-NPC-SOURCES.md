# P-FROST-NPC-SOURCES: complete the bounded Frost source domain

Technical expert assignment, isolated future continuation from8cd510752ddab9e30b210efce85ca5faced8bbbd. Preserve the
current protocol13/checkpoint25/replay19 integration/build milestone. Root reserves checkpoint26/replay20 ONLY for this
future private storage change; no public version/ABI bump or admission follows automatically. No primary/worker-tree
edits or merge/push to optimization_port. Read the core layout package rules before edits; use an own absolute target.

## Accepted design

Replace Signature's eight optional chiller cells plus redundant count with one retained ordered Vec<PlayerId>. These
are generic actor IDs despite the existing wrapper name. Preserve first-insertion source walk order and uniqueness;
never sort, silently truncate or allocate a temporary list per actor/tick. Clear/reuse allocations at every signature
reset, raid/teleport/nonstanding and recomputation. Reserve capacity at actual actor growth and after restore, before
simulation steps, using a checked budget from the validated map/training domain. Capacity is neither serialized nor
hashed; IDs, length and order are. No entropy or new RNG draws.

There is no legitimate fixed256fighter cap:255 caps camps, not spots per camp. Map source budget is at most8 players
plus Frost regional spots; training replaces camps and has at most12 live practice actors, so8+12 is a safe source
budget there. Account honestly for dead retained regional/practice provenance and birth/reaping/reset behavior without
inventing a new map/gameplay restriction. Derive actual caps from code; report if this budget is insufficient. Optional
dummies and Plague zombies are recipients, never Frost sources. Existing player namespace provenance is enough for
this packet; do not add birth-faction/ever-Frost fields solely for stricter history claims.

Generalize source/near lookup to typed fighters. Frost NPCs contribute the base0.68 structural chill; player-only
card/haste/shield bonuses stay player-only. Exclude returning Frost actors in both directions exactly as source does.
Keep the instantaneous attackStarted exception player-only. Preserve generic afterWeapons/afterDamage ordering,
resistance before quantization and actual cached timing history. No Sentenced, camp-group Mark or unrelated faction
port in this packet.

Restore accepts retained roster+Player-origin IDs under today's known-player-namespace guarantee (not proof of past
Frost faction), or retained Frost regional/practice catalog origins. Reject self/duplicate/unknown/dummy/zombie/wrong-
catalog IDs and over-budget lists. Current presence, standing, target, return mode or resistance must not reconstruct
historical cached membership. Preserve existing cached-bit/timer exceptions and bounded Draw admission. Empty Vec is
the sole empty representation; no count/tail state. Refuse predecessor25/19 formats. No new observation leaves.

## Scope and proof

Write scope: necessary owned rh-sim fighter/signature state, constructors/birth/restore/reset seams, Frost kernel and
its strict validation/admission, narrow native tests, format definitions and manual hash consumers (including the
necessary rh-headless signature hash hunk). Existing public wire/client, content registration/tapes, shared status,
Cargo.lock and all other mechanics remain root-owned. Report required out-of-scope production changes first.

Add `tools/frost-source-fixtures/**`, `parity/frost-sources/**`, `docs/evidence/frost-sources/**`. Use actual pinned
source modules and normal AI/validated attacks/steps for runtime witnesses; label declared pre-world map/placements
and helper engagement diagnostics separately. No expected chill/clock/damage/events installed. Existing corpora,
including all five strict source-born Wish cases, remain byte exact and pending until their Full profile is genuinely
complete. Merely removing the pending names or changing their profile is failure.

Prove reciprocal ordered sources, returning-source exclusion, NPC base versus boosted-player chill, more than eight
unique sources without truncation, every existing recipient kind, source death/removal/reaping, camp respawn/new ID,
reset/teleport, canonical restore and restored-versus-original continuation. New hash coverage must exercise each
retained ID and ordering; no allowlist masking of new fields. Warm no-allocation checks after births/reset/restore
must use the real supported source domain, not a player-only shortcut.

Only after complete bounded Frost-source parity may the existing Frost engagement level admit Frost camps. Keep
Sentenced seats/camps and Full faction mode closed. Source NPC→player Mark, player→camp group/pool/leash/retarget and
the all-fighter five-case comparator are subsequent separate technical dependencies.

Run focused affected native/headless/restore/schema/hash tests, pinned byte-exact new capture, fmt and both strict
affected Clippy modes. Native compiled mutants must expose eight-source truncation, returning-source inclusion,
NPC player-bonus application and reversed insertion order; restore the control. No unchanged map/global workspace
campaign. Success is the complete bounded source domain plus honest gates/capacity/history proof; hold on hidden
allocation, fabricated outcomes, broader validation than retained provenance, changed source goldens or gate-only
port. Deliver clean immutable head/files/results/limits for independent review and root content/tape admission.
