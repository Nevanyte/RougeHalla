# Native Trophy observer correction

Isolated base: `8e3d7268e7026e2a95d201bd8e639a4f65e24e21`.
Observation contract: **19**; policy ABI remains **13**. This changes observable row disclosure/order/offer epochs,
not gameplay state, checkpoint/replay schema, content definitions or the wire. Root owns final admission and derived
identity/tape reconciliation. The server's existing whole-row Kill omission remains closed until the separate wire
packet is complete and explicitly released.

Source anchors: `packages/client/src/ui/chestMath.ts::readReward` and
`packages/server/src/bots/brain/perception.ts::seeChests` omit another owner's Trophy.
`RewardChestObserver` now rejects that row before row-specific visibility/position/options inspection, the adapter
callback, or handle/candidate binding staging. Owner sight/trail rules remain in force. No owner ID is added to public
observations. Existing shared Card/Boost rows remain visible.

`public_cmp` now compares `(variant, catalog ID/key)`, actual Kill gain using `total_cmp`, and the existing public
option flags/taker. This removes the old Card/Boost/Kill numeric-range collisions and includes gain in row equality,
ordering, and offer renewal. Production Kill gains already come from the finite positive native producer; this patch
does not introduce a new gain normalization or change grants.

## Focused verification

Own target: `return-cleanup-2026-11-08/trophy-observer-admission/target`; pinned final-env toolchain, jobs 2/debug 0.

- `cargo test --locked -p rh-sim --lib reward_chests`: **17 passed**, including five new tests.
- `cargo clippy --locked -p rh-sim --all-targets --all-features -- -D warnings`: pass.
- `cargo clippy --locked -p rh-sim --all-targets -- -D warnings`: pass.
- `cargo fmt --all -- --check`: pass.

New tests build a four-seat player-only native world, grant a real card to the low-health victim, submit a validated
ordinary sword attack, and use its actual kill-born Trophy. They never install expected options, gains, kill credit,
pickers or taken outcomes. They verify finite positive produced gains; owner rows; near/far stranger omission before
the adapter; foreign and dropped/uncommitted handles resolving to no chest; successful commit then normal validated
Choose; and actual taken/picker state after stepping. Dropping the prepared guard models rejected publication; this
is not an actual socket/outbox test.

Explicit diagnostics are separate from producer proof: a malformed private coordinate verifies early redaction;
owner reposition/empty vision trail isolates wall LOS and offscreen radius; a fabricated gain-only change verifies
renewal/rebinding; fabricated public rows exercise kind collisions and gain ordering. These are not source captures or
reachable gain-mutation claims. A first attempted ordinary-walk visibility test failed because the existing 30-second
sight memory can retain a Trophy throughout its 30-second lifetime. That assumption was withdrawn, not the native
memory behavior. The original failure log is retained outside the checkout; no fixture was normalized.

Logs and hashes are recorded in `checks.json`; raw logs remain in the isolated checkout's parent directory. No broad
workspace/map/hash tests, source recaptures, server/client tests, Unity or cloud actions were run.

## Composition requirements

The separate birth-availability helper/Choose repair owns the hold boundary; this patch leaves that line untouched.
`crates/rh-server/tests/native_reward_transport_regression.rs` currently asserts Trophy rows for strangers as well as
owner. Root/Phase A must adjust that stale native-observer assertion to owner-only; its wire omission assertions must
remain until the coordinated transport release. No server file was edited here.

Observation-version consumers/recorded observation identities must accept/regenerate for 19 under root control;
policy layout/ABI stays unchanged. No source golden, global hash tape, content identity or protocol version was edited.
