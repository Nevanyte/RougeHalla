# Owner queue

Decisions waiting for the owner, one line each, with the default the coordinator applies until an answer arrives. The
coordinator edits this file in place: a row leaves when the owner answers (the answer is recorded in
[MIGRATION.md](../MIGRATION.md) and indexed in [OWNER_DECISIONS.md](../OWNER_DECISIONS.md)). To answer, name the row
number in chat: "Q18 yes".

Last updated 2026-11-14, after the owner answered Q1 to Q13 and Q15 to Q17 (MIGRATION "Owner answers 2026-11-14").
Q14 was closed by the standing instruction that emptied files stay as placeholders.

## Blocks a merge

| # | Question | Default in force | Record |
|---|---|---|---|
| Q18 | The map generator session's environment packet P-AGENT-RETRO-1 (a dev-profile `opt-level` that more than halves gate test time, an oracle preflight, a reviewer note rule, `LANES.md`; it edits `scripts/gate.sh` and agent definitions). That session reports your approval in its chat ("Please fix 1-8"). Confirm here? | Not merged. | MIGRATION "Integrations 41 and 42" |

## Recorded in another session's chat, not confirmed here

| # | Item | Default in force | Record |
|---|---|---|---|
| Q19 | The volcano, as the map generator session relays your answer in its chat ("Yes to all 3"): a landmark's own walled-in lava is exempt from the rule that low ground lies within 4 tiles of floor; the cone is 22 across (not the approved 30 x 30) and the zone floor-share rule stays 1.15; streams of 10 to 14 and 7 to 10 tiles; a fan of clear ground in front of the Fire site. | Treated as decided in that lane; the branch is still reviewed here before it merges. | MIGRATION "Owner answers 2026-11-14" |

## Deferred by the owner

| # | Item | Until then | Record |
|---|---|---|---|
| Q16 | `hosting/technical-demo/README.md:199` names the old content hash; the next deploy needs protocol 18 and a rebuilt client. Owner 2026-11-14: "we can work on this later when all changes are done". | Untouched; raised again at the deploy step. | MIGRATION "Owner answers 2026-11-14" |
