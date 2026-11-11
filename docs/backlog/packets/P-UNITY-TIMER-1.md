# P-UNITY-TIMER-1: the top-centre clock counts down to the coliseum, as legacy

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (Unity UI packets); owner direction 2026-11-10 (MIGRATION checkpoint)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (HUD text; the legacy client is the reference, pinned by unit tests copied from legacy's own
  vitest cases) · D2 n/a · D5/D6/D9 none (presentation only; no wire, no prediction)

## 1. ID and outcome
The Unity top-centre strip shows "RAID · mm:ss" counting up from the raid start, adds the arena line only once a
sudden-death time exists, and shows "FORMING MATCH" / "PLANNING" with no clock. Legacy never counts up: while the run is
active the only top-centre line is the Coliseum countdown ("Coliseum m:ss" to the gate lock, then "Coliseum m:ss" to
sudden death, then "Coliseum · sudden death"), and the lobby and planning lines count down to their deadlines. When this
lands, `Indicators.PhaseLine` (engine-free library) produces the legacy text and colour state for lobby, planning and
active, `Indicators.ArenaLine` follows legacy's branch order exactly, and `MatchHud.Features.cs` renders what
`PhaseLine` returns instead of building its own text.

## 2. Dependencies
none. Open question for the coordinator before dispatch: see section 11, "minPlayers".

## 3. Relevant legacy paths
All verified by reading the files at integration head 0994f9f8.
- `packages/client/src/ui/hud.ts:15-18` `fmtSeconds`: `s = max(0, ceil(ms / 1000))`, text `${floor(s/60)}:${pad2(s%60)}`.
  Rounds **up** at the second boundary (59 001 ms reads 1:00, 1 ms reads 0:01), clamps at 0:00, minutes unpadded and
  never wrapped into hours (3 605 000 ms reads 60:05).
- `hud.ts:41-55` `statusLine`: lobby `Waiting for players ${playerCount}/${minPlayers} — run starts in ${fmt(lobbyEndsAt - now)}`
  (U+2014 em dash, `:43-44`); planning `Planning ${fmt(planEndsAt - now)}`, or `Planning` when `planEndsAt` is 0/absent
  (`:46-47`); active `Alive a/b · Run GV n` (`:49-53`); ended `Run over — W is victorious` / `Run over` (`:54`); training
  banner (`:42`).
- `hud.ts:192-203`: during an active non-training run the status line element is **hidden** (`this.status.hidden = active`,
  `:199`), so the active `Alive …` text is never seen; the status line shows in lobby, planning and ended.
- `hud.ts:178-182`: every countdown is measured against `serverNow`, the clock-sync estimate of the present server time,
  not the snapshot's `state.serverTime` (which steps by 50 ms).
- `hud.ts:259-276` `updateArena` (only in `phase === "active"` and not training, `:264`):
  - `gatesLocked && suddenDeathAt > 0` (`:265`): `serverNow >= suddenDeathAt` → `Coliseum · sudden death` (U+00B7, `:268`),
    sudden; else `Coliseum ${fmt(suddenDeathAt - now)}` (`:271`). `patienceEndsAt` is not read on this branch.
  - else `patienceEndsAt > 0` (`:273-274`): `Coliseum ${fmt(patienceEndsAt - now)}`. This branch also runs when locked but
    `suddenDeathAt` is 0, and when unlocked with a stale `suddenDeathAt` (it is ignored).
  - else no line (hidden, `:283`).
- `hud.ts:114-116,139`: the arena line is the only child of the top-centre `.hud-center` block.
- Colour: `packages/client/src/style.css:319` `.hud-arena { color: var(--warn) }` with `--warn: #ffcc80` (`:44`): **every**
  countdown, before and after the lock, is amber. `style.css:320,340` `.hud-arena.sudden { color: #ff8a80 }`: red at sudden
  death. `hud.ts:279-284` toggles only `sudden`; the `locked` flag is in the repaint key but changes no class or colour.
  The status line (`.hud-status`, `style.css:305`) has no colour of its own: plain HUD text (`--text: #e6e9ed`, `:24`).
- Legacy's own tests used as golden values: `packages/client/test/hud.test.ts:27-43` (lobby and planning lines, rounding),
  `packages/client/test/cardsRow.test.ts:300-318` (active: status hidden, "Coliseum 1:00" alone at top centre).
- Server side, for when each clock is set: `packages/server/src/sim/arena.ts:85-90` (raid start: patience set, unlocked,
  suddenDeathAt 0), `:425-439` (a death reopens the gates: new patience, suddenDeathAt 0), `:513-516` (lock: patience 0,
  suddenDeathAt = now + suddenDeathSeconds). Rust mirrors this (`crates/rh-sim/src/systems/coliseum.rs:121-142,178-181`,
  patience `None` where legacy has 0).

