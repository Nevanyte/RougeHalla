# P-AGENT-GATE-1: the gate compiles Unity, knows stubs from oracles, and checks its own environment

- **Serves:** not in the plan: owner approval 2026-11-11 (retrospective items 1 to 3: "Apply 1 to 4")
- **Implementer tier:** implementer-sonnet (scripts; it writes its own failing checks first, as there is no oracle author
  for tooling)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** none (process tooling; no game, wire or parity change)
- **Protected paths:** `scripts/gate.sh` (owner approval above): the gate is run with `--allow-protected` for this packet

## 1. ID and outcome
Three gaps cost most of the failed runs on 2026-11-10/11. (1) The gate never compiled the Unity scripts or ran the
EditMode suite, and ignored the node tests under `client-unity/UnityProject/Tools`: one compile error and two failing
EditMode cases reached the integration branch. (2) With `--oracle`, the gate treated every file the oracle branch touched
as read-only, including the stub files an implementer must replace: six of seven implementers failed the path check.
(3) Full gates died on environment: the throwaway Postgres does not start without a locale, one rh-server test needs
`PGBIN`, and test clusters were left running until new ones could not start. When this lands the gate runs the Unity
EditMode suite and the Unity tool tests when their inputs change, reads oracle files from non-`stub:` commits only, and
fails fast with a clear message when its Postgres environment is incomplete.

## 2. Dependencies
none

## 3. Relevant legacy paths
- none (tooling)

## 4. New paths
- `client-unity/UnityProject/Tools/editmode.sh` (runs the EditMode suite in batch mode and prints totals and failures)
- `scripts/gate.test.sh` (checks for the gate's own rules, runnable without building the workspace)

## 5. Exclusive write scope
- `scripts/gate.sh`, `scripts/gate.test.sh`
- `client-unity/UnityProject/Tools/editmode.sh`
- `tools/pgtest/start.sh`, `tools/pgtest/stop.sh`
- `docs/agent/README.md` (the gate table and the path-check paragraph), `client-unity/AGENTS.md` is NOT in scope

## 6. Contracts and references
- `docs/agent/README.md` "The gate"; `AGENTS.md` "Protected paths" (the gate enforces that table; keep it enforcing it).
- `.claude/agents/oracle-author.md` step 7 (already updated): the oracle author commits `stub: <ID> ...` first, then
  `oracle: <ID> ...`.
- Unity 6000.0.85f2; batch tests are `-batchmode -runTests -testPlatform EditMode -testResults <xml> -logFile <log>` with
  no `-quit`; exit 0 all pass, 2 failures; compile errors are `error CS` lines in the log and no results file.

## 7. Behaviour to preserve
- Every existing gate step, flag and message; `--quick`, full, `--base`, `--oracle`, `--allow-protected`,
  `--coordinator`, `--regen-fixtures`.
- An oracle branch with no `stub:` commit behaves exactly as today (all touched files are oracle files), so existing
  `packet/<ID>` and `packet/<ID>-oracle` refs keep working.
- The gate stays runnable on a machine without Unity, Docker or Postgres: a missing tool is a named skip, never a pass
  that claims the suite ran.

## 8. Acceptance checks
Oracle rule:
- With `--oracle <ref>`, oracle files = files changed by the commits in `merge-base(<ref>, base)..<ref>` whose subject
  does not start with `stub:`. A file touched only by `stub:` commits may be edited by the implementer; a file touched
  by any other commit may not. `scripts/gate.test.sh` proves both on a temporary repository, plus the no-`stub:` case.
Unity:
- `client-unity/UnityProject/Tools/editmode.sh`: finds the Editor (`RH_UNITY_EDITOR`, else the version in
  `ProjectSettings/ProjectVersion.txt` under `/Applications/Unity/Hub/Editor`); exits 3 with a message when no Editor is
  installed or the project is open in an Editor (`Temp/UnityLockfile`); when `Library/` is absent in a worktree, clones it
  copy-on-write from the main checkout (`cp -cR`, the first path of `git worktree list`); writes results outside any
  dot-directory; prints `total`, `passed`, `failed` and each failed test name with its message, and every `error CS`
  line; restores `Assets/Resources/Showcase/NunitoBold.asset` if the run modified it and it was clean before; lists any
  untracked `.meta` it left under `Assets/`; exits 0 only when every test passed.
- The gate runs it in quick mode when a path under `client-unity/UnityProject/Assets/` changed, and always in full mode;
  exit 3 is reported as a skip on the result line ("Unity EditMode (no Editor / project open)"), anything else non-zero
  is a FAIL with the script's output.
- The gate runs `node --test` on the Unity tool tests in quick mode when a path under `client-unity/UnityProject/Tools/`
  changed, and always in full mode. Tests that fail on the integration branch today are excluded by name in one list at
  the top of the step with the reason (known: `profile-hub14.test.cjs`, pinned to the protocol 14 marker); every other
  `*.test.cjs` runs.
Environment:
- `tools/pgtest/start.sh` sets a valid locale for the server it starts when `LC_ALL` is unset, and finds Homebrew's
  PostgreSQL 16 when `PGBIN` is unset (`/opt/homebrew/opt/postgresql@16/bin`), keeping the Linux default.
- When `DATABASE_URL` is set, the gate resolves `PGBIN` the same way and exports it, or fails before any build with a
  message naming the variable. On exit the gate stops every `rh-pgtest` cluster that was started during its run and is
  not the one `DATABASE_URL` points at.
Evidence:
- `bash scripts/gate.test.sh` passes; `scripts/gate.sh --quick --allow-protected` passes on the branch; one full
  `client-unity/UnityProject/Tools/editmode.sh` run reports 610 of 610 (the integration branch's count).

## Oracle files (read-only for implementers)
- none from an oracle author. The implementer's first commit is `scripts/gate.test.sh` with the oracle-rule and
  environment checks failing against today's gate; the coordinator records that commit as the oracle.

## 9. Validation commands
- `bash scripts/gate.test.sh`
- `scripts/gate.sh --quick --allow-protected`
- `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Bash on macOS (Bash 3.2: no associative arrays, no `mapfile`). The risk is a gate that passes when it should
not: every new skip must be printed on the result line.

## 11. Known traps
- Unity rejects a results path under a dot-directory (`.agent-runs/`): use a temporary directory.
- A Unity run touches `NunitoBold.asset` and generates `.meta` files for new scripts; the repo tracks `.meta` files.
- `set -euo pipefail` is on in the gate: a `grep` with no match must not abort it.
- `git log --format=%s` subjects, not bodies, decide `stub:`; merge commits on an oracle branch count as non-stub.
- Stopping clusters: never stop a cluster the gate did not see start, and never the one in `DATABASE_URL`.

## Notes from previous attempts
