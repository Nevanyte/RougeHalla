# HUD skin evidence

`skin-<w>x<h>-dpr<n>-<step>.jpg` are real-browser captures (headed Chromium, real GPU) of the Unity Web player from
`client-unity/UnityProject/Tools/hud-shots.cjs`: hub, planning (before and after picking a spawn), in-match HUD, settings card, help card
and the held-Tab map, at 1280x800, 1920x1080, 2560x1440 (devicePixelRatio 1) and 1280x800 at devicePixelRatio 2. `*-console.log` is the page console.
`defect-*.jpg` are the earlier defects this work fixes.

Reproduce: build the server (`cargo build --release -p rh-server`) and run it with `--bind 127.0.0.1:7817 --min-players 1 --fill-bots 7
--lobby-seconds 5 --fill-seconds 3`; build the player with `RH_SERVER_INFO_URL=http://127.0.0.1:7817/info client-unity/UnityProject/Tools/build-web.sh`;
serve `Build/Web` on 8117 (the page host must be a literal loopback IP such as 127.0.0.1, not `localhost`, or the diagnostic join is refused); run the script.

Not captured: the death line, chest panel, toasts and banners (no way to force them from the browser); they are covered by layout tests only.

## Map pass (`map-*.jpg`, `map-*-walk.json`)

Same script with `--prefix map` (server on 7837, player on 8137). New: Tab map (zone-tinted, legend, key, weapon guide, quests), planning screen on the shared map view, and the `walk` step: it right-clicks the minimap and then the Tab map, reads the player marker back from the minimap before and after (the `walk-*.json` files hold the world positions), and counts `contextmenu` events that were not default-prevented (0). The in-page move-order trace (`__rhLatency`) recorded no events in this build, so movement is proven by the marker moving toward the target, not by order logging.
Weak: zone borders show the 1-tile staircase of the region plane; the weapon-guide node labels still show a missing-glyph `[]` prefix (existing code).
