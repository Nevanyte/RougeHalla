# CI42672708835 missing Rust job: read-only diagnosis

**Cause exposed by GitHub: workflow-level internal server error**, not a failed Rust test. Run `42672708835`, attempt1, exact public SHA `7a13b88aaa104cf2fd18dc2de7eada6c02060485`, is completed/**failure**. It must not be described as green or five jobs passed.

The authoritative [run summary](https://github.com/Nevanyte/RougeHalla/actions/runs/42672708835) contains one error:

> Internal server error. Correlation ID: 1f29ef6f-9fad-4828-a12b-d7689c5bb29b

The annotation is attached to **Rust foundation** (workflow), not an executed Rust test step. The HTML graph includes the logical `rust` node (`/actions/runs/42672708835/graph/job/rust`) without a numeric job record. API all-jobs and check-suite both expose exactly four job/check records, all success:

| Job | ID | Conclusion |
|---|---:|---|
| provenance | 129349565251 | success |
| card-runtime-source | 129349786843 | success |
| simulation | 129349787010 | success |
| csharp | 129349787701 | success |

Check-suite `115576853281` is completed/failure, latest_check_runs_count4. The run was created18:17:15Z and updated18:42:52Z on2026-11-09. No Rust job ID/log/test result is available. This establishes an infrastructure/orchestration error with a missing required Rust result; it does not establish GitHub's deeper backend cause or that a Rust test failed. No test failure should be invented from the overall conclusion.

## Method and source checks

Used GitHub connector first: fetch run, exact commit check-runs and workflow run jobs. It confirmed the four records; check-suite endpoint was rejected by connector URL allowlist, and the run-page URL was normalized to REST metadata, omitting workflow-level annotations. Read-only `gh run view` and REST check-suite/all-jobs fallback confirmed metadata but also omitted the workflow error. An **anonymous public HTTPS GET**, without credentials, of the actual run HTML exposed the original run-level error. No credential config/environment/token read, rerun, cancellation, workflow edit, test or build was performed.

Immutable `.github/workflows/rust.yml` at7a13 still has all five definitions. `rust` at line51 has `needs: provenance`, which succeeded. No workflow-byte difference exists from predecessor `8e467beb3ec76d8178927998b62a23cdf7b77a06`. Git blob `bf9195ddae2c575d6bd9a56a11ea5992a4fc37f4`; SHA256 `87ac4a02ef097cad486cf6bc375b60df1807e9cb35cefaaf9ab8ab8fbd9ffa04`. The four Node20/Ubuntu migration warnings/notices are on successful jobs, not the workflow failure cause.

## Preserved nonsecret raw evidence

All paths are outside Git under this report's directory, `coordination/reports/`:

| File | Bytes | SHA256 |
|---|---:|---|
| `ci-42672708835-run-page.raw.html` | 183057 | `bf0d21d13b7a3254a45d22d99ad410fe257bc1a2d7f35379d5a7d29fd0874ff5` |
| `ci-42672708835-startup-error.raw.html` | 1727 | `c5ab2ac98fc721592f688b58b96376c5c7970eb02c1fe1bf69f094636895a8a0` |
| `ci-42672708835-run.raw.json` | 12190 | `c1312a3f53ae5f8f7b585e75c56a965ed01c7db9e1a8a2a133ebfe3a16b06560` |
| `ci-42672708835-jobs-all.raw.json` | 8385 | `71f8950996566c4c5308b742b28c86ecfe68a289af90664637a22574eab7c725` |
| `ci-42672708835-check-suite.raw.json` | 7464 | `6aef454df66e7c6b0ce03cefea1da0c5fc61b94f8a62094902755ab3ba0f4a09` |
| `ci-42672708835-gh-view.raw.txt` | 2319 | `c3b4ad5cd724207c15bbd27692ca3de3098992027183e8243bf62c49be537ced` |

Next safe action: Root can authorize a same-SHA workflow retry after preserving this failed attempt, then require an actual Rust numeric job record and successful required gates before any green claim. There is no absent Rust job ID to rerun individually. If the backend error repeats, retain the new attempt and use the correlation ID/run URL for GitHub support; no source or test-budget change is justified by this evidence. No retry was performed in this audit.
