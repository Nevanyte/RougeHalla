# P-CARD-BLEED-FEEDBACK-1: grouped card DoT hit feedback

## Outcome and dispatch gate

Implement complete source-equivalent trusted card DoT grouping, first-use500ms cadence and run-end flush, with a
separately admitted C-OBS Card projection. Damage/status application already exists. All Rust, readers and tests belong
to DeepSeek. Sol/Luna owns immutable source/design/independent review; Root owns dispatch, identities, leases and
integration. Claude retains networking/Unity ownership.

This packet is **planned, not dispatched**. The concrete design, completed static growth/memory calculations and exact proposed hunk leases are in
[CARD_BLEED_NATIVE_DESIGN.md](../../coordination/CARD_BLEED_NATIVE_DESIGN.md). Root must approve its capacity/memory
calculation, the specific arithmetic/restore probe decision below, public feedback contract and final identity/file
allocations before assigning an available Rust worker. No source recapture or native implementation is authorized by this update.

## Released source dependency

- Corrected source seal integration `570fe186`, independently reviewed transfer
  `c76f8e46eebebd91a25c8cd7e4f1dd88ba4f4538`.
- `parity/card-bleed-feedback/source.json`, format `rh-card-bleed-source/2`,7 cases/390 ordinary steps,410111 bytes,
  SHA-256 `6b36256739bd473bc70ebd160a8632a26470ab8e4190f873026bd714e53d36ed`.
- `parity/card-bleed-feedback/controls.json`,3191 bytes, SHA-256
  `248a3be77749e9f966a9fff3ad6f7ba44ea4db4d3eddba3e0c9be9a71578fcd9`.
- Source preparation manifest SHA-256 `9869a390c4f5a3ad939254d94e0ef44571397b653f3c10ec6e9d171d3bd29d8e`;
  tools `tools/card-bleed-fixtures/**` and source preparation/review evidence are immutable.
- Independent release: `docs/evidence/card-bleed-source-review/corrected/README.md`. The original held candidate and
  HOLD evidence remain preserved; do not consume its incorrect six-row fresh-contribution count.

Source /2 distinguishes `landedSnapshot` (retained scratch) from `processedLanded` using pre-dispatch active/nonvoided
producer eligibility. The real ending tick7/350ms contains one fresh hit, five cumulative hits and a1.1180044891585073
flush. The already-ended tick8/400ms retains scratch1 but processes0. Native consumer must drive scheduled producers,
not install/replay expected landed rows. Setup/loadout/position/HP and explicit startRaid boundary are declared inputs,
not claims of earned full-match reachability.

The witness covers ordered repeated/distinct pairs, first-use500ms/empty intervals, early natural run-end, teleport
retention, raid reset, actual Fire burn/backlash exclusion and no-card control. It does not claim all ability-tagged
variants, anonymous source pairs, arbitrary IDs, a voided-active scenario or separately invoked empty runEnded. Semantic
controls kill per-contribution grouping, strict>500 and missing run-end; comment-only is NONKILL. Fresh pinned byte
reproduction passed independently; no redundant capture/mutant sweep is required merely for native dispatch.

## Source versus native public contract

Legacy `cardHooks.ts` stores since plus insertion-ordered victim/by/amount totals and broadcasts raw aggregate FX at
flush; no contribution audiences exist. [The design review](../../evidence/card-bleed-feedback-design-review/README.md)
and ADR0013 distinguish source parity from deliberate native settled-tick entitlement.

Use an explicit **server-only raw CardBleedHit Event** for trusted aggregate/source comparison, omitted by exhaustive
Event visibility/class and stateless/raw observation conversion. Extend existing FxTickReport/FxProjector with Card
Contribution/Flush/Reset operations and a distinct bucket domain. Public entitled output uses existing
`SeenEvent::Hit { victim, by, amount, passive:false }`; never use delayed ordinary Event::Hit to publish private totals,
repurpose passive, or invent signature/ability IDs. Existing Hit wire shape supplies bounded victim/source/amount damage
feedback, without identifying a Card/DoT/drip or promising legacy visual behavior. No codec/Unity work is assigned.

Project each contribution using the settled source tick's existing sees(victim) OR by==viewer predicate. Redact unseen
sources before grouping, merge anonymous contributions and use existing ExactSum/public-key ordering. Keep trusted
ordered binary64 totals distinct. Eligibility survives later disappearance; do not re-filter at flush. Stateless previews
never reconstruct entitlement from World. ItemObserver/public-ID authority and validate+Sim::submit remain unchanged.

## Runtime behavior and state

- World owns only `CardBleedReport { since: Option<f64>, rows: ordered Vec<victim/by/amount> }`; None represents absent
  source report. Some with empty rows preserves periodic clock. Capacity is derived, not serialized/hashed. No viewer
  history or visibility state enters World.
