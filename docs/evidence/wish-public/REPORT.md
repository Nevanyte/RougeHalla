# P-WISH-PUBLIC-WITNESS-1 evidence (source-only)

Immutable base: `fb738cd93d675d4074b7c37c15de6af2dd837ceb` on branch `deepseek/wish-public-witness-1`.
Capture commit (tools + corpora): `531c775c9298dc5f0bc9d82b931dbd65edb4dbfa`. The final head is this branch HEAD;
`git rev-parse HEAD` is authoritative. No merge or push is made. Worktree:
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-wish-public` only.

This is a bounded source-only witness for the human Wish flow. It changes no production, Rust, C#, Unity, codec,
protocol, version, profile, visibility or precision rule, does not edit existing source/goldens/Cargo.lock/shared
statuses, and is not a native parity, browser, Unity or R-to-server completion claim.

## Files

New only: `tools/wish-public-fixtures/**` (capture.sh, capture.mts, stub-loader.mjs, compare.mjs, apply-patch.mjs,
run-mutants.sh, README.md, mutants/*), `parity/wish-public/**` (five corpora + manifest) and this evidence directory.

## Corpora (canonical `JSON.stringify(corpus)+"\n"`)

| file | bytes | sha256 | captureSha256 | counts |
|---|---:|---|---|---|
| r-input.json | 80716 | 190fcef53bbd9aabf8fc5ff7c133658e55789ac3bcafaaf41e9ff48053a6a3d2 | 2a484b76cde333080b620b79bef194804a574772c510fb72ba8ecda2faaaee1e | 31 probes |
| queued-stock-clocks.json | 214621 | 794bd790a58aff22ca726ab6cde66abd282aed344f78b9b5c58bd09122349047 | 76f4c1cda401fab7727b916003c5d3c18f055d8497863e34b1aa9be7d844dd77 | 9 cases, 121 frames, 94 hook rows |
| fx-timing.json | 61577 | 99e11d745af9686af5d074d70fd95d82834975546d2110b1e16e630ab8c47c01 | f9f879dcd2eff420c830e398495f264c563333ab9bf2c585691b0c9cc7921013 | 32 batches |
| wishfx-endpoints.json | 97342 | 505afa8f64f758afb74eda498eb84e1dce990c8927118073db938da195da5235 | f585902aa5aa4718138ba5ebcb3943e07c9d6da557cbe78059244a6d1893810d | 26 cases |
| perceive-wish.json | 63884 | 36c0e8ed0463a71f01ab91a7d12066de6fbc3ce9db524c27cef3a1173518b3d8 | f8951cb16e88f70d1c5bd93d21be632df1a26b74f38fb66402606f494b519124 | 14 cases |
| manifest.json | 1424 | eb79f391ce503b3e356f0d784a5cf9439c833f81e34678a24500386a5f7e68ea | n/a (own file) | lists all above |

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

- R input: the actual imported `RaidScene.prototype.castSlot` (private at runtime) ran with a declared receiver; 31
  probes emitted 14 actual `sendInput(room,"cast",{slot,x,y,id?,seq})` messages and the actual denial texts/cooldown,
  blocker, target, LOS, immunity, pending, teleport-grace, planning, peek, blink and range gates. This is method-level,
  not keyboard/DOM/browser proof.
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
  privacy correction, preserved, not rewritten. A removed caster yields an anonymous point from x/y; a removed target
  id is copied as a string. Human WishFx and perceive remain distinct outputs.

## Blocked / prerequisites

Nothing in this slice is blocked: the client module graph imported under the declared phaser/CSS stub loader and the
actual `castSlot`/WishFx/perceive/FxChannel paths executed. Remaining required work is separate: the real Unity/browser
R-to-server all-five proof, native Wish/barrier wire implementation and per-step privacy/catch-up, the five strict
source-born NPC-signature cases, and the final union proof. `FxView`'s render-time routing to WishFx is a read-only
anchor; this witness calls WishFx directly and claims method-level results only.
