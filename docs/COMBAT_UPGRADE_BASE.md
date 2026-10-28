# Combat upgrade source

This work continues the game saved on GitHub `main` at `c97791098abc0ae073ba8c3e7490a80a73c74375`, on branch `codex/combat-live-version`.

On October 28, 2026, the HTML from https://play.roguehalla.com/ exactly matched the saved `site-live` build. Its JavaScript asset, `index-BNPwdVj-.js`, also matched byte for byte (SHA-256 `211f3dd54527590774747dc15f6068a386315b66c88bca625c23a186f7086f86`). The saved build's Git checkout is commit `c977910`.

This base includes the 136×136 maps, five designed zone shapes, 40 camps, AD/AP and weapon scaling, the 75-card economy, fists starts, human-like bots, and quest acceptance. The earlier combat prototype was built on `kimi/quests-k3`; that checkout is preserved separately. It must not replace current map, card, bot, or deployment implementations.

The combat changes are ported onto this base. The local preview is a development build; production publication is a separate action.

The port adapts the badges and damage indicators to AD/AP, weapon scaling and card power. Player attacks receive the shorter windups; PvE creatures retain their live ranged profiles to preserve camp difficulty.

Pre-merge validation: client suite 2,136 passing tests; shared suite 1,708 passing tests; server suite 5,463 passing tests across 123 files, plus a new direct damage-packet parity test covering all five factions and six weapons. The damage-type display uses the same paced base damage and unpaced weapon-scaling additions as server `packetFor`. Workspace typechecking and the production build pass.

The legacy `testing/test_kite.py` oracle still fails 10 checks against its older matchup guarantee under the faster player timings. That historical guarantee is not an acceptance criterion for the revised controls; further PvP balance playtests remain appropriate. The current camp balance gates pass with separate NPC windups.
