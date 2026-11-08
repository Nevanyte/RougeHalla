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
| Prepare Unity 2D Demo / `codex/unity-art-direction` | Owner-approved 2D art, presentation, HUD/accessibility, quality tiers and audio | No game rules; approved MatchClient projection/Fx forwarding and visibility refresh/reset, with safe listener teardown; browser/performance proof before admission |
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

## Active private write leases

These are assignments/candidates, not admitted main behaviour. [ADR0022](adr/0022-barrier-wish-publication.md) reserves
protocol12/Observation18 privately; main remains11/17. Existing candidate checkpoint25/replay19 will be composed once.

| Worker | Current packet / branch | Exclusive boundary |
|---|---|---|
| DeepSeek Rust / G6 worker | [P-G6](coordination/P-G6-HEAL-BARRIER-NATIVE.md), `deepseek/p-g6-heal-barrier` from `febf1f3f` | Heal/barrier candidate b50871d1 is held for [caller repair](coordination/P-G6-CALLER-REPAIR.md); checkpoint/state/hash/format/tapes stay leased |
| DeepSeek Rust / second worker | [Frost resistance](coordination/P-FROST-RESISTANCE-1.md), assigned from `37a5ac30` | Frost player slow-resistance, dedicated source/native tests only; no G6/content/format files or PvE expansion |
| DeepSeek Post Rust | Barrier-view source `70a6790c` admitted in `33d72c34`; next [Wish public witness](coordination/P-WISH-PUBLIC-WITNESS-1.md) | Source evidence only; no native/codec/Unity changes |
| Native observation specialist | Private production `ec9a9028`, source consumer `bbb7b012` | Production complete/reviewed; observe/item_view/wire lease handed to networking; remaining G6/transport/client proof held |
| Networking chat | [P-NET-12-WISH-BARRIER](coordination/P-NET-12-WISH-BARRIER.md), `codex/wish-barrier-net12` from `5e9f2ac1` | PhaseA protocol/C#/JS/session/clock now; observe/wire PhaseB waits for specialist handover, and restore/hash/formats/tapes separately wait for G6 handover/root release |
| Art chat | Source batch admitted through `f16bca0d`; Editor held idle | No repeated campaigns; HUD/confirmed-cue/barrier renderer packet follows stable delivered C# API |

The lead sequences shared files, retains current guards and owns final identity/tape composition. Native source-born
Frost/Sentenced NPC signature prerequisites remain genuine pending work; removing the current gate is not a port.

## Current priorities

1. Preserve the consolidated Git checkpoint, active workers and recovery refs. The full Rust foundation workflow at
   `01b14dca` passes Rust, simulation, C# and card-runtime source jobs; new changes retain revision-scoped validation.
2. Complete native gameplay/parity/headless acceptance. The bot Knowledge repair is admitted; approve a concrete fair
   observation design before memory/strategy/tactics work. The repaired learning store is integrated and defaults Off.
   Bot fill/configuration through `43abe070` and the reviewed A–C continuation are integrated in `fdf65513`. The bounded
   tournament/shape candidate plus admission repair `c9bdf0d8` is integrated in `8ce725db`; full recorder/brain remains
   incomplete. The [G6 native packet](coordination/P-G6-HEAL-BARRIER-NATIVE.md) is assigned as a private candidate with
   public activation held; do not duplicate it. The independent Frost-resistance repair corrects an actual missing
   Iron Will interaction without widening NPC admission.
3. Close the missing public transports and source consumers: full Wish input/owner facts, Kill/Trophy options,
   quest/trade flows and the remaining public facts/cues. Inventory exact native prerequisites before assigning each
   packet. The checked barrier/Wish contract and active codec PhaseA are defined in ADR0022 and the leases above.
   Reconcile incompatible identities and all three codecs centrally. Native fixtures alone do not prove the UI.
