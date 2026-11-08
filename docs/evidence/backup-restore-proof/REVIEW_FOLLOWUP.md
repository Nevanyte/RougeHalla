# Independent review and focused assertion strengthening

The OPTimization_port lead arranged independent review of `a2091bc69b1b85100b685e5ac7b0946b4d3bcd35` in a detached
`backup-restore-review/repo` checkout, with a separate build target and fresh `backup-restore-review/run-01` PostgreSQL
state. The reviewer released that bounded implementation after one full executable proof. The independent receipt
SHA-256 is `5b1f52e447e941bc3c1175a36e44e09e763acdede4437c5b846d917cd0617303`; its raw receipt is retained privately at
`/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/backup-restore-review/run-01/receipt.json`.
[Independent audit](review-followup/independent-review-a2091bc6.json) records the checked results, including all five
negative controls, both fresh live-lease exclusion probes, complete pending metadata and identical recovered/duplicate
snapshots. The lead confirms both reviewer databases stopped, ports closed and no credential leakage.

Before integration the lead requested one small strengthening: the original Rust assertion tolerated 1000 ms against
individual record timestamps and omitted explicit stored-version/fence/callsign and region/placement checks. The reviewer
independently checked the intended stronger guarantees and observed zero timestamp error, so this is an assertion gap,
not a production defect. No production changes were requested or made.

The follow-up changes only the reserved Rust integration test and this evidence:

- Query and assert each stored result's match UUID, profile ID, original fence, callsign, version and complete body.
- Assert every original spool metadata field, including region and placement ID, plus absence of an unproduced replay
  reference. These local producer records have no region/placement; no populated cloud metadata claim follows.
- Group original records by match and compare `matches.ended_at` with the **maximum original `spooled_at_ms`** in that
  group. Individual record times need not be equal. The tolerance is **0.01 ms**: PostgreSQL timestamp resolution is
  0.001 ms, and float8 epoch conversion adds less than a microsecond at this epoch. This permits representation rounding
  while rejecting a substituted recovery-time timestamp.
- Record complete-envelope/metadata counts, time-group count, tolerance and maximum observed error in the private audit
  and public fresh receipt. The existing runner, real HTTP/combat/spool producers and all other checks remain unchanged.
- Explicitly label purchases and bot-learning coverage as empty-table preservation, not populated-history recovery.

Exactly one fresh whole executable proof is run after this strengthening, followed by affected formatting and strict
Clippy. The fresh receipt, audit, bounded log and checksums are in [review-followup](review-followup/receipt.json).
The original full proof and delayed saved-bundle evidence remain preserved at their original implementation identity;
no extra saved-bundle or broad workspace suite is counted for this follow-up.

Final follow-up run `run-09` passes: two complete result envelopes, two complete metadata records and one grouped match
time checked, with maximum original-time error **0.0 ms**. The full cold-start/restore/negative-control/application
verification clock is **0.428 s**, excluding initial target setup and compilation as before. All four profiles,
four result rows, two paid ledger rows/20 GV, five negatives, two fresh live-lease probes and duplicate/successor fence
checks still pass. The fresh tested parent is `a2091bc69b1b85100b685e5ac7b0946b4d3bcd35`; the exact strengthened test
SHA-256 is `daa5c6d2fe4e07e51f3712f0b9d324c3a0c4adc05679915a761903d779971134`. The runner SHA-256
is unchanged at `9bb9083f37a2a8323eab2f77b4c00602dea0eb2cb7d28ff71c2084f5fad11e1c`.

Reproduction uses the original pinned environment and task-owned target, then:

```sh
python3 tools/backup-restore-proof/proof.py --state /absolute/private/new-followup-directory
cargo clippy -p rh-server --features postgres --test account_backup_restore_flow --locked -- -D warnings
rustfmt --check --edition 2021 crates/rh-server/tests/account_backup_restore_flow.rs
```

The fresh private raw state is `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/postgres-cold-restore/run-09`.
Dump and credential contents remain outside Git. No cloud, power-loss, PITR or populated purchase/bot-learning guarantee
is added. No production defect or scope expansion was needed.

Strict target Clippy and formatting pass. [Validation](review-followup/validation.txt) records the affected checks;
all five controls and both live pending-lease probes execute in the new proof. Both task-owned run-09 clusters are stopped.
