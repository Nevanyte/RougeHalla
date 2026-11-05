# ADR 0014: Sentenced public state and marker identity

Status: Accepted, 2026-11-05. Bounded base-player observation 11 / policy 8 extension; private checkpoint /14, replay /12 and wire 5. Independent gameplay and public-boundary reviews passed.

The legacy faction installer synchronizes each surviving victim's strongest incoming Mark tier, brand=tier*25, strongest raw owner string (`markBy`), base tax0, and execution-blocked effect bit. The owner's own `SigFighter.tier` is private progression, not an actor effect field. Legacy ties use JavaScript string `<` on real arbitrary IDs; source IDs are not inherently `p<n>`. Rust PlayerId is monotonically allocated numeric identity. The existing C3 numeric private tie correction is the precedent; synthetic parity fixture string order must never become a runtime allocator or ID comparator.

Observation publishes only the victim's maximum surviving incoming tier, brand, base tax0 and existing effect bits. It selects identity separately: among owners at exactly that already-public maximum tier, restrict to owners eligible in the current complete viewer observation (visible actor rows or viewer self); then choose the lowest numeric runtime identity. The marker references only that existing actor row's identity. A hidden tied owner cannot suppress a visible owner's identity. A hidden stronger owner legitimately raises the already-public effect tier and leaves identity empty if no eligible owner has that tier. Viewerless PublicPlayer summaries have no marker identity. Dead victims have zero effect and no marker. Observers do not gain handles from FX, Mark notices or private owner lists.

This intentionally corrects two legacy presentations: lexical arbitrary-ID tie order becomes deterministic numeric runtime order, and raw/global-winner-then-redact becomes eligible-before-select to prevent hidden-ID suppression. Private gameplay state, ledger entry order, damage, credit, source-exact raw FX and the source marker captured in parity diagnostics are unchanged by public selection. Fixture canonical `p<n>` lexical marker reconstruction lives only in the parity harness.

The existing complete-delivery actor contract uses PlayerId actor rows rather than a second remapped actor-handle type: ItemObserver stages IDs from the complete Observation.visible and commits that list only after successful delivery. Marker references must come from the same complete delivered actor set or self; no marker code may append to that registry. Failed/discarded prepares cannot authorize a target. Numeric IDs here mean the identity of an already-public actor row, not permission to disclose an unseen actor.

Actual source producer evidence: tools/sentenced-fixtures/public-pairs.ts executes the real ordered HOLY_MODULES installers and ordinary attack/release intake. Initial map, positions, HP and bootstrap placement are explicitly trusted setup. Across64 ticks, changing only a hidden owner's arbitrary source ID from a-hidden to z-hidden changes the legacy raw winner while leaving exact visible actor/HP/tier/brand histories, redacted ordinary physical events and anonymous Mark rows identical. The eligible public winner remains owner-visible. Separate visible-stronger and hidden-stronger controls establish selection at the public maximum tier. No private target/tier/hit/ledger/FX state is fabricated. This pair demonstrates tied hidden identity suppression, not changed hidden source-count/history anonymity.

Qualified Mark instant events use the existing retained FxProjector's fixed post-ledger InstantFlush marker and report-local buckets. Redact before public keys; anonymous owner and weapon are empty; exact binary64 accumulation merges anonymous rows at (victim,Mark), without exposing source count or order. Raw Mark row counts are independent of performed requests. Report bounds remain512 total raw events,16 instant buckets,20 operations,784 outputs; observed producer maxima and explicit overflow probes are required separately. Source-private marked/carried-out/execute-blocked notices remain server-only.

Protocol5 continues explicit omission of new faction presentation fields/effects. No Unity or legacy wire extension is claimed. Future cards/AP, nonneutral tax/amp/suppression, mob/camp marks, hunt and arbitrary admitted dense-flight reports remain outside this acceptance.

A second actual source producer triple now covers hidden source-count/history and ordering, rather than only hidden tied identity. With real wand cast, bow swap, movement, aim and release inputs, one hidden Sentenced owner has two genuine old-ball/new-arrow hits on tick36; an otherwise observationally equal trace has two hidden Sentenced owners producing one each. A third trace reverses owner insertion and therefore private Mark FX order. Across41 ticks, exact visible actor/HP/tier/brand histories and redacted ordinary physical hits agree. Tick36 anonymous Mark sums10.806741573033708+9.144165946413139 in every case, with hidden weapon attribution suppressed. Initial map/positions/inventory/HP are trusted setup; no targets, tiers, progress, clocks, ledger rows, projectiles or FX are injected. `tools/sentenced-fixtures/hidden-history-pair.ts` and its frozen output provide the source evidence.

After a between-step source departure, legacy stored `markTier/markBy` await the next syncVisuals pass. New public observations derive current surviving owners immediately; no departed marker identity persists. Parity captures and compares source private presentation at its actual afterDamage seam before out-of-band fixture actions, then filters diagnostics to remaining actors. This timing correction affects public presentation only.


## Consistent current-state bits and failed sessions

The execution-blocked bit must be derived from the same current surviving incoming tier as the public tier/brand.
Removing the last tier-four owner cannot leave public EXEC_BLOCKED set beside tier zero. Projection rebuilds only that
bit; other effect bits and private stored signature state/hash remain unchanged. Direct, cached, self and visible-actor
views share the rule, including between-step departure before the next private afterDamage sync.

A retained projector failure is a sticky session fault. Synchronous feeds, decisions and drivers, like the asynchronous
path, refuse further observation delivery, actor-registry commit, cadence advancement, policy/fallback calls and commands
for that seat. This includes ForeignInstance and same-instance UnsupportedBounds. A fresh seat/session is the explicit
recovery baseline and does not acquire old event entitlement. Other policy faults retain their existing fallback rules.
Both regressions were independently reproduced before repair and re-tested afterward with fresh positive controls.

See [the evidence](../evidence/stage2-sentenced-support/README.md) and [ADR 0013](0013-temporal-damage-projection.md).
