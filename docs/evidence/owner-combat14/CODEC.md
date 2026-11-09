# Owner-combat codec leaf

Base: frozen `3c2efb7b35e2772bbbaa779185a4000ae82cd73e`. This is the pure codec/client leaf of the owner-combat protocol14 union. The separately sealed native bridge and final server adapter are composed afterward. The server Snapshot constructor's optional group remains unavailable in this leaf; it is not a native delivery claim.

Layout and semantics are in [WIRE.md](WIRE.md). The full group uses reserved Full20/Delta24 and current reconstructed actor references. Unavailable, Clear, Held without identity and Held with a current identity are preserved. Malformed retained updates refuse before held state changes. The explicit redundant-clear owner-loss vector is accepted; ordinary encoder owner loss omits the redundant clear. Numeric admission preserves exact binary64 integral values at least50, including the largest finite value, and source-normalized u32 clocks.

The ConnEncoder compares current public NPC-reference sequences against its actual encoded baseline. An available group is replaced on any such sequence change. The fast writer and reference encoder share the same footer format. Raw Full scratch behavior remains unchanged. C# stores a separate held group and copies into immutable owned values; its pooled retained-group path remains allocation-free after warmup. Compact source-time presence/value storage preserves the nullable public property and the existing plain-Snapshot allocation budget. No allocation assertion was loosened.

All three codecs use fixture SHA-256 `6412fc8086b15fa6090f3aa1b939bd45b3d29f9ebf08a757f79cc159363d7534`.

| Gate | Result | Receipt |
| --- | --- | --- |
| Rust1.97 `cargo test --locked -p rh-protocol` |108 passed across19 suites|[package tests](logs/codec-rust-package-tests.txt)|
| Protocol all-target strict Clippy and formatting |passed|[Clippy](logs/codec-rust-clippy.txt), [formatting](logs/codec-rust-fmt-check.txt)|
| Focused Rust Delta/giver/owner/vector/Wish-barrier |42 passed; overlaps full package|[focused tests](logs/codec-rust-focused-tests.txt)|
| Pinned .NET full suite |703 passed|[full C#](logs/csharp-full.txt)|
| C# owner-combat/session/vector subsets |7/83/378 passed; overlap full suite|[owner](logs/csharp-owner-combat-focused.txt), [session](logs/csharp-session-owner-focused.txt), [vectors](logs/csharp-protocol-vectors.txt)|
| Four canonical/Unity mirror pairs |byte-identical|[mirror hashes](logs/unity-mirror-check.txt)|
| Embedded JS, Node25.8.1 |57 valid,183 malformed,23 chains;20,400 checks|[JS](logs/js-owner-combat-v14.txt)|

The first C# full run's allocation failure is retained separately in [the failed-run log](logs/csharp-full-first-run-allocation-regression.txt); the final full run above passes after the storage repair. Malformed-vector checks assert intended rejection reasons, so unrelated trailing data cannot substitute for invalid-lock validation.

This leaf does not activate UI behavior, policy delivery, hosted quests, trade or training. No Editor/browser/source-capture/cloud campaign, provenance refresh, content/tape/status/lock edit or main merge is included.
