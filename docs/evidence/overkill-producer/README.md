# P-OVERKILL-PRODUCER-SOURCE — actual-source Overkill arithmetic/filter evidence

Source-only commit from root main `bf05fee4ba3571c9f35a334fadf2b69c49c02b4b`; only NEW tools/parity/docs files.
Production TS/Rust, existing captures/corpora, headers/content/tapes/status/Cargo.lock are untouched; no native ledger
edits and no second kernel.

## Approach / producer binding

Actual `createGameWorld` with four declared seats; real `grantCard` + actual `heal` for a genuinely earned Second Skin
barrier; ordinary queued sword/wand attacks and 50 ms steps. Hook taps wrap the real `hitLanded`/`overkilled`/`hurt`/
`fighterOut` callbacks read-only (they always call the previous callback); a labelled `beforeDamage` ledger tap records
the source ledger rows. No barrier/damage/death/hook payload is installed. The arena case uses a declared placement on
an actual generated Embers tile, not a fabricated row.

## Case matrix (5 cases)

| Case | Actual source facts |
|---|---|
| lethal-no-barrier | victim p2 setup hp1/max300/barrier0, ordinary p0 sword; at tick2/time100 `overkilled` `{overkill:52.604651,total:53.604651}`, one hit row `{by:p0,amount:53.604651,raw:64.325581,weapon:sword,arena:false}`; hit order and post-death state captured |
| barrier-absorbs-no-hp-damage | genuinely earned barrier: grant `leech1`+`secondSkin`, real `heal(1000)` -> barrier 237.5; wand attack absorbed down to 147.994949, HP stays 1/alive, **no `overkilled` hook** |
| barrier-lethal | earned barrier 30 via `heal(100)`; p0 sword lethal: `{overkill:22.604651,total:53.604651}`, absorbed 30 and applied HP 1 separately; one positive non-arena hit row `{amount:53.604651,raw:64.325581}` |
| multi-contribution | two ordinary attackers p0+p1 same pass: `{overkill:106.209302,total:107.209302}`; two ordered hit rows `{by:p0,amount:53.604651,raw:64.325581}`, `{by:p1,amount:53.604651,raw:64.325581}` |
| arena-contribution | victim p1 Holy on actual Embers tile (map seed1); ledger tap records `{victim:p1,by:'terrain:ember',raw:0.3,arena:true}` alongside the ordinary attack; `{overkill:35.437967,total:36.437967}` where `36.437967-36.137967=0.3`; the `overkilled` hit rows contain **only** the positive non-arena p0 row (amount36.137967/raw64.325581), excluding the arena contribution |

Exact tick/time, pre/post hp/barrier, ordered hook arrays (`hitLanded`/`hurt`/`fighterOut`/`overkilled`) and full
Overkill argument rows are in every frame. The arena total/filter is the observable non-arena distinction.

## Controls / checks

- Three targeted actual semantic controls are killed by actual runtime-output mismatches (3/3):
  `01-barrier-subtraction-removed` (overkill ignores absorbed barrier), `02-applied-vs-prehp` (uses hpBefore instead of
  applied), `03-non-arena-filter-removed` (arena row enters Overkill hits). Each variant starts from a pristine
  `git archive HEAD` temp repo; the live host ledger remains clean; final canonical control passes.
- Provenance-only comment mutation: runtime cases identical, non-kill; host source verified untouched.
- `capture.sh --check` and an independent external `--write` recapture are byte-identical (SHA256 above, 96,672 B).
- Pinned Node 22.23.4 linux/amd64; provenance tool hashes `capture.mts` `bf62ea17…`, `capture.sh` `e6292c2a…`,
  `run-mutants.sh` `6f66c1a0…`, package-lock `991869bd…`; source inventory recorded.

## Limits

1. No real NPC victim case was needed/added; the matrix uses ordinary players and one actual terrain contribution.
2. The `1e-9` boundary itself was not forced by ordinary inputs; no labelled pure-helper boundary diagnostic was added,
   so exact threshold equality remains unproven (ordinary positive-excess/zero-hook cases are covered).
3. Arena placement on the Embers tile is declared setup; the arena ledger row/contribution is the real producer.
4. Bounded seed1 map/seats only; no native/hash equality or broader campaign claim.
