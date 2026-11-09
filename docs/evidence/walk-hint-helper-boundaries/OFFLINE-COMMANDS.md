# Proposed corrected offline operations — NONE EXECUTED

This is code/design only against790b739d5df9917e45b5f54630ef5398d26950ca. Root must seal/review the correction, substitute a literal approved full code SHA, and separately approve each phase. Never substitute moving HEAD as approval. Never run original helper-capture.sh or preserved boundaries-capture.mts. No npm/npx/install/pull/network, no source execution on host, no/tmp compiled source, no broad repo/home/config/node_modules mount.

## Phase A: separately approved host compilation ONLY

Proposed fresh path (not created by this patch):
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings/docs/evidence/walk-hint-helper-boundaries/offline-790-corrected-review-01/`

The driver exclusively creates this one offline parent, prepared and captured, with nonsymlink ancestor checks. Existing parents refuse; no shell mkdir/reuse/delete is needed or permitted. It imports the pinned compiler only, never scenario/World; it verifies all compiled bytes against the exact approved Git object and unchanged70433 application source. Its sole source adapter appends an export of existing SPEED_SLACK in memory. Retain command stdout/stderr and exact exit code as evidence, including any first setup failure. No automatic retry.

```sh
BOUNDARY_REPO=/Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings
PRIMARY_TOOL_ROOT=/Users/nevinmckinnon/Documents/Projects/RogueHalla/node_modules
HOST_NODE=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/map-styled-bench/npm-cache/_npx/361c55be1121897e/node_modules/node/bin/node
APPROVED_HEAD='ROOT_MUST_SUPPLY_FULL_40_HEX_CODE_SHA'
OFFLINE="$BOUNDARY_REPO/docs/evidence/walk-hint-helper-boundaries/offline-790-corrected-review-01"
PREP="$OFFLINE/prepared"
CAPTURE="$OFFLINE/captured"
env -i PATH=/usr/bin:/bin ESBUILD_BINARY_PATH="$PRIMARY_TOOL_ROOT/@esbuild/darwin-arm64/bin/esbuild" \
  "$HOST_NODE" "$BOUNDARY_REPO/tools/walk-hint-fixtures/boundaries-build.mjs" \
  --source-root "$BOUNDARY_REPO" --tool-root "$PRIMARY_TOOL_ROOT" \
  --output "$PREP" --expected-head "$APPROVED_HEAD"
```

STOP after Phase A. Root inspects generated complete loaded-input/metafile/config/instrumentation pins, bundle bytes/hash, and confirms only allowed builtin externals. No compile success or safety envelope establishes source case success. Primary tool version/hash checks, actual expected HEAD checks and generated provenance must pass; setup/compiler errors remain errors.

## Phase B: ONE separately approved offline source capture

After that review, Root supplies literal APPROVED_MANIFEST and APPROVED_BUNDLE SHA256 strings matching the freshly generated files. The same shell variables above must name the exact already-reviewed run. Do not derive approval hashes automatically from whatever files happen to exist. Exact proposed command:

```sh
APPROVED_MANIFEST='ROOT_MUST_SUPPLY_APPROVED_64_HEX_MANIFEST_SHA'
APPROVED_BUNDLE='ROOT_MUST_SUPPLY_APPROVED_64_HEX_BUNDLE_SHA'
docker run --rm --pull=never --network=none --platform linux/amd64 \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges:true --pids-limit=64 --memory=1g --cpus=1 \
  --env NODE_OPTIONS= --env NODE_PATH= --env NODE_COMPILE_CACHE= \
  --mount "type=bind,src=$PREP,dst=/run,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/walkHint.ts,dst=/repo/packages/server/src/sim/walkHint.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/gameplay.ts,dst=/repo/packages/server/src/sim/gameplay.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/step.ts,dst=/repo/packages/server/src/sim/step.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/status.ts,dst=/repo/packages/server/src/sim/status.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/targeting.ts,dst=/repo/packages/server/src/sim/targeting.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/combatant.ts,dst=/repo/packages/server/src/sim/combatant.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/movement.ts,dst=/repo/packages/server/src/sim/movement.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/world.ts,dst=/repo/packages/server/src/sim/world.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/vision.ts,dst=/repo/packages/server/src/sim/vision.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/server/src/sim/weapons.ts,dst=/repo/packages/server/src/sim/weapons.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/shared/src/constants.ts,dst=/repo/packages/shared/src/constants.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/shared/src/mods.ts,dst=/repo/packages/shared/src/mods.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/shared/src/weapons.ts,dst=/repo/packages/shared/src/weapons.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/shared/src/policies.ts,dst=/repo/packages/shared/src/policies.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/shared/src/terrain.ts,dst=/repo/packages/shared/src/terrain.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/packages/shared/src/interp.ts,dst=/repo/packages/shared/src/interp.ts,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/parity/walk-hint/helpers/source.json,dst=/repo/parity/walk-hint/helpers/source.json,readonly" \
  --mount "type=bind,src=$BOUNDARY_REPO/parity/policy/bot-fight/source.json,dst=/repo/parity/policy/bot-fight/source.json,readonly" \
  --mount "type=bind,src=$CAPTURE,dst=/out" \
  --entrypoint /usr/local/bin/node \
  node@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292 \
  /run/boundaries-runtime.mjs --mode=capture --output=/out \
  --expected-manifest "$APPROVED_MANIFEST" --expected-bundle "$APPROVED_BUNDLE"
```

The runtime checks actual Node22.23.4/linux/x64 and expected hashes BEFORE scenario import. Capture requires empty/out BEFORE import; it retains observations-before-verification.json even when real source outputs/refusal fail the verifier. source.json is exclusively published only after finite/unique/no-error and semantic checks. Any surprise remains a retained finding; no fabricated output/favourable-input search.

Read-only check requires separate Root authorization: identical image, preparation and18 exact source/data mounts, identical approved hash arguments; change mode=capture→mode=check and captured mount to readonly. It writes nothing. No old/canonical corpus mount is writable. Operational1GiB/1CPU limits are bounds, not tested sufficiency/performance claims.

Source-only controls and a fresh frozen-export recheck remain UNIMPLEMENTED/UNRUN and require their own finite reviewed build-only adaptation; the original tsx/npm/tmp controls wrapper remains forbidden. They are not granted execution by this code patch. No native/source boundary admission follows from either compilation or the first capture alone.
