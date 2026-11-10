# Morning host preparation receipt

This is a bounded offline preparation in the isolated `codex/morning-host-preparation`
checkout. It changes the guest's maximum original absolute expiry from three to
twelve hours and moves native artifact readiness from hardcoded identities to
the immutable strict config. It does not make or validate a live host, CloudFormation
deployment, TLS renewal, SSM session, external game session, or AWS call. No final
protocol/content identity is chosen here; Root must derive both from the exact
reviewed binary and its `/info` output.

## Change and retained limits

`bootstrap.config` now requires exactly the existing bundle/domain/run fields plus
`protocol` and `content_hash`. Protocol must be a Python integer (booleans excluded)
within the wire `u16` range 1–65535. `content_hash` must be exactly 16 lowercase
hex characters. Both Source and Training `/info` readiness checks, including the
Caddy restart precheck, compare those configured values. `/readyz` storage checks,
readiness order, absolute expiry checks, and two independent expiry mechanisms
remain in place.

The original UTC expiry remains immutable through reboot. The accepted remaining
time is strictly positive and at most 12 hours. The example's `protocol: 0` is an
invalid sentinel, not a launch value. Bundle download/extraction limits (160 MiB,
400 MiB, 10,000 files and 2 MiB manifest), network isolation, rate shaping,
failure-to-poweroff handling, scheduler behavior, and deletion configuration are
unchanged. The historical three-hour guest and its cleanup evidence are not
rewritten.

The conservative 12-hour traffic estimate uses the existing 8mbit interface cap:
43.2 decimal GB plus 512kb per shaper initialization, estimated USD3.888 egress
plus USD0.2784 compute and USD1 other allowance. At the coordinator-provided
planning conversion (1.50 CAD/USD with 25% buffer), this is CAD9.687, rounded to
a CAD10 planning reserve plus CAD9 historical reserve = CAD19 of the CAD20 limit.
This is not a billing cap or a balance/remaining-credit proof.

## Reproduction

Checkout at test time: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-morning-host`
on branch `codex/morning-host-preparation`, base `5e37958a42980306b03f9c2556a57844d7ed5204`.
Commands ran from that checkout root with Python 3 and `PYTHONDONTWRITEBYTECODE=1`:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s hosting/technical-demo -p test_offline.py -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s hosting/technical-demo -p test_stack.py -v
git diff --check
```

Results: **12 offline bootstrap tests passed; 7 stack-structure tests passed; `git diff --check` passed.**
The offline suite includes exact-12-hour acceptance, expired and +1-second-over-limit
refusal, malformed expiry, missing config keys, boolean/zero/over-u16 protocol refusal,
uppercase/short hash refusal, positive readiness for ports 7777 and 7779, and stale
protocol/hash refusal for both ports. Existing tar, route, shaping, diagnostic,
rendering, network-resource-scope and fixed absolute Scheduler checks also pass.
There were no failures in the recorded final run. Raw output is retained in
`test-offline.txt` and `test-stack.txt`.

## Changed source hashes

SHA-256 at this candidate cut:

| File | SHA-256 |
|---|---|
| `hosting/technical-demo/bootstrap.py` | `a45068fdb959b884656fe0e524bd24f84f478c7e5424479ec5fc9e496b876a16` |
| `hosting/technical-demo/config.example.json` | `629ccb1791e9effe27cf5d11ae7dd8d73af5190c4c966060fb815fd7655f7ed2` |
| `hosting/technical-demo/test_offline.py` | `fa665e9a7468e9bdecccd5a1a7d2b5a162f9366a23c0c3486c247b7603823e32` |
| `hosting/technical-demo/stack.yaml` | `7a01e8478bc2ebfe5782c4e2005080034bd98894299e236e499fff59c6d82e4e` |
| `hosting/technical-demo/README.md` | `dfdbbdc37ec96ab4fc0fbdc32916cbccfdfb24073c8cc99a01dfaedd842c5555` |

The source-author checkout was not built or installed, and no AWS, Docker, host,
network, Unity, or browser execution was performed as part of this preparation.
