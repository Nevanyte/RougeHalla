# P-STATUS-1: authoritative statuses, fields and displacement

## ID and outcome

Port the complete fourteen-kind status runtime from `STATUS_RULES`, its readers and lifecycle, fields and displacement into the existing authoritative `rh-sim` path. Statuses participate in actual scheduled movement, targeting, weapons, healing and damage settlement; they are not a standalone calculator beside gameplay. Live and headless execution use the same `Sim`, with captured source evidence, private checkpoint/replay state, legitimate public effects, and allocation checks.

This packet is the runtime dependency for P-ABIL-1 and P-CARDS-1. It does not implement cast commands, the five Wishes, charges/cooldowns, card acquisition/on-hit catalogs, mobs, terrain, or teleport destination selection. Those producers call the runtime when ported. Complete runtime coverage includes genuine source helper and trusted setup cases for kinds whose ordinary-input producer is not yet ported; label those cases accordingly, rather than claiming full ability/card gameplay.

Implementation base: `d1027eac93be54ec9e37435ab71c2e97a3aafdc9` on `optimization_port`, content `105333d9ac5d8d92`, checkpoint 14/replay 12/observation 11/policy 8/wire 5. The map checkpoint passed 997 local tests, independent review, Rust/C# CI and all six native determinism jobs. This packet was prepared by source inspection; it does not claim status implementation or executed status validation.

## Dependencies

- Existing P-COMBAT-1/2/3 and capture infrastructure: weapons, same-tick ledger payouts, next-tick deferred hits, targeting/pathfinding, replay and checkpoint paths. Preserve the accepted faction and vision slices already integrated; do not re-port them.
- P-ABIL-1 depends on this runtime, not vice versa. Define a narrow typed ability-cast fact/cancellation boundary; preserve source cast-related predicates and cancellation rules in source-driven runtime tests. Ability validation, two-pass landing, spending/refunds, Wish locks and producer logic remain P-ABIL-1. Do not mark their entire schedule/hook responsibility complete because the status portion is implemented.
- P-CARDS-1 supplies nonneutral card modifiers, bleed/other status producers, conditional rows and hooks. Current live power-zero/default sources remain identity where the existing domain requires it. Port and test the status arithmetic/read interface for nonneutral supplied source values; do not claim that unported card acquisition or RNG production works. Generic DoT critical resolution is the actual per-player accumulator cached once per world tick (`cardState.rollDotCrit`), with zero PRNG draws. Preserve that state/cache and source branch; do not invent a random stream or a silent constant result.
- P-KIMI-FOLD-1 owns the separate pure stat-fold kernel, tests and capture. Reuse it after acceptance where needed; coordinate its integration rather than copying its catalog or editing its reservation. The status slow/resistance/haste helpers are explicitly outside that packet. Full card runtime is not a prerequisite for status neutral-domain integration.
- P-MOBS-1 later supplies the second combatant store. Keep runtime data on the shared fighter component and test role-sensitive pure admission (including quest-giver and players-only rules); do not invent a duplicate mob store or claim live mob gameplay. P-TERRAIN-1 owns ice slip production; displacement must clear that state through the eventual shared owner, not create a second ice system.

## Relevant legacy paths (verified with `rg`)

