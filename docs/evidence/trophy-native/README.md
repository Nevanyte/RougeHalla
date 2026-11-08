# P-TROPHY-NATIVE-CONSUMER-1 - native Trophy lifecycle, helper and formatting consumers

Status: delivered on isolated branch deepseek/trophy-native-consumer-1, immutable base
be22be35ef041f9f4389e74425af1c2966f1b615. Implementation/corpus commit
67fe963287d1305a4bc66b13b51d7adc9153b9f4; this evidence README is the following commit. Evidence/test-only
production scope: the only production-file change is three cfg(test) mod declarations in
crates/rh-sim/src/kill_augments.rs. No production logic, mechanics, schema, state, checkpoint, content, hash,
schedule, format, tape, protocol, server, client, policy or deployment code was changed; Cargo.lock and the shared
status records are untouched.

## Corpora and provenance

| File | Bytes | SHA256 | Provenance |
|---|---|---|---|
| parity/trophy-witness/lifecycle.json | 72,922 | b8954e0f2607de038ef7f64cb049b7770f1280d3976299149e8df3f21e05ef80 | admitted source corpus, consumed unchanged |
| parity/trophy-witness/helpers.json | 39,067 | 00335b6e14b733e8b1cfbf4158e6fb0f5ce933b204a7c39c8298278aeea9e304 | admitted source corpus, consumed unchanged |
| parity/trophy-format/format.json | 47,713 | b75078a3286913391d5c7f309536bc6e8e8c4ea2f101a8ad939ad1f235e4673c | NEW actual-source formatting corpus (this packet) |
| tools/trophy-format-fixtures/capture.mts | 9,888 | 30615c9d82a20fc36fe42bccb2237ff9f7719570a8ea98e2930b40ab553c6163 | NEW capture tool |
| tools/trophy-format-fixtures/capture.sh | 1,660 | f0ee6f0472f086c1796132ac1fc2166e8f4c50034e25aec625a023dc1c12a875 | NEW pinned-container runner |

The admitted witness README quoted older corpus hashes; the current admitted files are the hashes above and were not
edited. The new format corpus records image node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292,
linux/amd64, Node v22.23.4; package-lock.json 991869bdfbbefb6874220500197c61db302a4d2b2603dfc2288fd7032ce1d481;
package.json 9da8ab00050db3ec14c083365ab0c3a5b8986e38fd13c086b2913249d531422c;
tsconfig.base.json 017575ec3101f44df43b5a7cc850779582650d9e01a2090b7e311b213b98ef88;
an internal shared source closure of 73 files (from packages/shared/src/index.ts) with digest
2ac73144203dcad4985ce1ba8cdfec8f3013a193478df0d60ca43e6131a8539d; config SHA256
2e222b102f3869a71d68287817e95707d654cf88e0ee28fd56da3ce045865bd1; and captureSha256
0f1e3d04b013771758e1a8f8462f050d23fcfcacb62c75b305119fdc29940f48 over the canonical
JSON.stringify(body) + "\n" bytes.

## Source -> native profile binding (declared, not inferred)

| Source profile fact | Native binding |
|---|---|
| four seats, Holy/Fire/Plague/Frost | add_player in declared roster order; faction asserted per seat |
| minPlayers 4, lobbySeconds 30, fillSeconds 0 | SimConfig min_players 4 (reset to human count), lobby_seconds 30, fill_seconds 0 |
| patienceSeconds/Min/SuddenDeath 3600 | ArenaMode::Source(ArenaRules patience 3600/3600, sudden death 3600) |
| planSeconds 0, pvpRules false | plan_seconds 0, pvp_rules false |
| mobs false | MobMode::Off (no mob runtime) |
| signatures false | FactionMode::Off (no signature/faction passives) |
| quests false | quests false |
| training false / true | training false / true; dummies follow the declared case only |
| map seed 1 attempt 0 decor false | crates/rh-sim/src/mapdata/fixtures/seed1.map.json (same bytes as tools/ability-fixtures/seed1-input.json, SHA256 7c95efad61f47942d10921d7f1bc16acb43306f370cf368e0693a69d456441e7), validate().into_arena() |
| seeds.random 12 | Mulberry32(12): first draw is Secrets.order_salt; spawn_seed 12 |
| rewardSalt [1,2,3,4] | Secrets.reward_salt |
| modules signatures false | FactionMode::Off; walkHints false has no native producer installed (gap, not claimed) |
| source default loot/consumables/abilities installers | not installed by this slice (initial_loot false, consumables false, abilities Off); no such producer is exercised by the corpus (gap, not claimed) |
| declared initial x/y/hp/maxHp | labelled trusted initial placement setup after the bootstrap step, asserted against faction/max hp |
| grantCard, farm, weapon, wound | real cards::grant, real modifiers::grant_mob_stat, declared weapon set, labelled declared hp wound |
| attack/choose/leave | validate + Sim::submit Attack/Choose, remove_player (ordinary steps) |
| all actions/commands | ordinary Sim::step; no synthetic state writes for Trophy options/gains/takenBy/killStats |

