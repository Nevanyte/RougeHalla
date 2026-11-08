# Local account-to-result durability flow

This bounded integration proof starts from `198902f42970bd3d71d431931020819b0e36f008` on `optimization_port`
(runtime `70579162`, protocol13/checkpoint25/replay19/observation19/policy13, content `67183626db240b6a`).
It adds only `crates/rh-server/tests/account_durability_flow.rs` and this evidence. Production, schema, identities,
Cargo.lock, shared status records and live data are unchanged. No AWS, DNS, spending or login was used.

## Cross-path gap addressed

Previously, `tests/account_api.rs` obtained HTTP profile tokens but banked its shop/leaderboard test GV through direct
Store calls. `tests/pg_e2e.rs` played real socket matches but created profiles/tokens directly. Those are useful separate
contracts; neither demonstrated that a token actually issued by the public HTTP service survives the complete hosted
admission, room, result-spool and owned-profile path. The new test drives that connection without seeded credentials,
injected outcomes, direct simulation stepping or test-only authentication bypasses.

The test uses real loopback HTTP/WebSocket listeners and a unique database in a private PostgreSQL16.15 cluster. Both
credentials are randomly issued by real HTTP claims. The operator listener uses a disposable bearer credential; public
and operator listeners remain separate. All credentials stay inside the test and are withheld from assertion messages.
The declared gameplay profile is a two-player adjacent-spawn arena, no fill, regeneration, quests, consumables, hazards,
NPCs, signatures, abilities or full arena lifecycle. The simulation still advances normal50ms steps; the room wakes every
3ms to keep this bounded integration check short. A three-second reconnect grace and100ms result linger are test settings.

## Independently asserted boundaries

| Boundary | Actual assertion |
|---|---|
| Claim/open ownership | HTTP issues64hex-character tokens; missing token and the other owner's token receive403; the correct owner can reopen. |
| Public/control separation | Public `/control/rooms` returns404; operator listener without bearer returns401. |
| Hosted admission | Valid profile token without a control reservation is rejected; after real `/control/session` and `/control/admit`, a wrong profile token remains rejected and the correct issued token receives Welcome. |
| Duplicate fresh admission | A second fresh Hello cannot reuse the consumed reservation; it receives BadCredentials. This is hosted-reservation denial, not a new proof of every ProfileInUse race. |
| Disconnect/reconnect | Drop the transport without Leave; the real control view must report `away`, then resume with the opaque session token and observe `seated`. The durable profile ID and fence remain identical. |
| Genuine resolution | Both players send ordinary Attack commands. Each receives an actual wire Result; the two GV totals sum to one kill's10GV. The below-three-human win-bonus gate remains effective. |
| Live durable handoff | The actual room results pass through ResultSpool: exactly two records appended, both committed and pending count reaches zero. No outage or crash is injected here. |
| Result/owner agreement | Each authenticated HTTP profile reports one run and exactly its wire GV; Alice's stored result uses her original resumed fence and matches wire kills/GV. |
| Leaderboard ownership/cache | Prime an empty board before play. The result writer invalidates that cache; the earning owner receives10GV/rank and the named leading entry. An invalid token receives no private `you` row. |
| Lease release | After both commits, no unexpired session lease remains. |
| Duplicate-result retry | Retry Alice's exact committed stored document under the original match/profile/fence after release: AlreadyApplied, unchanged owner profile, and ledger reconciliation remains valid. This is a direct-store duplicate retry, not a simulated crash. |
| Service reconstruction | Stop listeners, close the pool, connect a fresh Store and rebuild routers/director/spool against the same database. Both original credentials reopen byte-equal profile DTOs; the leaderboard is unchanged, reconciliation passes and no pending record is replayed. This is service/pool reconstruction, not process-kill or database restart. |

The whole scenario has a30second timeout. SnapshotTracker is retained per connection across Welcome, active snapshots
and results, including the resumed connection; deltas are decoded against their real received base.

## Checks

Using `return-cleanup-2026-11-08/final-env.sh`, then overriding `CARGO_TARGET_DIR` and `RH_PGTEST_STATE` to the lane's own
absolute `account-durability/target` and `account-durability/pgtest-state` paths:

