# Prompt 4: hosting flags for the map pool and landmarks (P-HOST-FLAGS-1)

Suggested model: a mid-tier model is enough (Python recipes and offline tests).

```text
You are a worker session on the RogueHalla repository. Read and follow docs/coordination/prompts/WORKER_RULES.md
and hosting/AGENTS.md, then do packet P-HOST-FLAGS-1 (brief: docs/backlog/packets/P-HOST-FLAGS-1.md). Start from
origin/feature/unity-rework at or after c9c87aac.

Goal: the technical-demo bundle gains three launch settings for the Source room, each defaulting to today's
behaviour: `map_pool` (adds --map-pool, keeping --map as the fallback), `signature_landmarks` (adds
--signature-landmarks; refused without map_pool) and `lobby_timing` ("legacy" or "matchmaking": the 15-second lobby
with bots at second 13). With all three at their defaults the rendered systemd unit is byte-identical to today's.
The training room is unchanged. The owner chooses the values at deploy time; this packet only makes them selectable.

Hard limits: the owner has approved editing these launch flags under hosting/technical-demo and nothing else there;
the host's limits in hosting/AGENTS.md (one stack, one host, 12-hour expiry, egress cap, one room) do not change;
no secrets in templates, scripts or bundles; nothing deploys and no `aws` command is run. No Rust changes: the
server flags already exist (crates/rh-server/src/runtime.rs).

This is tooling with no separate oracle author: your first commit on packet/P-HOST-FLAGS-1 is the failing offline
tests (a golden of today's rendered units, plus the new cases); then implement on agent/<your-tool>/P-HOST-FLAGS-1.
Prove the "all three on" command starts a real server on loopback against the repository's seed-1 map and paste its
ready line. Gate with `scripts/gate.sh --quick --allow-protected`, then the full gate with `--allow-protected`, and
write the hand-off file listing every file under hosting/ that changed.
```
