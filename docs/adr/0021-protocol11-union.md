# ADR0021: reconcile parallel gameplay transports in protocol 11

**Status:** Accepted for the November 8 integration. Full-game/public transport completion remains open.

## Context

Parallel source ports independently used protocols 7–9, observation versions 15–16 and checkpoint versions 21–23.
Their tag assignments and State/readiness sets cannot be combined by taking the greatest version number. A single
wire identity must bind the admitted union, and all consumers must agree on the same fields and rejection behavior.

## Decision

Use **protocol 11**, native **checkpoint 24 / replay 18 / observation 17 / policy 13**, content
`801a76cde4cfd305`. Keep earlier fixtures as historical records and generate the current golden vectors from the Rust
protocol tool. Rust, C# and JavaScript decode the same `protocol/fixtures/v11.json`.

- Input tags: Hunt 12, ConsumeCorpse 13, Plan 14, Train 15.
- Event tags: WindEmblem 8, CannonNotice 9, Toast 10. Actor kinds include Zombie 2 and TrainingDummy 3.
- Prop kinds include Corpse 4, Wind 5 and Cannon 6. Training uses full bit 16 and delta bit 20.
- Reliable Plan/Arena State keys are 8/9. All nine required collections participate in complete readiness (mask 511),
  replacement, reconnect clearing and atomic publication. Planning deadlines cannot be negative.
- Owner build/card dimensions are 80 cards and 8 boosts. RewardCard covers IDs 0–79. A Hunt delta of zero clears its
  target, including a Some-to-None chain. Training survives snapshot delta tracking.
- Observer handles and collection baselines commit only when the complete reliable publication is accepted. Native
  Kill/Trophy options have no complete wire representation yet: omit the entire unsupported row before staging any
  action binding. Never filter/reindex individual options or disconnect an otherwise valid publication. Default native
  observers retain the complete offer. Owner-only prerequisite refusal text uses the existing Toast event.

Full Wish input/owner transport remains refused before simulation/offers. Quest/trade public inputs and complete
Kill/Trophy transport remain pending. Native source implementations do not implicitly enable a public profile.

## Validation and consequences

The integration passes 329 engine-independent C# tests, synchronized Unity net sources, JS golden rejection/delta
checks, the actual Unity 6000.0.85f2 WebGL-target Editor compile and the 15-check Chromium WSS proof. Native restore,
hash, replay and publication regressions also pass; current detailed scope is in
[the consolidation evidence](../evidence/git-consolidation/README.md). The compile is not a new full Web player/performance
proof; the art lane remains separate. Future incompatible transports require a new version and all three consumers.

Capture metadata was refreshed only after preserving source gameplay payloads and reviewing protected-source and
harness inventories. [The receipt](../evidence/git-consolidation/source-metadata-refresh.json) distinguishes this from a
new legacy capture. No production legacy code or expected gameplay outcome is changed to make the union pass.
