# P-SENTENCED-NPC-HOLY-CASES — seam-A component capture/runner

Additive new capture (no edits to frozen corpora/scripts). `capture-holy.sh` runs unmodified source in the pinned
linux/amd64 Node 22.23.4 image and writes `parity/sentenced-npc-group/source-holy-components.json`; `--check` requires
exact bytes. Env override: `RH_SENTENCED_NPC_GROUP_HOLY_OUTPUT`.

`capture-holy.mts` uses real `createGameWorld`/`addPlayer`/`step`, generated map seed1, three declared players
(Sentenced p0, Holy p1, Sentenced p2), catalog Holy camps and real AI; ordinary bow/sword attack commands and 50 ms
steps. Cases select a real Holy (non-Sentenced human) **melee sword** and **ranged wand** NPC component. The corpus
records the selected NPC/camp/faction/weapon, player Mark origin/target/group/size/hits/progress/tier, per-member pulse
rows with exact raw amounts/order, NPC fighter state (including the fact that a non-Sentenced NPC owns no Mark), IDs and
events. A labelled read-only `beforeDamage` ledger tap records actual pulses; no Mark/hits/damage/death/return/reward/
native outcome is installed.

`run-holy-mutants.sh` is new and reuses the hardened complete-backup-before-arm discipline (copy every file, build and
verify a size>0 + SHA-256 manifest against source and backup, arm EXIT/HUP/INT/TERM only after verification, unique
mktemp logs, exact restore with nonzero propagation, no SIGKILL claim). It compares only `format`+`cases`
(provenance-only changes are non-kills) and requires the unchanged new control. Two targeted actual semantic mutants:
`01-wrong-regional-pool` (server Faction HP pool vs target maxHP) and `02-wrong-role-weapon-pace` (shared markWeight
drops weapon role/attack-interval terms).
