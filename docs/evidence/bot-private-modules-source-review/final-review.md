# Independent modules source reproduction review

**Disposition: RELEASE source reproduction for Root's source freeze review. This is not native admission or a claim of complete bot behavior.**

Review checkout: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-modules-source-review`, detached `HEAD faba1278268cc32fea192dcb590959192fc571f6`. The checked-out candidate is the author cut at `bd40fa2a` plus its sealed source evidence. The author worktree remained immutable. Initial tracked status was clean; final tracked status remains clean. Only this new review/evidence directory is untracked. The ignored `node_modules` mountpoint is empty; no host npm installation occurred.

## Independent command receipts

Commands ran from `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-modules-source-review`.

| Command | Runtime | Exit | Result |
|---|---|---:|---|
| `bash tools/bot-private-modules-fixtures/capture.sh --check` | Fresh Docker `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, `linux/amd64`; pinned script uses container tmpfs dependencies and read-only source/tools/output mounts | 0 | Source and coverage freshly reproduced byte-for-byte: source 12,755,158 B SHA-256 `645e85f16adbea001f8d0e06a70b6e5d311864ed9691622c06b789c95578b012`; coverage 1,832,252 B SHA-256 `50eaf16f47330f9a232b0cda066f9d3eae7fc413b7e0a7120c8557fd19dea0af`; 255 cases / 3,259 operations. |
| `node tools/bot-private-modules-fixtures/verify.mjs parity/policy/bot-private-modules/source.json` | Host Node v25.8.1; the prescribed verifier is dependency-free | 0 | Strict reader accepted the full corpus and reached 24 reader-negative controls. |
| `bash tools/bot-private-modules-fixtures/controls.sh --check` | Fresh Docker with the same pinned Node image and isolated tmpfs; candidate/output mounted read-only | 0 | Final source-bound controls reproduced: 26/26 semantic KILL, 0 survived; comment-only NONKILL; restored cases byte-identical. Each mutant capture completed with child status 0, so these are semantic differences, not compiler/capture failures. |
| `node tools/bot-private-modules-fixtures/manifest.mjs --check` | Host Node v25.8.1; dependency-free | 0 | Final manifest exactly matched source, coverage, controls, profile pins and counts; manifest 5,566,949 B SHA-256 `fe8fe10f8b1123cb456b7b805ebc67efbd6538c76a769b74cc2cb3f8435ab016`. |

Raw outputs are retained in [`reproduction/`](reproduction/): `01-source-check.log`, `02-strict-reader.log`, `03-final-controls-check.log`, `04-manifest-check.log`, and full before/after inventory snapshots `00-before-inventory.json` and `05-after-inventory.json`. The large control log contains complete per-mutant source/mutant operation and callback receipts; its final summary records all 26 KILLs, comment NONKILL and restored PASS.

## Integrity and formatting-only rebind

The before/after inventory snapshots independently hash every declared file in the manifest profile: 88 actual runtime imports, 113 conservative source-closure files, 9 config/lock files, 7 compatibility corpora, and all 12 pinned tool files. Every actual file matched its declared size/SHA both before and after; no hash or size changed in any group. The candidate `source.json`, `coverage.json`, and `controls.json` also match the final manifest pins. HEAD did not change.

The seven protected compatibility pins include `bot-planning.json`, `bot-wish.json`, `bot-hazards.json`, `bot-core.json`, `bot-brain-prefix/source.json`, `bot-private-strategy/source.json` (12,263,237 B, SHA-256 `3a3ae0d498cc3933b5eee11c5be995f267f4a76530379ad7c73a934082125d8d`), and `bot-private-tactics/source.json` (11,656,923 B, SHA-256 `5d27d1b4522d386d4ede5f3064a28660dedff43e32a24ade264f4512e30fcfa8`). The before/after inventory JSON retains every pin and actual hash, not only these highlighted protections.

The author explicitly records that final source `645e…` follows one whitespace-only cleanup to `checks.mts`, changing that pinned tool from 11,290 B / SHA-256 `bc741eb77b67cf865f240a93536a49332d4130cb57012bb71878dc40e19706e4` to 11,289 B / SHA-256 `5ac1deeda262034ab45905c9eba8362886ae31a051bb596e5079d3654cdfd04f`. Author log34 labels its final control-envelope source-hash rebinding as metadata-only and does not claim a semantic rerun. I independently compared the lossless `31-control-base-*.json.gz` inputs to the final corpus: the complete source body is equal after omitting only that tool pin; all 26 prior control receipt objects and all restored-case bytes are identical, with only the top-level source size/hash rebound. Separately, my fresh final `controls.sh --check` did rerun all 26 semantic mutations against `645e…`, so this review does not rely solely on the inherited control envelope.

## Boundary and source-contract review

The captured runtime boundary is the unchanged legacy four built-in modules plus actual `ChestHunter`, card helpers, and registry APIs. The cases invoke explicit methods/hooks; they do not constitute full `createBrain` composition, config guard/order/cadence, Brain-derived RNG, hand/seq/stats/end behavior, earned observations or live/headless publication. The packet limits remain explicit in HANDOFF/LEDGER.

Concrete contract points reviewed against the actual fixture tools and source inputs:

- The corrected `wishes-mob-type-optional` case contains an ordinary observed Mob with `type` omitted, then one with own `type: undefined`; both continue into the actual Wishes `intents` hook. The ordered tagged object codec preserves own `undefined`. The strict reader requires/string-checks `type` only when its decoded value is defined, so both valid optional shapes are accepted. This case records source behavior; no extra KILL claim is made for presence versus undefined where the source reads both as undefined.
- `checks.mts` builds its per-case reach inventory from actual operations, hooks, callback names and intent kinds; it separately executes the 36 reached semantic assertions against results, draw counts and full callback records. The ledger's `covers` text is not treated as evidence by itself. The final coverage is freshly regenerated and byte-matched.
- Brain hook contexts receive exactly the `decide`, `motor` and `lapse` RNG lanes. `Knowledge` is created separately with seed+3 and its own recorded `knowledge` lane; all setup draws are retained. No Brain RNG derivation claim is made.
- Config tokens are real distinct object identities, not structural keys. Four interleaved equal-valued `a`/`b` cases assert separate Memory/state and continuation for Chest, Planning, Wishes and Hazards. Each `cfg.map` label must resolve to one of eight embedded maps; source map rows carry full GameMap data plus `mapHashU32`, and the README requires embedded facts or exact recipe verification rather than label-only reconstruction.
- The strict reader validates the finite enumerated method profile, optional/undefined tags, closed consumed fields and chronology constraints atomically. `NUMERICS.md` expressly excludes arbitrary JavaScript-accepted domains such as nonfinite raw Plan payload values and does not invent producer rejection guarantees.
- Expected outputs are captured from the unchanged legacy modules. Memory snapshots are outputs, not setup; module WeakMaps have no expected-state setter. `controls.mjs` uses source outputs only for offline comparison and runs each mutation against a copied actual source tree; no native answer is read or injected into runtime inputs.

## Scope limit and release condition

I found no concrete source integrity, reader, trajectory or control defect in this candidate. The final source/tool/profile hashes reproduce, and prior known optional-field and trace-boundary corrections are present. This supports source-candidate release for Root review only. Native consumers still need an atomic field-aware reader, must use the actual embedded map/config identities and real Memory/Knowledge behavior, and must keep this finite method witness separate from broader Brain/live policy claims. No Rust/native answers, native worktree, status file or shared source was read or edited in this review.
