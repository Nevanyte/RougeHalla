# P-G6-HEAL-BARRIER-NATIVE: verified native candidate, publication held

Lead assignment, 2026-11-08, for the available DeepSeek Rust lane. Use a fresh isolated branch/worktree from the pushed
lead checkpoint containing this packet; record that immutable base. Preserve older refs/WIP. The original private
HEAL_BARRIER_PROPOSAL is source research, **not an approved implementation specification**; corrections below take
precedence. The Post Rust lane separately owns P-PERCEPTION-WITNESS-1. Do not duplicate its work.

## Authority and integration boundary

Implement the source Second Skin heal-barrier producer and `buffs.expireBoosts` as a **private native/headless candidate**.
The lead reserves checkpoint 25 and replay 19 for this candidate's new private state, subject to rechecking at integration.
Register gameplay definitions and calculate the resulting content identity; it cannot stay unchanged. No observation,
policy or wire version/field is assigned here. Do not use observation 18 or policy 14.

**No live-profile activation or automatic merge is authorized.** Second Skin is already offerable while human protocol 11
does not publish barrier. Before admission, the lead must pair native completion with a reviewed public barrier transport
or explicit fail-closed profile/offer decision. Do not silently change card eligibility or invent a configuration flag to
resolve that design. Do not edit the primary, managed snapshot, other workers, deployment or shared status records.

## Exact mechanics to port

- Read the existing folded `HealBarrier` stat through the normal stat view, without duplicating the Second Skin catalog
  number or making behavior depend on a card ID. Grant only for standing players and positive post-scaling heals.
- Grant after anti-heal/heal-taken scaling but before HP clamping: overheal and lifesteal count. Preserve lockout/refusal,
  zero healing, mob exclusion and `QuietRegen`/source `noBarrier` exclusion. Use actual source producer witnesses for any
  coupled heal-event/telemetry behavior; do not invent source output or widen event visibility.
- Add to existing barrier, clamp **on grant** to 25% of then-current maxHP, enable decay and extend the private expiry to
  max(previous expiry, now+5000 ms), as source helpers specify. Register cap 0.25, decay 0.05 per second and lifetime from
  the source definition. Preserve the 1e-3 barrier floor.
- Replace only the named `buffs.expireBoosts` pending slot with the real system. Never reorder C-TICK. The system clears
  on expiry/non-alive/decaying-zero, otherwise subtracts 5% of current maxHP per second at fixed 20 Hz. Source lifesteal
  precedes this slot; terrain/potion heals follow it. Capture the resulting same-tick versus next-tick decay.
- Two private player scalars (deadline and decay flag) are sufficient. Preserve timerless seeded barriers, immunity
  preventing absorption, teleport survival and run-end retention. Training clear **must** clear barrier and both new
  fields along with the existing reset. Do not implement dormant R6 abilities or new producers.

Primary source: `packages/server/src/sim/{buffs.ts,factions.ts,arena.ts,training.ts}`, shared `mods.ts/constants.ts`,
the Second Skin row and actual module install order. Native anchors: `systems/heal.rs`, stat view/modifier accessors,
`systems/ledger.rs`, `systems/settle.rs`, `systems/training/console.rs`, `schedule.rs`, `state.rs` and checkpoint validation.

## Restore, identity and allocation requirements

- **No universal barrier<=25% of current maxHP invariant.** The source clamps on grant, while later trades/cards can
  reduce maxHP without clamping barrier. Such states remain valid until decay or a later grant. Capture this case.
- Decay can reach zero while its deadline/decay flag remain set until the next expiry pass; that reachable tuple must
  restore. Derive other finite/nonnegative/clock/flag bounds from actual reachable source states. Avoid rejecting ended
  retention or timerless seeded barriers. Add malformed-state controls without inventing permanent gameplay invariants.
- Defaulted new fields do not grant checkpoint 24/replay 18 compatibility. Preserve strict format refusal. Register new
  gameplay constants/definitions and hash-coverage/validated fields; no unhashed allowlist, checkpoint weakening or
  hidden timer in any public/native Observation or PublicSnapshot. Identical public facts with different valid private
  timer states must have equal observations at that instant.
- Source goldens remain immutable expected behavior. Any changed Rust-derived identity/hash tape must be explicitly
  generated with the existing recorder, retain its command/provenance and leave gameplay source payloads unchanged.
  Report the calculated identity and exact tape changes for lead review; shared statuses/Cargo.lock remain read-only.
- Prove warmed ordinary casts/heals and repeated owner/visible-actor observations still allocate no heap blocks with
  reused buffers. Do not add String names, lazy per-step containers, I/O, wall clock or entropy to rh-sim.

## Writable scope

Only necessary rh-sim heal/stat/modifier accessors, new buffs system/module registration, the single schedule slot,
two private state fields, reset/validation/hash/content/format definitions, affected native tests and generated derived
tapes. Add `tools/heal-barrier-fixtures/**`, `parity/heal-barrier/**`, and `docs/evidence/heal-barrier-native/**`.
Existing packages are read-only; source captures and mutants use disposable copies. No protocol/server/client/policy
production changes, dependency/lock changes, broad formatting or new public facts. Absolute isolated paths for all edits.

## Required witnesses and finish line

Pinned Linux/amd64 Node22.23.4 actual-source capture with dependency/tool/image/input hashes and byte-identical `--check`.
Use real heal/card/attack/trade/training/teleport producers where applicable; declare any trusted initial setup. Cover
grant/extension/cap, overheal, lifesteal, anti-heal/refusal/zero/regen/mobs, absorption/immunity/death, expiry and decay-to-
zero boundary, both sides of the systems slot, maxHP decrease, training reset, timerless seed, teleport and run end.
Checkpoint/continue each meaningful private-state form and compare uninterrupted behavior; replay must agree.

Demonstrate compiled semantic mutants for wrong grant order/cap, missing decay/expiry, regen granting, missing training
reset, universal current-maxHP cap validation and wrong same-tick slot. Restore controls; compile errors or omitted
cases do not count. Reuse existing meaningful tests instead of mirroring implementation.

Success: the entire bounded native producer/expiry candidate, source parity, restore/replay/hash/privacy/no-allocation
checks, focused affected tests and both strict lint feature modes pass, with exact commands/results/identity and a
reviewable commit. Full source/barrier/public-client completion is not claimed. Failure/hold: unsafe tuple acceptance or
rejection, modified old source goldens, tick reorder, hidden timer disclosure, silent live activation, unsupported format
reuse or unverified claims. Stop at the largest verified slice, keep code isolated and report the exact blocker.

Send the lead base/head SHA, files, source/corpus/tool/identity hashes, test/mutant results and remaining publication
decision via the existing `coordination/reports/deepseek-rust.md`. No merges/pushes to optimization_port.
