# Card bleed source attempt 1

**Result: failed before scenario execution.** This was the single Root-authorized capture attempt against the frozen
harness commit `8eceab3e4c0947bdd37dd5fcca2e4891a8fc735c`, in worktree HEAD
`b40b3410c661e5771d1773809911c813ce538238`. No retry, source/harness edit, input weakening, build, or test followed.

## Invocation

- Exact command: `bash tools/card-bleed-fixtures/capture.sh`
- Working directory: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-gameplay-quests`
- Mode: defaulted to `capture`
- Host `TMPDIR`: `/var/folders/f1/zlvpzngj3kbb95dxk8svy1y00000gn/T/`
- `RH_CARD_BLEED_DIRECTORY` and host `RH_CARD_BLEED_OUTPUT`: unset
- Container output variable: `RH_CARD_BLEED_OUTPUT=/out/source.json`
- Runtime container: `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, `--platform linux/amd64`
- Exit code: `1`
- Output directory allocated by the script: `/var/folders/f1/zlvpzngj3kbb95dxk8svy1y00000gn/T/rh-card-bleed.i9i72N`
- Directory was present after the attempt and empty; no `source.json` was written.

## Raw command output

```text
/repo/tools/card-bleed-fixtures/capture.mts:11
import {startRaid} from '../../packages/server/src/sim/arena.ts';
        ^
SyntaxError: The requested module '../../packages/server/src/sim/arena.ts' does not provide an export named 'startRaid'
    at ModuleJob._instantiate (node:internal/modules/esm/module_job:226:21)
    at async ModuleJob.run (node:internal/modules/esm/module_job:335:5)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:681:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.23.4
```

## Diagnosis and limits

The draft statically imports `startRaid` from `packages/server/src/sim/arena.ts`, where it is not exported. Read-only source
inspection locates the exported producer in `packages/server/src/sim/step.ts`. Module linking failed before the runner
constructed a `World`, so none of the declared cases or reachability guards ran. This is a harness API/import defect;
there are **no captured cases, steps, or FX counts** and no evidence for bleed behavior, timing, lifecycle, parity, or
privacy. Root must review/authorize any corrected attempt separately.
