# P-ENV-RETRO-1: the gate reports everything it can, cheap checks first; guardrails replace repeated prompt text

- **Serves:** owner instruction 2026-11-14 (chat, after the retrospective): "Please apply your best suggested fixes for the
  found production issues 1-6". That instruction is the owner's approval for the protected paths named here
  (`scripts/gate.sh`, `.claude/agents/*.md`, `.claude/hooks/`, `CLAUDE.md`), for this scope only.
- **Implementer tier:** implementer-sonnet (scripts, CI-style tooling); the coordinator writes the agent-facing text
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** none (no game code) · no wire change

## 1. ID and outcome
What the retrospective found, each with what happened on 2026-11-14:
1. **The gate stops at the first red step and runs its cheapest checks last.** A docs test failed after 80 minutes of a
   full gate; stacked packets could not run the gate past the red tests of the packets beneath them, so their authors ran
   the later steps by hand.
2. **Build artefacts reach commits.** `BakedContent.cs` (rewritten by `build-web.sh`), the Showcase font assets
   (rewritten by an EditMode run) and `ProjectSettings/ShaderGraphSettings.asset` were each restored by hand in about
   forty agent runs, and one slipped into a commit and was caught only in review.
3. **A pattern kill crossed sessions.** One agent's `pkill -f "target/debug/deps/mapgen_"` killed another session's
   test binaries in other worktrees.
4. **A worktree was removed while its agent was alive.** `.claude/worktrees/agent-*` directories carry no owner; "clean,
   merged and idle" does not mean finished when several sessions share the repository.
5. **Mesh colours render lighter than written.** The project is in Linear colour space and `Mesh.SetColors` takes raw
   values: sRGB constants written to a mesh are shown lifted. `FrostWallPresenter` now converts; three older presenters
   do not (their look is approved as it is and stays).
6. **Each full gate an implementer runs costs an hour of machine time the coordinator's merged-tree gate repeats.**

