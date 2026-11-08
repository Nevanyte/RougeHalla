# Semantic source mutants (P-BARRIER-VIEW-WITNESS-1)

Each `.patch` is a unified diff against the immutable base `01b14dca9ff94963c539f111a4e30fb208e9c472`. It is applied to
a writable copy of the repository under `/tmp/repo` inside the pinned container; the read-only `/repo` mount is never
patched. Before each mutant every file named by any patch is restored from `/repo`, so the four mutations do not
accumulate. The mutated TypeScript is then recaptured with the same pinned image, tool and `RH_BARRIER_VIEW_RECORD=1`
(the source assertions become recorded booleans; the comparator and expected-signature check are unchanged).

`compare.mjs` reports the first JSON-path mismatch and skips only `/profile` (a mutant necessarily changes the mutated
file's sha256, which is provenance, not semantics). A compile/syntax/runtime failure is not a semantic kill: the runner
fails if the mutant capture does not finish and write all six corpora.

| mutant | source change | actual first mismatch |
|---|---|---|
| 01-combined-denominator | `hpView.ts`: `const total = Math.max(maxHp > 0 ? maxHp : 0, h + b)` -> `..., h)` | `continuous-bars.json /cases/2/actual/fractions/barrier/tag` expected `"value"` mutant `"+0"` |
| 02-twentieth-precision | `types.ts`: `HP_QUANT = 0.05` -> `0.01` | `owner-fighter.json /cases/2/actual/fighter/barrierFrac/value` expected `0.05` mutant `0.01` |
| 03-f32-identity | `perception.ts`: `const f32 = Math.fround` -> identity function | `owner-fighter.json /cases/3/actual/selfBarrier/tag` expected `"+0"` mutant `"value"` (the 1e-46 underflow is no longer narrowed by f32) |
| 04-ring-normalization | `PlayerView.ts`: `BARRIER_STEPS = 8` -> `4` | `human-ring.json /sequences/cacheRepeat/calls/0/stepAfter` expected `4` mutant `2` |

Each first mismatch is the documented semantic signature in `expected.txt`; the runner fails on any other first
mismatch, on an identical corpus, or on a capture failure. After the four mutants the runner reruns the unmutated
capture with `--check` against the checked-in corpora as a restored control.

These mutants are discrimination controls for the captured source arithmetic only. They do not propose a native
implementation, precision or transport rule.