- `packages/shared/src/status.ts`: ordered `STATUS_KINDS`, `STATUS_RULES`, effect bits and reveal duration. `packages/shared/src/{abilities,mods,constants}.ts`: `hasteMultiplier`, `resistSlow`, ability/field identities and rank-one field policy, shared numeric constants. Read actual definitions before moving policy; retain a single owner.
- `packages/server/src/sim/status.ts`: apply/remove/cleanse, key identity, readers, reveal, damage factors, HP floor, healing and movement multipliers, effect bits.
- `packages/server/src/sim/{fields,displace}.ts`: field identity/order/mirroring, segment test, displacement/history/path/lock reset.
- `packages/server/src/sim/abilities.ts`: `updateAbilities`, `onStatusApplied`, `onAttackStarted`, `endFields`, `endZones`, `clearFighter`, `clearAll`, `payDeathFloor`, `statusDamage`, `abilityDotFx`, `flushAbilityDot`; inspect `install` for exact registration/hook order. Its cast/`applyEffect` branches identify producer boundaries, not permission to port the cast system here.
- `packages/server/src/sim/{world,combatant,ledger,movement,mods,buffs}.ts`: runtime schemas, insertion order/standing rules, payout/deferred semantics, source modifier folds and movement floor. Also `{weapons,targeting,factions,cardState,onHit,vision}.ts` for existing consumers, heal funnel, crit/proc boundaries and visibility distinctions.
- `packages/server/test/{status,abilities,ledger,ledgerMult}.test.ts`: existing source edge cases. Use these to choose inputs; expected fixture output must come from actual source execution.
- `parity/legacy-capture/{capture,world,canon,intake}.ts`, `parity/legacy-capture/scenarios/{types,catalogue,melee,holy,frost,sentenced,vision}.ts`, `parity/README.md`: installed-module captures and strict comparison conventions.
- Native ownership: `crates/rh-sim/src/{fighter,state,scratch,schedule,hooks,checkpoint,observe,vision,events,content,statics,replay}.rs`; `systems/{items,weapons,targeting,movement,ledger,heal,frost,sentenced}.rs`; `crates/rh-parity/src/combat.rs` currently synthesizes the axe-only status projection.

## New paths

Proposed exclusive mechanic and evidence paths (confirm no collision at the integrated base):

- `crates/rh-sim/src/status_runtime/**`: typed rule/instance/apply/filter/cast-fact data and pure readers; avoid confusion with the existing match/player lifecycle `Status` enum.
- `crates/rh-sim/src/systems/status/**`, `crates/rh-sim/src/systems/fields.rs`, `crates/rh-sim/src/systems/displace.rs`: scheduled lifecycle/DoT, typed hooks and narrow helpers. Entry points follow `fn(&mut Cx)`; hooks follow `fn(&mut Hx, &HookArgs)`.
- `parity/legacy-capture/status-probes.ts`, `parity/legacy-capture/scenarios/status.ts`, `parity/status/**`; `crates/rh-parity/src/status.rs`, `crates/rh-parity/tests/status.rs`.
- `crates/rh-sim/tests/status_runtime.rs`, `crates/rh-headless/tests/status_runtime.rs`; `tools/status-fixtures/**` for the pinned capture/bytecheck wrapper; `docs/evidence/status-runtime/**` for bounded evidence and source-symbol coverage.

## Exclusive write scope

A mechanic worker owns only the new paths above. Do not edit TypeScript reference bodies, existing fixtures to hide changes, `Cargo.lock`, reserved stat-fold paths, Unity, deployment, shared status records or protocol code. Supply minimal shared-file patches for coordinator integration, one at a time:

1. Fighter/World typed status and field state, counters, effects and displacement sequence; removal of the old sole-purpose shred list after migration. Add module registration, content visitor, hash/checkpoint/replay integration and derived scratch capacities.
2. Existing `items` axe producer/mod source; weapon/targeting readers; heal and ledger typed metadata/payout dispatch; schedule rows and hook arguments at their existing positions. Replace the axe-only parity projection with the actual table without changing earlier fixture results.
3. Observation/event/private temporal-report adapters, headless projections and any required version changes. Determine transport reach explicitly at integration: an internal field does not imply an unconditional global wire redesign; an incompatible transported field requires the repository's protocol/version/mirror/golden-vector process.
4. Capture registration and existing allocation/hash/restore/content/schedule tests. Coordinator owns shared records and final broad gate.

Displacement needs a reviewed narrow seam: current payout execution has static/world/events but no reusable pathfinder. Replan when the queued payout actually executes, using the current collision map and preserved goal. Thread the necessary borrow through same-tick payout draining; do not precompute a stale path, move the work to next tick, allocate a pathfinder per displacement, or give every hook unrestricted tick scratch.

