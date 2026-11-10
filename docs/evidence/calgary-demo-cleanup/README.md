# Temporary Calgary demo cleanup — verified complete

Original expiry remained **2026-11-10 03:50:21 UTC** (November9,20:50:21 Calgary). Root observed EC2 shutting-down with `Client.InstanceInitiatedShutdown`; the read-only instance-terminated waiter completed at03:50:44.724UTC. No manual termination or timer extension was needed. The independent schedule had remained enabled for exactly this guest; its own invocation was not separately attested.

After termination, Root reconfirmed account048226733033/ca-west-1, the exact8-resource CloudFormation manifest, never-enabled bucket versioning, the sole expected124,395,520-byte bundle and no multipart upload. Only `technical-demo/reviewed-demo.tar` was deleted; a fresh list confirmed the bucket empty. Root requested deletion of exactly `rougehalla-demo-20261110-002345`. Its delete-complete waiter succeeded.

The independent final API sweep at03:53:13.229UTC passes all11 checks:

- Guest `i-00b97e48b4e5c4f31`: terminated.
- Root volume and primary network interface: exact service-specific NotFound codes.
- Attached ElasticIP: none (there was no allocated EIP for this guest).
- Bundle bucket, expiry schedule and host security group: exact NotFound/404 responses.
- Host instance profile, host role and expiry role: NoSuchEntity.
- Stack: ValidationError plus the exact missing-stack text, not a generic error.

Root removed ONLY A `play.rougehalla.com`→40.177.243.128 through the authenticated Cloudflare dashboard. Reload confirms used0of200 records and an empty DNS table. The screenshot/hash receipt is retained locally; no production-zone action was taken. Test hosting is now offline. The local Source/Training/router/database, original and new release binaries, Web B/map/bundle/evidence and all worker WIP remain preserved.

This closes the temporary demo resources and lifetime; it is not production durability certification, a final AWS invoice or proof of zero account-wide charges. Actual billing can lag. The CAD20 total cap and original operating reservation were not expanded. See the exact request, waiter, preflight and independent verification receipts. No broad recursive deletion, new infrastructure or privileged game action was performed.
