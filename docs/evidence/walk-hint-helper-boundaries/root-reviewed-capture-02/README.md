# Root-reviewed capture 02 — finite source-only release

Status: FINITE SOURCE-ONLY RELEASE. Exact Root capture at code 8151b96d177baad5a40fb2fa5854aeb35237040d,
parent a4ece57e4f7e5c233e6c80a8663f43ca99be74b7, preserved in a new additive corpus/evidence commit. This
is not a native/full-producer/public/lifecycle/path-coverage admission.

## Included corpus

- parity/walk-hint/helper-boundaries/source.json: 150406 B, SHA256
  1702ce0a44940709d229161211cbd6ceaf8b0f4ef55c147d3321b3e3ab78e774.
- Copied byte-for-byte from the Root capture 02 file; profile.code is 8151b96... and profile.base is
  70433a98... . The capture profile itself records sourceFileCount 16 and loadedInputCount 127; these are
  the actual included bytes, not a rewritten count.
- 24 cases, 24 unique ids, 0 duplicates. Decisions: goal8 3, repath250 3, losGrace 2, futureVisibility 4,
  amoveOrder 3, waypoint1e-6 3, directionRounding 3, weaponTie 3.
- Direct-direction adjacent kernel transition is observed true. Cartesian/path direction transition is
  observed false with one stored path angle; PATH-TRANSITION COVERAGE REMAINS OPEN, not fabricated.

## Preserved failures / checks

- First failed capture 01 observations-before-verification.json: 145577 B, SHA256
  3ad4fa1e7040c524026f0aab2bd5a816fffbb1effc6421fad7e8fe7774db0daa, copied here with a hash file.
  It contains the rounded LOS elapsed failure before semantic verification and no canonical source.
- Root phase receipts/reviews are copied verbatim under raw-phase/; exact hashes are in MANIFEST.json and
  SHA256SUMS.
- Capture 02 verification.json is copied verbatim: 289 B, SHA256 3eb09901... .
- One independent readonly check reproduced identical 150406 B/1702ce... bytes; raw phase-check receipt is
  included. No rerun by this lane.

## Scope / open items

- The previous original 14-frame World corpus, repaired 14-frame corpus, and 69-row helper corpus retain
  their own release scopes and are byte-untouched:
  8cb8b2c2..., 2c95328c..., a7b8feda... .
- Controls are UNRUN. Frozen-export bytecheck is UNRUN. Native 24-row consumption/parity is UNRUN. Full
  brain/gameplay/public/native/lifecycle/path coverage is OPEN.
- No build, world/source execution, semantic verification, Docker, Rust, Editor, compiler, scenario/runtime
  tool or JS execution was performed by this lane. Only file copy/hash/count/verify/Git operations.
- The two Root offline directories, including prepared/scenario.mjs and caches, are preserved untracked and
  are NOT committed here. No old evidence or raw receipt was overwritten.
- Code provenance in this receipt is exactly 8151b96...; no later-head substitution is claimed. The new
  commit adds only this corpus and compact evidence.

Historical helper69 correction (outside this boundary corpus bytes): the helper69 release's actual
source-file count is 17 (its prior receipt/README said 14), and the player90 corpus is 467672 B (the prior
README typo said 46672). Those two prior releases retain their own scope. This boundary capture profile
itself records sourceFileCount16/loadedInputCount127 and is not rewritten.
