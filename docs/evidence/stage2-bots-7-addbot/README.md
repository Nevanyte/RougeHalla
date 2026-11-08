# P-BOTS-7 residual (task-40): the fill bots' addBot/tournament override surface — assessment and bounded port

Lead packet: task-40 (P-BOTS-7 residual). Base: immutable db94c05b (deepseek/bot-trim-repair head) on the isolated branch
deepseek/p-bots-addbot. No root merge/push; no schema/observation/protocol/Sim-rules/Cargo.lock/shared-status change; no
learning or lease change; active worktrees preserved.

## Assessment first (source vs current Rust)

What the source override surface is:
- packages/server/src/bots/BotManager.ts:73-79: BotSeatOverrides = { tier?, persona?, faction?, name? }.
- BotManager.ts:260-288 (addBot): a lobby-only seat that draws tier, persona, faction and callsign ALWAYS, then replaces
  what the override names (over.tier ?? drawnTier, etc.); bot id botId(nextN++), seed mix(manager seed, 1000 + n);
  stats.arrived++. The comment states the invariant: every draw is made whether or not it is overridden, so fixing one
  thing never reshuffles the rest. The function returns null before any draw/id when the lobby is full or closed.
- Callers: the tournament headless room (headlessRoom.ts:50 lineup option, :137 seats each lineup entry through
  manager.addBot(over); game.ts:22-38 SeatSpec/lineup), the bandwidth bench (bench/bandwidth.ts:487 addBot({tier})), and
  one unit test (botManager.test.ts:551 addBot({persona})). The live server's fill never passes overrides
  (lobbyTick/lobbyClosing call addBot() with none).

What Rust had: crates/rh-server/src/bot_fill.rs BotFillState implements lobbyTick/lobbyClosing/yieldSeat and a private
add_bot that draws tier/persona/faction/callsign with no override surface; crates/rh-server/src/room.rs consumes only the
automatic fill (room.rs:989-993) through director.rs:789 with_bot_fill. crates/rh-headless/src/tournament.rs is a REDUCED
runner: plan_game fixes tier/persona/faction per seat (tournament.rs:123-203) and run_game builds Env AgentSpecs with
profile "bot{i}" and HumanBot(tier, persona) directly (tournament.rs:427-449), never the manager/headless-room path; its
documented deviations (no ids/callsigns/manager seeds/delay lines/humanizer, reduced GameSummary) are the P-BOTS-6
reduced-runner remainder and are tied to the blocked brain continuation.

Decision: the override plumbing itself is small and mechanical, so this lane implements the bounded prefix (source-exact
BotSeatOverrides + public addBot seam with captured actual-source tests). Product wiring is NOT invented and is reported
as the remainder below.

## Bounded prefix implemented

crates/rh-server/src/bot_fill.rs:
- New pub struct BotSeatOverrides { tier: Option<TierId>, persona: Option<PersonaId>, faction: Option<FactionId>,
  name: Option<String> } (source BotSeatOverrides 1:1).
- New pub BotFillState::add_bot(&mut self, view: &FillView, over: &BotSeatOverrides) -> Option<BotSeatSpec>: seats one
  bot now with the source draw order; every draw is made, the override replaces what it names; the faction draw uses the
  effective persona (the source passes it to pickFaction, so an overridden persona selects the learned keys); a full
  lobby returns None before any draw and without consuming an id; an explicit seat needs no human in the room (the source
  headless tournament seats an empty lobby this way); the lobby-phase check stays with the caller (Room), as for
  lobby_tick/lobby_closing.
- The private seat-drawing body was renamed draw_bot and took the overrides; lobby_tick/lobby_closing pass
  BotSeatOverrides::default(), so the automatic fill is byte-for-byte the same draw sequence (the existing captured
  fill corpus test passes unchanged; parity/policy/bot-fill.json untouched).

