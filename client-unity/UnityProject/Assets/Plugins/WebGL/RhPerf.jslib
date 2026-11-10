// Opt-in (?perf=1) frame-time recorder. Records every requestAnimationFrame timestamp (the browser's presented-frame
// cadence, not Unity's smoothed deltaTime) into preallocated Float64Arrays; the per-frame path allocates nothing.
// Results are read from JS as window.__rhPerf (see stats()).
mergeInto(LibraryManager.library, {
  RhPerf_Init: function (capacity) {
    if (window.__rhPerf) return;
    var cap = capacity | 0;
    if (cap < 1024) cap = 1024;
    var stamps = new Float64Array(cap);
    var n = 0, overflow = 0, recording = true, refreshOverrideHz = 0, windowStart = 0;
    var P = window.__rhPerf = {
      version: 1, capacity: cap, actors: 0, preset: -1, row: null
    };
    // One persistent callback: no closure or object is created per frame.
    function tick(ts) {
      if (recording) { if (n < cap) stamps[n++] = ts; else overflow++; }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    function sortedDeltas() {
      var d = new Float64Array(n > 1 ? n - 1 : 0);
      for (var i = 1; i < n; i++) d[i - 1] = stamps[i] - stamps[i - 1];
      return d;
    }
    function pct(sorted, p) {
      if (!sorted.length) return null;
      var k = Math.ceil(p * sorted.length) - 1;
      return sorted[k < 0 ? 0 : (k >= sorted.length ? sorted.length - 1 : k)];
    }
    P.reset = function () { n = 0; overflow = 0; recording = true; windowStart = performance.now(); };
    P.stop = function () { recording = false; };
    P.resume = function () { recording = true; };
    P.setRefreshHz = function (hz) { refreshOverrideHz = +hz || 0; };
    // Frame deltas in ms (rAF timestamp differences), in order, as a plain array for JSON transfer.
    P.deltas = function () { return Array.prototype.slice.call(sortedDeltas()); };
    P.timestamps = function () { return Array.prototype.slice.call(stamps.subarray(0, n)); };
    // Display cadence estimate: the override if set, else the 10th-percentile frame delta (the fast end), clamped.
    P.refreshMs = function () {
      if (refreshOverrideHz > 0) return 1000 / refreshOverrideHz;
      var s = sortedDeltas().sort();
      var v = pct(s, .10);
      return v === null ? null : Math.max(3, Math.min(1000 / 24, v));
    };
    P.stats = function () {
      var d = sortedDeltas(), count = d.length;
      var out = { version: 1, count: count, overflow: overflow, actors: P.actors, preset: P.preset, row: P.row,
        windowSeconds: count ? (stamps[n - 1] - stamps[0]) / 1000 : 0 };
      if (!count) return out;
      d.sort();
      var sum = 0; for (var i = 0; i < count; i++) sum += d[i];
      var worstN = Math.max(1, Math.ceil(count * .01)), worstSum = 0;
      for (var j = count - worstN; j < count; j++) worstSum += d[j];
      var refreshMs = P.refreshMs();
      var dropped = 0, limit = refreshMs * 1.5;
      for (var k = 0; k < count; k++) if (d[k] > limit) dropped++;
      out.meanMs = sum / count; out.p50Ms = pct(d, .5); out.p95Ms = pct(d, .95); out.p99Ms = pct(d, .99);
      out.maxMs = d[count - 1]; out.minMs = d[0];
      out.worst1PctMeanMs = worstSum / worstN; out.worst1PctFps = 1000 / (worstSum / worstN);
      out.refreshMs = refreshMs; out.refreshHz = 1000 / refreshMs; out.refreshSource = refreshOverrideHz > 0 ? 'override' : 'estimated';
      out.droppedFrames = dropped; out.droppedLimitMs = limit;
      return out;
    };
  },
  RhPerf_SetContext: function (actors, preset) {
    var P = window.__rhPerf; if (!P) return;
    P.actors = actors | 0; P.preset = preset | 0;
  },
  RhPerf_SetRow: function (json) {
    var P = window.__rhPerf; if (!P) return;
    try { P.row = JSON.parse(UTF8ToString(json)); } catch (_) { P.row = null; }
  }
});
