# Morning hosting preparation — independent review

2026-11-10. **HOLD at clean `28d21c3f907dc8902705eb6484477321c8113a39`** in `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-morning-host`, compared with base `5e37958a42980306b03f9c2556a57844d7ed5204`. One bounded response-type defect remains. This reviews offline preparation only; cloud/browser/final-artifact acceptance remains a separate gate. No Rust, AWS, primary checkout, shared status or source fixture was changed. No communication with Claude occurred.

## Required narrow repair

`hosting/technical-demo/bootstrap.py:312` compares returned `/info.protocol` with Python `==` without validating the returned type. Python accepts JSON `14.0` as equal to configured integer14 and JSON `true` as equal to configured integer1. Both are demonstrated by an independent mocked HTTP response in `identity-negative.txt`; the probe exits0 because the current readiness function incorrectly accepts both.

The config itself is correctly strict (`bootstrap.py:33`): `type(protocol) is int`, nonboolean, range1–65535. Apply the same strict integer/nonboolean/range validation to the actual `/info` protocol before equality. Keep exact content-hash matching. Do not coerce, stringify or round the response. The actual reviewed server emits an integer, but the strict identity boundary must reject malformed response types rather than relying on that implementation detail.

Required finite controls: valid configured integer identity passes; protocol14.0 versus configured14 and true versus configured1 both fail with ValueError, on both7777 and7779; retain stale protocol/hash refusals and connection closure. Run the two existing offline suites and diff check after the narrow Python/test repair. No cloud run, broader campaign or Rust change is required for this HOLD.

All startup/precheck callsites share `ready`: Source initial gate (`:382`), Source+Training gate (`:393–394`) and CLI ready used by Caddy restart precondition (`:421–424`). Repairing this boundary therefore covers all three without changing deployment order.

## Accepted preparation and limits

- Exact config keys require protocol and content_hash; protocol rejects bool/zero/over-u16 and content_hash is exactly16 lowercase hex. Invalid example protocol0 deliberately prevents launch without replacement. Bundle SHA remains separate from binary-reported identity.
- Source starts and must pass storage/identity before Training starts; both must pass before public Caddy. Caddy ExecStartPre repeats both checks, and PG/apps/shape/isolation retain expiry guards. Neither expected identity is newly hardcoded to a stale binary.
- Original absolute UTC expiry remains fixed in config. Accepted remaining time is strictly positive and at most12hours. `render.py` derives the guest timer from that original timestamp, with Persistent=true,1s accuracy and no randomized delay; timer is armed before setup. Boot/restart guards do not renew the deadline. CloudFormation's one-shot UTC Scheduler still targets the same exact instance with bounded retries; template only changes explanatory comments in this commit. Equality of CFN ExpiresAt and embedded config is an explicit later Root launch check, not falsely claimed template enforcement.
- Existing bundle extraction, isolation/shaper, roles/permissions, listeners and failure handling remain unchanged by the diff. The eight changed files are five hosting files and three author evidence files. No new application or public network surface is introduced here.
- Cost arithmetic is internally consistent:8mbit over12h=43.2decimalGB; USD3.888+0.2784+1=5.1664, times1.50 and1.25=CAD9.687. The per-initialization burst and lack of a billing hard cap remain disclosed. Current prices, balances, actual transfer/host behavior and final budget approval were not verified by this offline review.

## Independent checks and evidence

From the clean native preparation checkout, Python3.9.6, with `PYTHONDONTWRITEBYTECODE=1`:

| Command | Actual reviewer result |
| --- | --- |
| `python3 -m unittest discover -s hosting/technical-demo -p test_offline.py -v` | exit0;12PASS/0.027s (`offline-tests.txt`) |
| `python3 -m unittest discover -s hosting/technical-demo -p test_stack.py -v` | exit0;7PASS/0.007s (`stack-tests.txt`) |
| `git diff --check 5e37958a..28d21c3f` | exit0; empty |
| Inline mocked `bootstrap.ready` probe | both malformed numeric response types accepted (`identity-negative.txt`) |

The independent probe imported `bootstrap` with bytecode disabled, patched `bootstrap.http.client.HTTPConnection`, returned HTTP200 and valid `/readyz` fields, then returned `/info` with fixed matching contentHash and either `(expected14, returned14.0)` or `(expected1, returnedtrue)`. It called actual `bootstrap.ready(7777, expected)` and printed only upon acceptance. No sockets, AWS calls or services were started. Source checkout remains clean at the same HEAD afterward; the final identity log includes that HEAD.

Author receipts were also read:12offline/7stack PASS; exact command/cwd binding in `docs/evidence/morning-host-preparation/README.md`. The source hashes in that README independently match current bytes:

| Path under `hosting/technical-demo/` | Bytes | SHA-256 |
| --- | ---: | --- |
| bootstrap.py |21242|`a45068fdb959b884656fe0e524bd24f84f478c7e5424479ec5fc9e496b876a16`|
| config.example.json |333|`629ccb1791e9effe27cf5d11ae7dd8d73af5190c4c966060fb815fd7655f7ed2`|
| test_offline.py |14174|`fa665e9a7468e9bdecccd5a1a7d2b5a162f9366a23c0c3486c247b7603823e32`|
| stack.yaml |9195|`7a01e8478bc2ebfe5782c4e2005080034bd98894299e236e499fff59c6d82e4e`|
| README.md |16125|`dfdbbdc37ec96ab4fc0fbdc32916cbccfdfb24073c8cc99a01dfaedd842c5555`|

Author raw receipt hashes: test-offline.txt906bytes/`b6d60dc662b559ebbca57cb035e71a160250168a6d89be5895076ff210440d65`; test-stack.txt704bytes/`7e341f4673f8b102cf0115b40f89e14f93d09dbc20c1b07ee1ee4aab876f8008`.

**Disposition: HOLD only for strict returned protocol type/range validation and the two meaningful malformed-type controls.** Preserve all existing passing offline evidence; re-review the bounded sealed delta afterward. Actual reviewed final bundle, Source/Training identity, CFN/config expiry equality, user-data bytes, cloud/TLS/browser session, cleanup and budget gates remain pending before deployment. This is not authority to deploy or communicate with Claude before10:30 Edmonton.
