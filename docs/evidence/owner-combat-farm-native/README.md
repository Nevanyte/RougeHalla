# Owner-combat farm mirror — native consumer

Status: PASS. One bounded actual native consumer of the sealed farm source corpus, implemented as a
test-only module. No production rule, schema, protocol/version, content, tape, status, Cargo.lock,
client, cloud or native admission file was changed; no other campaign was run.

## Base / branch / worktree

- Base: 1ddad5d63f7016e65d3eddaa5bd47082c3a3710f (exact root requested by Root).
- Branch/worktree: deepseek/farm-native-consumer in
  /Users/nevinmckinnon/Documents/Projects/RogueHalla-farm-native-consumer.
- Sealed source addition: commit 9800a34c57ce12d43d84fdc210313934e382ad79, copied only as its 30
  tools/owner-combat-farm-fixtures, parity/policy/owner-combat-farm and
  docs/evidence/owner-combat-farm paths. The frozen author branches/corpora were not edited and their
  sealed files are byte-identical.
- Sealed farm corpus: parity/policy/owner-combat-farm/source.json, 1,250,830 bytes,
  sha256 9cbb71b162a6bf36b5b4445cd4ca4bb5ab5e3c6559279467153e9ee9d7a62228,
  captureSha e15c3bc4bfaad9850a0d9cfe72e4de757742d18c1bf089c6b382394bab4725c3.

## Code added (test-only)

- crates/rh-sim/src/owner_combat/farm_source_tests.rs (360 lines, sha256
  82758046c8bedd5a5ecdad9f054db78145d3c446b38c88b1c28f49fef1e921df): one #[test]
  actual_native_farm_kill_earns_attack_speed_mirror.
- crates/rh-sim/src/owner_combat.rs: only #[cfg(test)] mod farm_source_tests; (+3 lines); no
  production module change.

## Method (declared setup only; actual outcomes from native stepping)

- Native real mapgen pipeline: generate_styled(seed 20261101, attempt 0, default options); the native
  resulting map hashU32 is asserted equal to the sealed setup map.hashU32 3435915058, width/height 160,
  camps 50. The admitted map layers are used through their real MapExport validation and are built into
  the real Arena.
- Native Sim::reset_active with config min_players 3, lobby/fill 0, pvp_rules true, weapon_specials
  true, regen true, hazards Map, mob_mode Pve, complete faction mode/abilities, Source arena lifecycle
  (patience 3600 no timer in this window). This is the ordinary nontraining PvE world.
- Seats/positions/initial HP are the sealed setup values (owner plague at 2436,3568; allies frost/holy
  at 2736,2640 / 2640,2736, kept alive). Secrets: orderSalt from the sealed source mulberry32(8) first
  draw (671282643), spawn seed = its state after that draw, rewardSalt [1,2,3,4].
- The real ground rack is seeded at the declared owner position with a wand through the real
  seed_weapon_container API. The sealed source rack alias is c12; the native engine assigns its own
  container serial, so the ordinary pickup input binds the native actual rack id. The source ground
  rack position/loadout is setup, not an outcome.
- The sealed target alias mob36 is bound through the real native camp roster by ActorOrigin camp 20
  (0-based camp index) spot 0, which is asserted to be a live nonelite PlagueRat; native actor serials
  are not assumed equal to source serials. No target HP/status/death/farm/mirror is written.
- Source actions at step 1 (pickup rack) and step 4 (ordinary target order) are submitted through
  crate::validate + Sim::submit (C-INPUT); the test then steps the real Sim for steps 1..=135.
- The native consumer compares every recorded source frame (135 frames): source/native public owner
  lock, host drawStartedAt/readyAt, decoded clocks via the checked owner projection, wire and decoded
  asMult/windupMult/speedMult rows, status, weapon slots, farm count and the current-entitled identity.
  It also checks the actual native death event, target dead state, farm count 3 and projected asMult
  1030 on the kill step.

## Result

- cargo test -p rh-sim --lib owner_combat::farm_source_tests: PASS, 1 passed / 0 failed, exit 0.
  Output: "owner-combat farm: 135 sealed frames replayed, rack c12, target mob36 killed, farm 3,
  asMult 1030".
- The actual native kill is step 105/frame 104 (source serverTime 5300): the target native actor is
  dead, the native death event is emitted, owner.farm.count(PlagueRat) is 3, and the checked owner
  projection asMult is 1030. The target's farm is not installed anywhere in the test.
- cargo fmt --check: exit 0. cargo clippy -p rh-sim --lib --tests --no-deps: exit 0 (no warnings).
- Actual source/native numeric normalization: decoded u32 clock fields and all mirror thousandths are
  exact; the canonical host f64 clocks/hp use an explicit 1e-8 absolute comparison for source JSON
  doubles vs native f64 computations, with no blanket epsilon over decoded or mirror fields. Map hash
  and frame/step counts are exact.

## Correction carried into this evidence (original sealed README/corpus preserved unchanged)

The sealed farm README's kill wording is superseded here: the kill pass's first owner wand hit
(applied 2.3502824858757068) removed the target's remaining 1.2313904974938321 hp. The recorded
7.287056304148811 hitLanded is the same pass's second/signature disease share, not a unique lethal
first hit. The two disease-tagged callbacks observe the victim already dead after the combined ledger
subtraction; kill.lethalHit is the last-dead callback, not uniquely the first hit. This is a wording
correction only; the sealed source corpus and README at 9800a34c were not modified.

## Existing source mutants

The sealed farm source controls (01 writeMirrors asMult omit KILL, 02 provenance-only SURVIVOR,
restored control PASS) are already sealed evidence and were NOT rerun or overclaimed here. Their
disposable method remains one restored disposable checkout with a fresh Node per variant; this native
consumer does not claim to repeat them.

## Limits

- Test-only native consumer/source-projection proof: no native public-field admission, protocol,
  Room/socket/join, Unity/DOM/rendering, headless-digest or tape change.
- One generated map seed/attempt and one actual camp-20 nonelite PlagueRat kill; not a whole-map,
  workspace, previous-owner or quest campaign.
- The source capture's private fixture data is not public wire; native public entitlement is still
  gated by the current observation and no hidden identity is added.
- No production rules, schemas, protocol/version, content identity, status, Cargo.lock or client edit;
  Root owns merge/admission.
