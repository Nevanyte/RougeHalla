# Quest public-flow design candidate

This is a **private native candidate** in `crates/rh-sim/src/quest_view/mod.rs`, compiled as an opt-in module but not attached to Observation, any server publisher or transport. It reserves no wire numbers or version and does not establish source parity. The public-room source witness is in progress; the delivered giver source witness awaits lead admission. Lead review and a shared-file lease precede integration.

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
- An accepting human receives remaining matching ground objective coordinates for a live public collect or fetch quest, even
  outside current sight. A completed collect or self-carried fetch points back to its giver; a foreign-carried fetch exposes no
  ground marker. Kill offers never expose ground objective coordinates. Hidden previews, unaccepted offers, closed offers and bots
  grant no such objective knowledge. An objective coordinate is not itself an actionable pickup handle. Other visible
  quest item cues can follow ordinary sight and source refusal behavior; the exact source/observer mapping awaits witnesses.
- The sim decides eligibility and current action consequences. Unity presents delivered facts, selects actions and renders
  navigation; it does not determine quest rules, outcomes, rewards, physics or hidden actor state.

## Identity and atomicity

`World::Roster` is server-private; current `WelcomeHeader` contains only the joining seat's player ID and `Observation`
contains self plus sight-filtered actor rows. A full public roster grant is not an existing contract and is not proposed.
Instead, the native candidate grants viewer-scoped monotonic `RosterId` values lazily only for identities already referenced
by published quest accepted/progress/visited or carrier facts. Filtering precedes allocation; hidden quest or roster entries
must not affect public IDs. The distinct type has no conversion to an actor/target reference and carries no position. The
source's completion name is separately bounded by the existing item label UTF-8 byte limit; no profile-name sanitization is
invented. Normal committed updates retain bindings; reconnect resets collections and revokes all row/action and roster
bindings, retains counters, and requires a complete new projection. No cross-reconnect ID continuity is promised.

`QuestObserver::prepare` extracts actual immutable Sim state and stages IDs and rows in a private guard. Dropping or failing
preparation discards staged grants; `commit` is the only way to make a row actionable. `resolve_accept` uses only committed
published bindings and rechecks current publication; previews, stale and unknown handles yield the usual budgeted miss.
This separate guard is a native seam only: no claim is made that it commits atomically with `ItemObserver`, roster/quest
collection baselines or a server queue. A later shared lease must integrate those under one successful enqueue transaction.

Each viewer also needs nonreused offer and pickup handles, resolved only against committed seat-owned bindings. A preview
retains a nonactionable row identity for promotion to the published offer; its action binding must not exist until a public
row has itself been committed. On reconnect, old action bindings are revoked and a full current projection is delivered; distinguish row
identity continuity from action authority. Current sim phase, human standing, status, range, line of sight, giver and quest
state are checked again at action time through validate + `Sim::submit`; references absent from this seat's committed bindings become ordinary budgeted misses. Independent seats can issue
the same numeric value; a coincident foreign value cannot be distinguished from a value already granted to this seat. Whether any existing grace window is retained must be checked against visibility and source witnesses.

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

The existing lifecycle corpus and this candidate's focused native unit tests cover only their stated surfaces. They do not
prove wire publication, browser interaction, full replay identity, giver equivalence, actor privacy or durable production.
