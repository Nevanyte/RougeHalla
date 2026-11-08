# P-SENTENCED-MARK-RATE-1: Gathering Storm drives actual Mark progress

Lead assignment to a spare DeepSeek Rust worker after the Sentenced restore file is released. The prior restore-only
repair is complete/reviewed at `c5b11341cb4abe4149ddbf99f10223592c1a703a`; start a fresh isolated continuation from
that immutable base. Preserve refs/WIP and use an own absolute target. The lead owns integration and final content/tapes.

## Concrete defect and exact outcome

Source `packages/server/src/sim/factions.ts::markStep` accumulates `markRateOf(c.s)/max(priorChill,0.05)` per qualifying
hit. Source `mods.ts::markRateOf` is max(0,1+the folded MarkRate sum). Ready unique Gathering Storm contributes+0.5.
Native `systems/sentenced.rs::before_damage` currently adds1/chill and has no MarkRate consumer, so that offered card
does not accelerate Mark. Port this complete bounded player mechanic without changing qualification, tick order,
pulse counts, hit counters, No Commutation/Swift Judgment promotion semantics or other faction effects.

Add a narrow folded modifier accessor using the existing Runtime sums; avoid expanding StatView and unrelated literal
call sites. Small pure runtime helpers for mark rate/progress are appropriate so root can fold their actual outputs
into the final content identity. Use the same helper in production, not a separate hash-only formula. Preserve source
arithmetic order and the existing denominator floor. No new serialized field, RNG, command or module is needed.

Restore bounds must match actual reachable progress history. Ordinary ownership only grows and can add Gathering
Storm mid-Mark; past increments are not recomputed from today's rate. Training Clear can remove the card without
resetting Mark. Derive the maximum historical rate from the shipped unique catalog producer (currently1.5), never an
invented permissive bound; retain the actual Frost minimum/history reasoning, finite/nonnegative/zero-hit checks,
counters, earned-tier ranges, target/time/denial checks. Verify no other shipped farm/trade/status/card source can
produce a different rate. Current console INTERACTIVE does not include Gathering Storm; do not widen that console gate
or pretend a refused Train Card count0 removed it. Real Clear is the admitted removal path for the history control.

## Scope and source proof

Write only `systems/sentenced.rs`, necessary dedicated Sentenced tests, a narrow accessor/helper in `modifiers/mod.rs`,
new `tools/mark-rate-fixtures/**`, `parity/mark-rate/**` and `docs/evidence/mark-rate/**`. Frost implementation, shared
state/checkpoint/hash-coverage/content/schedule/formats/derived tapes, existing expected corpora, server/protocol/client,
Cargo.lock and shared status records are read-only. The root will register actual new rule/helper outputs and derive
the final combined identity; unchanged candidate hash is not proof of gameplay compatibility. Report any other exact
prerequisite before editing outside this scope. No primary/managed writes, main merges/pushes or live activation.

Capture actual source in a correctly declared player-only/no-mobs full-player faction profile, real grantCard and
ordinary validated attacks/50ms steps. Record trusted initial placement/build setup; never install expected progress,
chill, tiers or damage. Compare complete bounded source/native timelines for neutral rate, Gathering Storm, real
resisted/deepened Frost, both tier flags, mid-Mark grant and real training Clear/history. Include owner card vs opponent
card/no-card controls and non-Sentenced behavior unchanged. Separate pure helper diagnostics from runtime witnesses.
Reuse actual source modules, not copied formulas or a synthetic ledger presented as normal input.

Use pinned Linux/amd64 Node22.23.4 with immutable image/source/tool/dependency/config hashes and canonical byte-exact
capture --check. At least three compiled semantic mutants must fail actual consumer outputs (missing rate, wrong
prior-chill/promotion behavior, invalid training/history restore); compile errors are not kills. Restore control.
Exercise real restore/continuation and replay with new progress, malformed progress/tier/counter/time refusals,
relevant warm allocation and both affected strict lint modes/fmt. No unchanged full map/workspace campaign.

Success is real Gathering Storm behavior plus source parity and strict reachable history, with no old source rewrite
or gate widening. Failure/hold is injected expected outcomes, wrong profile, merely broadening validation without the
runtime multiplier, changing unique/card eligibility, or missing source/native continuation proof. Deliver clean
reviewable commits, exact base/head/files/helpers, corpus/tool hashes, commands/results and identity/publication
remainder to the existing DeepSeek Rust report. The full NPC and other full-port prerequisites remain separate.
