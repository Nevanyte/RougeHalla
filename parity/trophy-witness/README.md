# `parity/trophy-witness` — pinned actual-source Trophy evidence

Two additive corpora, captured by `tools/trophy-witness-fixtures/capture.mts` from the unmodified source in the pinned
linux/amd64 Node 22.23.4 container (`node:22.23.4-bookworm-slim@sha256:aaa4b5…`):

- `lifecycle.json` — `rh-trophy-lifecycle-source/1`, 6 cases, 72,837 bytes, SHA256
  `33fca3c52564345c80933e33d0f66702a2e7064745a30c2eb7ce3046ec275ef4`: real credited player kills in the four-seat
  player-only/no-mobs weapons-only world, covering trophy birth/hold, location at the killer, option order/owner/expiry,
  owner choose, repeated pick, skip, owner-vs-stranger, out-of-range, expiry boundary, and the empty-investment,
  training and MIA exclusions. Frames record the actual public world state (player hp/status/build/killStats/mobStats/
  campClears, container id/label/owner/expiresAt/options/takenBy/pickers, hit amounts, toasts) and the labelled
  hook-only `rewardOffered`/`rewardChosen` probe.
- `helpers.json` — `rh-trophy-helpers-source/1`, 7 declared-input helper cases, 38,982 bytes, SHA256
  `064bc18599ac8eb516582d50954e0a04abd6485421f4591667338f333ca347d1`: all NINE `KILL_STAT_KEYS` investments/options/
  wording, flat-vs-percentage wording, encode/parse rounding and malformed refusals, ranking/ties/truncation,
  `killAugmentGrant` storage mapping, `killStatEffects` rows and a declared all-nine `combatReadability` case. The file
  metadata says explicitly that these are declared-input helper cases calling the actual shared functions, NOT runtime
  lifecycle outputs.

Both corpora share provenance: image/platform/Node, tool hashes (`capture.mts`
`3fb8d764ef938bea21365f5c89b8663036bb9f2945876bdbbb6948b2e3a97e3c`, `capture.sh`
`618b3b924cf1651fa4d2e6b04f1b5c622d644a0fdaff133f9f251f6bd4552c53`, `run-mutants.sh`
`4c625aeb81187c52c45ad77fcf2bea8b54c21433e5ad1f6ae56cc7e5c627434a`), package-lock hash
`991869bdfbbefb6874220500197c61db302a4d2b2603dfc2288fd7032ce1d481`, the recorded player-only config/modules
profile, map parameters, and all 127 imported source-file SHA256 (digest
`e6efe7f3048659701a589433d1690651e8a43d28aa2610bedad744cc3705e1a1`).

`bash tools/trophy-witness-fixtures/capture.sh --check` re-runs the capture in the pinned container and requires
identical bytes; a separate checker can reproduce the bounded capture and inspect setup/provenance. No native parity
assertion is made: the native consumer does not exist yet (the existing `RewardOption::Kill` omission guard is
untouched).
