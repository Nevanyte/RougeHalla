# P-TROPHY-NATIVE-CONSUMER-1 + P-TROPHY-BIRTH-HOLD-REPAIR - native Trophy consumers, repaired birth hold

Status: repair applied and checked on the isolated branch deepseek/trophy-native-consumer-1. Immutable task base
be22be35ef041f9f4389e74425af1c2966f1b615; consumer work 67fe9632 (implementation/corpus), e6e9f64b (evidence),
7bf5806c (evidence precision corrections); P-TROPHY-BIRTH-HOLD-REPAIR production repair cd76ad35, repair evidence
75adaa03, with this checker-correction README update as the following commit (exact final head is in the coordination
report). The repair is the only production change beyond the three cfg(test) mod declarations in
crates/rh-sim/src/kill_augments.rs: reward_chests/mod.rs (one shared pure predicate + Choose), observer.rs (reads the
same predicate) and the fabricated/boundary tests in reward_chests/tests.rs. No schema, version, content, tape,
checkpoint format, hash, schedule, protocol, server, client, policy, Cargo.lock or shared-status change; no merge/push.

## Corpora and provenance

| File | Bytes | SHA256 | Provenance |
|---|---|---|---|
| parity/trophy-witness/lifecycle.json | 72,922 | b8954e0f2607de038ef7f64cb049b7770f1280d3976299149e8df3f21e05ef80 | admitted source corpus, consumed unchanged |
| parity/trophy-witness/helpers.json | 39,067 | 00335b6e14b733e8b1cfbf4158e6fb0f5ce933b204a7c39c8298278aeea9e304 | admitted source corpus, consumed unchanged |
| parity/trophy-format/format.json | 47,713 | b75078a3286913391d5c7f309536bc6e8e8c4ea2f101a8ad939ad1f235e4673c | actual-source formatting corpus (consumer packet) |
| tools/trophy-format-fixtures/capture.mts | 9,888 | 30615c9d82a20fc36fe42bccb2237ff9f7719570a8ea98e2930b40ab553c6163 | capture tool |
| tools/trophy-format-fixtures/capture.sh | 1,660 | f0ee6f0472f086c1796132ac1fc2166e8f4c50034e25aec625a023dc1c12a875 | pinned-container runner |

The admitted source corpora/tools are byte-untouched by this packet (git diff from the task base is empty for
parity/trophy-witness and tools/trophy-witness-fixtures). The format corpus records the pinned image
node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292, linux/amd64,
Node v22.23.4, package-lock.json 991869bdfbbefb6874220500197c61db302a4d2b2603dfc2288fd7032ce1d481, package.json
9da8ab00050db3ec14c083365ab0c3a5b8986e38fd13c086b2913249d531422c, tsconfig.base.json
017575ec3101f44df43b5a7cc850779582650d9e01a2090b7e311b213b98ef88, an internal shared source closure of 73 files
(digest 2ac73144203dcad4985ce1ba8cdfec8f3013a193478df0d60ca43e6131a8539d),
config 2e222b102f3869a71d68287817e95707d654cf88e0ee28fd56da3ce045865bd1 and captureSha256
0f1e3d04b013771758e1a8f8462f050d23fcfcacb62c75b305119fdc29940f48 over canonical JSON.stringify(body)+newline bytes.

## Source -> native profile binding (declared, not inferred)

| Source profile fact | Native binding |
|---|---|
| four seats, Holy/Fire/Plague/Frost | add_player in declared roster order; faction asserted per seat |
| minPlayers 4, lobbySeconds 30, fillSeconds 0 | SimConfig min_players 4, lobby_seconds 30, fill_seconds 0 |
| patienceSeconds/Min/SuddenDeath 3600 | ArenaMode::Source(ArenaRules patience 3600/3600, sudden death 3600) |
| planSeconds 0, pvpRules false | plan_seconds 0, pvp_rules false |
| mobs false | MobMode::Off (no mob runtime) |
| signatures false | FactionMode::Off (no signature/faction passives) |
| quests false | quests false |
| training false / true | training false / true; dummies follow the declared case only |
| map seed 1 attempt 0 decor false | crates/rh-sim/src/mapdata/fixtures/seed1.map.json (SHA256 7c95efad61f47942d10921d7f1bc16acb43306f370cf368e0693a69d456441e7), validate().into_arena() |
| seeds.random 12 | Mulberry32(12): first draw is Secrets.order_salt; spawn_seed 12 |
| rewardSalt [1,2,3,4] | Secrets.reward_salt |
| modules signatures false | FactionMode::Off (walkHints false has no native producer; gap, not claimed) |
| source default loot/consumables/abilities installers | not installed (initial_loot false, consumables false, abilities Off); no such producer is exercised (gap, not claimed) |
| declared initial x/y/hp/maxHp | labelled trusted initial placement setup after the bootstrap step, asserted against faction/max hp |
| grantCard, farm, weapon, wound | real cards::grant, real modifiers::grant_mob_stat, declared weapon set, labelled declared hp wound |
| attack/choose/leave | validate + Sim::submit Attack/Choose, remove_player (ordinary steps) |
| all actions/commands | ordinary Sim::step; no synthetic state writes for Trophy options/gains/takenBy/killStats |

