# Unity art work checkpoint

The isolated worktree is `/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art`, branch
`codex/unity-art-direction`, based on coordinator-approved `optimization_port` revision `e90a38f6`.
The original checkout is preserved. The lead chat owns integration and shared migration status.

## Implemented source

- `b31115f0`: curated, credited Flare artwork, armor, audio and typography; source preview board.
- `8be43038`: pure XY 2D arena, catalogs, dark mythic HUD, settings, audio, initial browser proof.
- `1ea3f7ef`: latest observation cleanup, renewing NPC reference handling, atmosphere/study polish,
  responsive full-window Web shell and reproducible palette checks.
- `677412f5`: original eight-direction block/hit/death/cast/shoot actions added to stance/run/swing;
  original clip rates, confirmed cue playback and non-looping death frames. Eight Unity tests pass.

No paid art or image-generation assets were acquired; there were no cloud changes, gameplay/protocol/prediction changes, shared-status edits or primary-branch merges.
Impact refinement `ebff286b` replaces occluding solid flashes with brief translucent hollow rings; silhouettes and HP bars remain readable.

Most routine subtasks used Luna, as requested. Only the coordinator-approved MatchClient projection and Fx listener
and renderer-membership hunks are changed; Poll → ReadInput → FlushInput → Present and trace scheduling are retained.

## Exact local build and evidence

Unity 6000.0.85f2 / URP17.0.4 / WebGL2. Latest `RhBuild.BuildWeb()` succeeded at `ebff286b`.
The uncompressed Web distribution is 74,029,313 bytes including notices; exact file hashes are in
`~/.codex/tools/rougehalla-unity-art/evidence/build-manifest.json`.

Root-owned server on 127.0.0.1:18797 (PTY42364), same unchanged gameplay as base e90a38f6:
`rh-server --first-playable --bind 127.0.0.1:18797 --min-players 1 --fill-bots 4 --lobby-seconds 5 --fill-seconds 3`.
Protocol 11, content 801a76cde4cfd305, embedded 48×40 map collision 1c772b5b / metadata 0252d18b.
Review commits `9dd1aee8` and `ebff286b` stop stale voices, invalidate all 80 cards, move visibility refresh into the normal renderer path independent of audio, and clear membership during a resume timeline reset.

Root-owned static server on 127.0.0.1:18897 (PTY68514) serves UnityProject/Build/Web.
The Editor is idle in Edit mode at Pipeline 7800. Avoid Play/heavy work during accepted browser profiling.

Evidence root: `/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/evidence/`.
329 C# tests, source-copy checks, eleven actual Unity EditMode tests, five fail-closed browser-contract tests,
source integrity/palette checks and the 125-cue readiness checker pass.

## Current acceptance work

The final browser runner is owned by Luna `/root/web_showcase_proof`, scoped to
`Tools/showcase-web.cjs` and `Tools/showcase-profile.cjs`. The 19-outcome contract is unchanged and fails closed.
Earlier 18/19 runs validated join, all nine State keys, pickup, potion, world input, settings, reconnect,
results, fresh rejoin, visible mobs, audio unlock and a separate no-socket preview.

Normal camp clearance does not guarantee a reward. The coordinator confirmed the actual route: ordinary
focus/Pickup on observed unopened crates; some create supported Boost options, which expire after 15 seconds.
The proof initially used raw State positions as world coordinates; it now applies the typed C# `/8`
position conversion and navigates the public collision grid with short normal keyboard holds. There is no
server/map inconsistency and no direct-handle/range/LOS bypass. The exact ebff286b runtime passed all 19 outcomes in final-web-impact-eight-seat, with real server-offered choice/build change and no page/decoder errors.

Three fixed-High 2560×1440 normal runs, three native eight-seat runs and three explicitly uncapped diagnostics completed, each with confirmed server hit FX. Max-text-size visual QA passed at 1.50. Portable evidence and measurements are in docs/art/evidence and PERFORMANCE.md. The actual attached main display now reports
E2212F 1920×1080 @ 60 Hz, the only online display. This supersedes the earlier 144 Hz assumption.
A 1440p backbuffer/CPU/GPU diagnostic has been measured; displayed 144 FPS acceptance cannot be established on
that hardware. Record callback cadence separately from renderer submissions and GPU timing.

See [VERIFICATION.md](VERIFICATION.md) for reproduction and [COVERAGE.md](COVERAGE.md) for prepared/live limits.
Only mark the overall goal complete when all required work, including its explicit performance gate, is actually met.
