# Gate 2 evidence (work in progress)

`combined-fire-1920.jpg`: first combined build (region ground + HUD skin + controls), before any lighting. The owner judged this far too bright.

`interim-lighting-*.jpg`: coordinator captures of `feature/unity-rework` at `ecc4a1a3` (lighting merged, second region pass not yet), headed Chromium 1920x1080, default adaptive quality, `atmosphere-shots.cjs`. Interim: these show known gaps that the second region pass (`rework/regions2`) is fixing.

| Zone | Mean luma | p95 | Clipped > 0.9 | Sprite edge | Hp bar | Gap against owner direction |
|---|---|---|---|---|---|---|
| Holy | 0.65 | 0.95 | 9.1-9.4% | 9.4-9.6 | 10.4 | Sand too bright, white-hot light pools; wants darker sand with bright rays, a temple |
| Frost | 0.67 | 0.86 | 0.05% | 8.9-12.4 | 11.8-12.6 | Slightly bright; shadows hard to see |
| Plague | 0.40 | 0.55 | 0.04% | 3.4 | 3.95-4.0 | Greens too light; hp bar under 4.5:1; ground pattern shared with Fire |
| Fire | 0.24 | 0.55 | 0.04% | 3.4 | 7.7 | Ground still medium red-orange; wants dark basalt lit by lava |
| Sentenced | 0.18-0.19 | 0.28 | 0.05% | 3.6-4.3 | 9.1-10.6 | Tiles dark purple-grey; wants black/charcoal and more lantern pools |
