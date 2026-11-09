// Produce a reviewable classic-script proposal. Does not execute it, open a page or install hooks.
import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function makePreloadProposal() {
  const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
  const parser = read('wire-metadata.js').replace(/^export function /gm, 'function ');
  const adapter = read('wire-tap-proposal.js')
    .replace("import {parseWireMetadata} from './wire-metadata.js';", '')
    .replace(/^export function /gm, 'function ');
  if (/^\s*(import|export)\s/m.test(parser + adapter)) throw new Error('unexpected module dependency');
  return `// PROPOSAL ONLY. Root must release actual browser execution before installing this preload.
// Execute only in the dedicated owned test page, before ordinary Unity initialization.
(() => {
  'use strict';
  if (Object.prototype.hasOwnProperty.call(window, '__unityReloadWireEvidence')) {
    if (window.__unityReloadWireEvidence.schema === 'unity-browser-reload-installation/1') return;
    throw new Error('diagnostic namespace already exists');
  }
  const parseWireMetadata = (() => {\n${parser}\nreturn parseWireMetadata; })();
  const proposeWireTap = (() => {\n${adapter}\nreturn proposeWireTap; })();
  ${read('observer.js')}
  const documentObserver = window.__unityReloadReadinessObserver;
  const originalConstructor = window.WebSocket;
  const tap = proposeWireTap(originalConstructor, documentObserver.export().documentId, () => ({
    wallTimeMs:Date.now(), timeOriginMs:performance.timeOrigin, performanceNowMs:performance.now()
  }));
  Object.defineProperty(window, '__unityReloadWireEvidence', {value:Object.freeze({
    schema:'unity-browser-reload-installation/1',
    export:() => tap.export(),
    stopAndRestore() {
      tap.stop();
      if (window.WebSocket === tap.ProposedConstructor) window.WebSocket = originalConstructor;
      documentObserver.stop();
    }
  }), enumerable:false, writable:false, configurable:false});
  window.WebSocket = tap.ProposedConstructor;
})();\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: make-preload-proposal.mjs NEW-proposal.js');
  writeFileSync(process.argv[2], makePreloadProposal(), {flag:'wx'});
}
