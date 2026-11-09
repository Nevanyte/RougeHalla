# Proposed private clock footprint — awaiting Root

No production file listed below is edited by this assessment. Base `db5ed80b2b89a156eae09cd0bd3f4c9e77e9e6de`; current base identities are checkpoint28/replay22/protocol14. Root alone chooses identity/content/tape allocation and admission. The optional row remains excluded from ordinary interactive-card reward/Training admission.

## State and execution

Extend existing lazy `Player.card_runtime:Option<cards::runtime::Runtime>` with `fight:Option<FightClock{start:f64,last:f64}>`. No parallel world map, separate serialized watch flag, wall clock, entropy, public field, last-combat alias or NPC owner. No allocation is needed: Runtime is an inline Option. Do not instantiate it solely because a row exists; the first watched genuine landed touch produces the clock. Keep empty memory canonical as None; removing FightTime rows clears only fight, preserving an existing Wish spend.

Derive watch from the player's actual flattened active `EffectKind::While(FightTime)` rows, not the Slow Starter enum. Native `Build.rows(faction)` already chooses real applicable rows. All supported production build mutations refold immediately; align both watch derivation and removal with that path. Diagnostic extra-row tests must be explicit about their nonproduction domain. A late system recompute must not temporarily recreate a removed clock. No state is added to FighterCore's cached modifiers; existing serialized holds/sums remain the outgoing consumer.

At the first line of the existing `mods.updateMods` implementation (`systems/items.rs::fold_armor`), consume `TickScratch.landed` once, in its existing order. Resolve actual player IDs for by and victim, ignore unwatched IDs, touch each record including duplicate IDs, then execute the existing refold loop. If absent or gap>=3000, set both timestamps to now; otherwise update last. Do not filter dead/ability/DoT/passive hits or require a player victim. Never call this from grant, hooks, outgoing-damage or individual recompute.

Pass a copy of the optional clock into `modifiers::holds_now`; exact comparison is `now-last < 3000 && now-start >= arg*1000`. Preserve source evaluation/f64 order and existing bit positions. No dynamic lookup from the damage consumer: this pass's ledger already used cached sums before the clock advances. Existing legitimate event recomputes use the old clock at current sim time, even before the late clock touch.

## Reset and restore decisions

`cards::runtime::reset_player` currently sets the whole owner to None. It is called by raidStarted reset_all and Training Clear. Keep existing Wish/streak/etc resets, but retain the fight Option across this generic card reset. Real Training Clear first removes the build, then resets card state and refolds; the no-row refold must clear the retained fight clock before the next ledger. Teleport's existing reset_fight does not clear fight. Death/Training revive must not add a reset. Departure frees the native Player; no orphan map is needed because native next_id is monotonic. Do not emulate unsupported same-string-ID reuse.

There is an additional **required restore seam**: `abilities/checkpoint.rs:70–112` currently assumes every nonempty card_runtime means Full-mode Wish memory and requires wish_cast=Some. A fight-only Runtime would be rejected even with abilities Off. Refine those existing restrictions to the Wish field itself, retaining every Wish timing/stock equation. Independently validate fight state in a card-runtime validator: nonempty owner; finite fixed-step timestamps with `0 <= start <= last <= server_time`; actual player-owned watched row; stale clocks permitted. A watched row without a clock is valid. Do not demand a recent hit, living player, holds=true or wish_cast. Do not demand start>=current raid_started_at if preserving a same-world run-start clock; Root decides the admitted run-reuse domain. Existing cached holds validation must retain its snapshot semantics, including frozen/voided worlds; do not replace it with an unjustified current-time recomputation.

## Exact proposed files

| File | Proposed change |
|---|---|
| NEW `crates/rh-sim/src/cards/fight_clock.rs` | Row-watch query, source touch/update helper, pure hold predicate, clock necessary-invariant validation and focused internal tests, using existing types. |
| `crates/rh-sim/src/cards/runtime.rs` | FightClock type/new Option field and precise reset preservation; keep existing Wish state. |
| `crates/rh-sim/src/cards/mod.rs` | Private module declaration only, unless Root prefers the small helper inside runtime.rs. |
| `crates/rh-sim/src/modifiers/mod.rs` | Supply clock to holds_now, clear fight when refold loses all actual FightTime rows. Keep cached outgoing fold and other conditions unchanged. |
| `crates/rh-sim/src/systems/items.rs` | One clock-update call at live mods entry before existing fighter loop. Schedule row/order unchanged. |
| `crates/rh-sim/src/abilities/checkpoint.rs` | Restrict current Full/Wish/empty-owner assumptions to Wish memory and call the independent fight validator. No loosening of Wish equations. |
| NEW `crates/rh-sim/src/cards/fight_clock_tests.rs` | Internal actual Sim/validate+submit source-matched cases, declared real grant/bootstrap, exact intermediate holds/damage/landed/RNG, lifecycle boundaries, clone/checkpoint continuation, restore refusals and sensitivity controls. Module registered from new fight_clock.rs. |
| `crates/rh-sim/tests/no_alloc.rs` if needed | Extend existing real warm-loop workload for watched hits without a new target or heap owner. Root reviews any edit. |

No changes proposed to catalog readiness, reward/Training eligibility, gameplay producers, protocol, wire/observation/policy publication, maps, persistence, Unity, dependencies or Cargo.lock. Pack Leader may share modifiers.rs; Root serializes/reviews that merge. This proposal does not reserve someone else's active edits.

## Hash, checkpoint, content and derived tape footprint — Root owned

The new Option and its start/last leaves are canonical serde state with deny_unknown_fields, automatically hashed. Runtime=Some for an existing Wish also gains a new None tag, so existing Wish hashes can change even without a Slow Starter build; runtime=None remains unchanged. Root must update `tests/hash_coverage.rs`'s current “only successful Wish / Off forbids card memory” explanations and populate actual produced fight-only and fight+Wish states. Perturb each new timestamp/Option leaf; coupled necessary-invariant refusals must be explicit rather than broadly exempted. No serde skip/default migration may conceal state.

Root must allocate the checkpoint/replay version decision and retained predecessor refusal tests in `src/checkpoint.rs`, `src/replay.rs` and their tests. Numeric catalog rows are already hashed but native behavior changes: a Root-approved content behavior marker/definition change is required; reusing the existing3000ms streak constant alone would not identify the new consumer. Prefer a private fight-gap rule connected to the existing content visitor (`cards/rules.rs` + `content.rs` only if necessary), without editing global constants to change streak behavior. No version/marker is selected here.

This commit creates original source **assessment evidence**, not a derived native expected tape. After implementation, Root decides which retained native per-step hashes/replay headers/content expectations need regeneration, including Wish-containing scenarios affected by the extra Option tag. Existing original source corpora, old expected tapes and public protocol goldens remain immutable. The seven observed compact traces retain complete random/event tapes, exact clock/cache/player/NPC observations and hook order, but are not a complete source checkpoint and are not advertised as one.

Native gates after a separate target lease: focused source comparison; actual clone/JSON checkpoint/replay continuation at started/mature/expired/new-gap states; fight-only Off and Full+Wish restore domains; invalid/nonfinite/reversed/future/off-grid/no-row clocks; cleared vs retained Wish state; strict scoped Clippy/fmt; meaningful semantic negative controls (false FightTime, victim exclusion, wrong gap comparator, early fold/ledger order, unconditional lifecycle reset), and the existing warm allocation check. Broader checks only as Root allocates resources. None has run in this assessment.
