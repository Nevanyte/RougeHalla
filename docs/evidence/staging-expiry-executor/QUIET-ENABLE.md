# Narrow review repair: first-enable informational stderr

Reviewed original source: `31bd70d078c5d6465315e77a76c9574cd492bdcd`.
Original evidence/base for this repair: `b0ebb776c57a2f04bd5d36b11a2826945dcc8f15`.
Corrected code: `27ec2acbc287ca73e3a886640162070868dcd605`.

The lead's independent finite review found one concrete HOLD: the original strict native runner rejects any stderr, while a successful first `systemctl enable --now` normally emits install-change information there. The original fake manager bypassed that CLI boundary and the native runner test supplied empty stderr, so the earlier18PASS did not establish first-enable success through the actual runner. The reviewer reported no second proved blocker and explicitly released this narrow repair for sealing.

Production delta: only the exact allowlisted enable command gains `--quiet`, shared between its allowlist and call site:

```text
/usr/bin/systemctl --system --no-pager --no-ask-password --quiet enable --now rougehalla-absolute-expiry.timer
```

No stderr allowance, warning parser or global quiet option was added. Unexpected stderr and nonzero exits still refuse. Queries, shutdown, loaded-manager/file/fsync checks, independent guard and all host/cloud limitations remain as before. The nonquiet enable vector is no longer allowlisted. Shutdown service/timer/absolute deadline material is unchanged.

Primary v255 sources reviewed: [systemctl-enable.c](https://raw.githubusercontent.com/systemd/systemd/v255/src/systemctl/systemctl-enable.c) passes the quiet flag to install-change reporting; [install.c](https://raw.githubusercontent.com/systemd/systemd/v255/src/shared/install.c) emits the created-symlink informational message only when not quiet; [log.c](https://raw.githubusercontent.com/systemd/systemd/v255/src/basic/log.c) uses stderr for console logging. The test uses a representative synthetic line, not captured real-host output.

Three additional regressions cover the missing boundary:

- `NativeBoundaryLinux` routes the complete executor through production `LinuxRunner.run`; only trusted-tool checks and `subprocess.run` are mocked. The lower CLI model feeds the real private-file-derived fake manager, emits ordinary first-enable info unless actual argv is quiet, and proves first-enable can return an expiry gate only with the corrected vector and observed armed manager.
- The native runner accepts that exact quiet vector but still rejects unexpected stderr from quiet enable, timer queries and the clock query. The obsolete nonquiet vector is refused before a subprocess call.
- The CLI model is independently exercised with nonquiet first enable: it creates the actual private symlink, arms its loaded fake manager, and emits the informational line. Repeating enable without a new link emits no install-change info. This makes the defect visible rather than simply giving all native mocks empty stderr.

Validation history is additive and unedited:

1. [quiet-enable-before.txt](quiet-enable-before.txt): the first regression attempt had three errors, including a test-helper method colliding with the fake PID integer. That helper was renamed; this raw result is retained.
2. [quiet-enable-red.txt](quiet-enable-red.txt): with only test changes and original production code, four selected enable tests yielded two intended errors. The native full flow reached actual runner stderr rejection and then shutdown; the exact quiet command was not allowlisted. The CLI model and existing enable-link control passed.
3. [quiet-enable-after.txt](quiet-enable-after.txt): after the narrow command fix, all **21 expiry tests PASS**, including the prior18. Both modified Python files passed AST parsing and whitespace checks passed. No broader suite or host service was run.

Commands used the same pinned `final-env.sh`, then task-owned `CARGO_TARGET_DIR` and `RH_PGTEST_STATE` assignments and `PYTHONDONTWRITEBYTECODE=1`, as in the original README. The selected red command was `python3 -B -m unittest discover -s tools/staging-full-runtime/installer -p test_expiry_executor.py -k enable -v`; the final command omitted `-k enable` to run the21 tests. `verify.sh` remains unchanged and runs the current new-module suite. No new worktree/cache, Cargo/PG state, cloud call or real host action occurred.

The original README, source audit, bootstrap contract, logs (including18PASS) and `SHA256SUMS` remain byte-identical. The original manifest applies to Git objects at `b0ebb776`, not the changed current source files; all nine historical payloads were rehashed from those objects. The additive `quiet-enable-SHA256SUMS` covers the two corrected source files and the new evidence payloads. `quiet-enable-audit.json` pins preservation and scope.

The real Linux bootstrap integration, actual first enable, timer/clock/crash/reboot/shutdown tests and external physical-host/EC2 termination/cost verification remain required. Synthetic CLI behavior does not prove a real service started or a host powered off. Installer deployment gates remain false. Root owns re-review/integration; this worker made no merge or push.
