# P-FROST-RESISTANCE-1: Iron Will applies to native Frost

Lead assignment for a second DeepSeek Rust worker, independent of the active private G6 worker. Use a fresh isolated
branch/worktree from the pushed checkpoint containing this packet; record its immutable full base. Preserve other
work/WIP and use your own target. The lead owns integration and any final content identity/tape reconciliation.

## Concrete defect and outcome

Source `packages/server/src/sim/factions.ts` updateChill applies `resistSlow(m, slowResistOf(victim))` to attack chill
and to the near/ranged movement result before movement quantization. Current `systems/frost.rs::after_damage` does
neither, although Iron Will is already offerable and its folded resistance/helper exist. Its restore validator also
excludes legitimate partly resisted chill values nearer one. Correct these native player mechanics completely within
the existing admitted player Frost domain; do not widen NPC/Frost/Sentenced or full roster-signature admission.

## Behaviour and writable scope

- Reuse the existing folded victim slow_resist accessor and `status_runtime::resist_slow`; do not duplicate the card
  value or helper formula. Apply at the source positions and in the same arithmetic order. Preserve strongest-source
  selection, no-card behaviour, near/ranged minimum, quantization, exposure thaw/reset, source bookkeeping and SIG bits.
- Preserve actual cooldown, buffered-input and bow-draw timing through both existing Frost phases. Attack actions
  remain through validate + Sim::submit; no new command, config, clock, RNG stream, field or module ordering.
- Derive restore acceptance from genuinely reachable resisted states. Do not validate against only the old unresisted
  interval or require the previous tick's cached chill to equal newly changed stats. Keep malformed time/source tuple
  refusals, zero/full resistance behaviour and retained/departed-source rules. No private-state allowlist weakening.
- Write only `crates/rh-sim/src/systems/frost.rs`, necessary dedicated Frost test modules, new
  `tools/frost-resistance-fixtures/**`, `parity/frost-resistance/**` and `docs/evidence/frost-resistance/**`.
  Existing source/goldens, stat/heal/state/schedule/content/format files, Cargo.lock, shared statuses, other workers,
  protocol/server/client/policy production and deployment are read-only. If an actual prerequisite needs another
  production file, stop and report the exact need rather than expanding scope.

G6 owns heal/stat/private state work and its candidate identity. This Frost candidate adds no serialized fields or
observation leaves. Report the behaviour/content compatibility impact; the lead will assign/register the composed
mechanic revision and regenerate only derived tapes before admission. Do not silently reuse an old identity as proof
that changed gameplay is replay-compatible, and do not edit another worker's identity/tape work.

## Evidence and finish line

Capture actual source using pinned Linux/amd64 Node22.23.4 with immutable source/tool/lock/config/image hashes and
canonical byte-identical `--check`. Use real grantCard/card folding and actual input/engagement/attack/movement producers;
trusted initial placement/setup is labelled. Do not inject expected chill/cooldown/movement outputs into the world.

Cover no-card baseline; Iron Will on victim versus source; near/ranged/overlap sources; buffered melee and ranged/bow
clocks; interval-completes-this-tick boundaries; thaw/leave/reset; relevant resistance changes; and real restore/continue
plus replay. Source examples should witness base attack0.68 becoming0.808, initial near movement0.70 becoming0.82,
and ranged0.85 becoming0.91 for0.4 resistance, rather than hard-coding those as the oracle. Distinguish helper-only
diagnostics for unproducible resistance extremes from actual runtime witnesses.

Compiled semantic mutants must separately remove attack resistance, movement resistance and valid resisted restore
acceptance; the relevant actual consumer must fail, compile errors do not count. Restore controls and rerun the small
affected Frost/no-allocation/privacy/restore tests plus both strict affected lint modes and formatting. Do not repeat
the unchanged full map campaign or broad workspace gate for this bounded packet.

Success: correct native player Frost resistance with source parity, meaningful mutants, valid restore/replay, unchanged
no-card cases and warmed allocation/privacy controls. Deliver a clean reviewable commit and exact base/head, files,
hashes/commands/results and compatibility remainder in the existing `coordination/reports/deepseek-rust.md`.
Failure/hold: altered old source expectations, synthetic installed outcomes, tick reorder, broadened PvE gates,
unvalidated tuple acceptance or unverified test claims. No optimization_port writes/merges/pushes or live activation.
