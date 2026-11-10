# AGENTS.md

Roguehalla is being migrated from a TypeScript/Colyseus/Phaser game (`packages/`, still runnable) to a Rust authoritative
server (`crates/`) and a Unity browser client (`client-unity/`). Stage 1 (foundation) is done; the bulk port is next.

**The core optimization sweep, the efficiency pass and the lock-in pass are complete** ([docs/sweep/README.md](docs/sweep/README.md),
merged at `b326676`). Stage 2 on `optimization_port` adds melee/items, capture coverage, protocol 5 and a verified Unity Web
bootstrap. Full gameplay and client flows remain in progress; use the current checkpoint in `docs/MIGRATION.md`.
Packets that edit `crates/rh-sim` follow the core layout rules in their write scopes
([docs/sweep/PACKAGES.md](docs/sweep/PACKAGES.md)).

Read in this order: [docs/MIGRATION.md](docs/MIGRATION.md) (state, checkpoint, commands, results), [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md),
[docs/CONTRACTS.md](docs/CONTRACTS.md), [docs/backlog/README.md](docs/backlog/README.md) and its ready packets,
[docs/adr/](docs/adr/README.md). Legacy architecture (long, partly stale; code wins): [docs/legacy/CLAUDE_LEGACY.md](docs/legacy/CLAUDE_LEGACY.md)
and the verified [docs/legacy/INVENTORY.md](docs/legacy/INVENTORY.md).

Non-negotiables:
- Prioritize complete Rust gameplay, parity and headless ahead of Unity visuals (owner instruction 2026-11-05).
- Unity contains no game rules, physics, combat or AI. Its sole gameplay exception is narrow local movement prediction,
  mirrored from Rust, checked with Rust vectors and always corrected by the server; headless/policy runs never use it.
- `rh-sim` is pure (no I/O, clock, entropy); fixed 20 Hz step; the legacy tick order is never reordered (C-TICK).
- Every actor (human, bot, future policy) acts only through `validate` + `Sim::submit` (C-INPUT); observations never
  leak hidden state (C-OBS); secrets never leave the server (C-RNG).
- Every ported mechanic comes with captured legacy fixtures and a parity test (`parity/`, C-PARITY).
- Wire changes: bump `PROTOCOL_VERSION` when incompatible; regenerate the golden vectors `protocol/fixtures/v<PROTOCOL_VERSION>.json` (`cargo run -p rh-protocol --bin protocol-fixtures`); the Rust, C# and JS decoders must all pass them.
- No ML training, models, datasets, Python bindings or inference services ([docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) R-ML).
- Only the coordinator edits shared status records (MIGRATION checkpoint, CONTRACTS status table) and `Cargo.lock`.

## Model routing for Codex sessions (owner direction 2026-11-10)

The Codex session you are in is the lead: it scopes, writes packets, delegates and reviews. Use OpenAI's model tiers by
name: **Sol** (large), **Terra** (mid), **Luna** (small). Use the newest generation of each that Codex offers. Terra has not
appeared in the GPT-6 generation, so where it is not offered use **Sol at medium reasoning** in its place. Delegate by the
first matching row. Claude sessions follow the equivalent table in [CLAUDE.md](CLAUDE.md); rationale and gate design:
[docs/research/AGENTIC_DEVELOPMENT.md](docs/research/AGENTIC_DEVELOPMENT.md).

| Work | Model |
|---|---|
| Anything without a mechanical oracle; new invariants, ADRs, contract/D-rule conflicts; frozen seams (tick schedule, hooks, input seam, observation/privacy rules, wire envelope); protocol bumps (the decision); security, anti-cheat, rewind/RTT bounds; persistence durability and concurrency; AWS cost, IAM and lifecycle design; release acceptance; reviewing every delegated diff before merge | **Sol** (high reasoning for design and security review, medium for routine review) |
| Rust with an oracle: porting a legacy mechanic against captured fixtures plus its parity test (mobs, cards, abilities, statuses, quests, traders, bot behaviours); fixture capture tools under `tools/*-fixtures`; Rust/C#/JS codec mirrors and decoders against golden vectors once the wire shape is fixed; C# ports of Rust code checked against Rust vectors (the narrow movement prediction); mutation-killing and negative-control tests; mechanical refactors, renames and lint cleanup the compiler checks; `rh-headless`/`rh-load` scenarios | **DeepSeek Flash** (default for Rust implementation; Terra when DeepSeek is unavailable) |
| Unity presentation: HUD, menus, UI, audio, art wiring, quality tiers, MatchClient projection (no game rules); `RoguehallaNet` adapters without a Rust vector; deployment scripts and IaC implementation after a Sol design; browser-proof/playtest tooling; persistence and server code Sol has designed but that has no fixture; any packet DeepSeek fails twice | **Terra** |
| Read-only and bulk-cheap: codebase exploration, CI and test-log digests, evidence and long-doc summaries, retro notes, doc link and format fixes, regenerating outputs with a named generator command, one-file mechanical edits under 50 lines with an existing test | **Luna** |

Rules:
- **Bias to DeepSeek where it matters.** If the work has an oracle (fixture, golden vector, parity scenario, Rust vector) and
  touches no frozen seam, it goes to DeepSeek even when it is large. If it has no oracle, Sol writes one into the packet first
  (or keeps the work).
- **How to call DeepSeek:** hand the packet to the DeepSeek Rust lane ([PROJECT_COORDINATION.md](docs/PROJECT_COORDINATION.md))
  until `tools/agents/worker.sh` exists, then run that script and read only its JSON report. Codex can also run DeepSeek
  directly through a DeepSeek model provider profile; keep that profile's write scope to the packet.
- **Delegate with a packet, not the reading list.** The worker gets the packet, its write scope, the files to read and the
  validation commands, and nothing from the reading order above unless the packet names it.
- **Escalate one step at a time:** DeepSeek, then DeepSeek again with the first failure output, then Terra, then Sol. Luna
  work that fails once goes to Terra. Record each escalation in the hand-off.
- **Gates decide, not the worker's report.** Before review, re-run the packet's validation commands yourself (or check CI). A
  changed fixture, a new `#[ignore]`/`#[allow]`, a deleted assertion or an edit outside the write scope is a failure, not a
  repair. Sol reviews the diff plus the gate output, not the worker's transcript.
- After each merged packet, write a short retro; fold recurring failures into gates or this file rather than longer prompts.

Commands: `cargo test --workspace` (Postgres tests: `eval "$(tools/pgtest/start.sh)"`), `cargo run -p rh-parity --bin parity-report`,
`dotnet test client-unity/RoguehallaNet.Tests`, `node tools/browser-proof/proof.mjs`; legacy: `npm ci && npm test`.
