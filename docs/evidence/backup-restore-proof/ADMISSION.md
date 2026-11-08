# Coordinator admission

The independently reviewed candidate `a2091bc69b1b85100b685e5ac7b0946b4d3bcd35` and focused strengthening
`66c346a4f8f85e6ce855955f790fd7561cd09f78` are integrated on `optimization_port` as `140526e6` and `b9785ecf`.
The coordinator verifies all19 portable SHA256SUMS entries, the unchanged runner hash and exact strengthened test hash.
Between the tested base `86f03cbd` and this integration, the only Rust-tree change is this new integration test;
production persistence/server code and migrations are identical. The independent executable proof and the author's
single strengthened fresh proof therefore retain their stated implementation scope without another broad campaign.

[Independent review and follow-up](REVIEW_FOLLOWUP.md) preserve the original evidence and exact receipts. Both runs
use distinct real PostgreSQL16.15 clusters with durable settings enabled. Actual HTTP/hosted-combat producers create
four result records; two are committed and two pending when the application is killed. Verified old database backends
are explicitly terminated while external lease locks remain held, then all writers are absent before the logical dump.
Cold restore plus genuine spool replay recovers the pending results exactly once, retaining complete metadata and the
grouped maximum original result time. Five negative controls, two live pending-lease exclusions, stale/successor fences,
duplicate retries, authenticated profiles and reconciliation pass. Each proof cleans up its own two clusters.

This closes the bounded local cold-backup/restore proof. It does not certify cloud deployment, PITR, power-loss recovery,
distributed failover or online backups with concurrent writers. Purchase and bot-learning tables are empty in this
workload. An older backup may be restored only after all writers using the newer fence history are stopped or fenced.
No credentials, database dumps or private spool bundles are committed. Native gameplay and wire identities are unchanged.
