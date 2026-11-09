# Owned match settlement — independent security/source review

Decision: RELEASE bounded endpoint/read-contract packet. Exact code72a5cd8ac40d202348865cfc6e0331842c6e4c13, parentad219c5e1a4bd4a27fc8379efcc63f9f1bfd46b5; evidence-only seal1f40b679c8a989544c674cd6eb6b107480de99b3. No blocking authorization, integrity, snapshot or response-privacy defect found. Root owns composition and client adoption.

Verified manifest SHA25679c7253f014d4f8c9d28dc3835de0083d76c3bec683093401c16b53629be6219: all7source and11payload entries match SHA256/length/Git blob identity; all12 checksum entries match. RUN verified_index_tree16f9495fdd0bf231016a5003a42f629473a7c8a4 equals exact committed source tree. Source changes only four production paths and three tests. Seal changes only new evidence. No schema/migration/lock/gameplay/wire ABI/client/shared-status edit. Checkout clean. Reviewer did not build/start services/run PostgreSQL or a producer proof.

## Authorization and information boundary

GET/api/profile/{name}/matches/{canonicalUUID}/settlement uses the existing x-profile-token. Callsign and canonical hyphenated UUID shape are checked without reading match existence; equivalent UUID letter case normalizes to lowercase. Existing verify_token_id reads durablePID+credential hash from one row and verifies the token once. Only that immutablePID+parsedUUID is then bound into settlement_by_id. There is no claim/create path, name requery, matches/other-player lookup, lease/spool inspection or foreign outcome test.

Missing/invalid/oversized/foreign credentials retain the existing uniform403 response and do not claim an unused name. Once authenticated, no own committed result produces uniformv1/matchId/statusunknown, regardless of randomUUID, foreign committed result, live lease, uncommitted own row or rolled-back own row. Unknown is explicitly not pending/failed/nonexistent globally. The caller-provided normalized matchId is the only echoed correlation key.

## Atomicity and receipt integrity

One PostgreSQL statement anchors own match_results row and laterally aggregates own qualifying gv_ledger rows under the same MVCC snapshot. It counts entries and checks min(delta)/reason only after requiring exactlyone valid positive row; duplicates cannot sum or select a convenient row. run/void_run are the only qualifying reasons, so an actual purchase with the sameUUID ref does not contaminate the match namespace. No current balance, profile counter or applied_at timestamp is used to infer commitment.

StoredResult must have exact supportedv1, an explicit outcome key and integral total before serde parsing. Missing outcome/total cannot default into a fabricated zero/void receipt. Invalid/unsupported documents and invalid/missing/negative/duplicate credit evidence fail closed through generic500, not unknown or zero. whole(rawtotal) matches the existing writer's0..MAX_SAFE clamp, including legitimate declared negative-to-zero/capped Store fixtures; this is deliberately credited amount rather than blindly returning raw stored total. Legitimatezero requires no qualifying ledger row; void outcome is nullable and uses void_run for positive credit. Existing writer/transaction and append-only ledger trigger are unchanged.

Public DTO is constructed explicitly: v,matchId,status and, only when committed, settlement{outcome,gvCredited}. No raw JSON/audit/fence/replay/secret/identity/currentbalance/commit-time/foreign-state field can ride along. Unknown private stored fields are ignored, not serialized. Failure text is generic and the store integrity error is static.

## Edge controls and test quality

The new path remains inside existing profile route_layer lookup guard before storage, held DBslot, whole-request timeout, CORS/preflight and no-store edge. Method restrictions are GET/OPTIONS; storage-disabled route returns503 unavailable without commitment status. Busy/unavailable/timeout/corruption never become unknown.

Real-PG fixtures meaningfully exercise committed/zero/void/clamp/duplicate receipt stability; owner/foreign/random/live/uncommitted reads across connections; rollback; corrupt versions/missingfields/unknownoutcomes/ledger anomalies; actual purchase reducing currentbalance without altering receipt; and minimal allowlisted outputs. A deliberate pool acquisition pause occurs after authentication and before receipt read, then an external connection renames Alice and reassigns the old name to Victim. Both own42 and foreignunknown assertions require use of the originally authenticated principal. This is a concrete rename race control, not a sequential name-only check.

Raw logs report30passing executions:3newStore;5newPG/API; disabled-storage test with and withoutpostgres;19existingAPI+1oldmemory regressions. Strict scoped persist/server lint and format pass. Store setup is fail-by-default withoutDATABASE_URL(unless explicit skip+unset), API tests require actualDB, and retained logs contain no skip. Cluster receipt binds loopback64840/system7706099656439344966 with fsync/synchronous_commit/full_page_writes ON. Cleanup receipt records pg_ctl3/closedport/absentPID and retained a0/a3d binary hashes unchanged. These are retained author execution/cleanup records, not a new reviewer run.

## Limits

This is a new authenticated API backed by declared result/corruption fixtures using real Store transactions and HTTP/PG; it is not a new earned Source match producer witness. The prior genuine native/account bridge, Root's independent retake and cold restore remain separate and unmodified. No Training/aborted-run receipt is promised; client must treat unknown honestly. Client matchUUID correlation/network-order conversion, owner-generation polling/cancellation, C# DTO adoption, browser bank-complete presentation and deployment remain held for Root's next packet. No remaining condition blocks integration of this exact minimal API/read-contract seal.
