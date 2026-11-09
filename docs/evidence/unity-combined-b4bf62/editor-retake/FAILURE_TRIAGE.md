# b4bf62 test and native-readiness triage

Exact source cut: `b4bf621d7ed285bb6af4eb737073e197450415df`.

## EditMode tests: PASS

The raw four-case result contains exactly the four selectors in `EXPECTED_TESTS.json`: **4 passed, 0 failed, 0 skipped, 0 unrun**. `four-case-gate.json` independently records `PASS` and `selectorsMatch: true`. These test results are separate from the native readiness phase below.

## First native readiness phase: FAIL_STOPPED

The first requested pre-capture coroutine asked for `yield null`, a 0.2-second realtime wait, and `WaitForEndOfFrame`. The request receipt records frame 1. No coroutine receipt was produced within the 10-second timeout (`rendered-readiness-timeout.json`). The recorded Play state remained frame 1 and `newestMs: 5050.0` from initial state to timeout; observed realtime advanced from 34.835 to 191.713 seconds. The Editor status showed `playing: true`, `paused: false`, `background: true`, and `focusedWindow: null` at timeout. Auto-tick was set to 16ms after entering Play.

The eval-context screen dimensions were 752×252; this is not accepted native-backbuffer evidence. CUA showed a QHD Game view (2560×1440 at 0.28 scale), but **no ScreenCapture call ran**. There are zero PNGs and no accepted native capture. The attempt stopped; no focus/shader retry, additional coroutine, or replay was made. The parent then exited Play and began restoring globals.

These are the observed readiness facts only. This packet does not assign a cause to the missing coroutine receipt and does not count it as a test failure. There is no rendered, visual, or asset acceptance result.

## Revision boundaries

The e2baad recovery2 result, 95bd9c cosmetics7/progress3 results, and 719cc2 18-pass receipt remain separately revision scoped; none is included in the b4bf62 four-test count.
