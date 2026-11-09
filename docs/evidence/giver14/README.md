# Contextual giver14 delivery

Isolated branch `codex/giver14`, base `3a1c8fc443e1ef922c3b72c264a70c8f36fa0cb1`. This is a representation/transport adapter over the reviewed native neutral giver implementation. It does not activate hosted quests or implement an interaction flow.

Only remote actor **kind4** means QuestGiver. It requires packed kit **0xff** (raw faction15/weapon15) and mob type0. The sentinel is contextual: all non4 kinds, including unknown255 with15/15, and Self15/15 retain their existing opaque-code roundtrips. Native projection accepts only actual typed QuestGiver + Neutral + no weapon + no mob type. It preserves the supplied position, facing, vitals, status, bounty, effects, signature, displacement and barrier facts. No faction or weapon definitions, bytes, masks or header bits are added.

Full parsing/building and public tracker application reject inconsistent giver identity. Delta identity fields may be omitted independently; validation occurs after retained and changed fields reconstruct the candidate and before any held actor/tick/self commit. Invalid transitions preserve the baseline. The owned remote C# view alone uses nullable faction/weapon for kind4; raw DTOs and Self remain unchanged.

The five leased render callers adapt those nullable facts. Givers bypass knight/fighter catalog fallbacks, reuse existing neutral visuals, clear/disable the weapon sprite and stale attack phase, and supply no fabricated combat sound context. Already-delivered barrier fields are forwarded. Compact UI geometry, actor/HUD scale, art/imports and MatchClient interactions are unchanged. The separate20% scale and later text-fit leaves remain coordinator-owned.

Focused verification passed:

| Gate | Result |
| --- | --- |
| `cargo test -p rh-protocol` | 102 passed |
| Giver/vector subset | 14 passed |
| `cargo test -p rh-server --lib giver --no-default-features` | 3 passed |
| `cargo test -p rh-server --lib wire::tests --no-default-features` | 23 passed |
| `cargo test -p rh-server --lib quest_bridge --no-default-features` | 4 passed |
| Protocol/server strict all-target Clippy, formatting | passed |
| Focused C# protocol + owned giver tests | 355 passed; four Unity mirror pairs match |
| Embedded JS checker | 51 valid,171 malformed,19 chains;19,623 checks |
| Managed runtime render compile | 63 runtime scripts,0 errors; package-version-limited smoke |
| Pure appearance contracts | 5 passed; no Unity objects created |

The server checks include native giver observation and ordinary NPC alias preparation, drop/retry, committed normal Target resolution and staged renewal. Invalid typed giver/neutral/unarmed combinations refuse before publisher cache work, including spare/fresh paths; valid converter/memo checks preserve nondefault supplied fields. Existing typed `Cue::of` and non-player aliasing already cover the source giver, so **no native simulation file was changed**. These are component proofs, not full hosted quest gameplay or source recapture claims.

All three codecs use fixture SHA-256 `70b4408422d889e64816f6cb7afb9cf642fe755a5a1b60ac59fab5cb80037a9c`. Detailed receipts: [RUST.md](RUST.md), [CSHARP.md](CSHARP.md), [JS.md](JS.md), [RENDER.md](RENDER.md). Source/artifact hashes are in [MANIFEST.json](MANIFEST.json).

Rust gates use the pinned toolchain, one build job, no incremental compilation and dedicated `rougehalla-giver14` target. No Editor/IL2CPP/browser/graphics/pool runtime acceptance, public hosting activation, source recapture, provenance-pin refresh, owner-combat20/24, content/tapes/status/lock, cloud action or main merge is included. Actual project package resolution, Editor build and final union/golden admission remain coordinator-owned.