Smallest coherent implementation slices: (a) typed rules/readers, exact apply/remove and sole axe ownership; (b) real schedule/ledger/heal/movement/weapon integration, lifecycle and effects; (c) field/DoT/displacement integration and public/private continuation proof. These are review boundaries inside this packet, not permission to report the runtime complete after slice (a). Each slice preserves existing accepted gameplay.

## Contracts and references

Follow AGENTS.md, `docs/{MIGRATION,REQUIREMENTS,CONTRACTS}.md`, `docs/backlog/README.md`, `docs/sweep/PACKAGES.md`, `crates/rh-sim/README.md`, ADR 0009 and the accepted temporal/public-state ADRs 0013/0014. C-TICK preserves row names, registration order and hook modes. C-INPUT retains `validate` + `Sim::submit`; no public add-status/displace cheat command. C-RNG/C-OBS keep source runtime and streams private. C-PARITY/C-NUM/C-DET require actual source, binary64 evaluation order, existing math helpers, exact discrete outcomes and the established continuous comparison policy. No I/O/clock/entropy in `rh-sim`, new dependencies, ML work or Unity rules.

## Behaviour to preserve

1. **One ordered table and one runtime.** The source table is:

   | Kind | max ms | Combine / cap | Cleanse | Effect bit | Players only |
   | --- | ---: | --- | --- | ---: | --- |
   | stun | 3000 | any | hard | 1 | no |
   | root | 3000 | any | hard | 2 | no |
   | silence | 3000 | any | hard | 4 | no |
   | slowMove | 5000 | sum / 0.6 | soft | 8 | no |
   | slowAttack | 5000 | sum / 0.5 | soft | 16 | no |
   | antiHeal | 6000 | sum / 0.6 | soft | 32 | no |
   | dot | 10000 | sum | soft | 64 | no |
   | invulnerable | 3000 | any | never | 0 | yes |
   | untargetable | 10000 | any | never | 128 | no |
   | hidden | 10000 | any | never | 256 | yes |
   | zoned | 8000 | product | never | 512 | no |
   | deathFloor | 6000 | any | never | 1024 | yes |
   | haste | 8000 | max / 0.5 | never | 2048 | no |
   | shred | existing AXE_SHRED_MS | sum / existing AXE_SHRED_CAP | soft | 0 | no |

   Casting is bit 4096; preserve ordered kind codes and spare bits. New numeric policy has one actual definition/content visitor; reuse existing axe constants. Do not create status-table and weapon-table copies of shred. Keep `WeaponRt.armor_shred` only as the source-timed derived mirror if still needed, not independent mutable stacks.

2. **Identity and mutation.** Identity is `(kind, source.id, ability ?? tag ?? "")`, preserving insertion order. Apply rejects players-only violations, quest givers, nonstanding recipients and nonpositive duration before queuing. An absent or `until <= now` instance is fresh; fresh resets start/value/reveal fields and replaces source. Live refresh retains source metadata, extends to the later deadline capped at `now + maxMs`, and takes max value or the specified capped increment. Actual `Object.assign` merges supplied payload fields; it does not clear absent data despite the source comment. Stale reuse does not clear every payload. Emit fresh status FX unless quiet; refresh bits before `statusApplied`, and fire that hook for refresh/quiet applications too. Reader expiry is `until > now`; `findStatus` may return stale data. Zero-valued active presence differs from a combined numeric value of zero.

3. **Ledger freeze.** Apply/remove/cleanse/displace during collection queue typed same-tick payouts; their immediate returns match source null/empty behavior. They execute in FIFO order only after every victim settles; nested payout calls then execute immediately. Recheck application eligibility on execution, so a fighter downed by this pass receives no new status. Deferred removal predicates are evaluated at execution, not converted to an early captured set. Use closed typed selectors for actual call sites; do not serialize arbitrary closures. `World::deferred` remains next-tick damage. Table membership/application changes freeze, but the source death-floor `taken` accumulator still updates during settlement; do not freeze or duplicate that accumulator.

