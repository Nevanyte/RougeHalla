# Explicit Source Arena and Training admission

This packet activates existing native game modules through explicitly configured server endpoints. It does not change simulation rules, tick order, protocol 14, public observation schemas, policy contracts, C#, fixtures, dependencies or shared status records.

Exact base: `a3d4b3ce575442c9a06916888035ca849a6cd05a`. Implementation: `bc5399809eb2d5d53c3682e8bdb40de168f1cc2b`. Final code/test checkpoint: `5ae618e600db489f7703399830ed0434320b4dd6`. Branch: `codex/full-runtime-admission`. The second code commit adds only the captured full-map admission test. Code and evidence are separate commits.

## Endpoint contract

Protocol 14 Hello has no mode field. Each process/listener has one configured runtime. The operator must route Arena and Training clients to their corresponding endpoints, including distinct hosted placement/control sessions. Hello build, profile, ticket and resume strings never select the runtime. This packet provides no mixed-listener mode negotiation or new placement API.

| Selection | Configuration and admission |
| --- | --- |
| No runtime flag, or `--runtime core` | Existing core configuration and map loader. Existing `--wish-full` opt-in remains available. |
| Existing `--first-playable` | Existing embedded map, selected PvE configuration, eight seats and process lifetime remain unchanged. It cannot be combined with `--runtime`. |
| `--runtime source-arena --map <export>` | Requires an explicit validated `rh-map/2` export, with the existing checks for collision/terrain/region layers, real ordered gates, coliseum and spawns, plus public wire position bounds. Enables Source lifecycle/default rules (including Planning), Full abilities, `EngagementHolyPlagueFireFrostSentencedFireRoam`, PvE, initial loot, consumables, regen, quests/traders and `terrain::Mode::All`. |
| `--runtime training` | Existing practice arena, one human per room, immediate Active start, dummies, Full abilities and the same full faction mode, regen/consumables, terrain Off and lifecycle Off. No quests/traders, PvE, initial loot, bot fill, run results or private replay. Each concurrent admission reserves its own solo room. |

Source defaults are minPlayers 2, lobby 30 s, fill 5 s, fillBots 0, maxRooms 16. Runtime seat counts are whole and bounded by the native seat cap; maxRooms must be a positive whole value. Durations must be finite, nonnegative and at most 86400 seconds. Training accepts only minPlayers 1, fillBots 0 and zero lobby/fill durations. Training rejects `--map` and explicit bot learning; inherited environment bot fill cannot add bots. New runtime selection rejects unknown modes, misspelled `--runtime*`, duplicate selectors, missing values and incompatible first-playable configuration with exit 2. Existing unrelated flag parsing is unchanged.

Hosted `POST /control/session` on Training defaults to maxPlayers 1/fillBotsTo 0 and rejects incompatible overrides. Its first admitted Hello enters a Lobby seat and the native next step enters Active. Further new admissions to that room are refused. Resume remains the existing session-capability path and consumes no new admit. Source control rooms report `planning`, not `lobby`, when Planning begins, and close new admission then. The existing credential, lease/fence, drain, expiration and result paths remain in use.

## Reproduce

Use the repository's pinned tool environment. Assign the target directory after sourcing it; do not share an active Cargo target with another worker:

```sh
source /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-env.sh
export CARGO_TARGET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rh-runtime-target.XXXXXX")"
export CARGO_BUILD_JOBS=1 CARGO_INCREMENTAL=0
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
cargo test --locked -p rh-server --lib --bin rh-server \
  --test runtime_admission --test control --test live --test transport
cargo test --locked -p rh-server --features postgres --test runtime_admission
cargo fmt -p rh-server -- --check
cargo clippy --locked -p rh-server --all-targets -- -D warnings
cargo clippy --locked -p rh-server --all-targets --features postgres -- -D warnings
```

These tests use disposable loopback listeners. They need no PostgreSQL server, account login, production data or cloud resources. The feature-enabled run exercises the real PostgreSQL-capable binary without configuring a database; it does not claim a new PostgreSQL durability proof. The separate cold-restore evidence remains under `docs/evidence/backup-restore-proof/`.

For local manual use, start separate processes/ports. The small admitted map below is suitable for exercising the interface; it has the documented limited populations in `maps/README.md`:

```sh
cargo run --locked -p rh-server -- --runtime source-arena \
  --map maps/first-playable.json --bind 127.0.0.1:7777
# In another terminal, with its own Cargo target or the already-built executable:
cargo run --locked -p rh-server -- --runtime training --bind 127.0.0.1:7779
```

The captured 160x160 source export is nested at `.map.export` in `parity/arena/source.json`. The focused full-map test imports only that unchanged map, never recorded actions, secrets or expected results. A standalone export can be obtained with `python3 -c 'import json,sys; json.dump(json.load(open("parity/arena/source.json"))["map"]["export"],open(sys.argv[1],"w"))' /task-owned/path/source-map.json`, then passed to `--map`. Import validation does not establish new generator parity or authenticate the captured legacy map-hash metadata.

## Verification and negative controls

`runtime_admission.rs` runs encoded Hello, Input, SnapshotTracker decoding and the production public/control routers. Its six cases prove:

- Hosted Source session creation/admission, exact Planning phase reporting, private owner choice and Ready into actual Active. The client walks to a delivered quest-giver position, waits for authoritative `can_accept`, accepts its public quest handle, navigates using public map/visible merchant positions, obtains genuine nearby broker offers and completes an ordinary stat trade. Another acknowledged owner view remains unaccepted. A Training grant sent to this Arena endpoint is acknowledged and awards no card.
- Independent concurrent Training rooms, actual owner-only interactive Tank Engine console grant, separate acknowledged owner state, a third admission refused at capacity, unchanged state across resume, room closure after Leave, zero recorded results and no replay.
- Hosted Training session default/override validation, credential-plus-admit requirement, first seat becoming Active, later admission refused and resume into the same Active room.
- Real main binary startup for Core, Source and Training; the Hello build contains both mode names in every case yet never selects them. Training still excludes bots with `BOTS_FILL_TO=8` inherited by the binary.
- Real binary exit-2 rejection of unknown/misspelled runtime, incompatible Training seats/fill, first-playable combination, missing Source map and collision-only `rh-map/1` input.
- The unchanged captured full source map, through real encoded Hello, Planning/Ready and Active snapshots plus quest/trade state with the public terrain mode and layers intact.

The server unit/control/live/transport suites retain existing credential/protocol/content checks, unknown control-field/version rejection, public/control listener isolation, private Plan delivery, observer handles, stale connection and resume rules, atomic publication failure and wire range/bound refusal. Final checks passed: 182 server unit tests, 7 binary unit tests, 24 control tests, 17 live tests, 6 runtime-admission tests and 7 transport tests (243 total), plus all 6 runtime tests in the PostgreSQL-feature build. Formatting and strict lint passed in both builds. Strict lint covers all server targets, with and without the PostgreSQL feature. `RUN-final.json` binds final commands, elapsed times, exit codes and logs to the exact code/tree. Earlier passing checks at the implementation commit are retained separately in `RUN.json`; they are not relabeled as final-code runs.

Development caught a test choosing a ready but non-interactive augment; the console correctly ignored it. The final test uses the same interactive Tank Engine producer exercised by native Training tests. Strict lint also corrected two copies in the test decoder. No production defect was hidden or repaired outside this packet.

## Limits and rollback

This is local runtime-admission evidence. It is not full-game release acceptance, a browser/Unity result, cloud hosting/placement/TLS evidence, a generator campaign, a long-match load test, or proof that every valid map stays within every public collection bound for its entire lifetime. Public publication retains its existing checked, atomic refusal behavior. The small-map gameplay test and one captured full-map startup are explicitly distinct. Training intentionally has no quest/trader workflow.

Use distinct configured endpoints in the caller/hosting bridge. Mixed-mode admission, authenticated mode placement and browser selection across those endpoints remain integration work. No public header or private metadata shortcut was added here. The retained a3d standalone server and Unity Web artifact were not modified.

To roll back, drain/stop the task's Source/Training processes through the existing lifecycle and restart the previous executable/configuration. Remove the new runtime flags or select Core; keep existing first-playable configuration where required. This packet adds no database migration, credential conversion, stored result format or wire format to reverse. Only stop processes/listeners created for this task. Existing database-recovery rules still apply independently: old writers must be stopped or fenced before an older database is restored.

Verify the portable evidence bundle from this directory with `shasum -a 256 -c SHA256SUMS`. `MANIFEST.json` lists payload and code/input hashes; raw logs are retained byte-for-byte.
