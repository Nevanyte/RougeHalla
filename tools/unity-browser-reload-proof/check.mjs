// Offline allowlisted-metadata consistency checker. No browser, network, storage or gameplay API.
import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const CLIENT_SOURCE = '57e166f46b35fb703e5f3c76914fcc4e8bf3191c';
export const NATIVE_REFERENCE = 'c52e41a633c91f8402e3f68724e9202351d1cdb3';
export const BROWSER_ORIGIN = 'http://localhost:8888';
export const CONTENT = '7a542a13187f034c';
export const CASES = ['arena-reload', 'training-reload', 'stale-owner', 'stale-mode-config', 'expired-seat'];
const HEX64 = /^[a-f0-9]{64}$/, HEX40 = /^[a-f0-9]{40}$/, ID = /^[A-Za-z0-9_-]{1,100}$/;
const STEP_NAMES = new Set(['mode-verified', 'reload-request', 'load-current-owner', 'resume-arena',
  'resume-training', 'rendered-gameplay', 'mismatch-shown', 'expired-shown', 'missing-shown']);
const OBS_EVENTS = new Set(['observer-installed', 'visibilitychange', 'focus', 'blur', 'pageshow',
  'pagehide', 'beforeunload', 'pointerdown', 'pointerup', 'keydown', 'keyup']);
const WIRE_EVENTS = new Set(['game-socket-created', 'hello-send-returned', 'welcome-public-prefix',
  'socket-closed', 'metadata-unavailable']);
