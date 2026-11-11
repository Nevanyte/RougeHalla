# rh-parity: local rules

The legacy comparison suite and the project's main oracle: `cargo run -p rh-parity --bin parity-report` compares Rust
against the captures in `parity/` and prints mismatches as `tick <t> <id>: <field> <rust> vs legacy <legacy>`. Other
binaries: `status-probes` (feature `trusted-status-probes`), `hitbox-fixtures`, `parity-bench`. Capture rules:
[parity/README.md](../../parity/README.md).

## Invariants

- Captures come from the legacy game through `parity/legacy-capture/capture.ts` and the `tools/<area>-fixtures/capture.sh`
  scripts (exact files need Linux x64 and Node 22.23.4); they are never hand-edited, normalized or refreshed to make a test
  pass.
- Comparisons keep their tolerances and fields. A deviation is compared against the capture filtered through its
  `DEVIATIONS.md` entry, stated in that entry, never against an edited capture.
- Better failure messages (first diverging tick, entity, field) are always welcome.
