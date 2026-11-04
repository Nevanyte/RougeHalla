# Core sweep: packages

Merged packages (one line each) and the specs of the packages still open. Each is implemented by one engineer agent in its own
git worktree and branch (`tools/sweep/core-stage.workflow.js`), reviewed independently, fixed, then merged by the coordinator,
who re-runs every gate. Every package keeps the parity report at all MATCH, proves its claims with
`tools/perfproof/perfproof.py` (deterministic instruction and allocation counts against the merge-base, behaviour
fingerprints identical unless declared), and follows the non-negotiables in CLAUDE.md. Designs referenced as
architect/critic/proposal ids (SA1, SH2, OW1, SD5, ...) are in [audit_result.json](audit_result.json): keys `architect`
(packages, target architecture, harness, bugs), `critic` (issues per package, missing items) and `audit:<lens>` (proposals
with designs and baseline measurements).

Dependencies (all merged except H-sim and P10c): P7a after P2b; P5b after P5a; P7b after P7a; P5c after P5b; P8 after P7b; P9
after P7b + P5c + P10a; P10b after P9; H-server after P9 and P5d; H-sim after P8; P10c after P10b's ADR 0010 and H-server (both
edit `rh-protocol`, `conn.rs` and the C#/JS codecs); then the final review. Packages on different lines of that graph can run in parallel when their write scopes
are disjoint (the sim track P7a -> P7b -> P8 and the server track P5b -> P5c are disjoint).

Coordinator decisions that bind them: `dhat` is a dev-dependency of rh-sim (P7a's zero-allocation test); ADR numbers continue
at 0010 (0009 is the core layout, merged with P2b); secrets stay out of the state-hash digest; policy events between
decisions accumulate (bounded) unless that changes scripted-bot outcomes, in which case document the rule; the codec never
clamps what a client sees (it refuses).

## Done (merged into `optimization_port`; numbers in [README.md](README.md))
Earlier packages (perfproof, P1, P6, P2a, P3, P4, P5a-1, P5a-2) are listed in the README's merged table.
- **P2b** executable tick schedule, hook dispatch, same-tick `payLater` seam, `Cx::submit`, ADR 0009: merge `dd867d9`.
- **P10a** protocol v2 (quantized remote actors, `server_ms` derived, `protocol/fixtures/v2.json`): merge `fe4e168`.
- **P7a** allocation-free tick (`step_into`, Roster, inline queues, history ring, `rh-checkpoint/2`): merge `94a34c1`.
- **P5b** density bench, bounded log-linear telemetry, biased pinned-Sleep room loop, `/control/health` metrics: merge `76534b6`
  (merged together with P5c).
- **P5c** one push and one notify per client per tick, batched priority-order flush: merge `76534b6`.
- **P7b** `Store<T>`, `FighterCore`, dense per-slot ranks, scalebench, `rh-checkpoint/3`: merge `29d341c`.
- **P5d** (follow-ups of P5b/P5c: biased reader select, director admission races, padded metrics, refusal log once per room):
  merge `a0e705e`.
- **P8** state identity by construction (serde `HashSer` over `World`, 0 unhashed leaves, `rh-replay/2`, typed refusals, restore
  validation, clippy disallowed types/methods in rh-sim): merge `95c220b`. Thresholds met: hashing cost 0.192x (<= 0.30x), verify
  0.444x (<= 0.5x). Not done: privatizing `TileMap` `w`/`h`/`tiles`; unexplained +1.2% / +0.6% step Ir.
- **P9** observation and publish path (`observe_into`, exhaustive event visibility/class, due-only bot observation with bounded
  accumulation, per-step catch-up filtering, one `Publisher::frames` path, `step_into` in the room): merge `639843f`. Thresholds:
  publish allocations 1.13 per viewer-tick (<= 1.2 met), headless 0.717x (<= 0.85x met), wire 0.799x (the spec's 0.75x **missed**;
  the coordinator's relaxed 0.80x met by a thin margin).
- **CI perf gate** (`.github/workflows/perfproof.yml`, PR merge-base A/B, Ir <= 1.03x, no allocation increase, declared
  fingerprint changes read at run time): merge `03dbcd4`. Not yet run on a real pull request.
- **P10b** measurement only (`deltabench`, [ADR 0010](../adr/0010-snapshot-delta.md)): merge `55786a7`. Gate passed (62% of bytes
  at 8 players, about 1.06x publish Ir by estimate); decision recorded as Accepted; implementation is P10c.
- **H-server** server hardening (director owner tokens and lease states, one admission deadline, permanent write refusals stop,
  room panic reports `Closed`, overload applies queued commands, Ping/Pong charged and a fair reader, refusing Events/Fx encode,
  stricter JS/C# codecs, `SnapshotWriter` removed): merge `3ad072b`. Wire +0.41% Ir, densitybench +0.30% Ir.

## H-sim: restore hardening (in progress; scope from the sweep-wide review)
Scope: `crates/rh-sim/**` (restore, input and checkpoint paths), `crates/rh-sim/README.md`, the backlog packets' write scopes
for `rh-sim` mechanics. Do: `Sim::restore` refuses every state the tick cannot survive (a bad pending action, queued inputs
that `validate` would change, a server time outside the tick range, `next_id == u32::MAX`), one refusal test per rule and a
fuzz test; `Command` opaque (built only by `validate()` or a decode that re-validates); correct the `rh-sim` README
(`FighterCore`, `credit`/`settle`, `step_into`) and the backlog packets that still name `sim.rs`. Proofs: parity all MATCH,
fingerprints identical, Ir within 1.02x, base-recorded replays still verify. Status: implemented, its review required fixes;
not merged.

## P10c: protocol v3, per-connection snapshot delta (in progress; ADR 0010 Accepted)
Scope: `crates/rh-protocol/**`, `crates/rh-server/src/{conn,outbox,room,wire}.rs`, `client-unity/RoguehallaNet/**`,
`crates/rh-server/web/probe.html`, `tools/protocol-js/**`, fixtures `protocol/fixtures/v3.json`. Do: the writer task keeps the
last snapshot it wrote and encodes Full or Delta against it (a skipped snapshot is never encoded); Full on join, resume and
resync; decoders in Rust, C# and JS refuse, never repair, a delta that does not apply and answer with a rate-limited Resync;
bump `PROTOCOL_VERSION` to 3 and regenerate the golden vectors; the browser proof and C# probe pass. Proofs: whole-stream bytes
per player at 8 players against the ADR's 345 B/s prototype, `wire_seed1_8bots` perfproof A/B <= 1.10x Ir, allocations per step
not increased, fingerprints identical except the declared byte change. Status: implemented, its review required fixes; not
merged. **Until it merges the wire is v2 and docs describe v2.**

## Final: review, then the last status update
The sweep-wide review of the merged work (correctness, parity, contracts, proofs) ran at `a0e705e`; its findings are applied
in the records (docs/sweep/README.md corrections, docs/CONTRACTS.md, docs/MIGRATION.md) and in H-server/H-sim. What remains:
review H-sim and P10c, merge them, rerun every gate and the cumulative perfproof, and update the checkpoint in
docs/MIGRATION.md and the status table in docs/CONTRACTS.md (P10c turns "C-NET v3 Accepted, Not run" into a validated v3).
