# Account presentation exports

Run `./tools/account-catalog/export.sh --check` to verify checked-in Resources/Account JSON against actual shared
COSMETICS/ACHIEVEMENTS and Rust cosmetics data. Use `--write` only after reconciling source changes. The wrapper uses the
repository's pinned Node22.23.4 image and npm lockfile dependencies in a disposable tmpfs; no legacy source is changed.
Output has no goal evaluator, roll, eligibility or purchase authority. Server profile/HTTP results alone grant items,
equip, progress and GV. See docs/evidence/account-full-profile/README.md for typed consumption and remaining browser gates.
