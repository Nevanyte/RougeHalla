# Quest human-eligibility source evidence (P-QUEST-HUMAN-ELIGIBILITY)

Source-only evidence for the legacy quest guards that exclude fill bots from every quest entry point. This packet
supports the GPT-owned native fix 2de68ba5 and does not implement or mirror that fix in Rust. It adds only
tools/quest-human-eligibility-fixtures/**, parity/quest-human-eligibility/** and this evidence file.

## Base, branch and commits

- Immutable continuation base: f034ace7d1f6617ed64a1eb194469e0b4531caa9.
- Branch: deepseek/quest-human-eligibility.
- Capture/tool commit: a43120036a5ef4281b786640952b45d92e013d44 (test: capture quest human eligibility source witnesses).
- Evidence commit: the commit that adds this README; resolve it with
  git log -1 --format=%H -- docs/evidence/quest-human-eligibility/README.md.
- Packet head at review: git rev-parse HEAD on this branch (the evidence commit unless a later evidence-only commit lands).

## Declared world and seats

The capture runs the real createGameWorld production module order from packages/server/src/sim/gameplay.ts: quests on,
mobs on, signatures off, walkHints off, map generateMap(1, attempt 0, {decor:false}), world random mulberry32(12), reward
salt [1,2,3,4], declared newItemUid sequence. The ordinary 50 ms step() and the real enqueueClientMessage/InputQueue path are
used. The standard seats are p0 human holy, p1 bot fire and p2 human plague; the camp-clear pair uses p0 human holy and
p1/p2 bots. Every seat is declared with addPlayer(..., {faction, bot}); bot seats are declared directly with bot:true and never
connect a profile or join. Player x/y, hp and weapon changes are explicitly labelled per case.

Ordinary cases install no expected offer, acceptance, progress, ready state, reward or toast. The camp-clear producer is the
real whole-region killMob path (the same product path used by tools/quest-fixtures/lifecycle.mts), with no credited killer.
The bot-only camp world leaves the human through a real player sword kill, never by mutating a seat flag mid-run.

## Corpora and hashes

Canonical serialization is JSON.stringify(corpus) + "\n" (compact JSON plus one newline). The pinned image is
node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292, platform
linux/amd64, Node v22.23.4. Setup is npm ci --ignore-scripts --no-audit --no-fund and node --import tsx. The repository is
mounted read-only at /repo; the tool directory is read-only at /capture; the corpus output is /out (read-only for --check).

| file | bytes | sha256 | captureSha256 |
|---|---:|---|---|
| parity/quest-human-eligibility/ordinary.json | 100431 | bc1630f1999f4c6b3613bebda0ec6e7c192442ba53719e5dad83cf3a9667b809 | b4da16ca28aae591ac5b2a3badedbfd6d49cdd02f6ac3002f7d43220e80eb99a |
| parity/quest-human-eligibility/diagnostic.json | 38981 | 51f641fcc69b4331ae718b5a6d2e9aab10d98cfff17b68d56e80ceefbb3c6838 | b0fe57629ae79167399f7346609fc79ab3abe2f9abec21bed9d3ae6d70dda640 |
| parity/quest-human-eligibility/manifest.json | 4994 | eef0accea8a91fc478a0f7607c53b09d3b1fab083bb5df61450eef75a26b0c6c | n/a (manifest) |

These are the post-safety-correction hashes (tool-hash-only recapture; see CORRECTION.md). The previous values
cbf2b1fe/aee0b6f0/d8bdc03d are recorded there with the exact allowed metadata difference: only the two run-mutants*.sh
tool hashes and the derived profile.captureSha256 / manifest file metadata changed; every ordinary, unreachable,
diagnostic and event value is identical semantically.

Counters: 6 reachable ordinary cases, 3 explicit unreachables, 2 diagnostic cases, 27 frames and 45 relevant events. The
internal TypeScript runtime-import closure has 125 files and closureSha256
a8e3333a712372deed1695fc251c7ead565d1b4ea0db22a89a73793ec2ca01b0. package-lock.json is 153409 bytes with sha256
991869bdfbbefb6874220500197c61db302a4d2b2603dfc2288fd7032ce1d481. Dependency versions: tsx 4.23.15, typescript 7.0.2,
esbuild 0.28.2, @colyseus/schema 5.0.42. Tool hashes are in manifest.json provenance.tool; each corpus profile also carries
the config pins, tool pins, source closure and exact source anchors.

## Source guards (exact path:line)

| guard | path:line |
|---|---|
| takesPart (bot exclusion) | packages/server/src/sim/quests.ts:60 |
| accepted | packages/server/src/sim/quests.ts:63 |
| onQuestPickup entry | packages/server/src/sim/quests.ts:147 |
| onQuestPickup takesPart guard | packages/server/src/sim/quests.ts:150 |
| handleQuestAccept entry | packages/server/src/sim/quests.ts:190 |
| handleQuestAccept takesPart guard | packages/server/src/sim/quests.ts:192 |
| generic loot fallback toast | packages/server/src/sim/loot.ts:157 |
| onMobKilled | packages/server/src/sim/quests.ts:221 |
| onPlayerKilled | packages/server/src/sim/quests.ts:247 |
| standing (alive, takesPart, up, unresolved) | packages/server/src/sim/quests.ts:274 |
| ready | packages/server/src/sim/quests.ts:277 |
| completeQuest | packages/server/src/sim/quests.ts:306 |
| expireQuest | packages/server/src/sim/quests.ts:326 |
| killSupplyLeft | packages/server/src/sim/quests.ts:361 |
| killSupplyLeft standing guard | packages/server/src/sim/quests.ts:367 |
| closeImpossible | packages/server/src/sim/quests.ts:395 |
| publishAt head start | packages/server/src/sim/quests.ts:454 |
| private questReveal | packages/server/src/sim/quests.ts:456 |
| reveal finder standing guard | packages/server/src/sim/quests.ts:447 |
| reveal tieRank | packages/server/src/sim/quests.ts:449 |
| turn-in standing/ready guard | packages/server/src/sim/quests.ts:469 |
| turn-in completion | packages/server/src/sim/quests.ts:475 |
| reveal radius | packages/shared/src/constants.ts:627 |
| reveal head start 4000 ms | packages/shared/src/constants.ts:629 |
| turn-in range | packages/shared/src/constants.ts:631 |
| addPlayer seat | packages/server/src/sim/step.ts:30 |
| p.bot = opts.bot | packages/server/src/sim/step.ts:39 |
| tieRank (lower wins) | packages/server/src/sim/world.ts:1082 |
| killMob producer | packages/server/src/sim/mobLife.ts:166 |
| campCleared hook | packages/server/src/sim/camps.ts:88 |
| onCampCleared recheck | packages/server/src/sim/quests.ts:352 |
| recheck flag | packages/server/src/sim/quests.ts:353 |
| collect tokenSpawns 5 / count 3 | packages/shared/src/quests.ts:137 |
| one-contest token comment | packages/shared/src/quests.ts:47 |

The exact anchors with their source text are also in every corpus profile.sourceInventory.

## Ordinary cases (source-written outputs)

1. Hidden discovery, bot then human. Target cull-fire (quest7k). Ten hidden offers at start. With only bot p1 inside
   QUEST_REVEAL_RADIUS, two ordinary steps leave finder empty, publishAt 0, no questReveal, no toast and no public row;
   unknownQuests stays 10. After the bot leaves and human p0 enters, the human is the finder, publishAt is 4200
   (now + 4000), the private questReveal goes to p0 only with {id: quest7k, def: cull-fire, x: 4624, y: 4880,
   expiresAt: 0}, and the toast is "Quest discovered: Cinder Cull (Ashmother Vela)". The public row is still absent
   at the reveal and one tick before the head start; at 4200 it publishes, unknownQuests becomes 9, and the announcement is
   "name0 revealed quest: Cinder Cull".
2. QuestAccept, bot then human. Target shards-frost (quest75). The bot's real questAccept message is silent: accepted
   empty, expiresAt 0, no toast or event. The standing human at the same giver is accepted, expiresAt becomes 180150 and the
   toast "Quest accepted: Shards of the Watch" goes to p0; the public row stays open.
3. Collect pickup, bot then human. Target ashcap-fire (quest7c), token container c7e with item uid U46
   def quest:quest7c. The bot at the token gets the source's generic "Nothing to take" fallback; the container and item
   remain, progress stays empty and carrier stays empty. The accepted human p0 picks the same token: progress p0 = 1,
   container c7e is removed (global quest container count 70 -> 69), and the toast "Ashcaps: 1/3" goes to p0.
4. Fetch pickup, bot then human. Target banner-frost (quest7o), parcel container c7q with item uid U52
   def quest:quest7o. The bot gets "Nothing to take"; the container remains and carrier stays empty. The accepted human p0
   picks the parcel: carrier becomes p0, carried contains [p0, quest7o], the container is removed (70 -> 69), and the toast
   "Picked up: The Frozen Standard — carry it to Skald Runa" goes to p0.
5. Camp clear, bot-only standing. Target cull-fire (quest7k, region fire). The human reveals and publishes the offer, then
   the declared bot p1 kills the human with a real sword attack; the run stays active with two standing bots and zero standing
   humans. The real whole-region killMob producer clears all 44 live fire-region mobs. With no standing human the source leaves
   the offer open: status open, no changed statuses, no expiry toast, unknownQuests 9. This is the source's "nobody is
   standing, nothing to close early" branch.
6. Camp clear, standing accepted human. Same seed and declared seats. The human reveals and publishes the offer, accepts it
   at the giver (accepted [p0,true], expiresAt 154150), then the same 44-mob whole-region producer runs. The source closes the
   offer: status expired, closedAt 4200, public expiresAt 4200, changed is cull-fire open -> expired, the announcement is
   "Quest expired: Cinder Cull" and unknownQuests stays 9.

## Explicit unreachables (ordinary producers only, no forged state)

- Two humans on one collect offer (ashcap-fire, quest7c). Both accept. p0 takes 3 tokens, p2 takes the remaining 2:
  progress p0 = 3, p2 = 2, p0 ready, p2 not. The catalog has tokenSpawns 5 for count 3; two full sets need 6. The source
  guarantee is "always more than count, so one contest does not starve the offer", not a second full set.
- Two humans on one player-kill offer (headhunter, quest72). Both accept. The real sword kill gives p0 the only credit:
  p0 progress 1, ready and completes (status done, doneBy name0); p2 is dead, resolved, progress 0 and cannot be a standing
  ready turn-in contender. onPlayerKilled at quests.ts:247 bumps only the killer. This is a real producer, not a forged case.
- Two humans on one fetch offer (banner-frost, quest7o). Both accept. p0 becomes the single carrier; p2's pickup gets
  "Nothing there" and the one parcel container is already gone. The offer has one carrier field and one parcel.

Two simultaneous ready humans on a kill offer is therefore not a normal reachable state in these bounded ordinary runs; the
player-kill case shows why (the only progress producer removes the victim). No state was installed to fabricate it.

## Diagnostics (malformed-state controls; not ordinary gameplay)

Both cases are labelled DIAGNOSTIC in diagnostic.json and must not be read as normal-history claims.

- Forged-accepted bot cannot pick a token or parcel. The bot's accepted (and, for the collect offer, progress 1) state is
  written directly to the source state, bypassing the real accept door. Its ordinary pickup still returns false at
  onQuestPickup (quests.ts:150), so the token container remains, progress stays 1, the parcel container remains, carrier
  stays empty and carried stays empty. The actual output is the generic "Nothing to take" toast, not a quest toast.
- Forged-ready bot cannot win the actual automatic turn-in. The human path is ordinary: accept and pick all 3 ashcap-fire
  tokens. The bot is then forged accepted and progress 3. On selected tick 6, botRank is 0.6581209043506533 and humanRank
  is 0.8390772154089063. tieRank is lower-wins, so the forged bot would win if improperly admitted. The source still
  completes with doneBy name0, human quest GV 10, bot quest GV 0 and the real "Quest complete: Ashcaps" toast. The
  malformed bot is excluded by standing at quests.ts:274 and the turn-in guard at quests.ts:469.

## Semantic mutants (pinned recapture, actual named differences)

run-mutants.sh mounts /repo read-only, copies it to a writable /tmp/repo, applies one exact patch at a time and recaptures
the real corpora. A compile/syntax/runtime failure is not accepted as a kill. compare.mjs skips only /profile (the mutated
source hash necessarily changes) and reports the first JSON-path mismatch.

| mutant | named first mismatch |
|---|---|
| 01-reveal-bot-finder | ordinary.json /ordinary/0/frames/1/target/private/publishAt expected=0 mutant=4100 |
| 02-accept-bot | ordinary.json /ordinary/1/frames/0/target/public/expiresAt expected=0 mutant=180100 |
| 03-pickup-bot | ordinary.json /ordinary/2/events/0/text expected="Nothing to take" mutant="Accept Ashcaps at Cook Farrell first" |
| 04-camp-clear-bot | ordinary.json /ordinary/4/frames/2/publicStatuses/7/1 expected="open" mutant="expired" |
| 05-turn-in-bot | diagnostic.json /cases/1/frames/0/publicStatuses/0/1 expected="done" mutant="open" |
| 99-provenance-only | IDENTICAL (NON-KILL) |

The five semantic patches remove the bot exclusion from the reveal finder, handleQuestAccept, onQuestPickup, the
camp-clear supply count and the automatic turn-in. The provenance-only patch changes comment text only. The final runner
output was: 5 KILLs, NON-KILL (provenance-only) 99-provenance-only: semantic corpora identical, and RESTORED CONTROL PASS:
the unmutated /repo matches the checked-in corpora byte for byte. HOST GUARD PASS reports quests.ts, crates/rh-sim and
Cargo.lock unchanged.

## Mutation safety

run-mutants-inner.sh derives every mutable file from the patch headers (one file here: packages/server/src/sim/quests.ts),
copies each from the read-only /repo into a backup, compares it byte for byte, writes sha256 manifests for the backup and
for /repo, verifies both manifests, and self-checks a second copy. This completes before any EXIT/INT/TERM/HUP trap is
installed; a mktemp or copy/verify failure exits nonzero with restoration unarmed. restore_files copies the exact backup
bytes back, compares every file, re-verifies both manifests and exits nonzero if any restore/verification step fails. The
signal traps call restore_and_disarm, which disarms first so restoration cannot recurse. /repo is a read-only bind mount;
every patch is applied only to /tmp/repo in the container. The host runner separately asserts quests.ts, crates/rh-sim and
Cargo.lock are unchanged before and after.

Verified self-check paths: RH_QUEST_MUTANT_SELFTEST=1 printed SELFTEST PASS after applying a patch and restoring the exact
backup bytes. The host runner now implements the real SIGTERM driver itself (the earlier revision only slept in the
container and was not a real signal proof): with RH_QUEST_MUTANT_SIGNAL_TEST=1 it starts the pinned container detached,
waits for the inner SIGNAL TEST READY line, sends SIGTERM, waits for the trap, and requires both
MUTANTS INTERRUPTED: restoring exact backup bytes and SIGNAL_RESTORE_PASS: exact backup bytes verified after SIGTERM
before the host guard passes. Actual result: exit 0 with those lines and HOST GUARD PASS. The earlier wording is
corrected in CORRECTION.md.

## Commands and results

    bash tools/quest-human-eligibility-fixtures/capture.sh
      written ordinary.json 100431 bytes, diagnostic.json 38981 bytes, manifest.json 4994 bytes; check 1/2 and 2/2 pass
    bash tools/quest-human-eligibility-fixtures/capture.sh --check   (run twice)
      each run: check 1/2 and 2/2 pass against sha256 bc16.../51f6.../eef0...; read-only output unchanged
    bash tools/quest-human-eligibility-fixtures/capture.sh
      write recapture byte-identical (WRITE_RECAPTURE_IDENTICAL)
    bash tools/quest-human-eligibility-fixtures/run-mutants.sh
      5 semantic KILLs, provenance NON-KILL, RESTORED CONTROL PASS, HOST GUARD PASS
    RH_QUEST_MUTANT_SELFTEST=1 bash tools/quest-human-eligibility-fixtures/run-mutants.sh
      SELFTEST PASS
    RH_QUEST_MUTANT_SIGNAL_TEST=1 bash tools/quest-human-eligibility-fixtures/run-mutants.sh
      exit 0: SIGNAL TEST READY; MUTANTS INTERRUPTED: restoring exact backup bytes;
      SIGNAL_RESTORE_PASS: exact backup bytes verified after SIGTERM; HOST GUARD PASS

## Method limits and honest gaps

- Source-only: no native rh-sim run, Room/socket/session, Unity/browser/UI, protocol-13 codec, profile connection or join,
  BotManager/policy, account or host service.
- The camp clear is a declared whole-region killMob producer (the lifecycle harness path), not a player-fought camp. The
  human departure in the bot-only world is a real player attack.
- The assignment's shorthand "no toast" for a bot pickup is not literally what the source does. onQuestPickup returns false
  at quests.ts:150 and loot.ts:157 then emits the generic private toast "Nothing to take" to the bot. There is no quest
  progress, carrier, container removal or quest-specific toast. This is recorded as the actual source output, not sanitized.
- Two simultaneous ready humans on a kill offer is not fabricated. The real player-kill case leaves the victim dead and
  resolved; the collect case exhausts the source token supply; the fetch case has one parcel/carrier.
- The native observer/UI/protocol/giver/runtime/privacy contract remains GPT/root work. The diagnostic tieRank case forges
  only bot state and is labelled; it is not a normal-history claim.
- The prior P-QUEST-TRADE-PUBLIC-WITNESSES finding is preserved separately: PlayerState.tradeOffers, tradeStats and
  tradeUsed are ordinary synced fields (noSync:false), so every client can read another player's rolled stat offers and
  applied deltas (docs/evidence/quest-trade-public/README.md:126). That source finding does NOT authorize Rust to disclose
  rolled owner offers; the native public/observation decision remains the lead/root contract.
