# Independent placement durability repair review

This review supersedes the producer's acceptance claim for the two ambiguous-effect boundaries described below.
The producer evidence remains historical and unchanged. Producer commit: `4843cd51551f71e43228a75dd3c83effe0228bb3`;
producer base: `de6f1c196f9b6a42e50dfdf19327d72bd3683fc8`. Review checkout is detached from that producer commit.
Coordinator integration base at assignment: `7f294cc7` on `optimization_port`. Final integration belongs to the coordinator.

## Original semantic failures (preserved)

The coordinator reproduced both failures against real PostgreSQL and a separate persistent TCP fake, before this repair:

1. `late_start_intent_stays_reapable_until_definitive_provider_evidence`: an already-sent start held at the provider was
   forgotten after two NotFound responses and the configured settling interval. The row became `Finished/Settled`; the
   start could still be applied later. Elapsed time and absence do not cancel a remote request.
2. `late_dns_upsert_keeps_recovery_discoverable_until_the_name_is_cleaned`: takeover replaced the upsert intent with cleanup
   progress and finalized the row. The fake trace was Start → DNS Delete → Terminate → late DNS Upsert; the recreated name
   had no recoverable row. A newer successful upsert or delete cannot drain an earlier unknown upsert.

Original logs/JSON are preserved externally as `late-start-contract-before.{log,json}` and
`late-dns-contract-before.{log,json}` under `placement-durability-review/`; their exact hashes are included in the repair
manifest. The producer's test asserting that a late start is deliberately untracked was removed, not counted as a contract
success. Its source and passing bad-control log remain immutable at the original producer SHA and in coordinator evidence.
The equivalent shared-store repeated-absence test now requires `Active/Open`. The lost-DNS-receipt crash test now requires
continued discoverability after successful cleanup, because it has no evidence that drains the send.

The additional migration failure is preserved as `repair-v2-legacy-writer-before.{json,log}`: original v2 CAS SQL on a
connection opened before upgrade accepted a start-intent write without the new field. The repaired counterpart requires
PostgreSQL CHECK violation SQLSTATE 23514 for legacy start, cleanup and finalization writes, with state/version unchanged.

## Repair and compatibility

* No number of NotFound responses or elapsed time finalizes an ambiguous start. NotFound observations saturate their counter
  rather than eventually overflowing. `start_settle_after` remains a compatibility-only ignored setting.
* `AttemptRec::dns_upsert` is separate from `DnsStep`: `Idle`, `InFlight`, `Ambiguous`. Each upsert persists its own intent;
  a successful receipt clears only that run's single `InFlight` send through the current fence/version. Retrying with an
  unresolved earlier send makes the obligation `Ambiguous`. No later receipt, authoritative answer, delete or termination
  clears it. Uncertain commit reconciliation remains the sole authority for whether an acknowledgement landed.
* Cleanup keeps the original hostname and repeats on bounded reaper passes indefinitely while a DNS send is unresolved.
  The store refuses offers and finalization with an unresolved send; retention never purges these active identities.
  Successful first-send publication and trusted explicit release still complete normally.
* Schema version **3** fences older binaries on reopen. A nonempty v1/v2 placement ledger returns typed
  `LedgerError::Incompatible` before changing its rows, schema or nonce. Empty old ledgers upgrade while retaining the epoch.
  Nonempty older ledgers require a quiesced, explicit operator reconciliation/migration plan; nothing is automatically
  deleted or rewritten. Stop old workers before upgrading. No production ledger has been deployed by this packet.
  Root review found that startup checks alone did not fence an already-open v2 connection. Candidate v1 was preserved;
  a compiled real-PG test reproduced the unsafe legacy write. Candidate v2 additionally installs a database CHECK requiring
  explicit valid `dns_upsert` on each attempt, rejecting the original v2 CAS SQL even from a pre-upgrade pool before its
  side effects. An exclusive table lock makes emptiness check and upgrade atomic against legacy inserts. A deterministic
  PostgreSQL lock-wait test proves a racing old insertion forces migration refusal without modifying its data.
* No gameplay, protocol, account-persistence, hosting or cloud-resource changes. The required coordinator-owned lock hunk
  is still exactly one `"sqlx"` dependency entry under `rh-placement`; SQLx 0.8.6 was already locked.

## Complete acceptance review

