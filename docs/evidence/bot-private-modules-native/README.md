# P-BOT-MODULES-1 native candidate (private modules layer)

Status: **complete native implementation, frozen-source replay green; awaiting Root/independent native admission.** This is
not live/headless activation, not a public Brain composition and not an admission claim.

- Worktree/branch: `backend-bot-modules` / `codex/deepseek-private-modules`
- Base: `9f74ff3e` ("Record morning release window and continue backend module work"), clean at dispatch = admitted
  backend `dedb8658` + Root dispatch.
- Authority: P-BOT-MODULES-1 (frozen source `rh-bot-private-modules-source/1` at
  `parity/policy/bot-private-modules/source.json`, 12,755,158 B, SHA-256 `645e85f1…b012`, 255 cases / 3,259
  operations), independent source review `63f6fda8`, and Root's corrected bridge lease committed at `de908f2b`
  (`docs/backlog/packets/P-BOT-MODULES-1.md` § "Root corrected bridge allocation" +
  `docs/evidence/bot-module-bridge-review/README.md`).
- Rust lane: DeepSeek (all Rust/tests/probes authored here); Root owns admission/status/integration; Sol/Luna own
  source/review; no Claude/network/client lane contacted.

## Delivered behavior

The complete unchanged legacy built-ins — `brain/modules/{wishes,planning,chests,hazards}.ts`, the genuinely missing
`bots/chestHunt.ts`/`bots/abilityPolicy.ts` chest dependencies, the complete chest card-choice leaves and the ordered
registry — as a **new private layer** under `crates/rh-policy/src/bots/temporal_percept/modules/**` (plus the Root-leased
shared transition cores `bots/planning.rs`, `bots/wish.rs`+`bots/wish/source_core.rs`,
`bots/hazards.rs`+`bots/hazards/source_core.rs`):

- full ordered hook/context contract (optional `enabled/observe/goals/intents/act/adjust` with true hook presence),
  ordered registry (wishes→planning→chests→hazards, equal-id replacement keeps position, reset clears registry and
  cast-policy slot, Wishes never reads the registered policy), cfg-object-identity state (`CfgToken`) for two
  interleaved bots, no implicit phase/death/teleport reset;
- complete card choice (`costsSomething`, `activeWeapon`, `cardScore`/`optionScore`, `chooseOption`) over the admitted
  static catalog/kill/boost format leaves, arbitrary unknown ids score 0, no catalog mutation;
- complete `ChestHunter` (hold/pick/walk/expiry/ETA/fight/reach, stalls/capped walk time, 250 ms walk cache incl null,
  give-up logging/counters, distinct `now`/`serverTime` clocks) and complete chests module (per-cfg retained hunter,
  delayed build merge/counted, panel close, ask retry/4000 window/max 3, BLIND far cards, goals temporary hunter vs
  retained act hunter, source statuses/reasons);
- complete planning module (ordered raw private events, first-deal schedule at `event.t`, raw binary64 deal fields,
  read/settle/last-call windows, no-deal, three asks with `reaction.mu`, full learned-bias callback + softmax/lapse);
- complete Wishes module (declared opaque ability-def guard, f64 rank floor/clamp, full tag/blockedBy/targeting/effect
  policy, ordered CAST_STIMULI timing, Easy remember draw, retry, actual-Memory lastCast slip armed/pending2500/cast+700,
  from/leg partial retention, real collision/open maps and gate flag for blink landing, node ordering, unknown-mode
  failed, source done reasons);
- complete hazards module (source faction-string classification with no fake faction, stable dy/dx + nearest-tile
  search/order, held step before map callback, 1500/20/600/250 boundaries, light only for the source cases, real
  collisionMap/clear callback timing, phase-independent adjust with unchanged-list identity and ordered redirects).

## Gates (exact commands/receipts in [RUNS.md](RUNS.md))

| Gate | Result |
|---|---|
| Frozen source replay (all suites, exact) | **255 cases / 3,259 operations / 0 failures** |
| Whole `cargo test -p rh-policy --lib` suite | 351 passed / 0 failed (see RUNS for final count) |
| Strict atomic-reader negatives | 24/24 rejected atomically (matches verify.mjs `readerControls`) |
| Bounded semantic controls | 28 native controls green; 13/26 source KILL ids mapped here, remaining 13 covered by owner-module witnesses + replay (mapped in [CONTROLS.md](CONTROLS.md)) |
| Old shared-engine overlaps | planning_parity 6/6, wish_parity 6/6, wish_module 8/8, old hazards 4/4, bot hand 17/17, Memory source 13/13, Strategy source, parity/knowledge/paths/view/mob-hunt filters — all unchanged (see [OVERLAPS.md](OVERLAPS.md)) |
| `cargo fmt -p rh-policy -- --check` | clean |
| `cargo clippy -p rh-policy --lib --tests [--all-features] -- -D warnings` | clean |
| Numeric policy | exact-only; no tolerance applied or requested (see [NUMERICS.md](NUMERICS.md)) |

## Evidence map

- [REPLAY.md](REPLAY.md) — what the 255/3,259 replay compares and how (fresh instances, cfg identity, callbacks).
- [CONTROLS.md](CONTROLS.md) — intake negatives + bounded semantic controls + KILL-id coverage map.
- [OVERLAPS.md](OVERLAPS.md) — unchanged public/shared fixtures and exact filters/counts.
- [NUMERICS.md](NUMERICS.md) — exact comparison policy, sentinels, clocks, no tolerance.
- [BRIDGES.md](BRIDGES.md) — Root-leased shared-engine hunks actually applied, legacy adapters, incompatibilities,
  no surviving mirrors; no rh-sim/types.rs/public-observation edits.
- [SEND-COMPAT.md](SEND-COMPAT.md) — Root pre-seal `Send` compatibility correction (Arc persistent callbacks).
- [LEDGER.md](LEDGER.md) — reached behavior ledger: contract → concrete case/op/callback witnesses.
- [RUNS.md](RUNS.md) — every command, exit, count, toolchain, target dir, env.
- [CANDIDATE.md](CANDIDATE.md) — the sealed scoped commit and file inventory.
- [bridge-proposal.md](bridge-proposal.md) — the original proposal (revision 2) and Root corrections folded in.
- [LEASES-ACK.md](LEASES-ACK.md) — written acknowledgement of the corrected lease before implementation.

## Explicit scope limits

No World/Sim/observation/protocol/server/headless/client edits, no live activation, no public Bot/Brain rewrite, no
createBrain composition/cadence/hand-feature/sequence/stats/end, no fair publication/earned observations, no ML/datasets/
learning store, no new dependencies or Cargo.lock change, no source/golden/tool/corpus edits, no Tactics WIP import/edit.
The module layer emits source intents/statuses only; it never schedules, stamps, scatters or submits. Full Brain
composition, fair intake/live use and client/network work remain the named later packets (B1/F0/F1).
