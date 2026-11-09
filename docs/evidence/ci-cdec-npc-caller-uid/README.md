# CI cdec: exact caller ownership for the historical NPC context

Preparation/repair only; no Docker/npm/Node/Source/World execution in this packet. Base canonical `7401e2908a080799937a6f074dbc142d74320cc1`. Created `codex/npc-context-caller-uid` in the existing Post worktree only after the tracked-clean check; old02d and all refs/untracked control outputs were preserved. No new worktree/target/cache or workflow edit.

## Proved predecessor failure

Root's bounded CI diagnostic for run42711938030 / Rust job129483722624 at22:42:47 records exit71, sourceStarted=false and owned container absent. stderr was exactly `sh: 3: cannot create /out/npm.log: Permission denied`. The fresh host output was private0700 owned by caller UID1001. The old container ran default root with ALL capabilities dropped, so it could not override that Linux DAC boundary. Mac shared-filesystem success did not establish Linux ownership compatibility. This is a pre-Source setup failure, not a parity divergence. Root retains the original CI receipts; none is modified here.

## Narrow correction

The wrapper captures numeric real UID/GID and requires them to be positive, below the invalid uid_t/gid_t sentinel2^32−1, and equal to effective UID/GID. It explicitly runs `--user UID:GID`. Caller root, root primary group, ambiguous real/effective identity or invalid numeric IDs refuse; there is no fallback to root or a guessed image account.

The exact FIVE ephemeral mounts (`/tmp`, root `/repo/node_modules`, and client/server/shared node_modules) retain their existing exec/size settings and now explicitly carry `mode=0700,uid=UID,gid=GID`. `/tmp` is private rather than a world-writable workaround. The create-new host output must ALREADY be a directory with caller UID:GID and mode0700, or the wrapper refuses before running a container. It never chmods/chowns host output/source/cache. No capabilities, groups, user namespaces or root privileges are added. Existing source mounts stay read-only. Source-only128MiB prlimit, other resource/time limits, clean daemon config/socket, locked npm setup, exact historical-doc overlay, pin/inventory guards, one-write/raw-before-exact-byte comparison and owned cleanup remain unchanged.

## Focused evidence

Initial direct invocation `PYTHONDONTWRITEBYTECODE=1 python3 tools/npc-witness-context/tests.py`: nine tests PASS in0.009s. Two new tests add the ownership/identity checks to the original seven. A separately retained final named run also reports nine PASS in0.009s in `final-synthetic.txt`; this was after the red controls with no intervening production code changes, not a retry of any Docker/Source operation.

The regression constructs ACTUAL docker_args for independent synthetic caller1001:1002 for BOTH witnesses, checks exactly one `--user`, and parses every tmpfs option into an exact ownership/mode/size/exec set with all five target paths present. It also preserves cap-drop/read-only and rejects chmod/chown payloads. Invalid/root/mismatched caller and wrong output inode owner/group/type/mode controls refuse.

`old-default-controls.txt` loads ONLY the old trusted Python wrapper helper from immutable7401 Git bytes; its __main__ never runs. A compatibility adapter discards the two new identity arguments, then calls the actual predecessor docker_args. The SAME new ownership test fails a semantic assertion because `--user` is absent (zero errors). A second partial-fix control adds ONLY `--user1001:1002` to the predecessor command and fails the tmpfs ownership/mode assertion (zero errors). No Source input/output or fake expected World state is installed. The Git blob read was read-only metadata; neither red control executes Docker/npm/Node/Source.

`PROTECTED.json` verifies current/historical context docs, both full original oracles, and all six+five original producer-tool files against the7401 Git base. The old context, source/expected bytes and old historical evidence manifests remain untouched. This new packet has its own additive manifest.

## Remaining actual gates and credential caveat

Root must review/seal the exact child, approve one affected actual frozen-context check, inspect actual --user/tmpfs ownership/raw hash/cleanup, then authorize fresh CI. All actual Linux ownership and Source reproduction claims remain pending that run; synthetic tests do not prove a successful npm install or witness. No permission/capability change or automatic retry is authorized here.

SEPARATE existing CI detail, flagged to Root only: the canonical checkout defaults to persisted Git credentials, and the whole read-only /repo bind includes .git. Read-only does not make those credentials unreadable to the same caller UID or to trusted producer/dependency code. This packet neither reads credentials nor edits workflow/checkouts/mount scope. Root owns any `persist-credentials:false` or CI credential handling correction; do not describe this ownership fix as removing that independent exposure.

## Root compatibility follow-up

Root identified that Path.stat(follow_symlinks=False) would require Python3.10. The new output ownership observation now uses the equivalent nofollow Path.lstat(), retaining the existing Python3.9-compatible wrapper domain. This is the sole follow-up functional line change; no identity/tmpfs/permission/capability/Source behavior changed.

The earlier final-synthetic.txt and both old/partial command regression failures are retained untouched. The additional final-lstat-synthetic.txt records the nine synthetic tests after this compatibility correction; all nine PASS. No Docker/npm/Source execution occurred. Root still owns staging/seal and the one affected actual check.
