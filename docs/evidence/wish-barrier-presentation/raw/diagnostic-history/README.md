# Diagnostic history

These records preserve corrected or superseded observations for audit context. They are not final acceptance evidence.

- `refresh-errors.json` records the initial Unity refresh/meta failure; compile status and EditMode results were captured again after repair.
- `editmode-initial.json` and `editmode-complete-initial.json` are earlier test snapshots. The initial partial batch reported 54 tests with 2 missing; do not interpret it as a full pass. The final source snapshot is `../editmode-source-final.json`.
- `editmode-complete-initial.json` failed the awaiting-owner label, then `editmode-final.json` failed an EditMode runtime-callback assumption. Both were corrected. `teardown-affected-tests.json` records the two affected lifecycle tests passing after explicitly invoking runtime hooks; actual engine dispatch was checked separately in Play mode.
- `engine-destroy-observed.json` is the pre-fix orphan observation. The final engine observation is `../final-engine-destroy-observed.json`, where the match, arena, cues, and listeners are absent.