- Actual current eligible landed rows are dottrue/abilityNone/sigNone. First hit initializes since=now, matching pair
  amounts add without reordering, and every fresh contribution reaches the derived report domain.
- At the existing card afterDamage source point after stillness, when now-since>=500, emit CardFlush marker and raw rows
  in source order, then clear rows/set since=now. Empty existing reports retain their marker/clock behavior. Preserve
  all unrelated card pass/splash ordering.
- Replace pending runEnded `cardHooks.flushBleeds` at its exact existing schedule position. No direct flush-helper test
  shortcut. Periodic plus run-end can both occur in one step, with domain limits validated before copying.
- At GateAlways cardHooks.resetAll, clear trusted report to absent and emit CardReset. Existing signatures Reset is
  gated off in the released core profile and is insufficient. Card reset/flush affects only Card; other domains retain
  their behavior. Teleport does not clear/flush Card totals or entitlement. Repeated Ended/Lobby steps add no stale hits.
- Clone/restore preserves trusted rows/cadence but renews report instance token; projectors reject foreign identity.
  Fresh attach/reconnect starts after current tick without historical entitlement. Gaps discard old public buckets,
  duplicates are idempotent, backward/invalid/overflow/bounds failure clears/disables until rebind. No partial public
  prefix or fallback raw-total publication.

## Bounds and allocation gate

The design inventories real live players, regional birth/respawn, training dummy/practice lifetime births, companions,
removed identities, status keys and generic restored rows. The eight-seat limit does not bound NPC victim count. Do not
reuse fixed512/16 report assumptions or cap trusted rows by a public projector capacity.

Live Hemorrhage merges same source/victim/tick and lasts2000ms (at most40 active tick keys), plus one Festering key;
only players produce these card statuses. Generic restored Dot/status/deferred shapes are larger. Cold preparation must
count actual initial eligible status/deferred edges E0 and existing report rows Q0, then add the checked live source/
victim churn envelope from the actual arena/config. Preserve every previously accepted generic restore shape; no small
static-bound admission tightening. The completed follow-up on backend `04987499972be06a39b21c4bf741b92390d135f9`
uses P=max(8,current players), A0=all current actors and universal V=A0+14P+2R+150 for an accepted restored window,
including hot Training/admin/owned-zombie churn. Pristine specialization is explicitly separate. Conservative new
reservation estimates are0.84MiB player-only8,44.60MiB Full8/R204/no-dummies,18.30MiB pristine training8, and154.12MiB
for the documented larger restore example. These are field-layout planning estimates, not native allocation receipts;
exact formulas, assumptions and size measurement follow-up are in the design.

Pre-reserve trusted rows, scratch/report operations/events and projector buckets/output on construction/clone/restore;
clear/retain capacity across flushes and rebind. Unsupported public representation fails explicitly without dropping
trusted gameplay. Establish finite trusted sequential sums across all accepted restore/training values; finite individual
amounts alone do not establish this. Preserve source arithmetic instead of clamping or changing sum order.

Measure first/repeated windows, maximum admitted domain and clone/restore/rebind. Existing Hemorrhage creates per-tick
formatted Arc status tags, so report reservation alone cannot prove whole-producer zero allocation. Distinguish newly
introduced report/projector allocations from inherited status allocations, retain actual results and request separate
Root scope for a demonstrated inherited blocker. No unsolicited status optimization belongs here.

## Proposed native paths and leases

NEW mechanic/tests: `crates/rh-sim/src/systems/card_bleed_feedback.rs` and adjacent new test modules; NEW receipts:
`docs/evidence/card-bleed-feedback/**`. Existing-file **hunks only**, as fully specified in the design:

- systems/mod.rs registration; World field/default in state.rs; source-phase call in cards/after_damage.rs; CardReset at
  cards/runtime.rs reset_all; existing pending schedule run-end link.
- events.rs server-only raw variant/classification; observe.rs raw exclusion and separately reserved version constant.
- fx_report.rs Card operations/rebase/domain limits; fx_projector/mod.rs Card accumulation/markers/output/preparation,
  reusing exact.rs; scratch.rs and narrow Sim/checkpoint cold preparation/validation.
- Narrow regional-NPC Card Dot checkpoint admission hunk, only after the real producer/refusal probe below establishes
  it; preserve existing accepted Blaze and generic-player status domains. No unrelated validator refactor.
- Approved content marker visitor, reserved checkpoint/replay/observation/policy constants, exact native version
  assertions, real hash-coverage/restore/allocation witnesses and focused schedule classification table if needed.
- Root-controlled tests/content.rs golden and parity/abilities/hash-tape.json derived pins, only after actual existing
  source cases execute and Root explicitly authorizes any native re-record. Existing63 legacy outputs remain immutable.

