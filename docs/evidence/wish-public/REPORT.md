# P-WISH-PUBLIC-WITNESS-1 evidence (source-only)

Immutable base: `fb738cd93d675d4074b7c37c15de6af2dd837ceb` on branch `deepseek/wish-public-witness-1`.
Original capture commit: `531c775c9298dc5f0bc9d82b931dbd65edb4dbfa`; reviewed original head:
`1e5cea7e57e453c0a5b83854fa91e4380126f5a1`. The terminal-selection repair starts from that exact head on
`codex/wish-witness-repair` in the isolated
`/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/wish-witness-repair/repo`.
The commit containing this repair report is the corrected handoff; no merge or push is made.

This is a bounded source-only witness for the human Wish flow. It changes no production, Rust, C#, Unity, codec,
protocol, version, profile, visibility or precision rule, does not edit existing source/goldens/Cargo.lock/shared
statuses, and is not a native parity, browser, Unity or R-to-server completion claim.

## Files

New only: `tools/wish-public-fixtures/**` (capture.sh, capture.mts, stub-loader.mjs, compare.mjs, apply-patch.mjs,
run-mutants.sh, README.md, mutants/*), `parity/wish-public/**` (five corpora + manifest) and this evidence directory.

## Corpora (canonical `JSON.stringify(corpus)+"\n"`)

| file | bytes | sha256 | captureSha256 | counts |
|---|---:|---|---|---|
| r-input.json | 80716 | 13bf70921c836dbca456afd8aa826182884e845b4bff4ea0e3dfdad49bc484ba | 3a966c82c42e2cb6729f3ce86c2d516cd154d2535df61f764dde975bd2a68b9b | 31 probes |
| queued-stock-clocks.json | 214621 | 6eb80e575d7d684952112828b9ba2318c9a0d9318c7aa59201e70308093373cf | 2b15ec879dbc5809458307fc6b51d3ce96a208687b1b348805235789675ff596 | 9 cases, 121 frames, 94 hook rows |
| fx-timing.json | 61577 | 7f26b51ee987436926dc85826498d0f50de23d18ec6f318d5ad239bb8c03d21b | b7b4804dd45b9669e4113be38cb97a3e7b43f77a0a87a60a5b994f7e6f2a100a | 32 batches |
| wishfx-endpoints.json | 97342 | 5cb0f0f422850c1e6834f146b2b7de4cd96bd70c2a6f8c316e61b9bbfc9b87c5 | ed4be51d00f5eb97a4f0cde77f2b33719dd2ec3059f19d2077aaccc56855718f | 26 cases |
| perceive-wish.json | 64856 | 2ac1419f4869f25e2f3c053843ebdd46eafc08b1e4917a37d5b71296a7c01757 | 76b48dd73be06596c68d4c8a5c0bf5e1326a56474699e7a38cd903fa125168c1 | 14 cases |
| manifest.json | 1424 | fd95df0f829546537c8f669ba9b97ff502f878918e5cb9f0a9fdf2769c4db2ff | n/a (own file) | lists all above |

Profile in every corpus: pinned image digest
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`,
linux/x64 asserts, package-lock/package/tsconfig hashes, imported dependency versions (tsx 4.23.15, esbuild 0.28.2,
@colyseus/schema 5.0.42, @colyseus/sdk 0.18.6, phaser 4.2.1), 266 internal TypeScript source-closure hashes, 29 CSS
hashes, tool/reused-harness hashes and `captureSha256` over the corpus with the profile present.

## Commands and results

```text
bash tools/wish-public-fixtures/capture.sh            # wrote all five corpora + manifest
bash tools/wish-public-fixtures/capture.sh --check    # read-only output; PASS (byte-identical)
bash tools/wish-public-fixtures/capture.sh --check    # read-only output; PASS (byte-identical, same hashes)
bash tools/wish-public-fixtures/run-mutants.sh        # 5 semantic kills; restored control PASS
```

Mutant first mismatches (exact signatures in `tools/wish-public-fixtures/mutants/expected.txt`):

1. `01-armwishes-opening-lock`: queued-stock-clocks.json `/cases/0/frames/0/players/0/wishReadyAt` 45050 -> 44050.
2. `02-fx-batch-time`: fx-timing.json `/batches/0/batchTime` 45050 -> 45049.
3. `03-fx-same-tick-multiplicity`: fx-timing.json `/batches/2/batch/l/6` `[15,4,4,null,800,500]` -> missing.
4. `04-wishfx-cansee-endpoint`: wishfx-endpoints.json `/cases/11/actual/graphics/0/calls/8/call` "setVisible" -> "setPosition".
5. `05-perceive-ext-coordinate`: perceive-wish.json `/cases/0/actual/events/0/data/x` 350 -> missing.

Each is a semantic kill from a compiled/transpiled source mutation, not a compile/runtime failure. The runner restores
every patched file from the read-only mount before the next mutant and reruns the unmutated capture with `--check`.

## Concrete facts

- R input: the actual imported `RaidScene.prototype.castSlot` (private at runtime) ran with a declared receiver; 13 of
  the 31 probes emitted one actual `sendInput(room,"cast",{slot,x,y,id?,seq})` message each (13 messages total; the
  other 18 probes exercised only the refusal/gating paths), with the actual denial texts/cooldown, blocker, target, LOS,
  immunity, pending, teleport-grace, planning, peek, blink and range gates. This is method-level, not
  keyboard/DOM/browser proof.
- Opening lock: `wishReadyAt = raidStartedAt + wishLockSeconds*1000` (45050 = 50 + 45000); t=45000 refused without
  spending, t=45050 accepted. Training arms at 0 and uses the 5000 ms training Wish recharge.
- Blaze stock: accepted casts at 100/150/30100/60100; `wishFullAt` 30100 -> 60100 -> 90100 -> 120100; a charge is back
  at 30100/60100/120100 and full stock at 120100; `wishReadyAt` trails one recharge (100/30100/60100/90100).
- Interruption and fizzle keep the spent cooldown (no refund). A pending freeze is refunded by the arena teleport
  (ready/full clocks back to 50) with an actual `castEnd cancelled` + teleport batch. A room-leave between ordinary
  steps is a real between-step `cancelCast` path (actual `castEnd cancelled` in a between-steps batch).
- FX timing: producer `world.state.serverTime` and the packed batch `t` are equal everywhere in this legacy room path
  (recorded separately; the witness does not force them equal). Instant Wishes emit no Started/Ended. Same-tick
  multiplicity/order is preserved, including two freeze landings in one batch and 7 tuples in one all-five batch.
- Human WishFx (method-level): hidden caster/unit target suppress a telegraph; `land()` is spatial and draws at the
  delivered coordinates without a visible caster/target; Blaze requires BOTH endpoints (hidden origin dropped by the
  play guard, hidden destination released by update); a declared malformed missing destination becomes the source's
  coincident one-point fallback. Own blink is drawn from delivered x/x2.
- Perceive (narrower bot path): a hidden caster's whole ext cue is dropped. A visible caster's hidden unit target has
  `data.target` masked but `data.x/y` (and Blaze x2/y2) retained: this is a labelled SOURCE FINDING for the native
  privacy correction, preserved, not rewritten. A removed caster falls back to the x/y subject anchor but retains `data.by`; a removed target
  id is also copied as a string. These are SOURCE retained-ID disclosures, not anonymity; native mapping/redaction
  remains a distinct correction. Human WishFx and perceive remain distinct outputs.

## Original-head independent verification (Lead, before terminal selection repair)

The Lead re-ran original head `1e5cea7e` independently after delivery. These historical receipts do not certify the corrected terminal selections or current corpus hashes:

- `capture.sh --check` twice with the output mounted read-only: byte-identical both times, same six printed sha256
  values (r-input `190fcef5…`, queued-stock-clocks `794bd790…`, fx-timing `99e11d74…`, wishfx-endpoints
  `505afa8f…`, perceive-wish `36c0e8ed…`).
- Write-mode recapture: the five corpora + manifest stayed byte-identical (`git status` clean).
- `run-mutants.sh`: all five compiled semantic mutants killed with exactly the signatures above; the restored
  read-only control reproduced the corpora byte for byte.
- A separate Lead cross-probe ran the actual `perceive` and `WishFx` methods over its own declared setup: visible
  caster+visible unit target produced two `ext` events with target and coordinates; visible caster+hidden unit target
  produced `data.target = null` with `data.x/y = 350` retained (the labelled source leak); a hidden caster produced no
  event; and Blaze `castLand` gave destination-hidden 1 active after play → 0 after update, origin-hidden 0/0, and
  both-visible 1/1 with 51 recorded graphics calls — matching this corpus.

## Blocked / prerequisites

Nothing in this slice is blocked: the client module graph imported under the declared phaser/CSS stub loader and the
actual `castSlot`/WishFx/perceive/FxChannel paths executed. Remaining required work is separate: the real Unity/browser
R-to-server all-five proof, native Wish/barrier wire implementation and per-step privacy/catch-up, the five strict
source-born NPC-signature cases, and the final union proof. `FxView`'s render-time routing to WishFx is a read-only
anchor; this witness calls WishFx directly and claims method-level results only.

## Corrected terminal-selection handoff

The original two E cancellation projections selected their Started batches despite their terminal case names. This
repair selects actual `teleport-refund-2` and `between-step-remove-2` outputs and recaptures through unchanged source.
The teleport projection observes exactly one `castEnd cancelled` and one teleport at300ms; the between-step projection
observes exactly one `castEnd cancelled` and no teleport at100ms. Both contain zero Started events. Canonical checks
now assert the exact selected terminal batch, producer phase and cancelled-event preservation through producer,
pack/unpack and perceive. State/visibility rows remain declared: no actual Room lifecycle, keyboard, Scene or browser
execution is claimed. Source RaidRoom.onLeave immediately flushes events at its current world time; the witness still
executes the reusable source helper/channel methods rather than the Room itself.

The removed-caster output was never anonymous: its subject anchor falls back to x/y while `data.by="p0"` remains;
removed target `data.target="p1"` also remains. The original outputs are retained unchanged and labelled as SOURCE
retained-ID disclosure. Native spatial admission and optional observer-reference mapping/redaction are distinct
corrections, not a claim of old perceive parity.

Validation of this repair (own isolated checkout): canonical pinned source write + read-only `--check` pass; all five
compiled semantic source mutants produce their existing exact output-mismatch signatures; restored read-only control
passes. Five comparator controls with ONLY `/profile` changed all return IDENTICAL, so source/tool provenance changes
are not counted as semantic kills. The first container startup failed because the fresh checkout lacked its ignored
empty node_modules mountpoint; creating that empty directory allowed the unchanged capture script to run.

Comparison with exact repair base1e5cea7e: all four other corpus bodies are identical after removing `/profile`; all12
other E cases are identical; hidden-target, hidden-caster and Blaze endpoint findings are identical. The two corrected
E cases and terminal-summary/retained-ID finding labels are the only semantic changes. No production source pin
changes and no older corpus bytes change. Current byte counts/hashes above include refreshed tool provenance.
`repair-checks.json` records the comparison and receipts.

These stock cases use no cards and their helper calls use `wishCooldownMult:1`: base/training clocks are witnessed;
modifier-driven effective recharge and live card clock cuts remain separate existing-source/native integration gates.
The complete human/native feature and all five source-born NPC-signature prerequisites remain open as stated above.