4. **Existing owners.** Keep weapon stagger immunity/cancellation, weapon `root_until`, `Vitals.immune_until` and private Frost chill clocks as distinct source concepts. Status stun also cancels bow Draw, unlike the existing stagger rule. Applying invulnerable only raises `immune_until`; removing it does not lower the shared clock. `isSlowed` includes status slowMove or existing Frost SIG_CHILLED. Never translate Frost into a generic slow instance. `ActionKind::Cast` is a wand action, not an ability cast. Status root/cast zero movement preserves the current path. Haste/resistance and positive movement flooring follow source order; zero remains zero. SlowAttack refolds its source mirror immediately on apply and removal, before weapons read it; do not apply it twice alongside Frost rate changes.

5. **Lifecycle and hooks.** In the existing `abilities` phase: apply bush exposures; snapshot active fighters; remove expired statuses and perform their caller-owned effects; expire fields; reserve the existing position for P-ABIL's due-cast landing; end exited zones; rescan fighters for attack reveal and effect refresh. Preserve player-then-mob/insertion order when that store exists. BeforeDamage remains signatures, terrain, then `abilities.statusDamage`. Movement and mod source entries stay in their source registration positions. Extend the already-ported `abilities.onAttackStarted`/vision behavior with hidden reveal; do not install bush exposure twice. Reuse actual hook chain order for statusApplied, fighterOut, teleported and runEnded, including deferred fighter cleanup. Keep pending cast-only hook work explicitly pending.

6. **Removal and reveal.** Stable removal includes matching stale entries; cleanse never removes class `never`, even if requested. Bare removal refreshes bits/recomputes slowAttack but does not itself pay death-floor healing or end fields. The lifecycle caller owns those effects. Hidden reveal uses `[revealFrom, revealUntil)` and starts a newly opened window at `now + TICK_MS`; extending an open window preserves its start. Weapon attack reveal extends through landing + HIDDEN_REVEAL_MS. Effect bit and untargetability transitions must match equality boundaries and future-time queries. Hidden status is not permission to add a new sight-concealment rule: audit the actual source vision boundary separately from targetability and bush concealment.

7. **Damage and healing.** Outgoing zone multipliers multiply in table order; incoming zone multiplier only applies from that zone's source. Preserve the existing Sentenced suppression substitution using dealtFactor, not accidental double suppression. The source explicit arena exemption is a distinct ledger flag; do not infer it solely from missing attacker ID. The current supported arena/card domain must be stated and the exact helper branch independently captured. Apply deathFloor after barrier absorption: accumulate all HP-reaching damage, including overkill; use the first active floor and clamp to `min(floorHp, before)`. AntiHeal affects every heal including Holy lifesteal and death-floor payout. Death-floor expiry/teleport healing bypasses combat lockout but is not automatically a lifesteal heal; run-end/fighter-out cleanup does not pay it.

8. **Fields and generic DoT.** Fields use the existing run-local entity counter, preserve insertion order and immutable server geometry, and snapshot matches before batch removal. Segment contact is inclusive. Trails survive owner departure; owner zones/clouds and subject zones clean up according to source. Zone subjects at the radius remain inside; absent/nonstanding/evading subjects end silently, an outside standing subject gets the owner-attributed exit stun. Cloud end removes the matching hidden key. Rank-one trail/exit fallback policy currently comes from `effectOf` in abilities.ts: establish a single typed shared policy owner for those exact reads, with future P-ABIL reuse, not a second Wish catalog or hardcoded runtime literals.

   Trail contact runs before generic status ticks, excluding its owner and immune player recipients; refresh quietness follows the active source/ability key. Each active dot instance records its own ledger row in source order. Generic DoT joins the existing shared PvP DoT accounting and landed-damage sustain path; it is not a new signature kind and does not also run the Fire/Plague ticker. Ability-tagged damage is flat; eligible untagged owner damage reads the actual modifier/crit boundary. Preserve source shares, attribution and RNG draws. Ability DoT reporting uses landed values, its source phase/flush timing and run-end flush. Extend the existing private temporal-report/public-redaction machinery; do not expose private bucket keys/history or build a competing public accumulator.

