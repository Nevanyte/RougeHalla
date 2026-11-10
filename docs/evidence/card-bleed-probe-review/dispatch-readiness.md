# Card/NPC dispatch readiness — independent read-only review

2026-11-10. Reviewed integration `ecaba4e07f4b86c9540985606fbaa7e04531686a` design and both packets; primary clean at `3eea4656a648f308deab854959631db262ae6775`. No Rust, tests, probes, captures, permission changes or shared records changed. Root approved B3 and the two extra consumer leases below. **Design is coherent; Root resolved the wire-representability gap below. Amend the design/packet and make final identity/lease reservations before dispatch.** No new source controls/probes are needed for this review.

## Reconciled design checks

`CARD_BLEED_NATIVE_DESIGN.md` and `P-CARD-BLEED-FEEDBACK-1.md` consistently retain trusted first insertion and sequential finite binary64 addition; finite overflow becomes PositiveInfinity and NaN absorbs later additions. B3 stores only nonnegative finite f64 payloads or payload-free PositiveInfinity/NotANumber tags, including finite signed-zero bits. Source dot/no-ability/no-signature filtering, true first-use500ms clock, source periodic/runEnded ordering, raid reset and teleport retention remain unchanged.

Public exact sidecars remain independent of the trusted fold. Both invalid-source and checked exact accumulation failures stay local per raw pair until settled viewer entitlement and source redaction; unentitled bad pairs never poison another viewer. Checked ExactSum add/merge/carry and final rounding failures are covered distinctly (InvalidAmount versus Overflow), with staged output cleared and no clamp, bucket omission or partial prefix. Empty markers, exact event indices, one populated segment/flush, up to two CardFlush/one CardReset, cross-domain reset isolation, retained-scratch guards, restore/reconnect nonentitlement and fail-closed delivery are consistent. No raw global total is an observation fallback.

Capacity allowance is consistently `656K + 546Q + 4608B + I(K)+I(Q)+8I(B)` with `K=U0+PV`, `Q=Q0+U0+PV`, `B=2U0+(P+1)V`. The tagged/flag/index allowances and representative numbers are explicitly provisional, excluding headers/allocator rounding and inherited allocations. Actual Rust sizes/capacity arithmetic/fallible cold preparation/warm allocation remain implementation acceptance measurements, not measurements the probes supplied. No universal small restored-domain cap or truncation was introduced.

## Required strict tagged intake, both persisted paths

The dispatch contract must make the closed B3 domain operational, not merely derive an unconstrained f64 deserializer. Validate **both World trusted rows and any pending `Event::CardBleedHit` in serialized `World.pending_events`**. Require canonical tag/payload shape, finite nonnegative Finite payload (preserve allowed signed zero), payload-free special variants, known raw actor provenance and unique full raw-pair report keys; keep applicable clock/report-state invariants. Reject unknown/ambiguous tags, duplicate discriminants/fields, payload attached to a special tag, missing/extra payload and negative or nonfinite Finite encodings. Malformed event data must not evade the rule just because the main report is valid. Test actual World and pending-event decode/restore routes with negatives; no IEEE special float/null alias or lenient alternate tag should enter either route. This is the explicit strict-intake requirement accompanying Root's B3 approval, not a new generic status admission policy.

## Concrete output gap resolved by Root: finite f64 can overflow the existing Hit wire

Existing `crates/rh-policy/src/delivery/projection.rs:394–403` maps `SeenEvent::Hit.amount` by unchecked `amount as f32`; `crates/rh-protocol/src/encode.rs:1546–1556` writes that f32 directly. A perfectly finite eligible Card sum such as1e40 survives ExactSum f64 rounding but becomes wire+Infinity. Therefore the design's current f64-only Overflow condition does not yet establish its promised no-special-number wire boundary.

**Root approved the narrow Card-flush guard inside the existing projector lease:** after viewer entitlement/redaction and exact public f64 rounding, but before staging any Card SeenEvent, check the actual existing f64-to-f32 conversion for finiteness. If nonfinite, fail that viewer closed with typed Overflow and clear all staged output under the existing policy. Retain the original f64 amount unchanged whenever the actual cast is finite, including values that round to finite f32 max. Do not clamp, pre-round the exact sum, use an arbitrary f64 cutoff, or edit shared to_wire/protocol paths. This is representation refusal, not altered trusted arithmetic. Require focused actual-cast boundary/overflow and hidden-unentitled controls, including no partial prefix; no source recapture/probe is needed. **Amend this exact condition into CARD_BLEED_NATIVE_DESIGN.md and P-CARD-BLEED-FEEDBACK-1.md before dispatch**; those files were outside this reviewer write lease.

