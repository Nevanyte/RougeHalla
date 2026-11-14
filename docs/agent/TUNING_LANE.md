# The tuning lane: small changes without a packet

Owner direction 2026-11-13: small changes are made by Sonnet sub-agents, cheaply; the coordinator's part is to keep
them cheap (named dials, range tests, a look check an agent can run) and not to make or shepherd them one by one.
This file is that lane. Anything outside it goes through the packet pipeline in [README.md](README.md).

## What a tuning change is

A change of a **dial**: a named constant or table entry listed in a dials index, moved inside the range its test
pins. The indexes: [docs/unity/DIALS.md](../unity/DIALS.md) (Unity presentation). A change qualifies only if all hold:

- it touches the dial's line, and at most the comment beside it and the index row;
- the new value is inside the dial's pinned range (the index names the test that pins it);
- it decides nothing a fighter can act on: no rule, no number in `crates/`, no wire field, no hitbox, no timing the
  server uses. Unity holds no game rules (AGENTS.md); a dial is looks, layout or feel only.

**Widening a range** is still a tuning change when the owner's own words ask for a value outside it: change the
range in the test and the value together, and quote the owner's sentence and date in the test's message. Nothing else
in an existing test may change in this lane.

Not tuning, use a packet: a new dial, a change of behaviour, more than one dial's meaning, anything in `rh-sim`,
`rh-protocol`, `rh-server`, a shader's structure, a test's logic.

## Steps (one Sonnet implementer, `implementer-sonnet`, one worktree)

1. **Find the dial** in the index. Done when you can name its file, symbol, current value, range and pinning test.
   No row for what was asked: stop and report; adding a dial is a packet.
2. **Branch** `tune/<dial-name>-<value>` from the integration head named in the dispatch. Never merge another
   branch in.
3. **Change the value** (and the range, only under the rule above). Update the index row's value. One commit:
   `tune: <dial> <old> -> <new> (<owner's words or the reason>, <date>)`.
4. **Gate:** `scripts/gate.sh --quick --base <integration head>` green, run after the commit. A red test that pins
   the old exact value of a dial is a defect in that test (a dial is pinned by range): report it, do not edit it.
5. **Look check, when the dial changes what is on screen:** run the look check in
   [docs/unity/LOOK_CHECK.md](../unity/LOOK_CHECK.md) for the scene the index names, before and after, and LOOK at
   both. Done when the after picture shows the change asked for and nothing else moved.
6. **Report** in five lines: dial, old and new value, branch and sha, gate line, the two picture paths with one
   sentence on what you see. Say plainly what was not checked.

## After the agent

- No oracle author, no brief, no DEVIATIONS row (a dial inside its range is not a deviation; a widened range by owner
  direction is recorded by the commit and the test message).
- The coordinator merges tuning branches in batches with the next integration gate. A `reviewer` (Sonnet) looks at a
  tuning branch only when it widened a range or touched more than the dial's line, the range and the index row.
- A look the owner will judge is shown to the owner from the **running Web client**, never from the look check's
  renders or from colour patches: the look check is for the agent's before and after; it has known differences from
  the client (LOOK_CHECK.md says which).
- Log one line per change in `.agent-runs/log.csv` with `tune` as the packet.

## Adding dials (a packet, once per area)

A dial is worth adding when the owner or a review has asked for the same kind of adjustment twice. The packet that
adds it: gives the constant a name that says what it is in the owner's terms, puts it where its feature lives (not in
a global bag), replaces any test that pinned its exact value with a range test whose message says why the range is
what it is, and adds its row to the index with the scene that shows it.
