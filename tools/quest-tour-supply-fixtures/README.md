# Actual-source quest tour-supply witness

New bounded source evidence for P-QUEST-BACKEND-1, based on optimization_port4151b3af. It captures two actual legacy
createGameWorld traces in pinned Node22.23.4/Linuxamd64. Grand Tour is normally published by the declared salt profile;
a real queued questAccept accepts it. A real ordinary sword attack earns one Frost visit. Declared setup equips the
sword, places the actor and sets one normal Frost mob HP to1. A declared out-of-step batch through the real killMob
producer then removes unwanted regions without a credited killer. Real camp deaths request the recheck. An ordinary
50ms step decides the outcome; no quest progress, visits, publication, recheck, status or deadline is installed.

- Frost visited, Fire+Holy remaining: source keeps the tour open (two fresh regions).
- Frost visited, Frost+Sentenced remaining: source expires it (one fresh region; two required).

Both finish at tick5/time250ms, far before respawn/deadline/endRun. All three human seats remain standing. The two
other humans have zero tour progress, so neither can finish the three-region objective with two live regions.
The source corpus records setup/actions, each relevant frame, all live mob kind/type/brain region/elite/HP,
real supply/camps, quest/giver/container state,
private/public tour facts, GV/farm facts and exact retained Toast/quest-GV events. Source-only: no Rust, Room/socket,
Unity/browser, account persistence or player-fought campaign claim.

Run from this worktree:

```sh
bash tools/quest-tour-supply-fixtures/capture.sh
bash tools/quest-tour-supply-fixtures/capture.sh --check
bash tools/quest-tour-supply-fixtures/run-mutants.sh --write
bash tools/quest-tour-supply-fixtures/run-mutants.sh --check
```

The capture write is followed by two independent bytechecks; each capture internally constructs both Worlds twice
and compares their complete cases. `--check` mounts the output read-only. The source tree/tool mounts are read-only;
only an ignored node_modules mountpoint and container-local tmpfs dependency install are used. A fresh worktree needs
an empty ignored node_modules directory before Docker can overlay that nested tmpfs onto the read-only repo mount.
The pinned image digest and lock/config/tool/dependency/source closure pins are in source.json. The closure is a
conservative static import/export/literal-load graph including type imports, not runtime loader instrumentation.

The semantic control runs a disposable source copy and substitutes Set.size/population count for region membership,
matching the confirmed native mistake. It must reach both reversed post-step quest statuses with all earlier frames
unchanged. A build/runtime failure is a failure, not a kill. The comment-only control must preserve every case/action/
notice while changing provenance. The restored copy must exactly equal the canonical whole corpus and a final
read-only original-source bytecheck must pass. No host/shared source is patched; canonical source.json is never changed
by the mutation runner. It writes only its own new controls.json receipt in --write mode.

The corpus includes fixture salts and private diagnostics for declared offline cases. It does not carry live secrets.
Do not treat raw source aliases as public capabilities in the native consumer. Match their typed fixture provenance.

Initial attempts: the first container failed before execution because the fresh worktree lacked the ignored
node_modules mountpoint. Creating that empty mountpoint allowed capture to start. This is preserved as a setup failure,
not a gameplay failure or passing test. No existing source/corpus/expectation was changed.

During harness preparation, one later bytecheck correctly refused a changed tool-provenance hash after the capture
script was extended while an earlier exploratory capture was running. The final frozen run must complete with no
concurrent tool edits. That exploratory check failure is not relabelled as a pass.
