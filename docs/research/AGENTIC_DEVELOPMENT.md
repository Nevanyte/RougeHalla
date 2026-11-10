# Agentic development: model routing, quality gates and token cost

Research note, 2026-11-10. Owner question: how to build `optimization_port` to completion (Rust mechanics, AWS servers,
Unity visuals and audio) with AI agents, Claude Opus as the primary, while keeping quality high and token cost down.
Requested split: Opus for hard technical decisions, Sonnet for UI, DeepSeek V4.1 Flash (`DeepSeek-V4.1-Flash-1017`,
API name `deepseek-flash`) for most Rust code. Also requested: Matt Pocock's `/retro` and `/grill-me` skills, and an
architecture in which Opus can call DeepSeek or Sonnet sub-agents.

**Status: proposal.** Nothing here changes the current lead or worker assignments in
[PROJECT_COORDINATION.md](../PROJECT_COORDINATION.md), which says the Codex chat is the lead. That is the owner's call.
Plan position ([ORDER_OF_OPERATIONS.md](../ORDER_OF_OPERATIONS.md) section 3): this serves the operating rule
"coordinator throughput is the bottleneck: measure it." It touches no D-rule and no wire, sim or status record.

---

## 1. Recommendation in one page

1. **Spend the expensive model only where a mistake is expensive.** Opus 5.5 handles the scoping interview, the
   packet (work order), the design-level review and the merge. It never types mechanical Rust. DeepSeek Flash
   implements Rust packets. Sonnet 5.5 handles Unity C#/UI, tooling scripts and repairs that DeepSeek fails twice.
2. **Opus calls DeepSeek through a script, not a model.** The script is `tools/agents/worker.sh <packet>`. It creates
   a worktree, runs a headless coding agent configured for DeepSeek, then runs the gates itself and returns one small
   JSON report. Opus runs it with Bash in the background. No Claude tokens are spent relaying DeepSeek's work.
   Sonnet workers are ordinary Claude Code sub-agents (`.claude/agents/*.md` with `model: sonnet`).
3. **Gates check workers' claims mechanically.** The reviewer reads a gate report and a diff, not a worker's
   claims. Rust's compiler plus this repo's parity fixtures, golden vectors and perf gate are already strong. Six
   cheap checks close the remaining ways a cheap model games a green build (section 5).
4. **The biggest saving is context, not model price.** Every fresh agent is told to read about 480 KB of docs
   (about 120k tokens) before working, and docs grow about 24 times faster than code. A short status file, packets
   that carry their own context, and one file per contract cut a typical start to under 15k tokens (section 6).
5. **Close the loop with skills.** Use `/grill-with-docs` (the `/grill-me` variant that also updates the glossary
   and ADRs) at the start of each phase. Turn the result into packets. Run `/retro` after every merged packet, and
   have Opus triage the retro notes weekly into CLAUDE.md, gate or skill changes (section 7).
6. **Measure, then route.** Log cost, attempts, escalations and review findings per packet. After about 20 packets,
   change routing based on measured first-pass rates instead of reputation. Run a short bake-off of DeepSeek Flash
   against Claude Haiku 5.5 first, because their list prices are now close (section 3).

---

## 2. What the repo already does right (keep it)

These are why cheap workers are viable here at all. Most codebases have none of them.

| Mechanism | Where | Why it matters for cheap workers |
|---|---|---|
| Pure, deterministic sim | `rh-sim` (no I/O, clock or entropy), clippy disallowed types/methods, `unsafe_code = "forbid"` | Every behaviour is reproducible, so every claim is checkable. |
| Oracle tests | `parity/` captured legacy fixtures, 300 A* queries, `rh-parity` report | Correctness is a byte comparison, not an opinion. |
| Golden wire vectors | `protocol/fixtures/v<N>.json`, Rust/C#/JS decoders | Cross-language drift fails loudly. |
| Perf gate | `.github/workflows/perfproof.yml` (instruction count ≤ 1.03x, no allocation increase) | Catches "make borrowck happy with `.clone()`" regressions. |
| Strict CI | `fmt --check`, `clippy -D warnings`, workspace tests, PG tests, headless smoke | A broken build cannot be described as done. |
| Write scopes | Each packet's "Exclusive write scope"; [sweep/PACKAGES.md](../sweep/PACKAGES.md) | Bounds what a worker can damage. |
| Model tier in packets | Each packet's "Risk and suggested model tier" | Routing information already exists, just as prose. |
| Proven orchestration | `tools/sweep/core-stage.workflow.js`: implement (Sonnet), independent review (Opus), fix (Sonnet), in worktrees | The pattern works. This proposal adds a cheaper implement tier under it. |
| Anti-cheat culture | "Changing expected fixtures is not a parity repair", "a compile failure is not a mutant kill" | The rules exist but are enforced by reviewers. Section 5 automates them. |

