# P-TROPHY-WITNESS-1: source Trophy lifecycle and wording

Lead assignment for a spare DeepSeek Rust worker, independent of active Frost recipients and Post Rust Wish witnesses.
Start a fresh isolated branch/worktree from the pushed lead checkpoint containing this packet; record its immutable
base and use an own target. Evidence only: no native/client/protocol/publication implementation in this packet.

## Outcome and verified source paths

Prepare the actual-source evidence for the next complete Trophy Choose transport. Existing native `RewardOption::Kill`
is deliberately omitted as a whole row before bindings are staged; do not remove that guard or invent a new wire
version here. Source paths are `packages/server/src/sim/killAugments.ts`, `chests.ts`, `loot.ts`, `inputs.ts`,
`gameplay.ts`, `ledger.ts` and `packages/shared/src/{killAugments,combatReadability}.ts`. Verify actual names before use.

Capture genuine credited player kills through normal enqueue/input/steps in a four-seat player-only/no-mobs world so
match termination does not accidentally replace the requested lifecycle. Record and bind installed modules/config.
Use real grantCard/farm/stat producers for at least one invested victim, with labelled initial placements/gear/wounds;
never install expected Trophy options, gains, takenBy or killStats. Observe actual reward birth/hold, location at the
killer, option order, owner, expiry and state after real choose actions. Include owner vs stranger, birth hold,
out-of-range, repeated pick, skip, expiry boundary, training/MIA/self/empty-investment exclusions where genuinely
reachable. A trusted hook-only probe must be labelled and must not count as an ordinary gameplay producer.

Add a separate declared-input pure helper corpus over all nine keys, flat/percentage wording, positive tiny gains,
parse/encode rounding and ranking/ties. Call the actual shared functions, including actual killAugmentText, not copied
formulas. Distinguish declared ReadableFighter helper cases from real runtime outputs; do not inflate helper tests into
full gameplay. Observe source human selection/public perception where feasible; preserve the distinction between
owner-only action and sight-filtered offer disclosure. No DOM/scene lifecycle or reconnect claim from a method recorder.

## Scope and checks

Write only new `tools/trophy-witness-fixtures/**`, `parity/trophy-witness/**` and `docs/evidence/trophy-witness/**`.
Existing source/goldens, Rust/C#/Unity/JS codec, schema/observations/versions, shared statuses, Cargo.lock and active
worker files remain read-only. No cloud, account, ML, new runtime dependency or primary/managed writes.

Use pinned Linux/amd64 Node22.23.4 with image/source/tool/dependency/config hashes, additive immutable captures and
canonical byte-exact --check. Compile at least three meaningful semantic source mutants detecting owner refusal,
expiry/hold or grant behavior, and ranking/text arithmetic with actual output mismatches; compile errors are not kills.
Restore control. Have a separate checker reproduce the bounded source capture and inspect setup/provenance. No broad
workspace/map campaign; no native parity assertion until an actual native consumer exists.

Deliver clean reviewable commits, exact base/head/files/corpus hashes, commands/results, admission matrix and precise
unproved lifecycle gaps to the existing DeepSeek Rust report. Success is genuine producer/lifecycle evidence plus
clearly separate complete helper/wording tables. Failure/hold is injected expected outcomes, profile mismatch, altered
old expected data, unsupported publication decisions or fabricated normal-input/scene/reconnect proof. Root owns all
merges and later protocol allocation; keep the active Frost worker running.
