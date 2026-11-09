# Owned committed-match settlement receipt

Code `72a5cd8ac40d202348865cfc6e0331842c6e4c13` adds a read-only account receipt. Exact base is `ad219c5e1a4bd4a27fc8379efcc63f9f1bfd46b5` (production gameplay base a0). Branch `codex/owned-bank-receipt` preserves the frozen ad219 proof. Only the persistence read module/export, account route/disabled-storage route and three new contract-test files change. There is no schema, migration, dependency, lockfile, gameplay, protocol, C#, client adoption or deployment change.

## HTTP contract, version 1

`GET /api/profile/{name}/matches/{matchId}/settlement`, with the existing `x-profile-token` header. Credentials never belong in the URL. This route never claims a name, echoes a token or takes a profile ID from the caller.

The name uses the existing callsign syntax and case-insensitive credential check. Match ID syntax is exactly a 36-character hyphenated UUID; uppercase hex is accepted and normalized to lowercase. Other valid UUID spellings, such as compact hex or `urn:uuid:`, receive 400. Syntax checks require no match lookup. GET is the only operation; POST, PUT and HEAD receive 405 with `Allow: GET, OPTIONS`. Existing edge middleware answers OPTIONS/CORS, applies lookup limits, database-slot bounds and whole-request timeouts, and adds `Cache-Control: no-store`.

An authenticated request with no visible own committed row returns 200:

```json
{"v":1,"matchId":"00112233-4455-6677-8899-aabbccddeeff","status":"unknown"}
```

An authenticated request with a valid, consistent own commit returns 200:

```json
{"v":1,"matchId":"00112233-4455-6677-8899-aabbccddeeff","status":"committed","settlement":{"outcome":"won","gvCredited":10}}
```

`outcome` is one of `won`, `draw`, `died`, `mia`, or null for a voided run. `gvCredited` is the actual qualifying ledger credit, a nonnegative whole amount capped by the existing Store whole-amount rule. A zero-credit committed result is still committed. A voided result can also have a committed credit; null outcome does not mean pending.

Unknown means only that no committed row for the authenticated principal and requested match was visible in this SELECT's snapshot. It is identical for a nonexistent match, a match containing only other profiles' results, a nonparticipant, a live session without a result, or work that has not committed. The implementation never looks at live rooms, spools, leases or foreign match existence. A read immediately before COMMIT may return unknown; it does not establish pending work or global nonexistence. No negative cache is used.

Missing, empty, wrong, oversized or unusable token headers receive the existing 403 profile error, including for an unclaimed name; no profile is created. An invalid result document or ledger inconsistency returns a generic 500. Storage/queue failures remain 503, lookup exhaustion 429 and whole-request timeout 408. Errors are never converted into unknown or committed. The disabled/non-PostgreSQL route returns 503 storage_unavailable.

The response contains no current balance, timestamp, numeric profile ID, fence, token/hash, host/region, replay, seed or arbitrary stored field. A client may use a matching owned committed receipt as confirmation of that transaction, then independently refresh the owned profile for its current balance. It must not infer commitment by adding a local wire result to a previous balance.

## Match ID byte order

Format the exact public 16 bytes from Welcome in network order, as `rh_server::room::match_id_string` does. Bytes `00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f` become `00010203-0405-0607-0809-0a0b0c0d0e0f`. No UUID version/variant bit restriction is added: existing MatchIds are random raw bytes.

Later C# adoption must not silently use `.NET Guid(byte[])`'s mixed-endian field interpretation for those network bytes. Format the raw hex groups directly or perform the explicit byte-order conversion. The new API test checks the fixed byte example against both UUID formatting and the existing room formatter. This packet edits no C# code.

## Store and authorization boundaries

The handler verifies the token once with `verify_token_id` and pins that immutable principal. It never re-resolves the name. The new `Store::settlement_by_id` performs one SQL statement: select the result by `(profile_id, match_id)` and read only qualifying ledger rows for that same profile, canonical match reference and `run`/`void_run` reason. PostgreSQL's one statement snapshot prevents mixing a result and ledger observed on opposite sides of a commit. No write lock or result mutation is added.

