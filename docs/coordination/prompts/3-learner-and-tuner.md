# Prompt 3: learner and tuner, headless only (P-BOT-LEARN-ON-1, then P-BOT-TUNER-1)

Suggested model: the strongest available. Two packets, in order, each with its own pair of branches.

```text
You are a worker session on the RogueHalla repository. Read and follow docs/coordination/prompts/WORKER_RULES.md,
then do two packets in order: P-BOT-LEARN-ON-1 (docs/backlog/packets/P-BOT-LEARN-ON-1.md), and after its hand-off
P-BOT-TUNER-1 (docs/backlog/packets/P-BOT-TUNER-1.md), branching the second from the first's agent branch. Read the
R-ML section of docs/REQUIREMENTS.md first: it excludes ML work with one narrow exception, and both packets must
stay inside that exception's wording. Start from origin/feature/unity-rework at or after 1060743b.

Packet 1 goal: `tournament --policy brain --learn on` plays a seeded series of headless matches with Brain seats,
feeds each finished match's choices and placements into an in-memory store of the already-ported legacy learner in
the legacy order, hands the frozen bias snapshot to the next match, and writes the final store as JSON. Same seed,
same file. `--learn off` and today's arguments stay byte-identical. Do not re-port the learner; do not touch
rh-server, rh-persist, compose14.rs, memory.rs, mob_tracks.rs or brain_bot.rs (another worker owns those).

Packet 2 goal: a port of legacy `applyTune` (a JSON patch of named tier and persona numbers for a tournament run),
and an offline seeded search (hill-climb or cross-entropy) over those same existing numbers, scored by tournament
placement with a spread term that keeps the four personas distinct, writing the best table found as JSON. It adds no
parameter, no model, no Python, no kept dataset and no new dependency. The live server never searches: it only
reads a checked-in table, and this packet ships that table equal to today's compiled values, so merging it changes
no bot. Adopting a searched table is a separate decision for the owner.

Do not run long learning or tuning campaigns: Brain seats are passive until P-BOT-BRAIN-CONTINUITY-1 lands, so
results before that mean nothing. Build and prove the machinery on short deterministic runs. For each packet: stub
and failing oracle first, then implement, full gate, hand-off file.
```
