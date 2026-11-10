# Quest notice continuation — independent admission review

2026-11-10. **HOLD** at clean exact seal `b4aa87f8791c3a2586cc1402461f7b003d530212`, base `7c18d051e380ffbba8911bed6ba6ded34b932aca`, read-only backend-quest-runtime. Reviewer ran no Rust/source tests, authored no Rust and changed no shared record. Scope/source/positive notice evidence is valid; bounded guard/control/default-lint follow-up below is required before release. All repairs remain DeepSeek-owned.

## Concrete repair handoff

Line references are `crates/rh-sim/src/quests/notices_continuation_source_tests.rs` at this immutable seal.

1. **Wrong typed binding negative is vacuous before raid construction.** Lines660–665 call apply_action on `construct(case)` without the ordinary first step. That Sim is still Lobby and has no quest runtime, so offer_index180 rejects *every* quest id, including a valid captured one. Advance through the real raid-start setup, prove a known actual quest binding resolves/admitted positive source action, then submit the wrong typed id through the same action path. Require its intended resolution failure, rather than merely any caught panic. Keep unknown-action control separate. No expected quest state is installed.
2. **Use the actual ordered notice comparator in its negative.** Lines671–679 clone one source Notice and assert_ne on a recipient change; they never challenge the matched native sequence through the normal case comparison. Use an actual clean run, retain the unchanged sequence as a positive control, perturb recipient and/or order in a copied expectation and require the same complete ordered comparison to fail for that field/channel. Do not weaken the exact main comparison or mutate the frozen file. A small shared comparison helper is sufficient; no broad control matrix is requested.
3. **Complete the explicitly required reached-state guards.** Case1's container_has_quest194–199 and run502–508 check only the first item's quest definition. Capture the actual original produced item UID/container identity before diagnostic writes and verify the same item survives both real pickup guards, not a possible replacement with the same quest definition. Case3's producer checks10 published Open before/0 Open after and hidden0, but not the required10 hidden before,10 specifically Expired afterward/unknown count. Add those exact real before/after facts. Case5's run493–529 captures no state boundaries and never checks the actual named offers' published/Expired/closed_at states at the final tick164/8200: only the complete notice texts/order are checked. Capture the already frozen actionCount/tick boundaries and assert actual Cinder Cull publication/expiry, Frost private/nonactionable prepublication and the two named final offers' actual same-step Expired/closed time. These are the packet's existing source facts, not new outcomes or gameplay setup.
4. **Missing required default-feature strict lint.** Packet acceptance4 explicitly requires strict scoped default plus all-feature lint. Only all-target/all-feature Clippy is recorded. Run and retain the missing default-feature strict check after the test-only repair; do not relabel all-feature output as both configurations. Reuse unchanged source/giver/heavy hash evidence; no unrelated campaign is requested.

Use the existing finite test lease, preserve old0/4 and frozen181 records, keep all exact notice/reveal assertions and retained failures. Unknown action and malformed binding may remain diagnostic harness panics if caught deliberately, but the negative must establish its intended active-state path and positive binding, not an unrelated early failure. Root was notified with this consolidated handoff.

## Exact scope and source binding

Only12 paths changed: one new consumer, cfg(test) module registration, the approved internal teleport visibility hunk and nine new evidence files. Confirmed the coliseum diff is only `fn teleport` to `pub(crate) fn teleport`; body/call sites unchanged. No production quest/objective/reward/catalog/state/identity/source/expectation/client/lock/shared-status change. Native consumer24,829bytes/SHA256 `5efd6fb274da0cd85482de8e7fb8c2e12d105e34a85bfdf3b056b5d3096aef0e`; mod1298bytes/SHA256 `81bf78251b30a62ca73c78337c10cb2da7a71f88b00be92fa825f14869853bb1`; coliseum6578bytes/SHA256 `8c19c892399dbcea475a5b9b8bcbfefc9d1bbefb67a805f6fecbcb78e9dff688`.

Frozen source is byte-identical to base:1,154,229bytes/SHA256 `a20d751e88cb16765cf2aa3ef856765a0d3321d8e25eb6e41c6722cdf9a99244`. Old0/4 test is byte-identical:17,406bytes/SHA256 `2a4d9813f7a20f27b5b159a9eba190f41691dc245d0aeade5454b7510e20a105`. New bootstrap copies first-frame x/y/HP/maxHP as inherited compatibility setup; independently checked every copied field against declared input.actors.birth for all three actors in all four cases: all equal. Thus no expected earned progress/status/carrier/reward is installed. This is declared birth/setup compatibility, not spawn-position parity.

## Positive execution/producer evidence retained

Actual normal constructor/first step/captured map+seed/salts/config and real typed human join history are used. Inputs go through validate+submit. Actions are consumed in frozen array/tick order, then ordinary steps reach the final captured tick; source sequence/actionCount frame coordinates should bind the added intermediate assertions. No nearest actor substitute or unsupported action skip was found.

- Case1 is honestly NONCANONICAL: only recorded expired/open/carrier diagnostic writes occur while the real produced box remains. Actual pickups/acceptance run; exact private Over and silent sibling outcome are compared. It is not ordinary retirement/accepted-restore proof.
- Case2 uses actual collection/three pickups and real turn-in; only the two explicitly recorded deadlines are nudged. Final exact sequence includes discovery, aggregated expiry, GV, farm gain, owner and room completion. The progress guard at applied9 currently runs after the first deadline nudge, not before both as README says; the frozen collected boundary is applied8/tick5 if documenting a pre-nudge guard.
- Case3 invokes the full existing coliseum teleport producer with actual hooks/movement/reset and records its event vector immediately at tick3/time150 before the next step; aggregate precedes native Teleported. No hook-only substitute, pending-queue replay or duplicate notice injection was found. Full movement/immunity/patience trigger parity remains outside this notice slice.
- Case5 selects living mobs by real catalog type.zone, asserts actual Fire44/Frost41 before and0 after, calls real mob_life::hurt and ledger::pay_all, and preserves accumulated threat. It never installs Dead/recheck/closed state, deletes regions or clears threat. HP1000/deadline setups are labelled; real ordinary4s publication and recorded immediate queue/notice order are retained. It is not ordinary sword-clearing.

