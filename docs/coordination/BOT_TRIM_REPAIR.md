# Bot config trim repair

One bounded follow-up to BOT_FILL_REPAIR. Use a NEW isolated branch from ce246222d974f137e094eb266ff67ab503fcf6d8. Preserve active work. No root merge/push, schema/observation/protocol/shared-status/Cargo.lock or learning-storage architecture changes.

The independent reviewer found that Rust char::is_whitespace includes U+0085 NEL, while the actual legacy JavaScript trim does not. Hence BOTS_FILL_TO='\u0085' incorrectly becomes zero instead of source fallback eight, and BOT_STATS_FILE='\u0085off\u0085' incorrectly disables learning instead of remaining a literal path. This is a real source-parity blocker, not a request to weaken fixture expectations.

Replace the broad Rust Unicode property with exact source trim membership. Capture the complete trim-codepoint set from the pinned Linux amd64 Node22.23.4 runtime that evaluates the actual unchanged legacy config source. Commit the small membership list, not a million-row corpus. An exhaustive Rust check over all Unicode scalar values against that captured list should catch extra/missing members. Preserve the source's FEFF and line-terminator behavior. Keep input/runtime scope explicit.

Add actual-source NEL controls for raw Number, numeric BOTS fallback, statsFile wrapped-off and relevant mix trimming, plus positive real-whitespace controls. Existing corpus values must remain unchanged; extend additively and reproduce --check byte exactly. Restoring is_whitespace must fail semantically. Run focused tests/format/Clippy; no broad map/full-workspace campaign. Report exact SHA/files/proof and remainder. Do not duplicate the expert lease or change root's explicit default-Off learning mode.
