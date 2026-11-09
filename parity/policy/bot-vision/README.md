# Bot vision: declared inputs only (no actual capture yet)

`declared-inputs.json` is `JSON.stringify(encode(cases()))` from
`tools/bot-vision-fixtures/scenario.mjs` in the order-preserving `rh-vision-value/1` codec
(`tools/bot-vision-fixtures/codec.mjs`). It holds 12 declared `BotVision` method cases / 104 steps
and **no outputs**. It is regenerated only with
`node tools/bot-vision-fixtures/prepare.mjs --repo <abs> --declared-out <abs new file>`.

`source.json` does not exist. It will be the Root-admitted copy of the first actual unmodified
source capture (`raw-observations.json`, format `rh-bot-vision-source/1`) after Root reviews the
literal command in `docs/evidence/bot-vision/CAPTURE-REQUEST.md`. Until then the native parity test
`temporal_percept::vision::source_tests::actual_source_parity` is ignored and nothing here is parity
evidence. `declared_inputs_are_consumable` only proves the Rust adapter reads every declared input.
