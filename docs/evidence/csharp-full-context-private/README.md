# Private Linux dispatch preparation

PRIVATE diagnostic branch `codex/csharp-full-context-linux-once`, exact parent/source seal `3426d0d46a04251572234e49d9488f38065736d3`. Root's independent review conditionally releases that source for **one** Linux diagnostic run. This commit prepares its concrete workflow; it does not push, dispatch, merge to main, execute another local suite or admit a fix.

The only active diagnostic tuple is:

```json
{
  "event": "workflow_dispatch",
  "ref": "refs/heads/codex/csharp-full-context-linux-once",
  "inputs": { "allocation_context_diagnostic": true }
}
```

The input is declared Boolean, required and defaults to false. On that exact tuple, simulation/Rust/card-source jobs are skipped before their native/PG/source campaigns, while unchanged provenance and C# remain active. Those jobs' bodies are structure-preserved. Outside that tuple their eligibility and the existing push/PR configuration remain unchanged.

The unchanged `dotnet test client-unity/RoguehallaNet.Tests` remains first after checkout/setup. The exact Unity sync command follows, and runs even when that normal test fails on the diagnostic tuple. On every other tuple it retains its former success-only behavior. Neither command is filtered or replaced. A normal failure stays a failed job; no continue-on-error is used.

Only after those two checks, five diagnostic steps run under always plus the complete event/ref/Boolean tuple: traced full 757-test suite; all 28-window reconciliation; one four-case bounded no-decoder control process; all 4-window reconciliation; artifact upload. Analysis/control/upload still run after a red normal or traced suite, with each outcome retained. Contents permission remains read-only. The runtime/SDK/source-head metadata and every raw window remain part of the reviewed 3426 procedure. No old 475/9b replacement workflow is imported.

The inherited 3426 source evidence remains applicable: all 32 raw windows/620001 samples and executed-source snapshots are unchanged. Its README's getter citation alone is corrected from 868–876 to the actual pinned 936–945, with that one payload checksum updated. All runtime claims and failure boundaries remain unchanged: historical Linux 1128/2160 attribution and a reliable unchanged-budget fix are still unknown/unadmitted.

Static verification:

```sh
python3 tools/csharp-full-context/verify_private_workflow.py
shasum -a 256 -c docs/evidence/csharp-full-context/SHA256SUMS
shasum -a 256 -c docs/evidence/csharp-full-context-private/SHA256SUMS
```

The verifier parses YAML, compares every preserved job/body/command to 3426, checks the Boolean schema and exact guards, compares the five appended step bodies to the frozen reviewed proposal, and exercises 54 event/ref/input/success combinations. It proves the static truth model, including normal failure with sync still running and inverse guards; it is not a live GitHub execution or runtime allocation result. Actionlint is unavailable locally; no tool is installed for this preparation. Root retains application review, pushing this exact private ref and dispatching once after verifying its full SHA. This workflow candidate must not be merged as an unguarded production fix.

`private-workflow.patch` contains the workflow and citation/checksum changes against the exact parent, with zero context lines; use `git apply --unidiff-zero --check` against that parent. The commit also contains this preparation record, the static verifier, its complete truth table and validation log. `SHA256SUMS` binds the changed source files and preparation evidence; it excludes itself. No new runtime samples were collected.
