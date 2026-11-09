# Actual quest presentation formatter capture

Pinned Node22.23.4 Linux/amd64; unchanged actual questModel.ts and shared exports. No loader stubs, World, DOM/app,
ordinary reward acquisition, gameplay outcome, runtime grant, session or Unity-rendering claim.

Run `bash tools/quest-presentation-fixtures/capture.sh`, then `capture.sh --check` and `run-mutants.sh`.
Only capture writes this NEW fixture directory. Check/mutant baselines and all host source are read-only mounts;
source copies, npm ci and independent compiled mutation variants live in disposable container tmpfs. No host node_modules.

Actual imports execute questObjective, questReward, questRows and questFromReveal. All20 real definitions use nine
DECLARED FORMATTER contexts: preview/current137; open/current0; open/current137/feed0 and feed6;
open/currentMAX_SAFE_INTEGER-minus-gained; open/currentMAX_SAFE_INTEGER; open/absent optional counts;
closed Done/current137 and closed Expired/currentMAX_SAFE_INTEGER. Completed/expired states are declared function
inputs, never proof a quest was completed/expired or any count earned. Actual row text and direct helper outputs are
recorded. Inputs/maps are not mutated. Fixed catalog name/giver/brief coverage reuses immutable parity/quests/data.json.

Arithmetic diagnostics are explicitly capture-harness Number-addition probes, separate from actual helper-rendered
text. The native consumer must match actual output, including binary64 rounding after adding stacks to MAX_SAFE_INTEGER;
it must not resurrect historical card payouts or invent caps/grants. Feed contexts show current fixed stat-stack+GV
wording is feed-independent. Closed rows omit later current totals through the actual questRows branch.

Three mutations edit actual questModel.ts in separate writable copies/processes: objective label, contextual total,
and closed-context reward. Each capture must exit0 before semantic comparison; a crash/hash difference is not a kill.
Comparator checks cases with provenance excluded; a comment-only source mutation must be a nonkill. Pristine byte
controls run before/after. No unchanged prior fixture campaign is repeated.
