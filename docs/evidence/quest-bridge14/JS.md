# Quest bridge protocol 14: embedded JS check

Run from the repository root:

```sh
node --check tools/protocol-js/check-vectors.mjs && node tools/protocol-js/check-vectors.mjs
```

Result on 2026-11-08: **PASS** — the embedded browser decoder agrees with `protocol/fixtures/v14.json`: 49 server vectors, 167 malformed server controls, 13 chains, and 19,061 checks. This includes QuestAccept command encoding/decoding, available/empty/unavailable Quest views, ten State keys, QuestItem decoding, malformed Quest IDs/bounds/references, and stateful retained-plus-replacement Quest/prop reference checks. The stateful cross-frame cases are synthetic checker controls; cross-language wire vectors are Rust-generated.

`git diff --check -- crates/rh-server/web/probe.html tools/protocol-js/check-vectors.mjs` also passed.

SHA-256 identities:

- `crates/rh-server/web/probe.html`: `141629b19509b140ea37860eeb9612de5c4a1d5f6394c3c1cfa979c215351ec3`
- `tools/protocol-js/check-vectors.mjs`: `558a8e74eb753c89b8ad6348e1f25e38cd8433433666b6961a5c1836a6fa8d3d`
- `protocol/fixtures/v14.json`: `ff0f474c496e8928ff62a3a4043f7ea0c2bad6f3bde0070c0767fcce66c9b2f6`
