# Bot reset stream independent review

**RELEASE — bounded live reset wiring repair.** Reviewed sealed `d905a95903613ce084822d9bc84aa28e4932f73a`, code `6a2d8418a7a745db76af17a5b0ef7753046dce73`, evidence `deb380ca4f70d2ab902db2b2e418f67c90feb9d6` + `d905a959`, exact base `95bd9c1efcde9b71cb07f23f24aef8ff4fb17013`. Worktree `/Users/nevinmckinnon/.codex/worktrees/deepseek-rust-completion/p-bot-reset-streams` remained clean and unchanged. No blocker found.

## Code and source contract

`crates/rh-policy/src/bots/bot.rs:346–379` now initializes three independently owned Rng values with `derive(m.seed as u32,0/1/2)` in decision/motor/lapse order. This matches actual `packages/server/src/bots/brain/brain.ts:141–147` and the immutable fixture's retained wiring lines. Knowledge still constructs its own temporary tag3 Rng and consumes none of the other streams. The rest of reset's map/presentation-independent memory/brain/humanizer/planning initialization remains unchanged; no new draw calls or shared RNG handle were added.

The removed `decide_seed` XOR/multiply helper is the incorrect superseded wiring, not a random algorithm change. Existing Knowledge regression retains its actual tag3 equality, explicit wrong-tag0 inequality and first-decision-draw assertion, now using the lawful decision stream. No behavioral regression was removed without replacement.

Source derive uses `seed | 0`, Math.imul and unsigned shifts. The approved native low32 seed convention is explicit: all four source streams take the low32 bits of MatchStart.seed. This corrects the old lapse high-half input and does not claim arbitrary u64 JavaScript-number parity, source manager seed derivation or full per-seat configuration parity.

## Meaningful tests and sealed scope

The four new focused tests call the real `HumanBot::reset` through the existing Policy implementation. Expected initial seeds are read from the unchanged source vector artifact, not rebuilt with the repaired reset expression. They cover all16 seed/tag vectors (four seeds0/1/7/42 × tags0–3), exact initial RNG state and five sequential draws for each live tag0/1/2 stream, independent Knowledge3 and no reset draw consumption, deterministic separate bot instances, explicit seed0 versus2^32 low32 normalization and reset-after-use. The latter separate instances use the same PlayerId in their fixture; no wider actor-identity or different-manager-seed claim is inferred. Expected subsequent draws use the unchanged, previously source-proved native Rng. Existing source Knowledge tests still compare captured first draws/fingerprints and wrong-tag fingerprints.

Independently verified the exact eight-file base-to-head diff: only bot.rs, the new cfg(test) child, README and five tracked logs. Both code files at final HEAD equal the sealed code commit. All eight documented SHA256 values match the sealed Git blobs and current files. Source vector SHA256 remains `a97293e2ec3e8a9e5e0dcac985c4b80b84f21caa447390931c00ad39ba40266b`, byte-identical to base; independently confirmed the complete16 unique seed/tag pairs, u32 result range and every actual source wiring line. Random/derive/Knowledge, humanizer, Frame14/delivery/intake, fixtures, protocol/server/client, identities/content/tapes/status and Cargo.lock are absent from the diff.

Code SHA256s:

- bot.rs: `8b4f0a8304bd2b10b4c929ec526e372805e6d6b6ea40d3effe0dfc4e8688872d`.
- reset_stream_tests.rs: `befeddcc23b2160200abc4fd182f68fb2b666250b24d393b44388d3a564d0136`.

## Retained receipts and limits

All five portable logs are tracked and their hashes match the coordination handoff. The red receipt explicitly identifies the preliminary source-wiring control on unchanged production: seed0/tag0 old state458671337 versus immutable source520022130. Independently corroborated those two values from the base formula and source vector. Its note honestly excludes other preliminary fixture-range assertion failures from semantic mismatch claims. Focused green records4/4; policy-all records140 passed plus one doc test and names the retained real sync/async and Frame14 controls; scoped strict all-target/all-feature policy Clippy and fmt record exit0. These are authored portable command/result receipts, including summarized policy/lint results, not a new independent execution or complete raw policy test listing. No additional semantic-mutant campaign is claimed.

Read-only review only: no cargo/build/test/capture/Docker/Editor/browser/cloud operation was run and no candidate/root/main/shared file changed. This outside-Git report is the sole write. The fix changes intended bot random behavior by replacing the known wrong live wiring; it does not certify full brain/fight/strategy quality or close other bot remainders. Root owns composition, merges and final admission.
