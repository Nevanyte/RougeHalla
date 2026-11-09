# Temporal core final source/evidence binding

**SOURCE + EVIDENCE RELEASE for the private inactive component only.** Exact seal `815c5ee2af9f202420b7fa7d5d7f267387bcd179`, direct parent/final code `d61c6e0127b41714a0e5c84101a75e4825b80de5`. Prior source-ready release at `1b3666cee5647a1c95908ebc5527656914bf121d` stands with the limits below. No concrete merge blocker found for this finite scope.

Independent read-only verification used immutable Git blobs in the fair-percept14 repository; no build, source execution, capture, cache, Editor, network or author/main mutation. This binds retained author receipts; it is not a reviewer rerun.

## Exact source delta and seal

Between reviewed source-ready and final code, the sole production difference is `temporal_percept.rs` death-history pruning: `!(a < b)` becomes `a.partial_cmp(&b) != Some(Less)`. It preserves Less/Equal/Greater and unordered behavior. The only test difference is the same exact native effects object assertion using JSON f64 literals `1.0/2.0` instead of integer representations `1/2`; no weakening, captured expectation, tolerance, source input or output changed. Final seal adds evidence only, with no further code change.

Verified every payload against sealed Git bytes: **10 payloads / 30331 bytes, eight raw logs**, including empty fmt stdout. Manifest SHA256 `561dcc75de386e66b9098efea73cca8a6db94ca6c95a069dcd4b676b36136d86`. Independently verified all **five Rust code pins, six legacy/source-recipe pins, and two oracle pins** in CHECKS.json; all declared legacy read-at blobs match exact7a13 bytes. “Five source pins” refers to the five Rust code paths; CHECKS actually carries six additional legacy source pins. Source corpus remains 30636484 bytes SHA256 `0c9344109283d2cf848c83892924071e9277f163d79e69e3c634c3d19c7f4a58`; public-facts oracle unchanged.

## Retained raw gates

* First focused run: **10 PASS / 1 FAIL**, with source replay already PASS and maxRawAbs0.0. Exact retained red is the native JSON Number representation assertion, not source parity.
* Corrected native extras control: **1 PASS / 0 FAIL**.
* Final focused run on final code: **11 PASS / 0 FAIL**, 10.00s. Actual source **1549 Frames → 1541 Percepts + eight startup nulls**, five schedules, **max raw absolute error0.0**. No rounding introduced.
* Existing FIFO: **9 PASS**; existing player Memory: **6 PASS**, at the clearly recorded pre-final-spelling cut with unchanged existing code. These were not silently described as rerun after the pruning spelling change.
* First scoped strict Clippy: retained **exit101**, exact negated-partial-comparison lint. Final strict policy lib/tests/all-features Clippy: **exit0**. Scoped five-file rustfmt check: recorded **exit0**, empty stdout. Exact commands/cuts/exits are in CHECKS; raw contents agree with recorded results. No broad workspace/performance claim.

## Root admission limits to retain verbatim in substance

The actual source `Frame` has **11 fields**, not 12: `t`, `self`, `hud`, `fighters`, `mobs`, `containers`, `projectiles`, `minimap`, `events`, `immediate`, `extras` (`types.ts:628–642`). `features` is separately supplied Compose configuration, not a twelfth Frame field.

All captured fighter, flight, world-event and immediate arrays are empty. Native controls for those branches/cuts/tint are useful but not captured source parity. No hidden-course entitlement, BotVision/full Memory/Brain activation, live accepted scene/publication, NPC living-return choice, safe source-overflow capacity, full match or performance admission follows.

JSON comparison verifies keys/values and ordered arrays/flight sequences, **not original JavaScript object enumeration/insertion order**: default serde_json object maps canonicalize keys. The README's broad property-order language must not become a broader Root admission claim.

The existing refusal control verifies missing/nonfinite input and invalid-config **preflight** atomicity. It does **not execute a derived-overflow failure after staged due-event/flight mutation**. Clone→compute→validate→commit gives that stronger guarantee by static inspection; keep executed proof distinct. Adding such a cheap declared control later would strengthen evidence, but no algorithm flaw is apparent and it is not a prerequisite for this inactive source/evidence release.

The core consumes owned declared method records with explicit geometry/features/delays; no expected Percept is used as input. It remains inactive and has no public intake or continuity authority. Root retains all P15/C-OBS publication and later integration decisions.
