# Wish-public source witness (P-WISH-PUBLIC-WITNESS-1)

Canonical actual-source capture of the legacy human Wish flow for the private protocol12/Observation18 candidate.
Evidence only: this tool changes no production, Rust, C#, Unity, codec, protocol, version, profile, visibility or
precision rule, and it does not implement or duplicate the private native Wish/barrier corpus.

The capture runs in pinned `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`
with `--platform linux/amd64`: the repository is mounted read-only at `/repo` (its ignored `node_modules` is a writable
tmpfs), this tool directory is read-only at `/capture`, and the output is mounted at `/out` (`readonly` for `--check`).
Setup is `npm ci --ignore-scripts --no-audit --no-fund` and `node --import tsx`.

```sh
bash tools/wish-public-fixtures/capture.sh            # write parity/wish-public/{r-input,queued-stock-clocks,fx-timing,wishfx-endpoints,perceive-wish,manifest}.json
bash tools/wish-public-fixtures/capture.sh --check    # compare every byte (output mounted read-only)
bash tools/wish-public-fixtures/run-mutants.sh        # five compiled semantic mutants + restored control
```

`RH_WISH_PUBLIC_OUTPUT` redirects the output; the path must stay inside this isolated worktree. Canonical
serialization is `JSON.stringify(corpus) + "\n"`; every corpus carries `profile` with the pinned image digest, the
Node/linux/x64 asserts, sha256/bytes of `package-lock.json`, every package manifest and `tsconfig`, the versions of
the imported npm packages, the sha256 of the actual internal TypeScript source closure (266 files) and CSS closure
(29 files), the tool/reused-harness hashes and `profile.captureSha256` (over the corpus with the profile present and
`captureSha256` absent). `manifest.json` lists every corpus byte/sha256/captureSha256 and its bounded counts.
Numeric specials are tagged (`{tag:"NaN"|"+Inf"|"-Inf"|"-0"|"absent"}`); `null` is only a genuinely optional/absent
field, never a valid zero.

## Corpora

| file | bounded counts | content |
|---|---:|---|
| `r-input.json` | 31 probes | The real `RaidScene.prototype.castSlot.call(declaredReceiver, "wish")` (private at runtime, body not copied) with a declared receiver: room state/session/reconnection/`send` recorder, actual `LocalPrediction` (nextSeq/noteCast/motion), actual `cursorGround/targetCandidates/planMap/localClock/beforeTeleport/slotInput/frozenWorld`, actual `CooldownTracker`, declared `slotView`, `afterCast`, `wishFx.predictCast`, camera/pointer. Records the exact sent `{slot,x,y,id?,seq}` message, `pendingCast`, slot-input/model/denial, prediction calls and the pointer-derived aim for ready/not-ready boundaries, LOS, range, immunity, dead/stun/silence, pending unanswered/answered, planning, minimap peek, self/unit/point targeting, no target, blink landing and no-direction, teleport grace, synced clock, training, reconnecting, missing view and empty slot. |
| `queued-stock-clocks.json` | 9 cases, 121 frames, 94 hooks | Reused actual `tools/ability-fixtures/engine.mts` `run()` (real `enqueueClientMessage` + ordinary 50 ms `step`) over `normal-45s-lock-ready-boundary`, `all-five-normal-cooldowns-and-blaze-stocks`, the interruption and fizzle cases, the training swarm case, and three declared scenarios (teleport refund, between-step room-leave cancellation, training Blaze). Per frame/player: `wishReadyAt`, `wishFullAt`, `slotReadyAt`, max charges, actual `chargesAt`/`nextChargeAt` over the observed clocks, pending `rt.cast`, emitted Wish fx. Accepted/ended hook arguments carry the raw clocks at the producer. |
| `fx-timing.json` | 32 batches | The real `FxChannel.batch` calls of those runs (roster/patch order as the room does), each paired with the actual nonempty event tape entry: producer emission world time, packed `t` and tuples, roster, and actual `unpackFx`. Includes single and multi-event same-tick batches, two-landing multiplicity/order, instant Wishes (no synthetic Started/Ended), a real between-step cancellation batch and training recharges. |
| `wishfx-endpoints.json` | 26 cases | The real `WishFx.prototype.play/update` with a declared `scene.add.graphics()` recorder and declared host `canSee/position/hidden/localId`. Records host calls, active-effect mutations and every graphics call for freeze/swarm/trial/blaze/lastStand cast/land/end/status; visible/hidden caster and unit target; each Blaze endpoint individually hidden; both visible; own blink; absent/removed caster/target; old start/end batches at a later `now`; and a labelled declared malformed Blaze landing with no destination. |
| `perceive-wish.json` | 14 cases | The real `perceive()` over declared source-schema-shaped projection rows (built from the actual all-five public states at the batch time) and the real packed batches of `fx-timing.json`, decoded by perceive's own `unpackFx`. Covers visible/hidden caster, visible/hidden unit target, both hidden, each Blaze endpoint point-hidden, own blink, removed caster/target, historical batch and interruption/teleport/between-step batches. |

## Declared inputs vs actual outputs