Source Toast/GV filters and native Event::Toast/Gv filters are complete within the declared classes; equality is the ordered vector of exact tick/time/type/recipient/text/GV actor/amount/reason. No synthetic Toast/event/reward is installed. Every captured source questReveal has an actual owner Preview definition/giver/expiry check through crate::observe and absence from every foreign human regardless of row state. This is an ephemeral entitled view companion, not persistent QuestObserver prepare/commit/reconnect proof. Case2's tick3 reveal uses the next frozen public boundary at tick5; it is not labelled an exact same-tick public snapshot. Native/source preview counts match1/3/0/2.

| Case | Source/native notices | Source/native total events | Honest excluded events |
| --- | --- | --- | --- |
|1|3/3|5/4|2/1|
|2|12/12|16/13|4/1|
|3|3/3|5/5|2/2|
|5|7/7|115/113|108/106|

These are valid scoped notice/view greens, not181-record native transport equality. No missing/extra notice is hidden by the differing non-notice event counts.

## Receipts and first-failure honesty

Read sealed raw logs: final four-case/control filter5passed/0failed in2.17s, unchanged0/4 filter1passed in1.79s. All-feature/all-target strict Clippy finishes successfully in15.44s; fmt output is empty successful output as reported. README records cwd, offline/locked flags, private target/jobs1 and exit0; raw logs themselves are Cargo output rather than complete embedded command/exit headers. Toolchain1.97.0 was queried after runs and is honestly labelled that way. No raw receipt was substituted with a source-control result.

Historical raw output contradicts two README summaries and should receive an evidence-only correction: first-compile-run actually fails case2 missing preview boundary and the malformed comparator control (case5 passes),3passed/2failed. Second-run actually fails case2 progress guard observed2 instead of3 and case5 overbroad future-public-frame assertion (control passes),3passed/2failed. The final public boundary selection narrows to the appropriate first frozen frame at/after reveal; the progress assertion moves to where the actual third pickup has been processed. These are harness-boundary corrections, not edits to source or notice expectations. Strict lint's copied-unused-helper/bool-assert failures and final formatting failure are retained. Preserve all these raw files; do not fabricate earlier code snapshots or lost command metadata.

## Disposition

HOLD for the bounded controls/state guards/default-lint repairs above, while retaining source/notice/view/producers and scope evidence as valid partial results. No source recapture, gameplay repair, public activation, identity/version change or broad test rerun is required. Final follow-up should inspect the exact new seal/delta and repaired four-case/control + old0/4 + default/all-feature lint/fmt receipts. Root alone integrates/adopts the six bounded notice/view cases and their diagnostic/order/direct-producer limits.

## Exact already-frozen guard coordinates for the repair

Match chronological `(tick, actionCount)` together: cases can have multiple frames at one tick and source has duplicate initial start labels. Do not advance to a later ordinary step merely to read the prior method boundary.

| Case / source frame | Tick / actionCount | Required actual assertion |
| --- | --- | --- |
|1 stale-closed-setup / stale-closed-refused|1/1 then2/3|Same original produced box and item UID before/after actual refused pickup; banner-holy remains declared Expired, carrierNone.|
|1 stale-carrier-accepted / setup / silent|3/6 then3/7 then4/9|Real acceptance before diagnostic carrier assignment; source p1 carrier and same box/item through silent real pickup; no additional notice in that step.|
|2 collected|5/8|Real shards-frost accepted/progress3 before either recorded deadline nudge.|
|2 target-step|6/12|Shards-frost Done; grand-tour/headhunter Expired, each closedAt300; long-haul stays Open/unpublished. Existing exact notice order/reward comparison remains.|
|3 accepted / producer-queue|3/4 then3/5|Before producer10 publishedOpen+10hidden/unknown10; immediately afterward10 publishedExpired (closedAt150), hidden0/unknown0; aggregate precedes Teleported in actual producer vector.|
|3 after-teleport-step|4/5|Expired state retained, no duplicate producer notice.|
|5 published-cull-fire|82/2|Cinder Cull actually published/Open after the real head-start wait.|
|5 camp-wiped-fire-closed|83/3|Cinder Cull published/Expired/closedAt4150 following actual Fire44->0 producer/recheck.|
|5 revealed-cull-frost / accept-refused|84/4 then85/5|Frost offer remains Open/unpublished, real owner preview and refusal; no fabricated acceptance.|
|5 publication-closed|164/7|Frost offer now published/Expired and grand-tour Expired, both closedAt8200; earlier Cinder Cull closedAt4150 remains unchanged. Existing publication-before-aggregate notice comparison remains.|

These values are read from frozen source payloads, not newly invented outcomes. The consumer must read actual native state and compare them; none becomes setup input. Final source/count/code bindings and the inspected raw first/final test results above are exact atb4aa87f8. Default strict lint remains an actual missing run, with no equivalence waiver requested or granted. Root accepted this bounded HOLD and is dispatching only the required test/evidence follow-up.
