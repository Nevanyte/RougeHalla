# Full-page reload readiness — source proposal only

This packet is **NOT RUN browser acceptance**. It starts from clean isolated
`e56b17692c12386aa138f9ae9a42f7fd0132c58d` on the new branch
`codex/unity-browser-reload-readiness`. The reference client is Root's composed
`6d5d9340a6b9f425a17d7ea4488b49291fff3dc1`, with reviewed Resume UI
`8b48053b` / source`1bf48a81`, and native29 reference`7a13b88a`.
The native identity is protocol14/checkpoint29/replay23/observation21/policy15,
content`7c6a633f68c2cc72`, ordinary20Hz and default10-second server grace.

Only new files under `tools/unity-browser-reload-proof/` and this evidence folder
are written. There is no product, net library, native, workflow, lockfile, shared
status or Editor change. Private RHC14EXP remains inactive. No browser, GUI, Play,
Unity/native build, server, database, World capture, AWS or other network action
is performed. Offline built-in Node checks use synthetic readers/objects only.

[ACTIONS.md](ACTIONS.md) gives the exact ordinary UI sequence and finite outcomes.
[PREREQUISITES.md](PREREQUISITES.md) maps the coherent artifact, dual endpoints,
durable PostgreSQL/spool and genuine Result→receipt requirements.
[OBSERVABILITY.md](OBSERVABILITY.md) is the proposed credential-blind readset and
passive installation contract. Root reviews those sources before releasing any
actual browser execution after the98-case/layout/build gates.

The executable tools are:

- `observer.js`: own document clocks/nonce, navigation kind, lifecycle and trusted
  pointer/non-text-key metadata. No DOM text/input values or storage access.
- `wire-metadata.js`: bounded current14 structural reader. Hello strings, ticket
  and resume bytes are skipped unread; Welcome session bytes are skipped unread.
  It emits only public handshake metadata and never stores a raw frame.
- `wire-tap-proposal.js`: inert factory for a proposed native WebSocket wrapper.
  It makes no connection or send by itself. Future genuine game constructor/send
  calls are forwarded once with original arguments/buffers, while metadata is
  projected synchronously and discarded. No HTTP/account interception.
- `make-preload-proposal.mjs`: emits reviewable classic-script source, without
  executing it. **Executing that generated proposal installs the diagnostic tap**;
  the source packet does not execute or install it. Root must choose the actual
  GUI/driver route and release its exact hash first.
- `check.mjs`: accepts bounded allowlisted metadata only. A complete consistent
  bundle yields `READY_FOR_ROOT_REVIEW`, never browser acceptance. Unknown/raw or
  credential fields are refused without echoing values. Missing prerequisites or
  actual evidence remain OPEN. It has no browser/network/storage API.
- `pin-sources.mjs`: hashes an explicit list of immutable Git source blobs only.
  It never reads runtime configuration, credential files or browser state.

Offline commands (not browser execution):

```sh
node tools/unity-browser-reload-proof/pin-sources.mjs docs/evidence/unity-browser-reload-readiness/source-pins.json
node --test tools/unity-browser-reload-proof/check.test.mjs
node tools/unity-browser-reload-proof/check.mjs template NEW-not-run.json
node tools/unity-browser-reload-proof/make-preload-proposal.mjs NEW-proposal.js
node tools/unity-browser-reload-proof/check.mjs check SAFE-metadata-only.json NEW-report.json
```

Output paths must be new; the tools do not replace prior attempts. Never supply
HAR, HTTP responses, WS dumps/base64, checkpoint objects, credential stores,
private replay data or arbitrary console exports as checker input. Use only the
own observer exports, hard-projected wire records, fixed action labels and
reviewed screenshot/artifact hashes. Capture screenshots with recovery-key UI
closed and password inputs masked. Operator labels/screenshots require Root
review; they are not machine proof that a Canvas control was clicked.

The proposed packet has no actual Web artifact or runtime outcome. The historical
a3d/643d partial browser artifact, older accelerated a0 native bridge, managed923
and finite Editor gates retain their original scopes. None is relabeled as a
coherent native29 full-page reload, durable banking or browser performance proof.
