# Explicit owner quest facts

Private candidate from `1e4dd5fdac481439d5d169976d82a4db63312d34`, branch `codex/quest-owner-facts`. Write scope is only
`crates/rh-sim/src/quest_view/{mod.rs,tests.rs}` plus this evidence directory. The coordinator's unpublished
Observation20/policy14 reservation remains; no wire, version, content, checkpoint/replay, source corpus, producer,
Unity, shared status or lockfile changes are included.

## Facts and lifecycle

| Field | Exact meaning |
|---|---|
| `QuestView.owner_roster: Option<RosterId>` | The viewer's quest-only ID, **only if that ID appears in this same view's entitled roster**. Own presence does not allocate a row. A retained historical ID absent from the current roster yields `None`. |
| `QuestRow.owner_progress: u32` | The viewer's raw stored progress in a published offer; zero for an absent record or private preview. Done/Expired rows retain stored history. Fetch does not synthesize a count from carrier or completion. |
| `QuestRow.owner_visited: u8` | The viewer's raw stored tour-region mask in a published offer; zero for an absent record or private preview. Bits use the existing faction codes; closed history is retained. |
| `QuestRow.owner_completed: bool` | The published offer is Done and its recorded typed `done_by` equals this viewer. It names the completion actor, not every accepted/ready participant, an uncapped reward, or a durable bank acknowledgment. |

The existing human-only observer gate applies first. Normal nonaccepted records have zero progress/visits, while
published stored values are projected without inventing a new acceptance/status restriction. `owner_accepted` retains
its existing meaning, and `owner_ready` remains accepted + live + actual objective completion. Preview fields are
zero/false and remain nonactionable. Bot/no-runtime views remain empty defaults.

`owner_roster` is selected after the existing entitled roster is built, using its staged viewer identity plus a same-view
membership check. No private roster traversal, extra allocation, different sort/tie rule, new action binding or hidden
capacity pressure is introduced. Preparation/drop, reconnect revocation and monotonic counters are unchanged. Quest
roster IDs remain a distinct nonspatial type; they do not become actor/pickup/accept handles. Numeric IDs are not
cryptographic capabilities and may coincide across namespaces or viewer epochs.

## Source and intended behavior

Existing native `quests/live.rs` supplies acceptance, raw progress, tour masks, carrier, completion actor and closed
history. This packet only projects those recorded facts. Existing captured source lifecycle/parity tests remain intact.
The legacy `questModel.ts::questRows` reads raw per-player progress and visited regions; its completed Fetch display
uses a display-name comparison because the parcel carrier is cleared at turn-in. That comparison misidentifies two
same-label sim seats. The coordinator explicitly approved the additional typed `owner_completed` fact so the future
client can show completion without name matching or fabricated raw progress. No new gameplay/reward rule is added.

## Verification scope

Five new native cases and strengthened existing assertions cover:

- Two declared same-label human seats accept the same Fetch through validate/submit; a real pickup and automatic
  turn-in set completion only for the recorded actor, though both display labels equal `done_by`. Fetch raw count stays0,
  carrier clears, readiness becomes false, and projection leaves the sim hash unchanged.
- Actual Collect pickup progress and automatic turn-in retain count/acceptance history; an expiry branch retains its
  partial count and clears live readiness. Deadline shortening is explicitly declared boundary setup, not an installed
  Expired/Done outcome.
- The real `MobKilled` hook produces tour count/mask, ignores repeat regions, and retains history after ordinary expiry.
  This is a declared direct-hook producer check, **not** an ordinary NPC-kill acquisition/parity witness.
- No owner allocation at exhausted roster counters without entitled references; dropped preparation grants no binding;
  reconnect uses a later identity; the real close-all hook and normal linger expiry remove current owner representation
  while retaining observer history.
- Paired hidden-preview worlds, including deliberately malformed hidden owner acceptance/progress/visits/completer
  records, produce identical views and no allocation/failure even at exhausted counters. These malformed records test
  the redaction boundary and are not claimed reachable gameplay.

The affected `--lib quest` suite passes42 tests, including all21 quest-view tests and the existing captured quest
lifecycle. Both strict all-target Clippy configurations and formatting are recorded in `verification.json`, alongside
exact source/log hashes and unedited bounded command logs. The earlier20-test development run precedes the fifth new
case; it is not counted in addition to the final42.

## Remaining work

Root must compose this with the future Frost/Sentenced union and independently review the final public shape. Real
quest-giver actor equivalence, feedback, Rust/C#/JS codecs, actual accepted-queue/reconnect transport, Unity UI/browser
and durable quest rewards remain separate gates. This packet does not activate public quest support or claim full-port
completion, new source recapture, full-workspace validation, performance or allocation proof.
