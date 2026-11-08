# Protocol 14 JavaScript vector check

Inspected candidate base: `cc7790b70fbb617fc42fdf1c1cce23f3e2d35898`.

Command, from the repository root:

```sh
node tools/protocol-js/check-vectors.mjs
```

Result:

```text
JS decoder agrees with protocol/fixtures/v14.json: 45 server vectors, 132 malformed, 13 chains, 18845 checks
```

`node --check tools/protocol-js/check-vectors.mjs`, decoder-block syntax compilation, and `git diff --check -- crates/rh-server/web/probe.html tools/protocol-js/check-vectors.mjs` also passed.

SHA-256 identities for the checked inputs:

| File | SHA-256 |
|---|---|
| `crates/rh-server/web/probe.html` | `4897ea77fe2d22d10a0f6f596bce4ebde5f7b8c47f6fdde54a51096ad2925993` |
| `tools/protocol-js/check-vectors.mjs` | `61f4d0da3ef8f7fa27a34607e3ca682e40e2358c1e3c6d611f63a12a83a16464` |
| `protocol/fixtures/v14.json` | `e22c8eca2ba7f13a21983a14c4ce8b4d00998cff091b1b52561bab1fb53665b4` |
