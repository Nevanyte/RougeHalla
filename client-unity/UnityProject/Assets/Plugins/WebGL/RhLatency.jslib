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
  },
  RhLatency_TakeTargetRequest: function () {
    try {
      var trace = window.__rhLatency;
      if (!trace || typeof trace !== "object" || !Array.isArray(trace.events) || trace.targetsRequested !== true) return 0;
      trace.targetsRequested = false;
      return 1;
    } catch (_) { return 0; }
  },
  RhLatency_WishPresented: function (kind, frame, caster, ability, sourceTime) {
    try {
      var trace = window.__rhLatency;
      if (!trace || typeof trace !== "object" || !Array.isArray(trace.events)) return;
      trace.frame = frame;
      if (trace.events.length >= 20000) { trace.overflow = true; return; }
      trace.events.push({kind: UTF8ToString(kind), frame: frame, player: caster, ability: ability, sourceTime: sourceTime, at: performance.now()});
    } catch (_) { /* Optional presentation evidence cannot interrupt the renderer. */ }
  }
});
