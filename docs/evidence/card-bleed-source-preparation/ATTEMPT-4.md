# Card bleed source attempt 4

**Result: the seven scenarios ran; one source-classification guard was too restrictive.** This receipt follows attempts
1–3, which remain preserved. The full unadmitted trace is
[attempt-diagnostics/attempt-4.json](attempt-diagnostics/attempt-4.json), SHA-256
`0c360c35c8bbda780b7af4046a6c60d548016a9c417cd2a98a03af783de86a43`.

## Invocation

- Exact command: `bash tools/card-bleed-fixtures/capture.sh`
- Working directory: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-gameplay-quests`
- Mode: defaulted to `capture`
- Harness hashes at execution: `capture.mts` `f89b2e7695196516f9f03411fa70014e6c88f22820953f5633f2815b51a1539e`; `cases.mts` `627e67581aa2aa8e6a1fea7c8ebccb051a3640554a299791112b26511892d657`
- Runtime: pinned Node.js 22.23.4, Linux amd64 Docker image
  `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`
- Exit code: `1`
- Unique temporary output directory: `/var/folders/f1/zlvpzngj3kbb95dxk8svy1y00000gn/T/rh-card-bleed.qpCN3W`
- `UNADMITTED.json` was retained and copied to the linked evidence file; no canonical `source.json` was written.

## Raw command output

```text
node:internal/modules/run_main:123
    triggerUncaughtException(
    ^

AssertionError [ERR_ASSERTION]: mixed-dot case reached an actual non-card DoT producer
    at <anonymous> (/repo/tools/card-bleed-fixtures/capture.mts:120:1) {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: false,
  expected: true,
  operator: '==',
  diff: 'simple'
}

Node.js v22.23.4
```

## Source diagnosis

The mixed-source case originally used one Fire attacker with Hemorrhage. Its retained trace showed ordinary weapon hits
and Fire signature `burn` rows, but no card bleed. The declared input was changed to two opposing pairs: Holy with
Hemorrhage against Fire, and a separate Fire attacker against Holy. The unchanged source then produced both actual
families. The captured mixed case has 209 card-owned landed contributions and seven raw card-feedback FX; its landed
rows also include Fire `sig:"burn"` entries.

The remaining guard incorrectly required `dot===true` together with a signature/ability marker. Source signature burn
rows carry `sig:"burn"` and do not set the generic `dot` field. After preserving this failure, the guard was corrected
to recognize `sig==="burn"` (or a generic ability dot). This correction has **not** been recaptured.

The trace file records all seven inputs and per-step source rows. Its observed summaries are: pair case 324 card
contributions/10 card FX; cadence case 39/4; natural run-end 6/1; teleport 5/1; raid reset 4/0; mixed case 209/7;
no-card control 0/0. Earlier guards passed in-process for insertion/repeat pair reachability, exact 500 ms first flush,
later empty interval, natural run-end before the window, a post-teleport retained flush, and reset of a partial report on
`startRaid`. The mixed-case card and signature reachability checks are both present in the retained trace. The separate
post-failure no-card assertions were not evaluated, although its trace was captured before guard evaluation.

This remains unadmitted source evidence, not a frozen parity fixture. The corrected signature guard and its exact code
hash still need one authorized run. No mutation controls, repeated bytecheck, independent source review, Rust comparison,
native privacy, public-wire, or full-game acceptance is claimed.
