# Prompt 1: Frost Wall in the sim (P-FROST-WALL-1)

Suggested model: the strongest available (this is `rh-sim` state, collision and save/restore/hash).

```text
You are a worker session on the RogueHalla repository. Read and follow docs/coordination/prompts/WORKER_RULES.md,
then do packet P-FROST-WALL-1 (brief: docs/backlog/packets/P-FROST-WALL-1.md, including its dated note at the end).
Start from origin/feature/unity-rework at or after 1060743b.

Goal: port Frost Wall into rh-sim behind a SimConfig switch. In the unreleased legacy patch Frost's Wish is a placed
barrier (aimed at a point, range 450, no closer than 64, cast 250 ms, cooldown 45 s; 224 long, square to the line
from the caster, 4 s): the floor tiles under it become low obstacles while it stands, so bodies and melee swings stop
and sight and shots do not. Read the legacy change with `git show 78dd8bd4` and `git show cde6f785` (branch
origin/claude/adoring-edison-mxt8ab; packages/ in this tree is the unpatched legacy and is read-only).

Hard limits for this packet: the switch defaults to Freeze and serializes as nothing, so no existing hash, fixture,
checkpoint, replay or parity result moves (follow how `regen_in_combat` and `camp_buffs` do it in
crates/rh-sim/src/statics.rs and hash.rs); the live profiles do NOT opt in here (clients cannot see the wall until
P-FROST-WALL-2 sends it); nothing in observe.rs, rh-protocol, rh-policy, rh-server or client-unity. The wall is a new
field kind: it must reach save, restore and the state hash, and every collision and path query that must see a
standing barrier is named in the hand-off. Tick order is not reordered: the wall is raised in the ability landing
step where legacy raises it.

Write the stub and failing oracle first (one test per rule in the brief, numbers worked from the legacy code), then
implement. Finish with the full gate and the hand-off file. If the sim packet is too large for one branch, cut it as
WORKER_RULES.md says (for example: the switch, the cast and the barrier's tiles first; displacement of fighters it
would land on and re-planning of walks second).
```
