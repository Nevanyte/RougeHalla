# Hand-off: P-HOST-FLAGS-1

```
PACKET:          P-HOST-FLAGS-1 — serves owner decision 6, 15 s lobby direction, owner approval 5 (2026-11-12), plan lane D packet 3
BRANCH:          agent/claude/P-HOST-FLAGS-1 (from packet/P-HOST-FLAGS-1, oracle commit = failing offline tests)
GATE:            PASS (quick, --allow-protected) ; PASS (full, --allow-protected --oracle packet/P-HOST-FLAGS-1, with a throwaway Postgres). A first full run failed only because that Postgres had died (connection refused); rerun green.
CHANGED:         hosting/technical-demo/bootstrap.py, config.example.json, README.md (agent commit); test_offline.py (oracle commit); this file
D-RULES:         n/a (launch configuration; no game, wire or parity change)
DEVIATIONS:      none
SHARED RECORDS:  none
LEGACY DOUBTS:   none
NOT ESTABLISHED: Nothing deployed and no aws command run. The ready-line proof ran a debug build on loopback against a throwaway Postgres, not the host's Postgres, Caddy, systemd sandbox or the x86 release binary. Map-pool first-room wait on the small host is not measured. Config keys are validated by the host's bootstrap guard, which re-reads the config on every start.
RISKS:           Config key set is now "required keys plus three optional"; any other key is still refused. test_stack.py, bundle.py, render.py, stack.yaml unchanged.
```

## Behaviour
- `map_pool` (bool, default false): adds `--map-pool`; `--map` stays as fallback.
- `signature_landmarks` (bool, default false): adds `--signature-landmarks`; config refused without `map_pool`.
- `lobby_timing` ("legacy"|"matchmaking", default legacy): matchmaking adds `--lobby-timing matchmaking` and drops `--lobby-seconds 10 --fill-seconds 3`.
- Which wins when both are present (runtime.rs / bot_fill.rs `apply_lobby_timing`): matchmaking overwrites lobby seconds (15), min players (MAX_PLAYERS) and fill seconds (0), so it wins; the pair is dropped to keep the unit honest. `--min-players 1 --fill-bots 8` are kept.
- Defaults render byte-identical units (golden of today's Source and training units in test_offline.py). Training is untouched.
- Flag check: the rendered flags are checked against a list in the test taken from rh-server's parsers (runtime.rs, main.rs typo-guard test), not from `rh-server --help`.

## Ready-line proof ("all three on")
Rendered ExecStart (paths swapped for local ones), `--map crates/rh-sim/src/mapdata/fixtures/seed1.map.json`:
```
[server] map pool on: each room takes its own certified map (target 8)
[server] ws/http (dev only) on 127.0.0.1:17777 | protocol 17 content 4674a176a28e3c7a
```
/readyz: {"ok":true,"state":"ready","storage":"ok"}. (parity/maps/seed1.map.json is a capture format the server rejects; the rh-sim fixture is the runtime seed-1 map.)

## Files under hosting/ changed
hosting/technical-demo/bootstrap.py, config.example.json, README.md, test_offline.py

## git diff --stat packet/P-HOST-FLAGS-1
 hosting/technical-demo/README.md           | 24 ++++++++++++++++++++++++
 hosting/technical-demo/bootstrap.py        | 21 ++++++++++++++++++---
 hosting/technical-demo/config.example.json |  5 ++++-
 3 files changed, 46 insertions(+), 4 deletions(-)
(plus this hand-off file)
