// A public protocol-13 actor helper for the live Trophy recipe.
// It uses the server's already-golden-tested /probe browser client and sends
// only ordinary Input commands. The server resolves observer-issued handles,
// calls PublicCommand::resolve/validate, and submits them through Sim::submit.
// This is a test actor, not a Unity client or a source/gameplay simulator.
'use strict';

const DEFAULT_CRATES = [
  { x: 240, y: 208 }, { x: 432, y: 208 }, { x: 240, y: 688 },
  { x: 1104, y: 208 }, { x: 1296, y: 208 }, { x: 1296, y: 688 },
  { x: 528, y: 1136 }, { x: 1040, y: 1136 },
];

function codecProtocol(codecSource) {
  if (typeof codecSource !== 'string' || !codecSource.includes('class Tracker') ||
      !codecSource.includes('function hello(') || !codecSource.includes('function input(')) {
    throw new TypeError('codecSource must be the protocol-v13 probe codec block');
  }
  const version = codecSource.match(/const PROTOCOL = (\d+);/);
  if (Number(version?.[1]) !== 13) throw new Error(`trophy helper requires protocol 13; codec says ${version?.[1] ?? 'unknown'}`);
  return 13;
}

function webOrigin(serverUrl) {
  const url = new URL(serverUrl);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.pathname !== '/ws' || url.search || url.hash) {
    throw new TypeError('serverUrl must be a direct ws[s]://host[:port]/ws endpoint');
  }
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/probe';
  return url;
}