The shuffled spawn assignment is not claimed (trusted initial placements are used). Trusted initial placements/grants/
weapons/wounds are setup, never ReplayInput: the replay format has no grant/wound/placement-override variant.

## Trophy identity: single-birth corpus invariant (no silent remap)

The source Trophy id is never a raw native-id alias. source_trophy_owners asserts the admitted-corpus invariant on every
consumer call: at most one Trophy id and one owner across a case, at most one Trophy per frame, and exactly one
option/takenBy slot. native_trophy_for resolves the id through the actual birth/ownership relation (the owner-bound
reward container the frame declares) and now fails loudly if more than one live owner-bound container exists instead of
silently picking the newest. An expired source id has no live native container and becomes the ordinary unresolved
Choose ("Chest gone"). trophy_identity_corpus_invariants_hold checks the invariant and owner-bound label on all six
cases.

## Lifecycle consumer results (crates/rh-sim/src/kill_augments/lifecycle_consumer.rs)

Every recorded frame fact is compared in order: tick/time/phase; each seat's faction/x/y/hp/maxHp/status/weapons/slot/
build/killStats/mobStats/campClears (removed seat = null); owner-bound Trophy count, owner, location, expiry, option
ids/order, takenBy/pickers/items and birth-at-killer relation; hit amounts; refusal reasons word-for-word; and the
source hook-only rewardOffered/rewardChosen facts against the actual native container/ChestTaken event. Precision
limits (independent checker, unchanged): seat index and ids are structural, not separately asserted, and taken is
compared up to the source option count; the corpus has one Trophy id and one option, and the invariant above now
explicitly pins that. All six cases are consumed FULLY, with no early stop:

| Case | Frames compared | Result |
|---|---|---|
| birth-hold-owner-choose | all 7 | PASS: ad3 grant, refused brute farm row, sword swing 53.604651, real Trophy birth at the killer, owner p0, expiry 30100, options kill:ad:16.5; the held tick's owner pick is refused "Chest gone"; the next tick is the legal first pick (16.5 AD, takenBy/pickers) while the repeated pick and skip are refused "You already picked" |
| owner-stranger-range | all 6 | PASS: stranger "Not yours", out-of-range "Too far away", owner pick AP 16.5, takenBy/pickers |
| expiry-boundary | all 6 | PASS: boundary pick at tick 601, container expires at 30100/tick 602, expired choose "Chest gone" |
| empty-investment | all 2 | PASS: no Trophy for a fresh victim |
| training-exclusion | all 2 | PASS: no Trophy in the training world |
| mia-exclusion | all 2 | PASS: real remove_player leave, p1 null, no Trophy |

## Birth-hold repair (P-TROPHY-BIRTH-HOLD-REPAIR)

Source loot.bornThisTick refuses the birth tick and the next one: a Trophy born in tick 2 records births[id] = 3 and
holdBirth sets tick + 1 = 3, so born >= tick is true at ticks 2 and 3; the first legal Choose executes at tick 4.
Before this repair native reward_chests::choose tested held_until_tick > tick and accepted the held tick (one early),
while RewardChestObserver::can_choose already required held_until_tick < tick.

The repair adds ONE crate-private pure predicate in reward_chests/mod.rs,
`birth_available(held_until_tick, tick) = held_until_tick < tick`, and both Choose and the observer read it. Choose's
guard keeps its position in the refusal order and now refuses while the hold is present; the stored held_until_tick
field, DEFINITION.birth_hold_ticks, tick order, expiry boundary, owner/range/picker/option checks, grant arithmetic and
the unsupported public-Kill omission are unchanged. The source corpora are unchanged.

