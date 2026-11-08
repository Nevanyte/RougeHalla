# P-TROPHY-BIRTH-HOLD-REPAIR

Lead assignment: continue the isolated `deepseek/trophy-native-consumer-1` branch from immutable
`7bf5806c29ea8b8ef86dfc80cc908bf4c3b8684c`. Preserve all other worker branches and WIP. The lead owns integration,
content identity, tapes, shared records and public transport decisions.

The admitted source lifecycle records birth tick2, holdBirth through tick3 and first legal Choose at tick4. Native
`reward_chests::choose` currently accepts at tick3 (`held_until_tick > tick`), while its observer already correctly
requires `held_until_tick < tick`. This is a gameplay parity defect, not a reason to rewrite the source witness.

Implement one narrow crate-private pure availability predicate for `held_until_tick < tick`, used by both Choose and
the observer. Preserve the stored field, birth_hold_ticks, tick order, refusal ordering, expiry boundary, owner/range/
picker checks, grant arithmetic and the existing unsupported-public-Kill omission guard. No schema/version/content/
tape/lockfile changes. The lead will register actual predicate outputs in the content identity.

Write scope: `crates/rh-sim/src/reward_chests/{mod.rs,observer.rs,tests.rs}`, the existing new
`crates/rh-sim/src/kill_augments/{lifecycle_consumer,helper_consumer,format_consumer}.rs`, and
`docs/evidence/trophy-native/**`. No production change outside that narrow scope. Existing source corpora/captures are
read-only. Report another mismatch before extending production scope or changing native expected goldens.

Replace the asserted-divergence/early stop with a complete comparison of every frame in all six admitted lifecycle
cases, including refused birth/next-tick picks, legal first pick, repeated pick and skip. Keep actual native births,
validated commands and grants; never install expected options, gains, ownership or takenBy. Add focused ordinary
chest and Trophy boundary checks proving observer can_choose and Choose agree at before/equal/after hold and expiry.
Prove the existing eligibility, denial and transaction tests still hold; test-only fabricated chest setup must be
labelled separately from genuine lifecycle evidence. Keep trusted initial grants/wounds distinct from ReplayInput.

Run focused Trophy consumers, reward_chest tests, affected warm allocation checks, strict rh-sim Clippy both modes
and fmt. At least three compiled semantic mutants must produce actual native consumer mismatches: restore the early
Choose predicate, change the birth hold, and bypass a relevant owner/grant guard. A provenance-only edit must remain a
non-kill and the restored control must pass. Do not repeat the unchanged full workspace/maps/source-Wish campaigns.

Use a separate checker for the completed diff. Success: all six full source/native lifecycle cases match with no
skips, exact boundary agreement and unchanged source payloads. Hold: any remaining lifecycle discrepancy, synthetic
expected outcomes, weakened source/native gate, unrelated production edit or a claimed acquisition replay unsupported
by ReplayInput. Deliver clean commits with exact base/head/files/results/limits to the existing Post Rust report;
do not merge/push optimization_port, deploy, spend, change accounts or perform ML work.
