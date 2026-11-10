# Strict native response protocol repair

Applied after independent review held hosting candidate `28d21c3f907dc8902705eb6484477321c8113a39`.
The review reproduced Python's loose equality: JSON `14.0` compared equal to expected
integer `14`, and JSON `true` compared equal to expected integer `1`. The original
candidate and its receipts remain unchanged.

`bootstrap.ready` now validates the received `/info.protocol` with `type(value) is int`
and range 1–65535 before comparing it to the configured expected protocol. This
rejects booleans, floating-point values, absent values, and out-of-range values
without coercion. Exact `contentHash` comparison remains unchanged. The same helper
covers both Source port7777 and Training port7779; readiness order is unchanged.

## Checks

Run from `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-morning-host`
at parent `28d21c3f907dc8902705eb6484477321c8113a39`:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s hosting/technical-demo -p test_offline.py -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s hosting/technical-demo -p test_stack.py -v
git diff --check
```

Results: 12 offline tests passed, 7 stack tests passed, and diff check passed.
The mocked readiness test accepts the configured integer on both ports, then
requires refusal and connection closure for stale protocol, stale content hash,
float `14.0`, boolean `true` against expected integer1, out-of-u16 `65536`, and
missing protocol on both ports. No failure occurred in this repair run. Full raw output is preserved
in `test-offline-repair.txt` and `test-stack-repair.txt`.

| File | SHA-256 |
|---|---|
| `hosting/technical-demo/bootstrap.py` | `fd523b904ebfcdf709b7b35d0d1d1debd2041ef69287a2851376d27d659f80a7` |
| `hosting/technical-demo/test_offline.py` | `2ffd5c91c6528dc7e4e8c5356bf6547c74a214ebcd6ddd437cb63cedebf843d0` |

This repairs only the returned protocol-type HOLD. It does not change the
configured identity, lifetime, stack, artifact, or deployment state and is not
cloud or host admission evidence.
