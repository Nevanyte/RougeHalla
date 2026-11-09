# Corrected seam A — Sentenced NPC-owned Mark -> ordinary Holy human target

Source-only continuation on `deepseek/p-sentenced-seam-a-holy` from immutable base
`6534fb0ecc7aa1d061296095bb86fc372dd2f613` (the earlier Holy-recipient work is preserved as optional seam-B
recipient evidence; it is not used to close seam A). New files only; frozen corpora/scripts/READMEs unchanged.

## Direction and producer boundary

The capture asserts the required real direction in its own code and records it in each case's `direction` metadata:
the Mark **source is a real Sentenced catalog NPC** (camp melee `sword` or ranged `bow`), the **recipient is the
ordinary Holy human player p1**, the source NPC's Mark is nonempty (`target p1`, `group fighter:p1`, tier/hits/progress
>0), and the Holy human owns **no Mark** (group null, tier/hits/progress 0). The Holy human only shoots the NPC to wake
real camp AI; every hit/Mark/pulse outcome is produced by ordinary source runtime. No expected outcome is installed.

## Cases (actual source facts)

| Case | Source actor/camp | Direction | NPC-owned pace/pulse facts |
|---|---|---|---|
| `sentenced-npc-melee-marks-holy-human` | Sentenced camp20 NPC `mob3i`, sword | NPC faction `sentenced`; recipient Holy p1; NPC Mark target `p1`, group `fighter:p1`, size1, tier3, hits7/progress7; human Mark absent | ordered pulses by `mob3i`, `mob3j`, `mob3l`, `mob3k` (etc.) to p1, each raw 30.390698; p1 remains alive (hp 4394.26) |
| `sentenced-npc-ranged-marks-holy-human` | Sentenced camp17 NPC `mob36`, bow | NPC faction `sentenced`; recipient Holy p1; NPC Mark target `p1`, group `fighter:p1`, size1, tier3, hits6/progress6; human Mark absent | ordered pulses by `mob36`, `mob37`, `mob3a`, `mob38`, `mob39` (etc.) to p1, each raw 29.243077; p1 remains alive (hp 4370.29) |

`progress == hits` in these bounded cases (no MarkRate card/chill), and the recorded pulse amounts are the actual source
ledger/pulse rows. The selected NPC's Mark is the requested singleton `fighter:p1`; other live Sentenced camp members
also pulse p1 as source group siblings, which is recorded as-is and does not change the NPC->Holy direction.

## Checks / mutants

New corpus `parity/sentenced-npc-group/source-seam-a-holy.json` (`rh-sentenced-seam-a-holy/1`, 2 cases, 140,255 B,
SHA256 `88dc9f5d8a54df280d05be0f19390019a3bae6161edc5754b2523c699f133375`); `capture-seam-a.sh --check`
byte-identical. Pinned Node 22.23.4 linux/amd64; provenance tool hashes `capture-seam-a.mts` `1067c6a5…`,
`capture-seam-a.sh` `91f559ee…`, `run-seam-a-mutants.sh` `0b4973fc…`; package-lock `991869bd…`; all source files
recorded. Frozen `source.json` (`3808dac2…`), `source-supplement.json` (`292496f0…`), `source-holy-components.json`
(`d1129f2d…`) and all their scripts/READMEs are unchanged.

Two targeted actual semantic mutants tied to these new cases are killed by actual runtime-output mismatches (2/2):
`01-wrong-human-faction-pool` (region sheet HP instead of the Holy human's maxHP for the pulse pool) and
`02-wrong-npc-role-weapon-pace` (shared markWeight drops weapon role/attack-interval terms). The new runner uses
complete checked backups before arming EXIT/HUP/INT/TERM, unique mktemp logs, exact restoration/nonzero propagation,
and no SIGKILL claim; unchanged control passes. A comment-only provenance mutation produced identical runtime cases/
differing provenance and is a non-kill.

## Limits

1. These are bounded generated-map seed1 catalog-camp cases; no broader map/workspace campaign, native/hash equality,
   replacement-kernel or final content/format claim is made.
2. The earlier Holy-recipient corpus (`source-holy-components.json`, task-102) is explicitly optional seam-B recipient
   evidence and is not seam A.
