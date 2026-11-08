# Repair build and live verification

This record separates the current repair candidate from the previously accepted `ebff286b` Web artifact. Evidence files are retained under `/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/evidence/`.

## Source and build identity

- Runtime repair: `4f37e9f0`; faction-marker change: `8190325c`; potion formatter: `8c9d777c`.
- Central enum fix `717fe5c0` was cherry-picked into the art branch as `2833a28f`.
- Build/evidence harness: `9f139ec4`; test-hygiene change: `b445ca76`.
- `repair-build.json` records a successful combined normal-light, faction-marker, and potion-text candidate build.
- `repair-build-manifest.json` records 14 files totaling **74,041,096 bytes**. Parent and coordinator independently verified all 14 HTTP and on-disk hashes against that manifest; `9f139ec4` is the build source revision.
- `repair-editor-tests.json` records **27/27 actual Unity EditMode tests passing**. `repair-diagnostic-hygiene-test.json` records **1/1** diagnostic hygiene test passing.

## Browser and content evidence

`repair-web/showcase-web.json` records **19/19 browser outcomes passing**, with no page or decoder errors. The saved live match records duration 76 seconds, BloodSaint, result place 4 of 5, and result tick 1581. Its `potion-notice.png` was inspected by the parent and shows the exact native HUD text **“Already at full health”**.

The public-content census is a lower-bound record of facts retained in each Socket/Welcome segment, not a claim of full content coverage. The initial segment, resumed segment and short fresh-rejoin segment stay separate:

| Captured segment | Faction and actor mob facts | Other observed public content |
|---|---|---|
| socket-1 / Welcome 1 | Requested Hello faction **4 Holy**; delivered `me.faction` **4 Holy**; actor factions **0 Fire, 2 Plague, 4 Holy**. One-based actor mob wire codes **1, 15, 26, 29** decode to native indices **0, 14, 25, 28**. | Actor weapons **1, 2, 4, 5**; `me.weapon` **1, 5**; inventory slot weapon **1**; prop weapon codes **0–4**; FX weapon **5**. Camp roster zero-based mobs **0, 14, 25**. Projectile kinds **0, 1**; prop kinds **1, 2, 3, 5, 6**. No field ability ID was retained. |
| socket-2 / Welcome 2 (resume) | Requested and delivered faction **4 Holy**; actor factions **0 Fire, 2 Plague, 4 Holy**. One-based actor mob wire codes **1, 26, 29** decode to native indices **0, 25, 28**. | Actor weapons **2, 4, 5**; `me.weapon` **1, 5**; inventory slot weapon **1**; prop weapon codes **0–4**; FX weapon **5**. Camp roster zero-based mobs **0, 14, 25**. Projectile kind **1**; prop kinds **1, 2, 3, 5, 6**. No field ability ID was retained. |
| socket-3 / Welcome 3 (short segment) | Requested and delivered faction **4 Holy**. No actor mob or projectile facts were retained. | Camp roster zero-based mobs **0, 12, 25**; `me.weapon` **5**. No actor/prop weapon, prop, or field ability facts were retained in this segment. |

Socket-1 is the initial connection and socket-2 the resumed connection; they are not a synthetic combined roster. Camp entries are distinct from rendered actor mob facts. `me.faction` and requested Hello faction are distinct fields even when their observed value matches. An absent census category means no such fact was retained in that segment, not proof of non-occurrence. Zero remains a valid observed enum or bitmask value where the protocol defines it. The report contains status/event samples but does not establish complete status or ability coverage.

The 19-outcome browser proof establishes this specific repair artifact and route. It does not close the selected-demo coverage gaps: all five factions and required selected-demo content still need live server-fed proof; current mob mapping, weapon cues, faction identification and public ability/status coverage remain partial or open. Painterly human asset coverage remains open as well.

## Rendering and performance limits

The updated [NORMAL_MAPS.md](NORMAL_MAPS.md) records the no-override staged-light A/B: the showcase path uses its actual staged setup of 12 enabled lights (11 Accurate point lights and the ambient light left Disabled), with a controlled secondary-normal change and unchanged albedo. Pixel response is measured, and the source prefab/configuration gap is fixed in the repair source. This does not establish art-quality acceptance.

The three crowded 15-second profiling windows completed in Manual High with motion on and an actual 2560×1440 drawing buffer. Each reported the expected extension. In run order, GPU p99 was **5.848 / 5.795 / 5.813 ms**, maxima **6.384 / 5.947 / 5.918 ms**, with **905 / 902 / 910** samples and zero disjoint samples. CPU callback p99 was **5.2 / 5.6 / 5.3 ms**. Visible row medians were **6 / 5 / 6** and maxima **7 / 7 / 7**. The server was configured with fill-bots 8; that is not evidence of eight actual players. These figures are below the diagnostic 6.944 ms hold threshold; they do not establish native 144 Hz acceptance or support a cost-improvement claim. The older accepted `ebff286b` artifact and its nine profiles remain separately preserved at `accepted-web-ebff286b`; their **74,029,313-byte** size and different-load performance results are historical and do not describe this repair build.

Managed allocation, total browser GPU memory, and native displayed 144 Hz remain unmeasured or unaccepted. These are separate open gates. Portable copies of the repair study, live capture, potion notice, build manifest and test records are under `evidence/repair/`; source evidence remains at the raw evidence root above.

The updated [COLOR_REVIEW.md](COLOR_REVIEW.md) records actual Fit and native-scale inspection of the repaired browser lineup and live capture in grayscale and three CVD simulations. The five staged markers and the sampled live markers are distinguishable without hue. This closes the bounded static-sample repair review; all-five-faction live coverage, crowded motion, full telegraphs and game-wide accessibility remain open.
