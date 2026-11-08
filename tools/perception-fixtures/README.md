# Fair-view foundation source witness (P-BOTS-1 remainder)

Canonical actual-source capture for the exported fair-view foundation of `packages/server/src/bots/brain/perception.ts`:
`detectFeatures` (the room/branch feature flags every fair-view consumer gates on), `inView` and `fieldInView` (the client
window tests) and `plainCopy` (the JSON-safe message copy).

The corpus is `parity/policy/bot-perception.json`; the native comparison is
`crates/rh-policy/src/bots/view_parity_tests.rs`. The capture runs in the pinned
`node:22.23.4-bookworm-slim@sha256:aaa4b5ba...` linux/amd64 image (the same immutable image as the other fixture tools):

```sh
bash tools/perception-fixtures/capture.sh            # capture to parity/policy
bash tools/perception-fixtures/capture.sh --check    # compare the checked-in corpus byte for byte
```

`RH_PERCEPTION_OUTPUT` points the capture elsewhere. The recorder asserts Node/platform/arch and hashes the TypeScript
dependency closure.

## What the corpus witnesses

- 19 declared feature probes through the real `detectFeatures`: the bare room, the full room, each message-type gate
  (cast/plan/choose), each schema field by presence (wishReadyAt/effects/build/qReadyAt/eReadyAt), the fields and camps
  state keys, the default message set, the first-player fallback when no player instance is handed in, and the map hazard
  branches (terrain tile ranges and an explicit hazards layer).
- 81 `inView` rows (three window centres x boundary/aligned/outside points x three pads) and 63 `fieldInView` rows
  (discs and trails, reversed segment ends, radii, pads, inside/outside).
- 13 `plainCopy` values: scalars, nested arrays/objects, and the depth limit (6/8/9-deep nesting, including a deep branch
  inside a shallow object).

Recapture only with the pinned container: the corpus is immutable expected output, never regenerated from Rust.
