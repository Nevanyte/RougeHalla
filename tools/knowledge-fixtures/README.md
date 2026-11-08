# Knowledge-layer source witness (P-BOTS-3 remainder II)

Canonical actual-source capture for the brain's Knowledge layer (`packages/server/src/bots/brain/knowledge.ts`): the counter
wheels a bot knows (ten faction masks and ten weapon masks drawn once), the fixed per-bot mob-share errors and the fight odds
the strategy/tactics share.

The corpus is `parity/policy/bot-knowledge.json`; the native comparison is
`crates/rh-policy/src/bots/knowledge_parity_tests.rs`. The capture runs in the pinned
`node:22.23.4-bookworm-slim@sha256:aaa4b5ba...` linux/amd64 image (the same immutable image as the other fixture tools):

```sh
bash tools/knowledge-fixtures/capture.sh            # capture to parity/policy
bash tools/knowledge-fixtures/capture.sh --check    # compare the checked-in corpus byte for byte
```

`RH_KNOWLEDGE_OUTPUT` points the capture elsewhere. The recorder asserts Node/platform/arch, replays every case twice bit for
bit, and hashes the complete TypeScript dependency closure into the corpus provenance.

## What the corpus witnesses

- Six declared creations (the three tier tables, an always-blind and an always-seeing tier, and a partial 0.35/0.2 one) over
  declared seeds, each through the real `createKnowledge`.
- The next two draws of the creation stream after each case, so a port that consumes a different number of rng draws fails
  even when its answers happen to match.
- Every faction pair and every weapon pair both ways round (the wheel masks), the full 5x5x2 mob-share grid (the matchup
  share plus its fixed error, clamped), and a declared sample of fight-odds rows covering every branch: known edges, partial
  knowledge, the tint path (positive and negative), unknown factions/hands, the hp-share lead and clamping, and the source's
  two-decimal debug line.

Recapture only with the pinned container: the corpus is immutable expected output, never regenerated from Rust.
