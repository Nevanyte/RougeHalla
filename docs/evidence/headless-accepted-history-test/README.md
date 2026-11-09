# Headless accepted-history test repair

Base: `e2baadae03dd25cf74979bdfeb3bf35fd696393d`.
Test-only source: `064df639b8bdfbebb0acead032decf0d6eae516d`.

Root's frozen workspace found the old `a_decision_is_a_pure_function_of_the_delivered_observation` test failing its meaningful `any > 0` assertion. That test called the obsolete raw `HumanBot.decide(&Observation)` path. Since the admitted accepted-frame bridge, HumanBot deliberately makes both raw Vec callbacks no-ops and refuses typed NativeCompatibility input. Restoring raw observation access would violate the current boundary. The former single-observation purity claim was also too strong for this stateful policy.

## Scope and actual public boundary

Only `crates/rh-headless/tests/bots.rs` changes executable code. The repaired selector is `identical_accepted_delivered_histories_produce_identical_commands`; the other two existing test bodies remain byte-identical and this integration file still contains three tests.

DeliverySession itself is intentionally crate-private. The integration test uses the existing public `Seat::new`, `Seat::bind_fx` and `drive_seats_queued` APIs. The test-only comparing Policy wrapper forwards the real HumanBot spec/requirements/checks, resets both independently constructed same-tier/persona bots with the same MatchStart, and receives the **same actual AcceptedFrame14** from the ordinary seat producer. That producer builds the real observer offer, checked/quantized snapshot decoded representation, State/Event/FX encoding and decoding, preflight and committed DeliverySession envelope. The wrapper constructs no Frame14/AcceptedFrame14, uses no cfg(test) component helper, and does not widen any API.

On every actual typed invocation, bot A appends its own commands directly to the seat output; bot B independently computes its own vector from the same borrowed accepted receipt. Their complete command sequences must match. Neither bot reads the sim directly, copies the other bot's output, receives a fabricated frame or bypasses the production accepted receipt/preflight path. Only the test runner's real DeliverySession producer observes the sim for this positive history.

The original real Sim construction, two placements, world seed3, policy seed11 and200-step window are retained. A separate negative probe uses an ordinary public Observation only to assert: input kind Delivered14, both legacy Vec callbacks remain empty, immutable raw preview refuses RequiresDelivered14, and typed raw dispatch refuses RequiresDelivered14 without appending a proposal. That raw probe does not supply either positive bot's accepted history or expected commands.

## Assertions retained and strengthened

- Two independently reset bots receive the same full accepted frame/history sequence and compute equal commands at every invocation.
- More than one actual seat decision, **nonzero ordinary queued proposals** (`any > 0`), proposal-count agreement, no delivery/decision fault and zero fallback decisions are required. The unused raw-wrapper callback panics; the fault assertion prevents a swallowed callback failure from passing.
- The queued runner hands proposals to the test count callback and deliberately does not submit them: this is a deterministic proposal-history control, not a new claim of combat outcomes or accepted commands. The separate existing `human_bots_play_deterministically_on_the_policy_seats` test retains its full recorded replay/hit/validate+submit integration checks unchanged.

## Validation and pending executable gate

Performed only standalone pinned `rustfmt --edition 2021` and `rustfmt --edition 2021 --check` on this one test file, `git diff --check`, source review of actual public producer/receiver APIs, sealed-Git SHA256 checks and static unchanged-body/scope checks. No cargo build, test, workspace campaign, Editor, source capture or cloud operation was run. Root's shared/exclusive build target was not touched. This packet is authored and syntax/formatted only; it is **not compiled or test-passed evidence**.

Root's proposed focused command (not executed here):

```sh
cargo test -p rh-headless --all-features --test bots identical_accepted_delivered_histories_produce_identical_commands -- --exact --nocapture --test-threads=1
```

No production API/behavior/RNG/policy/server/sim/header/content/tape/status/Cargo.lock or source fixture changed. Root owns executable validation, composition and admission. No full bot-brain, delivery transport-performance or mathematical single-observation purity claim follows.

## Sealed source and protected files

Test file SHA256 at code commit and worktree: `b4c5d7dd5fca9fd95cf5bdb9c83221cf6649be380213af036246cca23dfa4c51`.
The following source/lock files are byte-identical to the exact base and code commit:

- `crates/rh-policy/src/lib.rs`: `452cabdba98394a751a69b2760d2c67bf5cbca72f00de7cb7b19485a6ce93dfa`.
- `crates/rh-policy/src/delivery/session.rs`: `0fdb84eed7bbddc16d3309efe28c68afd57a23eced4f013264fcc0a16a866f2b`.
- `crates/rh-policy/src/delivery/frame.rs`: `67b6fbf8199a72555487ff7a8675747e6111ba3e4f7c344fb9e42d9c3d7045af`.
- `crates/rh-policy/src/bots/bot.rs`: `8b4f0a8304bd2b10b4c929ec526e372805e6d6b6ea40d3effe0dfc4e8688872d`.
- `crates/rh-policy/src/bots/random.rs`: `d369b36155e7935c7b80763453ca5db3b1323a83b2239ffa0a20c61fa5d99a52`.
- `crates/rh-headless/Cargo.toml`: `1a8c5d1165f167f80931e68c4ab13c3137b047c592af69d6fccb762b47888e09`.
- `Cargo.lock`: `b14507716b80f1c0b85f7298b380b3c9146917134d9361c1bb408062782c0b22`.
