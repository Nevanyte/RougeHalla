# First integrated harness refusal

The actual source World and producer/consumer callbacks ran, then the parent's coverage guard incorrectly read `frame.minimap.dots`. The actual source interface is `MinimapView.mobs`. This TypeError occurred before any canonical fixture was written; no byte check or semantic control was counted as passing.

The raw command, error, exit 1 and elapsed time are preserved in `run.log`. The next candidate corrects only the harness field name. This is not a gameplay or source-module failure.
