// Region music and ambience beds for the Web player. The beds are streamed MP3s; decoding them through Unity's own audio path
// (UnityWebRequestMultimedia + AudioSource) makes the engine log "Trying to get length of sound which is not loaded yet" on every load and
// FMOD errors 78/36 while the clip is not decoded, and the engine's clip memory is the same decoded PCM anyway. So the browser decodes
// (fetch + decodeAudioData) and plays them itself on Unity's AudioContext: sample-accurate loops, gains set from C#, nothing touches FMOD.
// Decks are numbered by C# (music 0-2, ambience 3-5). Failure is silent: a missing or undecodable file leaves state 2 and C# warns once.
mergeInto(LibraryManager.library, {
  $RhBedsCtx: function () {
    try {
      var b = window.__rhBeds || (window.__rhBeds = { ctx: null, buffers: {}, state: {}, decks: {}, hooked: false });
      if (b.ctx) return b;
      var ctx = null;
      try { if (typeof WEBAudio !== "undefined" && WEBAudio.audioContext) ctx = WEBAudio.audioContext; } catch (_) {}
      if (!ctx) { var C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
      b.ctx = ctx;
      if (!b.hooked) {
        b.hooked = true;
        var resume = function () { try { if (b.ctx && b.ctx.state !== "running") b.ctx.resume(); } catch (_) {} };
        ["pointerdown", "keydown", "touchstart"].forEach(function (n) { document.addEventListener(n, resume, true); });
      }
      return b;
    } catch (_) { return null; }
  },
  RhBeds_Available: function () {
    try { return (window.AudioContext || window.webkitAudioContext) ? 1 : 0; } catch (_) { return 0; }
  },
  // The part of a decoded file that loops: [startS, endS) (endS <= 0 = whole file), with a 25 ms raised-cosine fade at both ends so the
  // wrap never clicks. C# passes the points the audio probe measured (the files carry their own quiet fade-in and fade-out).
  $RhBedsLoopBuffer: function (ctx, buf, startS, endS) {
    var sr = buf.sampleRate, a = Math.max(0, Math.round(startS * sr)), z = endS > 0 ? Math.min(buf.length, Math.round(endS * sr)) : buf.length;
    if (z - a < sr) { a = 0; z = buf.length; }
    var n = z - a, out = ctx.createBuffer(buf.numberOfChannels, n, sr), f = Math.min(Math.round(0.025 * sr), n >> 2);
    for (var c = 0; c < buf.numberOfChannels; c++) {
      var src = buf.getChannelData(c), dst = out.getChannelData(c);
      for (var i = 0; i < n; i++) dst[i] = src[a + i];
      for (var j = 0; j < f; j++) { var g = 0.5 - 0.5 * Math.cos(Math.PI * j / f); dst[j] *= g; dst[n - 1 - j] *= g; }
    }
    return out;
  },
  RhBeds_Load__deps: ["$RhBedsCtx", "$RhBedsLoopBuffer"],
  RhBeds_Load: function (idPtr, urlPtr, startS, endS) {
    var id = UTF8ToString(idPtr), url = UTF8ToString(urlPtr);
    var b = RhBedsCtx(); if (!b) { return; }
    if (b.state[id] !== undefined) return;
    b.state[id] = 0;
    try {
      fetch(url).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.arrayBuffer(); })
        .then(function (data) { return new Promise(function (res, rej) { var p = b.ctx.decodeAudioData(data, res, rej); if (p && p.catch) p.catch(rej); }); })
        .then(function (buf) { b.buffers[id] = RhBedsLoopBuffer(b.ctx, buf, startS, endS); b.state[id] = 1; })
        .catch(function (e) { b.state[id] = 2; b.lastError = String(e); });
    } catch (e) { b.state[id] = 2; b.lastError = String(e); }
  },
  RhBeds_State: function (idPtr) {
    var b = window.__rhBeds; if (!b) return -1;
    var s = b.state[UTF8ToString(idPtr)]; return s === undefined ? -1 : s;
  },
  RhBeds_Duration: function (idPtr) {
    var b = window.__rhBeds; var buf = b && b.buffers[UTF8ToString(idPtr)]; return buf ? buf.duration : 0;
  },
  RhBeds_Start__deps: ["$RhBedsCtx"],
  RhBeds_Start: function (deck, idPtr, offset) {
    var b = RhBedsCtx(); if (!b) return;
    var id = UTF8ToString(idPtr), buf = b.buffers[id]; if (!buf) return;
    try {
      var d = b.decks[deck];
      if (!d) { var g = b.ctx.createGain(); g.gain.value = 0; g.connect(b.ctx.destination); d = b.decks[deck] = { gain: g, src: null }; }
      if (d.src) { try { d.src.stop(); } catch (_) {} try { d.src.disconnect(); } catch (_) {} d.src = null; }
      d.gain.gain.value = 0;
      var s = b.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(d.gain);
      d.id = id; d.src = s; s.start(0, buf.duration > 0 ? (offset % buf.duration) : 0);
      if (b.ctx.state !== "running") b.ctx.resume();
    } catch (e) { b.lastError = String(e); }
  },
  RhBeds_SetGain: function (deck, value) {
    var b = window.__rhBeds; var d = b && b.decks[deck]; if (!d) return;
    try { d.gain.gain.setTargetAtTime(value, b.ctx.currentTime, 0.02); } catch (_) {}
  },
  RhBeds_Stop: function (deck) {
    var b = window.__rhBeds; var d = b && b.decks[deck]; if (!d || !d.src) return;
    try { d.src.stop(); } catch (_) {} try { d.src.disconnect(); } catch (_) {}
    d.src = null; d.id = null; try { d.gain.gain.value = 0; } catch (_) {}
  },
  RhBeds_Evict: function (idPtr) {
    var b = window.__rhBeds; if (!b) return; var id = UTF8ToString(idPtr);
    delete b.buffers[id]; delete b.state[id];
  }
});
