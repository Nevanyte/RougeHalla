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

## Fire extension: implemented and independently reviewed

Two independently executed actual-source probes demonstrate that per-row Backlash redaction discloses unseen source
count. A helper pair leaves the same visible HP but emits one anonymous amount versus two half amounts. A separate
actual Fire-producer pair uses three hidden bow Fire fighters versus four hidden fist Fire fighters: all visible actor
rows, including exact HP, agree through ticks 2–17, while tick 13 emits three versus four retaliation rows totalling
111.90727380248373. These are new producer/projection requirements, not a claim that the full Fire installer is ported.

A pipeline-consistent helper also demonstrates that grouping at the first private Backlash row leaks hidden ordering:
an ineligible hit on a hidden victim changes public `[Hit, Backlash]` into `[Backlash, Hit]`. A fixed marker is required.
Keep trusted individual instantaneous events source-exact and server-only. Accumulate eligible instantaneous rows in
report-local buckets with the same redaction, public-key order, hidden-weapon suppression and exact addition rules.
Emit them at a fixed marker **immediately after `ledger::apply` returns to its schedule row**, before faction
afterDamage/Holy healing. This follows any payout drain performed by that call. Preserve the source's early empty-ledger
return: the marker exists even when it emits nothing, without adding a payout drain to that path. Ordinary physical-hit
behavior is unchanged.

Instant amounts come from actual emitted pre-barrier FX; full absorption produces no FX. Post-barrier landed amounts
remain for sustain and delayed Burn/Disease reports. Separate instantaneous buckets from retained DoT buckets: neither
flush may clear, duplicate or retain the other's rows. Introduce explicit `is_dot()` classification; all signature kinds
remain excluded from physical-contact and axe-shred production.

For eight current players, delayed capacity becomes 128: two DoT kinds times 56 named directed pairs plus eight
anonymous victim buckets. Active joins are refused. Each weapon update has at most two request-producing land calls,
so performed requests and per-owner requests are bounded by 16 and two respectively. One engaged target per Fire then
bounds Backlash rows by 16. Check those distinct limits, one instantaneous marker, at most 16 delayed rows/two delayed
flushes/one reset, 20 operations and 784 projected outputs (`512 + 2*128 + 16`). Unsupported reports fail explicitly.

The partial mode is EngagementHolyPlagueFire, default Off. Versions are checkpoint /12, replay /10,
observation 9 and policy 6; protocol 5 keeps explicit omission. Checkpoints must reject Backlash in delayed buckets and
execute on non-Disease entries. Actual performed-request captures, paired privacy/order regressions, mixed
periodic/terminal windows, session/cadence and allocation checks passed independent gameplay and public reviews. No other
faction/auxiliary/card/AP/mob producer or complete Fire installer is implied.
