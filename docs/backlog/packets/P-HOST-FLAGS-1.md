# P-HOST-FLAGS-1: the beta host can launch with the map pool, the landmarks and the 15-second lobby

- **Serves:** owner decision 6 (MIGRATION, 2026-11-10: each match draws its map from a pool of generated, certified
  maps); owner direction 2026-11-10 (lobby rule: wait 15 seconds, add bots at second 13); owner approval 5
  (2026-11-12: `hosting/` launch flags for the map pool, landmarks and 15 s lobby); plan lane D packet 3
- **Implementer tier:** implementer-sonnet (`hosting/` recipes: `hosting/AGENTS.md`)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** none (launch configuration; no game, wire or parity change)
- **Protected paths:** `hosting/` (owner approval 5 above covers exactly these launch flags). Nothing deploys.

## 1. ID and outcome
The server already has the switches (`crates/rh-server/src/runtime.rs`): `--map-pool` (source-arena only: every room
takes its own certified generated map; `--map` stays as the last resort, `:23-24`, `:191`), `--signature-landmarks`
(needs `--map-pool`, `:192-195`), and `--lobby-timing matchmaking` (a 15 s lobby with bots at second 13, `:32-40`).
The beta host does not use them: `hosting/technical-demo/bootstrap.py:216` writes the Source room's options as
`--map <file> ... --min-players 1 --fill-bots 8 --max-rooms 1 --lobby-seconds 10 --fill-seconds 3`, and the systemd
`ExecStart` is built from it at `:228`.

When this lands, the technical-demo bundle carries three launch settings in its config, each defaulting to today's
behaviour, and the bootstrap renders the matching flags for the Source room only:
- `map_pool: true|false` (default false) adds `--map-pool` and keeps `--map` as the fallback;
- `signature_landmarks: true|false` (default false) adds `--signature-landmarks` and is refused without `map_pool`;
- `lobby_timing: "legacy"|"matchmaking"` (default "legacy") adds `--lobby-timing matchmaking` and, when set, drops the
  explicit `--lobby-seconds`/`--fill-seconds` pair so the server's 15 s / second-13 rule is the one in force (state
  in the brief's hand-off exactly which flags win when both are present, from `runtime.rs`).
With all three at their defaults the rendered unit is byte-identical to today's. The training room is unchanged (it
refuses the pool and the timing switch). Whether the next deploy turns them on is the owner's call at deploy time.

## 2. Dependencies
none (the flags exist in the base). The landmark setting should stay off on a real host until the landmark and art
packets are done; this packet only makes it selectable.

## 3. Relevant legacy paths
- `packages/shared/src/constants.ts:130-134` (`LOBBY_SECONDS = 30`, `LOBBY_FILL_SECONDS = 5`): the legacy lobby the
  "legacy" setting keeps. The 15 s rule is new owner direction, not legacy (`docs/MIGRATION.md:405-411`).

## 4. New paths
- none expected (tests extend the existing files)

## 5. Exclusive write scope
- `hosting/technical-demo/{bootstrap.py,bundle.py,render.py,config.example.json,README.md,test_offline.py,test_bundle.py,test_stack.py}`
- Not `hosting/technical-demo/stack.yaml` unless a parameter must pass through it (say why); not `hosting/staging-mvp/`,
  `hosting/infra/`, `hosting/placement/`, `hosting/glbridge/`; no Rust.

## 6. Contracts and references
- `hosting/AGENTS.md`: one stack in `ca-west-1`, one host, 12-hour expiry, 8 Mbit/s egress cap, one room: none of
  these limits changes; no secrets in templates, scripts or bundles; agents edit and validate locally; deploys and
  any `aws` command that changes resources are the owner's.
- `crates/rh-server/src/main.rs:1891-1910`: the server's own flag typo-guard test lists the accepted flags: the
  rendered command must use only flags the server accepts (a test renders the unit and checks every `--flag` against
  that list or against `rh-server --help` output captured in the test's fixture: say which).

## 7. Behaviour to preserve
- Default config: the rendered Source and training units are byte-identical to today's (a golden in the test).
- The host's guard, expiry, Postgres, learning mode (`--bot-learning single-writer` on Source) and security options.

## 8. Acceptance checks
- Offline tests (`python3 -m unittest` in `hosting/technical-demo`, or the command its README names): the default
  render equals today's golden; each setting alone and all three together render the expected flags on the Source
  unit and nothing on the training unit; `signature_landmarks` without `map_pool` is refused with a message; an
  unknown `lobby_timing` value is refused; the config example documents the three settings.
- The rendered `ExecStart` for "all three on" starts a real server locally: build `rh-server` and run it with that
  option string on loopback against the repo's seed-1 map until it prints its ready line, then stop it (a script or
  a documented manual check in the README; say which was done and paste the ready line).
- `scripts/gate.sh --quick --allow-protected` passes; the hand-off lists every file under `hosting/` that changed.

## Oracle files (read-only for implementers)
- This is tooling with no oracle author: the implementer's first commit is the failing offline tests (golden of
  today's render plus the new cases), and the coordinator records that commit as the oracle.

## 9. Validation commands
- the offline tests above; `scripts/gate.sh --quick --allow-protected`

## 10. Risk and suggested model tier
Sonnet. The risk is a host that silently launches differently: the default must render exactly today's unit.

## 11. Known traps
- `--map-pool` generates maps off the tick at run time: on the one small host, first-room start may wait for the
  first certified map; the README says what the host does until one is ready (`--map` is the fallback).
- Two places pin the command: the options string (`bootstrap.py:216`) and the `ExecStart` template (`:228`); the
  README repeats it (`README.md:146`).
- Nothing in this packet runs `aws` or deploys.

## Notes from previous attempts
