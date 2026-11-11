# RogueHalla development process

How work moves from an idea to the integration branch. `AGENTS.md` holds the rules every agent obeys and `CLAUDE.md` the
Claude routing; this file explains the process they encode, step by step, with the commands. Adopted by owner direction
on 2026-11-10; it replaces the earlier per-lane habits (Codex Root, DeepSeek, Sol/Luna) for all future agent work.

## Roles

| Role | Who | Owns |
|---|---|---|
| Owner | the human | Direction, approvals (push, canonical merges, deploys, protected paths), DEVIATIONS signatures, ADR acceptance |
| Coordinator | the main Claude session | Packet selection, dispatch, integration, shared status records, `Cargo.lock`, `docs/agent/INTEGRATION_BRANCH` |
| Oracle author | `oracle-author` | The packet brief and its failing oracle, on `packet/<ID>` |
| Implementer | `implementer`, `implementer-sonnet`, `implementer-opus` | Making the oracle pass inside the write scope, on `agent/<model>/<ID>` |
| Reviewer | `reviewer`, `reviewer-opus` | A verdict on a gate-green branch against its packet and the contracts |
| Scout | `scout` | Read-only answers: paths, APIs, tests, legacy locations |
| Debugger | `debugger` (Fable) | Root cause of a determinism or parity divergence Opus could not fix |

Routing between them is the table in `CLAUDE.md`.

## Lifecycle of a packet

```
backlog item ──► packet brief ──► packet/<ID>: failing oracle ──► agent/<model>/<ID>: implementation
   (Coarse)       (Ready packet)     (oracle-author)                 (implementer, gate --quick … gate --oracle)
                                                                          │ GATE PASS (full)
                                                                          ▼
           MIGRATION checkpoint ◄── merge + full gate ◄── LAND ◄── review (reviewer | reviewer-opus)
             (coordinator)            (coordinator)
```

### 1. Choose

The coordinator picks work from the MIGRATION checkpoint's open items and ORDER_OF_OPERATIONS, in phase order. Work that
is in neither needs the owner's approval before a packet is written. A design idea inside the freeze (D5) goes to the
queue, not into a packet.

### 2. Write the packet

`docs/backlog/packets/<ID>.md`, using [PACKET_TEMPLATE.md](PACKET_TEMPLATE.md): the backlog README's section list plus the
routing fields (serves, tier, reviewer, oracle files). Cite real files with line numbers; verify legacy paths with `rg`.
Size: one area, about 300 changed lines, one oracle that proves it. Larger work is several packets in dependency order.
The coordinator sets the backlog row to "Ready packet".

### 3. Write the oracle

`oracle-author` branches `packet/<ID>` from the integration branch, commits the brief and the failing tests, and confirms
each fails on an assertion. Kinds of oracle, strongest first:

1. **Parity against a legacy capture**: the capture comes from the legacy game through its tool (`parity/legacy-capture/`,
   `tools/<area>-fixtures/capture.sh`); exact fixtures need Linux x64 and Node 22.23.4 (`parity/README.md`).