Read-only primary recheck at `c99e69f0524c386dee1de4dd34ac65fc4847ae93` confirms selected shared files match4151b3af,
except disjoint lower observe_with/tiles changes. Preserve those hunks exactly; Root rechecks active Claude leases at
dispatch. No whole-file copy, public observation schema/codec/client, unrelated status/card rules, Cargo.lock, shared
status, source fixtures/tools, merge/push or actual publication. Additional exhaustive Event consumer needs return its
exact necessary hunk for Root allocation, not implicit scope expansion.

## Identity and derived pins

Planned, not reserved: checkpoint30/replay24 for new serialized/hashed state, OBS22/policy16 for changed public knowledge
semantics under ADR0013, plus a new content marker (suggested `card-bleed-feedback/1`). Root must revalidate exact numbers
against final union/Claude cut. Existing card catalog rows/fold words stay unchanged; marker placement is explicit.

New World shape changes even absent-report hashes. Run all63 existing admitted ability source cases on final native code
before Root-authorized native tape recorder; do not make metadata-only updates, rewrite source outputs, drop cases or
record over a genuine source mismatch. Existing hash-coverage/checkpoint/refusal/version tests must cover new leaves and
old-rule refusal. Search exact prepared union for all affected native assertions/pins; design lists current known paths.

Protocol14 codec shape stays unchanged. Existing Rust/C#/JS golden decoders and publish/header compatibility still need
joint integration verification. Any client-advertised version/generated fixture refresh belongs to a later Root/Claude
lease, with no promise of new drip presentation in this packet.

## Concrete predispatch probes

The design's completed calculation finds a specific numeric hole in the accepted generic player-status shape: finite
Dot value1e307 can overflow `value*50/1000` at multiplication;4096 distinct sourceless Dot tags at1e306 can produce
finite individual5e304 rows whose source-ordered sum becomesInfinity at prefix3596. Finite HP does not cap the player's
reported landed rows to actual applied HP. These are static accepted-shape counterexamples, pending actual restore/
step confirmation, not native run receipts. Current C-DET forbids nonfinite World floats; public ExactSum refusal does
not repair authoritative overflow. No arbitrary small count/value cap, sum reordering or tagged nonfinite workaround
is authorized.

Root assigns DeepSeek three disposable probes, with no production repair, exactly as specified under
`Exact three-probe DeepSeek handoff` in the design:

1. Actual baseline checkpoint→one sourceless Dot1e307→actual restore→one ordinary step; capture acceptance/refusal and
   actual landed amount/finiteness/layout behavior.
2. Same full reader/step with4096 unique sourceless tags at1e306; capture finite individual rows versus source-order
   aggregate and print actual type sizes where accessible. Do not substitute ExactSum for the trusted diagnostic fold.
3. Normal constructor/real card grant/validate+submit physical attack earns Hemorrhage Dot on a real regional NPC;
   checkpoint restores before the hit, then capture current restore refusal with actual live Card status. The existing
   `mob_checkpoint.rs` predicate admits only Full Blaze Dot; no installed expected status or expired/dead target shortcut.

After receipts, Root selects the smallest justified numeric admission treatment and allocates the source-backed
regional Card Dot restore repair. Unsafe generic arithmetic must be addressed deliberately without excluding arbitrarily
many safe rows or changing required ordered binary64 trusted sums. Public redacted sums deliberately remain exact.
The current immediate next action is this evidence-producing probe task, not an unspecified audit or native report dispatch.

## Acceptance

1. Root reviews the completed bound/memory calculation and actual three-probe results, approves the selected small
   arithmetic/restore treatment, output contract, identities and exact leases; DeepSeek gets
   isolated clean branch/private target and pinned Rust1.97.0 locked/offline/jobs1 environment.
2. Replay the immutable seven source input cases through real producers and ordinary50ms steps, comparing trusted raw
   amount/pair/order/tick/cadence/reset/end behavior. Compare /2 freshness accurately; never install expected pending state.
3. Separate native semantic controls prove settled hidden-history protection, pre-key redaction/anonymous permutation,
   source/victim departure, IDs>8/NPCs, byself eligibility, cross-domain empty/nonempty markers, signatures-off reset,
   teleport retention and normal repeated empty/Ended reports. No native public-row equality with legacy global broadcast.
4. Mid-window checkpoint/replay/clone continues trusted totals while fresh projector/reconnect earns only later
   entitlement; duplicates/gaps/backward/foreign/bounds/amount errors fail closed. Observation/publication schedules must
   not change World hashes/gameplay. Raw/stateless observation never leaks totals or grants handles.
5. New real hash/restore/warm witnesses plus affected card/status/report/projector/schedule/content/replay/version gates,
   strict scoped Clippy and fmt pass on the exact seal, with raw first failures and terminal receipts. Root coordinates
   wider decoder/publish/headless compatibility once for the admitted union; no broad unchanged suite repetition.
6. Independent review releases exact source/native/identity seals separately. Source-only release is already complete;
   it does not authorize native implementation, public activation or Unity/client work.
