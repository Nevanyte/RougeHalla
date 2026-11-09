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
