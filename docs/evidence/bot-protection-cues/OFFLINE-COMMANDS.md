# Exact proposed Phase A / Phase B envelopes (UNRUN)

No command here was executed. Root must first review the sealed code and generated Phase A artifacts.
Phase A and Phase B are separate: no automatic Phase A-to-B link, retry, or image pull.

## Phase A — host-only compiler (future Root-approved)

SOURCE=/Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings
TOOLS=/Users/nevinmckinnon/Documents/Projects/RogueHalla/node_modules
HOST_NODE=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/map-styled-bench/npm-cache/_npx/361c55be1121897e/node_modules/node/bin/node
PREP=$SOURCE/docs/evidence/bot-protection-cues/offline-<approved-nonce>/prepared

env -i PATH=/usr/bin:/bin ESBUILD_BINARY_PATH="$TOOLS/@esbuild/darwin-arm64/bin/esbuild" \
  "$HOST_NODE" "$SOURCE/tools/bot-protection-cues-fixtures/build.mjs" \
  --source-root "$SOURCE" --tool-root "$TOOLS" --output "$PREP"

The host compiler imports no scenario/World and writes only PREP. It refuses existing output. Root must
independently review and supply expected PREP/build-manifest.json, scenario.mjs, runtime.mjs and verify.mjs
SHA256 values to Phase B; no automatic linking is allowed.

## Phase B — runtime-only container (future Root-approved)

OUT=$SOURCE/docs/evidence/bot-protection-cues/offline-<approved-nonce>/captured
# OUT is a fresh empty directory created exclusively for this run; never deleted/reused.

docker run --rm --pull=never --network=none --platform linux/amd64 \
  --name rh-p15-protection-cues-<approved-nonce> --read-only --cap-drop=ALL \
  --security-opt=no-new-privileges:true --pids-limit=64 --memory=1g --cpus=1 \
  --env NODE_OPTIONS= --env NODE_PATH= --env NODE_COMPILE_CACHE= \
  --mount "type=bind,src=$PREP,dst=/run,readonly" \
  --mount "type=bind,src=$SOURCE/tools/ability-fixtures/born-input.json,dst=/repo/tools/ability-fixtures/born-input.json,readonly" \
  --mount "type=bind,src=$SOURCE/packages/server/src/sim/arena.ts,dst=/repo/packages/server/src/sim/arena.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/server/src/sim/weapons.ts,dst=/repo/packages/server/src/sim/weapons.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/server/src/sim/targeting.ts,dst=/repo/packages/server/src/sim/targeting.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/server/src/sim/step.ts,dst=/repo/packages/server/src/sim/step.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/server/src/sim/inputs.ts,dst=/repo/packages/server/src/sim/inputs.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/server/src/sim/gameplay.ts,dst=/repo/packages/server/src/sim/gameplay.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/server/src/sim/world.ts,dst=/repo/packages/server/src/sim/world.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/server/src/sim/combatant.ts,dst=/repo/packages/server/src/sim/combatant.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/server/src/bots/brain/perception.ts,dst=/repo/packages/server/src/bots/brain/perception.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/server/src/bots/brain/memory.ts,dst=/repo/packages/server/src/bots/brain/memory.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/server/src/bots/brain/vision.ts,dst=/repo/packages/server/src/bots/brain/vision.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/server/src/bots/brain/frames.ts,dst=/repo/packages/server/src/bots/brain/frames.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/server/src/rooms/FxChannel.ts,dst=/repo/packages/server/src/rooms/FxChannel.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/shared/src/schema.ts,dst=/repo/packages/shared/src/schema.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/shared/src/constants.ts,dst=/repo/packages/shared/src/constants.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/shared/src/interp.ts,dst=/repo/packages/shared/src/interp.ts,readonly" \
  --mount "type=bind,src=$SOURCE/packages/shared/src/mods.ts,dst=/repo/packages/shared/src/mods.ts,readonly" \
  --mount "type=bind,src=$OUT,dst=/out" \
  --entrypoint /usr/local/bin/node \
  node@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292 \
  /run/runtime.mjs --mode=capture --output=/out \
  --expected-manifest-sha256=<Root-reviewed PREP/build-manifest.json sha256> \
  --expected-bundle-sha256=<Root-reviewed PREP/scenario.mjs sha256> \
  --expected-runtime-sha256=<Root-reviewed PREP/runtime.mjs sha256> \
  --expected-verify-sha256=<Root-reviewed PREP/verify.mjs sha256>

Readonly bytecheck (future, separate authorization): same image/mounts/expected pins, captured directory
mounted read-only and --mode=check; no writes. No npm/npx/tsx/install/download/pull/network/child process.
Controls (future): compile each definition through Phase A into its own fresh PREP and run the same Phase B
envelope into its own fresh OUT; root independently supplies every pin.
