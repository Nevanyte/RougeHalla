# Quest Room delivery — independent pre-seal review

**No substantive blocker found in this inspected WIP; final seal/evidence binding pending.** This is not native
admission. Read-only review on2026-11-10 of
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-quest-room-delivery`, base
`9ee84dfe3fa35cfdefc4b6cabaf4b9091db6a24c`. Exact inspected test SHA256
`d2cd0365dd5c4462f69856efbb98e7542ecf18f5add166153df3f6adea6f7651`,768 additive lines in
`crates/rh-server/src/quest_bridge_tests.rs`. All four old tests are untouched; there is one new complete proof and
its helpers. Worker remains active. No reviewer Rust/tests/probes/source capture/process interference or worker/
Claude contact; write scope is only this new Root evidence file.

## Real setup, actions and publication

The test uses an actually generated published Open shards-frost Collect offer; checks identity/count and derives no
expected progress, event or reward from the source oracle (`quest_bridge_tests.rs:716-741`). Two real humans join
Room with distinct connections and Outboxes. It explicitly swaps in a deterministic active Sim using one declared
initial owner Placement at that generated giver, then rebinds BOTH ItemObservers/projectors before the first issued
handles (`743-835`). This is correctly labelled component setup; not hosted lobby startup, natural initial travel,
a source constructor-output pose, or new quest-profile activation.

After setup, the test's only advancement is quest_room_wake (`646-682`):50ms slots invoke actual Room::wake,
assert no frame/snapshot refusals, verify projector/current snapshot ticks and drain/decode both real Outboxes. The
production wake itself performs step_into→per-seat feed/append→carry→publish. No direct new Sim::step/publish/carry
installation is used. Sim::reset_active's synthetic bootstrap is confined to the declared setup.

Actions use actual delivered QuestHandle, objective positions, Props PickupHandles and owner snapshots, via
Room::handle(RoomCmd::Input) with the joined identity/connection and monotone input sequence (`623-644,838-1105`).
The Move application is independently corroborated by delivered move_seq, not ack_input alone. Real movement reaches
remaining public objective cues; real Pickup requests advance owner progress to3 with actual progress notices. The
return Move uses delivered giver coordinates; ordinary automatic turn-in produces the quest GV event. There are no
post-bootstrap teleports, direct private container-id commands, cleared threats, installed progress/status/reward,
manufactured events or acceptance-only downgrade. Private runtime reads only select/diagnose genesis and corroborate
completion; they do not replace action handles or later client navigation facts.

## Independent complete output comparison

The frozen quest-room-feedback oracle is loaded ONLY after native completion (`1136+`). Its source case7/frame8/
raw event identity and owner/public routes are checked. The public name is declared name0 in the native fixture
before construction; there is no post-production name rewrite or broad wildcard. The complete owner4/foreign1
expected strings come from the source method witness, not native expected-state installation.

Both actual Outboxes must yield one completion-window Events batch at the genuine native completion tick; the test
requires the entire batch length and every row to be Toast before exact ordered vector equality (`1180-1232`). No
expected-text membership filter can hide an extra/wrong row or another event type. Private GV/farm/completion notices
are absent from the foreign batch, whose only row is the same public announcement. Wire Toast has no invented
recipient field. Native raw GV remains exactly one producer event, no duplicate world GV Toast is manufactured, and
native Done/done_by/credit/farm state corroborates the wire result (`1107-1133,1235-1278`).

Source8/400ms is provenance only. The running fixture's actual tick/time are used, with normal bootstrap clock;
the observed native completion is1386/69300ms after real pickup progress at677/679/700. Nothing forces the source
clock. This is one component delivery proof, not all181 legacy event transport, authenticated sockets, reconnect
retention, persistence, UI display or full quest-port acceptance.

## Actual receipts inspected, not reviewer executions

New evidence is under `docs/evidence/quest-public-completion-room-delivery/logs/` in the worker tree:

| Receipt | Actual result and limit |
|---|---|
| 01-focused-proof | New proof1/0,3.54s; logs acceptance3, pickups677/679/700 and completion1386/69300 with exact owner4/foreign1 strings. |
| 02-quest-bridge-regressions | Full module filter5/0,7.88s (old four plus new proof). |
| 03-fmt-check | cargo fmt -p rh-server -- --check, actual exit0. |
| 04-clippy-default | Strict all-target default-feature server lint, actual exit0/21.16s. |
| 05-clippy-all-features | Strict all-target all-feature server lint, actual exit0/22.72s. |
| 06-focused-proof-repeat | New proof1/0,5.36s, same observed finite path/output. |
| 08-fresh-target-rebuild | Same author, second target directory, proof1/0,2.79s after compilation; header explicitly says it predates final assign-op formatting cleanup. Not independent reviewer reproduction or proof of a later immutable code seal. |

The meaningful first failure is retained: after the first real pickup, the assertion incorrectly expected all5 original
objective cues instead of4 remaining; the final assertion tracks token_spawns minus earned progress. This corrects a
harness expectation, not gameplay state. Initial default/all-feature clippy failures are retained separately, and final
normal assign-op formatting is mechanical. Do not rewrite raw failures or present pre-cleanup build receipts as final
code hashes. Command headers record cwd/base/toolchain/offline/locked/j1 target environment and exits; final immutable
candidate/code binding remains the author's pending seal/evidence work.

Only the test file is tracked-modified at inspection; new target-deepseek-quest-room-delivery was untracked and MUST
stay outside the final scoped seal. New evidence/working-tree.diff is not permission to include target caches. No
source/fixture/production/host/protocol edits are needed or observed. Source runtime quests=true versus the old
quest-disabled test cfg is accurately labelled in the new proof. Root owns final scope/seal/native admission.