Focused boundary evidence (reward_chests/tests.rs, test-only fabricated setup labelled separately from the real
lifecycle): the pure predicate is checked at equal/next/boundary ticks; an ordinary ownerless chest AND an owner-bound
Trophy chest are checked with Choose and the observer at before/at/after the stored hold and at before/at/after
expires_at, requiring can_choose to equal Choose acceptance at every point. On the real lifecycle world,
birth_hold_owner_pick_reproduces checks the held-tick refusal (no grant/taken, observer can_choose false), the legal
first pick (16.5 AD, takenBy/pickers) and that the repeated pick/skip never regrant.

## Trusted setup, checkpoint and replay accounting

The checkpoint tests now compare the ORIGINAL driven sim as the live branch against ONE restored branch: the immediate
restore hash and both continuations (live vs restored) are compared; they never compare two restored branches with each
other. Coverage: before the owner pick (tick 600) and after it (tick 601) through expiry in the expiry-boundary case,
and after the stranger refusal in case 1 through the range/owner continuation. Restore/continue hashes and frames agree
with the live branch.

The Recorder test records the owner Choose as ReplayInput::Command and its post-step state hash; a checkpoint restored
before that execution, fed the same recorded input with replay::apply_input, reproduces the state hash and the source
frame. This is command-stream accounting only: trusted initial grants/wounds/placements are NOT ReplayInput, the
format has no grant/wound variant, and no full run_replay or normal-acquisition replay claim is made.

## Policy/observer offer binding

The default native ItemObserver stages the Trophy as one complete reward row (option kill:ad:16.5), not chooseable
during the birth hold. A SIMULATED equivalent of the existing human presentation admission filter (an accept closure
that rejects any kill-augment row) omits the entire Trophy row before handle bindings, and the observer resolves an
unbound handle to the ordinary unresolved choose. This exercises the observer-level filter only: the production human
wire functions in wire.rs/wire_state.rs are unchanged and are NOT executed here, the unsupported public-Kill row omission
remains closed, and no public transport, reconnect/DOM/scene lifecycle or full sight-disclosure proof is made.

## Helper consumer results (crates/rh-sim/src/kill_augments/helper_consumer.rs)

All seven declared-input helper cases are consumed through actual native helpers; the declared ReadableFighter mirrors
are synthesized through the real trophy grant path (helper fixture, never runtime lifecycle state).

| Case | Native coverage | Result |
|---|---|---|
| nine-key-investments-and-options | KILL_STAT_KEYS order/parse, share/options/lifetime/label, flat(), label(), DEFINITION unit derived from actual source output, roll options/parsed/text, invested_stats score order | PASS (all 9 keys) |
| flat-versus-percentage-wording | encode, parse, exact text title/body for flat 1-decimal and percentage wording | PASS (all 9) |
| encode-parse-rounding-and-refusals | 45 round-trips and 10 malformed refusals, including tiny gains that encode to a non-parsing id | PASS |
| ranking-ties-truncation | 5 declared rolls: tie order (ad before armor), three-option truncation, fewer-than-three, nothing, filtered tiny | PASS |
| kill-augment-grant-store-map | parse + real kill_augments::grant storage, KillStats, actual store row mapping (health->maxHp, mr->shield, speed->moveSpeed, leech->lifesteal) | PASS (all 9) |
| kill-stat-effects-rows | KillStats::rows(): flat/stat split, zero/unknown/NaN ignored; compared order-insensitively | PASS |
| combat-readability-declared-all-nine | invested_stats key/score order and roll options for the declared all-nine fighter | PASS with explicit gap: native invested_stats has no powerRatio/power or combatReadability display label/short metadata |

## Formatting consumer results (crates/rh-sim/src/kill_augments/format_consumer.rs)

New corpus rows are actual shared-helper outputs. Native js_to_fixed/encode/parse/text matched every row:

- 28 tie groups x 3 rows = 84 exact/neighbour rows: flat 1-decimal (ad/ap/armor/mr, ties 0.25 and 3.25), percentage
  4-decimal encode (damage/health/attackSpeed/speed/leech, ties 1/32 and 5/32), percentage-text 1-decimal (same five
  keys, ties 1/16 and 19/16). Every recorded binary64 bits value equals native raw.to_bits() and every neighbour is
  exactly nextDown/nextUp of the tie.
- 9 key rows covering flat and percentage wording; 45 tiny-gain rows including ids that encode to zero and no longer
  parse; 19 parse/refusal boundaries; 3 captured source roll rows re-encoded/re-worded.
