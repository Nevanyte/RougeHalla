/*
 * Paste into the DevTools console of a top-level Unity browser page.
 * Read-only, per-document browser facts only. It does not inspect application globals,
 * storage, DOM text/values, cookies, network traffic, or WebSocket frames.
 *
 * Export with: window.__unityReloadReadinessObserver.export()
 * The returned record is this document's local observation only. It does not identify a
 * match/player or prove resume versus fresh join; record those separately from approved
 * public evidence. A new document must install the observer again.
 */
(() => {
  'use strict';
  if (window.top !== window) throw new Error('reload observer must run in the top-level document');
  const name = '__unityReloadReadinessObserver';
  if (Object.prototype.hasOwnProperty.call(window, name)) {
    if (window[name]?.schema === 'unity-browser-reload-observer/1') return window[name];
    throw new Error('observer namespace already exists');
  }

  const maxEvents = 512;
  const safeCodes = new Set([
    'F5', 'Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight',
  ]);
  const listeners = [];
  const state = {
    schema: 'unity-browser-reload-observer/1',
    documentId: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() :
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    page: {
      timeOriginMs: performance.timeOrigin,
      wallTimeMs: Date.now(),
      performanceNowMs: performance.now(),
      origin: location.origin,
      visibility: document.visibilityState,
      online: navigator.onLine,
      userAgent: navigator.userAgent,
      viewport: {width: innerWidth, height: innerHeight, devicePixelRatio},
      topLevel: true,
      navigationType: performance.getEntriesByType('navigation')[0]?.type ?? 'unknown',
    },
    events: [],
    overflow: false,
    stopped: false,
  };
  const append = event => {
    if (state.stopped) return;
    if (state.events.length >= maxEvents) { state.overflow = true; return; }
    state.events.push({
      ...event,
      wallTimeMs: Date.now(),
      timeOriginMs: performance.timeOrigin,
      performanceNowMs: performance.now(),
    });
  };
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push([target, type, handler, options]);
  };

  listen(document, 'visibilitychange', () => append({kind:'visibilitychange', visibility:document.visibilityState}));
  listen(window, 'focus', () => append({kind:'focus'}));
  listen(window, 'blur', () => append({kind:'blur'}));
  listen(window, 'pageshow', event => append({kind:'pageshow', persisted:!!event.persisted, trusted:!!event.isTrusted}));
  listen(window, 'pagehide', event => append({kind:'pagehide', persisted:!!event.persisted, trusted:!!event.isTrusted}));
  listen(document, 'pointerdown', event => append({kind:'pointerdown', trusted:!!event.isTrusted,
    button:event.button, pointerType:['mouse','pen','touch'].includes(event.pointerType)?event.pointerType:'unknown', clientX:event.clientX, clientY:event.clientY} ), true);
  listen(document, 'pointerup', event => append({kind:'pointerup', trusted:!!event.isTrusted,
    button:event.button, pointerType:['mouse','pen','touch'].includes(event.pointerType)?event.pointerType:'unknown', clientX:event.clientX, clientY:event.clientY} ), true);
  listen(document, 'keydown', event => {
    if (!safeCodes.has(event.code)) return;
    append({kind:'keydown', trusted:!!event.isTrusted, code:event.code,
      ctrl:event.ctrlKey, meta:event.metaKey, shift:event.shiftKey, alt:event.altKey});
  }, true);
  listen(document, 'keyup', event => {
    if (!safeCodes.has(event.code)) return;
    append({kind:'keyup', trusted:!!event.isTrusted, code:event.code,
      ctrl:event.ctrlKey, meta:event.metaKey, shift:event.shiftKey, alt:event.altKey});
  }, true);

  const api = Object.freeze({
    schema:state.schema,
    export() {
      return JSON.parse(JSON.stringify({
        schema:state.schema, documentId:state.documentId,
        page:{...state.page, navigationType:performance.getEntriesByType('navigation')[0]?.type ?? 'unknown'},
        capturedAt:{wallTimeMs:Date.now(),timeOriginMs:performance.timeOrigin,performanceNowMs:performance.now()},
        events:state.events, overflow:state.overflow, stopped:state.stopped,
        scope:'per-document timing/lifecycle/trusted input metadata only; no application or network identity',
      }));
    },
    stop() {
      if (!state.stopped) {
        state.stopped = true;
        for (const [target, type, handler, options] of listeners) target.removeEventListener(type, handler, options);
        listeners.length = 0;
      }
      return this.export();
    },
  });
  Object.defineProperty(window, name, {value:api, enumerable:false, writable:false, configurable:false});
  append({kind:'observer-installed'});
  return api;
})();