2. **Golden vectors** for wire changes (`protocol/fixtures/v<N>.json`, Rust/C#/JS).
3. **Invariant tests** (proptest, `hash_coverage`, `no_alloc`, `check_world` refusals) for state and determinism.
4. **Unit tests** for everything else.

When legacy behaviour looks like a bug, the oracle pins legacy and the brief flags it. Security packets skip this step:
`implementer-opus` writes the failing tests first.

### 4. Implement

The implementer checks out `agent/<model>/<ID>` from `packet/<ID>` in its own worktree, reads the packet and the crate's
`AGENTS.md`, iterates with `scripts/gate.sh --quick`, and finishes with `scripts/gate.sh --oracle packet/<ID>`. It stops
and reports when the oracle contradicts legacy, the scope is too small, or the second full gate fails. The escalation
ladder is in `CLAUDE.md`.

### 5. Review

The coordinator sends gate-green branches only. The reviewer reads the packet, `git diff packet/<ID>...<branch>` and the
gate log, and answers `LAND`, `LAND WITH NOTES` or `REJECT`. Reviews are read-only and scoped to the packet.

### 6. Integrate

The coordinator merges `LAND` branches into the integration branch one at a time (shared-file packets strictly
serially), re-runs the full gate on the merge, updates the backlog row, the MIGRATION checkpoint and, where a contract's
validation changed, the CONTRACTS table, then removes the worktree. Promotion from the integration branch to
`optimization_port` or `main`, any push and any deploy wait for the owner.

## Branches and worktrees

| Ref | Holds |
|---|---|
| `docs/agent/INTEGRATION_BRANCH` | One line: the branch packets start from and merge into (coordinator-owned). |
| `packet/<ID>` | Brief and oracle commits. Read-only once the implementer starts. |
| `agent/<model>/<ID>` | One implementation attempt line (`haiku`, `sonnet`, `opus`, `fable`). |
| `<ID>-fix` packets | Review notes, as small follow-up packets. |

Agents with `isolation: worktree` get a fresh worktree under `.claude/worktrees/`, based on the coordinator's `HEAD`
(`worktree.baseRef: "head"`). Their first command selects their branch, e.g.
`git checkout -B agent/sonnet/P-X-1 packet/P-X-1`. Each worktree compiles its own `target/` (several GB, minutes): that
cost is why `CLAUDE.md` caps parallel Rust implementers at three. After integration:
`git worktree remove <path>` and delete the merged `agent/*` branch (deletion needs the owner's yes per `CLAUDE.md`).

## The gate

`scripts/gate.sh` is the only definition of done; `--help` prints its options.

| Mode | Runs |
|---|---|
| `--quick` | Path checks; fmt; clippy and tests for each changed crate (`rh-sim` with `trusted-status-probes`, as CI); the parity report if sim/policy/parity changed; JS vector checks if the protocol changed; C# tests and the Unity copy check if the net library or vectors changed; Postgres suites when `DATABASE_URL` is set |
| full (default) | Path checks; fmt; workspace clippy with all and default features; the workspace suite and the `rh-sim` suite; Postgres suites when `DATABASE_URL` is set; parity report; JS vectors; C# tests and Unity copy check; a release headless smoke on `parity/maps/seed1.map.json` |
| CI only | Source-witness `capture.sh --check` runs (Docker, Node 22.23.4), perfproof (valgrind, Linux), cross-architecture determinism, browser proof, legacy recapture |

Path checks: protected paths need `--allow-protected` (owner approval), shared records `--coordinator`, wire packets
`--regen-fixtures`; with `--oracle packet/<ID>`, every file the oracle commits touched plus all captures and golden
vectors must be unchanged. A skipped suite is printed on the result line, and a reviewer treats it as unproven.

Before the first packet on a new integration branch the coordinator runs the full gate there with Postgres: a red base
makes every later result meaningless.

## Records

- **MIGRATION checkpoint**: the coordinator adds a dated entry per integration (head, packets merged, gate result,
  what remains), keeping the newest on top.
- **Backlog row**: Coarse → Ready packet → Done (`<merge sha>`).
- **DEVIATIONS.md**: a row proposed in the hand-off for every intentional difference from legacy; the owner signs it.
- **`.agent-runs/log.csv`** (git-ignored): one line per attempt,
  `date,packet,agent,model,attempt,gate,minutes,notes`. Re-tune routing from it: task kinds Haiku passes first time stay on
  Haiku; kinds that always escalate start a tier higher; oracles implementers kept disputing need a better brief.

## One-time setup on a machine

- Rust from `rust-toolchain.toml`; `.NET 8` SDK (`~/.dotnet` is picked up); Node 22; PostgreSQL 16 binaries
  (`PGBIN=/opt/homebrew/opt/postgresql@16/bin`, then `eval "$(tools/pgtest/start.sh)"`).
- Run `scripts/gate.sh` on the integration branch with `DATABASE_URL` set and record the result in the checkpoint.
- Restart Claude Code after any change to `CLAUDE.md`, `AGENTS.md`, `.claude/agents/` or `.claude/settings.json`; `/agents`
  shows what loaded.

The review that produced this process, including what the original agent kit got wrong, is
[REVIEW-2026-11-10.md](REVIEW-2026-11-10.md).
