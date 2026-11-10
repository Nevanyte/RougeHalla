# P-BOT-MEMORY-ADMISSION-1 — backend rebase/admission evidence

Packet: P-BOT-MEMORY-ADMISSION-1 (owner resume of Rust gameplay/bots/quests while Claude owns Unity/networking).
Prepared branch: codex/deepseek-bot-memory. Worktree: /Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-memory.
Current committed backend base at start: 4151b3af597cc06d1b3b77f4e3e21cc9906b6a86 (clean). No merge/push.

## Reused implementation and exact scope

Sealed DeepSeek Memory work: original base 6a251045a05e3abd2ed63eb2df4d080930a22a64, original final
06c4115cea037b174a1ab1b5d91d934776232559, review-repair final 3e3178b993ae88021f459b601ac20cb1717d22be; code commits
00972d3e, 34128472, ed779463. The five-file delta was re-applied byte-identically onto the current backend base:

- crates/rh-policy/src/bots/temporal_percept.rs — only one added line: mod memory; (no other change)
- crates/rh-policy/src/bots/temporal_percept/memory.rs — SHA-256 bee36b02aa66068da410f06850b24e4b1474eed4161c81be65442d62b6651ccb, 1851 lines
- crates/rh-policy/src/bots/temporal_percept/memory/source_input.rs — SHA-256 36708a9fd21107add60ca8ba7ae429b937f1132180ee4440917d8122b5c599e5, 218 lines
- crates/rh-policy/src/bots/temporal_percept/memory/source_input/reader.rs — SHA-256 cd6dfacf6437d0d3ef57f78e5296d54b7e8c9da66084637436fb6fd6a4b098ff, 533 lines
- crates/rh-policy/src/bots/temporal_percept/memory/source_tests.rs — SHA-256 72a5714ecb8f4f9e9508e7cd4531358e6f52f457c9cbed36a5326a6f7678e4fe, 1401 lines

Conflict check against 4151b3af: parent temporal_percept/data.rs and temporal_percept/input.rs are byte-identical to the
reviewed final parent versions; the only parent-file change needed is the memory module declaration. The four new files
are byte-identical to immutable 3e3178b9; no newer upstream work was overwritten. No Cargo.lock/dependency, rh-sim, shared
status, Unity/network/protocol/decoder or fixture change. No public/live Brain activation.

## Acceptance receipts (packet-owned target, pinned toolchain, locked/offline)

Target: /Users/nevinmckinnon/.codex/tools/roguehalla-backend-20261109/target-memory (new, jobs 1, CARGO_INCREMENTAL=0,
debug 0, --locked --offline). Raw logs are in this directory.

1. cargo test -p rh-policy --lib memory --locked --offline -- --nocapture: 27 passed, 0 failed, exit 0
   (includes the unchanged 2112 protection-cue and 773 NPC actual-source consumers, Map/strict reader controls, review
   repair tests, and existing memory_prefix tests).
2. cargo test -p rh-policy --lib memory_prefix --locked --offline -- --nocapture: 6 passed, 0 failed, exit 0.
3. cargo test -p rh-policy --lib protection_cues --locked --offline -- --nocapture: 4 passed, 0 failed, exit 0.
4. cargo fmt -p rh-policy -- --check: exit 0.
5. cargo clippy -p rh-policy --lib --tests --locked --offline -- -D warnings: exit 0.
6. cargo clippy -p rh-policy --lib --tests --all-features --locked --offline -- -D warnings: exit 0.

The exact command/cwd/target/source head headers are at the top of each raw log; run-a.txt/run-a.done record the run.

## Review findings represented (no blanket allowance, no weakened assertion)

The four substantive independent-review defects and the strict-reader defects are all exercised by named tests in
memory/source_tests.rs: review_repair_visible_never_dotted_mob_initializes_aux_positive,
review_repair_death_event_time_control, review_repair_hit_clock_control,
review_repair_pickup_refusal_exact_matrix, review_repair_pickup_state_positive_and_negative,
review_repair_reader_controls_are_strict, and review_repair_synthetic_note_sent_and_whereabouts_controls.
The 27-test focused filter passing on the new base confirms those assertions were not weakened.

A prior failing receipt is preserved in the immutable old evidence (06c4115c/evidence f6a6b0ef:
docs/evidence/bot-full-memory-native/focused-first.log and prot-first-mismatch.log). This admission run produced no new
source failure because the implementation applied here is already the reviewed repaired code; it was not rewritten or
re-tuned to pass on the new base. No expectation/tolerance change was made.

## Actual-source versus synthetic controls (honest classification)

Actual captured-source method replay: all 2112 protection-cue rows (2046 observes, 66 null initialization compares,
10560 strict Maps, exact binary64) and all 773 NPC continuity rows (771 observes, 2 null initialization compares;
retained mobs/camps/self/stimuli). Undefined/Null distinctions, strict Map/Percept refusal, and the 82-row Undefined→Null
schema control are exercised.

Synthetic/declared-method controls only: visible-only first mob history, death-event diedAt clock, player-hit clock,
pickup regex/state matrix, noteSent move/stop/target/cast reflection/failure/arrival, recordChoice, whereabouts
positive/unknown/dead/expired, and the strict reader/config malformed inputs. These do not claim actual-source API parity.

## Remaining source-witness gaps / limits

Still source-inspected but not actual-source-witnessed: noteSent/recordChoice/whereabouts callers; real bounties,
choices, lastOrder/lastCast; Wish castLand belief; chasing and third-party engagement; plan/chest/dead/teleport
interaction branches; the never-dotted-vs-missing minimap distinction remains unbound (historical mutation survived and
is retained). No native BotVision/vision.update/filter producer is admitted here, no earned-World Memory, no public/live
or P15/full-Brain activation, and no warm-allocation/RSS claim. Memory remains private and crate-internal. Memory::observe
consumes typed crate-private records; the checked test reader is the finite conversion boundary.

## Next concrete bot dependency

The next prerequisite toward the complete bot is an admitted actual-source createMemory/API method witness (or an admitted
BotVision→Percept producer whose method outputs include noteSent/recordChoice/whereabouts, bounties/choices/lastOrder/
lastCast, Wish castLand, chasing/third-party and plan/chest/dead/teleport facts) so the remaining synthetic-only branches
become source-bound; only then should private Memory be wired into live strategy/tactics/humanizer. Full
strategy/reflex/hunting/loot/learning/tournament completion and BotVision remain open.

## Environment/cleanup

No merge/push, no shared status change, no Unity/network/protocol/rh-sim/Cargo.lock edits. Packet-owned target was used with
jobs1 and left in place (no cleanup); no old caches/processes touched. Exact admission commit SHA is reported to the
coordinator after this evidence is committed.
