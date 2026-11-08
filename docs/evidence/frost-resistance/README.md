# P-FROST-RESISTANCE-1 evidence

Native player Frost slow-resistance correction (Iron Will applies to Frost). Scope: crates/rh-sim/src/systems/frost.rs,
new dedicated Frost test modules, tools/frost-resistance-fixtures/**, parity/frost-resistance/** and this record.

## Defect and fix

Source packages/server/src/sim/factions.ts updateChill:
- attack chill: m = min over engaged Frost sources of chillOf(source), then m = resistSlow(m, slowResistOf(victim));
- movement: raw = min(nearMovement, rangedMovement), then resistSlow(raw, slowResistOf(victim)) only when raw < 1, before
  movement quantization.

The native after_damage applied neither, so an Iron Will victim still took the full attack and movement cut, and the
restore validator accepted only the old unresisted chill interval. The fix reuses the existing folded victim accessor
(crate::modifiers::view(core).slow_resist, the clamped folded SlowResist sum) and the existing
crate::status_runtime::resist_slow helper at the same source positions and order; it does not duplicate the card value or
formula. The restore acceptance is now the genuinely reachable resisted image: the source range
[1 - FROST_SLOW - frost_cap, 1 - FROST_SLOW] mapped through a resistance in [0, 1] gives the same lower bound up to 1
(partly resisted values above the old ceiling are legitimate, and a full resistance leaves no cut). Malformed
time/source tuples, zero resistance, retained/departed source names and the no-card path are unchanged; a cached chill
is not required to equal a fresh recomputation after the victim's stats changed.

## Evidence

- parity/frost-resistance/source.json: pinned linux/amd64 Node22.23.4 capture from the unmodified legacy sim through real
  grantCard folding and real client-message/attack/movement producers (trusted declared placement labelled), with
  immutable source/tool/package-lock/image hashes and a deterministic source replay; --check is byte-identical.
  Cases cover no-card baseline; Iron Will on victim vs source; near/ranged and the near+ranged minimum; buffered melee and
  bow-draw clocks; the hold/thaw/leave/reset series; a real mid-run grantCard resistance change; and no-card counterparts.
  Source witnesses include attack 0.68 -> 0.808, initial near movement 0.70 -> 0.82 and ranged 0.85 -> 0.91 for 0.4
  resistance (evidence, not oracle).
- crates/rh-sim/src/systems/frost.rs test module (source_witnesses_* tests): provenance checks and witness relations
  through the same resistSlow and quantization (baseline vs card pairs, thaw series via the no-card counterpart,
  departure/reset, clock witnesses, mid-run resistance change).
- crates/rh-sim/src/systems/frost.rs: runtime tests using the actual stat-fold path (Build::from_counts + modifiers::recompute
  + sync_max_hp) for Iron Will: attack/near/ranged/overlap, source-card neutrality, buffered melee and bow-draw clock
  stretching, and restore/continue/replay of a partly resisted state (including a cached chill across a later resistance
  change). The existing no-card private runtime matrix, helper probes and ranged ledger stay unchanged.

## Mutants (compiled semantics, each against the actual consumer)

1. attack resistance removed: frost.rs resist_slow on the attack chill dropped -> the attack/near runtime test fails.
2. movement resistance removed: resist_slow on the raw near/ranged result dropped -> the ranged/overlap test fails.
3. valid resisted restore acceptance reverted to the old ceiling: the restore/replay test fails in Sim::restore (the
   actual consumer); the malformed-state restore controls still pass.

## Compatibility impact and remainder

- No serialized field, observation leaf, protocol, command, config, clock or RNG stream was added or reordered.
- No-card behaviour and every existing source expectation/golden are unchanged; the changed domain is the already
  admitted player Frost private runtime and its private-state validation. The two Frost phases keep real cooldown,
  buffered-input and bow-draw timing; attacks still go through validate + Sim::submit.
- Gameplay/content compatibility: the fix changes produced chill and movement for Iron Will victims only (the card was
  already offerable; it now works). Existing canonical tapes that contain no Iron Will chill are unaffected. The lead owns
  the composed mechanic revision/identity and any derived-tape reconciliation; this candidate must not be treated as
  replay-compatible proof for a prior identity.
- Not produced in this bounded packet: a Rust replay of the captured source tape (no public Rust card-grant producer on the
  parity path; the runtime tests use the real stat-fold setup instead), full NPC Frost/Sentenced admission stays held, and
  Iron Will resistance extremes beyond the real 0.4 card value are helper-only diagnostics, not runtime witnesses.