- **R input**: the method and its helpers are the imported source; the receiver, state rows, pointer, camera and recorders
  are declared. No scene, DOM, browser, keyboard or real camera is created. `stub-loader.mjs` replaces `phaser` with a
  declared minimal base-class module (the imported file declares `extends Phaser.Scene` at module evaluation) and every
  `*.css` with an empty module. `performance.now()` is a declared deterministic clock, so `pendingCast.until` is stable.
- **Runs**: player factions/positions/config/actions are declared; the ordinary 50 ms world execution, clocks, events and
  batches are actual. Helpers (`slotReadyAt`, `maxCharges`, `abilityCooldownMs`, `chargesAt`, `nextChargeAt`) are the
  actual shared functions called over the clocks the world emitted; they are labelled beside the raw state fields.
- **WishFx**: events are real `TimedFx` from `fx-timing.json` except the explicitly labelled declared status and
  malformed-destination probes. The graphics object is a recorder, not Phaser; no renderer or pixel proof follows.
- **perceive**: rows/visibility are declared; `perceive`, its `unpackFx` call and every observation are actual.

## Actual facts established

- Opening lock: `wishReadyAt = raidStartedAt + wishLockSeconds*1000` (45050 = 50 + 45000); the t=45000 press is
  refused without spending and the t=45050 press is accepted; training arms at 0 and its Wish recharge is 5000 ms.
- Blaze stock: accepted casts at t=100/150/30100/60100; `wishFullAt` moves 30100 -> 60100 -> 90100 -> 120100;
  a charge returns at 30100/60100/120100, full stock at 120100; `wishReadyAt` follows one recharge behind.
- Interruption and fizzle keep the spent cooldown (no refund); teleport cancels and refunds a pending freeze
  (`wishReadyAt`/wishFullAt back to the pre-cast 50). A room-leave between steps is a real between-step cancel path.
- FX: producer emission time and packed batch `t` are equal in this legacy room path (presentation runs after the step);
  they are recorded separately and a future difference is not prevented. Instant Wishes emit no Started/Ended. Same-tick
  multiplicity/order is preserved (including two freeze landings in one batch).
- Human WishFx: a hidden caster or hidden unit target suppresses the telegraph; `land()` is spatial and draws at the
  delivered coordinates even without a visible caster/target; Blaze's update requires BOTH endpoints (a hidden origin is
  dropped by the play guard, a hidden destination is released by update); a malformed missing destination becomes the
  source's coincident one-point fallback. Own blinks/cast landings are drawn from the delivered x/x2.
- Perceive: a hidden caster's whole ext cue is dropped; a visible caster's hidden unit target has `data.target` masked
  but `data.x/y` (and Blaze x2/y2) retained. This is a **labelled source finding for the native privacy correction**,
  not rewritten. For a removed caster the subject anchor falls back to x/y, but `ext.data.by` still retains the removed id; a removed target id is also copied as a string. This is a SOURCE retained-ID disclosure, not anonymity; native observer mapping/redaction is a separate correction.
  Human WishFx output is a separate corpus and is not claimed to equal perceive.

## Semantic mutants

`run-mutants.sh` copies the repository to a writable `/tmp/repo`, restores every patched file from the read-only
`/repo` before each mutant, applies the exact unified diff with `apply-patch.mjs`, and recaptures with
`RH_WISH_PUBLIC_RECORD=1` (source assertions become recorded booleans; the comparator is not weakened). `compare.mjs`
reports the first JSON-path mismatch, skipping only `/profile` (a mutant necessarily changes the mutated file's hash).
A compile/syntax/runtime failure is not a semantic kill. After the five mutants the runner re-runs the unmutated
capture with `--check` against the checked-in corpora. `mutants/expected.txt` holds the exact first-mismatch
signatures; `RH_WISH_MUTANTS_DISCOVER=1` prints observed signatures without enforcing them.

## Boundaries and remaining prerequisites

This is a method-level source witness: it does not claim a real Unity R-to-server all-five proof, a browser/DOM/keyboard
run, a native parity result or full ability/NPC completion. `FxView`'s render-time routing to WishFx was read as the
source anchor but not constructed here (D calls `WishFx` directly, method-level only). The five strict source-born
NPC-signature cases, full native Wish/barrier wire/native implementation, per-step privacy/catch-up and the final
Unity/client proof remain separate required work. The source's hidden-target coordinate disclosure is preserved as a
finding for that native correction.

## Terminal selection repair

The two cancellation perception cases select the actual `teleport-refund-2` and `between-step-remove-2` batches,
not their start-only predecessors. `findings.terminalBatches` records source, decoded and observed cancelled-event
counts, original times and producer phase. Canonical assertions require the exact terminal selection, one real
`castEnd` with reason `cancelled`, no Started event, and the teleport marker only for teleport. They prevent a
mislabelled start-only projection from satisfying a cancellation claim. These are actual outputs over declared
projection rows; no real Room lifecycle, keyboard, scene or browser is run. The raw source producer/batch tapes are
unchanged by this correction.

The stock probes contain no cards and use `wishCooldownMult: 1`: they establish base and training recharge behavior,
not modifier-driven effective recharge or live card clock cuts. Those source/native integration gates remain separate.
