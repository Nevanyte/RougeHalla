# Quest backend Stage0 — source tour-supply repair

Status: STAGE0 IMPLEMENTED AND LOCALLY GREEN; CONTENT-PIN ADMISSION PENDING ROOT. Frozen source and tools
are unchanged. Stage1 is not started.

## Identity and scope

- Worktree: /Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-quest-runtime
- Branch: codex/deepseek-quest-backend
- Source-only commit consumed: a3d8e8d499d38bcb5972bceb6e85a8bab1f1d619 (base 4151b3af)
- Frozen corpus: parity/quest-tour-supply/source.json 638,109 bytes
  0bb63ed402b411d4f9bf23381fa162e64e08f5704905f974e3920c982fae5714
- controls.json 1,260 bytes 64d9b5e50b61964853ae95d0d4b057392b83e344d3874731003dc914e0b601db
- No source/parity/tool/Cargo.lock/shared-status edit; no source rerun. This Stage0 commit changes only:
  quests/live.rs (stored-mask repair), quests/mod.rs (test module), NEW
  quests/tour_supply_source_tests.rs, quests/catalog.rs (approved appended marker), and this evidence directory.

## Production repair

In live::close_impossible the tour branch previously read visits as mask.count_ones() and then used that count as
the visited-region bitmask. It now uses the stored mask itself. No other production change: no refactor, no new
state, no version/schema/wire/checkpoint change.

## Catalog identity marker

After the unchanged twenty-row fold in catalog::visit_content, the approved text marker
tour-supply/visited-region-mask/1 is appended with length as u64 and each UTF-8 byte as u64, after all
pre-existing fold words. Resulting content hash: 8edd862f48ffa100 (previous 7c6a633f68c2cc72).

Exact existing pin hunk now needed; it was REPORTED, NOT EDITED, because Root scope allocation is separate:
  parity/abilities/hash-tape.json:258
  - "contentHash": "7c6a633f68c2cc72",
  + "contentHash": "8edd862f48ffa100",
The focused hash-tape test currently fails only at that assertion (left old pin, right new actual); its expected
failure receipt is stage0-content-pin-expected-failure.log. No case-fold pin was edited or re-recorded.

## Native consumer and exact profile

The consumer uses normal Sim::new -> add_player(profile, Some(faction), bot) -> ordinary first step, then real
validate + Sim::submit for captured inputs and the existing real mob_life::hurt/pay_all producer for the declared
supply batch. It never calls close_impossible/killSupplyLeft directly and installs no progress, visits, recheck,
status, giver/container or expected reward.

Recorded source profile mapped explicitly in this test (not default-Off equivalence):
- lifecycle Source rules: plan0, first patience None, no coliseum schedule, patience3600/min3600, sudden3600;
- abilities Full; hazards Map; mobs Pve; quests on; pvpRules false; training/dummies false;
- signatures:false -> faction foundation Off; walkHints:false; initial loot true; consumables default true.
- orderSalt and rewardSalt from capture; native spawn seed is the captured source randomSeed(12), because source
  startRaid's shuffled player assignment draws from source world.random. The separate captured spawnSeed field is
  not that stream. This was a consumer seed-mapping correction, not a production gameplay discrepancy.

Temporal/reward mapping details:
- mobHp uses the frozen mob's direct x/y; wipe targets use at{x,y}; both bind the captured source mob id through
  retained ActorOrigin::Mob birth_serial (base36), then validate type/kind/catalog zone/elite and camp as
  source one-based vs native zero-based (native camp +1). No nearest-sibling or substitute mob.
- The declared wipe batch passes empty explicit contributors (by:None) but never clears brain threat. Rust
  hurt naturally folds existing threat and queues the credited award; direct events are retained and delivered at
  the next ordinary step. This yields the source's natural credited GV/farm and notices.
- Source public visitedRegions string/absent-numeric0 is compared as a public representation derived separately
  from native internal visit mask; it is never treated as the mask/count.
- Event::PotionNotice.message() is mapped to the captured source toast envelope (representation mapping, not a
  synthesized alert). Ordered Toast/quest-GV notices are compared by tick, time, recipient/audience, text and
  order, not only by count.
- Supply counts/composition use mob_catalog type.zone exactly as close_impossible; giverPresent checks the actual
  living giver actor; containers check actual item/container existence.
- Initial constructor frames/positions/HP are compared (no reset_active override); with the corrected spawn
  stream they match. Pre-recheck captured progress1/Frost visited and case-specific actual GV/farm are retained by
  the real native equality checks; no hardcoded 12/6 source fallback is imposed for both cases.

## Red/green receipts

Prior limited-profile receipts (preserved; before the full source mode mapping):
- stage0-red-both.log: both exact status failures at tick5/time250 before the mask repair.
- stage0-green-both.log: both pass after mask repair with that limited profile.
- stage0-pre-marker-quest-suite.log: existing quest gate 34 passed/1 ignored.

Final source-profile receipts:
- stage0-profile-red-original-predicate.log: original count_ones predicate restored; case0 native expired vs
  source open; case1 native open vs source expired; 2 failed, 0 passed.
- stage0-profile-green-final.log: stored-mask repair restored; both cases pass.
- stage0-profile-green.log: full-profile green before the final red/green sequence.
- stage0-final-quest-gate.log: final focused quests:: gate 34 passed, 1 ignored, 0 failed.
- stage0-content-pin-expected-failure.log: expected old-content-pin failure described above.

No unrelated constructor or gameplay discrepancy was forced away in the final profile. No expected/source value
was edited. Stage0 remains separate from any Stage1 objective/reward extraction.

## Limits

Content-pin admission and any case-fold re-record remain Root-owned. No wire/version/Cargo.lock/shared status
edit, Stage1 extraction, Unity/network/protocol/World/checkpoint change, merge/push or native/live disclosure.
The frozen source fixture/tools remain byte-identical.