The owner's premise holds: Rust makes it hard to fake a build. A compiling, clippy-clean Rust diff that passes
byte-exact parity is far stronger evidence than the same claim in TypeScript or C#. It does not cover everything. A
cheap model can still go green by weakening the test instead of fixing the code. Section 5 covers that.

---

## 3. Prices and what they imply

List prices per million tokens, checked 2026-11-10 (Anthropic pricing as cached in the Claude API reference; DeepSeek
from api-docs.deepseek.com/quick_start/pricing).

| Model | Input | Cached input | Output | Notes |
|---|---|---|---|---|
| Claude Opus 5.5 | $4.00 | $0.20 | $20.00 | Default effort `medium`; thinking cannot be disabled |
| Claude Sonnet 5.5 | $2.00 | $0.10 | $10.00 | |
| Claude Haiku 5.5 | $0.10 | (about $0.01) | $0.50 | Prompts up to 100k tokens; $0.50 / $2.50 beyond |
| DeepSeek Flash (V4.1-1017), off-peak | $0.15 | $0.003 | $0.60 | 1M context |
| DeepSeek Flash, peak | $0.30 | $0.006 | $1.20 | Peak: 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri |

**Estimated cost of one Rust packet session** (illustrative: 50 turns, about 60k tokens of context per turn, 90%
cache hits, about 100k output tokens including thinking):

| Worker | Approximate cost per session |
|---|---|
| Opus 5.5 | ~$4 |
| Sonnet 5.5 | ~$2 |
| Haiku 5.5 | ~$0.15 |
| DeepSeek Flash | ~$0.10 off-peak, ~$0.20 peak |

These are order-of-magnitude estimates, not measurements. Three conclusions survive any reasonable change to the
assumptions:

- **A cheap worker costs 20 to 40 times less than Opus per session.** So retries are cheap, but each Opus review is
  not. Cost per *merged* packet is driven by how many Opus review rounds a packet needs. Gates that reject bad
  attempts before Opus sees them pay for themselves.
- **Haiku 5.5 and DeepSeek Flash cost about the same at list price.** Haiku runs natively as a Claude Code sub-agent:
  supported, with no gateway, no second vendor and no data leaving Anthropic. Measure both on the same five packets
  before standardizing on DeepSeek (section 9, step 2). Keep DeepSeek if it wins on first-pass rate.
- **Schedule DeepSeek batches off-peak.** Peak hours double the price and overlap the North American night.

---

## 4. The architecture

```
 Owner ── /grill-with-docs ──► Opus lead (interactive Claude Code session)
                                   │ writes packet (frontmatter: tier, scope, gates, budget)
          ┌────────────────────────┼─────────────────────────────┐
          ▼                        ▼                             ▼
 tools/agents/worker.sh   .claude/agents/unity-ui.md     Opus sub-agent (effort high)
 tier: rust-mech          tier: ui (Sonnet 5.5)          tier: design / security / protocol
 DeepSeek Flash           worktree isolation             (or Opus does it itself)
 headless, in a worktree
          │                        │                             │
          └──────────► tools/agents/gate.sh (same gates for every tier) ◄──────┘
                                   │  gate-report.json (pass/fail, scope, test delta, fixtures touched)
                                   ▼
                    Opus review: gate report + diff only (not transcripts)
                         │ pass → merge          │ fail → escalate one tier
                         ▼                       ▼
                    /retro → docs/retro/      DeepSeek×2 → Sonnet → Opus
```

### 4.1 Tiers and routing