- The three roll rows are captured parse/encode/wording rows: the corpus stores the actual rollKillAugments outputs and
  the consumer only parses/re-encodes/re-words them natively. They are NOT a native roll() reproduction (native ranking/
  ties are covered by the helper ranking case), and no source-arithmetic claim is made.
- Result: 0 mismatches; no production formatting behaviour changed.

## Comparator-sensitivity controls (in-test, NOT compiled mutants)

These mutate the EXPECTED corpus JSON inside the test to prove the comparators notice semantic differences. They are
explicitly labelled comparator-sensitivity controls, not compiled runtime mutants:

| Expected-JSON mutation | Reported mismatch |
|---|---|
| lifecycle frame Trophy owner p0 -> p1 | frame birth-hold-cleared tick 3: trophies[0] owner Some(PlayerId(1)) != p1 |
| lifecycle frame birth-hold takenBy -> p2 | frame birth-hold-cleared tick 3: trophies[0] takenBy [""] != ["p2"] |
| lifecycle frame killStats ad 16.5 -> 33 | frame at-expiry tick 602: players[0] killStats {"ad": 16.5} != {"ad": 33.0} |
| helper text title +3.1 -> +3.2; encoded id; ranking option order; grant value | reported text/id/options/row mismatch |
| format flat tie fixed; neighbour bits; key title; encoded id | reported fixed/bits/text title/encoded mismatch |
| provenance-only mutations (lifecycle sourceSha256, helper tool hash, format closure/tool hash) | NOT a kill: semantic comparisons pass and the restored corpus passes |

## Compiled source mutants (actual consumer mismatches, disposable worktree)

Three actual compiled source mutants of the repaired tree were run in a disposable detached worktree at the repair
commit (patches stored under docs/evidence/trophy-native/mutants/); each changed production behavior and failed the
actual native consumers with the exact mismatch below, then the tree was restored. A comment-only (provenance-
equivalent) edit was NOT a kill, and the restored control passes (`git status` clean before each control run):

| Patch | Mutation | Test (EXIT) | Actual mismatch |
|---|---|---|---|
| 01-early-choose.patch | Choose restored to held_until_tick > tick (bypasses shared predicate) | captured_lifecycle_frames_reproduce_natively (101) | case 0 frame birth-hold-refused tick 3: players[0] killStats {"ad": 16.5} != {} |
| 01-early-choose.patch | same | birth_hold_choose_and_observer_agree_at_the_boundaries (101) | Choose trophy=false delta=0 accepted Ok(()) while observer can_choose is false |
| 02-long-birth-hold.patch | Trophy held_until_tick +1 extra | captured_lifecycle_frames_reproduce_natively (101) | case 0 frame owner-chosen tick 4: players[0] killStats {} != {"ad": 16.5} |
| 02-long-birth-hold.patch | same | birth_hold_owner_pick_reproduces (101) | the held tick is the refused tick (held_until_tick != tick) |
| 03-owner-guard-bypass.patch | Choose owner check removed | owner_stranger_and_range_refusals_reproduce (101) | frame stranger-refused tick 4: refusals ["Too far away"] != toasts ["Not yours"] |
| 04-comment-only.patch | provenance-equivalent source comment only | both lifecycle and boundary tests (0) | NOT a kill: both pass; restored control passes |

These are compiled source mutations executed against the consumers, not expected-JSON edits; a compile/runtime
failure would not count as a kill.

## Commands and exact results

- cargo test -p rh-sim --lib reward_chests -> 13 passed, 0 failed (583 filtered).
- cargo test -p rh-sim --lib kill_augments -> 22 passed, 0 failed (574 filtered).
- cargo fmt -p rh-sim -- --check -> exit 0.
- cargo clippy -p rh-sim --all-targets -- -D warnings -> exit 0.
- cargo clippy -p rh-sim --all-targets --all-features -- -D warnings -> exit 0.
- cargo test -p rh-sim --test cards_no_alloc -> 1 passed; --test initial_loot_allocation -> 1 passed.
- bash tools/trophy-format-fixtures/capture.sh -> byte-identical 47,713 B, SHA256 b75078a3..., 28 ties / 9 keys / 9 tiny / 19 refusals / 3 rolls.
- bash tools/trophy-format-fixtures/capture.sh --check (read-only, repeated) -> exit 0, identical hashes.
- Compiled mutants: see the table above (disposable worktree; patches stored; restored control passes).
- No broad workspace/map/hash campaign was run; only the focused rh-sim tests, reward_chests tests, allocations, fmt and clippy above.

## Independent verification (Lead and separate checker)