const isId = value => typeof value === 'string' && ID.test(value);
function requireValue(ok) { if (!ok) throw new Error('safe metadata schema refused'); }
function object(value, allowed) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  requireValue(Object.keys(value).every(key => allowed.includes(key)));
}
function clocks(row) {
  requireValue([row.wallTimeMs, row.timeOriginMs, row.performanceNowMs].every(Number.isFinite));
  requireValue(row.timeOriginMs > 0 && row.performanceNowMs >= 0);
  requireValue(Math.abs(row.wallTimeMs - row.timeOriginMs - row.performanceNowMs) <= 1000);
}
function documentRow(row) {
  object(row, ['browserContextWitness', 'tabWitness', 'executionContextWitness', 'observer', 'wire']);
  for (const key of ['browserContextWitness', 'tabWitness', 'executionContextWitness']) requireValue(isId(row[key]));
  const o = row.observer;
  object(o, ['schema', 'documentId', 'page', 'capturedAt', 'events', 'overflow', 'stopped', 'scope']);
  requireValue(o.schema === 'unity-browser-reload-observer/1' && isId(o.documentId));
  object(o.page, ['timeOriginMs', 'wallTimeMs', 'performanceNowMs', 'origin', 'visibility', 'online',
    'userAgent', 'viewport', 'topLevel', 'navigationType']);
  clocks(o.page); requireValue(o.page.topLevel === true);
  object(o.capturedAt, ['wallTimeMs', 'timeOriginMs', 'performanceNowMs']); clocks(o.capturedAt);
  requireValue(o.capturedAt.timeOriginMs === o.page.timeOriginMs);
  // No URL query, pathname, input value, arbitrary DOM text or browser storage may enter this format.
  requireValue(typeof o.page.origin === 'string' && o.page.origin.length < 200 &&
    /^https?:\/\/[A-Za-z0-9.[\]:-]+$/.test(o.page.origin));
  requireValue(typeof o.page.userAgent === 'string' && o.page.userAgent.length <= 512);
  object(o.page.viewport, ['width', 'height', 'devicePixelRatio']);
  requireValue(Object.values(o.page.viewport).every(x => Number.isFinite(x) && x > 0));
  requireValue(Array.isArray(o.events) && o.events.length <= 512 && typeof o.overflow === 'boolean');
  for (const e of o.events) {
    object(e, ['kind', 'wallTimeMs', 'timeOriginMs', 'performanceNowMs', 'trusted', 'persisted',
      'visibility', 'button', 'pointerType', 'clientX', 'clientY', 'code', 'ctrl', 'meta', 'shift', 'alt']);
    requireValue(OBS_EVENTS.has(e.kind)); clocks(e);
    requireValue(e.timeOriginMs === o.page.timeOriginMs);
    requireValue(e.performanceNowMs <= o.capturedAt.performanceNowMs);
    if (e.code !== undefined) requireValue(['F5', 'Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown',
      'ArrowLeft', 'ArrowRight', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight'].includes(e.code));
  }
  const w = row.wire;
  object(w, ['schema', 'documentId', 'records', 'overflow', 'installedByThisModule', 'scope']);
  requireValue(w.schema === 'unity-browser-reload-wire/1' && w.documentId === o.documentId);
  requireValue(Array.isArray(w.records) && w.records.length <= 256 && typeof w.overflow === 'boolean');
  for (const e of w.records) {
    object(e, ['schema', 'documentId', 'connection', 'event', 'wallTimeMs', 'timeOriginMs',
      'performanceNowMs', 'protocol', 'resumePresent', 'contentHash', 'matchId', 'playerId', 'wholeFrameValidated']);
    requireValue(e.schema === w.schema && e.documentId === o.documentId && WIRE_EVENTS.has(e.event));
    requireValue(Number.isInteger(e.connection) && e.connection > 0 && e.connection <= 16);
    clocks(e); requireValue(e.timeOriginMs === o.page.timeOriginMs);
    requireValue(e.performanceNowMs <= o.capturedAt.performanceNowMs);
    if (e.event === 'hello-send-returned') requireValue(e.protocol === 18 && typeof e.resumePresent === 'boolean' && e.wholeFrameValidated === false);
    if (e.event === 'welcome-public-prefix') requireValue(e.protocol === 18 && /^[a-f0-9]{16}$/.test(e.contentHash) &&
      /^[a-f0-9]{32}$/.test(e.matchId) && Number.isInteger(e.playerId) && e.playerId > 0 && e.playerId <= 0xffffffff && e.wholeFrameValidated === false);
  }
}

export function template() {
  return {schema:'unity-browser-reload-bundle/1', classification:'not-run',
    clientSource:CLIENT_SOURCE, nativeSource:NATIVE_REFERENCE, artifacts:null, executionReleaseSha256:null,
    cases:[], boundary:'metadata consistency only; actual browser acceptance is reserved to Root review'};
}

export function evaluate(bundle) {
  try {
    object(bundle, ['schema', 'classification', 'clientSource', 'nativeSource', 'artifacts',
      'executionReleaseSha256', 'cases', 'boundary']);
    requireValue(bundle.schema === 'unity-browser-reload-bundle/1');
    requireValue(['not-run', 'synthetic-selftest', 'observed-runtime'].includes(bundle.classification));
    requireValue(HEX40.test(bundle.clientSource) && HEX40.test(bundle.nativeSource));
    requireValue(Array.isArray(bundle.cases) && bundle.cases.length <= CASES.length);
    const open = [], failures = [], results = [];
    if (bundle.classification !== 'observed-runtime') open.push('no actual released browser execution');
    if (bundle.boundary !== 'metadata consistency only; actual browser acceptance is reserved to Root review')
      requireValue(false);
    if (bundle.clientSource !== CLIENT_SOURCE) failures.push('client source differs from the reviewed composition');
    if (bundle.nativeSource !== NATIVE_REFERENCE) failures.push('native source differs from the reviewed reference');
    if (!HEX64.test(bundle.executionReleaseSha256 ?? '')) open.push('Root execution release receipt absent');
    if (bundle.artifacts === null) open.push('coherent build/runtime prerequisite receipts absent');
    else {
      const a = bundle.artifacts;
      const hashes = ['webResourceManifestSha256', 'webSourceManifestSha256', 'serverBinarySha256',
        'serverSourceManifestSha256', 'sourceMapSha256', 'native98ReceiptSha256', 'layoutReceiptSha256',
        'runtimeCommandReceiptSha256', 'versionSourcePinsSha256'];
      object(a, [...hashes, 'protocol', 'contentHash', 'arenaInfoContentHash', 'trainingInfoContentHash',
        'tickHz', 'graceMs', 'clockMode', 'cacheCondition']);
      if (!hashes.every(k => HEX64.test(a[k] ?? ''))) open.push('one or more prerequisite receipts absent');
      if (a.protocol !== 18 || a.contentHash !== CONTENT || a.arenaInfoContentHash !== CONTENT ||
          a.trainingInfoContentHash !== CONTENT) failures.push('artifact/server/public identity mismatch');
      if (a.tickHz !== 20 || a.graceMs !== 10000 || a.clockMode !== 'real-wall-clock') failures.push('runtime timing changed');
      if (a.cacheCondition !== 'ordinary-warm-reload') open.push('reload cache condition is outside the bounded plan');
    }
    const seen = new Set();
    for (const c of bundle.cases) {
      object(c, ['id', 'documents', 'steps', 'serverGrace']);
      requireValue(CASES.includes(c.id) && !seen.has(c.id)); seen.add(c.id);
      requireValue(Array.isArray(c.documents) && c.documents.length === 2);
      c.documents.forEach(documentRow);
      requireValue(Array.isArray(c.steps) && c.steps.length <= 20);
      for (const s of c.steps) {
        object(s, ['kind', 'documentId', 'wallTimeMs', 'screenshotSha256', 'trustedEventIndex']);
        requireValue(STEP_NAMES.has(s.kind) && isId(s.documentId) && Number.isFinite(s.wallTimeMs));
        requireValue(HEX64.test(s.screenshotSha256));
        requireValue(c.documents.some(d => d.observer.documentId === s.documentId));
      }
      const [before, after] = c.documents, bo = before.observer, ao = after.observer;
      const bad = [], missing = [];
      if (before.browserContextWitness !== after.browserContextWitness || before.tabWitness !== after.tabWitness)
        bad.push('tab or browser context replaced; tab-local persistence not tested');
      if (before.executionContextWitness === after.executionContextWitness || bo.documentId === ao.documentId ||
          bo.page.timeOriginMs === ao.page.timeOriginMs) bad.push('fresh document/context not established');
      if (bo.page.origin !== ao.page.origin) bad.push('origin changed');
      if (bo.page.origin !== BROWSER_ORIGIN || ao.page.origin !== BROWSER_ORIGIN)
        bad.push('browser origin differs from the expected local Unity origin');
      if (ao.page.navigationType !== 'reload') bad.push('reload navigation not observed');
      if ([bo, ao].some(o => o.overflow || o.events.some(e => e.kind === 'pageshow' && e.persisted))) bad.push('overflow or restored document');
      if (c.documents.some(d => d.wire.overflow || d.wire.records.some(e => e.event === 'metadata-unavailable')))
        bad.push('wire metadata unavailable/overflow');
      const rows = d => d.wire.records;
      const hello = d => rows(d).filter(e => e.event === 'hello-send-returned');
      const welcome = d => rows(d).filter(e => e.event === 'welcome-public-prefix');
      const bh = hello(before), bw = welcome(before), ah = hello(after), aw = welcome(after);
      if (bh.length !== 1 || bh[0]?.resumePresent !== false || bw.length !== 1) bad.push('initial ordinary join evidence missing or ambiguous');
      if (bh[0] && bw[0] && (bh[0].connection !== bw[0].connection || bh[0].performanceNowMs > bw[0].performanceNowMs))
        bad.push('initial Hello/Welcome connection or ordering mismatch');
      if ([...bw, ...aw].some(e => e.contentHash !== CONTENT)) bad.push('received content identity mismatch');
      const step = (kind, doc) => c.steps.find(s => s.kind === kind && s.documentId === doc.documentId);
      const initial = step('mode-verified', bo), reload = step('reload-request', bo), loaded = step('load-current-owner', ao);
      const resume = step(c.id === 'training-reload' || c.id === 'stale-mode-config' ? 'resume-training' : 'resume-arena', ao);
      if (!initial || !reload || !loaded || !resume) missing.push('ordinary setup/reload/LOAD/explicit Resume screenshot steps');
      if (initial && reload && initial.wallTimeMs > reload.wallTimeMs) bad.push('reload preceded natural mode confirmation');
      if (initial && bw[0] && initial.wallTimeMs < bw[0].wallTimeMs) bad.push('initial mode evidence preceded Welcome');
      if (loaded && resume && loaded.wallTimeMs > resume.wallTimeMs) bad.push('Resume preceded LOAD');
      let resumePointer = null;
      if (resume) {
        const input = ao.events[resume.trustedEventIndex];
        if (!input || input.kind !== 'pointerup' || input.trusted !== true ||
            Math.abs(input.wallTimeMs - resume.wallTimeMs) > 1000) missing.push('trusted Resume pointer event/screenshot correlation');
        else resumePointer = input;
        if (resumePointer && rows(after).some(e => e.event === 'game-socket-created' &&
            e.performanceNowMs < resumePointer.performanceNowMs)) bad.push('game connection before trusted Resume pointer');
      }
      const positive = c.id.endsWith('-reload');
      let reloadWindowMs = null, resumePointerToWelcomeMs = null;
      if (positive) {
        if (ah.length !== 1 || ah[0]?.resumePresent !== true || aw.length !== 1) bad.push('explicit resume missing/ambiguous or fresh-join fallback observed');
        if (ah[0] && aw[0] && (ah[0].connection !== aw[0].connection || ah[0].performanceNowMs > aw[0].performanceNowMs))
          bad.push('resumed Hello/Welcome connection or ordering mismatch');
        if (bw[0] && aw[0] && (bw[0].matchId !== aw[0].matchId || bw[0].playerId !== aw[0].playerId)) bad.push('public match/player changed');
        if (resumePointer && ah[0] && ah[0].performanceNowMs < resumePointer.performanceNowMs)
          bad.push('Hello before trusted Resume pointer');
        if (resumePointer && aw[0]) resumePointerToWelcomeMs = aw[0].performanceNowMs - resumePointer.performanceNowMs;
        const rendered = step('rendered-gameplay', ao);
        const verifiedMode = step('mode-verified', ao);
        if (!rendered || !verifiedMode) missing.push('ordinary verified-mode HUD and rendered gameplay evidence');
        if (rendered && aw[0] && rendered.wallTimeMs < aw[0].wallTimeMs) bad.push('rendered evidence preceded received Welcome');
        if (verifiedMode && aw[0] && verifiedMode.wallTimeMs < aw[0].wallTimeMs)
          bad.push('resumed mode evidence preceded Welcome');
        if (verifiedMode && rendered && verifiedMode.wallTimeMs > rendered.wallTimeMs)
          bad.push('rendered evidence preceded resumed mode verification');
        if (reload && aw[0]) {
          reloadWindowMs = aw[0].wallTimeMs - reload.wallTimeMs;
          if (reloadWindowMs <= 0 || reloadWindowMs >= 10000) bad.push('reload-to-Welcome window outside default 10s');
        }
      } else if (c.id === 'expired-seat') {
        if (ah.length !== 1 || ah[0]?.resumePresent !== true || aw.length) bad.push('expired attempt missing or fresh/accepted fallback observed');
        if (!step('expired-shown', ao)) missing.push('typed expiry UI evidence');
        // This does not invent an exact server Away timestamp from browser unload timing.
        if (!c.serverGrace) missing.push('credential-free server Away/expiry corroboration for exact grace claim');
      } else {
        if (rows(after).some(e => e.event === 'game-socket-created') || ah.length || aw.length)
          bad.push('mismatched saved context created a game connection');
        if (!step('mismatch-shown', ao)) missing.push('owned-profile/mode mismatch UI evidence');
      }
      if (c.serverGrace !== null && c.serverGrace !== undefined) {
        object(c.serverGrace, ['sourceReceiptSha256', 'awayObservedWallMs', 'backOrGoneObservedWallMs', 'remainingAtAwayMs', 'result']);
        requireValue(HEX64.test(c.serverGrace.sourceReceiptSha256));
        requireValue(Number.isFinite(c.serverGrace.awayObservedWallMs) && Number.isFinite(c.serverGrace.backOrGoneObservedWallMs));
        requireValue(Number.isFinite(c.serverGrace.remainingAtAwayMs) && c.serverGrace.remainingAtAwayMs >= 0 && c.serverGrace.remainingAtAwayMs <= 10000);
        requireValue(['back', 'grace-expired'].includes(c.serverGrace.result));
        const delta = c.serverGrace.backOrGoneObservedWallMs - c.serverGrace.awayObservedWallMs;
        if (delta < 0) bad.push('server corroboration observation ordering');
        if (c.id === 'expired-seat' && (c.serverGrace.result !== 'grace-expired' || delta < c.serverGrace.remainingAtAwayMs))
          bad.push('server expiry corroboration is inconsistent with remaining grace');
        if (positive && (c.serverGrace.result !== 'back' || delta >= c.serverGrace.remainingAtAwayMs))
          bad.push('server Back corroboration exceeds sampled remaining grace');
      }
      results.push({id:c.id, status:bad.length ? 'FAIL' : missing.length ? 'OPEN' : 'CONSISTENT_FOR_REVIEW',
        failures:bad, open:missing, browserReloadWindowMs:reloadWindowMs, resumePointerToWelcomeMs,
        serverAwayInterval:'only separately supplied public corroboration; browser interval is not server Away duration'});
    }
    for (const id of CASES) if (!seen.has(id)) open.push(`case not recorded: ${id}`);
    failures.push(...results.filter(c => c.status === 'FAIL').map(c => c.id));
    open.push(...results.filter(c => c.status === 'OPEN').map(c => c.id));
    return {schema:'unity-browser-reload-check/1', status:failures.length ? 'FAIL' : open.length ? 'OPEN' : 'READY_FOR_ROOT_REVIEW',
      browserAcceptance:'NOT_GRANTED_BY_COLLECTOR', classification:bundle.classification,
      failures, open, cases:results, limits:'input receipts/claims still need Root authenticity and rendered-UI review; no raw wire or storage accepted'};
  } catch (_) {
    return {schema:'unity-browser-reload-check/1', status:'REFUSED', browserAcceptance:'NOT_GRANTED_BY_COLLECTOR',
      reason:'Input is not the bounded allowlisted metadata format. No rejected values were logged.'};
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, input, output] = process.argv.slice(2);
  if (command === 'template' && input) writeFileSync(input, JSON.stringify(template(), null, 2) + '\n', {flag:'wx'});
  else if (command === 'check' && input) {
    const raw = readFileSync(input); requireValue(raw.length <= 2 * 1024 * 1024);
    let report;
    try { report = evaluate(JSON.parse(raw)); } catch (_) { report = {status:'REFUSED', reason:'Invalid allowlisted metadata input'}; }
    const text = JSON.stringify(report, null, 2) + '\n';
    if (output) writeFileSync(output, text, {flag:'wx'}); else process.stdout.write(text);
    process.exitCode = report.status === 'READY_FOR_ROOT_REVIEW' ? 0 : 2;
  } else throw new Error('Use: check.mjs template NEW.json | check.mjs check SAFE.json [NEW-report.json]');
}