| Tier | Model | Gets | Never gets |
|---|---|---|---|
| `lead` | Opus 5.5, effort `high` for design/review, `medium` for routine coordination | Scoping, packets, ADRs, contract/protocol/privacy/security decisions, reviews, merges, shared status records | Mechanical implementation (it reviews it instead) |
| `rust-mech` | DeepSeek Flash via `worker.sh` | Rust ports with an oracle (fixture, golden vector, parity scenario); repetitive tests; mutation-killing tests; renames and other refactors gated by the compiler | New invariants, protocol bumps, `rh-sim` schedule/seam changes, anything with no oracle |
| `ui` | Sonnet 5.5 sub-agent | Unity C# presentation/HUD/UI/audio wiring, `RoguehallaNet` adapters, JS tooling, docs rewrites | Game rules (forbidden in Unity anyway) |
| `repair` | Sonnet 5.5 | A packet DeepSeek failed twice, with both gate reports attached | Scope changes |
| `cheap-read` (optional) | Haiku 5.5 sub-agent | Summarizing logs, CI output and long evidence into 20 lines for Opus | Decisions |

Routing rule, in order: **(1) no oracle → `lead`** (or a `lead` design first, then a packet), **(2) touches a frozen
seam** (schedule, hooks, input seam, observation rules, wire envelope; see ORDER_OF_OPERATIONS section 3) **→ `lead`**,
**(3) Unity or JS → `ui`**, **(4) otherwise → `rust-mech`**. Escalation: two `rust-mech` attempts (the second gets the
first gate report), then `repair`, then `lead`. Every escalation is logged. A packet type that escalates often gets
re-routed at the source.

### 4.2 How Opus calls DeepSeek

The Claude Code docs are explicit that sub-agent `model` takes only Claude models and that routing Claude Code to
non-Claude models through a gateway is **not supported** (code.claude.com/docs/en/llm-gateway). So DeepSeek cannot be a
`.claude/agents` entry. It runs as a separate headless process behind a script with a fixed contract:

```
tools/agents/worker.sh --packet docs/backlog/packets/P-XYZ.md --base <sha> [--attempt 2 --prior gate-report.json]
  → creates worktree .claude/worktrees/P-XYZ-a1 on branch work/P-XYZ-a1
  → runs the harness with: packet text + attempt notes + a short worker brief (≤ 2k tokens)
  → runs tools/agents/gate.sh in the worktree (the worker's own claims are ignored)
  → prints one JSON line: {packet, attempt, branch, head, gate:{...}, cost_usd, turns, summary}
```

Opus runs it with `Bash(run_in_background)` and is notified on exit. It reads one JSON line, not a transcript.

Harness choices behind the script (swappable without changing the contract):

| Harness | Pros | Cons |
|---|---|---|
| **Claude Code `claude -p`** with `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`, the key in `ANTHROPIC_API_KEY`, `--model deepseek-flash` | Same tools, skills and settings as the Claude tiers. `--output-format json`, `--max-turns`, `--max-budget-usd`, `--permission-mode` | **Unsupported by Anthropic.** DeepSeek's endpoint ignores `cache_control` (it caches automatically) and `is_error` on tool results; Claude Code's prompts are tuned for Claude. Works in community use, but may break on a Claude Code update. |
| **Codex CLI** with a DeepSeek provider | The repo already runs Codex lanes. DeepSeek publishes native Codex support. | A second harness to configure. |
| **OpenCode / Aider** with DeepSeek | First-class DeepSeek support | Third tool to learn |

Start with `claude -p` because it reuses `.claude/` and skills, and pin the Claude Code version the script uses. If
it breaks, switch the script to Codex. **Because the gates run outside the harness, quality does not depend on which
harness ran.** That is the point of the design.

Sonnet and Haiku tiers are ordinary sub-agents, for example `.claude/agents/unity-ui.md`:

```markdown
---
name: unity-ui
description: Implements Unity client presentation, HUD, UI and audio packets. Never game rules.
model: sonnet
effort: medium
isolation: worktree
permissionMode: acceptEdits
tools: Read, Edit, Write, Grep, Glob, Bash
skills: [tdd]
---
You implement one packet. Read only the packet and the files it lists. Unity contains no game rules (ADR 0008).
Run tools/agents/gate.sh before you finish and paste its JSON. Do not edit files outside the packet's write_scope.
```

Plus `rust-repair.md` (`model: sonnet`) and `log-digest.md` (`model: haiku`, read-only tools).

### 4.3 Making the orchestration repeatable

Extend `tools/sweep/core-stage.workflow.js` into `tools/agents/packet.workflow.js`, which runs: implement (tier from
packet frontmatter; `rust-mech` packets go through a thin agent whose only job is to run `worker.sh` and return its
JSON) → gate → Opus review against the packet → fix (escalated tier) → re-gate. Independent packets run in parallel.
Rate limits: two or three Opus reviews at once, not more. ORDER_OF_OPERATIONS already warns that coordinator
throughput is the bottleneck. More parallel workers than one reviewer can admit is waste.

