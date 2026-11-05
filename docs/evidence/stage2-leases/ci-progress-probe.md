# Lease progress CI diagnostics

Rust CI `42059322616` at `485c6f9e` failed the PostgreSQL test's shared-clock progress assertion. The same test passed in
the standalone target but failed when nested in `pg_e2e`. The original log contains no sampled clock, room phase or
per-seat lease state, so the historical cause is **not established**.

Independent diagnosis found no database await holding the director/room locks. Fifty-one instrumented full PostgreSQL
target runs passed. A deterministic 1.6-second whole-process pause reproduced the old assertion: all three leases expired,
the room closed normally and its clock stopped. This proves the old message cannot distinguish scheduling outage from
database blocking; it does not prove that scheduling caused CI's failure.

The test-only repair observes acknowledged post-lock public snapshots from the exact resumed room while its transaction
still holds the real PostgreSQL row lock. It requires active progress above the original 500-ms threshold, verifies both
other seats remain active/leased, and retains expiry, kick, session refusal, takeover, stale-host banking and contention
assertions. Failure output includes room/seat/phase/ack/clock and database deadline state. All TTL, renewal, database,
tick, linger and observation-window settings are unchanged.

Controlled negative cases distinguish whole-process outage from an asynchronously blocked room with healthy peer
renewals; both must fail for their intended reason. The unchanged production positive control passes. The revised
standalone/nested PostgreSQL targets passed all **7 + 9 tests**, independently and again in the working checkout;
warnings-denied server Clippy passed. This strengthens verification and evidence collection; it is **not a claimed
production fix**. Fresh CI must still be observed.
