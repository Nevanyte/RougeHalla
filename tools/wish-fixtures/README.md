# Wish / ability-policy source witness (P-BOTS-2)

Canonical actual-source capture for the bots' Wish module: the pure cast policy (server/src/bots/abilityPolicy.ts) over
declared situations, the five Wish static rows, the Easy-tier remember share and the module's rule table
(server/src/bots/brain/modules/wishes.ts). Every expected value is written by the unmodified source.

- Corpus: `parity/policy/bot-wish.json`
- Native comparison: `crates/rh-policy/src/bots/wish_parity_tests.rs`
- Capture: runs in the pinned `node:22.23.4-bookworm-slim@sha256:aaa4b5ba…` linux/amd64 container (the same immutable image
  as the other fixture tools), records the complete `packages/shared/src`, `packages/server/src/sim` and
  `packages/server/src/bots` TypeScript closure hashes, and replays the scenario twice requiring byte-identical output:

~~~
bash tools/wish-fixtures/capture.sh            # capture to parity/policy
bash tools/wish-fixtures/capture.sh --check    # compare the checked-in corpus byte for byte
~~~

`RH_WISH_OUTPUT` points the capture at another directory. This Docker release cannot create the tool's tmpfs mountpoint over
a read-only repo bind, so the container mounts the repo writable: `npm ci` only writes the ignored `node_modules`.

## What the corpus pins

| section | contents |
| --- | --- |
| `defs` | the five Wish rows: intent tags (in definition order), blockedBy, dropsLock, cast time, cooldown, charges, target rule and distilled effects (hidesCaster, blink dists) |
| `hides` | `hidesCaster` for every Wish at ranks 0/1/2/3/99 (the one-rank clamp) |
| `rules` | the module's full rule table (retry, recent hit, chase closing/cos, on-it distance, Easy remember share and the pinned slip fields) |
| `profile.constants` | the cast policy's thresholds (escape/sustain/engage/peel) |
| `cases` | 173 declared situations and their decisions: the blocking bits and casting gate; escape/sustain thresholds and their near misses; engage/control range-margin, los, mob and untargetable cases; blink close/far cases; peel distance/chasing/los/id edges; intent order (engage vs peel, escape vs engage); rank clamps; and Blaze escape/engage landing searches beside declared map walls |

The map is the same declared 24x24 `declared-map-input.json` the bot-core tool uses. Situations keep `gatesLocked: false`:
the fair static view carries the open map only (see the evidence note), and this corpus never asserts a locked-gate landing.

## Mutants

`tools/wish-fixtures/run-mutants.sh` applies every committed patch in `tools/wish-fixtures/mutants/_, requires a semantic
failure of the wish parity/policy-seat tests, restores the tree, and then requires the unchanged control to pass. The set:
sustain hp, the escape hit threshold, the engage range margin, peel distance, hidesCaster, the Easy defensive-tag filter and
the blink-escape gain. It reports **7/7 mutants killed; unchanged control passes**.

Recapture only with the pinned container: the corpus is immutable source output, never regenerated from Rust.
