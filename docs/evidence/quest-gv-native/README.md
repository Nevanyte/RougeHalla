# Native quest GV projection — source admission HELD

Base `d28df076bf98d10bfe6cb5fbc88b8d30a3fbe712`; code/test leaf
`4cbddd5339f6e0f14eecd29674cbad42c443340f`.

Only `Event::Gv(reason Quest)` becomes typed `Owner(id)` / `Important`. Its observation projection formats
`+N GV (quest)` through the existing `SeenEvent::Toast`. Raw GV events, reward totals, banking/diagnostics,
serialization, replay and authoritative state remain unchanged. No duplicate world Toast is emitted.
Kill/Mob/Elite/Bounty/Skip/Win retain ServerOnly visibility/classification and no new projected text.
No names identify the owner, no spatial predicate widens the recipient, and no cache/input or generic event is added.
Existing Toast tag10 can carry this string; server/client/protocol/header/content/tape/lock/status files are untouched.
The observe.rs edits are only to_seen and a cfg-test module declaration; owner-combat field/reset composition stays separate.

## Focused native checks

- Three new projection tests: integer0/10/u32max text and event order, owner/foreign/spectator permissions,
  identical player labels, no other-GV-reason leak, declaration/class agreement and unchanged raw event/state.
- Existing `collect_tokens_and_the_turn_in_pay_the_two_reward_channels` recipe executes real accepted input,
  token pickups and automatic turn-in. Added assertions observe one unchanged raw quest GV event, no duplicate
  world toast, its owner notice at the original event position and no foreign payment notice. Existing reward
  totals remain asserted. Trusted native placement is not source/wire/browser parity.
- Existing exhaustive declaration alignment test passes.
- Scoped strict `cargo clippy -p rh-sim --lib --tests --features trusted-status-probes -- -D warnings` and formatting pass.

Commands use final-env.sh and a dedicated jobs1/debug0/incremental0 target. No unchanged public14/giver8 or workspace
campaign is rerun; no source capture is made. The new unit literal and real native producer test are native controls,
NOT captured proof of RaidRoom-derived text. SOURCE PARITY ADMISSION IS HELD until the independent actual
RaidRoom.handleEvents/toastTo/sendTo witness is sealed and consumed. Current giver8/public/notice corpora record
raw World GV events; they do not execute that Room translator. UI ToastText/feed/panel work is a separate owner task.

## Read-only presentation metadata finding

`quests/catalog.rs::DEFINITION` already contains all20 names, giver labels, brief text and typed kind/count/region/tour
fields. `quests/tests.rs::the_captured_catalog_rows_and_reward_rules_match_the_source` checks these against
`parity/quests/data.json`, and checks `rules::reward_text` (current fixed stat stacks + GV) for every row. The same
corpus certifies historical reward-card helper outputs at feed0/6; those helpers are NOT a live card-payout claim.
`the_captured_wording_matches_the_source` checks all refusal/accept/accept-first phrases.

Missing contextual Rust presentation formatting corresponds to source `client/src/ui/questModel.ts`: objective wording,
owner progress/status/countdown, and questReward's current+gained 'total after this quest'. Source public schema/dialog
captures have actual partial row/render examples, not exhaustive complete-format coverage; ready-status text is explicitly
source-anchored/unexecuted. Existing typed owner facts must replace legacy doneBy-name inference. No additional metadata
fields or formulas are implemented here, and no metadata coverage campaign was rerun for this read-only finding.
