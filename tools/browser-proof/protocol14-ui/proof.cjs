#!/usr/bin/env node
'use strict';

// Actual frozen Unity player. Actions enter only through canvas/DOM keyboard/mouse.
// The protocol block below is reused solely as an independent passive decoder.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { PIN, REQUIRED_CHECKS, evaluateReport } = require('./contract.cjs');
const repo = path.resolve(__dirname, '../../..');
const args = process.argv.slice(2);
const option = (key, fallback) => { const at = args.indexOf(key); return at < 0 ? fallback : args[at + 1]; };
const artifactBase = option('--artifact-base', path.join(os.homedir(), '.codex/tools/rougehalla-unity-art/builds/protocol14-a3d4b3ce'));
const serverBin = option('--server-bin', path.join(os.homedir(), '.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/cold-restore-a3d4b3ce-2026-11-09/bin/rh-server-a3d4b3ce'));
const output = path.resolve(option('--output', ''));
const privateState = path.resolve(option('--private-state', ''));
if (!args.includes('--output') || !args.includes('--private-state') || output === privateState || output.startsWith(privateState + path.sep))
  throw Error('Separate explicit --output and --private-state paths are required');
if (fs.existsSync(output)) throw Error('Use a fresh output directory; predecessor evidence must be retained');
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(privateState, { recursive: true, mode: 0o700 }); fs.chmodSync(privateState, 0o700);
try {
  if (execFileSync('git', ['-C', privateState, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true')
    throw Error('Private state must be outside every Git worktree');
} catch (error) { if (error.message === 'Private state must be outside every Git worktree') throw error; }
const privateWrite = (name, data) => { fs.writeFileSync(path.join(privateState, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const secrets = new Set();
let ownerToken = null;
const redact = value => {
  let text = String(value);
  for (const secret of secrets) if (secret) text = text.split(secret).join('[REDACTED]');
  return text.replace(/([?&](?:token|ticket|resume|session|key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[PRIVATE_DATABASE_URL]');
};
const write = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2) + '\n');
const manifestBytes = fs.readFileSync(path.join(artifactBase, 'artifact-manifest.json'));
const manifest = JSON.parse(manifestBytes);
const artifactRoot = path.join(artifactBase, 'Web');
function verifyArtifact() {
  if (sha(manifestBytes) !== PIN.artifactManifestSha256 || manifest.source !== PIN.source || manifest.protocol !== 14 ||
      manifest.bakedHash !== PIN.contentHash || manifest.fileCount !== 14 || manifest.artifactBytes !== 106765469)
    throw Error('Frozen artifact manifest identity mismatch');
  let bytes = 0;
  for (const item of manifest.files) {
    if (path.isAbsolute(item.path) || item.path.split('/').includes('..')) throw Error('Unsafe artifact path');
    const data = fs.readFileSync(path.join(artifactRoot, item.path));
    if (data.length !== item.bytes || sha(data) !== item.sha256) throw Error('Frozen artifact bytes differ: ' + item.path);
    bytes += data.length;
  }
  if (manifest.files.length !== 14 || bytes !== 106765469) throw Error('Incomplete artifact');
  return { manifestSha256: sha(manifestBytes), fileCount: 14, verifiedFiles: 14, bytes, unchangedAfter: false,
    buildId: manifest.buildId, unity: manifest.unity, compression: manifest.compression, development: manifest.development };
}
const report = {
  schema: PIN.schema, startedUtc: new Date().toISOString(),
  identities: { source: PIN.source, protocol: 14, contentHash: PIN.contentHash,
    artifact: verifyArtifact(), server: { sha256: sha(fs.readFileSync(serverBin)) }, browser: {}, resolution: {} },
  policy: { ordinary: true, diagnostic: false, syntheticProfilesOnly: true, noWorldInjection: true, privateWorldHooks: false },
  checks: Object.fromEntries(REQUIRED_CHECKS.map(name => [name, { status: 'OPEN', reason: 'Not reached' }])),
  errors: { pageErrors: [], unityErrors: [], observerErrors: [] }, screenshots: [], console: [],
  http: [], loadedArtifactResponses: [], frames: { sent: 0, received: 0, snapshots: 0 },
  hellos: [], welcomes: [], commands: [], phases: [], collectionsKeys: [], runtimeEvents: [],
  cleanup: { browserClosed: false, serverStopped: false, postgresStopped: false, noOwnedListeners: false },
  limits: { planningJ: false, engine25: false, performance: false, completeMatchBanking: false },
};
try {
  const hardware = JSON.parse(execFileSync('system_profiler', ['SPHardwareDataType', '-json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).SPHardwareDataType[0];
  report.identities.host = { platform: process.platform, arch: process.arch, chip: hardware.chip_type, model: hardware.machine_name, memory: hardware.physical_memory };
} catch { report.identities.host = { platform: process.platform, arch: process.arch, hardwareQueryUnavailable: true }; }
if (report.identities.server.sha256 !== PIN.serverSha256) throw Error('Pinned server binary mismatch');
const provenance = json(path.join(artifactBase, 'provenance.json'));
const handoff = json(path.join(artifactBase, 'HANDOFF.json'));
if (handoff.source !== PIN.source || handoff.protocol !== 14 || provenance.sourceCommit !== PIN.source || provenance.development !== false)
  throw Error('Build provenance mismatch');
report.identities.buildProvenance = { sha256: sha(fs.readFileSync(path.join(artifactBase, 'provenance.json'))), handoffSha256: sha(fs.readFileSync(path.join(artifactBase, 'HANDOFF.json'))), unity: provenance.unity, buildId: provenance.buildId, development: false };
const probe = fs.readFileSync(path.join(repo, 'crates/rh-server/web/probe.html'), 'utf8');
const decoder = probe.slice(probe.indexOf('// ---- protocol v14'), probe.indexOf('// ---- probe state'));
if (!decoder.includes('const PROTOCOL = 14;')) throw Error('Passive decoder is not protocol14');
const { Tracker, decode, decodeClient } = new Function(decoder + ';return {Tracker, decode, decodeClient};')();
report.identities.passiveDecoder = { source: PIN.source, path: 'crates/rh-server/web/probe.html', blockSha256: sha(Buffer.from(decoder)), applicationFramesSentByObserver: 0 };
const playwrightPath = option('--playwright', path.join(os.homedir(), '.codex/tools/rougehalla-stage2/browser/node_modules/playwright'));
const { chromium } = require(playwrightPath);
let runtime, runtimeProcess, browser, context, page, latest, inputProbe = null, collections = new Map(), currentStep = 'runtime';
const responses = [];
const check = (name, passed, evidence) => { report.checks[name] = { status: passed ? 'PASS' : 'FAIL', ...evidence }; checkpoint(name); };
const checkpoint = step => { write('progress.json', { step, at: new Date().toISOString(), checks: report.checks, frames: report.frames }); console.log(JSON.stringify({ step, at: new Date().toISOString() })); };
const requireTrue = (value, reason) => { if (!value) throw Error(reason); };
const wait = async (test, milliseconds = 15000) => { const stop = Date.now() + milliseconds; while (Date.now() < stop) { if (test()) return true; await sleep(50); } return !!test(); };
const point = (x, y, panel = [0, 0, 1, 1]) => ({ x: (panel[0] + x * (panel[2] - panel[0])) * 2560, y: (1 - panel[1] - y * (panel[3] - panel[1])) * 1440 });
async function click(x, y, panel) { const p = point(x, y, panel); await page.mouse.click(p.x, p.y, { delay: 60 }); await sleep(200); }
async function key(name, milliseconds = 100) { await page.keyboard.down(name); await sleep(milliseconds); await page.keyboard.up(name); await sleep(150); }
async function heartbeat() {
  return page.evaluate(() => ({ ...window.__rhWeb14.render, trace: { ...window.__rhWeb14.trace },
    canvas: { width: document.querySelector('#unity-canvas').width, height: document.querySelector('#unity-canvas').height } }));
}
async function screenshot(name, details = {}) {
  const relative = name + '.png', file = path.join(output, relative);
  const bytes = await page.screenshot({ path: file });
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  requireTrue(width === 2560 && height === 1440, 'Screenshot backbuffer/viewport mismatch');
  report.screenshots.push({ path: relative, sha256: sha(bytes), bytes: bytes.length, width, height,
    heartbeat: await heartbeat(), server: latest ? { tick: latest.tick, serverMs: latest.serverMs, phase: latest.phase } : null, ...details });
  checkpoint(name);
}
function observeBrowser() {
  page.on('pageerror', error => report.errors.pageErrors.push(redact(error)));
  page.on('console', message => {
    const text = redact(message.text());
    if (report.console.length < 400) report.console.push({ type: message.type(), text });
    if (message.type() === 'error' || /(?:Exception|Assertion failed|Shader error|abort\(|RuntimeError)/i.test(text)) report.errors.unityErrors.push(text);
  });
  page.on('response', response => {
    const task = (async () => {
      const target = new URL(response.url());
      if (target.origin === runtime.serverOrigin && target.pathname.startsWith('/api/')) {
        const record = { path: target.pathname, method: response.request().method(), status: response.status(), at: Date.now() };
        if (target.pathname.startsWith('/api/profile/') && response.status() === 200) {
          const data = await response.json();
          if (typeof data.token === 'string') { ownerToken = data.token; secrets.add(ownerToken); privateWrite('observed-secrets.json', [...secrets]); }
          record.profileName = data.profile?.name; record.created = data.created; record.ownerCredentialReceived = !!data.token;
        }
        report.http.push(record);
      }
      if (target.origin === runtime.pageOrigin && target.pathname.startsWith('/Build/') && response.status() === 200) {
        const name = target.pathname.slice(1); const expected = manifest.files.find(item => item.path === name);
        // Large Unity bodies may be evicted from the inspector cache. Join the actual
        // browser request identity to the owned host's hashed byte-stream audit instead.
        if (expected) report.loadedArtifactResponses.push({ path: name, status: 200, method: response.request().method(), contentType: response.headers()['content-type'] });
      }
    })().catch(error => report.errors.observerErrors.push(redact(error)));
    responses.push(task);
  });
  page.on('websocket', socket => {
    const tracker = new Tracker();
    socket.on('framesent', frame => {
      report.frames.sent++;
      try {
        const raw = Buffer.isBuffer(frame.payload) ? frame.payload : Buffer.from(frame.payload, 'base64');
        const message = decodeClient(Uint8Array.from(raw).buffer);
        if (message.t === 'hello') report.hellos.push({ protocol: message.protocol, contentHash: message.contentHash.toString(16), profile: message.profile, build: message.build, faction: message.faction, resumed: !!message.resume, credentialMatchesOwnedHttpResponse: !!ownerToken && Buffer.from(message.ticket).toString('utf8') === ownerToken, at: Date.now() });
        if (message.t === 'input') for (const command of message.cmds) if (command.k !== 'aim') report.commands.push({ ...command, inputFrame: message.seq, at: Date.now() });
      } catch (error) { report.errors.observerErrors.push('client: ' + redact(error)); }
    });
    socket.on('framereceived', frame => {
      report.frames.received++;
      try {
        const raw = Buffer.isBuffer(frame.payload) ? frame.payload : Buffer.from(frame.payload, 'base64');
        const message = decode(Uint8Array.from(raw).buffer);
        if (message.t === 'welcome') {
          secrets.add(Buffer.from(message.session).toString('hex')); secrets.add(Buffer.from(message.session).toString('base64'));
          privateWrite('observed-secrets.json', [...secrets]);
          report.welcomes.push({ protocol: message.protocol, contentHash: message.content.toString(16), player: message.player, tick: message.tick, map: { width: message.map.w, height: message.map.h, collisionHash: message.map.hash, groundVersion: message.map.ground?.version ?? null }, matchIdentitySha256: sha(Buffer.from(message.match)), at: Date.now() });
        }
        const applied = tracker.apply(message);
        if (message.t === 'state') { collections = tracker.collections; report.collectionsKeys = [...collections.keys()].sort((a, b) => a - b); }
        if (applied?.t === 'snapshot') {
          latest = applied; report.frames.snapshots++; if (!report.phases.includes(latest.phase)) report.phases.push(latest.phase);
          if (inputProbe && latest.me && inputProbe.length < 200) inputProbe.push({ tick: latest.tick, serverMs: latest.serverMs, x: latest.me.x, y: latest.me.y, moveSeq: latest.me.moveSeq, status: latest.me.status });
        }
        if (message.t === 'reject') report.errors.unityErrors.push('Server rejection: ' + redact(message.reason));
      } catch (error) { report.errors.observerErrors.push('server: ' + redact(error)); }
    });
  });
}

(async () => {
  try {
    checkpoint('artifact-verified');
    runtimeProcess = spawn('python3', [path.join(__dirname, 'runtime.py'), 'run', '--private-state', privateState, '--repo', repo, '--server-bin', serverBin, '--artifact', artifactRoot], { stdio: ['ignore', 'pipe', 'pipe'] });
    const privateRuntimeLog = fs.openSync(path.join(privateState, 'supervisor.log'), 'a', 0o600);
    runtimeProcess.stdout.on('data', data => { fs.writeSync(privateRuntimeLog, data); for (const line of data.toString().split('\n')) try { report.runtimeEvents.push(JSON.parse(line)); } catch {} });
    runtimeProcess.stderr.on('data', data => fs.writeSync(privateRuntimeLog, data));
    requireTrue(await wait(() => fs.existsSync(path.join(privateState, 'runtime.json')) || runtimeProcess.exitCode !== null, 75000), 'Local runtime readiness timed out');
    requireTrue(fs.existsSync(path.join(privateState, 'runtime.json')), 'Local runtime failed before readiness; private logs retained');
    runtime = json(path.join(privateState, 'runtime.json')); secrets.add(runtime.claimPasscode); secrets.add(runtime.databaseUrl); privateWrite('observed-secrets.json', [...secrets]);
    report.identities.server.info = await fetch(runtime.serverOrigin + '/info').then(response => response.json());
    requireTrue(report.identities.server.info.protocol === 14 && report.identities.server.info.contentHash === PIN.contentHash, 'Live server /info does not match frozen build');
    report.identities.server.ownership = { supervisorPid: runtimeProcess.pid, serverPid: runtime.serverPid, postgresPid: runtime.postgresPid, serverPort: runtime.serverPort, postgresPort: runtime.postgresPort, staticPort: runtime.staticPort };
    checkpoint('local-services-ready');
    currentStep = 'menu';
    browser = await chromium.launch({ headless: args.includes('--headless'), args: ['--enable-gpu', '--use-angle=metal', '--window-size=2560,1440'] });
    context = await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    report.identities.browser = { version: await browser.version(), playwright: require(path.join(playwrightPath, 'package.json')).version, executable: chromium.executablePath(), headless: args.includes('--headless'), renderer: 'not-observed-yet', performanceAcceptance: false };
    await page.addInitScript(() => {
      const state = window.__rhWeb14 = { sockets: [], render: { drawCalls: 0, drawnRafs: 0, rafCallbacks: 0, renderer: null, vendor: null }, trace: { frameStartCount: 0, firstFrame: null, lastFrame: null, presentedCount: 0 } };
      window.__rhLatency = { recording: true, events: [] };
      setInterval(() => { for (const event of window.__rhLatency.events.splice(0)) { if (event.kind === 'frameStart') { state.trace.frameStartCount++; state.trace.firstFrame ??= event.frame; state.trace.lastFrame = event.frame; } if (event.kind === 'presentSelf') state.trace.presentedCount++; } }, 100);
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = new Proxy(NativeWebSocket, { construct(target, parameters) { const socket = Reflect.construct(target, parameters); state.sockets.push(socket); return socket; } });
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...parameters) {
        const gl = getContext.call(this, type, ...parameters);
        if (this.id === 'unity-canvas' && gl && type === 'webgl2' && !state.render.renderer) {
          const debug = gl.getExtension('WEBGL_debug_renderer_info');
          state.render.renderer = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
          state.render.vendor = gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
          for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) { const original = gl[name]; gl[name] = function(...values) { state.render.drawCalls++; return original.apply(gl, values); }; }
        }
        return gl;
      };
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => raf(time => { const before = state.render.drawCalls; state.render.rafCallbacks++; try { return callback(time); } finally { if (state.render.drawCalls > before) state.render.drawnRafs++; } });
    });
    observeBrowser();
    const url = new URL(runtime.pageOrigin); url.searchParams.set('server', runtime.websocketUrl); url.searchParams.set('accountApi', runtime.accountApi);
    report.pageUrl = url.toString();
    await page.goto(url.toString());
    await page.locator('#unity-loading-bar').waitFor({ state: 'hidden', timeout: 120000 });
    await sleep(5000);
    await page.locator('#unity-canvas').focus();
    const initialHeartbeat = await heartbeat();
    report.identities.browser.renderer = initialHeartbeat.renderer || 'not-observed';
    report.identities.browser.vendor = initialHeartbeat.vendor;
    report.identities.resolution = { width: 2560, height: 1440, canvasWidth: initialHeartbeat.canvas.width, canvasHeight: initialHeartbeat.canvas.height };
    await screenshot('01-menu');
    check('menu', report.hellos.length === 0 && report.frames.sent === 0 && initialHeartbeat.drawCalls > 0, { nativeCanvas: true, noSocketBeforeJoin: report.hellos.length === 0, screenshot: '01-menu.png' });
    currentStep = 'profile';
    const menu = [.015, .17, .35, .91], signin = [.26, .27, .74, .80];
    const profile = 'ui14' + Date.now().toString(36); report.syntheticProfile = profile;
    await click(.37, .765, menu); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A'); await page.keyboard.type(profile, { delay: 25 });
    await click(.73, .23, menu); await click(.5, .26, signin); await page.keyboard.type(runtime.claimPasscode, { delay: 4 }); await click(.27, .0975, signin);
    await click(.825, .765, menu);
    requireTrue(await wait(() => report.http.some(response => response.ownerCredentialReceived), 15000), 'Ordinary profile HTTP load/claim did not return ownership');
    await sleep(500); await screenshot('02-owned-profile');
    check('profile', report.http.some(response => response.ownerCredentialReceived && response.profileName?.toLowerCase() === profile), { profile, calls: report.http.slice(), screenshot: '02-owned-profile.png', noFakeResponses: true });
    currentStep = 'ordinaryJoin';
    await click(.27, .23, menu); await click(.5, .1125, menu);
    requireTrue(await wait(() => latest?.me && report.welcomes.length > 0 && report.collectionsKeys.length === 11, 30000), 'No ordinary Unity Join/authoritative self/all11 collections');
    const hello = report.hellos[0], welcome = report.welcomes[0];
    check('ordinaryJoin', hello.protocol === 14 && hello.contentHash === PIN.contentHash && hello.profile === profile && hello.credentialMatchesOwnedHttpResponse && hello.faction === 4 && welcome.protocol === 14 && welcome.contentHash === PIN.contentHash, { hello, welcome, diagnostic: false, all11Collections: report.collectionsKeys });
    const startTick = latest.tick, startTime = latest.serverMs, startCount = report.frames.snapshots;
    requireTrue(await wait(() => report.frames.snapshots >= startCount + 5 && latest.tick > startTick && latest.serverMs > startTime), 'Authoritative source frames did not advance');
    check('authoritativeSnapshots', true, { before: { tick: startTick, serverMs: startTime }, after: { tick: latest.tick, serverMs: latest.serverMs }, snapshots: report.frames.snapshots });
    report.checks.planning = { status: 'OPEN', reason: 'Pinned public server profile has lifecycle Off and quests false; no public planning activation was added or injected.', observedPhases: report.phases };
    requireTrue(await wait(() => latest?.phase === 1 && latest?.me?.status === 1, 30000), 'No live active owner before input/UI checks');
    currentStep = 'authoritativeInput';
    const beforeMove = { ...latest.me }, commandStart = report.commands.length;
    const inputStartTick = latest.tick; inputProbe = [];
    await page.mouse.move(point(.4, .5).x, point(.4, .5).y); await key('d', 650);
    await wait(() => latest.me && (latest.me.x !== beforeMove.x || latest.me.y !== beforeMove.y), 3000);
    if (latest.me && latest.me.x === beforeMove.x && latest.me.y === beforeMove.y) { await key('w', 650); await sleep(400); }
    const afterMove = { ...latest.me }, sentMoves = report.commands.slice(commandStart).filter(command => command.k === 'move');
    const sourceEchoes = inputProbe; inputProbe = null;
    const matchedMoveSamples = sourceEchoes.filter(sample => sample.tick > inputStartTick && sentMoves.some(command => command.seq === sample.moveSeq) && (sample.x !== beforeMove.x || sample.y !== beforeMove.y));
    const sentStops = report.commands.slice(commandStart).filter(command => command.k === 'stop');
    check('authoritativeInput', sentMoves.length > 0 && matchedMoveSamples.length > 0, { method: 'Real canvas keyboard; changed-pose intermediate Rust self sample must echo a transmitted move sequence', before: beforeMove, after: afterMove, sentMoves, sentStops, sourceEchoes, matchedMoveSamples, finalStopEcho: sentStops.some(command => command.seq === afterMove.moveSeq) });
    await screenshot('03-active-hud');
    report.checks.hud = { status: 'OPEN', reason: 'Actual screenshot produced; visual inspection required', screenshot: '03-active-hud.png', actualOwner: { hp: latest.me.hp, maxHp: latest.me.maxHp, moveSeq: latest.me.moveSeq } };
    currentStep = 'reconnect';
    const welcomeBefore = report.welcomes.length, playerBefore = report.welcomes.at(-1).player, priorMatch = report.welcomes.at(-1).matchIdentitySha256;
    requireTrue(await page.evaluate(() => { const socket = window.__rhWeb14.sockets.findLast(socket => socket.readyState === WebSocket.OPEN); if (!socket) return false; socket.close(1000, 'Owned browser transport interruption'); return true; }), 'No Unity-created socket to interrupt');
    await sleep(200); await screenshot('04-reconnecting');
    requireTrue(await wait(() => report.welcomes.length > welcomeBefore && report.hellos.at(-1).resumed, 20000), 'Unity did not resume its actual socket');
    check('reconnect', report.welcomes.at(-1).player === playerBefore && report.welcomes.at(-1).matchIdentitySha256 === priorMatch && report.hellos.at(-1).credentialMatchesOwnedHttpResponse, { beforeWelcomeCount: welcomeBefore, afterWelcomeCount: report.welcomes.length, resumedHello: report.hellos.at(-1), welcome: report.welcomes.at(-1) });
    await sleep(500); await screenshot('05-resumed-hud');
    currentStep = 'help';
    let commandBefore = report.commands.length;
    await key('h'); await screenshot('06-help');
    await key('w', 250); await key('h');
    const helpCommands = report.commands.slice(commandBefore).filter(command => ['move', 'plan', 'attack', 'target', 'pickup'].includes(command.k));
    report.checks.help = { status: 'OPEN', reason: 'Rendered open/close captures require visual inspection', screenshot: '06-help.png', unintendedWorldCommands: helpCommands, noWorldCommands: helpCommands.length === 0 };
    currentStep = 'journalActive';
    commandBefore = report.commands.length;
    await key('j'); await screenshot('07-active-journal');
    await key('w', 250); await key('j');
    const journalCommands = report.commands.slice(commandBefore).filter(command => ['move', 'plan', 'attack', 'target', 'pickup'].includes(command.k));
    report.checks.journalActive = { status: 'OPEN', reason: 'Actual current-build active journal capture requires visual inspection', screenshot: '07-active-journal.png', noWorldCommands: journalCommands.length === 0, unintendedWorldCommands: journalCommands, planningJIncluded: false };
    currentStep = 'drawer';
    const drawer = [.57, .025, .985, .975];
    await key('b'); await screenshot('08-drawer-top');
    await click(.255, .62, drawer); await screenshot('09-drawer-first-selection');
    const wheel = point(.5, .49, drawer); await page.mouse.move(wheel.x, wheel.y); await page.mouse.wheel(0, 25000); await sleep(800); await screenshot('10-drawer-scrolled');
    await click(.255, .36, drawer); await screenshot('11-drawer-scrolled-selection');
    await click(.255, .235, drawer); await screenshot('12-drawer-outside-viewport-click');
    await click(.67, .96); await screenshot('13-drawer-hidden-global-help-click');
    await key('Escape'); await click(.67, .96); await screenshot('14-restored-header-help'); await key('h');
    report.checks.drawer = { status: 'OPEN', reason: 'Real routed wheel/click/clipped-area/header captures exist; inspect actual pixels/selection before accepting', screenshots: report.screenshots.filter(shot => /^0[89]-|^1[0-4]-/.test(shot.path)).map(shot => shot.path), noDirectCanvasMethodCalls: true };
    const finalHeartbeat = await heartbeat();
    check('renderHeartbeat', finalHeartbeat.drawnRafs > initialHeartbeat.drawnRafs && finalHeartbeat.trace.lastFrame > finalHeartbeat.trace.firstFrame && finalHeartbeat.trace.presentedCount > 1, { before: initialHeartbeat, after: finalHeartbeat, note: 'Functional advancing-frame observation only; no performance acceptance' });
    report.identities.browser.renderer = finalHeartbeat.renderer || report.identities.browser.renderer;
    report.finalSource = latest ? { tick: latest.tick, serverMs: latest.serverMs, phase: latest.phase, owner: latest.me } : null;
  } catch (error) {
    report.failure = { step: currentStep, message: redact(error.message || error) };
    if (report.checks[currentStep]) report.checks[currentStep] = { status: 'FAIL', reason: report.failure.message };
    if (page) try { await screenshot('failure-' + currentStep); } catch {}
    checkpoint('failed-' + currentStep);
  } finally {
    await Promise.allSettled(responses);
    if (browser) { try { await browser.close(); report.cleanup.browserClosed = true; } catch {} }
    else report.cleanup.browserClosed = true;
    if (runtimeProcess && runtimeProcess.exitCode === null) runtimeProcess.kill('SIGTERM');
    if (runtimeProcess) await wait(() => runtimeProcess.exitCode !== null, 30000);
    const cleanupFile = path.join(privateState, 'cleanup.json');
    if (fs.existsSync(cleanupFile)) {
      const cleanup = json(cleanupFile); report.runtimeCleanup = cleanup;
      report.cleanup.serverStopped = cleanup.server_stopped;
      report.cleanup.postgresStopped = cleanup.postgres_stopped;
      report.cleanup.noOwnedListeners = cleanup.server_port_closed && cleanup.static_port_closed && cleanup.postgres_port_closed && cleanup.static_stopped;
    }
    const hostAudit = path.join(privateState, 'static-responses.jsonl');
    const hostResponses = fs.existsSync(hostAudit) ? fs.readFileSync(hostAudit, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    const requiredBuildAssets = manifest.files.filter(item => item.path.startsWith('Build/'));
    const servedChecks = requiredBuildAssets.map(item => ({ path: item.path,
      browserRequested: report.loadedArtifactResponses.some(response => response.path === item.path && response.status === 200),
      exactBytesServed: hostResponses.some(response => response.path === item.path && response.complete === true && response.status === 200 && response.bytes === item.bytes && response.sha256 === item.sha256) }));
    report.identities.servedArtifact = { method: 'Unchanged owned static-host hashed stream joined to actual browser request URLs/statuses', checks: servedChecks, hostResponses };
    if (page && servedChecks.some(item => !item.browserRequested || !item.exactBytesServed)) report.errors.observerErrors.push('Actual loaded Build request/static-host byte identity was not fully verified');
    try { verifyArtifact(); report.identities.artifact.unchangedAfter = true; } catch (error) { report.artifactPostcheckFailure = redact(error); }
    for (const shot of report.screenshots) { const data = fs.readFileSync(path.join(output, shot.path)); requireTrue(sha(data) === shot.sha256 && data.length === shot.bytes, 'Screenshot changed after capture'); }
    // Scan serialized public text against only this proof's synthetic secrets before publication.
    const serialized = JSON.stringify(report);
    for (const secret of secrets) if (secret && serialized.includes(secret)) throw Error('Public report secret scan failed; private evidence retained');
    report.completedUtc = new Date().toISOString(); report.contract = evaluateReport(report); report.status = report.contract.status;
    write('report.json', report); write('artifact-verification.json', { before: report.identities.artifact, files: manifest.files, unchangedAfter: report.identities.artifact.unchangedAfter });
    console.log(JSON.stringify({ status: report.status, failure: report.failure, contract: report.contract, output, cleanup: report.cleanup }));
    process.exitCode = report.status === 'FAIL' ? 1 : 0;
  }
})();
