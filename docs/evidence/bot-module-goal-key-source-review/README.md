# Independent review — additive module goal-key source witness

**Disposition: release the bounded source-only witness for native transfer.** Reviewed on clean review worktree HEAD
`89197d876acbdff2528eb34f23fb81195c49653e` (`codex/strategy-source-review`), which contains primary source seal
`5ec31212b0082d650cbe15d58877e82ac2793060` and additive supplement `1d06f752`. No source, tool, corpus, Rust, client,
shared status, or primary-checkout files were edited. This review writes only this new evidence directory.

## Independent source review

In unchanged `packages/server/src/bots/brain/strategy.ts`, private `goalKey` serializes module data through
`JSON.stringify(g.data)` (`goalKey` at the module arm), and `StrategyImpl.sync` stores that key from the current goal
before candidate selection. `settle` and candidate exclusion also use the same key. `decide` finds the current candidate
by key; on a kept proposal it returns the original `current` reference when `JSON.stringify(chosen.goal) ===
JSON.stringify(current)`. Thus matching keys can preserve raw source values that differ under ordinary native structural
equality. A key-only port would miss that the retained source goal can still carry `-0`, `NaN`, or an own property whose
value is `undefined`.

The new four cases use only caller-declared raw module-goal data and status/offer inputs. They supply no key strings,
expected candidates, prior goals, or expected results. `builders.mts` defaults each subsequent decision to
`current: "$previous"`; the actual runner replaces that token with the preceding source decision's goal. Every call
uses the real `createStrategy` instance, actual `Memory` created by the frozen runner, normal sync/settle/dedupe/keep
logic, and source own-state snapshot captured immediately after the call. The four chronological traces contain 48
method operations (10, 12, 14, and 12) and four reached assertions.

The cases and source behavior bind:

- `-0` and `0` share a JSON key; equal JSON text returns the actual old `-0` goal, then failure excludes the shared key
  through the strict expiry boundary.
- `NaN`, both infinities, and `null` share the JSON key `null`; equivalent proposals keep the old actual `NaN` value
  and source reference. Failure exclusion applies to the shared key.
- The actual `currentKey` strings distinguish `1e-7`, `0.000001`, `100000000000000000000`, and `1e+21`; Done
  exclusion expires on the source boundary.
- Undefined object properties are omitted, array Undefined becomes `null`, nested omission collides with an empty
  object, and array/object distinctions remain visible in the retained raw goal.

This matches the primary review's raw-number rule: do not round source numbers or collapse signed zero/nonfinite values
when comparing raw MethodValue data. The separate JSON goal-key behavior is **exact string semantics**, not numeric
epsilon. Native replay must use its own preceding native goal for `$previous`, compare captured current only as a guard,
and preserve old raw goal fields when the source's full-goal JSON strings compare equal.

The four already-frozen mutation receipts are semantically effective and source-bound. Each mutant changes the one live
module-data `JSON.stringify` site in a disposable source copy, executes successfully, and changes the intended source
selector: signed-zero candidate count `1→2`; nonfinite/null candidate count `1→4`; ECMAScript key spellings change at
the exponent boundaries; omitted-Undefined candidate classes `5→7`. The comment-only control is `NONKILL`, and restored
unchanged source reproduces all four complete cases/assertions. The control driver asserts successful child execution
before classifying a `KILL`, restores the exact source between controls, and leaves canonical files read-only. These are
the existing recorded controls; this independent task did not rerun them.

## Fresh checks

The fresh source check ran in the pinned Node 22.23.4 Linux amd64 Docker image with the canonical supplement mounted
read-only, and passed exact bytes: `1,004,072` bytes, SHA-256
`32836e03d47993fceec22fc7fb648e937d01b3e9b221da9499ea9e99d31efc0c`; 4 cases, 48 operations, 4 assertions, primary17
unchanged. The supplemental verifier was also run inside the same pinned image against the canonical corpus mounted
read-only. It passed the frozen primary tagged/envelope validator, primary-map binding, case/operation/assertion counts,
and the exact current-key strings above.

The two before/after pin snapshots include both manifest files, every primary17 file, and all supplement9 files, each
with byte size and SHA-256. `cmp` returned zero for the complete snapshots. The capture check itself also re-hashes the
primary17 before and after the fresh recapture. Initial `git status --short` was empty. Final status contains only this
new evidence directory; worktree HEAD remains the exact reviewed commit. No test, primary98/658 capture, source mutant
run, or native output comparison was performed.

Retained raw log hashes: capture check `4d5edc2347a67361011b80c94f0a54cb414fda20f967dc304c3304dfaf6eda0d`; supplement verifier
`306d71090ae71ac52b20148f748efbe315ce4b041772c8afa7b5458af7c97b61`; each pin snapshot
`5575e8d24ef9dd3ae751a1a5d8573ea77530017721804ea2a1661ffe13acf15c`.

### Reproduction record

Worktree: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-strategy-source-review`

Commands and exits:

1. `bash tools/bot-module-goal-key-fixtures/capture.sh --check > docs/evidence/bot-module-goal-key-source-review/logs/capture-check.log 2>&1` — exit `0`. After execution the ignored `.log` file was renamed to the retained `.txt` path.
2. `docker run --rm --platform linux/amd64 --mount "type=bind,src=$PWD,dst=/repo,readonly" -w /repo node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292 node tools/bot-module-goal-key-fixtures/verify.mjs > docs/evidence/bot-module-goal-key-source-review/logs/supplement-verify.log 2>&1` — exit `0`. After execution the ignored `.log` file was renamed to the retained `.txt` path. `$PWD` expanded to the worktree above; no npm install was needed for the dependency-free verifier.
3. Before and after snapshots used this exact command with the final redirection switched from `PINS-BEFORE.jsonl` to `PINS-AFTER.jsonl`; both invocations exited `0`:

   `node -e 'const fs=require("fs"),crypto=require("crypto");const H=p=>({path:p,bytes:fs.statSync(p).size,sha256:crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")});for(const m of process.argv.slice(1)){const body=JSON.parse(fs.readFileSync(m,"utf8"));console.log(JSON.stringify({manifest:H(m),files:Object.keys(body.files).sort().map(H)}));}' docs/evidence/bot-private-strategy-source/FROZEN_MANIFEST.json docs/evidence/bot-module-goal-key-source/FROZEN_MANIFEST.json > docs/evidence/bot-module-goal-key-source-review/logs/PINS-BEFORE.jsonl`
4. `cmp docs/evidence/bot-module-goal-key-source-review/logs/PINS-BEFORE.jsonl docs/evidence/bot-module-goal-key-source-review/logs/PINS-AFTER.jsonl` — exit `0`.
5. `git status --short --untracked-files=all` and `git rev-parse HEAD` were recorded in `logs/WORKTREE-STATE.txt`; only the new evidence directory appeared after review.

The capture script invokes pinned Docker Node 22.23.4/Linux amd64, installs only into container tmpfs, mounts the source
worktree read-only, and mounts the canonical supplement read-only in `--check` mode. The verifier command also mounts
the whole worktree read-only. Raw check output, verifier output, and all 26 individual file identities are in `logs/`.

## Limits

This is a finite real-source `createStrategy` method witness for module goal-key serialization and raw-goal reuse. Module
offers and tactic statuses are declared source API inputs. It does not establish that a production Brain/module generated
those offers, all possible `JSON.stringify` behavior, native parity, memory privacy, gameplay integration, or live bot
activation. The primary 98-case sweep and source payloads were not regenerated.
