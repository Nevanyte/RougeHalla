# Fair bot activation plan evidence

**Status: plan only; no implementation, capture, test, build or runtime execution performed.** This evidence records
the source-backed boundary and concrete F0/F1 closure needed before any full live/headless bot claim.

## Authorities read

- `docs/coordination/BOT_BRAIN_COMPLETION.md`: the F0 fair publication/accepted-consumer gate and F1 driver/outcome gate.
- `docs/backlog/packets/P-BOT-BRAIN-1.md`: full `createBrain` source contract, caller ordering, temporal inputs,
  Memory/service identity, features, results and learning boundaries. It remains a dependency, not an admission claim.
- `docs/CONTRACTS.md` C-INPUT/C-OBS: viewer-entitled observations and the only action path through validation,
  submission, budgets, input queue and event visibility.
- Current `crates/rh-policy/src/lib.rs`, `delivery/frame.rs`, `bots/fair_percept14.rs`,
  `bots/perception.rs`, `bots/temporal_percept/input.rs`; `crates/rh-sim/src/observe.rs` and `input.rs`;
  `crates/rh-server/src/{room.rs,bot_learning.rs,bot_fill.rs}`; `crates/rh-headless/src/lib.rs`;
  legacy `packages/server/src/bots/brain/{perception.ts,frames.ts,runner.ts}`.

## Concrete findings

1. **The live seat intake is already transactional and fair by contract.** `DeliverySession` owns accepted protocol-14
   frames, a session-local epoch/sample and opaque session affinity. `NpcRef14` is explicitly scene-scoped. The full
   `FairPercept14` wrapper preserves all current groups and flags unavailable facts; its existing gaps include immunity,
   remote bow draw, wand cues, flight courses, NPC/item continuity and interpolation. The current public
   `bots::perception::Perception` is intentionally a much smaller adapter and collapses actor keys to `p{id}`/`n{id}`.
   It cannot be promoted as the full source consumer without a typed accepted-frame composer that reuses the already
   admitted private `temporal_percept::Ring` core; do not implement another FrameRing.
2. **Do not fill source gaps from `Sim` or absent protocol fields.** Source `Percept` has separate `now` and `viewT`,
   temporal fighters/mobs/containers/projectiles/minimap/events/extras/features, and the Brain's admitted components
   consume actual Memory and service feedback. A required owner/combat/inventory group may be absent; `Fact` and
   `Option` preserve unavailable versus present-empty. Any new observation leaf requires C-OBS and version review.
3. **The accepted consumer must preserve reference and time scope.** Frame epoch/sample are local, not global; NPC refs
   are not continuity identities. Item handles are viewer scoped and never rebind. Reset all history at real session
   changes, reject invalid/backward clocks before mutation, and judge caught-up events at their own step's sight.
4. **The actor path is shared, but result lifecycle is incomplete.** `Policy::reset` exists; the trait has no end callback.
   `drive_seats` and queued driving use one seat machinery; room result reporting uses real `Event::Resolved`, and
   headless `MatchSummary` collects resolved events. A once-only finalization bridge is needed for resolved and
   interrupted/void lifetimes, without fabricating results or recording training/headless runs.
5. **Potion eligibility has a derivable boolean, not a missing absolute timer.** Legacy runner checks only
   `healingUntil <= now` and advances its 1000 ms retry throttle only after adapter send acceptance. Current wire
   inventory exposes `potions_healing`; Rust's producer derives this count from active HOT entries, clears the count
   and deadline together when healing ends/owner leaves, and validates the deadline against the last HOT. Therefore
   `potions_healing > 0` is equivalent to `healingUntil > now` only in a validated non-ended state after the scheduled
   HOT update, for the same-sample exact `source_time`; ended frames are outside live Brain ticks and can retain elapsed
   deadlines. This does not produce the absolute deadline. Require producer-boundary controls for start, overlap,
   final expiry, and same-time evaluation before relying on the predicate; preserve missing inventory as unavailable.
   Adapter acceptance includes BotManager delay-queue admission; a later simulation refusal does not roll the retry clock
   back. Unsupported messages and adapter/queue refusals do not advance it.
6. **Learning can reuse existing pure and durable code.** `Brain.end` can remain pure; existing `BotRunFacts` currently
   omits Brain choice list, while `LiveLearning` already writes off-tick to Postgres. Extend this existing adapter only
   if needed, after actual resolved result, and keep training/headless store behavior unchanged. No ML or new store.
7. **Hosted Source proposal is exact but not runtime-verified here.** For one-owner start, use `--min-players 1`; `--fill-bots 8`
   is target total occupancy. Proposed flags are `--max-rooms 1 --lobby-seconds 10 --fill-seconds 3`, alongside the final
   reviewed map and artifact. No unsupported `--hitboxes` flag is added; the intended merged branch defaults archetypes.
   Verify flags/defaults against the final exact-tree binary after merge; merged runtime proof is not asserted.

8. **Owner closure remains open for two exact source-consumed facts.** Strategy reads `self.mobKills`, absent from
   current protocol14; require source-equivalent accepted-history proof or an entitled owner provider, not default0 or
   unused `mobStats`. A held-but-redacted owner lock already publishes held-ness but not identity; Memory/Brain/hand
   consume both. Preserve `Held { target: None }` as an unresolved binding gate, not a fabricated Clear/null target.
   Owner draw/ready/milli modifiers already exist in `WireOwnerCombat`; power is derivable from required accepted Build
   and the pinned card-tier catalog. Mob bow draw is consumed by Tactics.kite over fighters and mobs.
9. **Separate actual MatchStart from seat/static config.** Existing MatchStart contains owner, policy seed, arena,
   content/observation identities and tick period. Tier/persona come from seat/policy configuration; Features requires
   explicit reviewed public static setup. These are not missing per-frame publication fields. Private Brain composition
   remains separate from the unresolved live-binding facts, and Brain alone owns stamped/released `noteSent` updates.

## Plan boundary

The exhaustive source-to-protocol classification and field-level gaps are recorded in
[field-closure.md](field-closure.md). The corresponding [packet](../../backlog/packets/P-BOT-FAIR-ACTIVATION-1.md)
lists the minimal future provider/consumer seams and finite acceptance evidence. This review does not dispatch those
changes. It does not modify C-OBS, C-INPUT,
wire schemas, Rust, host configuration or client/network code, and does not claim source/native parity, live activation,
headless completion, or deployment readiness.