The source shuffled spawn assignment is not claimed: the source createGameWorld installs the loot module's constructor
draws, which this native slice does not install, so the declared initial frame placements are applied as trusted setup
(the source rig's own pattern). Trophy identity is never a raw source-id alias: a source chest id is resolved through
the newest LIVE native reward container owned by the killer that the corpus frame declares, using the actual birth/
ownership relation; an expired source id has no live native relation and becomes an ordinary unresolved choose
("Chest gone").

## Lifecycle consumer results (crates/rh-sim/src/kill_augments/lifecycle_consumer.rs)

The recorded frame facts are compared in order: tick/time/phase; each declared seat's faction/x/y/hp/maxHp/status/
weapons/slot/build/killStats/mobStats/campClears (removed seat = null); owner-bound trophy count, owner, location, expiry,
option ids/order, takenBy/pickers/items and the birth-at-killer relation; hit amounts; refusal reasons word-for-word
against source toasts; and the source hook-only rewardOffered/rewardChosen facts against the actual native
container/ChestTaken event (the probe is not a native producer). Precision limits (independent checker): the seat
index and native/source trophy ids are structural, not separately asserted; taken is compared up to the source's
declared option count. The admitted corpus has one trophy id and one option per chest, so this cannot hide a mismatch
here, but a future multi-id/multi-option corpus would need explicit id assertions. The source id c1b/owner p0 is
constant in the admitted corpus, so the birth/ownership id mapping is structurally exercised rather than stress-tested.

| Case | Frames compared | Result |
|---|---|---|
| birth-hold-owner-choose | start, invested-wounded, kill-tick (3 of 7) | PASS: ad3 grant, refused brute farm row, sword swing 53.604651, real Trophy birth at the killer, owner p0, expiry 30100, options kill:ad:16.5 |
| birth-hold-owner-choose tail | birth-hold-refused, owner-chosen, repeat-pick, skip | STOPPED (dependent): native choose allows the owner pick one tick early; exact divergence asserted, later frames not asserted |
| owner-stranger-range | all 6 | PASS: stranger "Not yours", out-of-range "Too far away", owner pick AP 16.5, takenBy/pickers |
| expiry-boundary | all 6 | PASS: boundary pick at tick 601, container expires at 30100/tick 602, expired choose "Chest gone" |
| empty-investment | all 2 | PASS: no Trophy for a fresh victim |
| training-exclusion | all 2 | PASS: no Trophy in the training world |
| mia-exclusion | all 2 | PASS: real remove_player leave, p1 null, no Trophy |

Not reachable in this corpus: a move/target/ordinary-step action stream (the capture uses placements and one attack per
case), repeated/skip refusal frames (their only case is the blocked tail above), self-kill exclusion.

### Reported source divergence (exact blocker, no production change made)

Source loot.bornThisTick refuses the birth tick AND the next tick: a Trophy born in tick 2 records births[id] = 3 and
holdBirth sets tick + 1 = 3, so born >= tick is true at ticks 2 and 3 and first takeable at tick 4. Native
reward_chests::choose tests held_until_tick > tick, and the trophy sets held_until_tick = tick + 1 = 3, so the owner
pick is accepted at tick 3. Native RewardChestObserver::can_choose already uses held_until_tick < tick and therefore
agrees with the source (false at ticks 2 and 3, true at tick 4). The exact minimal consistent fix is therefore to make
`choose` refuse while `held_until_tick >= tick` (accept only when `held_until_tick < tick`, the observer's condition);
alternatively raising BOTH in-tick holds (the trophy drop and the generic chest insert, where the hold is written as
tick + 1) to tick + 2 is exact for those in-tick births, but a hold-only change without the observer/choose alignment
would desynchronise them. That production change is outside this packet;
case 0's owner-chosen/repeat-pick/skip frames are therefore not asserted, and the divergence is asserted explicitly by
birth_hold_diverges_from_the_source_hold plus observer_can_choose_follows_the_source_hold.

### Trusted setup and replay accounting

Trusted initial placements/grants/weapons/wounds are setup, never ReplayInput: the replay format has no grant/wound/
placement-override variant. The Recorder test records the owner Choose as ReplayInput::Command and its post-step state
hash; a checkpoint restored before the choose, fed the same recorded input with replay::apply_input, reproduces the state
hash and the source frame. No full run_replay reproduction is claimed (the trusted bootstrap is not in the replay).
Checkpoint round-trips: before the pick (tick 600) and after it (tick 601) through expiry; and after the stranger refusal
in case 1 through the range/owner continuation. Restored and uninterrupted runs produce identical state hashes and frames.

### Policy/observer offer binding

The default native ItemObserver stages the Trophy as one complete reward row (option kill:ad:16.5), with can_choose false
during the birth hold. A test-side observer closure equivalent to the existing human presentation guard (reject any row
containing a kill augment) omits the entire Trophy row before handle bindings, and the observer resolves an unbound
handle to the ordinary unresolved choose. The production human wire functions themselves are unchanged and are not
executed by this test; no guard was bypassed, widened or removed and no protocol allocation or human wire change was
made.

## Helper consumer results (crates/rh-sim/src/kill_augments/helper_consumer.rs)

All seven declared-input helper cases are consumed through actual native helpers. The declared ReadableFighter mirrors
are synthesized through the real trophy grant path (KillStats are part of the same readable score); this is a helper
fixture, never runtime lifecycle state.

| Case | Native coverage | Result |
|---|---|---|
| nine-key-investments-and-options | KILL_STAT_KEYS order/parse, share/options/lifetime/label, flat(), label(), DEFINITION unit derived from actual source output, roll options/parsed/text, invested_stats score order | PASS (all 9 keys) |
| flat-versus-percentage-wording | encode, parse, exact text title/body for flat 1-decimal and percentage wording | PASS (all 9) |
| encode-parse-rounding-and-refusals | 45 round-trips and 10 malformed refusals, including tiny gains that encode to a non-parsing id | PASS |
| ranking-ties-truncation | 5 declared rolls: tie order (ad before armor), three-option truncation, fewer-than-three, nothing, filtered tiny | PASS |
| kill-augment-grant-store-map | parse + real kill_augments::grant storage, KillStats, actual store row mapping (health->maxHp, mr->shield, speed->moveSpeed, leech->lifesteal) | PASS (all 9) |
| kill-stat-effects-rows | KillStats::rows(): flat/stat split, zero/unknown/NaN ignored; compared order-insensitively (source order follows the declared map insertion order; native rows use the fixed key order, same row set) | PASS |
| combat-readability-declared-all-nine | invested_stats key/score order and roll options for the declared all-nine fighter | PASS with explicit gap: native invested_stats has no powerRatio/power or combatReadability display label/short metadata |

## Formatting consumer results (crates/rh-sim/src/kill_augments/format_consumer.rs)

New corpus rows are actual shared-helper outputs. Native js_to_fixed/encode/parse/text matched every row:

- 28 tie groups x 3 rows = 84 exact/neighbour rows: flat 1-decimal (ad/ap/armor/mr, ties 0.25 and 3.25), percentage
  4-decimal encode (damage/health/attackSpeed/speed/leech, ties 1/32 and 5/32), percentage-text 1-decimal
  (same five keys, ties 1/16 and 19/16). Every recorded binary64 bits value equals native raw.to_bits() and every
  neighbour is exactly nextDown/nextUp of the tie.
- 9 key rows covering flat and percentage wording; 45 tiny-gain rows including ids that encode to zero and no longer
  parse; 19 parse/refusal boundaries; 3 declared rolls re-encoded/re-worded.
- Result: 0 mismatches; no production formatting behaviour was changed.

## Compiled semantic controls

| Mutation | Actual consumer mismatch |
|---|---|
| lifecycle frame trophy owner p0 -> p1 | frame birth-hold-cleared tick 3: trophies[0] owner Some(PlayerId(1)) != p1 |
| lifecycle frame birth-hold takenBy "" -> "p2" | frame birth-hold-cleared tick 3: trophies[0] takenBy [""] != ["p2"] |
| lifecycle frame killStats ad 16.5 -> 33 | frame at-expiry tick 602: players[0] killStats {"ad": 16.5} != {"ad": 33.0} |
| helper text title +3.1 -> +3.2 | reported as "text title" |
| helper encoded id kill:ad:1.0 -> kill:ad:1.1 | reported as id mismatch |
| helper ranking option order changed | reported as options mismatch |
| helper grant value 2.5 -> 3.0 | reported as row value/stored value mismatch |
| format flat tie fixed 0.3 -> 0.2 | reported as fixed mismatch |
| format neighbour bits -> 0x0 | reported as bits mismatch |
| format key title changed | reported as text title mismatch |
| format encoded id changed | reported as encoded mismatch |
| provenance-only mutations (lifecycle sourceSha256, helper tool hash, format closure digest/tool hash) | NOT a kill: all semantic comparisons pass and the restored corpus passes again |

No control uses compilation, import, source-provenance-only or comment-only differences as a kill.

## Commands and exact results

- cargo test -p rh-sim --lib kill_augments -> 21 passed, 0 failed, 0 ignored (573 filtered out).
- cargo test -p rh-sim kill_augments -> exit 0; the lib binary is the 21-test run above and every integration binary ran
  0 matching tests (filtered), no failures.
- cargo fmt -p rh-sim -- --check -> exit 0.
- cargo clippy -p rh-sim --all-targets -- -D warnings -> exit 0.
- bash tools/trophy-format-fixtures/capture.sh -> 47,713 bytes, SHA256 b75078a3..., captureSha256 0f1e3d04..., 28 tie
  groups, 9 key rows, 9 tiny rows, 19 refusal rows, 3 rolls.
- bash tools/trophy-format-fixtures/capture.sh --check (twice) -> exit 0 both times, identical bytes/hashes.
- bash tools/trophy-format-fixtures/capture.sh (recapture write) -> byte-identical SHA256 b75078a3..., no git diff.
- No broad workspace/map/hash campaign was run; only the focused rh-sim test filters, fmt and clippy above.

## Independent verification (Lead and separate checker)

The Lead re-ran the slice independently, then a separate checker agent audited it without modifying anything:

- Lead: cargo test -p rh-sim --lib kill_augments -> 21 passed / 0 failed (573 filtered); capture.sh --check read-only
  -> byte-identical 47,713 B, SHA256 b75078a3...673c, captureSha256 0f1e3d04...f48, 28 ties / 9 keys / 9 tiny /
  19 refusals / 3 rolls. Scope diff: only three cfg(test) mod lines in production; admitted corpora/tools byte-untouched.
- Checker: two independent --check runs identical; write-mode recapture produced the same SHA with git status
  unchanged; re-derived the canonical captureSha256, recomputed 84 tie rows and 45 tiny rows; module filters lifecycle
  11 / helper 2 / format 2 all pass; cargo fmt -p rh-sim -- --check and cargo clippy -p rh-sim --all-targets -- -D warnings
  exit 0; confirmed the birth-hold divergence with exact file:line evidence (source loot.ts birth/hold/bornThisTick vs
  native reward_chests/mod.rs held/choose and the observer predicate), and confirmed the divergent tail is correctly
  stopped rather than faked.
- Checker verdict: PASS WITH DISCREPANCIES. The discrepancies were documentation precision only and are corrected
  above/in this commit: (1) id/taken comparisons are structural, not "every field"; (2) the single source Trophy id
  means identity mapping is structurally exercised, not stress-tested; (3) the human-wire-guard test uses an equivalent
  observer closure, not the production wire functions (which remain unchanged). The minimal fix wording now names the
  exact held_until_tick >= tick choose alignment and distinguishes the tick + 2 hold alternative.

## Honest gaps / prerequisites

1. Birth-hold divergence above: native choose is one tick early; case 0 owner/repeat/skip tail is blocked pending the
   minimal production fix. No production change was made in this packet.
2. Repeat/skip refusal outcomes are only in the blocked case-0 tail and are therefore not consumed.
3. The declared farm action called the source producer with role id "brute", which is not a mob type: the actual source
   grantMobStat returns 0, and native mirrors that refusal. No mob-stat/farm row is claimed; the invested victims here are
   the declared ad3/ap3 cards only. (This corrects the witness README's phrase "real farm producer for at least one
   invested victim": the producer call was real but refused.)
4. Source default loot/consumables/abilities installers and walkHints have no native slice in this profile; they are not
   claimed, and no corpus action exercises them. The shuffled spawn assignment is not claimed (trusted initial placements
   used instead).
5. Human RewardOption::Kill wire omission is unchanged and remains closed; this packet proves only the native/headless
   observer path plus the guard behaviour. No public transport, reconnect/DOM/scene lifecycle, or full sight-disclosure
   proof is made.
6. Native invested_stats has no source combatReadability powerRatio/power or display label/short equivalent.
7. Self-kill exclusion is not in the admitted corpus (documented gap in the witness evidence).
8. No protocol allocation, wire version, replay/schema variant, privileged runtime seam or deployment change exists here.

## No-inflation statements

- Exactly six admitted lifecycle cases and seven admitted helper cases were consumed, plus one new additive formatting
  corpus; no other corpus was regenerated, edited or counted.
- "21 passed" counts the six existing kill_augments tests plus our 15 new tests (11 lifecycle, 2 helper, 2 format); it is not a gameplay/coverage claim.
- The only compared lifecycle frames are the ones listed above; the blocked tail is not counted as PASS.
- Source hook-only probes are compared as facts, never counted as native producers.
- Helper/formatting rows are declared-input helper facts, never runtime lifecycle output or reachable game gains.
- No output was fabricated to make a frame pass: the birth-hold divergence is reported, not masked.
