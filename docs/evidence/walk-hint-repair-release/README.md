# WalkHint source repair — repaired finite source release

Status: PASS repaired finite source release. Same 14-frame actual-source unlocked Move/Stop/waypoint
slice; bounded repairs to control-output safety, executed-mutant provenance and the accepted seq5 input
record are implemented and demonstrated. Original 627/8cb fixture and evidence remain historical and
untouched; the ENV-BLOCKED WIP evidence remains preserved separately. No native/Rust/Cargo/target,
Unity, wire/protocol/public, lifecycle/end/teleport/root/ice/lock/attack-move or broader campaign claim
is made.

## Isolation / heads

- Public base: db5ed80b2b89a156eae09cd0bd3f4c9e77e9e6de.
- Original sealed source: 627ba6c461167b54dd3f51ac0e6d221a6aafba0a (code
  563eb298a0f8537c8f0af9e783a21a6750641b26; fixture 8cb8b2c2..., 44,372 B).
- Preserved ENV-BLOCKED WIP: code 450079d1337555e605a5f22a5a9b885ee7b12310; evidence
  c4f0c798628bd58e275d0efa04a85aa095b74fe7. First 125/raw blocker and static WIP receipt remain in
  docs/evidence/walk-hint-repair/ and were not modified.
- Repair branch: deepseek/walk-hint-source-repair.
- Repaired code/tool/fixture head: 440fb5676d7a2127a90304862174af5666a32d64.
- Evidence/final head: the branch head containing this README/receipt; reported to Root.
- Clean tree; no merge/push. Old branch deepseek/walk-hint-source remains at 627.

## Recovered runtime / image

- Root-recovered exact pinned image: node@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
  (linux/amd64), Node v22.23.4/linux/x64. The source run now asserts this runtime; the fixture records it.
- The first capture under the old image had failed with a containerd blob input/output error; that raw
  first result and no-retry WIP history are preserved separately. No Docker reset/prune/deletion was used.

## New repaired fixture and declared changes

- New file: parity/walk-hint/repair/source.json, 44,520 B, sha256
  2c95328cc86136f55eda8f3fec641a9db081e77721d936ed614294f9aa4e0c4a. 14 frames; hint sequence
  0,3,3,3,3,0,3,3,3,3,2,1,0,0; cap3, nonzero direction, small-turn hysteresis, 10-degree transition,
  Stop zero and waypoint-end zero all reproduced.
- Old fixture remains parity/walk-hint/source.json, 44,372 B,
  sha256 8cb8b2c24fe0be184e660a4670b0981b946c35782d9e7a47ae1ba3eff567ab77 (0 diff vs 627).
- Independently compared old/new payloads: equal except exactly two declared changes:
  1. profile.image is the recovered image digest (provenance pin change);
  2. frames[6] (waypoint-0) now retains the actual accepted seq5 Move
     {x:266.6605407841042,y:244.90201014713688,seq:5,accepted:true} instead of a missing order record.
  Hint sequence, ordered events, paths, player mirrors and all other frames are unchanged; no frame or
  action was added.
- Source pins remain baseline: walkHint.ts 9030f17e7e76a5dda94bba76347e2993a5265d8d36e145b9d1f889f3f988af16
  (10,241 B), gameplay.ts 70f6f2b6..., package-lock 991869bd....

## Genuine repaired runs

- One pinned recapture: exit 0, 14 frames, fixture 2c95328c...; verify PASS.
- One readonly --check: exit 0 on read-only canonical mount, exact bytes/verify.
- One real compiled-provenance controls run with a fresh explicit outside-Git output: 3 semantic mutants
  KILL via actual verifier assertions (forced-zero, wrong-cap, hysteresis-always); compiler/setup errors
  remain ERROR by construction. Provenance-only comment NON-KILL: semantics equal, onLoad executed source
  hash changed (a4f33625...) while the produced bundle hash is unchanged (e444e5b1...) because esbuild
  strips comments; pristine and restored bundle hashes/provenance agree (e444e5b1..., onLoad count 1,
  expected path /repo/packages/server/src/sim/walkHint.ts). All rows bind original/executed source bytes+
  hashes and produced bundle hashes; canonical profile pins are labelled baseline.
- One fresh frozen Git export of code head 440fb567: --check exit 0, same 44,520 B/2c95328c... bytes.

## Verification / evidence

- Focused verifier requires accepted seq5 Move on waypoint-0, all prior hint/path/event facts, replay
  equality and cap/path shape. Raw capture/check/controls/frozen/old-new-diff logs are tracked under
  docs/evidence/walk-hint-repair-release/logs/**; SHA256SUMS verifies from the Git tree.
- Output guard (fake-repo sentinel test) PASS: fresh default outside Git; canonical old/new and existing
  caller destinations refused; no recursive deletion. Guard log is included here and also in WIP evidence.
- Static TS/shell syntax checks pass; source execution itself is the pinned Docker run above.

## Explicit limits

- Only the finite 14-frame actual unlocked Move/Stop/waypoint presence producer. Teleported/runEnded
  zeroAll lifecycle was not executed; combat/weapon roots, ice, lock, attack-move, future visibility and
  all other branches remain unproved and separate.
- No native/Rust/Cargo/target, Unity, wire/protocol/public publication, shared status/lock or broad
  campaign. Root owns admission and the next lease; this lane stops at the repaired source seal.
