# UI lab gallery evidence (branch `rework/uilab`)

Real captures of the WebGL build's serverless indicator gallery (`?uilab=1`), headed Chromium on a real GPU (Apple M5 Pro, ANGLE Metal), 1920x1080, quality High.
One JPEG crop per gallery cell and ground: `<cell id>__<dark|bright|snow>.jpg` (dark = Sentenced flagstone, bright = Holy temple floor, snow = Frost snow).
`index.json` lists every crop (cell id, audit row, page, bytes, JPEG quality, caption, the legacy look it is judged against, effect age). Judgements: `../../UI_VERIFICATION.md`.

Reproduce: build with `client-unity/UnityProject/Tools/build-web.sh`, serve `Build/Web`, then
`node client-unity/UnityProject/Tools/ui-gallery.cjs --url http://127.0.0.1:8287/ --out docs/rework/evidence/uilab`.
Synthetic view data only (no server); time-based cells carry an age ("+0.12s") and are caught frozen at that age. `?uilab.t=<s>` overrides every age, `?uilab.loop=1` replays live,
`?uilab.hide=<renderer name>` switches a renderer off (diagnostic), `?uilab.page=<n>` opens a page. `F5` and `W15` are half-quality full frames.
Cells with a wide crop (reward chests, P9 text cues) or a tall one (own fighter with every mark) say so by their size.
