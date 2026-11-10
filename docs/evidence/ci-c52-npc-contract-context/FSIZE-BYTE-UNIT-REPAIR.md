# File-size byte-unit repair

Root's immutable `ci-c52-npc-historical-context-continuity-01` receipt remains a pre-Source failure: npm exit 71, sourceStarted=false, TAR_ENTRY_ERROR EFBIG. The old Docker argument was `fsize=131072:131072`. Docker takes these values in BYTES, so it imposed 128 KiB rather than the documented intended 128 MiB. This blocked ordinary npm files before any historical-context World witness ran. No Source retry or outcome is claimed here.

The only production-wrapper change is `fsize=134217728:134217728`, explicitly 128 * 1024 * 1024 bytes, preserving the intended operational ceiling. No other resource bound, producer, oracle, context, historical/current documentation pin or capture argument changed.

The new synthetic regression parses the actual generated Docker `--ulimit` value for BOTH witness commands. It independently reads each oracle file's current size, requires it equal the sealed context size (continuity 13,952,630 bytes; runner 30,636,484 bytes), and requires both parsed byte ceilings fit that entire file and equal exactly 128 MiB. It also asserts that the old 131072 value is too small for each real oracle. Reverting the argument to its predecessor therefore fails this control; this is not just an assertion against a copied command string.

Executed once in this repair: `python3 tools/npc-witness-context/tests.py`. Exact result:

```text
.......
----------------------------------------------------------------------
Ran 7 tests in 0.006s

OK
```

These are offline synthetic tests only: no actual Docker/subprocess invocation, npm, Node, Source import or World execution. The synthetic cleanup control replaces subprocess.run before testing it. The historical-context Source check remains pending Root's new immutable release and one fresh actual run; attempt 01 stays preserved.

A read-only text inspection of `variants-build.mjs`, `variants-runtime.mjs` and `bot-protection-cues-variants/PROPOSED-ENVELOPES.json` found NO fsize/--ulimit argument. They do not repeat this byte-unit mistake and were not modified. This is not a new execution/resource-budget proof for those variants.

## Attempt 02: keep the ceiling on Source, not dependency preparation

The immutable corrected-unit attempt `ci-c52-npc-historical-context-continuity-02` also failed BEFORE Source: exit71/sourceStarted=false; its npm.log is exactly25 bytes (`File size limit exceeded\n`); stdout/stderr empty; owned container verified absent. No retry was performed by this author. Root's separate tiny no-network/no-npm/no-Source diagnostic confirmed `/proc/self/limits` reported134217728 bytes; dash reported262144 512-byte units; `/usr/bin/prlimit` exists in the exact existing pinned image. The byte-unit repair is correct. The particular npm file/operation exceeding the ceiling is UNKNOWN; this record does not attribute it to a dependency or claim a full installation trace.

The narrow follow-up removes ONLY container-wide `--ulimit fsize`; all other container/image/socket/ownership, CPU/RAM/PID/tmpfs/total-time and pin/byte checks remain unchanged. After successful locked npm and the unchanged Node identity check, the wrapper invokes `/usr/bin/prlimit --fsize=134217728:134217728 -- /bin/sh -eu -c` with the fixed allowlisted payload `printf source-started > /out/source-started; exec node --import tsx <ORIGINAL_CAPTURE_SCRIPT> --write /out/actual.json`. The producer script is still one of the two existing exact allowlisted original paths. Both marker and exec are INSIDE the limited shell: a missing/failing prlimit cannot falsely mark Source started. The marker denotes imminent producer invocation, not earned World progress or a successful capture. npm never inherits this process-specific file ceiling; it remains within the unchanged other operational bounds.

The existing byte-size synthetic test was strengthened to parse the actual `prlimit` command, require no container `--ulimit`, both exact128MiB ceilings and both unchanged actual oracle sizes, and verify successful-npm failure handling precedes the limited shell. It requires the exact marker-then-exec original producer payload and one write only. A second focused offline invocation of `python3 tools/npc-witness-context/tests.py` passed7/7 in0.006s (`.......`, `Ran 7 tests in 0.006s`, `OK`). These synthetic tests launch no subprocesses, npm, Docker, Node or Source. The prior invocation and its original test shape remain recorded above.

Actual historical-context Source execution is STILL PENDING: both failed attempts were pre-Source. No further container/npm/World run or old tool/fixture/oracle/context/document edit was made for this follow-up. Root must freeze/review the new wrapper and authorize any fresh run.
