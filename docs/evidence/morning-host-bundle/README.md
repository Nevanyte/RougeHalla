# Local host bundle packager

This is a local packaging helper only. Worktree base: `eebb849f51949533c230a0e15e3094d60f9b41b8`. The packager consumes explicit reviewed inputs and never executes the server, invokes Unity, contacts a service, or performs AWS work. No actual release binary, source map, or Web output was packaged in this task.

`hosting/technical-demo/bundle.py` writes an uncompressed USTAR archive using only regular-file members. It walks every entry in the explicit Web tree and refuses symlinks, hardlinks, special files, unreadable traversal, unsafe/overlong member paths, unsafe empty directory names, missing `web/index.html`, invalid/non-object/non-finite JSON map input, non-executable or non-x86-64 ELF server input, output collisions, and the host's member, expanded-size, manifest, or final archive limits. It hashes inputs in bounded chunks, rechecks file identity and bytes during packaging, and checks the Web inventory again before reporting success. The tar has sorted paths and fixed mode, uid/gid, owner names, and mtime. The separate local receipt is not in the tar; it records `deployable:false`, archive and manifest hashes, and every member path/size/hash. It contains no guessed protocol/content identity and does not establish build provenance.

## Verification

Commands ran from `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/morning-host-bundle`, with `PYTHONDONTWRITEBYTECODE=1` and `python3 -B`:

| Command | Result | Raw output |
| --- | --- | --- |
| `python3 -B -m unittest discover -s hosting/technical-demo -p test_bundle.py -v` | exit 0; 8 tests passed | [test-bundle-final.txt](logs/test-bundle-final.txt) |
| `python3 -B -m unittest discover -s hosting/technical-demo -p test_offline.py -v` | exit 0; 12 existing offline tests passed | [test-offline.txt](logs/test-offline.txt) |
| `python3 -B -m unittest discover -s hosting/technical-demo -p test_stack.py -v` | exit 0; 7 existing stack tests passed | [test-stack.txt](logs/test-stack.txt) |
| `git diff --check` | exit 0 | command output was empty |

The first focused run is retained in [test-bundle-first.txt](logs/test-bundle-first.txt). Its malformed-map and wrong-ELF subcases were initially blocked because the preceding missing-index fixture remained missing; the test fixture was corrected, and the final run reaches and passes each intended refusal. The initial shell wrapper also used zsh's read-only variable name `status`, so it did not retain a separate numeric exit line; the raw unittest output records that run as `FAILED`. This was a test setup issue, not a packager or host failure.

The new tests use a tiny synthetic ELF header that is only inspected, a small JSON map, and a small Web tree. They prove deterministic tar bytes despite different input mtimes and file-creation order; exact member/hash inventory and normalized metadata; acceptance by the existing `bootstrap.unpack`; and refusal controls for collisions, symlinks, special server input, unsafe file/directory names, missing index, malformed map, wrong ELF, traversal errors, and each configured size/count ceiling. The existing 12+7 suites exercise the unchanged consumer and stack templates. No source/client/capture/build, host execution, public readiness, artifact identity, upload, or deployment claim follows.

## Final paths and bindings

Only these files were added or changed:

- `hosting/technical-demo/bundle.py`
- `hosting/technical-demo/test_bundle.py`
- `hosting/technical-demo/README.md` (new packaging usage paragraph; historical and corrected launch-default wording retained)
- `docs/evidence/morning-host-bundle/README.md` and its raw test logs

`manifest.json` binds file sizes and SHA-256 values for this scoped implementation/evidence set. Root review and sealing remain pending. A final host release still requires exact reviewed binary, complete extracted map, exact Web output, separate binary `/info` receipt, final archive hash, and Root-owned config/artifact checks.

## Coordinator verification (2026-11-10)

Re-run from the worktree root with `PYTHONDONTWRITEBYTECODE=1` and `python3 -B`:

| Command | Exit code | Pass count |
| --- | --- | --- |
| `python3 -B -m unittest discover -s hosting/technical-demo -p test_bundle.py -v` | 0 | 8 of 8 (`OK`) |
| `python3 -B -m unittest discover -s hosting/technical-demo -p test_offline.py -v` | 0 | 12 of 12 (`OK`) |
| `python3 -B -m unittest discover -s hosting/technical-demo -p test_stack.py -v` | 0 | 7 of 7 (`OK`) |
| `git diff --check` | 0 | no output |

The manifest was checked against the working tree with `shasum -a 256` and `wc -c`: every listed path matched in size and SHA-256 at the time of verification. This section changes `docs/evidence/morning-host-bundle/README.md` itself, so its manifest row (4000 bytes, `50ac922c...`) is now stale; the manifest was intentionally not regenerated in this step.

Review of `hosting/technical-demo/bundle.py`: it imports only `argparse`, `hashlib`, `json`, `os`, `pathlib`, `re`, `stat` and `tarfile`. It has no subprocess, socket, HTTP, boto or AWS usage. The only `executable` references check file mode and ELF header bytes; the server binary is read, never run.
