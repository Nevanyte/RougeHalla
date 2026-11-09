// Offline VM controls of the actual .jslib, not a browser/IL2CPP/reload proof. No dependencies or real credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../UnityProject/Assets/Plugins/WebGL/RhSeatCheckpoint.jslib'), 'utf8');
const key = 'rh.seat.checkpoint.v1';
function harness() {
  const data = new Map(), memory = new Map(), calls = [], flags = {};
  let next = 1, frees = 0;
  const storage = {
    getItem(k) { calls.push('get'); if (flags.get) throw Error('declared read failure'); return data.has(k) ? data.get(k) : null; },
    setItem(k,v) { calls.push('set'); if (flags.set) throw Error('declared quota failure'); if (!flags.dropWrite) data.set(k,v); },
    removeItem(k) { calls.push('remove'); if (flags.remove) throw Error('declared remove failure'); if (!flags.dropRemove) data.delete(k); },
  };
  const context = {
    LibraryManager: { library: {} }, mergeInto: (target, functions) => Object.assign(target, functions),
    lengthBytesUTF8: text => Buffer.byteLength(text, 'utf8'),
    _malloc: () => flags.malloc ? 0 : next++, _free: ptr => { frees++; memory.delete(ptr); },
    stringToUTF8: (text,ptr,capacity) => { if (flags.copy) throw Error('declared copy failure'); assert.ok(Buffer.byteLength(text) < capacity); memory.set(ptr,text); },
    UTF8ToString: text => { if (flags.inputCopy) throw Error('declared input copy failure'); return text; },
  };
  Object.defineProperty(context, 'sessionStorage', { get() { if (flags.access) throw Error('declared access failure'); return storage; } });
  vm.runInNewContext(source, context, { filename: 'RhSeatCheckpoint.jslib' });
  const api = context.LibraryManager.library;
  return { data, calls, flags, api, frees: () => frees, read: () => { const p = api.RhSeatCheckpoint_Read(); return p ? memory.get(p) : null; } };
}
const tests = [
  ['missing differs from empty/corrupt record', () => {
    const h = harness(); assert.equal(h.read(),'M'); h.data.set(key,''); assert.equal(h.read(),'R\n');
    h.data.set(key,'unknown=corrupt\n'); assert.equal(h.read(),'R\nunknown=corrupt\n');
  }],
  ['one key replaces rather than accumulating records', () => {
    const h = harness(); assert.equal(h.api.RhSeatCheckpoint_Write('first'),0); assert.equal(h.read(),'R\nfirst');
    assert.equal(h.api.RhSeatCheckpoint_Write('newer'),0); assert.equal(h.data.size,1); assert.equal(h.read(),'R\nnewer');
  }],
  ['old captured revision cannot clear newer payload', () => {
    const h = harness(); h.api.RhSeatCheckpoint_Write('revision=old\n'); h.api.RhSeatCheckpoint_Write('revision=new\n');
    assert.equal(h.api.RhSeatCheckpoint_Clear('revision=old\n'),2); assert.equal(h.data.get(key),'revision=new\n');
    h.calls.length=0; assert.equal(h.api.RhSeatCheckpoint_Clear('revision=new\n'),0);
    assert.deepEqual(h.calls,['get','remove','get']); assert.equal(h.api.RhSeatCheckpoint_Clear('revision=old\n'),1);
  }],
  ['unavailable storage never falls back', () => {
    const h = harness(); h.flags.access=true; assert.equal(h.read(),'U');
    assert.equal(h.api.RhSeatCheckpoint_Write('record'),2); assert.equal(h.api.RhSeatCheckpoint_Clear('record'),3); assert.equal(h.data.size,0);
  }],
  ['throwing reads never report Ready or Cleared', () => {
    const h = harness(); h.data.set(key,'record'); h.flags.get=true; assert.equal(h.read(),'U');
    assert.equal(h.api.RhSeatCheckpoint_Clear('record'),3); assert.equal(h.data.get(key),'record');
  }],
  ['failed quota write is Unsaved and old record remains', () => {
    const h = harness(); h.data.set(key,'old'); h.flags.set=true;
    assert.equal(h.api.RhSeatCheckpoint_Write('new'),1); assert.equal(h.data.get(key),'old');
  }],
  ['readback failure after write is not Saved', () => {
    const h = harness(); h.flags.get=true; assert.equal(h.api.RhSeatCheckpoint_Write('record'),1); assert.equal(h.data.get(key),'record');
  }],
  ['silent write/removal failure is unconfirmed', () => {
    const h = harness(); h.flags.dropWrite=true; assert.equal(h.api.RhSeatCheckpoint_Write('record'),1);
    h.data.set(key,'record'); h.flags.dropRemove=true; assert.equal(h.api.RhSeatCheckpoint_Clear('record'),4);
    h.flags.remove=true; assert.equal(h.api.RhSeatCheckpoint_Clear('record'),4); assert.equal(h.data.get(key),'record');
  }],
  ['bound enforced before record copying or mutation', () => {
    const h = harness(), tooLarge='x'.repeat(8193); h.data.set(key,tooLarge); assert.equal(h.read(),'I');
    h.calls.length=0; assert.equal(h.api.RhSeatCheckpoint_Write(tooLarge),3); assert.equal(h.api.RhSeatCheckpoint_Clear(tooLarge),5);
    assert.deepEqual(h.calls,[]); assert.equal(h.data.get(key),tooLarge);
  }],
  ['allocation/copy failures cannot masquerade as Missing', () => {
    const h = harness(); h.flags.malloc=true; assert.equal(h.read(),null);
    h.flags.malloc=false; h.flags.copy=true; assert.equal(h.read(),null); assert.equal(h.frees(),1);
  }],
  ['input copy failure never reports successful mutation', () => {
    const h = harness(); h.data.set(key,'record'); h.flags.inputCopy=true;
    assert.equal(h.api.RhSeatCheckpoint_Write('new'),1); assert.equal(h.api.RhSeatCheckpoint_Clear('record'),4); assert.equal(h.data.get(key),'record');
  }],
];
for (const [name, test] of tests) { test(); process.stdout.write('PASS '+name+'\n'); }
process.stdout.write(JSON.stringify({ scope: 'Offline actual-jslib VM controls only, not browser/AOT/reload proof', passed: tests.length })+'\n');
