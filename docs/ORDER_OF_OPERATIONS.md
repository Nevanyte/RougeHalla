# Roguehalla Port — Order of Operations

Written 2026-11-07 from the review session of MIGRATION.md, REQUIREMENTS.md, CONTRACTS.md, the backlog, ADR 0009 and
GAME_DESIGN.md. Edited the same day against the repo (changes listed in section 6). This is the plan every packet and
operation follows from now on, by owner direction. Where an item says "owner action," only the owner can do it; "worker"
means delegable under the existing packet rules; "coordinator" follows `CLAUDE.md` (only the coordinator edits shared
status records and `Cargo.lock`).

**Status of this document.** Adopted by the owner on 2026-11-07. Decisions D1–D8 below are **not yet recorded as ADRs**
(Phase 0, item 4) and three of them conflict with existing accepted records (section 5). Until those are resolved,
where this file and an Accepted ADR/contract disagree, the ADR/contract still governs and the worker flags the conflict
instead of choosing.

---

## 0. Decisions taken (to be recorded as ADRs 0021 onward)

| # | Decision | Reason |
|---|---|---|
| D1 | **Outcome-class parity replaces byte-exact parity as the acceptance standard for remaining mechanics.** Existing byte-exact captures stay green. Byte-exact remains required for RNG-order-sensitive logic, the credit/GV economy and anything feeding determinism. Everything else (damage tuning, presentation, timing feel) is accepted through the balance harness and scenario-level parity with declared bands. | The game is young and its design is still moving; reproducing numbers that may be redesigned in 2027 is wasted rigor. Gates stay binary: "rough 1:1" is a verdict from a machine-checkable harness, never a judgment call. |
| D2 | **P-BALANCE-1 (Rust duel/edge/TTK harness over `rh-headless`) is the acceptance gate for "rough 1:1,"** and a balance-affecting `DEVIATIONS.md` entry cannot be marked re-validated until it exists. Escape valve: the owner may sign an entry as "unvalidated, accepted as risk." | The legacy balance work (edge bars, winner HP) has no Rust-side enforcement. Without the harness a declared deviation is an unverifiable balance change. |
| D3 | **GameLift is deferred. Hosting is staged:** one cheap always-on host (t4g.small-class EC2 or VPS, about CAD 23/month) for playtests and early players. GameLift returns when concurrent players justify a floor of about CAD 99–190/month. CAD 20 is re-labelled a *test* budget, not a production budget. | At 4–50 players the GameLift floor is cost with nothing to scale. Legacy Cloudflare has cost about USD 1 in total so far; that is the number to beat. Prices: GameLift and ca-central-1 rates from `docs/hosting/COST.md` (read 2026-11-05); t4g.small from memory, unverified. |
| D4 | **One writable PostgreSQL primary, colocated with the game host** (ca-central-1/Calgary, or us-west-2 if the players are there). Cross-region admission RTT (about 60–80 ms, once per admission) is accepted. A primary outage idles all regions and is accepted at this scale. Revisit when players outside the region exist. | Multi-region persistence buys nothing at prototype concurrency and costs real complexity. |
| D5 | **Design freeze with a tripwire: M-full-loop by 2027-01-02** (8 weeks from 2026-11-07). M-full-loop = a Unity browser match with mobs, camps, the full card pool and bots, end to end (checklist in section 5). If the date is missed, the freeze ends and queued design work (variable quests, usable quest items) ships on legacy while the port continues. | A freeze without a date becomes permanent quietly. The date is a judgment, not derived from per-packet data (see Phase 2, item 12a). |
| D6 | **Disconnect observability is a requirement.** The new stack classifies and logs every disconnect: which side closed, which code, which timeout, recent RTT. Every staging playtest ends with a review of that log. | The legacy disconnects were never root-caused (cause assumed, unproven, to be the cheap Cloudflare host). The port's main player-facing justification is currently an assumption; the log decides, in one line, whether a recurrence is server code, hosting or client. |
| D7 | **Unity WebGL weak-hardware verification is a pre-release gate**, run when a weak machine is available. The band: beat the legacy Phaser client on the same hardware (P-LOAD-3 comparator), with absolute backstops of p99 frame time ≤ 16.7 ms at 960×600, browser tab ≤ 1.5 GB, time-to-playable ≤ 10 s on a 20 Mbit/s link, on the weakest machine the owner can physically borrow. **Numbers plus a named machine; the band is ratified before the test runs.** | All current frame data is from an M5 Pro with 2–6 actors; the 204-fighter run was a decode/render replay. The client is the least-proven layer. A server or throttled run is a proxy and does not satisfy this gate. |
| D8 | **The Rust layer is kept, justified as deterministic, dense and agent-verifiable, not merely "fast."** Unity was a forced move (artist pipeline: Unity or Unreal; Unity chosen). Unity-only is rejected on: the existing proven playable core, the headless determinism substrate (ML and agent gates) and hosting density. The triple-codec tax (Rust/C#/JS) is accepted as permanent. | Records the reasoning so later re-litigation starts from facts. |

Also settled: `DEVIATIONS.md` is live with 8 seeded rows; the backlog table is coordinator-owned (the P-BALANCE-1 row
lands only on coordinator confirmation); and a cross-cutting rule — **a packet whose behaviour intentionally differs from
legacy adds a `DEVIATIONS.md` row in its hand-off.**

---

## 1. Where the port stands (2026-11-07)

- **Playable core: done and proven.** The Unity browser build completed a full match loop against the Rust server over
  public HTTPS/WSS at rougehalla.com on 2026-11-06 (combat, mobs, chest choice, results, reconnect). The Calgary staging
  was torn down and cleanup verified at 13:03 UTC the same day.
- **Parity:** 97 compared scenarios and 300 path queries match; 13 capture-only scenarios have not been audited for
  balance relevance.
- **Remaining:** about 60 of 95 backlog rows are Coarse. The hard remainder is full mobs (P-MOBS-1), full cards
  (P-CARDS-1/2/3), bots (P-BOTS-1..7), quests/traders, the Unity UI layer and hosting.
- **Known defects carried knowingly:** one terrain case with an exact reward-card mismatch; capture-only scenarios; the
  unexplained legacy disconnects (D6 covers the new stack).
- **Unmeasured:** Unity on weak hardware, the browser matrix, any Phaser baseline in comparable terms (see D7 note in
  section 6).
- **Branch state:** `optimization_port` is the implementation branch; `kimi/unity-readiness` carries the Unity readiness
  ledger. Uncommitted at the time of writing: `DEVIATIONS.md`, the P-BALANCE-1 packet draft, its backlog row, this file,
  plus the owner's untracked prompt files and `context_copy/`.

---

## 2. The order of operations

Principle: **sequence by falsification cost, not by dependency convenience.** Cheap items that can kill the project go
first even while the long mechanic grind runs under the workers. Phases overlap; they are ordered by when they *start*.

### Phase 0 — Owner ratifications (this week; hours, not days)

1. **Sign the 8 seeded `DEVIATIONS.md` rows** (owner action). An unsigned ledger is a suggestion box. DEV-008 is a
   placeholder: confirm or delete it.
2. **Coordinator-confirm the P-BALANCE-1 backlog row.** It is a shared status record.
3. **Commit the ledger, the packet, the row and this file.** Add the untracked prompt files
   (`[1-6]_*_Prompt.md`, `5_Codex_Rust_Handoff_To_DeepSeek.md`) and `context_copy/` to `.gitignore` (or move them out of
   the repo) before an agent commits them into history.
4. **Record D1–D8 as ADRs** (short; the table above is the draft) and resolve the three conflicts in section 5.
5. **Add the two cross-cutting rules** to the record: the `DEVIATIONS.md` hand-off rule, and the D6 disconnect
   classification requirement (R-PROC or a new R-OBS line in `REQUIREMENTS.md`), enforced by the playtest checklist.
6. **Ratify the D7 band** (numbers and the machine's name) before any run, so the test is a verdict.

### Phase 1 — Falsifiers (weeks 1–2; parallel with Phase 2; owner plus one worker)

7. **Disconnect root-cause note** (owner, from playtest memory and any legacy telemetry): two or three named candidate
   causes, each mapped to the mechanism in the new stack that removes it. A cause that maps to "unknown" is said so in
   the ADR; D6 logging then carries the burden. No deep legacy archaeology: fifteen honest sentences.
8. **Hosting ADR (D3/D4)** with real numbers: Cloudflare about USD 1 to date; t4g.small about CAD 23/month; GameLift one
   location about CAD 99/month, two about CAD 190. **Fix the egress estimate:** the Rust slice's 4.87 KB/s worst case
   has no mobs; the legacy bench with about 204 mobs measures 11.18 KB/s typical and 15.17 KB/s heavy
   (`docs/MIGRATION.md` lines 590–592). State the player count that revives GameLift.
9. **Phaser client baseline** (P-LOAD-3 first cut, worker): measure the legacy client on the same M5 Pro and, later, the
   weak machine, with matched content, actor count, resolution and browser. Cheap and local. This replaces any recalled
   figure (see section 6).
10. **Line up the weak machine** (owner action). Borrow the oldest laptop available. The D7 test runs the day it arrives.
    Until then it is a scheduled pre-release gate, not a forgotten one.

### Phase 2 — The acceptance gate and the critical path (weeks 1–6; workers, coordinator-reviewed)

11. **P-BALANCE-1 first.** It is the definition of done for D1. Before pickup, fix these review findings in the packet:
    - Reconcile the verdict rule with GAME_DESIGN's stated bar (about 55–75% pooled, none under 50%, line 572) rather
      than the legacy `verdictOf` constants alone (≥ 0.6 pooled / ≥ 0.5 per faction and reply, no ceiling). Port the
      stated bar or record why the ceiling is dropped.
    - The cell-by-cell legacy comparison uses the legacy method (noise off, fixed setups). Noisy policy-matrix runs are
      threshold-only, with sample sizes stated. Win rates are samples, not scalars.
    - Verify the actual integrated scope against the `Ported` rows in `crates/rh-sim/src/schedule.rs` and scope the first
      cut honestly (minute 0, no cards, only factions whose modes are on). The minute-5 kit columns wait for P-CARDS-2.
12. **The 13-scenario capture-only audit** (worker, one sitting): list each with a "balance-significant y/n" column. Any
    "yes" becomes a capture effort or a signed ledger entry.
    **12a. Re-estimate once** (workers, then the owner): after items 11–12 land, estimate remaining critical-path
    packets from the first two weeks' measured throughput, then the owner confirms or moves the D5 date in writing.
    Moving it later is allowed once, with the reason recorded. The date does not drift silently.
13. **Then the critical path in dependency order:** P-MOBS-1 stages, P-CARDS-1 runtime, P-CARDS-2/3, P-ABIL-1 and
    P-ARENA-1 completion (their INCOMPLETE items), P-QUEST-1 and P-TRADE-1, P-CONS-1. Mobs first because cards-2/3,
    consumables, quests and terrain completion hang off the mob runtime; cards next because the minute-5 harness columns
    and the chest loop hang off cards.
14. **Every mechanic packet runs under the new standard:** byte-exact capture only where D1 requires it; otherwise
    harness verdicts, scenario parity and the ledger rule. Evidence dossiers shrink to a standard template: evidence
    exists to diagnose failures, not to decorate successes.

### Phase 3 — The client (weeks 4–8, overlapping)

15. **P-BOTS-1 and the bot wave** once mechanics give policies something to see. Bots are the M-full-loop opponent and
    the future ML seat, so this is on the milestone's critical path.
16. **Unity UI packets** (P-UI-1..5 as needed for M-full-loop; the rest after), then **P-UNITY-PERF-1 resumed.** The
    archived instancing patch is untested: finish and measure it, or delete it.
17. **D7 gate when the weak machine exists:** worst-case scene (8 players, about 160 mobs, projectiles, particles) at
    960×600 against the band, plus the browser matrix (current Chrome, Edge, Firefox, Safari). Failure here is a
    project-level event: it reopens the visual bar, not just a packet. (The worst-case scene does not exist yet; building
    it is part of this item.)

### Phase 4 — Hosting for real (after M-full-loop; spend against the re-labelled test budget)

18. **Cheap always-on host** (the Calgary-style recipe without the teardown): one t4g.small-class instance, real TLS and
    DNS on the practice domain, the D6 log reviewed after every playtest. Needs an ADR superseding ADR 0020's
    "temporary" framing.
19. **P-PLACEMENT-3** (authenticated placement API, real adapters) before anything public-facing; P-HOST-2/3 as needed.
20. **Load testing scaled to the budget:** R-LOAD-2's 200-match scenario stays unfunded under CAD 20; say so in the
    hosting ADR. Run the scaled-down version (room counts from the density bench on the real instance) and publish the
    monthly-floor number it produces.

### Phase 5 — Cutover (only when Phases 2–4 hold)

21. **P-MIG-1..4:** profile export rehearsal, the callsign case-collision ruling (still open), staged rollout, legacy
    retirement, and only then the full-port completion gates from the requirements audit.

---

## 3. Operating rules going forward

**Per-operation checklist.** Every packet, brief and hand-off states, before work starts and again at hand-off:

1. Which phase and item of this file it serves (or "not in the plan: owner approval needed").
2. Whether it touches a D-rule: D1 (parity standard used), D2 (harness verdict attached or "not applicable"),
   D5 (inside the freeze: no new design), D6 (disconnect classification kept intact).
3. Any intentional difference from legacy has a `DEVIATIONS.md` row, with reversibility and re-validation filled in.
4. Shared status records (MIGRATION checkpoint, CONTRACTS table, backlog table, `Cargo.lock`) are left for the
   coordinator; the hand-off lists the proposed edits.
5. Evidence follows the standard template and says what it does **not** establish.

**Rules.**

- **Gates stay binary.** "Rough 1:1" changes what is measured, never whether it is measured. A worker proposing a softer
  check proposes a ledger row or a harness change, not a skipped test.
- **The freeze is real until 2027-01-02** (or the single recorded move in 12a). Design ideas go in the queue. If the
  tripwire fires, the freeze ends by rule, not by guilt.
- **Coordinator throughput is the bottleneck: measure it.** Track hours per merged packet for the next month. If the
  number is bad, the fix is fewer parallel workers with bigger packets, not more workers.
- **Perfection budget goes to seams, not mechanics.** The schedule, hooks, input seam, content registry, observation
  rules and wire envelope are frozen and mutation-tested. A mediocre mechanic file is one file.
- **Effort goes where the cost is.** Sim micro-optimization is done. The remaining cost levers are packing density and
  the socket layer (P-NET-7 evidence exists; decide it when hosting is real) and the client on weak hardware.

---

## 4. Risk register (in order)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Scope exhaustion across about 60 Coarse packets | High | Schedule | D1 de-scoping, D5 tripwire and 12a re-estimate, coordinator metrics |
| Unity WebGL misses the band on weak hardware | Unknown (unmeasured) | Project-level | D7 gate before release; the visual bar is the lever, not the engine |
| Legacy disconnect cause survives the port | Unknown | High | D6 classification logging from the first staging playtest; Phase 1 item 7 note |
| Balance drift through unvalidated deviations | Medium | Silent | D2: the harness gates the ledger |
| Coordinator single point of failure | Structural | Throughput | Section 3 rule: bigger packets, fewer lanes; hours-per-packet metric |
| Hosting cost creep past CAD 20 | Medium | Low dollars, real habit | D3 relabels the cap as a test budget; floors reviewed before every cloud experiment |
| Triple-codec maintenance (Rust/C#/JS) grows | Certain | Chronic | Accepted under D8; the JS mirror is CI infrastructure, Unity is the only player client |

---

## 5. Conflicts with existing records, and the M-full-loop checklist

**Conflicts to resolve in Phase 0, item 4** (the existing record governs until then):

- **D1 vs `CLAUDE.md` non-negotiables and C-PARITY.** `CLAUDE.md` says every ported mechanic ships with captured legacy
  fixtures and a parity test, and C-PARITY is "Accepted, FROZEN" in `CONTRACTS.md`. D1 narrows that. It needs an ADR
  and a matching edit to `CLAUDE.md` and C-PARITY before a worker may skip a capture.
- **D3 vs ADR 0004** ("GameLift managed containers + queues first", Provisional): supersede it, and keep ADR 0020's
  single-host staging as the working default.
- **D4 vs C-PERSIST / R-AWS-2** (latency-aware regional placement): record that regional placement is deferred.

**M-full-loop acceptance checklist (tripwire milestone, 2027-01-02):**

- [ ] One Unity browser match: 8 seats, bots filling, mobs and camps live, full 80-card pool in chests, Wishes castable,
      coliseum and sudden death fire, results bank to PostgreSQL.
- [ ] P-BALANCE-1 green: every ported weapon edge within the design bar; skipped-cells report empty for minute-0 scope;
      minute-5 scope listed with its blocking mechanics.
- [ ] `DEVIATIONS.md`: every row signed; every balance-affecting row harness-validated or explicitly accepted as risk.
- [ ] Parity: compared scenarios still MATCH; capture-only audit done with dispositions.
- [ ] Disconnect log from the milestone playtest reviewed; every disconnect has a classified reason.
- [ ] D7 band: passed on the weak machine, or the release bar explicitly reset by the owner with the measurement attached.

If the boxes are green on 2027-01-02, the freeze lifts on schedule and queued design work goes Rust-first. If not, the
freeze lifts anyway and legacy gets the quests; that is the deal that makes the freeze safe to hold.

---

## 6. Review notes (what changed from the draft, and what is unverified)

Changes made against the repo on 2026-11-07:

1. **Date fixed.** The draft said the tripwire is 2026-01-02, "8 weeks from 2026-11-07." Eight weeks after 2026-11-07 is
   **2027-01-02**; every instance is corrected.
2. **"Legacy reference ≈ 30 FPS" removed from D7.** The repo does not support it. `docs/legacy/CLAUDE_LEGACY.md`
   records the Phaser client at 144 fps (p99 8.6 ms) in Chrome on a 144 Hz window with 8 players and 30–45 mobs, on the
   developer's Mac. A 30 FPS figure on old hardware may be remembered from a playtest, but it is unmeasured here. D7
   now relies on the P-LOAD-3 measurement (Phase 1, item 9).
3. **Egress claim sourced** to `docs/MIGRATION.md` lines 590–592 (4.87 KB/s slice worst case, no mobs; 11.18 / 15.17
   KB/s typical/heavy with about 204 mobs).
4. **P-BALANCE-1 finding sourced:** GAME_DESIGN line 572 states a 55–75% pooled target with none under 50%, so a ceiling
   does exist; the legacy `verdictOf` code has none.
5. **Conflicts with Accepted records added** (section 5), which the draft did not mention.
6. **Item 12a added:** a one-time re-estimate and owner confirmation, so the 8-week date is not a guess carried
   forward unexamined.
7. **Per-operation checklist added** (section 3), so "each operation follows this plan" is checkable.
8. **Cross-references fixed** (the draft pointed at "Phase 3 rule" and "D1-Phase-1" that did not exist), and D7 now
   states that a throttled or server run does not satisfy the gate.

Unverified in this file: the t4g.small price (from memory); the 8-week estimate (judgment); whether the bots, UI and
host packets fit in the weeks given; the hours-per-packet baseline (no data yet).