## Exact shared-cut preflight

Both recorded cuts have checkpoint29/replay23/OBS21/policy15/protocol14. Integration content pin is8edd862f48ffa100; primary still has7c6a633f68c2cc72 (the separate admitted quest repair has not been copied into primary). Proposed checkpoint30/replay24/OBS22/policy16 and Card content marker remain **Root reservations**, not numbers reserved by this reviewer. Preserve the planned genuine63 ability source runs before any Root-authorized native tape recording; do not solve new World hash changes through metadata-only pin edits.

Against4151b3af, primary changes in the examined Card/shared paths are exactly:

- `observe.rs`: the lower `observe_with`/`observe_with_tiles` wrapper/signature and tile-visibility branch at old675–695/809–831; Card's raw `to_seen` match near282 and OBS constant20 are disjoint. Preserve the primary lower implementation; never copy the integration file wholesale.
- `systems/mod.rs`: a three-line cfg(test) `fighter_churn_tests` registration after old114. Preserve it while adding the Card module/registration in its separate hunk.

Examined state/sim/scratch/events/hash/schedule/content/checkpoint/replay/fx_report/projector/cards/policy-version and the two extra consumer files otherwise match4151b3af on primary. This is an exact recorded-cut check, not a future lease on Claude's evolving checkout. Root revalidates/reserves against the final cut.

## Two extra raw Event consumers — Root-approved narrow leases

1. `crates/rh-parity/src/canon.rs::canon` (match54) is the bounded `rh-legacy-scenario/1` comparator. Its default CAPTURE_WORLD explicitly has no cards; fixed legacy module boundary excludes cardHooks. Root approved one new raw `CardBleedHit => None` arm with a bounded-scenario/dedicated-Card-witness comment. Do not alter old expected fixtures or call the omission full legacy Card parity: legacy canonicalEvent generically includes FX, and the new dedicated Card consumer must compare typed raw totals directly, never route through this omission.
2. `crates/rh-headless/src/digest.rs::OutcomeDigest::event` (match244) is explicitly a trusted/private authoritative behavior fingerprint, including hidden actors/projectiles. It feeds optional trusted MatchSummary/parity-bench and wirebench `--digest` diagnostics, not policy/client observations; no policy consumer of OutcomeDigest was found. Root approved a narrow Card arm folding a new discriminator, victim, optional source, canonical B3 discriminant and finite bits only. Do not decode special tags to f64 or send this digest through observation/publication. The existing trusted diagnostic may change; it is not a public observer oracle.

Other inspected matches either consume SeenEvent (shape unchanged), have explicit catch-all diagnostic refusal/panic, or already live in the main Event/observe lease. No blanket lease to silence old source comparator failures is granted. If an actual new Card event reaches an old diagnostic projector outside its admitted profile, return that exact mismatch/scope need; do not weaken old expectations or drop source rows to make it pass.

## Separate NPC packet

`P-NPC-BLEED-RESTORE-1.md` now correctly distinguishes `StatusApply.value=None` plus AddValue from the materialized finite persisted `StatusInstance.value`. Its narrow helper/predicate and new cfg(test) regression module are confined to `systems/mob_checkpoint.rs` and `systems/mob_checkpoint/bleed_tests.rs` plus sanitized evidence. It preserves current Blaze/general validation and retained known-player history, asks the author to establish only real producer tag/clock relationships, and does not invent present/standing/card-ownership/current-expiry requirements. Real Attack/Release, accepted before-hit restore, earned surviving NPC Dot and original/Clone/restored continuation remain mandatory; installed status is not producer proof.

Root explicitly preserves identities only if the exact final diff broadens reader acceptance of the already-produced valid state without shape/hash/step/arithmetic changes; independent final verification is required. That decision and lease are separate from Card B3/storage/projection and need not wait for Card dispatch. No concrete NPC packet design blocker found.

## Readiness disposition

Proceed with the separate NPC predicate packet. Card implementation can receive a concrete lease once Root amends the approved Card-only actual-cast refusal and strict World/pending-event tagged intake into the governing design/packet and records final identity/shared-hunk reservations. The design/source/numeric/capacity decisions otherwise align; no additional probe/source-control campaign or preimplementation size measurement is requested. Final native admission still depends on the packet's real implementation/source/privacy/restore/size/allocation evidence.

## Root disposition

Root incorporated the explicit World/pending-event strict B3 validation, actual f32-cast refusal and the two narrow raw Event arms into both governing documents. The isolated Card identities are reserved at the reviewed cuts; actual worker assignment and later union still require a fresh cut check. No source/probe rerun or preimplementation layout measurement is required. Production Card work remains unassigned; the separate NPC repair is active.