The ledger aggregate provides count and the sole row's amount/reason. Count greater than one is an integrity failure, even if its minimum happens to match; values are never summed or arbitrarily selected. Supported v1, explicit outcome and integer `gv.total` are required. Later audit fields retain their existing deserialization defaults, while absent receipt fields cannot silently become a zero-credit void result.

The expected amount is the same `whole(stored.gv.total)` clamp used by the existing write transaction. Positive expected credit requires exactly one positive, equal ledger amount with the correct `run` versus `void_run` reason. Zero expected credit requires no qualifying ledger row. Missing positive credit, duplicate rows, negative/mismatched amounts, reason mismatch, unsupported versions and corrupt documents fail closed. Unknown stored fields cannot ride along in the explicit public DTO. Errors deliberately omit raw document contents.

This ledger check matters because the existing write transaction stores the original result while crediting its whole-clamped amount; the raw stored total is not necessarily the credited amount for arbitrary accepted Store fixtures. `match_results.applied_at` is not returned or labeled a commit timestamp: its PostgreSQL `now()` default is a transaction timestamp. The existing award/ledger/result/lease transaction is unchanged.

## Verification and reproduction

Use an owned disposable PostgreSQL database and the pinned tool environment. Assign the exclusive Cargo target and database state after sourcing it. The recorded cluster is system ID `7706099656439344966`, loopback port 64840, with fsync/synchronous_commit/full_page_writes all ON; its exact data directory is in `cluster-identity.json`. It is stopped, with status 3, a closed port and no postmaster PID file. No existing cluster, production data, AWS resource, spending, DNS or login was used.

With `DATABASE_URL` set to that operator's own disposable local cluster, the focused commands are:

```sh
cargo test --locked -p rh-persist --test settlement
cargo test --locked -p rh-server --features postgres \
  --test account_settlement --test account_settlement_memory
cargo test --locked -p rh-server --features postgres \
  --test account_api --test account_api_memory
cargo test --locked -p rh-server --test account_settlement_memory
cargo clippy --locked -p rh-persist --lib --test settlement -- -D warnings
cargo clippy --locked -p rh-server --features postgres --lib \
  --test account_settlement --test account_settlement_memory -- -D warnings
cargo fmt -p rh-persist -p rh-server -- --check
```

All commands passed: 3 new Store tests, 5 new PostgreSQL/API tests, the new disabled-storage test with and without the PostgreSQL feature, and 19 existing account/API plus 1 existing memory regression test (30 passing test executions). Scoped strict lint and formatting pass. The new tests are declared result/corruption fixtures against real PostgreSQL and real HTTP routers, not a fabricated or newly repeated match-producer proof.

Coverage includes owned/foreign/random/live-lease unknowns; uncommitted own-row visibility and rollback across separate connections; genuine Store transaction records for committed, zero, void, negative-to-zero and capped credits; duplicate result stability; name-reassignment races paused between authentication and receipt lookup; and immutable receipts after a real account-API purchase using the same UUID as the match in the purchase namespace. It also checks missing/foreign/oversized/unusable headers without claiming a name, typed/allowlisted output despite unknown private audit fields, unsupported/corrupt documents, missing positive ledger credit, negative/duplicate ledger rows, canonical/network-order IDs, methods, CORS/no-store, lookup rate limiting before database access, slot pressure, unavailable storage and request timeout behavior.

Checks ran on the staged source tree. `RUN.json` records that exact tree and verifies that code commit 72a5cd8a has the identical tree, so passing logs are bound to the committed source without relabeling an earlier candidate. The mechanical compile correction was to use the pinned SQLx `before_acquire` test hook; production semantics did not change during the successful fixture run. Raw check transcripts are preserved in `logs/`.

## Scope and remaining work

The accepted full Source account producer proof, Root's independent fresh drill and cold-restore evidence remain separate and were not rerun. Native gameplay, wire schemas, shared status, both retained standalone binaries and the frozen ad219 branch are unchanged. Client polling/correlation/owner-generation handling, C# adoption, browser proof and deployment remain Root-owned follow-up work. This endpoint does not promise a committed receipt exists for Training or an aborted/unbanked run, and unknown must not be presented as pending.

The ledger already has an owner index; this slice adds no index or schema expansion. No claim of lifetime-history-scale receipt performance is made. Independent review of API/security/receipt semantics is required before client adoption. Verify the portable bundle from this directory with `shasum -a 256 -c SHA256SUMS`.
