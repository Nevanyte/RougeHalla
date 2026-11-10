# Fourth UI pass evidence (branch `rework/ui4`)

Real captures of the merged Web build (feature/unity-rework 260efe8d plus this branch) against `rh-server` (protocol 16), headed Chromium via
`client-unity/UnityProject/Tools/ui-scenarios.cjs`; JPEG, raw PNGs outside the repo. `crop-*` are tight crops, `full-*` whole frames.

Servers: arena `rh-server --runtime source-arena --map crates/rh-sim/src/mapdata/fixtures/seed1.map.json --bind 127.0.0.1:7977 --min-players 1 --fill-bots 7 --lobby-seconds 5 --fill-seconds 3`;
training `rh-server --runtime training --bind 127.0.0.1:7978 --api-cors-origins http://127.0.0.1:8277 --database-url <throwaway postgres> --new-profiles-per-hour 5000 --new-profiles-per-ip-per-hour 5000`
(built with `--features postgres`; throwaway cluster from `tools/pgtest/start.sh`, `LC_ALL=en_US.UTF-8`, short TMPDIR). Page: `python3 -m http.server 8277 -d client-unity/UnityProject/Build/Web`.

How Training is reached locally: Training is refused in diagnostic mode by design (`MatchHud.Accounts.cs` `trainingReady`), so the page is an ordinary one
(`?accountApi=http://127.0.0.1:7978/api&trainingServer=ws://127.0.0.1:7978/ws&scenario.probe=1`) whose account API is the training server's own
(needs a database and the CORS flag above); the harness clicks the launch screen's Training button.

Diagnostics added (off by default, loopback pages only): `?scenario.probe=1` mirrors delivered state and button rectangles as `window.__rhProbe`
(`Assets/Scripts/Diagnostics/ScenarioProbe.cs`, `RhProbe.jslib`). `?hitzone.demo=1` was used for the hit-zone frame (test data until the weapon table is wired).
Staging notes: damage numbers and the vignette are brief; the vignette flashes only for hits of at least 2 percent of max hp (legacy rule), seen on heavy hits in the full map.
Not captured on screen: natural creature/player fade, Plague corpse, bounty, elites, status glyph bits, Turn-in mark (see `../../UI_VERIFICATION.md`).
