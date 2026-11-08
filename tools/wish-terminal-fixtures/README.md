# Wish terminal producer fixtures (P-WISH-TERMINAL-PRODUCERS)

Canonical actual-source witness for the Fizzle and Interrupted Wish terminal producers, plus the native replay target.

## Commands

    bash tools/wish-terminal-fixtures/capture.sh
    bash tools/wish-terminal-fixtures/capture.sh --check
    bash tools/wish-terminal-fixtures/run-mutants.sh
    cargo test -p rh-sim --all-features --test wish_terminal_producers

Docker uses the pinned official node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
on linux/amd64 with the repository mounted read-only and node_modules a writable tmpfs. RH_WISH_TERMINAL_OUTPUT
redirects the output.

## Source corpus

parity/wish-terminal/source.json (format rh-wish-terminal/1) runs the unchanged legacy TS through the existing
actual-source tools/ability-fixtures/engine.mts (real enqueueClientMessage, ordinary 50 ms steps). It keeps per-action
relevant events (cast/castLand/castEnd/status), actual castAccepted/castEnded producer hooks with reason and stock
clocks, pending cast and player stock frames. Pinned profile hashes: official image digest, Node/linux/x64, package-lock
sha256, source closure sha256/inventory, harness sha256/inventory, room/config. Declared inputs: room map, player
factions/positions/loadouts, zero opening lock, actions. Actual: all world/event/stock outputs; source hooks are
server-only producer evidence. No production source change, no expected event installation.

Cases: Freeze and Trial target-removal Fizzle; Freeze-, Swarm- and Trial-pending Interrupted by a real Freeze landing's
Stun. Instant Blaze/LastStand have no pending Fizzle/Interrupted domain and are reported as such.

## Mutation runner

run-mutants.sh temporarily patches production, compiles, runs the actual new target, requires a semantic failure
(test result: FAILED; compile errors are not kills), restores the file byte-for-byte, and then requires the unchanged
target to pass. Mutations: wrong Fizzle reason, refunded Fizzle stock, wrong retained producer clock, and an unlawful
late landing. Expected final line: control passes after four killed lines.
