# BotManager.addBot override witness (P-BOTS-7 residual)

Captures the actual unchanged legacy BotManager.addBot override seam (source packages/server/src/bots/BotManager.ts,
BotSeatOverrides interface at lines 73-79, addBot at lines 260-288) in the pinned linux/amd64 Node 22.23.4 container:
explicit seats via addBot ops over a real headless world, mixed with the arrival schedule, the yield/seat sequence, the
full-lobby null return and the profile-taken callsign interaction, plus a draw-control pair proving that every draw is
made whether or not it is overridden.

    bash tools/bot-addbot-fixtures/capture.sh          # write parity/policy/bot-addbot.json
    bash tools/bot-addbot-fixtures/capture.sh --check  # byte-identical recapture check

The corpus is consumed by crates/rh-server/src/bot_fill_tests.rs (the explicit add_bot seam: direct seat, shared id/draw
stream, deterministic draw consumption, full-lobby no-consumption). A failed recapture means the source changed (or the
pinned image/tool did): do not hand-adjust values.
