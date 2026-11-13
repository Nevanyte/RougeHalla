# Prompt 2: bot passivity fix (P-BOT-BRAIN-CONTINUITY-1)

Suggested model: the strongest available. The cloud session that built the Brain wiring already knows this code.

```text
You are a worker session on the RogueHalla repository. Read and follow docs/coordination/prompts/WORKER_RULES.md,
then do packet P-BOT-BRAIN-CONTINUITY-1 (brief: docs/backlog/packets/P-BOT-BRAIN-CONTINUITY-1.md). Also read
docs/backlog/packets/P-BOT-BRAIN-RECONCILE-1.md (what the Brain is now: one composer, the BrainBot seat policy, the
--bot-brain flag, off by default) and the DEV-026 row in docs/DEVIATIONS.md. Start from origin/feature/unity-rework
at or after 1060743b: the Brain on that branch is the reconciled one, not the earlier cloud branch.

Goal: Brain seats are passive (7 to 241 proposals per seat over 6,000 ticks) because a mob has no identity a seat can
hold: the sim renews NPC references whenever the visible set changes, so the Brain forgets every mob each tick. Give
each seat a tracker that follows the mobs it can see from frame to frame by position, kind and how far a mob could
have moved, assigns its own key that lasts while the mob stays in view, supplies mob velocity from that track, and
lets Memory keep the record while the track lives.

Hard limits: bot code only (rh-policy; the release test in rh-headless): no stable NPC reference is added to rh-sim
or the wire. The tracker reads only the seat's accepted frames. It must not use the per-sample reference's numeric
value or the rows' order as a hint of identity across frames: that is the leak R-ML-4 forbids, and it would pass
every test until the sim renews a block mid-fight, so test with references renumbered and rows shuffled. No identity
is claimed across a gap in sight. The frozen parity corpora keep legacy keying; `--bot-brain off` stays byte-identical.

Measure before pinning: today's numbers and a HumanBot baseline on the same seeds in
`cargo test --release -p rh-headless --test brain_bots`, then pin floors that mean "plays" (proposals per seat, mob
kills and deaths per match as a stated fraction of the baseline), determinism (equal hashes across two runs, replays
verify) and per-seat decision cost. Stub and failing oracle first, then implement, full gate, hand-off file.
```
