// Diagnostic milestones share the browser's performance.now clock with DOM input and WebSocket observations.
mergeInto(LibraryManager.library, {
  RhLatency_Enabled: function () { return window.__rhLatency ? 1 : 0; },
  RhLatency_Mark: function (kind, frame, player, moveSeq, x, y) {
    var trace = window.__rhLatency;
    if (!trace) return;
    trace.frame = frame;
    if (trace.events.length >= 20000) { trace.overflow = true; return; }
    trace.events.push({kind: UTF8ToString(kind), frame: frame, player: player, moveSeq: moveSeq, x: x, y: y, at: performance.now()});
  }
});