| Acceptance boundary | Reviewed implementation and evidence |
|---|---|
| Actual durable service path | `PlacementService::with_ledger`, `place_with_scoped`, `Run::commit`, reaper and release all use the provided ledger. Memory remains default; both stores run shared conformance/service cases. |
| Claims, fencing, uncertain commit | Store-clock leases; exact holder/kind/fence/version CAS. Shared tests cover exclusive claims, expiry/takeover, stale writes (including same-claim delayed writes), committed-but-unreadable offers and absent/committed-but-unreadable DNS acknowledgements. |
| No transaction across external await | PostgreSQL transactions are limited to schema/epoch operations; claims/writes are standalone statements. `Run` owns values, not a DB transaction, when awaiting GameLift/DNS. All calls have explicit budgets. |
| Bound request and ownership | Canonical scope/request/config fingerprint, durable epoch and exact attempt binding. Existing missing/foreign/wrong-ID/cancellation/stop→describe regressions retained. Contradictory evidence never authorizes cleanup. |
| Original zone and immutable offer | Stored hostname/zone used after configuration changes. Offered rows excluded from automatic recovery and retention. Identical retry replays committed offer; conflicting scope/config/request refuses before external mutation. |
| Trusted explicit release | Only ledger-bound `release_session(scope, request_id, placement_id)` production path. Wrong identities, original zone, duplicate/half-done/tombstoned release tested. No age-inferred session end. |
| Bounded work and retention | `reap_batch` bounds each pass; one row claimed at a time; active/unresolved/offered rows never purged. Memory capacity refuses new identities without evicting old work. PostgreSQL full identity retention is intentionally unbounded for unresolved work. |
| Cancelled reaper | Added deterministic shared-store case cancelling at a describe barrier with current and unvisited rows; a new service after lease expiry recovers both. Real PostgreSQL and memory both pass. |
| Six crash boundaries | Existing 11-test child harness retained: committed start intent, accepted start/lost receipt, fulfilled/lost DNS receipt, DNS verified/before offer, committed offer/before response, accepted cleanup/before completion. Children abort/SIGKILL; parent TCP fake and real PG survive. |
| Delayed effect application | Existing stop/delete/terminate and stale resolver tests retained. Coordinator late-start/upsert regressions pass. Added one held upsert followed by success and three held upserts, releasing each after cleanup with restart, changed zone and purge attempts; all remain discoverable. |
| Arbitrary age and repeated absence | Added held-start test with century-old start/retention metadata, four restarted reapers and repeated purge attempts before applying the late start; exact owned cleanup resolves it afterwards. DNS ambiguity is similarly preserved through old metadata and repeated restarts. |
| Negative controls | Original runtime mutant script runs the unchanged control plus omitted write-ahead, omitted ownership comparison, removed fencing and premature completion against all four acceptance suites. Only compiled behavioral failures count. |

## Verified bounded gates

Final candidate v2: **233 tests passed**, 0 failed/ignored/filtered with `postgres,fault-injection`; default feature gate:
**144 passed**, 0 failed/ignored/filtered. Formatting and strict default/all-feature Clippy passed. Rust 1.97.0,
PostgreSQL 16.15, native aarch64-apple-darwin; 2 Cargo build jobs, incremental compilation disabled, shared warm target.
The explicit missing-`DATABASE_URL` check exited 101 with a required-database panic (1 failed, never skipped).

The final unchanged negative-control runner exited 0: all control suites passed; each mutant caused compiled behavioral
failures. The numbers below are failed test cases (P means all cases passed).

| Mutant | Crash/restart | Delayed effects | Durable service | PG conformance |
|---|---:|---:|---:|---:|
| none | P | P | P | P |
| skip_write_ahead | 4 | 6 | 26 | P |
| skip_ownership_check | 2 | P | 10 | P |
| skip_fencing | P | 2 | 5 | 3 |
| premature_completion | 7 | 5 | 41 | P |

## Operational limits

An unknown DNS send remains a permanent reconciliation obligation with this backend interface. Reaping can remove a late
record but cannot prove that every earlier send has drained. A name may reappear between reaper passes. A crash after
persisting intent but before sending may conservatively retain work forever. This is intentional safety, not exactly-once
execution. A future adapter-level operation/drain/cancel proof would require separate design and tests.

All data here is synthetic. No AWS/DNS production adapters, public TLS, production HTTP authentication, result-spool host
loss or gameplay completion is claimed. The coordinator owns final workspace/parity and integrated branch checks; the
private bounded review runs placement-specific gates and does not duplicate broad map/workspace work.

See `repair-results.json` for exact commands, exit codes, counts and log hashes, and the immutable external repair package
manifest for complete source-file hashes. The API example and current state-machine documentation are in
`crates/rh-placement/README.md`.
