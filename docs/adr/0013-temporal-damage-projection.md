# ADR 0013: Temporal damage projection

**Decision status:** Accepted for the bounded player-only Plague slice. **Validation:** design and actual-source audit
reviewed; implemented with independent gameplay/public review and the post-fix 557-test native gate. This record does not claim full faction or protocol support.

## Evidence and boundary

Legacy signature damage reports accumulate post-barrier landed damage privately and flush every 500 ms from raid start,
including an early run-end flush. Filtering a whole chunk using visibility at flush can disclose earlier hidden damage.
An actual-source pair first exposes the victim on tick 9 with identical visible HP/signature history; tick-11 chunks
are nevertheless 12.146966292134834 and 8.097977528089888. Each legitimately visible portion is 4.048988764044944.
Suppressing only chunks with hidden contributions also leaks through event absence. Trusted totals, insertion order,
first weapon, damage, credit and flush timing must retain source semantics.

## Decision

One retained Rust `FxProjector` per viewer session lives outside authoritative `World`. It consumes a sealed, derived
`FxTickReport` completed after every simulation step. That report records ordered contribution/reset/flush operations
at their actual phases and freezes contribution eligibility and source visibility with the settled observation predicate.
Empty periodic flushes and repeated Lobby/Ended steps have explicit complete reports. The report never reads stale
last-active landed scratch or grants actor/item command handles.

Eligibility bits index a bounded frame table of actual viewer IDs, never raw ID values. A private allocation token
distinguishes simulation instances: ordinary steps retain it; new/reset/clone/restore create a fresh token and empty report.
The token and report are derived state outside hashing, checkpoints and gameplay decisions. They require no entropy,
global counter or multi-tick World history.

Project each contribution at its own settled tick before accumulation. Redact unseen sources before forming keys; merge
anonymous sources by public victim/signature and suppress their weapon attribution. Flush positive buckets in public-key
order. Use an exact nonnegative binary64 sum and round once, preventing private source order from affecting low bits.
Trusted accumulation retains the original ordered binary64 additions. Previously eligible contributions survive later
source/victim departure; do not re-filter them at delivery or flush.

Fresh attach/reconnect starts after the current completed tick. Repeated feeds are idempotent and repeated reads are pure.
A gap discards old public entitlement and processes only the current complete report; it never reconstructs missing sight.
A foreign instance or backward report clears/disables projection until explicit rebind. Restore preserves private pending
chunks but grants no historical public entitlement. Unsupported bounds fail explicitly rather than truncating.

Live human seats, external headless seats and synchronous/asynchronous policies feed every step, including empty-event
ticks, terminal ticks and steps without a decision/publication. Adapters enqueue newly advanced projected output once.
Actor/item observation prepares still commit only after successful delivery. Stateless previews never reconstruct delayed
private chunks. Raw delayed reports are server-only; qualified public signature events use the retained projection seam.

The initial scope has eight current players, at most sixteen Plague contribution rows per step, and at most 56 named plus
eight anonymous buckets per signature per window. Later producers must audit and extend these bounds. New authoritative
state and public semantics require checkpoint/replay and observation/policy version changes. Protocol 5 explicitly omits
new signature-qualified effects until a compatible wire/client change; Disease must not become an unqualified ordinary Hit.

## Required proof

Pin the actual-source paired leak and compare eligible public output while retaining exact private totals. Cover anonymous
source permutations/weapon changes and exact summation, empty windows, duplicates, gaps, mid-window attachment, reconnect
on a flush tick, instance/clone/restore rejection, IDs above eight, dead-viewer terminal delivery, departures, periodic plus
run-end flushes, and discarded item prepares. Observation schedules must not change trusted hashes, replay or gameplay.
Measure warmed projection allocations. Independent critical review and integrated parity/headless gates passed; see [evidence](../evidence/stage2-plague-map/README.md).

See [P-FACTION-1](../backlog/packets/P-FACTION-1.md), legacy `sim/factions.ts`, `sim/ledger.ts`, and existing C-OBS/C-POLICY.
