---
description: Execute ready packets through oracle, implement, gate, review and integration (Opus coordinator)
argument-hint: [packet ids, or blank for every Ready packet whose dependencies have landed]
model: opus
effort: medium
---
Run the pipeline in `CLAUDE.md` for: $ARGUMENTS

If that is blank, take every "Ready packet" in `docs/backlog/README.md` whose dependencies are merged into the
integration branch (`docs/agent/INTEGRATION_BRANCH`).

For each packet:
1. No `packet/<ID>` branch yet → `oracle-author` first (security packets go straight to `implementer-opus`).
2. Dispatch to the tier the packet names: at most three Rust implementers at once, never two with overlapping write scopes,
   shared-file packets one at a time.
3. FAIL twice → escalate one tier per `CLAUDE.md` with the previous branch name and the gate's failure block; the second
   attempt at a tier runs one effort level higher. After two Opus failures: `debugger` if it is a determinism or parity
   divergence, otherwise mark the packet "needs re-plan" and tell the owner.
4. PASS (full) → the reviewer the packet names.
5. LAND → merge into the integration branch, re-run `scripts/gate.sh --coordinator` on the merge, update the backlog row
   and the MIGRATION checkpoint, remove the worktree. LAND WITH NOTES → write `<ID>-fix` packets for the REAL notes, run
   them at the same tier, re-review. REJECT → retry at the tier the reviewer named.
6. Append every attempt to `.agent-runs/log.csv`.

Finish with one table: packet, final tier, attempts, verdict, branch, merged sha. Promotion to `optimization_port` or
`main`, pushes and deploys wait for the owner: list what is ready and ask.
