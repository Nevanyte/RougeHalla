# Quest public-flow design candidate

This is a design and an **unlinked, non-production** policy leaf in `crates/rh-sim/src/quest_view/mod.rs`. It reserves no
wire numbers or version and does not establish source parity. The actual public-room and giver source witnesses are in
progress in their separate lanes. Lead review and a shared-file lease precede integration.

## Entitlements and facts

- Planning exposes already published offers. Active hidden offers disclose no definition, coordinate or identifier to
  other seats: only the source's unpublished count. The finder alone receives a private preview immediately, four seconds
  before public publication. The preview is not actionable and cannot grant objective locations. It disappears on hidden
  retirement and becomes the public row when published. A resumed finder needs current entitled state reconstructed from
  authoritative runtime; a lost transient event must not be the sole source of truth.
- Public rows contain catalog identity, giver position, status, deadline, and source-public accepted/progress/visited,
  carrier and completion information. Public roster identity is a nonspatial permission independent of body sight.
  A published carrier fact does not authorize its position, an actor target, or a pickup. Public completion display text
  is bounded and checked; invalid text is refused rather than silently altered.
- An accepting human receives the live public quest's remaining objective coordinates for navigation, even outside current
  sight, matching the source client's `questObjectiveMarkers`. Hidden previews, unaccepted offers, closed offers and bots
  grant no such objective knowledge. An objective coordinate is not itself an actionable pickup handle. Other visible
  quest item cues can follow ordinary sight and source refusal behavior; the exact source/observer mapping awaits witnesses.
- The sim decides eligibility and current action consequences. Unity presents delivered facts, selects actions and renders
  navigation; it does not determine quest rules, outcomes, rewards, physics or hidden actor state.

## Identity and atomicity

`World::Roster` is server-private; current `WelcomeHeader` contains only the joining seat's player ID and `Observation`
contains self plus sight-filtered actor rows. A full public roster identity grant is therefore a new dependency, not an
existing contract. Propose a stable match-scoped `PublicRosterId` and checked display label in a reliable roster collection,
including departed players when referenced. It must have a separate type and namespace from observer actor and command
handles, no implicit conversion, no positions or targeting authority. Root must approve this grant and its lifecycle.

The candidate leaf's `PublicQuestPeople` accepts only already-granted roster IDs and a checked label; its constructor
refuses non-public rows. This models the boundary but does **not** prove the supplied identities were actually granted.
A production adapter must establish that guarantee and atomically publish roster entries before or with every referencing
quest row. The leaf is not connected to world state, `Observation`, server, protocol or UI.

Each viewer also needs nonreused offer and pickup handles, resolved only against committed seat-owned bindings. A preview
may retain a nonactionable row identity for promotion to the published offer; its action binding must not exist until
publication. On reconnect, old action bindings are revoked and a full current projection is delivered; distinguish row
identity continuity from action authority. Current sim phase, human standing, status, range, line of sight, giver and quest
state are checked again at action time through validate + `Sim::submit`; foreign/stale references become ordinary budgeted
misses. Whether any existing grace window is retained must be checked against visibility and source witnesses.

Stage quest rows, roster references, item/offer bindings, actor projections and collection baselines in the same reliable
publication transaction. Commit only after successful queue enqueue; discard on failed preparation, unsupported encoding,
overflow or enqueue failure. Producer-time notices must preserve their recipient entitlement even if visibility changes
before delivery. Bounds, handle exhaustion and earlier-tick errors fail closed without changing committed state.

## Dependencies and proof gates

1. Review the actual-source room/schema and giver witnesses, including discovery timing, pickup/refusal, quest NPC movement,
   immunity, collision, terrain telemetry and IDs; resolve remaining C-OBS decisions with the lead.
2. Lease observation/quest core and actor/reference surfaces together. Connect the pure policy to real world extraction,
   establish roster grants, row and action binding lifecycle, and producer-time feedback. Prove differing hidden facts do
   not affect another seat's rows, bytes, handles or failure behavior. Verify no bot quest activity; restore, replay and
   run-end/teleport preserve entitlement and state.
3. Lead allocates protocol/observation identity and shared server/wire/collection files. Add strict Rust, C# and JS
   codecs and synchronized vectors; test reconnect, stale/foreign commands, overflow and atomic enqueue failure.
4. Build Unity's planning/log/tracker, accept, objectives, carrier/completion feedback and results from server facts;
   verify real human WSS input, updates and reconnection in an actual client. Test capped quest GV through the existing
   fenced, idempotent result/spool/profile path. No additional profile fields are assumed.

The existing lifecycle corpus and this candidate's standalone unit tests cover only their stated surfaces. They do not
prove wire publication, browser interaction, full replay identity, giver equivalence, actor privacy or durable production.
