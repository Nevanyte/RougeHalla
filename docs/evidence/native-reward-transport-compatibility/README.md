# Native reward compatibility at the transport boundary

The native kill-augment producer runs at the ordinary player-killed hook. A player with real invested stats drops a
30-second Trophy. Protocol 11 has no complete Kill reward option. Refusing the whole reliable replacement therefore
closed otherwise valid connections: Room publication calls `out.close(Malformed)` when collection preparation fails.
A nearby stranger also observes the unsupported native row and could encounter the same failure. Reconnect could
repeat it while the row remained visible. This is an adapter failure, not an invalid player command.

A four-seat regression reproduces it without granting or injecting a build: open a source-generated stat chest through
public Pickup, choose a real boost through public Choose, then execute a validated sword kill. Three survivors keep
the match Active. The old guard refuses publications at consecutive ticks 7, 8, 9 and 10.

The adapter now accepts complete reward rows whose options are all supported Card or Boost variants. The generic
presentation predicate runs in the observer before staging candidate bindings and allocating handles. A mixed row
containing an unsupported option is omitted whole; no option is removed or reindexed. Supported rows keep their exact
option order, while omitted rows do not consume handles or affect supported epochs. Both observer and collection
baselines still commit only after publication succeeds. The wire-state guard remains a defensive refusal if an
unfiltered unsupported observation reaches it.

Default native/headless observer methods accept all native rows and continue to permit the genuine Trophy choice.
No gameplay producer is disabled, no rule changes, and no expected source fixture changes. Kill transport remains
pending until a complete wire representation and decoder/vector work are implemented.

A normal conditional-card `Needs <base>` refusal previously poisoned the publication in the same way. It now uses the
existing owner-only Toast event with the authoritative `Refusal::message()` text. Other seats receive no notice, and
later frames are unaffected. No protocol version, wire schema, identity or golden vector changes are needed.

Integration checks:

- Two server integration tests pass: actual four-seat kill/publication/default native Trophy choice, and private
  prerequisite feedback followed by successful later publication. The kill check covers owner and nearby strangers,
  prepare/drop/retry/commit, exact supported row options and unresolved unpublished handles.
- One observer test passes for whole mixed-row omission, candidate binding contents, unchanged supported option
  indices, no hidden handle allocation, stable epochs under omitted-row changes, and unchanged default native offers.
- All 12 reward-chest/source/default-observer tests and all 18 wire publisher tests pass.
- Both all-feature and default-feature workspace Clippy modes pass with warnings denied after the coordinator
  grouped trusted modifier-validation owner facts into a nonserialized context. Formatting and the parity report
  also pass (109 compared scenarios plus 300 pathfinding queries; 13 separate capture-only scenarios).
  The added adapter method has an explicit narrow argument-count allowance.

This bounds the supported transport surface; it does not claim public Trophy UI or wire completion.
