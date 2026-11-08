// Diagnostic milestones share the browser's performance.now clock with DOM input and WebSocket observations.
mergeInto(LibraryManager.library, {
  RhLatency_Enabled: function () {
    try {
      var trace = window.__rhLatency;
      return trace && typeof trace === "object" && Array.isArray(trace.events) ? 1 : 0;
    } catch (_) { return 0; }
  },
  RhLatency_Mark: function (kind, frame, player, moveSeq, x, y) {
    try {
      var trace = window.__rhLatency;
      // A malformed opt-in collector must never interrupt the game frame before transport polling.
      if (!trace || typeof trace !== "object" || !Array.isArray(trace.events)) return;
      trace.frame = frame;
      if (trace.events.length >= 20000) { trace.overflow = true; return; }
      trace.events.push({kind: UTF8ToString(kind), frame: frame, player: player, moveSeq: moveSeq, x: x, y: y, at: performance.now()});
    } catch (_) { /* Optional diagnostics never interrupt input or transport. */ }
  }
});
