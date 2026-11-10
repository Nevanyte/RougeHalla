# Reached behavior ledger — frozen corpus → native private modules

Every row maps a packet contract item to concrete frozen-corpus witnesses (case ids and operation families drive the
harness in `modules/source_tests.rs`; the expected channels compared are result + per-cfg contexts + hunter capture +
ordered callbacks). Counts: 255 cases / 3,259 operations, per suite: choice 11/1605, hunter 39/113, chests 34/284,
planning 24/360, wishes 95/722, hazards 51/154, registry 1/21. All rows pass exactly; explicit unproved paths are at the
bottom.

| Contract item | Reached corpus witness (case ids) | Compared channels |
|---|---|---|
| Card-choice fit/block/risk/tie/sentinels, all 80 ids | `choice-catalog-0..8`, `choice-costs`, `choice-special-and-options` | helper result bit-exact (±Infinity sentinel), contexts empty |
| Boost cap, kill-augment mapping, unknown id, taken/free/first tie | `choice-special-and-options`, `choice-costs` | helper result |
| Hunter birth hold / pick margin / independent clocks / teleport / coliseum / retreat / fight cap / ETA | `hunter-hold-*`, `hunter-guards-*`, `hunter-eta-*`, `hunter-distinct-clocks` | decision, hunter own/stats/target |
| Hunter nearest-3 candidate/cache (incl null, 250 boundary), stable id ties, old-vs-held | `hunter-cache-{direct,radius-denial,real}`, `hunter-real-wall`, `hunter-eligibility-ties` | decision + ordered `hunter.walk`/`hunter.sight`/`paths.walk` callbacks |
| Hunter stalls/give-up/counters/capped walk/progress/interruption | `hunter-stall-interrupt`, `hunter-progress`, `hunter-hold-no-walk` | decision + hunter own capture (done/walking/stalls/walks order) + `hunter.log` strings |
| Chest panel readability/races/asks/window/reopen | `chests-panel-race-build`, `chests-nearest-expired-window`, `chests-pick-then-move` | choose intents/priority/timing/why + source statuses |
| Chest delayed build merge/count-once/boost cap | `chests-boost-count-dedup-max`, `chests-build-distinguishing`, `chests-awake-history` | choose intents + Memory `seek` |
| Chest gates/live/stun/casting/picked/expired/absent/BLIND-vs-readable | `chests-gates-*`, `chests-safety-{easy,hard}-*` | goals/intents/act outputs |
| Chest goals temporary hunter vs retained act hunter, crowd/nearer termination | `chests-goals-vs-act`, `chests-crowd-life-nearer` | goals/act statuses + retained hunter capture |
| Planning ordered raw events/malformed-but-valid payloads/event t/first latch/replacement | `planning-events-and-asks`, `planning-malformed-events`, `planning-exact-resend-settle` | plan intents + draw counts + Memory/callback channels |
| Planning window scaling/last-call/no-deal/no phase reset/ready latch | `planning-window-1/100/1000/45000/90000`, `planning-no-deal` | plan intents |
| Planning coercions (f64 spawns/pick/boon, literal-true taken, string-only boons, free/no-faction/one-free) | `planning-coercions-0..5`, `planning-learned-*` | plan intents/why |
| Planning learned-bias clamp/sanitize + softmax/lapse lanes/first ties | `planning-bias-choice`, `planning-forced-lapse-and-bias`, `planning-learned-*` (declared Infinity/NaN entries), `planning-bias-choice` | decide/lapse rng values+counts, plan intent |
| Wishes actual 5 defs × 13 situations (cast/blocked/target/LOS/hp/mob/phase/ready) | `wish-{freeze,swarm,trial,blaze,lastStand}-{healthy,hurt,hit,mob,nolOS,untargetable,casting,stunned,silenced,rooted,dead,planning,notready}` | intents/act outputs + effect docs |
| Wish availability/Easy remember/rank clamp/retry | `wish-availability-{easy,normal,hard}-{1,2,3}`, `wish-easy-offense-filter` | rng draws + intents |
| Wish def guard (absent/null/{}/empty ranks/guard-passing `[{}]`) + unknown goal | `wish-def-guard-174..178`, `wish-no-slot` | goals/intents/act statuses |
| Wish real Memory lastCast grace/pending/cast+700/hidden/partial retention/leg keep/arrival | `wish-slip-lastcast`, `wish-slip-pending-expiry`, `wish-slip-arrival-keep`, `wish-hidden-empty-corner-*` | intents/statuses + Memory contexts + callbacks |
| Wish stimuli order / nearest tie / recast-before-step / hit escape | `wish-stimuli-order`, `wish-nearest-tie-recast`, `wish-hit-escape-no-near`, `wishes-mob-type-optional` | intents/timing |
| Wish real gates/collision blink landing (both gate states) | `wish-blink-real-gates-{false,true}`, `wish-blink-gate-crossing-{false,true}` | intents + callbacks |
| Hazards surface classification 5 maps × 6 faction strings (unknown = no home) | `hazard-surface-*` | helper burns/bad results |
| Hazards held step/hold/expiry/arrival/throttle/light/loot/lock/guards | `hazard-held-step`, `hazard-arrival-throttle`, `hazard-guards-*`, `hazard-light-*`, `hazard-already-light`, `hazard-path-denial` | intents + collisionMap/clear callback timing/args |
| Hazards adjust phase/coliseum independence, guards, unchanged identity, ordered multi-redirect | `hazard-adjust-{active,planning}-{alive,dead}` | intents + `returnedInputList` identity + callbacks |
| Registry default order/hooks/enabled/replacement position/reset/policy identity | `registry-order-and-context` | enabled row lists + intents/statuses + custom.enabled/policy channels |
| Cfg identity isolation/continuations/interleaving | `chests-two-configs`, `planning-two-configs`, `wish-two-configs`, `hazard-two-configs` | full contexts + per-cfg draws/state |
| Money/share contexts (Memory histories as output) | all observe operations (396) | full Memory snapshot + stimuli + draw counts + path stats |
| Registry/hook presence + direct-method vs enabled distinction | `registry-order-and-context`, every module `enabled` hook operation | enabled bools, hook inventory, statuses |

## Explicit unproved / scope-limited paths

- Future/custom ability definitions outside the five shipped Wishes: the source Wishes module would accept some
  arbitrary shapes; the finite native reader refuses `dir`/unknown tags/effect distances ≠ (300,64)/absent consumed
  rank members **before mutation**. Only a refusal witness exists; no decision is claimed.
- `withGates` gate-sealing transform for maps without admitted layers is supplied by the composing caller
  (`ModuleContext.collision`); the policy layer proves it consumes the supplied collision view, not the open map. The
  replay proves both gate states with the real declared maps.
- A non-`module` goal passed to Wishes `act` would throw in source; the adapter returns `failed "unknown wishes goal"`
  (never exercised by corpus).
- Own status bits are read in the EFFECT_* domain; values outside the u16 status-bit domain truncate (outside the
  declared profile).
- Full private Brain composition (guards/cadence/hand features/sequence/stats/end), fair earned publication and real
  validated live/headless use are the separately specified later packets; the module layer emits intents/statuses only.
