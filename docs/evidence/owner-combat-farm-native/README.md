# Owner-combat farm mirror — corrected native consumer

Status: PASS after the bounded review corrections. This is the follow-up to sealed native commit
4ecfb6cdb13908319be20807249667c12bac0416 (which remains immutable in Git history). The real native
producer path is unchanged; the consumer contract, portable evidence and wording are corrected.

## Base / branch / sealed inputs

- Follow-up base: 4ecfb6cdb13908319be20807249667c12bac0416 (sealed native consumer).
- Exact source root: 1ddad5d63f7016e65d3eddaa5bd47082c3a3710f plus only the sealed farm additions from
  9800a34c57ce12d43d84fdc210313934e382ad79.
- Branch/worktree: deepseek/farm-native-consumer-repair,
  /Users/nevinmckinnon/Documents/Projects/RogueHalla-farm-native-consumer-repair.
- Code head in this receipt: 76b57df2525392abcf571cf9452d255d852e9c8d (test-only correction commit).
  The final evidence commit is the branch head containing this receipt; Root is given the exact head.
- Sealed farm corpus remains byte-identical: parity/policy/owner-combat-farm/source.json, 1,250,830 bytes,
  sha256 9cbb71b162a6bf36b5b4445cd4ca4bb5ab5e3c6559279467153e9ee9d7a62228,
  captureSha e15c3bc4bfaad9850a0d9cfe72e4de757742d18c1bf089c6b382394bab4725c3.
- Original source README/corpus at 9800a34c and original native evidence/test at 4ecfb6cd are not
  modified. Every receipt payload quoted by the review is verified with git show from the sealed commit
  into sealed-payloads.txt (blob id + git-object content hash), not from a worktree copy.

## Code correction (test-only)

Only crates/rh-sim/src/owner_combat/farm_source_tests.rs changed in code:
- bytes: 13572; lines: 371; sha256:
  a86b11819b31374e84d157e29466a17138e0a4e97c55d272ba164fb2c37916df.
- The cfg(test) module declaration and all production bodies remain unchanged from the sealed base.

The consumer now compares:
- serverTime, canonical drawStartedAt and maxHp exactly on every one of 135 frames.
- readyAt and hp exactly on every frame as well. This was attempted exactly and passed; no numeric
  discrepancy was found and no tolerance/normalization remains for those fields.
- decoded u32 draw/ready clocks and all three mirror thousandths exactly (unchanged).
- the full typed farm map on every frame rather than summed totals: empty for the first 104 recorded
  frames, then exactly plagueRat=3 for the next 31; extra native types or wrong per-type counts are
  rejected. The actual kill step/died target death event and PlagueRat=3/asMult=1030 before/after
  assertions are retained; nothing is installed in Sim state.
- canonical target and current-entitled projection, owner status/weapons/slot and the real map/hash,
  seeds/config/placements/RNG/rack/target bindings as before.

No normalization is recorded because none is needed. Source/native host scalars are bit-identical for
serverTime, drawStartedAt, readyAt, hp and maxHp on this corpus; decoded clocks/mirrors are exact.

## Portable logs and sealed payload correction

The original ignored logs from the sealed native run are now tracked under logs so a checkout/archive
of this branch verifies them:
- logs/sealed-4ec-cargo-test.log sha256 0dce9b9395645b7d2a7588827793464165150e833eb19603fc5a3bca8cd30684
- logs/sealed-4ec-clippy.log sha256 c92508a29848820f033cd2ea015c85dde0953c88b07cc967ce34b7c08f610549
- logs/sealed-4ec-fmt-check.log sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
- logs/corrected-cargo-test.log sha256 5a80bf5bb58c424c2608c6effc87f2bfbc946d9ceb8341fd66964be5ddce1f21
- logs/corrected-clippy.log sha256 418de69fb939e16f8eabc5fe9bcbe7bf205b8894071126c06b42326310f006ff
- logs/corrected-fmt-check.log sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

sealed-payloads.txt records, via git rev-parse/git show from 4ecfb6cd and 9800a34c, the exact blob ids
and content hashes of the sealed receipt, README, SHA256SUMS, old test and owner_combat.rs, plus the
sealed source tool/corpus/README payloads used at admission.

## Verification

- cargo test -p rh-sim --lib owner_combat::farm_source_tests -- --nocapture: PASS 1/0. Output:
  "owner-combat farm: 135 sealed frames replayed, rack c12, target mob36 killed, farm 3, asMult 1030".
- cargo fmt --check: exit 0. cargo clippy -p rh-sim --lib --tests --no-deps: exit 0, no warnings.
- Private target /tmp/farm-native-target, jobs 1, test debug 0; rustc/cargo 1.97.0. No broad campaign,
  recapture, mutant rerun or workspace run.

## Lethal wording boundary

The new prose does not attribute the kill to a uniquely first hit. The owner-sourced combined
disease/execute ledger pass killed the target; the two disease-tagged callbacks both observe the victim
already dead after the combined ledger subtraction, and derived kill.lethalHit selects the last
dead-status callback. The earlier sealed source README/corpus wording remains untouched and immutable;
this correction is the new evidence boundary only.

## Existing mutants / limits

The sealed farm source controls (writeMirrors asMult-omit KILL, provenance-only SURVIVOR, restored PASS)
are preserved and were not rerun or overclaimed; their one-restored-disposable-checkout/fresh-Node-per-
variant method is unchanged. This remains one seed/camp test-only native consumer; no native public
admission, protocol/Room/socket, Unity/DOM, headless digest/tape/status or workspace campaign. Root owns
merge/admission.
