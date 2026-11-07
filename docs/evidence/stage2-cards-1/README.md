# P-CARDS-1 — complete authoritative cards and rewards (INCOMPLETE)

Phase: the card catalog/runtime foundation of [ORDER_OF_OPERATIONS](../../ORDER_OF_OPERATIONS.md) phase 1, serving the
backlog packet [P-CARDS-1](../backlog/packets/P-CARDS-1.md). Branch `deepseek/p-cards-1`, based on `856618eb`
(`optimization_port`) stacked over P-CONTENT-1. Content rule §6A: card effects are typed rows; this packet moves the
catalog to a generated, corpus-verified table and the build to the source count map.

## What this slice establishes

1. **The full 80-card catalog is data, generated from the accepted 409-case source corpus** (`parity/card-catalog/source.json`):
   `tools/card-catalog-fixtures/emit_cards.py` emits `crates/rh-sim/src/cards/{catalog,catalog_data}.rs` — 80 ids in source
   order, kind/tier/base/requires/unique/ready/title/text/tags, the complete typed effect rows (the eight folded kinds plus
   the full Vs/Scale/OnHit/Trigger payloads the stat-fold kernel deliberately projects away) and the two per-faction
   replacements (Plague's Cruel Wounds/Pestilence).
2. **Independent differentials** (`crates/rh-sim/tests/card_catalog.rs`): all 80 definitions and every row project back to the
   source JSON exactly; all seven selection entries per card; the 80 eligibility cases (view fields, held/count, owned,
   `cardPower`, and the complete `why`/`blocked` objects).
3. **The source build count map** replaces the three-slot subset: `Build` holds one count per card (base cards stack, unique
   cards once), `power` = Σ tier×count, and the fold gathers every owned card's rows into a fixed scratch with no per-step
   allocation.
4. **Protocol 7** carries the 80-byte count map (`WireBuild`), with the regenerated `protocol/fixtures/v7.json`, the Rust/JS/C#
   decoders and the Unity sync; browser proof PASS at protocol 7.
5. **The reward pools and the exact draw protocol are verified** (`reward_chests::pools`): the 14 interactive augment ids in
   source order, `conditionalPool`/`rewardAugmentPool` with held-by-all picker exclusion, the nearest-tier fallback with one
   tier draw plus one index draw per pick, the themed first slot and all five `ZONE_AUGMENT_THEMES`. The differential replays
   the corpus's **30 pool cases** and **181 roll cases** (options, every draw's cursor/value, final cursor, unused tape
   continuation). Not yet wired into chest drops — that is the runtime slice.

## Measurements

- `cargo test --workspace --all-features --locked` (throwaway PostgreSQL): **1,386 passed, 0 failed, 3 ignored, 150 test
  binaries, exit 0**.
- Catalog differentials: **2/2** (80 cards × all rows/selections; 80 × 4 eligibility entries incl. reasons).
- Protocol: Rust **11/11**, JS decoder **24 server vectors / 89 malformed / 10 chains / 15,454 checks**, C# **267/267**.
- Browser proof (`node tools/browser-proof/proof.mjs`): **PASS**, protocol 7.
- Reward pools/draw: **4/4** (30 pool cases, 181 roll cases, interactive order, five zone themes).
- Declared state change: the build map is hashed state, so this branch recalibrates the ability per-tick hash tape and
  `content_hash` (now `0x2835ca4eadc286bd`); the hash-coverage contract documents the new leaves.

## Still missing (the packet is INCOMPLETE)

- The reward/chest runtime over the verified pools (14-card interactive pool, theme/tier/distinctness/picker exclusion,
  exact roll draws), the chest choice/skip/expiry flow and grants that update the map.
- The card runtime/hook layer: `cardState` readers/writers, `cardHooks`/`onHit` multiplicity, streaks/stillness/bleeds,
  vs/scale contexts, guards G1–G13, and the wish/card coupling.
- Runtime source probes per family, mutant controls, and the packet's final accepted evidence.

No `DEVIATIONS.md` row; no coordinator-owned files touched.
