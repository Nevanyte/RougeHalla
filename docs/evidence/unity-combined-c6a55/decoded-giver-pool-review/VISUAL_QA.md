# Neutral giver and reuse visual QA

## Captured result

Reviewed the two native PNGs and their JSON receipts for source `c6a55d3d68d0023e60ace98b55fd23f581217b38`. Both are 2560 x 1440 `ScreenCapture` images captured at end-of-frame in Unity, with an orthographic camera size of 9. The public Unity harness reports 53/53 assertions passed; the exact Editor test gate separately recorded 85/85 passed.

The decoded giver capture uses a synthetic legal wire payload (`kind=4`, kit sentinel `FF`, mob type `0`) that decodes to nullable faction, weapon, and mob type. The visible character is the neutral gray generic silhouette, with a contact shadow, unknown-diamond ground mark, and generic muted rune on a dark square backplate. Faction mantle and faction/role/elite identity badges are disabled. There is no weapon sprite and the recorded sound context is false. The root is at its delivered `ArenaView.WorldPoint` anchor with scale `(1.2, 1.2, 1)`.

The harness also deliberately supplies nonzero synthetic barrier, ring, and signature facts to verify that the reused root updates to those supplied values: barrier 35, ring step 4, and signature bits 1, 2, and 64 are visible. This is not the native Rust giver output: the Rust observer supplies barrier 0 and ring 0. The test distinguishes valid nullable identity from these synthetic secondary facts.

After the giver is removed and the same pooled root is assigned a new actor ID, the second capture shows a Frost player with the female hero appearance, bow cue, Frost mark, idle animation, and current sound context. Its root anchor and scale remain correct. Its current delivered chilled signature and ring step 3 appear, while the giver's burning and execute-blocked signatures do not. The harness explicitly checks that the returned fighter has an idle frame, no stale attack phase, and current Frost/bow sound context.

## Visual observations

The neutral pawn reads as a simple gray upright token rather than a distinct humanoid or quest-giver character. The neutral ground diamond and muted rune avoid a faction-specific mark, though the small rune/backplate still reads as an identity badge when viewed at this scale. No clear sprite overlap is visible in either capture. The giver's signature icons, barrier segments, and health track are grouped closely above the small silhouette, but remain separately readable at 1440p. These shots are centered single-actor inspection scenes with a large blank wall field; they do not establish in-game relative scale or readability in a live arena.

## Scope and open item

These captures exercise a synthetic, legal decoded wire payload in Unity and a public-API presenter harness. They do not include a native server, socket/network session, AI, browser/Web build, or performance measurement. The presentation test verifies one eviction and pooled-root reuse in each direction; it does not cover an actor changing kind under the same still-active ID. That same-ID path remains a separate untested concern from the successful eviction/reuse findings.

Evidence: [decoded giver PNG](decoded-giver-native.png), [reused fighter PNG](reused-fighter-native.png), [decoded giver metadata](decoded-giver-native.json), [reused fighter metadata](reused-fighter-native.json), and [53 public harness assertions](harness-checks.json).
