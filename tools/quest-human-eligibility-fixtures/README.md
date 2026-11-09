# Quest human-eligibility source witness (P-QUEST-HUMAN-ELIGIBILITY)

Canonical source-only capture of the legacy quest human/bot eligibility guards: hidden discovery, questAccept,
token/parcel pickup, the camp-clear impossible-kill recheck, and the automatic turn-in. It runs the real
createGameWorld production module order with quests on, the real addPlayer seats, the real enqueueClientMessage queue
and ordinary 50 ms step(). It changes no production, Rust, C#, Unity, wire, protocol, version, profile or gameplay rule.

The capture runs in pinned
node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292 with
--platform linux/amd64: /repo is read-only (its ignored node_modules is a writable tmpfs), this tool directory is
read-only at /capture, and the output is at /out (read-only for --check). Setup is
npm ci --ignore-scripts --no-audit --no-fund and node --import tsx.

Commands:

    bash tools/quest-human-eligibility-fixtures/capture.sh            # write parity/quest-human-eligibility/*.json
    bash tools/quest-human-eligibility-fixtures/capture.sh --check    # exact bytes twice, output mounted read-only
    bash tools/quest-human-eligibility-fixtures/run-mutants.sh        # 5 semantic KILLs + provenance NON-KILL + restored control
    RH_QUEST_HUMAN_OUTPUT=/path/inside/worktree bash tools/quest-human-eligibility-fixtures/capture.sh

Canonical serialization is JSON.stringify(corpus) + "\n". Each corpus carries profile with the pinned image
digest, Node/linux/x64 asserts, sha256/bytes of package-lock.json, every package manifest and tsconfig, the versions of
the imported npm packages, the actual internal TypeScript runtime-import closure, the tool hashes, the exact
source-inventory path:line anchors, and profile.captureSha256 (over the corpus with the profile present and
captureSha256 absent). manifest.json lists each corpus byte/sha256/captureSha256 and its bounded counts.

## Corpora

ordinary.json: 6 reachable ordinary cases (hidden reveal bot-then-human, bot/human accept, collect pickup, fetch
pickup, camp-clear bot-only, camp-clear human control) and 3 explicit two-human unreachables. No forged quest state.

diagnostic.json: 2 clearly labelled malformed-state diagnostics: a forged-accepted bot cannot pick a token/parcel, and
a forged-ready bot cannot win the real automatic turn-in even when it would win the source tieRank.

The corpus records only the selected offer's public/private fields, relevant containers/items, GV parts, unknownQuests,
seat states and the actual toast/questReveal/gv(reason=quest) events. It does not dump every offer row.

## Ordinary cases

1. Hidden discovery: a declared bot inside QUEST_REVEAL_RADIUS yields no finder/publishAt/event/toast; a declared human
   in the same place becomes the finder, gets publishAt = now + 4000 and the private questReveal; the public row is
   absent until the head start, then appears with unknownQuests dropping by one.
2. Accept: a bot's real questAccept message is silent (accepted empty, deadline 0, no toast); a standing human's is
   accepted, starts the catalog deadline and sends the source success toast.
3. Pickup: a bot at a real collect token or fetch parcel leaves the container/item and gets only the source generic
   "Nothing to take" fallback; a human who accepts first gains one token of progress or becomes the parcel carrier,
   with container removal and the source progress/pickup toast.
4. Camp clear: after the real whole-region killMob producer, an offer with no standing human stays open with no event;
   the same seed/seat control with a standing accepted human closes it as expired with the actual Quest expired
   announcement. The bot-only world leaves the human through a real player-kill attack; seat flags are never mutated
   mid-run.
5. Two humans: the ordinary collect case exhausts the source token supply (5 tokens for count 3; two full sets need 6),
   leaving progress 3 and 2; the fetch case has one parcel/carrier; the player-kill case gives the killer the only credit
   while the victim goes down and is resolved. All three are recorded as explicit unreachable, with the source reason
   and no forged state.

## Diagnostics

The diagnostics forge only the named bot accepted/progress/ready state. They are not ordinary gameplay and not a
normal-history claim. They mirror the malformed-state controls in the native fix 2de68ba5.

## Semantic mutants

run-mutants.sh mounts /repo read-only, copies it to a writable /tmp/repo, and applies each exact patch there. The five
semantic patches remove bot exclusion from the reveal finder, handleQuestAccept, onQuestPickup, the camp-clear supply
count and the automatic turn-in. Each recapture must produce the named first JSON-path mismatch in
mutants/expected.txt; a compile/syntax/runtime failure is not a kill. 99-provenance-only changes only comment text and
must remain IDENTICAL. The runner ends with the unmutated /repo capture --check against the checked-in corpora.

## Mutation safety

Before any trap is installed, run-mutants-inner.sh derives every mutable file from the patch headers, copies each from
/repo to a backup, compares it byte for byte, writes sha256 manifests for both the backup and the read-only checkout,
verifies both manifests, and self-checks a second copy. A mktemp or copy/verify failure exits nonzero with no
restoration armed. EXIT/INT/TERM/HUP then restore the exact backup bytes, re-check every file and both manifests, and
fail nonzero if any restore or verification step fails; the trap is disarmed first so restoration cannot recurse. The
host runner also asserts packages/server/src/sim/quests.ts, crates/rh-sim and Cargo.lock are unchanged before and
after. /repo is never mutated.

## Limits

Source-only: no native rh-sim run, Room/socket/session, Unity/browser/UI, protocol-13 codec, profile connection or join,
BotManager/policy or host services. The camp clear is a declared whole-region killMob producer (the lifecycle
harness's path), not a player-fought camp. The human departure in the bot-only camp world is a real player-kill attack.
The native observer/codec/public contract, UI, protocol and rolled-offer privacy remain the lead/root work. The
separate prior tradeOffers/tradeStats/tradeUsed public-schema finding is preserved in the evidence README; it does not
authorize Rust to disclose rolled owner offers.
