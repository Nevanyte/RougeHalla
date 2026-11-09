// LOCAL HTTP ROUTING ONLY: real Caddy, two labelled stub upstreams, no AWS/TLS/native/auth/gameplay claim.
import assert from 'node:assert/strict';
import {createServer, request} from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';

const [binary, adapted] = process.argv.slice(2);
assert(binary && adapted && process.argv.length === 4);
const config = JSON.parse(readFileSync(adapted, 'utf8'));
const server = config.apps.http.servers.srv0;
assert.deepEqual(server.listen, [':443']);
assert.deepEqual(server.routes[0].match, [{host: ['rougehalla.com']}]);
// Test-only transport: exact adapted routes/handlers untouched; disable public ACME/TLS and bind loopback only.
server.listen = ['127.0.0.1:18080'];
server.automatic_https = {disable: true};
config.admin = {disabled: true};
writeFileSync('/tmp/caddy-route-test.json', JSON.stringify(config));
const calls = [];
const upstreams = [];
let child;
function get(path, headers = {}) {
    return new Promise((resolve, reject) => {
        const r = request({hostname: '127.0.0.1', port: 18080, path,
            headers: {host: 'rougehalla.com', ...headers}}, response => {
            let body = ''; response.setEncoding('utf8');
            response.on('data', data => { body += data; });
            response.on('end', () => resolve({status: response.statusCode, body}));
        });
        r.setTimeout(1000, () => r.destroy(new Error('bounded local route timeout')));
        r.on('error', reject); r.end();
    });
}
try {
    for (const [profile, port] of [['source', 7777], ['training', 7779]]) {
        const upstream = createServer((req, res) => {
            const value = {profile, url: req.url, origin: req.headers.origin ?? null,
                token: req.headers['x-profile-token'] ?? null, xff: req.headers['x-forwarded-for']};
            calls.push(value); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value));
        });
        await new Promise((resolve, reject) => { upstream.once('error', reject); upstream.listen(port, '127.0.0.1', resolve); });
        upstreams.push(upstream);
    }
    child = spawn(binary, ['run', '--config', '/tmp/caddy-route-test.json'], {stdio: ['ignore', 'ignore', 'pipe']});
    // Config diagnostics contain no credentials. Keep the local stderr available for a genuine config failure.
    let diagnostics = ''; child.stderr.on('data', d => { diagnostics += d; });
    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt++) {
        if (child.exitCode !== null) throw new Error('Caddy exited: ' + diagnostics);
        try { ready = (await get('/healthz')).status === 200; } catch {}
        if (!ready) await delay(25);
    }
    assert(ready, 'local Caddy must start'); calls.length = 0;
    for (const [path, profile, upstreamPath] of [
        ['/ws?keep=x', 'source', '/ws?keep=x'], ['/training/ws?keep=x', 'training', '/ws?keep=x'],
        ['/api/profile/DeclaredFixture', 'source', '/api/profile/DeclaredFixture'], ['/readyz', 'source', '/readyz'],
        ['/training/healthz', 'training', '/healthz'], ['/training/info', 'training', '/info']]) {
        const result = await get(path, {origin: 'https://rougehalla.com', 'x-profile-token': 'PUBLIC_DECLARED_TEST_TOKEN',
            'x-forwarded-for': '203.0.113.9'});
        assert.equal(result.status, 200);
        const row = JSON.parse(result.body);
        assert.equal(row.profile, profile); assert.equal(row.url, upstreamPath);
        if (!path.startsWith('/training/healthz') && !path.startsWith('/training/info')) {
            assert.equal(row.origin, 'https://rougehalla.com'); assert.equal(row.token, 'PUBLIC_DECLARED_TEST_TOKEN');
            assert.equal(row.xff, '127.0.0.1');
        }
    }
    const before = calls.length;
    for (const path of ['/control/rooms', '/probe', '/training/api/profile/x', '/training/control/rooms', '/training/probe']) {
        assert.equal((await get(path)).status, 404);
    }
    assert.equal(calls.length, before, 'private paths must never reach either upstream');
    console.log(JSON.stringify({pass: true, routed: 6, refused: 5, originTokenPreserved: true,
        spoofedForwardChainDiscarded: true, scope: 'HTTP routing only; no real WS upgrade/native/account/TLS proof'}));
} finally {
    // Close every owned handle even when an assertion or a child shutdown fails.
    const closing = upstreams.map(s => new Promise(resolve => s.close(resolve)));
    if (child && child.exitCode === null) {
        child.kill('SIGTERM');
        let exited = false; child.once('exit', () => { exited = true; });
        for (let n = 0; n < 40 && !exited; n++) await delay(25);
        if (!exited) child.kill('SIGKILL');
    }
    await Promise.all(closing);
}
