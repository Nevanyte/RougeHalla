# Bot reset source-stream repair

Bounded root packet on base 95bd9c1efcde9b71cb07f23f24aef8ff4fb17013. Code commit
6a2d8418a7a745db76af17a5b0ef7753046dce73 installs the source brain stream wiring in the live HumanBot.reset; the
evidence commit that adds this file is separate. Only crates/rh-policy/src/bots/bot.rs and its new source-specific child
reset_stream_tests.rs were changed. No source fixture, random implementation, humanizer, fight/strategy, protocol,
Frame/ActorRefs, server/client, canonical, content, version, tape, status or Cargo.lock edit.

## Source contract

Existing immutable source fixture parity/policy/bot-knowledge-repair.json sha256
a97293e2ec3e8a9e5e0dcac985c4b80b84f21caa447390931c00ad39ba40266b records the wiring anchors
packages/server/src/bots/brain/brain.ts lines 141-147:

  decide: mulberry32(derive(cfg.seed, 0))
  motor:  mulberry32(derive(cfg.seed, 1))
  lapse:  mulberry32(derive(cfg.seed, 2))
  Knowledge: mulberry32(derive(cfg.seed, 3))

Source cfg.seed is 32-bit. The port keeps its existing low-32 convention: all four streams use seed as u32, and the high
half of MatchStart.seed is not treated as a source input. Native random::derive, Rng and Knowledge are unchanged and
already source-proved; this packet only corrects the live reset wiring.

## Repair

HumanBot.reset previously used custom XOR/multiply seeds (motor seed ^ 0x9e3779b9, lapse high-half ^ 0x85ebca6b, and a
custom decide_seed formula). It now sets:

  decide = Rng::new(derive(seed as u32, 0))
  motor  = Rng::new(derive(seed as u32, 1))
  lapse  = Rng::new(derive(seed as u32, 2))

Knowledge remains independent Rng::new(derive(seed as u32, 3)). Reset consumes no decision/motor/lapse draws. The obsolete
decide_seed helper and tests pinning it were removed/replaced; the existing Knowledge regression now checks the source
tag0 decision stream.

## RED then GREEN

The new source-based wiring control was first run on unchanged production. Its first semantic assertion was:

  seed 0 tag 0: live reset stream seed
    left (old reset): Rng { state: 458671337 }
    right (source):   Rng { state: 520022130 }

After the repair the focused source tests pass: 4 passed, 0 failed. See logs/red-unchanged-production.log and
logs/focused-green.log.

## Tests and controls

New reset_stream_tests cover:
- all 16 immutable tag0-3 source seed vectors from the existing fixture;
- live reset's decide/motor/lapse initial Rng state plus first and later draws against the source-seed stream (no table
  built from the repaired reset formula);
- Knowledge from independent derive(seed, 3), unchanged;
- no decision/motor/lapse draw consumption during reset;
- reset/cross-seat determinism and reset-after-use restoring the source streams;
- explicit low-32 seed domain (seed 0 and its +2^32 high-half companion have identical source streams/Knowledge).

All rh-policy tests after the repair: 140 passed, 0 failed; doc-tests 1 passed. Existing real sync/async delivery and
intake controls still pass, including temporal_tests::synchronous_and_async_feed_do_not_depend_on_decisions_or_raw_event_presence
and the Frame14 delivery tests. Logs are tracked under docs/evidence/bot-reset-streams/logs/.

## Commands / hashes

Build used root final-env.sh, one private target, CARGO_INCREMENTAL=0, CARGO_PROFILE_DEV_DEBUG=0, jobs 1. No
workspace/Editor/Docker/recapture campaign was run.

Tracked hash receipt (also logs/sealed-git-hashes.log):
- git show 6a2d8418:crates/rh-policy/src/bots/bot.rs -> sha256
  8b4f0a8304bd2b10b4c929ec526e372805e6d6b6ea40d3effe0dfc4e8688872d
- git show 6a2d8418:crates/rh-policy/src/bots/bot/reset_stream_tests.rs -> sha256
  befeddcc23b2160200abc4fd182f68fb2b666250b24d393b44388d3a564d0136
- git show 95bd9c1e:parity/policy/bot-knowledge-repair.json -> sha256
  a97293e2ec3e8a9e5e0dcac985c4b80b84f21caa447390931c00ad39ba40266b (same as current worktree)
- fmt --all -- --check exit 0; cargo clippy -p rh-policy --all-targets --all-features -- -D warnings exit 0.

## Limits

1. This proves the live reset stream wiring only; it makes no full brain, decision-quality, fight or strategy claim.
2. No source fixture or random algorithm was changed; native random/derive/Knowledge remain the existing source-proved
   implementation.
3. No broader policy cleanup or workspace campaign was performed. Root owns review/merge/admission.
