// Browser-side render-pass capture (perf-matrix.cjs --passes). Splits chosen frames of the Unity canvas into passes (one pass
// per framebuffer binding) and records, per pass: target size, draw calls, vertices, program switches, texture binds, clears,
// and the GPU time of the pass (EXT_disjoint_timer_query_webgl2, one TIME_ELAPSED query per pass, sequential). Outside a
// capture it only counts draws per frame. window.__rhPasses.capture(n) captures the next n frames; .result() aggregates.
(() => {
  const S = window.__rhPasses = { frames: [], pending: [], want: 0, ext: null, gl: null, timer: false };
  let gl = null, ext = null, cur = null, frame = null, inRaf = false;
  const fbIds = new WeakMap(); let nextFb = 1;
  const progIds = new WeakMap(); let nextProg = 1;
  const fbId = fb => { if (!fb) return 0; if (!fbIds.has(fb)) fbIds.set(fb, nextFb++); return fbIds.get(fb); };
  const progId = p => { if (!p) return 0; if (!progIds.has(p)) progIds.set(p, nextProg++); return progIds.get(p); };
  let viewport = [0, 0, 0, 0], boundFb = 0, program = 0;
  function openPass() {
    if (!frame) return;
    cur = { fb: boundFb, vp: null, draws: 0, verts: 0, progs: new Set(), progSwitches: 0, texBinds: 0, clears: 0, blits: 0, q: null };
    if (ext && frame.timed) { cur.q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, cur.q); }
    frame.passes.push(cur);
  }
  function closePass() {
    if (!cur) return;
    if (cur.q) gl.endQuery(ext.TIME_ELAPSED_EXT);
    cur = null;
  }
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    const g = get.call(this, type, ...args);
    if (g && type === 'webgl2' && this.id === 'unity-canvas' && !gl) {
      gl = S.gl = g; ext = S.ext = g.getExtension('EXT_disjoint_timer_query_webgl2'); S.timer = !!ext;
      const wrap = (name, fn) => { const orig = g[name]; g[name] = function (...a) { if (frame) fn(a); return orig.apply(g, a); }; };
      const wrapAfter = (name, fn) => { const orig = g[name]; g[name] = function (...a) { const r = orig.apply(g, a); fn(a, r); return r; }; };
      wrapAfter('bindFramebuffer', a => { if (a[0] === g.FRAMEBUFFER || a[0] === g.DRAW_FRAMEBUFFER) { const id = fbId(a[1]); if (frame && id !== boundFb) { boundFb = id; closePass(); openPass(); } else boundFb = id; } });
      wrapAfter('viewport', a => { viewport = [a[0], a[1], a[2], a[3]]; if (cur && !cur.vp) cur.vp = viewport.slice(); });
      wrapAfter('useProgram', a => { const id = progId(a[0]); if (cur && id !== program) { cur.progSwitches++; cur.progs.add(id); } program = id; });
      for (const n of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements'])
        wrap(n, a => { if (!cur) return; cur.draws++; cur.verts += n === 'drawRangeElements' ? a[3] : a[1] * (n.endsWith('Instanced') ? a[a.length - 1] : 1); if (!cur.vp) cur.vp = viewport.slice(); });
      wrap('bindTexture', () => { if (cur) cur.texBinds++; });
      wrap('clear', () => { if (cur) cur.clears++; });
      wrap('blitFramebuffer', () => { if (cur) cur.blits++; });
    }
    return g;
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (fn) {
    return raf(function (ts) {
      if (inRaf) return fn(ts);
      inRaf = true;
      if (S.want > 0 && gl) { S.want--; frame = { ts, passes: [], timed: !!ext && !gl.getParameter(ext.GPU_DISJOINT_EXT) }; openPass(); }
      try { return fn(ts); }
      finally {
        if (frame) { closePass(); S.pending.push(frame); frame = null; }
        inRaf = false;
        poll();
      }
    });
  };
  function poll() {
    if (!gl) return;
    while (S.pending.length) {
      const f = S.pending[0];
      const ready = f.passes.every(p => !p.q || gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE));
      if (!ready) break;
      S.pending.shift();
      const disjoint = ext && gl.getParameter(ext.GPU_DISJOINT_EXT);
      S.frames.push(f.passes.map(p => {
        const ms = p.q && !disjoint ? gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6 : null; if (p.q) gl.deleteQuery(p.q);
        return { fb: p.fb, w: p.vp ? p.vp[2] : null, h: p.vp ? p.vp[3] : null, draws: p.draws, verts: p.verts, programs: p.progs.size, progSwitches: p.progSwitches, texBinds: p.texBinds, clears: p.clears, blits: p.blits, gpuMs: ms };
      }).filter(p => p.draws || p.clears || p.blits || p.gpuMs > 0.01));
    }
  }
  S.capture = n => { S.frames = []; S.want = n; };
  // Aggregate captured frames: passes are matched by their order in the frame (Unity's pass order is stable frame to frame).
  S.result = () => {
    const fr = S.frames.filter(f => f.length);
    if (!fr.length) return null;
    const n = Math.max(...fr.map(f => f.length));
    const typical = fr.filter(f => f.length === n);
    const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    const passes = [];
    for (let i = 0; i < n; i++) {
      const col = typical.map(f => f[i]);
      passes.push({ i, fb: col[0].fb, w: col[0].w, h: col[0].h, draws: med(col.map(p => p.draws)), verts: med(col.map(p => p.verts)), programs: med(col.map(p => p.programs)),
        progSwitches: med(col.map(p => p.progSwitches)), texBinds: med(col.map(p => p.texBinds)), clears: med(col.map(p => p.clears)), blits: med(col.map(p => p.blits)), gpuMs: med(col.map(p => p.gpuMs)) });
    }
    const tot = typical.map(f => f.reduce((s, p) => s + (p.gpuMs || 0), 0));
    return { frames: fr.length, typicalFrames: typical.length, passCount: n, gpuTotalMs: med(tot), draws: med(typical.map(f => f.reduce((s, p) => s + p.draws, 0))), passes };
  };
})();
