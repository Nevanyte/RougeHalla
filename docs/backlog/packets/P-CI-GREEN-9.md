# P-CI-GREEN-9: the determinism comparator knows the augment and elite rules

- **Serves:** CI green for PR 80 (owner, 2026-11-20: "Please push and merge the new augments").
- **Tier:** coordinator (a few lines in one tool and its test, through the gate's Python step).
- **Failure (the oracle):** CI run 44939899271, job "Compare native CI artifacts", PR 80 head `fa064ce24`:
  `mismatch at $.replay.config: replay config keys outside the recognized optional leaves`.
  - P-AUG-RULES-1 added `SimConfig::augments` and `SimConfig::elites`. The replay serializer writes them as JSON `null`
    (Legacy) or `"rework"`; CI's replay has `"augments": null, "elites": null`.
  - `tools/determinism/compare.py` accepts only the replay config leaves it lists, and these two were not listed. The
    comparison runs only on CI's two native artifacts, which is why the gate never saw this (as `tick_ms` in
    `2d01a5dac`).
- **Fix:** add both keys to `REPLAY_SIM_KEYS` and to `REPLAY_NULLABLE_NAMES` (null or `"rework"`). The test file
  covers them in the equal-leaves test and with one bad value each.
- **Write scope:** `tools/determinism/compare.py`, `tools/determinism/test_compare.py`, this brief.
- **Done:**
  - `python3 -m unittest discover -s tools/determinism` passes (27/27), and so does the gate's whole Python step.
  - `compare.py` on CI run 44939899271's two downloaded artifacts prints
    `ok: ci 6 scenarios match; replay bytes are identical`.
  - The job passes on PR 80.
