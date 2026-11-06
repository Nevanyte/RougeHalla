# P-ABIL-1: complete authoritative Wish casting

## ID and outcome

Implement genuine validated Cast input, source-complete cast/stock clocks, atomic landing and all five Wishes:
Freeze, Swarm, Trial, Fire's Blaze Step and Last Stand. Blaze Step is the Fire Wish, not a sixth ability.
Shared status helpers and a manually inserted casting fact do not satisfy this outcome. Preserve full Rust authority,
meaningful source parity, headless/policy execution and private attribution; finish the corresponding public facts
through a separately serialized wire integration. Full original-port scope remains unchanged.

## Dependencies

P-STATUS-1, P-COMBAT-3, shared ledger/heal/stat readers and the typed map are integrated. P-ARENA-1 owns the in-flight
active collision interface and actual teleport producer; settle that interface before overlapping native edits.
Source capture can proceed now. The existing arena case `teleport-live-windup-status-refund` is a genuine Cast/refund
requirement, not permission to manufacture an arena-only cast or substitute a status snapshot.

Full training actors, remaining NPC signatures and card producers remain named prerequisites for their corresponding
branches. Implement the normal five-Wish pipeline first, then close those coupled domains; do not hide their absence
or create a circular wait for both whole packets to be Done.

## Relevant legacy paths

- `packages/shared/src/{abilities,blink,status,constants}.ts`: definitions, stock clocks, blink search and statuses.
- `packages/server/src/sim/{abilities,inputs,status,fields,displace,combatant,ledger,arena,step}.ts`: actual acceptance,
  two-pass landing, effects, collision, deferred death/reset hooks and ledger timing.
- `packages/server/src/sim/{mods,cardState,cardHooks,factions}.ts`: Wish modifiers, own Mark, critical/DoT and card hooks.
- `packages/shared/test/{abilities,blink,status}.test.ts` and
  `packages/server/test/{abilities,wishesCamps,wishesMods,abilityPolicy,status}.test.ts`.
- `parity/arena/source.json`: unchanged genuine Freeze/Last Stand/teleport/refund witness.

Code wins over stale once-a-run wording or guesses from ability blurbs. A65-input static audit at native
checkpoint `0b525260` found missing Cast intake, incomplete cast ownership/refund and player-only zone/DoT recipients;
this is diagnosis, not executed ability parity.

## New paths

`tools/ability-fixtures/**`, `parity/abilities/**`, new mechanic leaves under
`crates/rh-sim/src/systems/abilities/` and a pure native blink leaf. Exact filenames, source schema and native
representation are selected in a short design/caller inventory before implementation. No new dependency is planned.

## Exclusive write scope

Source worker: only new capture/fixture leaves in a private proposal; preserve original TS and all old corpora.
Native worker: a private proposal for mechanic leaves plus the explicitly assigned input, state, status, field,
modifier, event, hook, schedule, replay/checkpoint and observation seams. Reuse the arena-owned collision view.
Do not edit the root checkout, shared status, Cargo.lock or another worker's frozen stage.

Coordinator owns serial integration, versions/content registry, root status, server/protocol/C#/JS vectors, policy
compatibility and public activation. Necessary sim.rs edits remain thin delegations. Unity supplies presentation/input;
it never implements casting rules, blink collision, damage, nearest-target authority or effect outcomes.

## Contracts and references

C-INPUT, C-TICK, C-DET, C-NUM, C-PARITY, C-RNG and C-OBS; ADRs0005/0007/0009/0013/0017/0018/0019;
`docs/sweep/PACKAGES.md`, `docs/REQUIREMENTS.md` and `parity/README.md`. Keep the existing abilities row in place:
expiry → collect/revalidate all due casts → all self effects → all target effects → zone exits/bits.
The private full cast has one authoritative owner; any status-facing mirror must remain coherent and validated.

## Behaviour to preserve

- Source parsing requires finite clamped x/y and slot `wish|q|e`, including self casts. Optional actor field is `id`.
  Malformed optional IDs reject syntax; invalid optional timestamp/sequence loses metadata as source does. Q/E parse
  but have no ordinary equipped ability. Semantic refusals, sequence echo and queue/budget effects remain distinct.
- Only players originate Wishes. Unit targets are explicit, hostile, standing, visible, targetable, within range plus
  source slack and active-map LOS. Returning mobs remain targets. Resolve only delivered public actor references for
  public seats; hidden/absent guesses must not alter discovery or other private state.
- Acceptance checks phase, standing,300ms teleport grace, stun/silence, pending cast and slot readiness. Root does not
  block a Wish. Spend immediately and retain previous ready/full clocks, slot/rank/target/point/landing/lag. Zero-time
  casts remain pending until the abilities phase: they do not count as a timed cast, but block a second Cast intake.
- Revalidate the complete due batch in secret action rank before effects; clear survivors' pending casts, apply all
  self effects, then all target effects. A simultaneous Freeze/Swarm cannot invalidate an already admitted landing.
  Fizzle spends cooldown. Trial uses the subject's position after self effects, not a stale intake center.
- Freeze:250ms cast,450 range+32 slack,1250ms stun,45s cooldown. Swarm:250ms cast,8000ms hidden/cloud radius72,
  120s cooldown; own lock/chase drops while an independent ordered walk survives.
- Trial:350ms cast,400+32 range,5000ms zone; radius300 or200 from this caster's own tier>=3 Mark on this subject.
  Outgoing x0.8, caster damage x1.2, movement x0.7; strict outside applies1500ms stun. Gallows' Patience adds2000ms
  and uses2250ms exit stun. Preserve the card/faction dependency instead of reading another owner's public max Mark.
