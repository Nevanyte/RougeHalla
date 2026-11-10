# Private strategy source fixture

Phase A of P-BOT-STRATEGY-1. This is a finite actual-source **method** witness over the complete source classes:
createMemory API, createStrategy, real HuntAdapter, MobHunter, MobTracker and BuildRoute. Percepts, services, tactic
status and module offers are declared private component inputs. No World/Sim, live BotVision/perception/FrameRing,
full Brain scheduling, tactic/reflex/module implementation, headless/live policy activation or learning store is claimed.
All Rust implementation/tests belong to DeepSeek; this tool changes no source implementation or prior corpus.

## Files and commands

The runner, tagged codec, builders, Memory/strategy/dependency cases and reached assertions are split into individual
files. `capture.mts` imports unchanged source and records chronology; `verify.mjs` checks tagged values and the finite
envelope; `controls.mjs` applies semantic changes only to a disposable copy. A manifest outside this tool directory pins
every tool file and each frozen payload. Logs are outside this directory so they cannot perturb tool provenance.

```sh
bash tools/bot-private-strategy-fixtures/capture.sh
bash tools/bot-private-strategy-fixtures/capture.sh --check
node tools/bot-private-strategy-fixtures/verify.mjs
bash tools/bot-private-strategy-fixtures/controls.sh --write
bash tools/bot-private-strategy-fixtures/controls.sh --check
```

Use a fresh isolated worktree with an empty ignored node_modules mountpoint; Docker mounts source/tool directories
read-only and dependencies into a container-local tmpfs. The existing pinned Node22.23.4/Linuxamd64 image is used.
Capture writes source.json and coverage.json, then reproduces both byte-identically in another Node process. Every case
also creates a separate source instance immediately and requires its complete transcript to match. Root arranges an
independent fresh-checkout reproduction before native admission; successful local bytechecks do not substitute for it.
No old giant corpus is regenerated. No paid service is involved.

## Chronological schema and values

`rh-bot-private-strategy-source/1` contains the full actual generated seed7 map, source map hash, source/tool/lock/runtime
identity, actual runtime TypeScript import ledger and conservative complete source-tree pins. Six suites contain config,
initial state, setup transcript and ordered operations. Each operation carries raw declared input, a complete original
caller declaration, source return, all eight Memory outputs where relevant, source own-state diagnostics, computed
strategy getters, draw counts and ordered callbacks/RNG events. Values and diagnostics are deep-encoded immediately;
live source Maps/arrays/records are never retained for end-of-run serialization. Declared input is encoded before the
call and checked unchanged afterward.

MethodValue is explicit and collision-free: primitive null/string/bool/finite f64; `$:'undefined'`; `$:'number'` with
value `-0`, `NaN`, `+Infinity` or `-Infinity`; `$:'array',values`; `$:'map',entries` in insertion order;
`$:'set',values`; `$:'object',entries` preserving property order; `$:'u8',values`. Instance(name,entries), callable and hole
tags are output diagnostics only. All plain objects are tagged ordered entries, so a literal source `$` key is data.
No float is rounded or quantized. Undefined and null remain distinct, including optional command/weapon fields.

`verify.mjs` is a strict tagged-codec plus finite corpus/envelope/selected consumed-field checker, not a complete public
Percept/command intake validator. It rejects unknown tags/extra tag fields, duplicate primitive Map keys (including
0/-0), duplicate object keys, invalid tagged bytes, unsupported suite/method/Goal/status/command enums and selected
missing/unknown shapes. It performs conversion without changing any source/native instance. The Rust reader must
independently validate all consumed typed fields and method/suite compatibility before mutation; do not infer that
arbitrary malformed public inputs are safe because this offline corpus verifies.

### Native replay must use native retained state

A decide declaration with `current:'$previous'` means the caller adopts its own preceding decision's goal. Native replay
MUST pass the preceding **native** goal, then compare the captured input.current as a guard. Feeding captured source
input.current directly into the native strategy would install an oracle-derived goal and conceal transition bugs.
An explicit declared current goal is a legitimate caller-method input, labelled `currentSource:'declared'`.
`identity.returnedCurrentGoal` separately records the source's current-reference reuse.

Memory is always obtained by real createMemory/observe/noteSent/recordChoice; expected Memory rows, candidates and
whereabouts answers never feed decisions. The whereabouts callback forwards the real Memory query and logs its args/
return. It retains last position and expands radius; it does not extrapolate velocity. A nullPercept row is a declared
caller skip with unchanged state, not a call to observe(null) or FrameRing startup proof.

### Randomness and callbacks

This private-method harness declares independent Mulberry32 streams seeded seed, seed+1, seed+2 and seed+3 for decide,
motor, lapse and source Knowledge construction. It deliberately does not claim createBrain's separate derive(seed,lane)
orchestrator. Actual Knowledge consumes the fourth stream; strategy choices consume only their real decide/lapse calls.
Optional finite override arrays replace draws **without advancing** the fallback Mulberry stream until the override is
exhausted. Every return/index/stream/order is recorded. Source Gaussian consumes two uniforms and discards the spare;
strategy.judged caches the resulting per-foe draw until its inclusive expiry.

