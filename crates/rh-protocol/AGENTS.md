# rh-protocol: local rules

The binary wire format: one message per WebSocket binary frame. The version is `PROTOCOL_VERSION` in `src/lib.rs`; rules
are CONTRACTS C-NET and ADRs 0002, 0010, 0011, 0018, 0021, 0024.

## Three decoders, one set of vectors

| Decoder | Where | Checked by |
|---|---|---|
| Rust | this crate | `cargo test -p rh-protocol` (`tests/vectors.rs` fails when encoding and committed vectors differ) |
| C# | `client-unity/RoguehallaNet/Protocol/` (`Codec.cs` holds `ProtocolVersion`) | `dotnet test client-unity/RoguehallaNet.Tests` |
| JS | `crates/rh-server/web/probe.html` | `node tools/protocol-js/check-vectors.mjs`, `check-first-playable.mjs` |

Golden vectors: `protocol/fixtures/v<PROTOCOL_VERSION>.json`, regenerated only by
`cargo run -p rh-protocol --bin protocol-fixtures`. Older `v*.json` files are history.

## Invariants

- Any change to bytes on the wire: bump `PROTOCOL_VERSION` when incompatible, regenerate the vectors, and update the C#
  codec (then `bash client-unity/sync-net.sh`) and the JS decoder **in the same branch**. Run the gate with
  `--regen-fixtures`.
- The codec encodes only what the filtered view contains; visibility filtering happens before encoding (C-OBS). It never
  clamps what a client sees: it refuses.
- Decoders refuse malformed, truncated or inapplicable input (including a delta that does not apply) with an error and a
  rate-limited Resync, never a panic or a repair.
- Field masks are append-only (ADR 0011).

## Routing

Wire changes are cross-language: `implementer-opus`, reviewed by `reviewer-opus`. A refactor that leaves every vector
byte-identical can go to `implementer-sonnet`.
