# Project coordination

Owner direction, November 8, 2026: the **OPTimization_port Codex chat is project lead** and owns integration into
`optimization_port`. The other two Codex chats and both DeepSeek sessions report completed SHAs, checks, active write
scopes, blockers and their next bounded packet to the lead. Reports are evidence for review, not automatic admission.
The owner asked to keep workers running and leave active branches until last during consolidation.

The primary project checkout is the write location for `optimization_port`. The earlier managed checkout is a clean
detached review snapshot; use `git worktree list` to resolve the authoritative path and keep future edits on the branch.

## Ownership

| Lane | Scope | Integration boundary |
|---|---|---|
| Lead: OPTimization_port | Git consolidation, architecture, protocol/privacy decisions, expert reviews, release acceptance | Sole owner of merges/pushes to `optimization_port`, shared status/contract records and `Cargo.lock` |
| Check Git access / `codex/input-latency` | Input scheduling, opt-in measurement harness, local networking/deployment diagnostics and AWS readiness | Isolated worktree; report exact candidate/artifact versions; no cloud mutations while the approved account is unavailable |
| Prepare Unity 2D Demo / `codex/unity-art-direction` | Owner-approved 2D art, presentation, HUD/accessibility, quality tiers and audio | No game rules; only the two approved MatchClient projection/Fx-forwarding hunks and safe listener teardown; browser/performance proof before admission |
| DeepSeek Rust Port Worker | Mechanical Rust ports with fixed interfaces, source fixtures, negative controls, mutants and repetitive tests | No new observation/protocol/schema or architecture decisions; proposed changes go to the lead first |
| DeepSeek Post Rust | Bounded adapter repairs and source-fixture integrity consumers | Same restriction; input scheduling/prediction belongs to the latency lane |
| Expert reviewers | Privacy/protocol reconciliation, persistence/concurrency and difficult integration repairs | Private review worktrees/patches; lead admits the result |

Private local reports are under the project tool prefix `coordination/reports/`: `codex-latency-aws.md`,
`deepseek-rust.md` and `deepseek-post-rust.md`. The art lane also reports directly to the lead chat. This directory is
operational state outside Git; accepted decisions and revision-specific evidence belong in the repository.

Each handoff names its immutable base, writable files, allowed behavior, explicit success/failure tests and remainder.
Stop at the largest verified slice. Keep unverified work isolated and report the blocker. A compile failure is not a
semantic mutant kill, and changing expected fixtures is not a parity repair. DeepSeek is preferentially assigned the
token-heavy mechanical work; the lead keeps cross-cutting design and security decisions. Use focused affected checks,
then one integration gate; do not repeat unchanged expensive map campaigns after every small patch.

## Current priorities

1. Finish the consolidated Git checkpoint and its current Rust/C#/JS checks. Preserve active workers and recovery refs.
2. Complete native gameplay/parity/headless acceptance. The bot Knowledge repair is admitted; approve a concrete fair
   observation design before memory/strategy/tactics work. The repaired learning store is integrated and defaults Off.
   Bot fill/configuration through `43abe070` and tournament timer/write-error repairs are integrated. New tournament
   telemetry work remains isolated; do not duplicate it.
3. Close the missing public transports and source consumers: full Wish input/owner facts, Kill/Trophy options,
   quest/trade flows and the remaining public facts/cues. Inventory exact native prerequisites before assigning each
   packet. Reconcile incompatible identities and all three codecs centrally. Native fixtures alone do not prove the UI.
4. The reviewed functional Unity art prefix is integrated. Complete its revision-specific browser/profile refresh and
   retain the owner’s at-least-144-FPS target at2560×1440 on the M5 Pro. The current60Hz physical display cannot certify
   that gate. Measure ceiling/headroom and report actual display pacing separately;60Hz observations do not cap the goal.
5. Complete browser/account flows, durable progression, cloud/provider/region lifecycle and the original full-port
   release/performance gates. Rebuild artifacts from the final union before any staging run. Use the practice domain
   `rougehalla.com`, Calgary preference and **CAD20 total** cap; production remains separately controlled.

These are dependency groups, not a requirement that every task run serially. Independent source tests, native leaves,
presentation and local hosting preparation can run in parallel within their write scopes. Architecture/privacy gates
must be resolved before dependent implementations; release evidence must test the admitted union.

## Held work and concrete repair gates

- The Knowledge/fair-view prefix through `13d38a41` is admitted with the independently reviewed
  [Knowledge repair](coordination/KNOWLEDGE_REPAIR.md) `fdea457b`: source-derived independent RNG, ECMAScript diagnostic
  rounding and null fallback. The docs-only observation proposal `47ffd063` is retained **without leaf approval**.
  Clarify its public-counter exception and allocation proof first; observation17 is already used and cannot be reassigned.
- `75eaa42e` learning prefix is integrated with the independently reviewed repair in `3619280f`: explicit opt-in,
  exclusive lease on the actual PostgreSQL I/O session, sticky detected-loss behavior and bounded shutdown. Runtime
  insertion-order/source-sorted restart and per-arrival bias are checked. Default remains Off; do not enable alongside
  old noncooperating writers. Only managed-faction learning is connected. See [scope/evidence](evidence/stage2-bots-5/README.md).
- The fill/configuration continuation and [exact trim repair](coordination/BOT_TRIM_REPAIR.md) are integrated in
  `43abe070`, preserving explicit learning activation and conditional profile-name startup lookup. The
  tournament CLI/timer/write-error prefix through `2b9212c1` is integrated in `cc2cbb69` after 13 focused tests, including
  a flush-only failure control. Additional tournament telemetry remains isolated and does not certify outcome parity.
- `570dee45` repairs the measured-RTT packet’s compulsory Pong budget and is integrated. This is command-time admission
  clamping: held attacks retain the source press-time lag until a new Attack/Release. It does not introduce a dynamic
  per-swing rule or certify input-to-photon latency. The [Pong repair packet](coordination/PONG_REPAIR.md) records its gate.
- The active art branch and remaining bot/fixture branches stay isolated until their reports and focused reviews pass.

## Completion evidence

The original five full-port gates remain open in the [requirements audit](evidence/stage2-scope-audit/README.md).
Completion needs the actual full gameplay/input/observation paths, strict source parity and restore/replay/headless
checks; complete browser/account/result/reconnect flows; durable cloud state and provider lifecycle; comparable legacy
and Rust+Unity workloads with frame, tick, memory, bandwidth and latency measurements; and a reviewable release with
rollback, bounded costs and required licenses. No ML training/models/datasets/inference are authorized.

The [migration checkpoint](MIGRATION.md) is the accepted state. Archived [owner prompts](agent-prompts/README.md), packet
completion claims, branch names and historical benchmark numbers do not supersede it or independently authorize work.
