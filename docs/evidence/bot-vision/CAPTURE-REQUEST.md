# Request for Root review: first actual bot-vision source capture — UNRUN

Nothing below has executed. No TypeScript transform, source import, World, scenario run, control or
install has happened in this lane. Root reviews this literal command, then runs it **once**. The first
run may fail (for example in Node's built-in TypeScript transform under the permission model). Keep its
raw stdout/stderr/exit code, stop, and review the concrete defect before any second run. Do not reuse
or delete a run directory, widen the closure or flags, or chain into controls automatically.

## Pins

| Item | Value |
| --- | --- |
| Base | `cdec00efa6d56661264271ebc3437f7b7f5349c2` (descendant of required `6a251045`) |
| Code commit (tool, scenario, native component) | `2c988ff0d9e710f85dd5a015b5eb83ecb43fa276` |
| Evidence commit | the commit that adds this file; Root supplies it as `$1` after review |
| `prepared/MANIFEST.json` sha256 | `250e6e03e2b0b097c7ef67ddf5a83da0f2e3db497ea5c65b6898660762319654` |
| Source `packages/server/src/bots/brain/vision.ts` | git blob `ca8c3f47dc8263af01a8984dfc04683be3fcdc9d`, sha256 `e4418c5bbd8e9d8e3c21e3b1b9b8f677c947d178f812c9d634934c6c8c92f34c` |
| Source `packages/shared/src` tree | git tree `3986780b9a044f85eed80849a5cf471349845c06` (last change `4e2032de`) |
| Closure | 75 files / 1,063,425 bytes: `vision.ts` + 74 `packages/shared/src` modules from `@raid/shared` (`packages/shared/package.json` `exports["."]`); 249 static edges; no external package; no `packages/server/src/sim` or `rooms` file (no World) |
| Runtime | existing `/opt/node22/bin/node` v22.23.4 linux/x64, amaro 1.1.8, sha256 `2286ce921a47349726b0e8b037ccbb6627043d24d1fc3c8f22c2dc53c4a1f7ff` |
| Map | `crates/rh-sim/src/mapdata/fixtures/seed1.map.json` sha256 `7c95efad61f47942d10921d7f1bc16acb43306f370cf368e0693a69d456441e7`, legacy hash 3499839449 |
| Declared inputs | 12 cases / 104 steps, sha256 `22694f4c9b8bc10a03ac071004164ecaf2a9e923979b1c411a39ecfbaf4407b1` (= `parity/policy/bot-vision/declared-inputs.json`) |

No package is installed or downloaded: there is no `node_modules` anywhere in this checkout, and none is
needed. TypeScript runs through the pinned Node's own `--experimental-transform-types` (amaro, bundled).

## Guards inside `runtime.mjs` (all refuse before any source import)

- exactly three arguments; Root-supplied manifest sha256 must match the exported manifest;
- `process.version`, platform/arch, amaro and the node binary's sha256 match the manifest; `NODE_OPTIONS` unset;
- `process.execArgv` is exactly the reviewed set below; the permission model is active; child processes and workers are denied;
- every closure, tool, scope and map file matches its manifest byte length and sha256; `encode(cases())` matches the declared-input hash;
- the output directory must not exist (`mkdir` 0700, non-recursive); raw and verdict are written with `wx`/0600, raw bounded to 64 MiB;
- module hooks resolve only the reviewed static edges and hash-check every loaded source byte again; the loaded set must equal the manifest closure;
- the raw is written and re-read from disk before `verify.mjs` computes a separate verdict. A throwing source step ends its case.

## Literal command

Run as a script with the reviewed evidence commit SHA as its only argument:

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO=/home/user/rh-bot-vision
CODE_SHA=2c988ff0d9e710f85dd5a015b5eb83ecb43fa276
EVIDENCE_SHA="$1"
MANIFEST_SHA256=250e6e03e2b0b097c7ef67ddf5a83da0f2e3db497ea5c65b6898660762319654
NODE=/opt/node22/bin/node
NODE_SHA256=2286ce921a47349726b0e8b037ccbb6627043d24d1fc3c8f22c2dc53c4a1f7ff
RUN="$(mktemp -d /tmp/rh-bot-vision-capture.XXXXXXXX)"

# 1. Provenance: relative to the code commit, the evidence commit changes only docs/evidence/bot-vision.
test "$(git -C "$REPO" rev-parse --verify "$EVIDENCE_SHA^{commit}")" = "$EVIDENCE_SHA"
git -C "$REPO" merge-base --is-ancestor "$CODE_SHA" "$EVIDENCE_SHA"
test -z "$(git -C "$REPO" diff --name-only "$CODE_SHA" "$EVIDENCE_SHA" -- . ':(exclude)docs/evidence/bot-vision')"
test "$(sha256sum "$NODE" | cut -d' ' -f1)" = "$NODE_SHA256"
test "$("$NODE" --version)" = v22.23.4

# 2. Readonly export of exactly the reviewed paths.
mkdir -m 0700 "$RUN/src" "$RUN/out"
git -C "$REPO" archive --format=tar "$EVIDENCE_SHA" -- \
  packages/server/src/bots/brain/vision.ts packages/server/package.json \
  packages/shared/src packages/shared/package.json \
  tools/bot-vision-fixtures crates/rh-sim/src/mapdata/fixtures/seed1.map.json \
  docs/evidence/bot-vision/prepared/MANIFEST.json | tar -x -C "$RUN/src"
chmod -R a-w "$RUN/src"
test "$(sha256sum "$RUN/src/docs/evidence/bot-vision/prepared/MANIFEST.json" | cut -d' ' -f1)" = "$MANIFEST_SHA256"
(cd "$RUN/src" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$RUN/src-before.sha256"

# 3. The single capture: own network namespace (no network), empty environment, Node permission
#    model (read: export + node binary; write: the fresh out directory), 600 s and 1 GiB heap bounds.
set +e
(cd "$RUN/src" && timeout --kill-after=10s 600s unshare --user --map-root-user --net -- \
  env -i PATH=/usr/bin:/bin HOME="$RUN/out" \
  "$NODE" --experimental-transform-types --disable-warning=ExperimentalWarning --max-old-space-size=1024 \
    --permission --allow-fs-read="$RUN/src" --allow-fs-read="$NODE" --allow-fs-write="$RUN/out" \
    "$RUN/src/tools/bot-vision-fixtures/runtime.mjs" \
    --root "$RUN/src" --manifest-sha256 "$MANIFEST_SHA256" --output "$RUN/out/captured" \
  > "$RUN/stdout.txt" 2> "$RUN/stderr.txt")
echo "$?" > "$RUN/exit-code.txt"
set -e

# 4. Originals unchanged; report without interpreting.
(cd "$RUN/src" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$RUN/src-after.sha256"
cmp "$RUN/src-before.sha256" "$RUN/src-after.sha256"
ls -la "$RUN/out" "$RUN/out/captured" 2>/dev/null || true
cat "$RUN/exit-code.txt" "$RUN/stdout.txt"
echo "run directory: $RUN"
```

The container runs as root, so `chmod a-w` is defense in depth only; the binding write guard is the
Node permission model, and step 4 proves the export is byte-identical after the run.

## After the run (separate Root steps, not authorized here)

1. Keep `$RUN` intact. Record exit code, stdout/stderr, `sha256sum` of `raw-observations.json` and `verdict.json`.
2. Review `raw-observations.json` before reading the verdict. A verdict FAIL keeps the raw; expectations are never edited.
3. If admitted, copy the raw byte-for-byte to `parity/policy/bot-vision/source.json`, pin its byte length in
   `SOURCE_BYTES` (`vision/source_tests.rs`), remove the `#[ignore]` and run
   `cargo test -p rh-policy temporal_percept::vision`. The first discrepancy is reported as `case[step].path: got != want`.
4. Source semantic controls (`CONTROL-MATRIX.md`) need their own variant-preparation lease.