4. The functional Unity art follow-up through `55825c10` is integrated in `46ceebba`. The
   [bounded repair](coordination/ART_LIGHTING_READABILITY_REPAIR.md) passes its source, 27-test Editor, exact-build
   19-outcome browser, normal-input and static color-vision checks. Three High GPU windows pass the 6.944 ms p99
   diagnostic limit. Retain the owner’s at-least-144-FPS target at2560×1440 on the M5 Pro; the current60Hz physical
   display cannot certify it. Allocation throughput, full live content and crowded-motion accessibility remain open.
   Camp-stock source/Editor follow-up `289a01e2` is integrated in `ecf9564c`, with Web verification deferred. The
   delivered prop/signature cues and no-socket action/eight-direction preview selector are integrated through `f16bca0d`.
   Their exact source passes Unity compile and42 Editor tests; root verifies raw hashes and byte-identical client trees.
   Browser/runtime/readability/cost checks remain deferred to the next client/public-flow batch. Audio research stays
   unadmitted. Callback/headroom rates remain separate from displayed frames.
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
  The [admission review](coordination/FAIR_OBSERVATION_ADMISSION_REVIEW.md) rejects its blanket wire-unchanged premise;
  public counters, exact fields/event timing and allocation need evidence and a shared human transport decision.
  The corrected partial [perception evidence](evidence/percept-witness/README.md) is integrated in `b0310e73`; genuine
  lifecycle, committed prepared carry and visibility-time equivalence remain unproved. Observation17 cannot be
  reassigned. Post Rust's next evidence-only packet is [barrier views](coordination/P-BARRIER-VIEW-WITNESS-1.md),
  distinct from the private G6 producer. No new publication or precision change is approved by those captures.
- `75eaa42e` learning prefix is integrated with the independently reviewed repair in `3619280f`: explicit opt-in,
  exclusive lease on the actual PostgreSQL I/O session, sticky detected-loss behavior and bounded shutdown. Runtime
  insertion-order/source-sorted restart and per-arrival bias are checked. Default remains Off; do not enable alongside
  old noncooperating writers. Only managed-faction learning is connected. See [scope/evidence](evidence/stage2-bots-5/README.md).
- The fill/configuration continuation and [exact trim repair](coordination/BOT_TRIM_REPAIR.md) are integrated in
  `43abe070`, preserving explicit learning activation and conditional profile-name startup lookup. The
  tournament CLI/timer/write-error prefix through `2b9212c1` is integrated in `cc2cbb69` after 13 focused tests, including
  a flush-only failure control. The composed runner is integrated in `8ce725db` with the bounded admission repairs;
  full manager/outcome/recorder parity stays open.
- `570dee45` repairs the measured-RTT packet’s compulsory Pong budget and is integrated. This is command-time admission
  clamping: held attacks retain the source press-time lag until a new Attack/Release. It does not introduce a dynamic
  per-swing rule or certify input-to-photon latency. The [Pong repair packet](coordination/PONG_REPAIR.md) records its gate.
- The art branch is admitted through camp-stock `289a01e2` and the scoped source-cue/preview batch through `f16bca0d`.
  The latter is source/Editor validated only; the served artifact is unchanged. See its [admission](art/evidence/source-cues/ADMISSION.md).
  Later art work and remaining native candidate/fixture branches stay isolated until their
  reports and focused reviews pass. Preserve their active checkouts and refs.

## Completion evidence

The original five full-port gates remain open in the [requirements audit](evidence/stage2-scope-audit/README.md).
Completion needs the actual full gameplay/input/observation paths, strict source parity and restore/replay/headless
checks; complete browser/account/result/reconnect flows; durable cloud state and provider lifecycle; comparable legacy
and Rust+Unity workloads with frame, tick, memory, bandwidth and latency measurements; and a reviewable release with
rollback, bounded costs and required licenses. No ML training/models/datasets/inference are authorized.

The [migration checkpoint](MIGRATION.md) is the accepted state. Archived [owner prompts](agent-prompts/README.md), packet
completion claims, branch names and historical benchmark numbers do not supersede it or independently authorize work.
