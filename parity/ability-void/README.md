# Actual-source voided pending Wish companion

Two focused cases execute the unchanged legacy source through the frozen
`tools/ability-fixtures/engine.mts` exported `run(input)`:

- Frost p0 queues a real Freeze for p1, consumes it in an ordinary 50ms step,
  administratively abandons unrelated p2, then executes ten ordinary 50ms steps.
- The same sequence abandons target p1 instead, keeping caster p0 present.

The existing executor's ordinary declared player placement bootstrap supplies
positions and factions; it is input setup, not cast/clock/expected-state injection.
No time jump, artificial pending cast, target disappearance patch, or source edit
is used. Both casts start at100ms, are due at350ms, and remain pending at600ms.
Actual `abandonPlayer` sets `arena.voided`; actual `step` advances time/tick before
`updateActive` returns. The first case retains p1; the second retains the cast's
p1 reference while p1 is absent.

Assertions check accepted queued input, subsequent genuine pending Freeze,
rollback clocks against pre-cast clocks, retained complete cast producer detail,
spent ready/full stock clocks, caster presence, target presence distinction,
voided state, all ten consecutive step boundaries and time beyond landsAt.
They also reject castLand, castEnd/fizzle, post-void gameplay hooks or RNG draws.
Full frames, complete nonempty event/hook tapes and complete RNG tape are captured.
There are24 ordinary steps in total: birth + cast intake + ten voided steps per case.

`frozen-inputs.json` pins the original63-case corpus SHA
`8629c08fa42ac9fb15b21c52416658997c7d8969a6962cf59b71cebedd571330`,
all original source inputs and every original harness file (including unused map
inputs). Capture validates those bytes and complete directory inventories before
executing only these two companion cases. The companion has its own bounded,
complete harness inventory. It never recaptures the63 cases or either map.
`INPUT_SHA256.json` records runtime/compiler/source/harness provenance.

Canonical integrated capture and exact fresh comparison:

```sh
RH_ABILITY_VOID_DIRECTORY="$PWD/parity/ability-void" bash tools/ability-void-fixtures/capture.sh
bash tools/ability-void-fixtures/capture.sh --check
```

Both commands use pinned Linux amd64 Node22.23.4 image
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`.
Capture defaults to a temporary directory unless an output directory is explicit;
comparison defaults to `parity/ability-void`. The runner optionally accepts
`RH_ABILITY_VOID_REPO` for a read-only source root containing the companion, allowing private
proposal verification in a separate source snapshot without root edits.

This is server-private source evidence for reachable ordinary/admin restore
boundaries. It does not prove native restore, runtime parity, field/status overdue
coverage, normal map spawn admission, public observations, or complete gameplay.
Native consumers must replay declared inputs rather than seed expected snapshots.
