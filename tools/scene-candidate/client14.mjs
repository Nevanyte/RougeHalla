// Private caller-applied wrapper for the isolated RHC14EXP Full-only experiment.
// This does not activate a live transport or grant AcceptedFrame authority.
import {createSceneCodec} from './scene-candidate.mjs';

const UMAX = (1n << 64n) - 1n;
const ACK_MAGIC = new TextEncoder().encode('RHC14EXP');
const candidateBrand = new WeakMap();
const receiptBrand = new WeakMap();
const fail = (what) => { throw new Error(`scene client: ${what}`); };

function validGeneration(value) {
  if (typeof value !== 'bigint' || value < 1n || value > UMAX) fail('generation');
  return value;
}

function sameBigint(a, b) { return typeof a === 'bigint' && a === b; }

function decodeBodyFrames(body) {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  if (body.length < 2) fail('body');
  const count = view.getUint16(0, true);
  let at = 2;
  const messages = [];
  for (let i = 0; i < count; i++) {
    if (at + 4 > body.length) fail('body');
    const len = view.getUint32(at, true); at += 4;
    if (!len || at + len > body.length) fail('body');
    const frame = body.subarray(at, at + len); at += len;
    messages.push(frame);
  }
  if (at !== body.length) fail('body trailing');
  return messages;
}

function trackCompleteScene(body, Tracker14) {
  const tracker = new Tracker14();
  const frames = decodeBodyFrames(body);
  const applied = frames.map(frame => tracker.decode(frame.slice().buffer));
  if (applied.length < 2 || applied[0]?.t !== 'snapshot' || applied[1]?.t !== 'state') fail('full roles');
  const state = applied[1];
  if (!Array.isArray(state.items) || state.items.length !== 11 || state.items.some((item, i) => item?.key !== i + 1)) fail('complete state');
  if (!tracker.base || tracker.base.tick !== applied[0].tick || tracker.collections.size !== 11) fail('incomplete tracker');
  for (let key = 1; key <= 11; key++) if (!tracker.collections.has(key)) fail('incomplete tracker');
  return applied;
}

function ackBytes(epoch, scene, cueThrough) {
  const bytes = new Uint8Array(34), view = new DataView(bytes.buffer);
  bytes.set(ACK_MAGIC, 0); view.setUint8(8, 1); view.setUint8(9, 4);
  view.setBigUint64(10, epoch, true); view.setBigUint64(18, scene, true); view.setBigUint64(26, cueThrough, true);
  return bytes;
}

/**
 * Create a private RHC14EXP receiver and explicit caller-applied ACK gate.
 * All mutable Tracker and Receiver objects remain closure-private.
 */
export function createSceneClient14({decode14, Tracker14, protocol, generation, epoch, limits}) {
  if (protocol !== 14) fail('protocol');
  if (typeof decode14 !== 'function' || typeof Tracker14 !== 'function') fail('decoder');
  const localGeneration = validGeneration(generation);
  if (typeof epoch !== 'bigint' || epoch < 1n || epoch >= UMAX) fail('epoch');
  const codec = createSceneCodec(decode14, protocol);
  const receiver = new codec.Receiver(epoch, limits);
  const owner = Object.freeze({});
  let closed = false, pending = null, current = null, currentReceipt = null;

  function ensureOpen() { if (closed) fail('closed'); }
  function contextClose() {
    if (closed) return;
    closed = true;
    receiver.close();
    pending = null;
  }
  function requireGeneration(value) {
    if (!sameBigint(value, localGeneration)) fail('generation mismatch');
  }
  function makeCandidate(view) {
    const meta = view.metadata;
    // Validate using a short-lived actual Tracker. The immutable codec view already owns the
    // retained encoded body, so keep no second body buffer or staged Tracker graph here.
    trackCompleteScene(view.bodyCopy(), Tracker14);
    const privateState = {generation: localGeneration, metadata: meta};
    const candidate = Object.freeze({
      get generation() { return localGeneration; },
      get metadata() { return meta; },
      get byteView() { return view.bodyCopy(); },
      bodyCopy() { return view.bodyCopy(); },
      messagesCopy() {
        // Re-decode the original inner frames and rebuild a fresh private Tracker each call.
        return trackCompleteScene(view.bodyCopy(), Tracker14);
      },
    });
    candidateBrand.set(candidate, {owner, privateState});
    return candidate;
  }

  const api = Object.freeze({
    get generation() { return localGeneration; },
    get epoch() { return epoch; },
    get closed() { return closed; },
    get ownedBodyBytes() { return receiver.ownedBodyBytes; },
    get current() { return current; },

    push(receivedGeneration, bytes) {
      ensureOpen();
      requireGeneration(receivedGeneration);
      if (pending) {
        contextClose();
        fail('candidate pending');
      }
      try {
        const committed = receiver.push(bytes);
        if (!committed) return null;
        const view = receiver.current;
        const candidate = makeCandidate(view);
        pending = candidate;
        return candidate;
      } catch (error) {
        contextClose();
        throw error;
      }
    },

    commitApplied(receivedGeneration, candidate) {
      ensureOpen();
      requireGeneration(receivedGeneration);
      const brand = candidateBrand.get(candidate);
      if (!brand || brand.owner !== owner || candidate !== pending || brand.privateState.generation !== localGeneration) fail('candidate identity');
      // Prepare the receipt before the sole public state swap.
      const receipt = Object.freeze(Object.create(null));
      const receiptState = Object.freeze({owner, candidate, epoch, scene: brand.privateState.metadata.scene, cueThrough: brand.privateState.metadata.cueThrough});
      receiptBrand.set(receipt, receiptState);
      current = candidate;
      currentReceipt = receipt;
      pending = null;
      return receipt;
    },

    refuse(receivedGeneration, candidate) {
      ensureOpen();
      requireGeneration(receivedGeneration);
      const brand = candidateBrand.get(candidate);
      if (!brand || brand.owner !== owner || candidate !== pending) fail('candidate identity');
      contextClose();
      return true;
    },

    encodeAck(receivedGeneration, receipt) {
      ensureOpen();
      requireGeneration(receivedGeneration);
      const state = receiptBrand.get(receipt);
      if (!state || state.owner !== owner || receipt !== currentReceipt || state.candidate !== current) fail('receipt identity');
      return ackBytes(state.epoch, state.scene, state.cueThrough);
    },

    close() { contextClose(); },
  });
  return api;
}