Path callbacks use declared argument-sensitive policies (open distance/factor/exact flag, coordinate-block, null or the
real source findPath service). Knowledge callbacks forward actual createKnowledge methods. Learned callbacks look up
the exact requested key in declared entries, defaulting unknown keys to0; source strategy performs its own enabled/
finite/clamp decisions. Module callbacks run enabled/goals in actual source order. Constant offers are labelled declared;
the conditional module consumes current context now/HP. Its log records a semantic context projection (operation,
now,self.id,self.hp), the exact fields the declared descriptor reads, plus source-object identity assertion. It is not
whole-context serialization or parity of production module logic. Callback identity, declared args, order and returned
Undefined remain observable. Options attacking supplied/fallback behavior is separately represented.

### State reflection boundary

Strategy own fields (avoid/chase/current key, exclusions, loot skips, judged cache, route), BuildRoute route/contests/
zone hits/avoid/heading/last alive, MobHunter engagement/bans/locks/timers/counters and MobTracker records are captured by
read-only own-property reflection. Getters and subsequent real calls supplement that tree. Source HuntAdapter's homed
Set and lastAt are closure variables and cannot be reflected without modifying source. Seed-home, repeated observation,
release and 240ms/14-piece catch-up continuation/control cases bind their effects; no direct closure-storage equality
is claimed. Source mobMaxHp's global memo is a pure catalog lookup cache; outputs, not cache occupancy, are compared.

## Numeric contract approved by Root before freeze

All recorded values remain unrounded binary64 JSON or explicit tags. Apply inherited tolerances only through an
independently reviewed native **path whitelist**, never a blanket numeric comparator:

| Logical leaf/derivation | Rule |
|---|---|
| All Memory outputs, whereabouts results, raw declared inputs, map records, config tables, RNG draws/count/order, goal/data/why/choice/tags, callback identities/order, integer/string/discrete values | Exact, including numeric bits and order |
| Excluded/lootSkip/judged.until, chase.since/limit/goalSince, avoid/flee/retreat/ban/pick/expiry clocks, source catch-up/focus counters, pure arithmetic/module/flee utilities | Exact; no tolerant threshold comparisons |
| Strategy judged[id].z from gaussian(log/sqrt/cos); normal Hunt appraisal/gate utilities and Farm rewardCurve utilities from exp; coliseum Hunt sigmoid utility | Existing bot-core bound `1e-9*max(1,abs(source))` only for these transcendental-derived continuous leaves and their explicitly projected duplicates |
| Path walk return distance, source-created geometric distances; BuildRoute route.arriveAt/startAt estimates from hypot/walk; distance-weighted camp/loot/patrol continuous utility components; geometry-derived coordinates passed to callbacks | Existing C-PARITY `2e-6` absolute only for explicitly identified hypot/geometry-derived leaves and projected duplicates |

Pure arithmetic components remain exact when not derived from the preceding math. Goal coordinates copied from raw
percepts/map records are exact. Hunt sudden-death utility using raw on-screen dist is pure arithmetic; remembered-dist
variants need the geometry classification. Judged until is exact even when judged z is transcendental-derived.
Knowledge odds and mob-share callbacks use the actual source formulas; their integer/wheel/linear leaves are exact.
No tolerance can change a winner, candidate order, identity, branch, rounded text, callback, expiry comparison or RNG
consumption. If another formula/leaf falls outside this table, report it to Root before broadening the whitelist.

References: docs/CONTRACTS.md C-NUM and ADR0007 (f64, source evaluation order, no FMA, rh_sim::math forked libm);
parity/README.md113–119 (continuous geometry2e-6, exact discrete outcomes); existing bots/parity_tests.rs8/55
(bot-core1e-9 relative for Math.log versus Newton ln/distributions); admitted Memory source comparator uses to_bits.
The existing geometry corpus rounds1e-6; this new fixture does not round. Approved limits are scoped inheritance,
not permission to normalize source inputs or regenerate expectations to fit a port.

## Coverage and controls

coverage.json contains all nine actually chosen goal families, actual source reached assertions and per-case V8 precise
block counts over unchanged tsx-transformed code, with transformed text/hash so offsets are interpretable. Each case is
run twice. Declared intent labels are not individual branch proof. Initial module/static-initializer coverage may be0
because imports precede profiling; the post-fallback unreachable Idle return is not manufactured. A human branch ledger
records positive witnesses and explicit gaps. There is no100% branch/full bot claim.

Semantic controls cover equal-key tie/order, hysteresis, exact exclusions, pursuit progress/hit release, loot budget,
appraisal expiry/RNG, module callback order, hunter catch-up/release/source-home, tracker rising, ban expiry, route
contest/tie/replan and Memory walked/intentional lock loss/third-party partner death. Each must disagree at its intended
observable selector after a successful source capture. Build/import/runtime errors are failures, not KILLs. Comment-only
control must preserve cases; restored unmodified representative source cases must compare byte-for-byte as values.
Mutations and intermediate outputs exist only in a unique disposable container copy; the host source and canonical
source.json are never patched. Synthetic reader controls stay separate from actual-source behavior evidence.
