# Source reflex geometry — native component

Status: PASS. Bounded pure-fact Rust component of the source bot reflex geometry: angleGap and the private
projectile course from packages/server/src/bots/brain/tactics/kite.ts, with actual-source fixtures,
exhaustive branch probes, eight compiled source semantic controls and nonfinite negative controls.
This is preparation for full reflexes, not live activation or permission to publish hidden projectile facts.

## Base / branch / heads

- Repo/worktree: /Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings (clean previous worker
  checkout reused at 4.2 GiB free; prior branch deepseek/bot-own-timings / b960c1a6 preserved).
- Exact base: a0c4818ce9df8ad0f4124db31e65ba1244bddc3b.
- Branch: deepseek/reflex-pure-geometry.
- Code/tool/corpus head: c9bfb6f1ac803cd2b538a1dafe12fa3656686459.
- Evidence commit: the branch head containing this receipt; reported to Root.
- Immutable actual source file: packages/server/src/bots/brain/tactics/kite.ts, 17088 bytes,
  sha256 b7ceff483d51fe1d58d79ef34562e28a079027623527f11264c21439c2b6e2be; unchanged vs base.
- Existing away_point and ownTimings bytes are unchanged (source/own_timings diff vs base = 0).

## Scope

Only new crates/rh-policy/src/bots/kite/reflex_geometry.rs and
crates/rh-policy/src/bots/kite/reflex_geometry/tests.rs, minimal declaration/re-exports in
crates/rh-policy/src/bots/kite.rs, new tools/reflex-geometry-fixtures/**, new
parity/policy/reflex-geometry/source.json, and new docs/evidence/reflex-geometry/**. No bot.rs/perception/
Frame/protocol/Sim/shared status/Cargo.lock/old source corpus or other module edit; no new dependency; no
live activation.

## Fixed API

    pub struct CourseFacts { pub from_self: bool, pub origin: Vec2, pub at: Vec2, pub velocity: Vec2, pub range: f64 }
    pub struct Course { pub tti_ms: f64, pub offset: f64, pub nx: f64, pub ny: f64 }
    pub enum GeometryError { InvalidFacts }
    pub fn projectile_course(facts: CourseFacts, self_at: Vec2, lag_ms: f64) -> Result<Option<Course>, GeometryError>
    pub fn angle_gap(a: f64, b: f64) -> Result<f64, GeometryError>

Explicit from_self is the actual source equality predicate (pr.from === self.id), not a raw actor ID or
delivery adapter. Own-origin exclusion, speed/range/lateral/behind/positive-impact predicates and their exact
strict/equal branch order are preserved; binary64 operation order is preserved. Nonfinite origin/at/velocity/
range/self/lag or angle coefficients are refused as InvalidFacts before computation. Fists/fallback,
missing ownership, missing range and default facts are not invented. The finite supported probe domain is
declared small/medium finite inputs; extreme overflow behavior is not silently normalized or changed. The
tests apply the existing C-PARITY continuous tolerance (2e-6 absolute; fixture 1e-6 rounding plus libm/V8 ulps)
to tti/offset/nx/ny/angle outputs only; Some/None/error and discrete facts are exact. Observed maximum abs
difference on this corpus is 0.0 (all native values matched source exactly); no tolerance was weakened.

## Actual-source oracle / corpus

- Pinned node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292,
  linux/amd64, repo mounted read-only.
- Extraction: the unchanged source text is bundled with only an appended in-memory temporary export
  (export { course as __course }); original imports/constants are used, no hand-rewritten TS oracle and no
  source edit. profile.extraction records angleGap span (lines 22-25, sha256 be872629...) and course span
  (lines 191-206, sha256 10973cb3...), append text/hash and bundle hash.
- parity/policy/reflex-geometry/source.json: 16210 bytes, sha256
  3c997217b43385c0e3c240cf0c5399a42cc12b667d2027af3e85760bea730881; 10 angle cases and 25 course cases
  covering both normal signs, axis/diagonal/general courses, from_self, own-origin below/equal/above 20,
  speed1, lateral +/-/equal/above, along/behind boundaries, range+hit-reach equality, lag/zero-impact
  boundary and angle wrap/negative/PI.
- Actual source outputs are the only expected values. No expected result was written or changed to fit Rust.
- Canonical --check run twice exit 0 with exact bytes/sha; genuine external write reproduction is
  byte-identical (logs/check-1.log, check-2.log, external-write.log); a clean frozen Git export of the code
  head (archive/tar, read-only Docker mount) also passes exact --check (logs/frozen-export-check.log).

## Semantic controls

tools/reflex-geometry-fixtures/run-controls.sh applies each mutation to the actual source text in memory,
re-bundles/re-executes it, and compares the semantic corpus (profile excluded) to the canonical capture.
8/8 required predicates KILL actual recorded rows; the provenance-only comment is NON-KILL; restored arm is
equal. First diffs are under /course/cases/.../result or /angle/cases/4/result; full raw log and JSON are in
logs/controls-run.log and logs/controls.json:
- own-id-equality, origin-boundary, speed-one-boundary, lateral-boundary, behind-zero-boundary,
  range-hit-reach-boundary, impact-zero-boundary, angle-wrap all KILL.
Compiler/tool errors are not counted as kills; the tool failed closed if any required control survived.

## Rust tests / commands

- cargo test -p rh-policy --lib bots::kite::reflex_geometry -- --nocapture: PASS 3/3, exit 0; consumes every
  fixture row and prints "10 angle + 25 course rows; max C-PARITY abs diff 0.0".
- Nonfinite controls refuse each numeric course/angle field distinctly; from_self exclusion is explicit.
- cargo fmt --check exit 0; cargo clippy -p rh-policy --all-targets --all-features -- -D warnings exit 0.
- Reserved private target bot-fight-native/target; CARGO_INCREMENTAL=0, CARGO_BUILD_JOBS=1,
  CARGO_PROFILE_TEST_DEBUG=0; final-env.sh toolchain Rust 1.97.0. No final-target or other cache touched.
- Logs are tracked (force-added despite *.log ignore); SHA256SUMS verifies from the Git tree.

## Honest remainder

This proves only the stateless source angle/course component and its fixed outputs. It does not activate a
fight, OrbWalk, reflexes, full brain, perception/Frame/public facts, delivery/protocol/Room, Unity/DOM or
tournament outcome; no hidden projectile facts are published. Larger stateful reflex/target work remains
with its owning packet. Root owns review/merges.
