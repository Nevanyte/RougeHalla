# Models on RogueHalla

Which model does which job, why, and the facts that choice rests on. The routing itself is the table in `CLAUDE.md`;
change both together. Re-check the facts table when a new model ships (roughly monthly).

## Policy

The owner's standing instruction (2026-11-09, repeated 2026-11-10): most sub-agents run on **Sonnet**, **Haiku** takes
simple work, **Opus** is reserved for the Rust that matters and for merges, with effort kept as low as the work allows.
The agent kit adopted the same day added **Fable**; this process keeps Fable to the one job where its cost is clearly
repaid and leaves the rest of the instruction intact.

| Model | Jobs here | Why |
|---|---|---|
| Haiku 5.5 | `scout`; `implementer` for mechanical, oracle-backed work | Very cheap; the compiler, clippy, tests and parity do the checking. |
| Sonnet 5.5 | Default implementer; C#/Unity, CI, scripts, `hosting/`; default reviewer | Strong at terminal and multi-file work at half the Opus price; the owner's default. |
| Opus 5.5 | Oracles; `rh-sim` state/tick/RNG/hash, wire, migrations, security, cross-crate; high-stakes and merge reviews; `/plan`, `/run` | The work whose bugs pass every test and surface weeks later as a desync. |
| Fable 5.2 | `debugger` only (L3 divergence after two Opus failures), or when the owner names it | Holding the legacy path and the Rust path for one tick at once; twice the Opus price. |

## Effort

| Job | Effort |
|---|---|
| `scout` | low |
| `implementer`, `implementer-sonnet`, `reviewer`, `/run` | medium |
| `oracle-author`, `implementer-opus`, `reviewer-opus`, `/plan`, `debugger` | high |
| Second attempt at any tier | one level above the agent's default (`CLAUDE.md`) |

Fable 5.2 is documented to start at `high`; gains above it are uneven, so `xhigh` is used only where a gain was measured.
Opus 5.5 and Haiku 5.5 default to `medium` when no effort is set, so every agent file sets it explicitly.

## Prompting

1. **Give the oracle, not prose.** "Make `crates/rh-sim/tests/x.rs` pass, matching `packages/server/src/y.ts:210-264`"
   beats a paragraph describing the behaviour.
2. **Say who owns the code.** For a mechanic's own new file: "this file is yours; consolidate where it is clearly safe."
   For the protocol, captures, schedule and anything with a recording: "smallest diff; behaviour unchanged." Review the
   diff, never the summary.
3. **Name approvals exactly**, as `CLAUDE.md` does. Vague caution makes careful models over-cautious on routine work.
4. **Keep rules fresh.** Reviewer notes stay with their packet; they are never appended to `CLAUDE.md` or `AGENTS.md`.
5. **Put limits in agent files** (`maxTurns`, `effort`), not token budgets in prompts.
6. **Change instructions between sessions.** Edits to `CLAUDE.md`, `AGENTS.md` or `.claude/` take effect in a new session.
7. **Write security work as engineering**: "validate every frame that crosses the trust boundary; fuzz the decoder;
   test each rejection." Safety classifiers on current models (category `cyber`) are less likely to stop that phrasing.

## Facts this rests on

| Fact | Value | Source, checked 2026-11-10 |
|---|---|---|
| Price per MTok, input/output | Fable 5.2 $8/$40 · Opus 5.5 $4/$20 · Sonnet 5.5 $2/$10 · Haiku 5.5 $0.10/$0.50 | Anthropic model table (claude-api reference, cached 2026-11-03) |
| Context / max output | 1M / 128K for all four | same |
| Fable 5.2 effort | thinking always on; start at `high` | same |
| Safety refusals | Fable, Opus 5.5 and Sonnet 5.5 all run classifiers (`cyber` among the categories); the API can fall back to another model on refusal when the caller opts in | same |
| Sub-agent frontmatter | `model` takes `haiku`/`sonnet`/`opus`/`fable`, a full ID or `inherit`; `effort`, `maxTurns`, `isolation: worktree`, `tools` supported | code.claude.com/docs/en/sub-agents |
| `fable` alias | needs Claude Code 2.1.321+; agent files use the full ID `claude-fable-5-2` so the terminal CLI (2.1.258 here) resolves it too | code.claude.com/docs/en/model-config |
| Worktree base | `isolation: worktree` branches from `origin/HEAD` unless `worktree.baseRef` is `"head"`; here `origin/main` is 1,600+ commits stale, so the setting is required | code.claude.com/docs/en/worktrees |
| `AGENTS.md` loading | ignored when a `CLAUDE.md` exists unless imported; every `CLAUDE.md` here is `@AGENTS.md` | code.claude.com/docs/en/memory |

Not verified, so not relied on: the claim that Max plans cap Fable at half the weekly allowance (check Settings › Usage),
and the claim that Claude Code silently answers refused Fable security prompts with Opus 4.8. Security work goes to Opus
because Opus is the owner's tier for important Rust, not because of that claim.
