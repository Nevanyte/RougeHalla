# Private quest bridge receipt

Base: `6db02195abab67d9867f6340cc61a8dc7d4f6114`; isolated branch `codex/quest-bridge14`.

This packet transports the existing native observer facts through private protocol14: State replacement10, QuestAccept input17, and QuestItem prop7. Rust, canonical C#, Unity mirrors and embedded JS share the layout in [WIRE.md](WIRE.md). The server projects only `Observation.quests` and admitted props; it reads no world quest/container IDs for publication. Quest acceptance and pickup continue through the seat observer, validation and ordinary Sim submission.

Unavailable/disabled, available empty and omitted replacements remain distinct. Quest/roster IDs are separate nonzero-u32 namespaces with display-only labels; duplicate and empty labels remain allowed. The owner completion boolean is preserved independently of the optional completion label. Structural/domain limits refuse unsupported restored or synthetic views without truncation or restore changes. C#/JS validate retained plus replaced collections before any state/tick/seen-mask commit.

Resync uses the coordinator-leased `ItemObserver::renewed(&self)` seam. Four counters-only constructors preserve the viewer and every monotonic namespace counter, including exhausted values, while starting an empty replacement epoch. They leave the original observer untouched. The room captures the atomic resync-request flag once, applies the existing throttle, stages the replacement locally, and installs it only after the complete encoded batch is accepted. Failed encode, capacity or closed enqueue retains the live epoch and collection baselines. Reconnect keeps its existing immediate revocation behavior. A refused event/fx frame now prevents the same tick from publishing new authority or baselines.

Focused server/native checks passed:

```sh
cargo test -p rh-server --lib quest_bridge --no-default-features
cargo test -p rh-server --lib wire_state::tests --no-default-features
cargo test -p rh-server --lib --no-default-features wire
cargo test -p rh-sim --lib renewed
```

Results: 4 private bridge tests, 8 collection publisher tests, and 4 native renewal tests passed. The final `wire` filter passed 29 tests (20 wire projections, 8 collection publisher tests, and the domain-bound bridge check); the final `quest_bridge` filter passed 4/4. The bridge tests exercise actual native collect token and fetch parcel movement/Pickup through decoded inputs, current acceptance through Room intake, native hidden/finder-preview/expired refusal, failed initial delivery, failed replacement encode/capacity/closed enqueue, successful resync replacement, and Resume. Private test genesis is explicit; these are component tests, not browser gameplay or hosted quest acceptance.

The native source map comes from the admitted `parity/arena/source.json` fixture; no generator campaign runs. Commands use pinned Rust1.97, a dedicated target, one build job and no incremental compilation. Formatting passed for all three Rust packages; strict all-target server Clippy and native library Clippy passed:

```sh
cargo fmt -p rh-protocol -p rh-server -p rh-sim --check
cargo clippy -p rh-server --all-targets --no-default-features -- -D warnings
cargo clippy -p rh-sim --lib -- -D warnings
```

The final cross-language fixture SHA-256 is `ff0f474c496e8928ff62a3a4043f7ea0c2bad6f3bde0070c0767fcce66c9b2f6`. Rust protocol99, focused C#426 and JS19,061 checks passed against that fixture. Detailed receipts are [RUST.md](RUST.md), [CSHARP.md](CSHARP.md), and [JS.md](JS.md). Final source identities are in [MANIFEST.json](MANIFEST.json).

Full quest hosting remains refused by `profile_supported` at main/director/Room admission. Neutral giver actor support, richer notices and UI adoption remain separately owned. QuestItem props currently represent eligible visible **in-reach pickup cues**, not complete source visual range; accepted navigation objectives are intentionally broader. No renderer/HUD/Bootstrap/game rules, actor representation, content/checkpoint/header/status/lock changes, source provenance pin refresh, browser campaign or cloud action is included. Protocol14 final composition and main admission belong to the coordinator.