---

## 5. Quality: gates that stop a cheap model from cheating

`tools/agents/gate.sh` runs in the worker's worktree against the packet base and writes `gate-report.json`. Every check
is mechanical. A failure is reported, never softened.

| # | Check | Catches |
|---|---|---|
| G1 | `cargo fmt --check`, `cargo clippy --workspace --all-targets --all-features -D warnings` | Basics |
| G2 | Affected tests: `cargo test -p <crates touched>`, plus `rh-parity` report all MATCH if `rh-sim` is touched | Broken behaviour |
| G3 | **Scope:** `git diff --name-only base..HEAD` ⊆ packet `write_scope` | Drive-by edits, edits to `Cargo.lock` or status records |
| G4 | **Oracle lock:** no change under `parity/**/fixtures`, `parity/maps`, `protocol/fixtures/v*.json`, or other captured outputs unless the packet lists them in `may_regenerate` *and* names the generator command (re-run by the gate, which compares bytes) | "Fixing" the expected answer |
| G5 | **Test-weakening diff scan:** new `#[ignore]`, `#[should_panic]`, `#[allow(` / `#![allow(`, `todo!`, `unimplemented!`, `dbg!`, `cfg(test)` branches in non-test code, deleted `assert*!` lines, deleted `#[test]` fns, `unwrap()` added to `rh-server` paths, edited tolerances/epsilons | Going green by weakening checks |
| G6 | **Test count does not fall** (`cargo test -- --list` before and after) | Silent test deletion |
| G7 | Perfproof A/B against the base when `rh-sim` or `rh-server` hot paths are touched (existing tool) | `.clone()`/allocation regressions |
| G8 | For packets marked `mutants: true`: `cargo mutants --in-diff` on the touched files, with survivors listed | Tests that do not test anything |
| G9 | Wire packets: golden vectors pass in Rust, C# (`dotnet test`) and JS | Cross-language drift |

Also add workspace lints so G5 is partly enforced by the compiler: `clippy::todo`, `clippy::unimplemented`,
`clippy::dbg_macro`, `clippy::allow_attributes_without_reason`, `clippy::unwrap_used` (server crates only).

For Claude tiers, the same `gate.sh` runs as a `SubagentStop` hook (blocking with exit 2 until it passes or the turn
budget runs out). For DeepSeek, `worker.sh` runs it after the harness exits. The reviewer always gets the gate report
the gate produced, never one the worker typed.

**Review by Opus, made cheap:** the review prompt contains the packet, `gate-report.json`, `git diff --stat` and the
diff of non-test source. Tests are reviewed only if G5 flagged them. Opus answers with structured output:
`{verdict: merge|fix|escalate|reject, findings[]}`. Use `/code-review` (parallel sub-agents) only for packets tagged
`risk: high`. Everything else gets one Opus pass.

---

## 6. Token cost: put agents on a context diet

### 6.1 What it costs today (measured from the repo, 2026-11-10)

| Fact | Number |
|---|---|
| Mandatory reading list in CLAUDE.md/AGENTS.md (CLAUDE, MIGRATION, REQUIREMENTS, CONTRACTS, backlog README, ADRs) | ~480 KB ≈ 120k tokens |
| `docs/MIGRATION.md` alone | 156 KB, an append-only log; its "current state" section mixes 30+ build identifiers per paragraph |
| `docs/CONTRACTS.md` | 88 KB, one file for all contracts |
| Lines added in the last 200 commits | docs 317,730 vs Rust 13,095 vs C# 13,018 |
| `docs/evidence/` | 259 MB, 4,947 files (70 over 1 MB), searchable by every agent's Grep/Glob |

At Opus prices, that reading list costs about $0.50 per fresh agent before it does anything. Reading it every time
also fills a cheap model's attention with history it must not act on. Many identifiers like "Web57", "c52", "Root21"
and "protocol14/checkpoint29" appear without definitions. A strong model infers them. A Flash model guesses.

### 6.2 Changes

1. **`docs/STATUS.md`, at most 150 lines, rewritten (not appended) by the coordinator at each merge:** current phase,
   identity versions, what is green/red, active packets and owners. MIGRATION.md becomes the archive. CLAUDE.md
   tells agents to read STATUS.md and their packet, and the full archive only when the packet says so.