- Blaze Step:zero cast, two charges,30s per stock; server blink64..300 in4-unit descending steps, landing disc and
  connected component checks, coliseum wall-ring/vertex rules and locked inside/outside restriction. Ordinary walls
  may be crossed. Recheck at landing, displace through shared history/slide/chaser rules, then create2500ms trail,
  half-width20. Contact refreshes2000ms30DPS true DoT, including NPC/return victims; owner attribution survives departure.
- Last Stand:zero cast,150s cooldown,5000ms floor at1HP and haste0.3. Natural expiry/teleport pays0.3×all incoming
  HP-pool damage recorded by the floor, including overkill; removal/death/run-end does not pay it. Use common healing.
- Raid start arms source Wish lock (default45s), clears casts/statuses/fields/DoT reports and consumes no new RNG.
  Wishes ignore ordinary CDR/attack speed/Frost clock stretch; Wish-specific multiplier applies with source floor and
  rounding. Training's5s branch and absolute stock math stay explicit. Ready equality and charge boundaries are exact.
- Cancel hooks/events precede refund and clearing. Teleport alone refunds previous slot-ready and full-stock clocks;
  interrupt/fizzle/fighter-out/run-end keep spending. Drop/reconnect preserve casts/effects while releasing held input.
  While ledger collection runs, fighter-out cleanup uses same-tick payLater; surviving trails keep immutable attribution.
- Keep status/field pairing, expiry and replacement order, next-tick movement exits and same-phase Blaze exits.
  Reuse all-fighter status/ledger paths; current player-only Trial resolution and Blaze/DoT loops must be completed.
  Ability damage/reporting uses its source-specific multipliers,500ms aggregation and frozen public eligibility rules.

## Acceptance checks

1. Freeze a closed, fully inventoried unchanged-source corpus with actual queued casts and ordinary50ms ticks. Record
   constructor/module/RNG inputs and all relevant casts/clocks/effects/hits/fields/events/results. Never construct
   native actors or cast state from expected poststate. One pinned Linux amd64 Node22.23.4 reproduction after stabilization.
2. Test ready/lock/grace edges, unknown/missing/hidden/immune/return targets, range/LOS, q/e, lag/sequence handling,
   root versus stun/silence, same-phase second cast, weapon windup/held trigger, and simultaneous atomic landings/fizzles.
3. Produce all five effects from real accepted Cast actions. Cover Trial edge/exit, Swarm attack exposure, Blaze
   stock/ray/ring/open+locked geometry, Last Stand damage/payback and source-born NPC/return recipients. Helper setup
   complements these cases and cannot stand in for ordinary casts, births or lifecycle.
4. Reproduce the existing genuine arena refund case through actual native cast ownership and teleport. Test death,
   MIA, drop/reconnect, run-end, paired expiry and owner-outliving trails/status attribution. Preserve exact event order.
5. Restore and continue pending/zero-time/due/batch casts, stock/refund boundaries, fields and departed-owner damage.
   Validate coherent private cast/mirror data, actors, finite clocks/targets/landing, IDs and tuple dependencies. Populate
   every new hashed leaf; content derives from executable definitions and policies. No synthetic admission widening.
6. Public/owner/policy observations expose permitted Wish/stock/casting facts and visible effects only. Test hidden/
   absent twins, lost actors, secret cast targets/points/previous clocks, raw field IDs, delayed totals and enqueue failure.
   Live/headless use the same validated inputs and policy cadence; no Unity rules or alternative headless implementation.
7. Measure warmed moving/colliding cast/effect/observer allocations, source attribution and complete deterministic
   replay. Initial/transition allocations are reported separately. Preserve earlier status, faction, terrain and arena
   regressions; mutate a real cooldown/refund/landing rule and prove source parity fails.
8. Full completion retains the card/faction/training branches and actual wire/policy/client facts. Missing coupled
   producers or native source cases keep this packet explicitly INCOMPLETE; a base profile is not full Wish success.

## Validation commands

Existing: `cargo test -p rh-sim`, `cargo test -p rh-sim --test checkpoint --test replay --test hash_coverage`,
`cargo test -p rh-parity --test schedule`, `cargo test -p rh-headless`, `cargo test -p rh-policy`,
`cargo run -p rh-parity --bin parity-report`. The ability capture and focused test commands are to be created and
recorded by this packet. Coordinator runs integrated Rust checks; any incompatible wire change bumps the protocol,
regenerates fixtures and verifies Rust/C#/JS before public activation. Do not repeat unchanged full-map campaigns.

## Risk and suggested model tier

High: atomic landing, source-private state/refund, target privacy, lifetime attribution and numeric blink behavior
require a strong builder plus independent strong review. Source capture and bounded declarative work fit Sol/medium;
use Astra/high for the ownership/landing design and consequential review. All root integration remains serialized.

## Known traps

Blaze Step is Fire's Wish; once-a-run prose is stale. CastFact alone cannot refund. Root is not silence. Zero-time
pending is distinct from timed casting. Trial's own Mark differs from public incoming maximum. Swarm's cloud position
is presentation-followed, not server movement. Wish DoT differs from card DoT. A returning NPC remains a victim.
Keep the existing privacy corrections when inspecting raw source remembered-trail helpers. No models, ML, cloud or
Unity visual work belongs to this packet. No new external permissions are needed for its local Rust/source work.
