# Potion healing fact proof — independent review

Independent read-only review of the test-only candidate at
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-potion-fact`, sealed at
`aa05af1c39b4245247187de167b657d32e785924`. This review did not modify or run Rust/tests/probes and did not contact the
worker. It verifies the candidate scope, code paths, same-sample comparator, and committed author receipts. This is a
bounded producer/accepted-frame fact proof, not a production feature or runner admission.

## Identity and inventory

The inspected worktree is clean at `aa05af1c39b4245247187de167b657d32e785924`. The commit contains exactly 17 paths:
the new 861-line test module, a two-line `#[cfg(test)] mod potion_fact_tests;` registration, and 15 files in the new
evidence directory. No production file was modified. The only existing source path is the test-only registration in
`crates/rh-policy/src/bots/mod.rs`.

The source manifest's complete 60-entry inventory was independently rehashed from this tree: 15 sealed files and 45
consumed/observed files, **0 missing and 0 SHA-256/byte-size mismatches**. The source/test/evidence identities are:

| File | SHA-256 |
|---|---|
| `crates/rh-policy/src/bots/potion_fact_tests.rs` | `a97e9c75bc850906dd106cca4b6a0951895ad91076cef85af21db94b0b0cc401` |
| `crates/rh-policy/src/bots/mod.rs` | `fd6c1badbe0fbedd065950f1a509fb8c4000431e5158005cea20b962b7def9a3` |
| `docs/evidence/bot-potion-fact-native/MANIFEST.json` | `b81f5699d892ff882f8c84316cd1a4b9abe84e3e86ca15115f82a08d9ee2a86e` |
| `docs/evidence/bot-potion-fact-native/README.md` | `efa62c6427174277dbdb3f2cd2f7b5dfd67293e53d03c87b10cd776e3b2a3317` |
| Source predicate `packages/server/src/bots/brain/runner.ts` | `345b94151ba4185736269acd782385a66d24cfaa50dafd75900cfad944c66164` |
| Native producer `crates/rh-sim/src/systems/potions.rs` | `5d13e52ba5745ddff6858c3f468c1bc6978ce32784b88eec9ac11413c6730244` |
| Accepted projection `crates/rh-sim/src/item_view.rs` | `d50df8818f6452daabff622c7ca8a68775ac248074add143c6805bf7e6c6f5a7` |
| Delivery commit `crates/rh-policy/src/delivery/session.rs` | `0fdb84eed7bbddc16d3309efe28c68afd57a23eced4f013264fcc0a16a866f2b` |

`MANIFEST.json` intentionally excludes itself and the later git-seal receipt from its own hashed membership. The
receipt `logs/11-git-seal-inaccessible-receipt.log` records the unchanged author HEAD, final file hashes and inability
to write the worktree git metadata; Root subsequently sealed this exact scope as the reviewed candidate.

## Source and producer path reviewed

The source consumer is exactly `(me.healingUntil ?? 0) <= now` in `runner.ts:29-35`; its healing-in-progress
complement is `healingUntil > now`. The native definition is `DEFINITION { heal_ms: 5000, step_ms: 500, concurrent: 3,
cap: 5 }` in `crates/rh-sim/src/potions/mod.rs`. The producer's use, HOT update/clear, fighter-out cleanup, and
validator paths are the unchanged `systems/potions.rs` entries bound in the manifest.

The `Seat` harness in `potion_fact_tests.rs:84-147` uses the real `ItemObserver::prepare_into`, a checked
`DeliverySession::prepare`, observer-offer commit and accepted `DeliverySession::commit`. Potion use goes through
`ItemObserver::resolve(PublicCommand::UseConsumable)`; that path calls the ordinary `validate`, and `Sim::submit`
accepts it. Sword/attack controls call `validate(RawCommand)` explicitly before `Sim::submit`. Trajectories advance
with actual `Sim::step` ticks. The only direct lifecycle mutation is the separately labelled real
`Sim::remove_player(OWNER)` missing-owner control.

The shared `check_healing_fact` comparator (`potion_fact_tests.rs:256-355`) checks an accepted frame only against a
trusted serialization of the exact current producer sample:

