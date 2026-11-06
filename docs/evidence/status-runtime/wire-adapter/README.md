# P-STATUS-1 protocol-5 adapter proposal

Private coordinator proposal against `0306096588ca9d0ca19d91e5181b087abc86ce94` plus the accepted consolidated status implementation. Apply only `adapter.patch` (two files), or its `wire.patch` and `publish-test.patch` components. No live edits were made.

`wire.rs` explicitly omits AbilityHit, CastEnded and StatusApplied in protocol5 alongside SignatureHit/Heal. It preserves existing actor conversion, redacted-source sentinels, event channels and snapshot bytes. Existing ActorView test literals gain neutral effects/displace_seq, and the actor-memo test also changes these core-only fields. The cache comment now accurately describes the protocol5-relevant projection.

The existing mapping test covers all14 status kinds, allfive abilities, both cast-end reasons and redacted/visible by values. A new test uses the actual Publisher: omitted events remain in its native observation but add no wire messages, do not change snapshots, do not suppress an ordinary passive hit or its redacted source, and do not leave stale output on the next publish.

`tests/publish.rs` needs the same explicit omission cases in its independent handwritten reference encoder. Without that small test-only hunk the new SeenEvent enum makes the old reference non-exhaustive. Original assertions are unchanged. The first failed strict lint log is preserved; it is not a gameplay failure or mutation credit.

Validation (private mob-catalog-target, two jobs, debug0, incremental0, offline/locked):

- `cargo test --offline --locked -p rh-server --lib wire::tests -- --test-threads=2`:10 pass.
- `cargo test --offline --locked -p rh-server --test publish -- --test-threads=2`:5 pass.
- `cargo clippy --offline --locked -p rh-server --lib --tests -- -D warnings`:pass.
- `rustfmt --edition 2021 --check crates/rh-server/src/wire.rs crates/rh-server/tests/publish.rs`:pass.

Exact commands/timings/logs and hashes are in the manifest. The private compile setup copies the accepted status bundle and makes only the already documented content/lib build seams; `build-only-core-seams.patch` is excluded from the delivered adapter and must not replace coordinator integration decisions. Current placement/Cargo.lock/mob definitions remain untouched; protocol5 sources, golden vectors and JS probe bytes remain unchanged. No dependencies, field IDs, C#/JS schema changes, broad workspace run or performance claims.

**Required next work:** P-NET-3 must transport full status/effect/displacement/field presentation and the missing effects with explicit Rust/C#/JS schema/version/golden handling. This adapter keeps core integration compatible with protocol5; it does not complete client presentation or replace that follow-up.