## 4. New paths
- none (tests extend `IndicatorFactsTests.cs`; `PhaseLine` was added to the existing `Indicators.cs` as a stub).

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/Indicators.cs`: `ArenaLine` (`:145`) body, and the body of the `PhaseLine` stub
  (added by the oracle author directly after `ArenaLine`; it returns today's MatchHud text so the oracle compiles). The
  signatures of both stay as committed: the oracle calls them.
- `client-unity/UnityProject/Assets/RoguehallaNet/Net/Ui/Indicators.cs`: only via `bash client-unity/sync-net.sh`.
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Features.cs` (`:169-177`): replace the "PLANNING" / "RAID · mm:ss" /
  "FORMING MATCH" text and the appended arena line with one `Indicators.PhaseLine` call; map the tone to colours
  (Warn → legacy amber `#ffcc80`, today `#ffca28`; Danger `#ff8a80`; Normal → the theme's plain text colour); a null
  return leaves the strip empty. Keep the practice / launch-pending branches above it (`:166-168`) and the Ended phase
  text as it is today.
- `MatchHud.cs` was in the draft scope for "static PLANNING / FORMING MATCH text"; those strings exist only in
  `MatchHud.Features.cs:171`. `MatchHud.cs:55` (`Phases`, the connection banner) is a different element and stays as is.

## 6. Contracts and references
- All clocks are already in client state (`client-unity/RoguehallaNet/Net/Collections.cs:98-104` `ArenaView`: lobby end,
  plan end, raid start, patience (gate lock, `double?`), gates locked, sudden death). No wire change.
- Rust leaves the sudden-death time at 0 until the gates lock (`crates/rh-sim/src/systems/coliseum.rs:138-142,180-181`)
  and clears patience at the lock (`:180`), as legacy does.
- R-AUTH / ADR 0008: presentation only; every value comes from the server's arena view.

## 7. Behaviour to preserve
- Wire bytes; every other HUD line; the practice and launch-pending strip texts.
- `ArenaLine`'s and `PhaseLine`'s signatures (the oracle calls both).

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-TIMER-1` passes (full).
- The eight oracle tests in `IndicatorFactsTests.cs` pass, and every other test still passes:
  `Before_the_lock_the_coliseum_line_counts_down_to_the_gate_lock_in_amber`,
  `The_coliseum_countdown_rounds_up_to_the_second_and_stops_at_zero`,
  `After_the_lock_the_coliseum_line_counts_down_to_sudden_death_in_amber`,
  `At_sudden_death_the_coliseum_line_reads_the_legacy_text_in_red`,
  `Without_a_deadline_there_is_no_coliseum_line`,
  `The_lobby_strip_counts_down_to_the_run_start`,
  `The_planning_strip_counts_down_to_the_end_of_planning`,
  `The_active_strip_is_the_coliseum_line_alone_with_no_elapsed_clock`.
- `MatchHud.Features.cs` no longer formats any clock itself (no `RaidStartedAt` elapsed arithmetic); reviewer checks by
  reading, as Unity EditMode tests are not in the gate.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/IndicatorFactsTests.cs` (the eight tests above replace the old
  `The_coliseum_line_counts_down_warns_while_locked_and_turns_red_at_sudden_death`, which pinned the Unity behaviour)

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/sync-net.sh --check`

## 10. Risk and suggested model tier
Sonnet. Small: two pure functions in the library and one call site. The oracle author checked that a direct transcription
of `hud.ts:15-18,41-47,259-276` passes all 1318 library tests (then restored the stub).

## 11. Known traps
- **minPlayers (open, coordinator decides before dispatch).** The legacy lobby line shows `playerCount/minPlayers`.
  `minPlayers` is not delivered to the client: no wire field (`client-unity/RoguehallaNet/Protocol/State.cs:113-120`
  `WireArena`, `Messages.cs:1221` `Welcome`); Rust holds it in room config (`crates/rh-server/src/room.rs:390,497`).
  The library takes it as a parameter and the oracle pins the legacy text. Options: (a) a separate wire packet
  (cross-crate, Opus) adds it, and until then MatchHud keeps today's lobby text; (b) a `DEVIATIONS.md` row for a lobby
  line without the count. The implementer must not invent a value.
- Colour: legacy has two colours, not three. Pre-lock and post-lock countdowns are both amber (`Warn`); only sudden death
  is red (`Danger`). Lobby and planning lines are plain (`Normal`). `None` means no line. The draft of this brief said the
  pre-lock clock was normal colour: that was wrong (`style.css:319`).
- Text: the sudden-death line uses U+00B7 (`Coliseum · sudden death`), not a hyphen; the lobby line uses U+2014.
- Rounding is ceiling, clamped at 0 (`hud.ts:16`); `(int)` truncation of seconds is wrong.
- Branch order: lock-and-sudden-death first, patience second (`hud.ts:265,273`). A sudden-death time without the lock is
  never shown, and a patience time is never read while locked with a sudden-death time.
- Server time: the HUD today passes `_session.ServerTimeMs` (newest snapshot time, `Session.cs:109`); legacy uses the
  clock-sync estimate of the present (`hud.ts:178-182`; Unity has `Session.Sync.ServerNowMs`, `ClockSync.cs:48`, unused by
  the HUD). Keeping `ServerTimeMs` lags by up to one snapshot plus latency; switching is in scope but not required.
- Phase: legacy keys on `phase` (`planning`), Unity's strip keyed on `Collections.Plan != null`. `PhaseLine` takes
  `MatchPhase`.
- Ended: legacy shows `Run over — W is victorious` / `Run over` (`hud.ts:54`); Unity shows "FORMING MATCH" in Ended. Not
  pinned here (the winner label is not an input); leave it, flagged for a follow-up packet.

## Notes from previous attempts
