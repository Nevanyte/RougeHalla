# P-SENTENCED-NPC-HOLY-CASES — NPC-human component cases (seam A)

Source-only continuation on `deepseek/p-sentenced-npc-holy-cases` from sealed head
`c5185b9d5446f1ac255521f02f950c568828af18`. Only NEW files under tools/**, parity/** and docs/evidence/**; all frozen
corpora/scripts and strict Wish corpora remain byte-identical. No native or second-kernel implementation.

## Actual case matrix

Both cases use real `createGameWorld` on generated map seed1 with declared players and catalog Holy camps, real AI and
ordinary attack commands/50 ms steps. The Holy NPCs are non-Sentenced human-faction components.

| Case | Real producer boundary | Observed Mark/component facts |
|---|---|---|
| `holy-npc-melee-component` | Holy camp43 melee `mob64` (sword); p0 Sentenced attacks with ordinary sword input; Holy NPCs wake via camp AI | p0 owns Mark `target mob65`, `group camp:43`, `groupSize 3`, tier4, hits27/progress27; ordered pulses p0→`mob63/mob64/mob65` raw 20.7544 each; `mob64` itself has target `p0` but `group:null,tier0,hits0` (no NPC Mark ownership) |
| `holy-npc-ranged-component` | Holy camp41 ranged `mob5u` (wand); p0 Sentenced attacks with ordinary bow input; real AI fight | p0 owns Mark `target mob5u`, `group camp:41`, `groupSize 4`, tier1, hits1/progress1; ordered pulses p0→`mob5u/mob5v/mob5w/mob5x` raw 21.138462 each; `mob5u` Mark fields empty (no NPC Mark ownership) |

Exact source IDs/camp/faction/weapon, Mark origin/target/group/size/hits/progress/tier, pulse order/raw amounts and
public/private frame records are in the corpus. The local paces are ordinary one-hit increments without Gathering
Storm (`progress == hits`), and the pulse rows are the actual source ledger/pulse records captured by the labelled
read-only tap; no expected values were installed.

## Important producer-boundary limit

The requested literal **NPC-owned** Mark from a non-Sentenced Holy NPC is **not a source domain**: Mark ownership in
the source is Sentenced-only, and the Holy NPC fighter records in these frames have empty `group/tier/hits/progress`.
What is genuinely witnessed is the other component side: a real Holy melee/ranged NPC as the **Mark target component**
of a Sentenced player-owned Mark, while the Holy NPCs fight the player through ordinary AI. This is the seam-A
component evidence available from the admitted source; a Holy NPC owning a Mark would require an invented producer and
is not claimed.

## Checks / provenance

New corpus `source-holy-components.json`, `rh-sentenced-npc-group-holy-components/1`, 2 cases, 156,324 bytes, SHA256
`d1129f2d862da97d17dd90ea84105f04206a8728fd03c6be376fa5f461d1bd40`; `capture-holy.sh --check` byte-identical.
Pinned Node 22.23.4 linux/amd64; corpus provenance tool hashes `capture-holy.mts` `a4ac0f8a…`, `capture-holy.sh`
`05706000…`, `run-holy-mutants.sh` `fffee445…`; package-lock `991869bd…`; all source files recorded. Existing
`source.json` (SHA256 `3808dac2…`), `source-supplement.json` (`292496f0…`), their scripts/READMEs and the five strict
Wish corpora are untouched.

Two targeted actual semantic mutants tied to these component cases are killed by actual runtime-output mismatches
(2/2): `01-wrong-regional-pool` (regional Faction sheet HP vs target maxHP) and `02-wrong-role-weapon-pace` (shared
markWeight drops weapon role/attack-interval terms). The new runner uses complete checked backups before arming
EXIT/HUP/INT/TERM, unique mktemp logs, exact restoration/nonzero propagation, and no SIGKILL claim; unchanged control
passes. A comment-only provenance mutation produced identical runtime cases/differing provenance and is a non-kill.

## Limits

1. NPC-owned Mark from a non-Sentenced Holy camp is unreachable and is reported, not invented; only the target
   component is witnessed.
2. These are bounded map seed1 camp cases; no broader map/campaign, native/hash equality, replacement-kernel or
   final content/format claim is made.