9. **Displacement.** Caller validates the destination collision disc. Execution moves the body, replaces rewind history with one sample at now, clears slip, preserves/replans the last path goal (unreachable means empty), increments sequence modulo 256 and resets every player's lock bookkeeping for that target while preserving the lock and unrelated search semantics. No rules, pathfinding or collision selection moves to Unity.

## Acceptance checks

**SUCCESS — all required evidence is present:**

- A checked source-symbol/ownership inventory covers all fourteen rules and every scoped operation; distinguishes ordinary-input traces, source helper probes, trusted pre-state inputs and pending producers. Capture executes unchanged source functions, or a byte-bound observational export of a private body with imports adjusted only. Bind exact source filenames/hashes, runtime and command. Canonical capture is Linux amd64 Node22.23.4 using the repository's pinned workflow; host captures are diagnostic. A non-writing bytecheck and full source DTO/hash observer-noninterference control pass.
- Strict nonempty fixed inventories reject raw duplicate/unknown/missing keys, duplicate/missing/extra/reordered cases, unknown enum values, unsafe narrowing, non-finite/overflowing geometry/times and malformed referenced IDs before mutation. Validate the supported runtime domain without inventing gameplay caps or rejecting legitimate stale source references/payloads. Expected post-state is never fed into native setup. Full table/payload order, fields/counters, effects, events/hooks, HP/barrier/mirrors, path/history/locks and relevant RNG state/continuation are compared, not only a final hash.
- All kinds cover no-op admission, exact expiry/max-duration boundaries, key collisions and ability-over-tag priority, same-source refresh/stale reuse, multi-source combine/caps, zero-value presence, additive updates, partial payload retention, quiet FX and hook timing. Cover all cleanse classes, absent/all removals, immunity clock retention and hidden half-open/next-tick boundaries.
- Actual ledger probes compare reversed victim ordering, queued apply/remove/cleanse/displace, same-pass deaths, nested payouts, source removal and next-tick deferred hits. Verify no early status/pointer/cache mutation, exact floor accumulation after barrier, zone/Mark/arena semantics, ordinary and lifesteal anti-heal, and generic + existing signature DoT sharing a cap. Nonneutral helper inputs are evidence of that runtime boundary, not a claim that card producers exist.
- Source-produced field cases cover all kinds, expiry equality, overlapping keys/ordered removal, radius/segment endpoints, absent/removed owner/subject, trail persistence, immunity, zone exit stun and cleanup without stun/heal. Displacement covers same-tick queue order, reachable/unreachable retained goal, changed collision input at execution, history reset, lock metadata and 255-to-0 sequence wrap. Cast-related boundary tests use actual source cast facts; full cast gameplay remains pending.
- Sim/headless status cases step the same implementation; ordinary axe-input replay proves integration, and trusted pre-state cases continue through real Sim phases. Checkpoint roundtrips before expiry/reveal/field end, every serialized leaf changes the hash, malformed state has a refusal control, and restored continuations match events/state/RNG. Checkpoints remain step-boundary only with no unflushed same-tick payout queue. Do not serialize derived scratch.
- C-OBS tests use actual visible/unseen source pairs and delayed reports. Legitimate effect/displacement/field presentation is explicitly projected; private tags, source metadata, timer history, floor totals, cast targets, RNG and hidden bucket identities stay private. Test absent versus unseen actors, repeated/skipped observation calls and restore/reconnect report baselines. No new client rules or fabricated all-fields public feed.
- Existing accepted axe, weapon stagger, Holy/Plague/Fire/Frost/Sentenced and vision fixtures remain unchanged. Warmed `step_into` allocation tests exercise status churn, expiry, fields, payout growth and displacement with retained scratch/capacity; restored-state warmup is explicit. No arbitrary status/field truncation to make allocation tests pass: source tags such as per-tick bleed prevent a fixed one-instance-per-source shortcut.
- Semantic negative controls kill at least: early same-pass application; next-tick payout; refresh source replacement or payload clearing; `<` instead of `<=` expiry; reveal starting immediately; cleansing `never`; clearing immuneUntil; death-floor accounting before barrier; duplicate Frost/status or haste multiplication; trail/zone inclusive-boundary change; displacement path captured before payout; incorrect generic DoT accumulator/tick-cache advancement or an invented PRNG draw. Each control must fail for a behavioral mismatch, not compilation. Cover definition/content perturbation, exact schedule traces and all newly ported row classifications.
- Focused default/all-feature checks, strict Clippy, formatting and canonical bytecheck pass; coordinator runs the broad gate after integration. Deliver exact commits/manifests, owned files and minimal shared patches, commands/results and limitations. Do not claim full abilities/cards/mobs, full-game performance or transport support from this packet.

