# Browser proof protocol reconciliation

CI [42521426323](https://github.com/Nevanyte/RougeHalla/actions/runs/42521426323), exact head
`df0d7bb82bd681747d94a985df6cf5083a8e577f`, passed the full simulation and C# jobs. The Rust job passed both strict
workspace Clippy modes, default and PostgreSQL tests, placement recovery, parity, headless and every source gate before
its last browser step. That step failed because its driver still required protocol11 while the checked page and server
correctly spoke13. The separate card-runtime job failed on stale provenance and has a separate repair.

`tools/browser-proof/proof.mjs` now reads the checked page's protocol constant and matching golden vectors before
starting resources. It requires `/info` to agree with that exact version and retains every Full/delta/resync assertion.
Its rejection control alters the Welcome's complete little-endian u16 version and then delivers the original valid
current-version Welcome; the rejected connection must stay closed with its prior state intact. Previously that second
frame was also stale11, so it did not test a subsequent valid13 Welcome.

The focused local Chromium WSS proof passes **15/15** checks, including real join, movement, reconnect, combat/results,
Full/delta resync and wrong-version rejection. `proof.json` is the actual report; `receipt.json` binds its hashes to the
driver, page, vectors and a fresh `cargo build --locked -p rh-server` at native head `df0d7bb8`, whose binary is preserved
outside the mutable target directory. This is a protocol13 first-playable duel check against that recorded build,
not a Unity WebGL campaign, full-port or performance result. The subsequent
exact-head CI run remains a separate gate.
