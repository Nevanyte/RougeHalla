# Exact proposed offline commands (NOT EXECUTED)

No command below has been run. Root must approve the sealed bytes and substitute an approved fresh nonce.
No new wrapper path exists; these are direct reviewed command forms.

BOUNDARY_REPO=/Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings
PRIMARY_TOOL_ROOT=/Users/nevinmckinnon/Documents/Projects/RogueHalla/node_modules
HOST_NODE=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/map-styled-bench/npm-cache/_npx/361c55be1121897e/node_modules/node/bin/node
OFFLINE=$BOUNDARY_REPO/docs/evidence/walk-hint-helper-boundaries/offline-<approved-nonce>
PREP=$OFFLINE/prepared
CAPTURE=$OFFLINE/captured

# The build-only driver imports Node builtins and the exact pinned esbuild main only.
# It does not import/run the scenario or World. It creates PREP exclusively and refuses existing output.
env -i PATH=/usr/bin:/bin ESBUILD_BINARY_PATH="$PRIMARY_TOOL_ROOT/@esbuild/darwin-arm64/bin/esbuild" "$HOST_NODE" "$BOUNDARY_REPO/tools/walk-hint-fixtures/boundaries-build.mjs" --source-root "$BOUNDARY_REPO" --tool-root "$PRIMARY_TOOL_ROOT" --output "$PREP"

# CAPTURE must be an exclusively created, empty, fresh approved directory. No recursive deletion.
# Mounts are exact files from PROPOSED_READSET.json; no repo/node_modules/home/config mount.
# Runtime reads /run/build-manifest.json + /run/scenario.mjs and the exact selected source/corpus files.
docker run --rm --pull=never --network=none --platform linux/amd64 --read-only --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=64 --memory=1g --cpus=1 --mount "type=bind,src=$PREP,dst=/run,readonly" --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/walkHint.ts,dst=/repo/packages/server/src/sim/walkHint.ts,readonly" --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/gameplay.ts,dst=/repo/packages/server/src/sim/gameplay.ts,readonly" --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/step.ts,dst=/repo/packages/server/src/sim/step.ts,readonly" --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/status.ts,dst=/repo/packages/server/src/sim/status.ts,readonly" --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/targeting.ts,dst=/repo/packages/server/src/sim/targeting.ts,readonly" --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/combatant.ts,dst=/repo/packages/server/src/sim/combatant.ts,readonly" --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/movement.ts,dst=/repo/packages/server/src/sim/movement.ts,readonly" --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/world.ts,dst=/repo/packages/server/src/sim/world.ts,readonly" --mount "type=bind,src=$BOUNDARY_REPO/packages/shared/src/constants.ts,dst=/repo/packages/shared/src/constants.ts,readonly" --mount "type=bind,src=$BOUNDARY_REPO/packages/shared/src/mods.ts,dst=/repo/packages/shared/src/mods.ts,readonly" --mount "type=bind,src=$BOUNDARY_REPO/packages/shared/src/weapons.ts,dst=/repo/packages/shared/src/weapons.ts,readonly" --mount "type=bind,src=$BOUNDARY_REPO/packages/shared/src/policies.ts,dst=/repo/packages/shared/src/policies.ts,readonly" --mount "type=bind,src=$BOUNDARY_REPO/packages/shared/src/terrain.ts,dst=/repo/packages/shared/src/terrain.ts,readonly" --mount "type=bind,src=$BOUNDARY_REPO/parity/walk-hint/helpers/source.json,dst=/repo/parity/walk-hint/helpers/source.json,readonly" --mount "type=bind,src=$BOUNDARY_REPO/parity/policy/bot-fight/source.json,dst=/repo/parity/policy/bot-fight/source.json,readonly" --mount "type=bind,src=$CAPTURE,dst=/out" --entrypoint /usr/local/bin/node node@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292 /run/boundaries-runtime.mjs --mode=capture --output=/out

# Read-only bytecheck: identical PREP/image/source mounts; CAPTURE mounted readonly and mode=check.
# It must not compile, create debug data, or write anywhere.

# Controls (NOT IMPLEMENTED/EXECUTED): each mutant must compile through this same build-only driver into its
# own fresh PREP, then follow the same offline runtime envelope in a separate fresh CAPTURE. No npm/tsx/network.
