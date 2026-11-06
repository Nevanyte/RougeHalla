# Complete card catalog and bounded reward source witness

Source-only prerequisite for P-CARDS-1. Source inputs match base `3619339a1c03469be837aa9b42a280d7940044d0`; the protected tools/parity inventory was frozen at `64052f09` (317 paths from the source base plus eight ability-void companion paths). This does not implement or certify native cards, constructors, grantCard, chest actions, hooks or combat effects. The native runtime currently has a three-card subset. Full card/reward parity and the known terrain reward mismatch remain runtime work.

`source.json` uses `rh-card-catalog-source/1`. Every case has a declared `input` and an actual-source `expected`. The catalog includes all80 definitions in source order:24 bases,13 conditionals,43 augments. Definitions retain complete metadata, all ten effect kinds, common `requires`/`needs` where present, every trigger action/flag, and raw byFaction/byFactionText. Each definition also includes direct default/five-faction/unknown-faction row and text selections. These are replacements, not additional rows.

The closed inventory contains409 cases (80 catalog,80 eligibility,28 count boundaries,6 unknown,1 membership,30 pools,181 rolls,3 pool representations). Coverage is bounded:

- 80 catalog cases and80 eligibility cases. Every card sees empty/held/prerequisite/prerequisite-plus-held builds, preserving base stacking and unique/conditional blocking order.
- 28 helper boundary cases: record/Map/get-only/forEach-only/null/undefined, fractions, negative/zero values, infinities, NaN, string/null/undefined values and unknown IDs. These are labeled helper behavior, not legal native build inputs.
- Unknown IDs (including boost and prototype-looking sentinels) and complete ID/live/kind/interactive membership.
- Pools for no pickers, empty picker, all-owned, mixed owners, conditional prerequisites, all eight bases and each of14 interactive augments; readyOnly false/true baseline and lookup-representation pool cases.
- Normal/elite rolls across no zone and all five zones. Exact lower/equal/upper tier thresholds, high index endpoint, no/mixed/all owners, themed exhaustion, one/two choices, nearest/lower-tier fallback and readyOnly false. Every draw and untouched continuation is preserved. A competitive tier1-versus-tier3 tie is unreachable through the current reward catalog: all14 interactive cards are tier1 or2.

The declared source, harness and preexisting tool/corpus SHA inventories are in `source.json`. The original proposal manifest remains private and frozen; the coordinator integration record separately identifies documentation corrections and observed checks. Source inputs are unchanged. No old63-Wish, arena, terrain, maps or stat-fold capture was rerun. Follow [the harness instructions](../../tools/card-catalog-fixtures/README.md) to reproduce with the pinned image and fresh unchanged lock installation.

Errata for that frozen, hashed harness README: its unknown-ID statement applies only to IDs unrecognized by the card,
boost and kill-trophy namespaces. For example, `boost:ad` is not a card ID but has a valid option view. Its tier2 versus
tier1-only example witnesses nearest/lower fallback, not a discriminating competitive tie. All four harness files and
the corpus remain byte-identical to the reviewed proposal; this errata corrects the claims without changing their pins.

Limitations: this is a pure catalog/selection oracle, not source-born simulation. It does not exercise grant/choose/skip mutations, card combat hooks, stat fold internals, constructor RNG, Wish timing, public transport, Unity, cloud or ML. Invalid RNG values outside [0,1) are excluded deliberately. The original full runtime corpus remains unchanged and no existing mismatch is masked.