2. **Packets that carry their own context.** Add YAML frontmatter that both the router and the worker read:

   ```yaml
   ---
   id: P-XYZ-1
   phase: "2.7"                  # ORDER_OF_OPERATIONS item
   tier: rust-mech               # lead | rust-mech | ui | repair
   risk: medium                  # high → /code-review and Opus effort high
   oracle: parity/xyz/fixtures/*.json
   read: [crates/rh-sim/src/systems/xyz.rs, docs/contracts/C-TICK.md]
   write_scope: [crates/rh-sim/src/systems/xyz.rs, crates/rh-sim/tests/xyz.rs]
   may_regenerate: []
   gates: [G1, G2, G3, G4, G5, G6, G7]
   mutants: false
   budget: {turns: 60, usd: 1.00}
   ---
   ```

   The worker brief is "read the packet and the files in `read`." Nothing else is required.
3. **One file per contract** (`docs/contracts/C-TICK.md` and so on). `CONTRACTS.md` becomes an index plus the
   coordinator-owned status table. A packet loads two or three contracts, not 88 KB.
4. **Keep evidence out of agents' way.** Add `permissions.deny: ["Read(docs/evidence/**)"]` in a worker settings file,
   and an ignore file for search. Longer term, move bulky evidence (everything over 1 MB) to S3 or Git LFS with a
   manifest and checksum in Git. The 259 MB also slows every fresh clone and worktree.
5. **Cap docs growth.** A packet hand-off is one structured `report.json` (schema below) plus at most one short
   evidence README. Long prose logs are not hand-offs. Track the doc:code line ratio per week and aim below 2:1.

   ```json
   {"packet":"P-XYZ-1","base":"…","head":"…","gate":"pass","tests_added":7,
    "deviations":[],"proposed_status_edits":[],"open_questions":[],"not_established":["…"]}
   ```
6. **Plain language in shared docs.** Every identifier in STATUS.md is defined once in a `docs/GLOSSARY.md` (which
   `/grill-with-docs` maintains anyway). Write status in full sentences.
7. **Cache-friendly prompts.** Keep CLAUDE.md, agent briefs and skill descriptions stable byte-for-byte across a run
   (no dates or SHAs at the top) so the system-prompt prefix is cached at 5% of the input price (Opus and Sonnet) or
   about 2% (DeepSeek, automatic). Put the per-packet text last.
8. **Effort as a dial.** Opus `medium` for coordination and routine review, `high` for design, protocol and security,
   `xhigh` only for an incident. Sonnet workers at `medium`.

Expected effect: a worker start goes from ~120k tokens of mandatory reading to ~10–15k (brief, packet, `read` files).
That saving applies to every agent of every tier on every attempt.

---

## 7. Skills: grill, retro and repo-specific ones

Install Matt Pocock's skills once (`claude plugin install mattpocock-skills@claude-plugins-official`), then run
`/setup-matt-pocock-skills`. Point its issue tracker at local files (`docs/backlog/`), because this repo's backlog lives
in Git.

| When | Skill | Who runs it | Output |
|---|---|---|---|
| Start of a phase or any unclear item | `/grill-with-docs` (preferred over `/grill-me` here, because it checks the codebase and updates `GLOSSARY.md` and ADRs) | Owner + Opus | Settled decisions, glossary, ADR drafts |
| After grilling | `/to-tickets`, then convert each ticket into a packet with the frontmatter above (a repo skill, `packet-author`, does the conversion and assigns `tier`) | Opus | Packets |
| Owner can't decide alone | `/to-questionnaire` | Opus | Questions for the owner |
| Implementation | `/tdd` preloaded into worker agents | Workers | Red-green slices |
| Hard bugs, perf regressions | `/diagnosing-bugs` | Sonnet or Opus | A regression test |
| Before a context reset | `/handoff` | Any | A short continuation doc |
| After every merged packet | `/retro` | Opus (or the worker, for its own session) | Environment improvements, worst first, appended to `docs/retro/YYYY-MM.md` |
| Weekly | Opus triages the retro log | Opus | Concrete changes: a CLAUDE.md line, a new gate check, a skill edit, a packet-template field, a routing change |