When this lands:
- **Gate order (full mode):** path checks, rustfmt, then the checks that take seconds to minutes (Unity tool tests
  with the docs tests, JS vector checks, reload-proof tests, the C# suite and the Unity copy check), then clippy, the
  workspace and `rh-sim` suites, Postgres suites, the parity report, Unity EditMode, the headless smoke. Quick mode
  keeps its selection logic and takes the same relative order.
- **`--keep-going`:** every step runs even after one fails; each red step prints its last 40 lines as today; the
  result line is `GATE FAIL (n steps): <step>; <step>` and the exit code is 1. Without the flag the gate fails fast as
  today. A step that cannot run because an earlier one did not build is reported as `not run (after <step>)`, never
  as passed.
- **Artefact path check:** a branch whose diff against the base changes a Showcase font asset under
  `client-unity/UnityProject/Assets/Resources/Showcase/`, `BakedContent.cs` or
  `ProjectSettings/ShaderGraphSettings.asset` fails the path checks by name, unless `--allow-artefacts` is passed (for
  the rare packet that means to change one; the hand-off says which).
- **Mesh colour check:** a C# file under `client-unity/UnityProject/Assets/Scripts/` that uploads vertex colours
  (`SetColors(`, `.colors32 =`, `.colors =`) fails the path checks unless it is the shared helper or one of the three
  approved legacy files (`WeaponRangePresenter.cs`, `HitZonePresenter.cs`, `CampPatienceOutlines.cs`); the message
  names the helper. The helper is `SrgbMeshColors` (item D below).
- **Pattern-kill hook:** `.claude/hooks/no-pattern-kill.sh`, a PreToolUse hook for Bash, refuses `pkill`, `killall` and
  `kill` fed from `pgrep`/`ps | grep` patterns with a message that says what to do instead (stop the process ids you
  started: `kill <pid>`, or the shell's `$!`). Registered where the coordinator states after checking the harness
  (agent definitions' frontmatter, not the shared `settings.json`).
- **Worktree ownership:** `scripts/agent-worktrees.sh` with three commands: `claim <agent-id> <packet> <session>` appends
  a row to `.agent-runs/worktrees.csv` (date, agent id, packet, session, state `open`); `done <agent-id>` marks it; and
  `clean --session <session>` removes only worktrees whose row carries that session and state `done`, are clean
  (nothing uncommitted or untracked beyond `.agent-runs/`), and prints what it left and why. It never touches a
  directory without a row. `list` prints the table with each worktree's branch, head and size.
- **Process text:** implementers finish with `scripts/gate.sh --quick --oracle packet/<ID>`; the coordinator runs the
  full gate on the merged tree with `--keep-going` (docs/agent/README.md, the agent definitions, CLAUDE.md pipeline
  step 3). Written by the coordinator, not by the implementer of this packet.

## 5. Exclusive write scope
- **A (implementer-sonnet, scripts):** `scripts/gate.sh`, `scripts/gate.test.sh`, `scripts/agent-worktrees.sh` (new) and
  its test `scripts/agent-worktrees.test.sh` (new), `.claude/hooks/no-pattern-kill.sh` (new) and its test
  `.claude/hooks/no-pattern-kill.test.sh` (new), `docs/agent/README.md` section "The gate" only.
- **D (implementer-sonnet, Unity):** new `client-unity/UnityProject/Assets/Scripts/Presentation/SrgbMeshColors.cs`;
  `FrostWallPresenter.cs` uses it (behaviour identical); one EditMode test for the helper.
- **Coordinator:** `.claude/agents/*.md`, `CLAUDE.md` (pipeline step 3 and 5 wording), `docs/agent/README.md` outside "The
  gate", `docs/coordination/OWNER_QUEUE.md`, `docs/OWNER_DECISIONS.md` (index; drafted by a Sonnet agent).
- Not `.claude/settings.json` (the owner's checkout holds an uncommitted local change to it; a commit that touches it
  would block the fast-forward of that checkout).

## 7. Behaviour to preserve
- Without `--keep-going` the gate's output, exit codes and step selection are today's apart from the order.
- `scripts/gate.test.sh` passes with every existing case unchanged; the test hook `GATE_STOP_AFTER_CHECKS=1` still
  stops after the checks with exit 42.
- The Postgres cluster ownership and cleanup rules of the gate are untouched.

## 8. Acceptance checks
- A writes the new `gate.test.sh` cases FIRST and commits them red (`test:` commit), then implements: an artefact in
  the diff fails by name and passes with `--allow-artefacts`; a raw `SetColors(` in a new file under `Assets/Scripts/`
  fails and the three approved files and the helper pass; `--keep-going` on a temporary repository with two failing
  fake steps reports both and exits 1, and a failing step followed by a passing one reports one; the step order is
  asserted from the gate's own step list (a dry listing mode, `--list-steps`, prints the full-mode order without
  running anything: add it; it is also what the README table is checked against).
- `no-pattern-kill.test.sh`: the hook refuses `pkill -f x`, `killall x`, `kill $(pgrep -f x)`, `ps aux | grep x | xargs
  kill`; allows `kill 1234`, `kill $PID`, `kill %1`, and a command that merely mentions the word in a string or path.
- `agent-worktrees.test.sh` on a temporary repository: `clean` removes a claimed, done, clean worktree of its session;
  leaves a claimed one of another session, an unclaimed one, a dirty one and an open one, and says why for each.
- `bash scripts/gate.test.sh && bash scripts/agent-worktrees.test.sh && bash .claude/hooks/no-pattern-kill.test.sh`.
- `scripts/gate.sh --quick --allow-protected` passes on the branch; the coordinator runs the full gate with
  `--keep-going` on the merged tree as the first real use.

## 10. Risk and suggested model tier
Sonnet. The gate is the definition of done: a reorder or a keep-going path that reports PASS after a red step would
be worse than any fault it fixes. The test cases for exactly that come first.

## Notes from previous attempts
