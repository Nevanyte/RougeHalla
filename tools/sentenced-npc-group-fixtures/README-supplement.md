# P-SENTENCED-NPC-GROUP supplement — capture/runner

Additive supplemental source capture (no edits to the delivered six-case corpus or its scripts).
`capture-supplement.sh` runs the unmodified legacy TS in the pinned linux/amd64 Node 22.23.4 container and writes
`parity/sentenced-npc-group/source-supplement.json`; `--check` requires exact bytes. Env override:
`RH_SENTENCED_NPC_GROUP_SUPPLEMENT_OUTPUT`.

`capture-supplement.mts` uses real `createGameWorld`/`addPlayer`/`step`, normal AI and ordinary player commands. Cases:
(1) a second ordinary Sentenced attacker kills a real camp sibling with real bow attacks after the Mark captured the
original camp size — the frames show original size 5, the dead sibling, the changed current survivors and the source
focus handoff to another live member, then a leash-window attempt; (2) a real Trial Wish cast on an unfocused camp
member while the focus Mark is on another member. A labelled read-only `beforeDamage` ledger tap records actual pulses;
no Mark/death/tier/denial outcome is installed. In the Trial case the captured `trial-after` frames contain the real
source events `status zoned mob1b ms5000 by p2` and `castLand trial`, proving the cast/status on that member; camp-zone
admission/propagation to other members is not claimed. A transient Docker `ENOENT` seen when a pinned capture runs
concurrently is an environment/concurrency capture-setup failure, not a semantic kill; the runner reports it as a
capture failure, never as a mutant kill.

`run-supplement-mutants.sh` is additive and reuses the hardened complete-backup-before-arm discipline (copy every file,
build and verify a size>0 + SHA-256 manifest against both source and backup, arm EXIT/HUP/INT/TERM restoration only
after verification; unique mktemp logs; exact restore with nonzero propagation; SIGKILL explicitly unclaimed). It
compares only `format`+`cases` (provenance-only changes are non-kills) and requires the unchanged new control.