```sh
eval "$(bash tools/pgtest/start.sh)"
cargo test -p rh-server --features postgres --test account_durability_flow --locked
cargo clippy -p rh-server --features postgres --test account_durability_flow --locked -- -D warnings
rustfmt --check --edition 2021 crates/rh-server/tests/account_durability_flow.rs
```

One integration test passes (final execution1.32seconds); strict target Clippy and formatting pass. Existing unchanged
PostgreSQL suites were read for the gap audit and deliberately not rerun. Private raw receipts are under the lane's
`account-durability/logs/`. An initial test-client Delta/NoBase failure is retained there; retaining a tracker per
connection repaired the test without changing production. No account production defect was found in this bounded flow.

## Current-state audit and remaining ownership

| Original scope | Current implementation and remaining integration |
|---|---|
| Hub profile claim/sign-in | Rust public `/api/profile/{name}` claims/opens, with `x-profile-token` and optional `x-playtest-passcode`; shop and private leaderboard routes exist. Legacy TS stores proven per-callsign credentials and supports fragment-key sign-in. Unity Bootstrap currently takes query credentials or generates an unrelated token; MatchClient.Join forwards that token. No Unity account HTTP adapter, persistent ownership UI, balance/profile hub or sign-in recovery flow exists yet. |
| Arena placement/ticket | Local default admission accepts the profile token as opaque Hello.ticket. Hosted `require_admit` additionally requires a trusted control reservation and never replaces profile auth. `/control/session` supports only maxPlayers/fillBotsTo properties. There is no public lobby/matchmaking REST route; credentials never authorize a browser to call the operator listener. |
| Training | Director construction explicitly refuses a training SimConfig; Hello has no arena/training selector and control creation has no training mode. Native training correctness and an approved public room/profile admission contract are prerequisites. Adding a button or weakening the refusal would invent server capability. |
| Reconnect/session ownership | Existing live fenced-ID/lease-renewal and connection replacement code remains; this test adds the issued-token/hosted away→resume connection. Page-reload resume persistence and duplicate-tab user experience remain Unity work. |
| Death/result/GV | This proof joins actual wire results to HTTP-owned durable profile/board data. Full gameplay rewards, equipped cosmetic publication and Unity profile refresh/error presentation remain distinct work. |
| MIA/shutdown voiding | Existing pg_e2e MIA, control abort-versus-MIA and Store void-result tests are separate revision-scoped evidence. The new test does not exercise those paths and does not refresh their claims. |
| Crash/retry/fencing | Existing result_recovery covers same-volume process kill, database outage, dead letters, stale fences and spool bounds. This proof covers live handoff and an exact committed retry only. Cross-volume loss, managed failover and operational recovery remain separate gates. |
| Export/migration/reconciliation | Existing admin commands/tests implement import, redacted legacy export and ledger reconciliation; export cannot recover plaintext credentials, so legacy rollback requires the original pre-migration backup. This proof checks reconciliation against real match credit. It does not migrate live account data. |
| Database backup/recovery | No `pg_dump`/`pg_restore` or point-in-time recovery rehearsal was found in the inspected docs/tools/rh-persist scope. A separate disposable-database backup→restore→owner-auth/ledger/result/lease verification and an explicit rollback runbook remain required under R-PERSIST-2. |

Next client work needs a narrow sequential lease: a new thin HTTP account adapter and account panel, Bootstrap wiring,
then MatchClient.Join/Leave and MatchHud menu/result hooks. Preserve existing query-driven diagnostic joins explicitly;
ordinary persistent mode must claim/open successfully before fresh Join, keep ownership tokens out of URLs/logs, serialize
same-name claims and prevent stale async responses from replacing another selected profile. Preserve Session's existing
opaque-token reconnect path; refresh the owned profile after actual result/return without claiming the bank happened
before the HTTP read confirms it. Hosted placement remains an explicit unavailable/pending state until a public placement
contract is allocated. This plan grants no client/room/protocol write lease itself and does not close full R-GAME-4/5.