function copy(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function remaining(deadline) {
  return Math.max(0, deadline - Date.now());
}

async function connectHelper({ browser, codecSource, serverUrl, profile, faction, contentHash }) {
  codecProtocol(codecSource);
  if (!browser || typeof browser.newPage !== 'function') throw new TypeError('browser must be a Playwright Browser');
  if (typeof profile !== 'string' || !/^[A-Za-z0-9_-]{2,16}$/.test(profile)) {
    throw new TypeError('profile must be 2..16 ASCII letters, digits, _ or -');
  }
  if (faction !== null && (!Number.isInteger(faction) || faction < 0 || faction > 4)) {
    throw new TypeError('faction must be null or protocol faction code 0..4');
  }
  const content = typeof contentHash === 'bigint'
    ? contentHash.toString(16)
    : String(contentHash).replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{1,16}$/.test(content) || BigInt(`0x${content}`) === 0n) {
    throw new TypeError('contentHash must be the nonzero /info u64 hex string');
  }
  const url = webOrigin(serverUrl);
  const infoUrl = new URL(url);
  infoUrl.pathname = '/info';
  const infoResponse = await fetch(infoUrl, { cache: 'no-store' });
  if (!infoResponse.ok) throw new Error(`helper target /info returned HTTP ${infoResponse.status}`);
  const info = await infoResponse.json();
  if (info.protocol !== 13 || String(info.contentHash).toLowerCase().replace(/^0x/, '') !== content.replace(/^0+/, '')) {
    throw new Error('helper target /info does not match requested protocol/content identity');
  }
  url.searchParams.set('profile', profile);
  url.searchParams.set('ticket', 'dev');
  if (faction === null) url.searchParams.delete('faction');
  else url.searchParams.set('faction', String(faction));

  const page = await browser.newPage();
  try {
    await page.addInitScript(({ source }) => {
      const codec = new Function(`${source}\nreturn { decode, Tracker };`)();
      const tracker = new codec.Tracker();
      window.__rhTrophyObserved = { welcome: null, snapshot: null, errors: [] };
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args, newTarget) {
          const socket = Reflect.construct(target, args, newTarget);
          socket.addEventListener('message', event => {
            try {
              const message = tracker.decode(event.data);
              if (message.t === 'welcome') {
                window.__rhTrophyObserved.welcome = {
                  protocol: message.protocol,
                  content: message.content.toString(16).padStart(16, '0'),
                  player: message.player,
                  tick: message.tick,
                  tickRate: message.tickRate,
                  map: { w: message.map.w, h: message.map.h, hash: message.map.hash },
                };
              } else if (message.t === 'snapshot') {
                window.__rhTrophyObserved.snapshot = message;
              }
            } catch (error) {
              window.__rhTrophyObserved.errors.push(String(error?.message || error));
            }
          });
          return socket;
        },
      });
    }, { source: codecSource });
    // /probe is served by the same server as /ws. Its tracker and v13 encoders
    // are the existing compatibility-tested protocol implementation.
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      window.__rhTrophySent = [];
      window.__rhTrophySend = rows => {
        if (!Array.isArray(rows) || rows.length < 1 || rows.length > 16) throw new TypeError('send expects 1..16 commands');
        const allowed = new Set(['move', 'attackMove', 'pickup', 'choose', 'attack', 'release', 'stop', 'aim', 'useConsumable', 'swap']);
        if (rows.some(row => !row || !allowed.has(row.k))) throw new TypeError('only ordinary public gameplay commands are allowed');
        const P = window.__probe;
        if (!P?.open) throw new Error('public helper WebSocket is not connected');
        const commands = rows.map(row => {
          const out = { ...row };
          if (out.k === 'move' && out.seq == null) {
            P.moveSeq = (P.moveSeq + 1) & 255;
            out.seq = P.moveSeq;
          }
          return out;
        });
        const seq = (P.inputSeq + 1) >>> 0;
        P.inputSeq = seq;
        send(input(seq, commands));
        window.__rhTrophySent.push({ seq, commands, at: performance.now() });
        return seq;
      };
    });

    const snapshot = async () => copy(await page.evaluate(() => ({
      open: window.__probe?.open ?? false,
      welcome: window.__rhTrophyObserved?.welcome ?? window.__probe?.welcome ?? null,
      snapshot: window.__rhTrophyObserved?.snapshot ?? (window.__probe?.me ? {
        tick: window.__probe.lastTick,
        phase: window.__probe.phase,
        ack: window.__probe.ack,
        me: window.__probe.me,
        actors: window.__probe.actors,
        training: null,
      } : null),
      collections: window.__probe?.collections ?? {},
      events: window.__probe?.events ?? [],
      rejects: window.__probe?.rejects ?? [],
      decodeErrors: [...(window.__probe?.errors ?? []), ...(window.__rhTrophyObserved?.errors ?? [])],
      received: (window.__probe?.snapshots ?? 0) + (window.__probe?.stateFrames ?? 0) + (window.__probe?.events?.length ?? 0),
      sent: window.__rhTrophySent ?? [],
    })));

    const waitFor = async (predicate, timeoutMs = 10_000, description = 'condition') => {
      if (typeof predicate !== 'function') throw new TypeError('predicate must be a function');
      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new TypeError('timeoutMs must be finite and nonnegative');
      const until = Date.now() + timeoutMs;
      let latest;
      do {
        latest = await snapshot();
        if (latest.decodeErrors.length) throw new Error(`trophy helper decoder error while waiting for ${description}: ${latest.decodeErrors.at(-1)}`);
        if (latest.rejects.length) throw new Error(`trophy helper admission rejected while waiting for ${description}: ${latest.rejects.at(-1).reason}`);
        if (predicate(latest)) return latest;
        if (Date.now() >= until) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      } while (true);
      throw new Error(`timed out waiting for ${description}; last tick=${latest?.snapshot?.tick ?? 'none'}, frames=${latest?.received ?? 0}`);
    };

    const send = async commands => page.evaluate(rows => window.__rhTrophySend(rows), commands);

    const helper = {
      page,
      waitFor,
      snapshot,
      send,
      async moveTo(x, y, { source = 'public protocol Move', waitWithin = 48, timeoutMs = 45_000 } = {}) {
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(waitWithin) || waitWithin < 0) {
          throw new TypeError('moveTo requires finite coordinates and nonnegative waitWithin');
        }
        const before = await snapshot();
        const from = before.snapshot?.me;
        if (!from) throw new Error('helper has no self snapshot before Move');
        const inputSeq = await send([{ k: 'move', x, y }]);
        const reached = await waitFor(state => !!state.snapshot?.me && distance(state.snapshot.me, { x, y }) <= waitWithin,
          timeoutMs, `server-applied Move to ${x},${y} within ${waitWithin}u`);
        return {
          source,
          requested: { x, y },
          from: { x: from.x, y: from.y },
          applied: { x: reached.snapshot.me.x, y: reached.snapshot.me.y },
          distance: distance(reached.snapshot.me, { x, y }),
          inputSeq,
          acknowledged: reached.snapshot.ack === inputSeq,
          tick: reached.snapshot.tick,
        };
      },
      async acquireBoostFromCrates({ cratePositions = DEFAULT_CRATES, timeoutMs = 180_000 } = {}) {
        if (!Array.isArray(cratePositions) || cratePositions.length === 0 ||
            cratePositions.some(p => Array.isArray(p)
              ? p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])
              : !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) {
          throw new TypeError('cratePositions must be a nonempty list of finite world points');
        }
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive and finite');
        const deadline = Date.now() + timeoutMs;
        let current = await snapshot();
        const remainingCrates = cratePositions.map((p, index) => ({
          x: Array.isArray(p) ? p[0] : p.x,
          y: Array.isArray(p) ? p[1] : p.y,
          sourceIndex: index,
        }));
        const visited = [];
        const within = (state, p, radius) => !!state.snapshot?.me && distance(state.snapshot.me, p) <= radius;
        const props = state => state.collections?.[2]?.rows ?? [];
        const rewards = state => Array.isArray(state.collections?.[4]) ? state.collections[4] : [];
        const boosts = state => state.collections?.[5]?.boosts ?? null;
        const atProp = (state, point) => props(state).find(row => row.kind === 2 &&
          Math.abs(row.x / 8 - point.x) <= 1 && Math.abs(row.y / 8 - point.y) <= 1);
        const atReward = (state, point) => rewards(state).find(row =>
          Math.abs(row.x / 8 - point.x) <= 2 && Math.abs(row.y / 8 - point.y) <= 2 &&
          row.options.some(option => option.kind === 2 && option.id <= 6));

        while (remainingCrates.length && remaining(deadline) > 0) {
          // Nearest-neighbour order makes the full eight-crate sweep short while keeping each
          // destination a source-authored coordinate from the embedded first-playable map.
          current = await snapshot();
          const here = current.snapshot?.me;
          if (!here) throw new Error('helper has no self snapshot');
          remainingCrates.sort((a, b) => distance(here, a) - distance(here, b));
          const point = remainingCrates.shift();
          if (!within(current, point, 48)) {
            const moveBudget = Math.min(45_000, remaining(deadline));
            await helper.moveTo(point.x, point.y, {
              source: 'source-authored stat-crate navigation', waitWithin: 48, timeoutMs: moveBudget,
            });
            current = await snapshot();
          }

          const prop = atProp(current, point) ?? atProp(await snapshot(), point);
          if (!prop) {
            visited.push({ ...point, outcome: 'no-visible-chest-handle-in-pickup-range' });
            continue;
          }
          if (prop.open) {
            visited.push({ ...point, propHandle: prop.handle, outcome: 'already-open' });
            continue;
          }
          const before = boosts(current);
          if (!Array.isArray(before) || before.length !== 8) throw new Error('decoded Build key 5 is unavailable');
          const beforeCounts = before.slice();
          const pickupSeq = await send([{ k: 'pickup', handle: prop.handle }]);
          const pickedAt = await waitFor(state => {
            const opened = atProp(state, point)?.open === true;
            return opened || !!atReward(state, point);
          }, Math.min(5_000, remaining(deadline)), `server pickup result for chest at ${point.x},${point.y}`)
            .catch(error => {
              if (String(error.message).startsWith('timed out waiting')) return null;
              throw error;
            });
          if (!pickedAt) {
            visited.push({ ...point, propHandle: prop.handle, outcome: 'pickup-not-confirmed', pickupSeq });
            continue;
          }
          const row = atReward(pickedAt, point);
          if (!row) {
            visited.push({ ...point, propHandle: prop.handle, outcome: 'opened-non-stat-chest', pickupSeq });
            continue;
          }

          // Prefer an offensive/utility boost so this real victim investment does not
          // unnecessarily increase the ordinary Unity owner's kill time. If the source
          // roll offers only defensive choices, choose the first non-Lifesteal option.
          const optionIndex = [0, 1, 5, 6, 2, 3, 4]
            .map(id => row.options.findIndex(option => option.kind === 2 && option.id === id))
            .find(index => index >= 0) ?? -1;
          if (optionIndex < 0) throw new Error('stat chest did not contain a non-Lifesteal Boost option');
          const optionVector = row.options.map(option => ({ kind: option.kind, id: option.id }));
          const sameOptionVector = candidate => Array.isArray(candidate?.options) &&
            candidate.options.length === optionVector.length &&
            candidate.options.every((option, index) => option.kind === optionVector[index].kind && option.id === optionVector[index].id);
          const ready = row.canChoose
            ? pickedAt
            : await waitFor(state => {
              const latest = atReward(state, point);
              // RewardChestObserver sorts on canChoose; a false→true eligibility change
              // may intentionally rotate the connection-scoped handle. Bind by the same
              // delivered source position and exact option vector, then use the new handle.
              return latest?.canChoose === true && sameOptionVector(latest);
            }, Math.min(10_000, remaining(deadline)), `stat chest birth hold for reward at ${point.x},${point.y}`);
          const chosenRow = atReward(ready, point);
          if (!sameOptionVector(chosenRow)) throw new Error('stat reward option vector changed during birth hold');
          const chooseSeq = await send([{ k: 'choose', handle: chosenRow.handle, pick: optionIndex }]);
          const after = await waitFor(state => {
            const build = boosts(state);
            return Array.isArray(build) && build[chosenRow.options[optionIndex].id] > beforeCounts[chosenRow.options[optionIndex].id];
          }, Math.min(10_000, remaining(deadline)), `authoritative Build key 5 boost increment for reward ${chosenRow.handle}`);
          const selected = chosenRow.options[optionIndex];
          const result = {
            verified: true,
            sourcePosition: { x: point.x, y: point.y },
            sourceCrateIndex: point.sourceIndex,
            propHandle: prop.handle,
            birthRewardHandle: row.handle,
            readyRewardHandle: chosenRow.handle,
            optionIndex,
            boostId: selected.id,
            option: { kind: selected.kind, id: selected.id },
            beforeBoostCounts: beforeCounts,
            afterBoostCounts: boosts(after).slice(),
            wireSequenceEvidence: {
              pickup: pickupSeq,
              choose: chooseSeq,
            },
            visitedCrates: visited,
          };
          return result;
        }
        throw new Error(`no source stat chest yielded a selectable non-Lifesteal Boost before timeout; visited=${visited.length}/${cratePositions.length}`);
      },
      async close() {
        try {
          await page.evaluate(() => {
            if (window.__probe?.open) send(leave());
          });
        } catch { /* best effort during shutdown */ }
        await page.close();
      },
    };

    await waitFor(state => state.open && state.welcome && state.snapshot && Object.keys(state.collections).length > 0,
      15_000, `protocol-13 helper admission (${profile})`);
    return helper;
  } catch (error) {
    await page.close().catch(() => {});
    throw error;
  }
}

module.exports = { connectHelper, DEFAULT_CRATES };
