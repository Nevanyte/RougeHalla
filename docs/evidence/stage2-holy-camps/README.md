# Holy engagement and initial camp foundations

Branch: `optimization_port`. These are bounded Rust slices. Other faction effects, ordinary-heal world producers,
live Heal transport, full generation/certification and release gates remain open. Unity has no gameplay implementation.

## Engagement and Holy

`SimConfig.holy_foundation` defaults false and explicitly selects the partial capture plan. Only implemented faction
rows run; the unimplemented afterWeapons row remains pending. Private engagement targets, contact/reach/forget clocks
and pre-ledger HP fraction are separate from wand locks and never enter public observations.

The ledger retains ordered actual damage after barrier apportionment. Holy heals from that credited damage, including
source player-overkill semantics, after damage and only while still standing. It reads HP/maxHP before the ledger,
excluding barriers; hit FX keep their original pre-barrier amounts. Physical block contacts originate at actual melee/
projectile producers. Caller-owned output events never become gameplay input. Ordinary heal lockout/clamping uses the
actual source helper without inventing a command or an unported terrain producer.

Fourteen new genuine captures plus the unchanged original full `signature_holy` cover 1,614 ticks, each with checkpoint
continuation. The report has 57 compared scenarios, 13 capture-only and 300 path queries. Exact Linux x64 Node 22.23.4
recapture matches all 72 scenario/map files after revision-only normalization. The original Holy trace's old config,
inputs, events, states and results are unchanged; added diagnostics and the explicit Rust-slice identity are labelled.
Changing Holy's base coefficient from 0.07 to 0.08 fails at tick 3, without changing tolerances.

Independent review matched another 3,120 ticks/4,082 events (851 heals, 230 blocks), all six weapon choices, mixed HP,
barriers, swaps and stacked movement/combat commands. Every tick restored with identical continuation. Output-buffer
Block/Heal injection and all-seat sampling were hash-neutral; restored landed scratch starts empty. Malformed state
and landed-amount mutations were detected. Owner/hidden-recipient Heal projection and headless private replay passed.
Across 695 captured steady steps and 67 crowded steps with 64 real heals, all 762 warmed steps allocated zero.

### Reachable overfull HP

Review/self-audit found that the existing trusted placement constructor permits finite HP above maxHP, as does the
source scenario setup. A new [0,1] fraction restriction would incorrectly refuse those authentic checkpoints. The final
validator requires finite raw fraction and valid clocks. Twelve additional actual-source overfull-HP cases matched
1,200 ticks/1,410 events and exact restores; 1,842 actor-ticks with negative raw leech emitted no Heal. The no-card
nonpositive-heal guard matches the source's zero own-share behavior. The updated invalid-state sweep replaces the
unsupported fraction-range assumptions with genuinely invalid types/values; 96 rejections and 12 landed mutations pass.

## Initial camps and territories (M2b)

The pure leaf ports actual camp placement, initial territory assignment and reach calculations after M2a partitioning
on the same RNG stream. Internal camp order/zone IDs, elite flags and empty spots remain exact. It does not populate
camp spots, repair post-styler territory, perform canonical faction/record renumbering or claim complete generator pins.

The pinned oracle has ten full cases and a 128-stream scan: 116 successes, 12 terminal camp failures and no retrying
successes. All fields, territory/reach arrays (masked and unmasked), consumed words and continuation words match.
Shared clearing radius comes from the parent zone definition; thirteen camp-only fields drive runtime and an
allocation-free content visitor. Custom contexts rebuild their derived geometry.

Independent review verified 144 additional full-array/transcript cases, including tie-heavy inputs, rule variants and
valid direct radius 0/4.5 camp calls. Six applicable tests and Clippy passed on the frozen leaf. Relaxing nearest-site ties
and reassigning territories after accepted final pole movement both failed. Final pinned recapture was byte-identical.
No source behavior or pins were changed.

## Integration

Checkpoint /9, replay /7, observation 7 and policy contract 4; wire remains 5. Protocol 5 explicitly omits Heal until
real encoding/presentation support is implemented. Current integrated content identity is `038ee74f114d47bf`.

```
cargo test --workspace --all-features
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p rh-parity --bin parity-report
node --import tsx tools/map-fixtures/zones-camps.ts --check
```

Reference verification requires pinned Linux x64 Node 22.23.4 and locked npm dependencies. Final native/CI results are
recorded in MIGRATION.md. A lease-proof teardown race was isolated with a test-only 100 ms linger; production stays
five seconds. Five focused PG runs and three runs forcing a final-leave tick interleaving passed all original assertions.

The final integrated native gate passed **505 tests, zero failures/filters and one intentional ignored heap measurement**.
Formatting and all/default-feature workspace Clippy passed. The complete 72-file pinned recapture and all four map
oracle checks passed. Full-game and cloud/browser release gates remain open.
