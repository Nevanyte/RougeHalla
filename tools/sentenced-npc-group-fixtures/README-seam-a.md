# P-SENTENCED-SEAM-A-HOLY — corrected seam-A capture/runner

Additive new capture; all frozen corpora/scripts/READMEs stay byte-identical. `capture-seam-a.sh` runs unmodified
source in the pinned linux/amd64 Node 22.23.4 image and writes `parity/sentenced-npc-group/source-seam-a-holy.json`;
`--check` requires exact bytes. Env override: `RH_SENTENCED_SEAM_A_OUTPUT`.

`capture-seam-a.mts` uses real `createGameWorld`/`addPlayer`/`step`, generated map seed1, catalog **Sentenced** camps and
ordinary inputs. A real Holy human p1 attacks a Sentenced melee/ranged NPC with a bow merely to wake real camp AI; the
Sentenced NPC then owns a singleton Mark on that Holy human. No Mark/hits/damage/death/return/reward/native outcome is
installed. The capture itself asserts direction: source NPC faction `sentenced`, recipient human faction `holy`, source
NPC Mark nonempty (`target p1`, it `fighter:p1`, tier/hits/progress >0), human Mark absent (group null, tier/hits/
progress 0). Recorded frames include both fighters, camp mobs, IDs, public/private state, ordered pulses and events.

`run-seam-a-mutants.sh` is new and uses the hardened complete-backup-before-arm discipline (complete manifest, nonempty+
SHA-256 verification, EXIT/HUP/INT/TERM traps armed only after verification, unique mktemp logs, exact restoration,
nonzero failure with retained recovery, no SIGKILL claim). Mutants: `01-wrong-human-faction-pool` (region sheet HP for
the Holy human target) and `02-wrong-npc-role-weapon-pace` (markWeight drops weapon role/attack interval). Provenance-only
changes are non-kills; unchanged control required.
