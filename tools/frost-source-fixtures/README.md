# Frost NPC source witnesses

`parity/frost-sources/source.json` is an additive actual-source corpus (`rh-frost-sources-source/1`).
Capture uses unchanged checked-in TypeScript modules, the official Linux/amd64 Node 22.23.4 image pinned by digest,
`npm ci` against the checked-in lockfile, two independent runs, and a byte comparison. Source and capture mounts are
read-only; dependencies and the working copy live only in container tmpfs. No existing corpus is recaptured.

```sh
bash tools/frost-source-fixtures/capture.sh
bash tools/frost-source-fixtures/capture.sh --check
```

`RH_FROST_SOURCES_OUTPUT` overrides the output directory. `--check` mounts it read-only. Before any case world construction, a throwing `Math.random` trap rejects unexpected ambient entropy.
The corpus records the entire
server-sim/shared TypeScript source closure, package and lockfile SHA256s, input-map SHA256, recorder SHA256, and runtime
identity. A changed recorder or source therefore fails the byte check even when behavior happens to match.

## Input/output boundary

The map is the declared input JSON copied into this tool directory. Before world creation, the recorder swaps the
Fire/Frost regions, region-grid labels, camp identity/default weapon (Frost shield), and spawn-pool zone labels, using the same construction as the
existing Frost-NPC recipient tool. Camp source types/weapons/HP are rolled by the unchanged source constructor, not
installed after birth. The three runtime camp actors are Glacial Warden (shield) and two Frostbow Sentries (bow).
The helper with `extraSpots=true` declares ten camp spots before world construction at
`(80 + 32*(i%4), 80 + 32*floor(i/4))`, in index order, except index 5 is `(208,112)` so no spot overlaps
the camp chest at `(112,112)`. It does not overwrite source actors.

`input.players` declares faction, placement, hand, HP and optional cards, applied once after the raid-start step as
recorded setup. Cards use actual `grantCard`; no chill, movement multiplier, clock, damage, action or expected event is
installed. Runtime frames contain only commands accepted by actual `enqueueClientMessage` and ordinary `step(w,50)`.
The unchanged NPC AI produces NPC movement and attacks. The passive snapshots never become inputs.

The structured `profile.constructor` pins world seed 1, Mulberry32 seed 12, reward salt `[1,2,3,4]`, quest salt
`[5,6,7,8]`, and the declared sequential item UID producer.

The top level contains `format`, `profile`, `provenance`, and `cases`. Each case contains `input`, `initial`, `frames`,
`draws`, and `next` (four subsequent reward draws). Each frame contains `commands` and `output`. Outputs contain source
`tick`, `time`, `phase`, `counter`, `camps`, `players`, `mobs`, `containers`, `events`, `landed`, `signatures`, `dot`,
`dotSince`, and `rewardDraws`. Players include position/facing/HP/status, both hands, ready/draw times, actual private
weapon runtime/action, inputs/path, signature bits/movement multiplier, build and mob stats. Mobs include their entire
public state, brain, weapon runtime/action, inputs/path and last-hit time. Maps, sets and schema state are serialized
passively; nonfinite times become `null`. Signature source lists preserve actual source insertion order.

## Runtime witnesses

Five `kind=runtime` cases record 220/140/140/140/300 ordinary frames:

- A Holy sword player versus the ten-spot Frost camp: ten genuine NPC sources are present at source tick 20 / time
  1000ms, produced by normal AI and validated attacks, with no helper engagement/mode/clock writes.
- Frost player versus Frost NPCs: reciprocal source membership and normal NPC/player timing.
- Holy player versus Frost NPCs: NPC structural chill at the source's floating value near 0.68.
- Frost player with Haste III and Soul Defense III: player bonus deepens NPC chill while incoming NPC chill remains base.
- A low-HP Holy bow pull outside the territory leash: genuine AI Return after the puller dies, with two standing
  observers keeping the phase active. The source writes Return itself; no brain mode is installed in this case.

Factions' source system runs before mobAI in this declared installer order. The frame where AI first sets Return can
therefore retain the previous cached source membership; exclusion is observed at the next recomputation. The recorder
asserts exclusion for consecutive Return frames and preserves the entry-frame history unchanged.

## Helper diagnostics

These cases are explicitly `kind=helper-diagnostic`, `kind=helper-recipients` or `kind=helper-npc-bonus`. They do not claim ordinary AI/client
reachability. They capture the exact `afterDamage` function installed by the unchanged factions installer, by its system
index at installation. Declared engagement pairs set only `target` and `engaged`; the source system computes all chill,
ordered memberships, movement multipliers and timings. Commands declare each direct helper invocation and its `dtMs`.

`helper-npc-bonus-mirrors-stay-base` registers a declared diagnostic source modifier contribution to the first
source-born Frost NPC (`asMult=1.5`, `shield=45`), then invokes unchanged `recomputeMods`. It declares the corresponding
encoded mirror inputs `asMult=1500`, `shieldBonus=450` and passively records the actual decoded NPC modifiers plus their
source `encodeMirrors` output in `output.diagnosticNpcMirrors`. NPC mirrors reside in the private source modifier cache;
the tool never assigns schema-less mirror properties that would affect source actor classification. Engagement with
p0 still computes base chill near 0.68 through installed afterDamage. This is a modifier diagnostic, with no ordinary
runtime or restore-valid state claim.

`helper-eleven-ordered-sources-lifecycle` records seven observations:

1. Ten source-born Frost camp NPCs plus one boosted Frost player target a Holy player. A reciprocal first edge repeats
   the first NPC: the source produces eleven unique IDs in order `[first NPC, p1, remaining NPCs]`.
2. An explicitly declared Return-mode diagnostic removes the first NPC as a source in both edge directions.
3. Actual exported `killMob` kills the camp actors; recomputation excludes them from the standing recipient's sources.
4. A declared 1500ms clock jump and actual `reapMobs` remove the corpses.
5. A declared clock jump to the actual camp deadline and `respawnCamps` create ten fresh source IDs.
6. Reengagement recomputes the eleven-source membership with the new IDs.
7. The installed `teleported` hook resets the signatures and mob fights; recomputation leaves all lists empty.

`helper-source-recipient-kinds` uses actual source `addMob` for a dummy, `placeMob` for Fire/Holy/Plague recipients, and
`raiseOrGrowZombie` for a Plague owner's zombie. These are declared direct constructor diagnostics, including result
IDs; the zombie case makes no claim of authorized corpse consumption or a client-triggered ability. Together with a
Holy player, each recipient explicitly engages the first source-born Frost NPC. The same installed factions system
chills all six recipients, then excludes that source after an explicit Return-mode diagnostic. Dummies and zombies
are recipients and never Frost sources.

This corpus supplies source outputs for native comparison; it does not itself prove native checkpoint admission,
restored continuation, hashing, warm allocation behavior, compiled mutants or general Full-faction parity. Existing
Frost/Wish corpora and their gates remain unchanged.
