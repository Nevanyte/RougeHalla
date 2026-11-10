# Launch screen evidence

Captured with `client-unity/UnityProject/Tools/hud-shots.cjs --steps launch --out docs/rework/evidence/launch --prefix launch` against
the Web build served at `http://127.0.0.1:8147/` and `rh-server --runtime source-arena` on `127.0.0.1:7847`
(`RH_SHOTS_URL=http://127.0.0.1:8147/ RH_SHOTS_WS=ws://127.0.0.1:7847/ws`), at 1280x800, 1920x1080, 2560x1440 and 1280x800 @2x.

| Shot | What it shows |
|---|---|
| `first-visit` | The normal player path: no query parameters |
| `custom-server-link`, `custom-server-play-blocked` | `?server=ws://...` on another origin: the player-worded reason (the policy itself is unchanged) |
| `hub`, `faction-*` | Diagnostic (loopback) hub; each faction pick moves the backdrop to that faction's region |
| `keyboard-focus`, `keyboard-focus-actions` | Tab order and the cream focus ring |
| `walking-near-counters`, `e-opens-station` | WASD walk and `E` at a station |
| `station-*`, `profile-records`, `champions-guide`, `resume`, `signin` | Every station and dialog (account API absent on the static test server, so panels show their signed-out states) |
| `training-unavailable`, `training-disabled-reason` | Disabled Training with its reason |
| `connecting`, `cancelled` | A launch held pending (the WebSocket opens, the server stays silent) and Cancel |
| `connection-failed` | An unreachable server |
| `play-planning`, `play-match`, `play-again-planning` | START RUN reaches planning and a match |
| `return-to-menu` | Leave from the in-match settings card returns to the launch screen |

The static test server returns 404 for `/api/*`, which the browser logs as the only console error in the plain-visit run.
