# P-CARDS-1: complete authoritative cards and rewards

## Outcome and dependencies

Port the complete80-card catalog and its runtime behavior, full build/stat mirrors and rewards, preserving source
eligibility and all G1–G13 guards. The accepted pure stat-fold kernel and three-card playable subset are prerequisites,
not completion. The [409-case source catalog](../../../parity/card-catalog/README.md) covers definitions/selection only;
the separate [65-case runtime source prerequisite](../../../parity/card-runtime/README.md) now captures real
combat/grant/choice/lifecycle effects and guards. Neither corpus certifies all80 native runtime ownership; positive
Witness and stricter reason-preserving controls remain a separate companion. Full gameplay remains authoritative in Rust.

Coordinate the in-flight Wish schema before overlapping native state edits. Its lazy card-owned last-Wish-spend
metadata must remain the single owner; expand that runtime rather than adding a second clock. Existing DoT critical
memory also has one owner. Complete Wish/card coupling without making whole-packet completion a circular dependency.
Arena supplies active collision/lifecycle. Native helpers may advance privately before serialized activation.

## Source and write ownership

Read `packages/shared/src/{cards,effects,mods,rewards,chestBoosts,rules,constants}.ts` and
`packages/server/src/sim/{mods,cardState,cardHooks,onHit,chests,ledger,buffs,weapons,melee,factions}.ts`, their callers
and tests. Use actual source code over stale card descriptions. Native leaves belong under the existing cards,
modifiers/reward owners and mechanic systems; sim.rs remains a thin facade.

Source capture uses new `tools/card-runtime-fixtures/**` and `parity/card-runtime/**`, preserving all old corpora.
Native work is a private proposal with explicitly assigned state/input/hook/ledger/stat/observation seams. No root,
shared status or Cargo.lock writes by workers. Root serializes shared versions/content, integration and protocol/C#/JS.
Do not copy mutable arena/Wish work or create an independently synchronized CardRuntime.

## Required behavior

- Preserve all80 definitions, source order, complete ten-kind payloads, common requirements/status gating, faction
  row replacements, base stacking and unique/conditional rules. Nonfinite/fractional helper cases do not widen legal
  native build state. Preserve actual source count/power arithmetic and source-reachable bounds.
- Reuse the accepted fold, actual while/vs/scale contexts, conversion order, mirrors and source-timed modifier cache.
  Preserve PvP power, multipliers/caps, healing/barriers/lifesteal, critical accumulators and secret salted Gambler
  semantics. Never introduce a new random stream or reorder a pass to simplify implementation.
- Implement all card-state readers/writers, on-hit multiplicity, block/returned/overkill/deferred effects, streaks,
  boosts, stillness, bleeding/reporting and faction card consumers. Complete source G1–G13 behavior through real weapon,
  ledger/heal/status paths. All admitted fighter recipients use the shared core with source-specific eligibility.
- Wishful Thinking uses the real spend metadata, budget/window and both stock clocks; Arcane/Gallows and own Mark
  coupling use actual folded flags/multipliers. Training exceptions remain explicit. Preserve exact teleport/raid/
  run-end/death/reset hooks and next-tick deferred damage versus same-tick payLater.
- Full rewards use actual14-card interactive pools, source themes/tier fallback/distinctness/picker exclusion and exact
  reward RNG consumption. Complete real grant/choose/skip/refusal/expiry/owner semantics; do not offer unsupported
  mechanics merely to erase the strict terrain chest-options difference. Other catalog access paths retain behavior.
- Headless/policies act through the same validated commands and cadence. Public owner build/options/mirrors and visible
  cues never expose private counters, source IDs, salts, future rolls or hidden actor references. Unity implements no rules.

## Acceptance and failure lines

1. Freeze bounded unchanged-source runtime traces with real accepted inputs, constructor-born actors and ordinary50ms
   steps. Named grant/status/bootstrap helpers are explicit setup, never expected poststate or proof of ordinary births.
   Cover every runtime effect family and guard with actual observable consequences; pure409 cases alone are insufficient.
2. Compare complete owned state/events/order/RNG, normal/elite reward cases, all three current-card regressions and actual
   choice/build changes. Close the existing strict terrain reward-options failure only through genuine full producers.
3. Strictly validate/hash/checkpoint/replay full builds, runtime presence/counters, deferred entries, attribution and
   reachable clocks. Test malformed states with valid controls, checkpoint continuation, departure and frozen-void cases.
   Remove current Source deferred-state refusals only when their genuine producers/reset semantics are implemented.
4. Verify observation privacy/hidden-absent twins, public intake, real headless/live equivalence and policy cadence.
   Measure warmed combat/deferred/observer allocations; preserve deterministic numerics and actual source hook order.
   Compile a meaningful combat/reward/clock mutation and show source parity fails, then restore exact bytes.
5. Freeze coherent file/base/evidence SHA manifests for independent strong review. Coordinator runs affected native
   integration gates and serial public transport/browser checks. Native/full packet status remains INCOMPLETE while
   coupled domains, source cases or public support are missing; a catalog, smaller reward pool or selected hooks do not
   substitute for this outcome. Do not repeat unchanged full-map or stat-fold campaigns.

Existing checks: cargo test workspace; rh-parity parity-report/schedule; rh-sim checkpoint/replay/hash/no-allocation;
rh-headless/rh-policy tests. Add focused runtime capture/consumer commands with the implementation. C-INPUT/C-TICK/
C-DET/C-NUM/C-PARITY/C-RNG/C-OBS and ADR0005/0007/0009/0013/0019 apply. Use a strong native builder/reviewer;
bounded unchanged-source capture and declarative catalog work fit an economical worker.