Lead verification: focused tests above pass; both clippy modes, fmt and warm allocation checks pass; all six lifecycle
cases are consumed with no stop; the three compiled mutants produce the exact actual mismatches above and the
comment-only/restored controls pass.

Separate checker (independent, read-only, own target/temporary mutant worktree): reproduced the 10-file diff scope (no
Cargo.lock/schema/content/checkpoint/hash/schedule/tape/wire/protocol/server/client/policy/status changes; all corpus
tree hashes identical to 7bf5806c, including lifecycle b8954e0f, helpers 00335b6e, format b75078a3 and map 7c95efad);
confirmed the one pub(crate) const predicate at mod.rs:44, Choose using !birth_available at the same guard position
(mod.rs:260) and observer using super::birth_available (observer.rs:155), with fields/constants/order/expiry/owner
checks unchanged and the legacy loot.bornThisTick/holdBirth two-tick hold; reran reward_chests 13/13 and kill_augments
22/22, fmt, both clippy modes and both warm allocation tests (all exit 0); confirmed all 7 case-0 labels and every
action consumed through drive(case, None), the old divergence test removed, the focused real-Trophy and ordinary/Trophy
boundary behavior, the live-vs-one-restored checkpoint comparisons, the command-stream-only Recorder claim, the
single-birth identity invariant, the captured-roll and simulated-wire labels, and the unchanged production wire files.
It independently applied the stored mutant patches in a disposable worktree at HEAD: 01/02/03 failed the expected tests
with the same actual mismatches (early grant, shifted hold, "Too far away" vs "Not yours"; exit 101), 04 comment-only
passed all four tests, and the restored control passed with a clean tree. Verdict: PASS WITH DISCREPANCIES (no
functional failures). The only discrepancies were these documentation/presentation items, now fixed: the stale
stop_before/divergence comment in lifecycle_consumer.rs, the stale "choose does not model the hold" observer comment, the
"exactly one Trophy per frame" wording for an at-most-one assert, the helper/format controls still being called
"compiled" although they are in-test expected-JSON mutations, and the README's test-count breakdown (corrected above:
22 = 6 existing + 12 lifecycle + 2 helper + 2 format; the ordinary/Trophy boundary test is in the reward_chests filter).

## Honest gaps / limits

1. No normal-acquisition replay claim: trusted initial grants/wounds/placements are setup and are not ReplayInput; the
   replay accounting is the recorded Choose command stream only.
2. The human RewardOption::Kill wire omission is unchanged and remains closed. The observer filter test is simulated,
   not the production wire; no public transport, protocol allocation, reconnect/DOM or full sight-disclosure proof is
   made (root owns public transport/privacy).
3. The declared farm action called the source producer with role id "brute" (not a mob type): the actual source
   grantMobStat returns 0 and native mirrors that refusal. No mob-stat/farm row is claimed; the invested victims are
   the declared ad3/ap3 cards only.
4. Source default loot/consumables/abilities installers and walkHints have no native slice in this profile; they are
   not claimed and no corpus action exercises them. The shuffled spawn assignment is not claimed.
5. Native invested_stats has no source combatReadability powerRatio/power or display label/short equivalent.
6. Self-kill exclusion is not in the admitted corpus; the repeated-pick/skip tail is now consumed but only through the
   admitted lifecycle frames.
7. The repair changes one gameplay guard only; root registers the predicate/outputs in content identity. No schema/
   checkpoint/content/tape/Cargo/status edits are present, and no protocol/version change is claimed.

## No-inflation statements

- Exactly six admitted lifecycle cases and seven admitted helper cases are consumed, plus the additive format corpus;
  no other corpus was regenerated, edited or counted.
- "22 passed" = six existing kill_augments tests + 12 lifecycle_consumer tests (incl. the invariant and the
  repaired real-Trophy boundary) + 2 helper_consumer + 2 format_consumer. The focused ordinary/Trophy birth-hold
  boundary test lives in the reward_chests filter (13 passed: 10 reward_chests::tests + the observer presentation,
  chest_runtime and training tests). This is not a gameplay/coverage claim.
- All six full lifecycle cases are compared with no early stop and no skipped frame; the former blocked tail is now
  covered by the repair.
- Source hook-only probes are compared as facts, never counted as native producers.
- Helper/format rows are declared-input/helper facts, never runtime lifecycle output or reachable game gains.
- No expected outcome was installed to make a frame pass; the compiled mutants above show the consumers detect
  semantic changes, and the comment-only edit is not counted as a kill.
