# Historical documentation context for unchanged NPC witnesses — PREPARATION ONLY

No wrapper, test, container, package installation or Source capture has been executed for this packet. No CI workflow is modified. Root must freeze/review these files and authorize ONE continuity check and ONE runner check separately. Actual CI repair remains pending those whole-byte results.

## What the context means

The old actual NPC continuity and runner producers include a hash of `docs/CONTRACTS.md` in their captured profile. Their original historical documentation input is frozen verbatim at `tools/npc-witness-context/CONTRACTS.197926e2.md`, from Git commit `197926e27747545934fb801e3df61ae7070905a2`. It is 87,296 bytes, SHA256 `2c9e0b9b562752ec907fe8ffa0e67986e6f6005a11c744f657fd67863de6e7cd`.

This is a declared HISTORICAL METADATA context, never current normative policy. Current `docs/CONTRACTS.md` remains authoritative and untouched; the wrapper separately requires its reviewed 88,542-byte SHA256 `456652ccc0b8441f39464513fdf31843b9882e0bcece44958e7d620a987d359a`. Any further doc change refuses before a container starts and needs new review. Neither producer uses this document as World/gameplay input. No gameplay or captured metadata is normalized or rewritten.

Root's retained current-doc reproduction 03 (not executed by this author) wrote actual continuity bytes once: 13,952,630 bytes, SHA256 `61edae278ce5538a0a265dbaeede62d67129e3ad6cf00cda02b4ca3aea36a9ad`. Root's exact comparison identifies ONLY `/profile/contractInputs/docs~1CONTRACTS.md`; all remaining serialized bytes match. The original oracle is SHA256 `15c3dbc1f5d718859413e8dbb9891602dd49870f10dae4f12dc3152e2c57de96`. Attempts 01 and 02 failed before Source during npm setup; their raw receipts stay retained. This packet does not relabel those failures or claim a new successful capture.

## Fixed, additive scope

`context.json` binds the historical and current docs independently, original 333-source inventory, nine configuration inputs, six continuity tools, five runner tools, runner's eight support inputs, unchanged REQUIREMENTS, and both complete original oracle files. Source, tool and nested support inventories are checked as well as every byte/hash pin. Root-supplied expected wrapper Git HEAD and exact sealed new wrapper files are checked before execution. All old tools, fixtures and expected outputs remain unchanged; the new snapshot/manifest live outside their recursive pin scopes.

The wrapper invokes the original `capture.mts --write /out/actual.json` ONCE. It never calls old `capture.sh` (which would run Source twice), never calls outer `--check`, and never reruns Source merely to compare. On success it compares the fresh retained actual file to the unchanged original oracle byte-for-byte. A byte mismatch remains an error with raw retained. The runner's ORIGINAL nested continuity regeneration and whole-byte assertion still execute unchanged beneath the historical overlay. That original nested producer removes its temporary raw in its existing finally block: if its inner assertion fails, the wrapper retains stdout/stderr/error but cannot promise to retain a nested raw that the old code already removed. It does not change that old code.

## Proposed future execution envelope, not permission to run

After Root seals/reviews the exact driver commit, an explicit invocation has this shape (all angle-bracket values must be replaced with reviewed literal paths/SHA; do not execute this template):

```
python3 <REPO>/tools/npc-witness-context/run.py continuity \
  --repo <REPO> --output <FRESH-EXTERNAL-CONTINUITY-OUTPUT> \
  --expected-code-sha <ROOT-SEALED-40-HEX-SHA> \
  --docker <EXACT-INSTALLED-DOCKER-BINARY-NOT-SYMLINK> \
  --docker-socket <EXACT-LOCAL-UNIX-SOCKET-NOT-SYMLINK> --timeout 180
```

`runner` requires its own fresh external output and separate authorization. The output must not exist, be under/above the repo, or traverse symlink ancestors. Existing source checkout mountpoints `node_modules` and all three `packages/{client,server,shared}/node_modules` must already exist as real directories. The wrapper refuses missing targets and never creates/modifies source checkout directories; Root's CI wiring may separately create missing EMPTY ignored targets. No `.vite` or existing cache is removed.

The existing pinned local image is `node@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, required linux/amd64, Node22.23.4. Docker uses `--pull=never`, an empty new per-run Docker configuration, an explicit local socket, and no inherited credentials, proxy configuration or Docker context. No image pull/login is attempted. A local image inspect and in-container Node version check are required; prior reports alone do not establish the current image.

The source repo is mounted read-only, with ONLY the exact historical doc overlaid read-only at `/repo/docs/CONTRACTS.md`; one fresh external output is writable. Root and all three workspace node_modules mounts are ephemeral tmpfs so npm's workspace `.vite` writes cannot reach read-only host caches. `/tmp` is also bounded tmpfs. Distinct empty `/tmp/empty-user-npmrc` and `/tmp/empty-global-npmrc` avoid npm's same-config-file error; existing root/workspace `.npmrc` causes refusal without reading it. `npm ci --ignore-scripts --no-audit --no-fund` uses the pinned original lock only. There is NO host npm cache or host configuration mount.

This design DOES require Docker's default network for the locked npm fetch; it does NOT falsely claim `--network=none`. No source execution or application network behavior beyond the unchanged local witness is authorized yet. Root must review the concrete network/dependency envelope before running. The pinned lock/ignored scripts are not a claim that dependency installation is offline.

Per container: 2 CPUs, 2 GiB RAM, 256 PIDs, no capabilities/new privileges, read-only image root, per-file 128 MiB limit, and a bounded total wall timeout (default180s, accepted30..600s). Temp allocations are explicitly limited (root modules1500MiB, each workspace256MiB, tmp1500MiB), not an RSS claim or host aggregate disk quota. Fresh output contains complete npm/stdout/stderr logs and any producer-written raw, plus a final context/argv/result/cleanup receipt. A new unique name plus exact owner label fences stop/remove operations. Only that owned container and the new wrapper's own client process group can be terminated on timeout; no existing container, database cluster or source process is targeted. No automatic retry.

## Prepared controls (UNRUN)

`tests.py` contains offline synthetic checks for independent current/historical pin drift, every-byte comparison (including metadata and final newline), ancestor/file symlink rejection, added source/tool inventory drift, exact single-write/four-tmpfs/distinct-npm-config/read-only historical overlay arguments, and refusal to stop a foreign labelled container. These tests do not invoke Source, Docker, npm or subprocesses. Proposed later command is `python3 tools/npc-witness-context/tests.py`; not executed in this preparation.

## Remaining gates

Root review and immutable driver freeze; concrete local Docker path/socket/image and fresh output approval; missing mountpoint preparation if needed; synthetic controls actually passing; exactly one frozen-context continuity and runner capture each with raw retained BEFORE host whole-byte verdict; cleanup evidence; then Root alone decides workflow wiring/CI retry. No gameplay correctness, new policy exception, current normative-doc rollback or general cross-revision oracle compatibility is asserted.
