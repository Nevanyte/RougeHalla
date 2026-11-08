# P-BOTS-3: the brain path service, away-point tactics and the Wish slip goal

Stacked PR: [#53](https://github.com/Nevanyte/RougeHalla/pull/53), deepseek/p-bots-3 -> deepseek/p-bots-2 @ 8dbc1e67;
commits 8dbc1e67..1a88e864. No wire/protocol change (protocol 7), no dependency or Cargo.lock change.

Status: DONE-VERIFIED slice; P-BOTS-3 remains INCOMPLETE at packet level (exact remainder below). No packet file exists:
scope derived from the backlog row (line 159: planning/chest/hazard modules, chestHunt; deps P-ARENA-1, P-CARDS-2, P-TERRAIN-1,
P-BOTS-1), the P-BOTS-2 evidence remainder (the Swarm slip goal blocked on the services path + module-goal/strategy layers) and
docs/BOTS.md 4/8.

## Delivered

- bot paths (crates/rh-policy/src/bots/paths.rs): the room path service of brain/services.ts: shared per-tick budget (8),
  1 s cache keyed on 8 u-rounded endpoints and the gate flag, 8 s stale answer, 20 s keep with the 4 s prune sweep, walk
  (over budget: straight line x1.3, exact false), path, sight (walls only) and clear (move mask + player radius) queries,
  and the search/hit/fallback counters, over rh-sim's exact-port legacy A*.
- away-point (bots/kite.rs): tactics/kite.ts awayPoint with the source TURNS and LENGTHS orders (never more than 60 degrees
  off; a shortened step when the full one is not clear).
- The Wish slip goal (wish.rs + bot.rs): slip state machine (armed at a hiding cast, the server casting bit, slip-pending and
  grace windows, stored threat point and leg) and slip intent (cast first, then the reflex move away reusing the leg for
  1200 ms or re-choosing through the path service); HumanBot owns the room path service (budget started per decision, frame
  from the percept) and, while the module slip goal holds, offers only the module intents: the bot walks away and locks
  nobody (legacy strategy scores this module goal 1.4 above a flee at 1.1 and it attacks nobody).
- Fixtures: tools/brain-tactics-fixtures/ captures the unmodified services and awayPoint in the pinned container (source-closure
  hashes, --check mode; 87 steps incl. frames, cache/stale/over-budget/budget-spent, pathing, sight/clear, invalid and
  unreachable inputs, away cases incl. walls) into parity/policy/bot-tactics.json; the Rust parity test replays every step
  (answers, counters, budget left, away points). Mutants: 3/3 killed with the unchanged control.
- Tests: rh-policy 32 (bot-core 17 + wish 5 + wish module 8 incl. the hidden slip: a move away and no Target/Attack +
  paths parity 1 + ...); the policy-seat slip test pins the new behavior.

## Verification

- Git: 8dbc1e67..1a88e864. 
- - cargo test --workspace --all-features --locked: **1,461 passed, 0 failed, 3 ignored, 152 test binaries, exit 0**.
- cargo clippy --workspace --all-targets --all-features --locked -- -D warnings: clean, exit 0; cargo fmt --all -- --check: clean.
- tools/brain-tactics-fixtures/capture.sh --check: byte-identical; run-mutants.sh: **3/3 mutants killed; unchanged control passes**.
- rh-policy 32 tests (17 bot-core + 5 wish parity + 8 wish module incl. the hidden slip + the path-service/away parity).

## Exact remainder for P-BOTS-3

1. The feature modules themselves (brain/modules/planning.ts, chests.ts, hazards.ts) with their hooks, and chestHunt.ts
   (chest routes): they need the full BrainContext/memory/strategy goal machinery this slice only begins (module goals and the
   slip consumers are in; chest/plan/loot/hold goals are not).
2. The full strategy.ts scoring/threat layer and tactics/{fight,world} (P-BOTS-1/P-BOTS-4 remainder), which the modules call.
3. Full fair perception (the P-BOTS-1 remainder) remains the input side of both.

This slice reads only Observation plus public static content, submits only PublicCommand on the validated path, and keeps the
seats deterministic; its P-BOTS-2 remainder item (the Swarm slip goal) is now delivered.