New actual-source corpus (parity/policy/bot-addbot.json, tools/bot-addbot-fixtures/): captured in the same pinned
linux/amd64 Node 22.23.4 container from the unchanged manager (the capture instruments the real fillRng to record draw
values and rosters per seat as attribution evidence). Five scenarios: addbot-overrides (one field fixed per seat, all
four at once, then none, in an empty lobby), addbot-draw-control (same seeds and roster with empty overrides on the same
ticks), addbot-arrivals (explicit seats first, then the arrival schedule seats only the missing ones; a yield + explicit
seat near the countdown end keeps ids shared and never reused: explicit bot~1/bot~2, drawn bot~3/bot~4, yield newest
bot~4, explicit bot~5), addbot-full-null (human + 7 explicit seats fill MAX_PLAYERS; the 8th returns null before any draw,
then yield + explicit seat takes bot~8) and addbot-name-taken (callsign override "Wren" is used literally even though a
profile owns it; the following pure draws avoid Wren). capture.sh --check is byte-identical (captured sha in the corpus
profile).

Proof (focused):
- bot_fill::tests::the_explicit_add_bot_seam_matches_the_actual_source replays all five captured scenarios through
  BotFillState (direct ops in declaration order, per-tick arrivals, final seats, arrived/yielded stats), including the
  full-lobby null and the shared stream with the arrival schedule.
- bot_fill::tests::the_explicit_add_bot_still_makes_every_draw pairs addbot-overrides with addbot-draw-control: each
  seat's id and seed are identical, every NOT-overridden field equals the control seat, and the empty-override seat is
  identical field by field. That is the source "fixing one thing never reshuffles the rest" invariant, not a re-drawn
  policy.
- bot_fill::tests::a_full_lobby_explicit_seat_returns_none_without_consuming_a_draw_or_an_id: a failed full-lobby call
  leaves the state such that the next seat equals a fresh state's first seat (number 1); no draw, no id.
- cargo test -p rh-server --lib --all-features bot_fill: 15 passed (12 existing + 3 new). cargo fmt --all --check clean;
  cargo clippy -p rh-server --all-targets --all-features -- -D warnings clean;
  bash tools/bot-addbot-fixtures/capture.sh --check PASS byte-identical. Existing corpora unchanged: bot-fill.json is
  byte-identical, the new corpus is a separate file. The lead runs the combined gate.

## Files

- crates/rh-server/src/bot_fill.rs (BotSeatOverrides, public add_bot, draw_bot with the source draw order)
- crates/rh-server/src/bot_fill_tests.rs (captured-seam replay + draw-consumption invariant + full-lobby control)
- tools/bot-addbot-fixtures/{capture.mts,capture.sh,README.md} and parity/policy/bot-addbot.json (new actual-source corpus)
- docs/evidence/stage2-bots-7-addbot/README.md (this record)

No other file; no other corpus touched.

## Remainder (not ported; needs the architecture the packet warns about)

1. Tournament wiring (the source headless-room path). Full parity for the tournament lineup means seating it through the
   manager-equivalent path so the seats get manager ids (bot~n), callsigns, manager seeds and delay lines, and the brain
   that runs is the full ported policy, not the reduced Env policy. Today crates/rh-headless/src/tournament.rs uses the
   reduced runner (tournament.rs:427-449 builds Env AgentSpecs directly; GameSummary deliberately reduced: no id/name/
   callsign fields), and its corpus is built for that documented reduction. Rewiring it is not a mechanical override
   port: it needs the full manager/headless-room (bots act through the delay line/validate/submit, identity and seed
   streams) and the P-BOTS-1/3/4 brain continuation, and it would change the tournament corpus/summaries. Proposed bounded
   follow-up after the brain continuation: add a manager-path headless room to rh-headless that uses BotFillState::add_bot
   for its lineup, then recapture the tournament corpus with the manager identity fields.
2. The bandwidth bench's tier-override stress harness (bench/bandwidth.ts:487) has no ported counterpart and is a
   perf-harness convenience, not gameplay; no action proposed without a perf-gate packet.
3. No live-server caller exists for the override seam: the source server's fill path never overrides, so the live room
   behaviour is unchanged by this lane. The seam is API-and-semantics complete for the caller that eventually needs it.