Retro is how the system gets cheaper over time. Each recurring failure ("DeepSeek keeps editing fixtures", "workers
can't find the movement seam") should turn into a gate, a `read` hint or a lint, not a longer prompt.

Repo skills to write (`.claude/skills/<name>/SKILL.md`, short, `disable-model-invocation: true` for owner-only ones):

- `packet-author`: ticket → packet with frontmatter, routing rule applied, oracle named or tier set to `lead`.
- `dispatch`: run `worker.sh` or a sub-agent for a packet, collect the gate report, apply the escalation ladder,
  append to the ledger.
- `parity-port`: the repo's exact recipe for porting a mechanic: capture legacy, add the fixture, write the parity
  test, wire the schedule row. This is the most common DeepSeek task, so give it the recipe instead of letting it
  rediscover the recipe from 480 KB of docs.
- `review-packet`: the cheap structured Opus review in section 5.

Keep skill descriptions short. Every installed skill's description is loaded into every session. Disable the Pocock
skills this repo doesn't use (`triage`, `teach`, `wizard`, and so on).

---

## 8. Measurement: the routing ledger

`tools/agents/ledger.jsonl`, one line per attempt, written by `dispatch`:

```json
{"packet":"P-XYZ-1","tier":"rust-mech","model":"deepseek-flash","attempt":1,"turns":41,"cost_usd":0.09,
 "gate":"fail","failed":["G4"],"escalated_to":"rust-mech#2","review_rounds":0,"opus_review_usd":0}
```

Weekly numbers: cost per merged packet by tier and packet type, first-pass gate rate, escalation rate, Opus review
rounds per merge, and doc:code ratio. Route by those numbers. Claude-side spend is visible through
`--output-format json` (`total_cost_usd`) and Claude Code's OpenTelemetry metrics (`claude_code.cost.usage`, split by
`agent.name`). DeepSeek spend is in the same JSON when run through `claude -p`, or in DeepSeek's usage console.

---

## 9. Rollout (small steps, each reversible)

1. **Context diet (Opus, about a day):** STATUS.md, a CLAUDE.md that points at it, packet frontmatter template, a
   contracts split for the five most-cited contracts, evidence read-deny. No behaviour change.
2. **Gates and bake-off (Opus + one worker):** write `gate.sh` (G1–G6 first) and `worker.sh`. Run the same five
   `rust-mech` packets that have oracles through DeepSeek Flash and Haiku 5.5. Compare first-pass gate rate, review
   findings and cost per merged packet. Pick the default `rust-mech` model from the data.
3. **Sub-agents and skills:** `.claude/agents/{unity-ui,rust-repair,log-digest}.md`; install the Pocock skills; write
   `packet-author`, `dispatch`, `parity-port`, `review-packet`.
4. **Workflow:** `packet.workflow.js` with implement, gate, review, fix and the ledger.
5. **Steady state:** weekly retro triage; monthly routing review against the ledger.

---

## 10. Risks and owner decisions

- **Code leaves to DeepSeek's API.** The full Rust source and fixtures would be sent to a third-party (China-hosted)
  API. Decide whether that is acceptable. If not, Haiku 5.5 is the closest-cost alternative and stays on Anthropic.
- **Unsupported harness configuration.** Claude Code against DeepSeek's endpoint is outside Anthropic's documented
  support. The wrapper contract and external gates limit the blast radius. Pin versions and keep a Codex fallback.
- **Lead role conflict.** PROJECT_COORDINATION names a Codex chat as lead. Making Opus the lead is an owner decision.
  Only the coordinator updates that record.
- **Over-parallelism.** Cheap workers can generate branches faster than one reviewer can admit them. Cap in-flight
  packets at about 2× the reviews per day the ledger shows.
- **Price figures move.** Re-check the price table before the bake-off. The estimates in section 3 are illustrative.

## Sources

- Claude Code docs: sub-agents, headless mode and CLI flags, skills, hooks, LLM gateways, costs and monitoring
  (code.claude.com/docs/en/sub-agents, /headless, /cli-reference, /skills, /hooks, /llm-gateway, /costs,
  /monitoring-usage), read 2026-11-10.
- DeepSeek API: pricing (api-docs.deepseek.com/quick_start/pricing) and Anthropic-compatible API
  (api-docs.deepseek.com/guides/anthropic_api), read 2026-11-10.
- Matt Pocock skills: github.com/mattpocock/skills (skill list and install commands), read 2026-11-10.
- This repository: CLAUDE.md, AGENTS.md, PROJECT_COORDINATION.md, ORDER_OF_OPERATIONS.md, sweep/PACKAGES.md,
  backlog packets, `tools/sweep/core-stage.workflow.js`, `.github/workflows/rust.yml`, `git log` statistics.
