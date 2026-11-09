# Full walkHint helper source oracle (declared helper contexts + NPC timing kernels)

Status: PASS finite source helper release. This is a bounded actual-source helper corpus for the native
walkHint producer; it does not claim the full native/presentation producer, public delivery, lifecycle or
earned-World coverage. Existing 14-frame World fixtures and all prior evidence remain historical.

## Isolation / heads

- Public base: db5ed80b2b89a156eae09cd0bd3f4c9e77e9e6de; prior sealed source 2547a1c5 / code 440fb567.
- Original 627/8cb 14-frame fixture: parity/walk-hint/source.json, 8cb8b2c2..., 44,372 B (untouched).
- Repaired 14-frame fixture: parity/walk-hint/repair/source.json, 2c95328c..., 44,520 B (untouched).
- New helper branch: deepseek/walk-hint-full-source-helpers, additive from 2547.
- Helper code/tool/corpus head: 24832dac68bc00035572a3f68c909342d4e95ba0.
- Evidence/final head: the branch head containing this README/receipt; reported to Root.
- Clean tree; no merge/push; no native/Rust/Cargo/target/Unity/wire/public/edit.

## Explicit review lease / helper files

Root clarified, after an automatic review refused an otherwise in-scope helper edit, that this branch is
explicitly authorized to create/edit tools/walk-hint-fixtures/helper-scenario.mts, helper-capture.mts,
helper-verify.mjs and helper-controls.mts, plus parity/helper and evidence files. The refused edit was
resubmitted under that exact file lease; no access-mode change, review bypass or blanket approval was used.
The helper files and corpus are committed at the heads above.

## Corpus

- parity/walk-hint/helpers/source.json: 40,317 B, sha256
  a7b8feda1aca08fe20f5a46ee11f57959a2a186619caf73611a67cb086eaae06.
- 69 cases, 0 errors: the existing 51 declared helper contexts plus 18 pure shared timing-kernel rows.
  Families: gates9, positive1, factors6, weapon6, weaponHoldsAt5, lock5, amove3, ice5, hysteresis5,
  direction2, waypoint2, hook2, mirrorTimings18.
- Inputs are explicitly declared helper state (path/weapon/status/history/lock/map/clock) and are labelled
  helper, not earned World history. Results come only from actual imported walkHintOf/weaponHoldsAt/
  updateWalkHints/installed teleported/runEnded hooks and actual shared mirrorTimings; no installed expected
  hint, copied formula oracle or source behavior edit.
- Executed provenance: esbuild bundle 1,074,409 B sha256
  2488d9de64b304dccb323418255ca194da5f5ce06b7571b41efa4b00145c5e54; 14 source-file byte/hash pins;
  profile also references the accepted 90 player timing corpus parity/policy/bot-fight/source.json
  197fe5d2... (46,672 B) without changing it.

## NPC mirrorTimings kernel rows

Six weapons (sword, bow, wand, shield, axe, fists) x three declared pairs:
baseline (as1.0/windup1.0), fast-AS/reduced-windup (as1.5/windup0.5), slow-AS/increased-windup
(as0.5/windup1.5), all actually executed through shared mirrorTimings(profile:"npc") with faction fire.
Observed vectors include, for example: bow baseline interval854.7008547008547 ms/windup600 ms; bow
fast interval569.8005698005699 ms/windup600 ms (NPC ranged base-speed floor retained); wand fast
673.4006734006734/400; axe fast interval793.6507936507936/windup99.2063492063492 and slow
2380.9523809523807/375; all 18 raw interval/windup/root/ranged and ms fields are in the corpus. The
published rows were checked to preserve: fast AS interval lower; NPC ranged fast windup equal to baseline;
melee fast windup <= baseline; slow windup >= baseline. No tolerance/rounding was introduced.

## Genuine runs / controls

- One pinned helper recapture: exit0, 69 cases/0 errors; readonly bytecheck exit0; clean frozen Git export
  of code head 24832dac: bytecheck exit0, same 40,317 B/a7b8feda.
- One real compiled-provenance control run: 6/6 actual semantic mutants KILL via actual-source verifier
  assertions (lock-always-free, amove-never-acquires, ice-never-holds, held-never-held, hook-no-zero,
  hysteresis-always); provenance-only comment NON-KILL with semantics equal and executed onLoad source hash
  changed; pristine/restored bundle and executed provenance equal; baseline disk pins are labelled baseline.
  Errors remain ERROR, not KILL. Controls output chose a fresh explicit outside-Git directory; no deletion.
- One raw retained first control failure is logs/first-controls-failure.log. Earlier exploratory helper
  capture/setup failures were not retained after temporary-directory cleanup; this is the only first-failure
  raw log preserved at this seal. All final runs above are successful receipts, not a relabelling of the
  Docker environment failure from the prior packet.

## Coverage limits / unproved

The corpus is bounded declared-helper evidence, not a full earned arena campaign. Exact goal-moved8,
repath equality, LoS-grace expiry, future reveal/untargetable endpoint isolation, exact hide-to-acquire
ordered fallbacks, and the exact 1e-6 waypoint boundary are not separately asserted; no vector was
fabricated for them. The 51 preserved helper contexts still cover representatives of phase/standing/hidden/
stun/root/path/slip/tiny segment, factors/upper bounds, roots/actions/held, lock free/stop/missing/replan/
future hidden, amove no-target/acquire/hidden, ice centre/thin/clear/home/all, hysteresis old0/delta2/delta3/
wrap255/253, direction rounding, waypoint caps and both installed lifecycle hooks. Native must use the
observed bytes/facts, not infer unproved branches. No full native producer/public/lifecycle/roots/ice/lock/
attack-move/full-brain/map campaign is claimed. Root owns admission and the native worker lease.