**FAILURE — report incomplete with preserved evidence** if any kind/runtime branch is silently stubbed, the source oracle is rewritten, expected outputs enter inputs, source domains are silently narrowed, queues are conflated, existing state owners are duplicated, a shared row is reported wholly ported with pending behavior hidden, or privacy/parity/allocation checks are skipped or weakened.

## Validation commands (only commands that exist, or "to be created by this packet")

Existing commands, to run during implementation after the coordinator releases the base (none were run during this preparation):

```sh
cargo fmt --all --check
cargo test -p rh-sim --test no_alloc
cargo test -p rh-sim --test hash_coverage
cargo test -p rh-sim --test checkpoint
cargo test -p rh-sim --test replay
cargo test -p rh-sim --test observe
cargo test -p rh-parity --test schedule
cargo run -p rh-parity --bin parity-report
cargo clippy -p rh-sim -p rh-parity -p rh-headless --all-targets --all-features -- -D warnings
```

To be created by this packet and documented in `tools/status-fixtures/README.md`:

```sh
node --import tsx parity/legacy-capture/status-probes.ts --check
cargo test -p rh-sim --test status_runtime
cargo test -p rh-sim --all-features --test status_runtime
cargo test -p rh-parity --test status
cargo test -p rh-headless --test status_runtime
```

The source command runs inside the canonical pinned Linux capture environment, with source read-only and private writable output; specify the actual reproducible wrapper there. Use bounded concurrency and the coordinator's separate target directory policy. Existing `cargo test --workspace` and protocol/C#/JS checks, when affected, are coordinator integration gates, not concurrent worker loops. No benchmark or performance claim is required for this correctness packet.

## Risk and suggested model tier

High risk; strongest available reasoning tier for the core implementation and independent source/parity/privacy review. The difficulty is ownership and exact execution timing, not the fourteen-row table. Review the payout/pathfinder seam and typed source identity/selector design before substantial implementation. Freeze each coherent slice with source evidence; integrate shared edits serially.

## Known traps

- Expiry and most lifecycle behavior live in `abilities.ts`, not `status.ts`. Omitting them leaves a partial runtime; porting the whole file expands this into P-ABIL-1.
- Existing axe statuses are a specialized mutable owner; replacing only the reader leaves two competing systems. Preserve its mirror's source phase timing while migrating storage.
- Source comments are not always exact: payload updates are partial assignment; hidden reveal begins next tick; the HP-floor counter includes total post-barrier damage, not only prevented death damage.
- Public `Status` is already a lifecycle enum; weapon Cast, status root, stagger immunity, Frost chill and ability casts are different concepts.
- `by == None` and source `arena: true` are not interchangeable. Source IDs may outlive their active fighter; checkpoint validation must not reject valid lingering trails/status attribution.
- Field cleanup/removal, status expiry/cleanse and cast cancellation have different side effects. Do not generalize them into one destructive callback.
- Existing hook names may already be partially implemented (especially the vision portion of abilities/attackStarted). Preserve installed chain order and the actual source operation point; do not register a second copy.
- Empty tables and neutral modifiers need fast paths, but no optimization justifies reordered floating sums, different RNG consumption, invented caps or a changed output-privacy boundary.
