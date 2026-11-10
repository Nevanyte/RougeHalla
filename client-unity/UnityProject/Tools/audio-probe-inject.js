// Injected by audio-probe.cjs with page.addInitScript, before any page script runs. Everything the page sends to an AudioContext
// destination is rerouted through a bus we own:   source -> bus(gain) -> analyser -> destination
//                                                                     \-> AudioWorklet tap (exact 50 ms RMS / peak / spectrum windows)
// Exposes window.__rhAudioProbe. Times are performance.now() milliseconds (same clock as the captured console lines).
(() => {
  if (window.__rhAudioProbe) return;
  const WIN_MS = 50, MAX_WINDOWS = 24000, MAX_CONSOLE = 20000;
  const P = window.__rhAudioProbe = {
    version: 1, contexts: [], windows: [], console: [], markers: [], created: [], errors: [],
    sourcesStarted: 0, sourcesEnded: 0, active: new Set(), edges: new WeakMap(), workletReady: 0,
  };

  // ---- console capture with a timestamp from the page's own clock ----
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
    const orig = console[k].bind(console);
    console[k] = function (...a) {
      try { P.console.push({ t: performance.now(), type: k, text: a.map(x => (typeof x === 'string' ? x : (x && x.message) || String(x))).join(' ') }); if (P.console.length > MAX_CONSOLE) P.console.splice(0, 2000); } catch (_) {}
      return orig(...a);
    };
  }
  window.addEventListener('error', e => P.errors.push({ t: performance.now(), message: String(e.message) }));

  // ---- worklet source: exact windows, spectrum of the last 2048 mono samples per window ----
  const workletSource = `
    class RhProbe extends AudioWorkletProcessor {
      constructor(opts) {
        super(); this.win = Math.round(sampleRate * ${WIN_MS} / 1000); this.n = 0; this.sumSq = 0; this.cnt = 0; this.pk = 0; this.pkL = 0; this.pkR = 0;
        this.ring = new Float32Array(2048); this.rp = 0; this.hann = new Float32Array(2048); for (let i = 0; i < 2048; i++) this.hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / 2047);
        this.re = new Float64Array(2048); this.im = new Float64Array(2048);
      }
      fft(sig) {
        const n = 2048, re = this.re, im = this.im;
        for (let i = 0; i < n; i++) { re[i] = sig[i]; im[i] = 0; }
        for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; } }
        for (let len = 2; len <= n; len <<= 1) {
          const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
          for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
            const a = i + k, b = i + k + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
            re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
        }
      }
      process(inputs) {
        const inp = inputs[0], l = inp && inp[0], r = inp && (inp[1] || inp[0]);
        for (let i = 0; i < 128; i++) {
          const a = l ? l[i] : 0, b = r ? r[i] : 0;
          this.sumSq += a * a + b * b; this.cnt += 2; const aa = Math.abs(a), bb = Math.abs(b);
          if (aa > this.pk) this.pk = aa; if (bb > this.pk) this.pk = bb; if (aa > this.pkL) this.pkL = aa; if (bb > this.pkR) this.pkR = bb;
          this.ring[this.rp] = (a + b) * 0.5; this.rp = (this.rp + 1) & 2047; this.n++;
        }
        if (this.n >= this.win) {
          const sig = new Float32Array(2048); for (let i = 0; i < 2048; i++) sig[i] = this.ring[(this.rp + i) & 2047] * this.hann[i];
          this.fft(sig);
          let num = 0, den = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, best = 0, bestK = 0; const hz = sampleRate / 2048;
          for (let k = 1; k < 1024; k++) { const p = this.re[k] * this.re[k] + this.im[k] * this.im[k], f = k * hz; num += f * p; den += p;
            if (f < 300) b0 += p; else if (f < 1500) b1 += p; else if (f < 5000) b2 += p; else b3 += p; if (p > best) { best = p; bestK = k; } }
          this.port.postMessage({ ct: currentTime, rms: Math.sqrt(this.sumSq / Math.max(1, this.cnt)), peak: this.pk, peakL: this.pkL, peakR: this.pkR,
            centroid: den > 1e-12 ? num / den : 0, bands: [b0, b1, b2, b3], domHz: bestK * hz, power: den });
          this.n = 0; this.sumSq = 0; this.cnt = 0; this.pk = 0; this.pkL = 0; this.pkR = 0;
        }
        return true;
      }
    }
    registerProcessor('rh-probe', RhProbe);`;
  const workletUrl = URL.createObjectURL(new Blob([workletSource], { type: 'application/javascript' }));

  const oc = AudioNode.prototype.connect, od = AudioNode.prototype.disconnect;
  const Orig = window.AudioContext || window.webkitAudioContext;
  if (!Orig) { P.errors.push({ t: 0, message: 'no AudioContext' }); return; }

  function setup(ctx) {
    const bus = Orig.prototype.createGain.call(ctx), analyser = Orig.prototype.createAnalyser.call(ctx);
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0;
    oc.call(bus, analyser); oc.call(analyser, ctx.destination);
    ctx.__rhBus = bus;
    const info = { ctx, bus, analyser, sampleRate: ctx.sampleRate, createdAt: performance.now() };
    P.contexts.push(info); P.bus = bus; P.analyser = analyser; P.ctx = ctx;
    ctx.audioWorklet.addModule(workletUrl).then(() => {
      const node = new AudioWorkletNode(ctx, 'rh-probe', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
      node.port.onmessage = ev => {
        const m = ev.data; let perf = performance.now();
        try { const ts = ctx.getOutputTimestamp(); if (ts && ts.performanceTime > 0) perf = ts.performanceTime + (m.ct - ts.contextTime) * 1000; } catch (_) {}
        m.t = perf; m.arrived = performance.now(); P.windows.push(m); if (P.windows.length > MAX_WINDOWS) P.windows.splice(0, 2000);
      };
      oc.call(bus, node); P.workletReady++; info.worklet = node;
    }).catch(e => P.errors.push({ t: performance.now(), message: 'worklet: ' + e }));
  }

  class ProbeContext extends Orig { constructor(...a) { super(...a); try { setup(this); } catch (e) { P.errors.push({ t: performance.now(), message: 'setup: ' + e }); } } }
  window.AudioContext = ProbeContext; window.webkitAudioContext = ProbeContext;

  // Route anything aimed at the destination through the bus; remember edges so contributions can be walked later.
  AudioNode.prototype.connect = function (dest, ...rest) {
    try {
      if (dest instanceof AudioDestinationNode && this.context.__rhBus && this !== this.context.__rhBus) {
        const list = P.edges.get(this) || []; list.push(this.context.__rhBus); P.edges.set(this, list);
        oc.call(this, this.context.__rhBus, ...rest); return dest;
      }
      if (dest instanceof AudioNode) { const list = P.edges.get(this) || []; list.push(dest); P.edges.set(this, list); }
    } catch (e) { P.errors.push({ t: performance.now(), message: 'connect: ' + e }); }
    return oc.call(this, dest, ...rest);
  };
  AudioNode.prototype.disconnect = function (dest, ...rest) {
    try {
      if (dest instanceof AudioDestinationNode && this.context.__rhBus) return od.call(this, this.context.__rhBus, ...rest);
      if (dest instanceof AudioNode) { const list = P.edges.get(this); if (list) { const i = list.indexOf(dest); if (i >= 0) list.splice(i, 1); } }
      else if (dest === undefined) P.edges.delete(this);
    } catch (e) { P.errors.push({ t: performance.now(), message: 'disconnect: ' + e }); }
    return dest === undefined ? od.call(this) : od.call(this, dest, ...rest);
  };

  // Track buffer sources (clip playback) so per-clip gain can be read.
  const bs = AudioBufferSourceNode.prototype, start = bs.start;
  bs.start = function (...a) {
    try {
      P.sourcesStarted++; P.active.add(this); const t = performance.now();
      this.__rhStart = t; P.created.push({ t, dur: this.buffer ? this.buffer.duration : 0, loop: this.loop });
      if (P.created.length > 4000) P.created.splice(0, 1000);
      this.addEventListener('ended', () => { P.active.delete(this); P.sourcesEnded++; });
    } catch (_) {}
    return start.apply(this, a);
  };

  // gain applied between a node and the bus (product of GainNode values along the first path)
  function chainGain(node) {
    let g = 1, n = node, hops = 0;
    while (n && hops++ < 12) {
      if (n.gain && typeof n.gain.value === 'number') g *= n.gain.value;
      if (n === n.context.__rhBus) return g;
      const next = P.edges.get(n); n = next && next.length ? next[next.length - 1] : null;
    }
    return g;
  }
  P.activeSources = () => Array.from(P.active).map(s => ({ dur: s.buffer ? +s.buffer.duration.toFixed(3) : 0, loop: !!s.loop, gain: +chainGain(s).toFixed(4), startedAt: s.__rhStart }));
  P.state = () => (P.ctx ? P.ctx.state : 'none');
  P.resume = () => (P.ctx ? P.ctx.resume() : null);
  P.mark = label => { P.markers.push({ t: performance.now(), label }); };
  P.latest = () => { const w = P.windows[P.windows.length - 1]; return w ? { t: w.t, rms: w.rms, peak: w.peak } : null; };
  P.freq = () => { const a = new Float32Array(P.analyser.frequencyBinCount); P.analyser.getFloatFrequencyData(a); return Array.from(a); };
  // Unity's own bookkeeping, where reachable.
  P.unityAudio = () => {
    const cands = [window.WEBAudio, window.unityInstance && window.unityInstance.Module && window.unityInstance.Module.WEBAudio, window.Module && window.Module.WEBAudio];
    const w = cands.find(Boolean); if (!w) return { reachable: false };
    const inst = w.audioInstances || {}; const rows = [];
    for (const k of Object.keys(inst)) { const a = inst[k]; if (!a) continue; rows.push({ id: k, keys: Object.keys(a).slice(0, 14), playing: a.isPlaying === undefined ? undefined : a.isPlaying, gain: a.gain && a.gain.gain ? +a.gain.gain.value : undefined, loop: a.source ? !!a.source.loop : undefined }); }
    return { reachable: true, count: rows.length, rows: rows.slice(0, 40), keys: Object.keys(w).slice(0, 24) };
  };
  P.unityKeys = () => ({ wa: typeof window.WEBAudio, ui: typeof window.unityInstance, mod: window.unityInstance && window.unityInstance.Module ? Object.keys(window.unityInstance.Module).filter(k => /audio|fmod|WEB/i.test(k)).slice(0, 20) : null });
})();