- accepted frame tick equals serialized `world.tick`, and accepted `source_time` bit-equals `world.server_time`;
- `inventory()` unavailable/missing remains an error, never count zero;
- delivered owner `potions_healing` equals both the serialized owner mirror and the number of serialized owner HOT rows;
- `potions_healing > 0` iff the trusted `healing_until > accepted source_time` predicate;
- no HOT rows imply both count and deadline are zero; otherwise the last HOT derives the stored deadline as
  `last.next + (left - 1) * DEFINITION.step_ms`, and every live HOT's next tick is after the accepted sample time;
- Ended phase is rejected before conversion, even while the predicate still happens to match.

The serialized `TrustedSample` is comparison-only. The comparator never feeds a trusted or expected result into the
simulation, observer or accepted frame. Negative controls mutate only copies of a captured sample or pair a real later
accepted frame with the earlier sample; the later frame's own same-sample mirror passes.

## Trajectories and controls

1. **Real overlapping HOTs, expiry, restore:** accepted active samples progress from fresh owner false, through three
   real uses and counts 1/2/3, then the first HOT expiry (two remain), next expiry (one remains), and exact final expiry
   (zero). Every HOT retains its individual final expiry identity. A checkpoint serialized at accepted tick 10 is
   restored, and its continuation reproduces the same accepted counts, deadlines and absolute expiry sample clocks.
   The author explicitly disclaims that the future runner's own no-heal predicate would submit overlapping uses; this
   proves only producer representation under real accepted uses.
2. **Non-Ended fighter-out:** a real validated sword attack downs the low-HP owner while the three-player run stays
   Active. `fighterOut` clears the HOT row, owner count/deadline and accepted inventory count, and the next Active
   sample remains false.
3. **Ended counterexample:** a real two-player run ends on an owner's validated sword swing. Immediately after Ended,
   retained HOT count and future deadline still agree, but the comparator refuses the phase. At the real later Ended
   sample, the retained deadline is past and count remains nonzero, demonstrating that `Ended` must stay outside the
   conversion domain. `Sim::restore` accepts the genuine Ended checkpoint with that elapsed retained HOT; the proof
   does not narrow restore rules.
4. **Removed owner:** real active-run `remove_player` clears HOT producer state. The owner inventory arrives as
   `Fact::Delivered(None)` on a still-Active frame and the comparator returns unavailable/error rather than false.
5. **Comparison controls:** wrong HOT count, wrong tick, wrong clock, wrong deadline and stale-sample pairing are each
   rejected; the later actual frame paired with its own current sample is accepted.

The exercised positive domain is the actual Active trajectory after the scheduled HOT update; this review makes no
claim for Lobby or Planning samples. The comparator explicitly rejects Ended and the positive tests keep their active
run separate from the Ended counterexample.

## Receipt review and disposition

The committed focused log `docs/evidence/bot-potion-fact-native/logs/04-focused-potion-fact-tests.log` reports 5/5
passed. The overlapping existing receipts report delivery 33/33, trade 6/6 and fair-percept14 9/9; format and default
plus all-feature all-target Clippy logs exit 0. First compile, format, Clippy and test-assertion failures are retained
separately rather than relabelled as successes. I did not rerun any command.

**RELEASE for the bounded test-only accepted-fact proof.** It establishes that, in exercised Active accepted owner
samples after normal producer updates, the delivered `potions_healing > 0` predicate matches the trusted producer
`healing_until > Frame14.source_time`, with sample pairing, HOT mirror/deadline, cleanup, expiry, restore, Ended and
missing-owner boundaries guarded. It does not add a runner, potions retry clock, public/wire fact or activation; it
does not prove adapter queue acceptance or later command acceptance; it does not infer an absolute deadline from the
boolean; and it is not a full-workspace test or campaign result.

## Root integration verification

Root integrated exact seal `aa05af1c` as `ae29dc1b93779e0e7becf25adf30ce328901feaa`, then ran the focused
`cargo test -p rh-policy --lib potion_fact_tests --locked --offline -j 1 -- --test-threads=1` on that combined code.
Result: **5 passed, 0 failed, 228 filtered**, test0.10s, wall65.09s including compilation, exit0. The adjacent
`root-integrated-test.log` records the exact command/cwd/HEAD/environment and output. It uses pinned Rust1.97,
Root's existing `target/root-strategy-notice-admission/build`, incremental0 and no RUSTFLAGS. Only docs advanced
during execution. This independently verifies the focused proof after combination with the admitted Hand seam;
it does not relabel the author's other overlap/lint runs as Root executions or broaden the Active-sample domain.
