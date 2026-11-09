# Source reflex geometry — native component (review-corrected)

Status: PASS correction. Original seal a59e2602/code c9bfb6f1 remain immutable historical evidence
(docs/evidence/reflex-geometry/receipt.json and the old logs). This branch is an additive correction from
a59: it preserves the original 10 angle + 25 course rows/outcomes exactly and appends two genuine actual-source
Some general-course probes. No production defect was found.

## Base / branch / heads

- Repo/worktree: /Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings (same clean checkout).
- Correction branch: deepseek/reflex-pure-geometry-repair, from sealed a59e2602a59b3905aa4687a85ff2fac620ec2ada.
- Exact original base: a0c4818ce9df8ad0f4124db31e65ba1244bddc3b.
- Code/tool/corpus head: 7bddcc304f7a3eb6d155e1d39ae55f17c5ea1c1d.
- Evidence/final head: the branch head containing this README and repair-receipt.json; reported to Root.
- Source file unchanged: packages/server/src/bots/brain/tactics/kite.ts, 17088 bytes,
  sha256 b7ceff483d51fe1d58d79ef34562e28a079027623527f11264c21439c2b6e2be.

## Correction scope

Only existing packet paths changed: new Rust files remain from a59; this correction changes only
crates/rh-policy/src/bots/kite/reflex_geometry/tests.rs (consume 27 rows, raw-worded tolerance comment),
tools/reflex-geometry-fixtures/capture.mts (append two probes), parity/policy/reflex-geometry/source.json
(actual-source recapture), and new repair evidence. No source/Sim/RNG/protocol/delivery/client/status/
Cargo.lock/old-corpus edit, no tolerance change, no production math change, no live activation.

## New actual-source probes (appended; never edited old results)

The actual unchanged TS course supplied these Some results:
- general-positive-nonpythagorean: origin [5,7], at [15,11], velocity [7,11], range 200, self [35,25],
  lag 0. Actual source result: ttiMs 1729.411764705882, offset -9.356972863937921,
  nx -0.8436614877321075, ny 0.5368754921931592. Non-axis, speed sqrt170, nonzero origin and nonzero
  travelled displacement hypot(10,4).
- general-positive-negative-direction: origin [10,-4], at [22,10], velocity [-3,8], range 150,
  self [30,20], lag 0. Actual source result: ttiMs 767.1232876712329, offset -11.001867836436274,
  nx -0.9363291775690445, ny -0.3511234415883917. Non-axis, speed sqrt73, nonzero origin and
  travelled hypot(12,14).

Original rows are prefix-equal: 10/10 angle unchanged; 25/25 original course inputs/results unchanged;
only the two rows above are appended (27 course, 37 total). The source corpus is 17502 bytes, sha256
e54c4dd38bde3de17672f5bb563d49365f65ed6892cd09169898fd8b0426ecba; profile.extraction source spans/hashes and
pins are unchanged.

## Consumer / tolerance wording

- Focused tests consume all 27 course rows and 10 angle rows: PASS 3/3.
- C-PARITY tolerance is the existing 2e-6 absolute for continuous angle/tti/offset/nx/ny outputs; it is
  unchanged. The source JSON and Rust comparison do NOT pre-round either value; observed max differences
  are raw numeric comparisons (not bitwise), and the raw maximum on this corpus is 0.0. No tolerance was
  introduced or weakened, and no exact/bitwise promise is made for arbitrary inputs.
- Some/None/error and discrete facts compare exactly. Nonfinite controls and explicit from_self remain.
- Source semantic controls: the original eight controls and provenance-only non-kill are immutable a59
  evidence for the original 35 rows; this correction did not rerun them because no predicate, oracle
  expression or original row changed. New rows are positive-only additions validated by the actual-source
  capture, bytecheck and consumer.

## Reproduction

- One actual-source pinned recapture wrote the new canonical corpus; canonical --check exit 0
  (sha e54c4dd38..., 27 course/10 angle).
- Clean Git export of code head 7bddcc30 reproduces the same bytes: --check exit 0
  (logs/frozen-export-check.log).
- cargo fmt --check exit 0; scoped strict cargo clippy -p rh-policy --all-targets --all-features -- -D
  warnings exit 0. Reserved bot-fight-native/target, jobs1/debug0/incremental0; final-target untouched.
- Portable raw logs are tracked under logs/ (force-added despite *.log ignore) and SHA256SUMS verifies
  from the Git tree.

## Honest remainder

Still a stateless pure angle/course component; no live fight/OrbWalk/reflex/brain, perception/Frame/public
facts/Room/protocol/Unity/DOM/tournament or hidden projectile publication. Larger stateful reflex/target
work remains with its owner. Original a59 receipt remains historical, not silently current. Root owns
review/merges; this correction stops here.
