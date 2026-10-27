# RougeHalla K1 hand-in

- Original base: `8e78689`; R5 landed during the work and was integrated as `3f2da66ca3de53efda5a20d190c1d1a98b88a3cc`
- Patch/bundle base: `3f2da66` (so they contain only K1)
- Branch: `kimi/quests-k1`
- Commit: `592f2a241d14d8c34dd4e442f4ca66bf5b10b922`

## Delivered

- Ported the original 20-quest catalog, 5 known + 5 unknown roster, placement, objectives, parcels, automatic turn-ins, and raid runtime to current main.
- Rewards now grant real far-zone `BuffId` stacks through `grantBuff`, scaled by `rewardCurve(feed)`. Quest GV has its own per-run pot capped at 24 and a separate results row.
- Known quests appear during planning; quest timers and systems freeze until the raid starts.
- Unknown quests, givers, and items remain server-side until discovery. The finder receives a private reveal four seconds before public sync.
- Neutral mob-backed givers are immune to target locks, AI, melee, projectiles, Wishes, statuses, damage, and camp waking.
- Parcels survive Swarm, Blaze Step, and coliseum teleport. They remain publicly marked at the carrier position, drop on death, and can be stolen.
- Added planning cards, J log, world art, minimap objectives/carriers, pickup and turn-in hints, lifecycle toasts, help, and results UI.
- Public expired quests remain visible as expired; excess collection tokens are not consumed; Headhunter ignores MIA credit.
- Added server/shared/client tests, bot interface documentation, architecture documentation, and the buffPower balance worksheet.

## Decisions

- Kept givers as neutral `kind: "quest"` mobs with explicit immunity guards rather than introducing a second NPC schema.
- Coliseum teleport keeps a parcel and moves it with the carrier.
- The four-second reveal head start is informational, not a claim or exclusive-progression window; K2 remains unimplemented.
- Quest stack scaling uses K1's specified `rewardCurve(feed)`, not K2's additional pay scales, catch-up rules, or reward budget.

## Verification

- `npm run typecheck`: passed; full output in `RougeHalla-K1-typecheck.log`.
- `npm test`: passed (81 client files / 1,433 tests; 60 server files / 3,882 tests; 29 shared files / 1,110 tests); full output in `RougeHalla-K1-test.log`.
- `npm run build`: passed; full output in `RougeHalla-K1-build.log`.
- Step benchmark: avg 0.328 ms, p99 0.996 ms against avg < 5 ms and p99 < 15 ms; see `RougeHalla-K1-stepBench.log`.
- A `pathfind.test.ts` wall-clock timeout in an earlier parallel run passed when rerun alone. The final full suite passed without a rerun.
- `botChestsRoom.test.ts` initially exposed a missing `quests: false` focused-test config; after that correction it and the full suite passed.

## Two-tab browser check

Used two real Chromium tabs, with `?profile=bravo` on the second, against isolated dev server/client ports.

- Both planning screens showed five known quests, `+5 rumoured`, fixed durations, rewards, and giver markers.
- J showed ten rows and scrolled natively; right-click inside the log did not move or target.
- World givers/items and minimap markers rendered. Two overlapping private reveals were observed.
- Real movement and F inputs completed The Warden's Seal for 5.367 Executioner stacks + 8 GV and The Long Haul for 7.807 Plague Rat stacks + 12 GV.
- Earlier, Offerings at the Edge also completed for 7.807 Ice Golem stacks + 12 GV, with both tabs showing `Done by k1-alpha2`.
- Live Swarm/carrier behavior was not separately exercised in the browser; dedicated server/client tests cover those rules.
- Six screenshots are included as `k1-*.png`.

## Not done / boundaries

- K2 design changes are not included; the required orchestrator addendum has not arrived.
- No protected map, bots, hosting, client netcode, MapView, or main-render-loop files were changed.
- R5 merge `3f2da66` is integrated. `origin/main` subsequently advanced to R5-rulings merge `715a328`; no orchestrator instruction to integrate that later merge was supplied, so it is not included.
