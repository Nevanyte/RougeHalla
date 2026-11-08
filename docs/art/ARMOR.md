# Flare player armor sample

The pinned Flare: Empyrean Campaign source includes matching directional plate armor for both avatar body types. This sample includes the five equipment layers (helm, cuirass, gauntlets, greaves, boots) for each, with each original animation definition. The existing male `head_short` and female `head_long` layers provide the face/hair bases. All downloaded files are unchanged from commit [`af6eee6d339ac98011864bfe89da837fe7769c28`](https://github.com/flareteam/flare-game/tree/af6eee6d339ac98011864bfe89da837fe7769c28).

## Player layer mapping

| Avatar layer | Male image / animation | Female image / animation |
| --- | --- | --- |
| Head base (already included) | `Raw/images/avatar/male/head_short.png` / `Raw/animations/avatar/male/head_short.txt` | `Raw/images/avatar/female/head_long.png` / `Raw/animations/avatar/female/head_long.txt` |
| Helm | `plate_helm.png` / `plate_helm.txt` | `plate_helm.png` / `plate_helm.txt` |
| Chest | `plate_cuirass.png` / `plate_cuirass.txt` | `plate_cuirass.png` / `plate_cuirass.txt` |
| Hands | `plate_gauntlets.png` / `plate_gauntlets.txt` | `plate_gauntlets.png` / `plate_gauntlets.txt` |
| Legs | `plate_greaves.png` / `plate_greaves.txt` | `plate_greaves.png` / `plate_greaves.txt` |
| Feet | `plate_boots.png` / `plate_boots.txt` | `plate_boots.png` / `plate_boots.txt` |

Armor image and animation paths are under `Raw/images/avatar/{male,female}/` and `Raw/animations/avatar/{male,female}/` respectively. For each gender, replace the four `default_*` layers with the matching plate parts and add `plate_helm` above the head base. Keep the existing weapon layer independent.

The official [Credits ledger](https://github.com/flareteam/flare-game/wiki/Credits) lists no per-file artist or license exception for these avatar layers. They are therefore recorded under Flare's general art license, CC BY-SA 3.0 or later, with no individual artist inferred. Preserve the applicable attribution and license information when redistributing them. The per-file source paths, pinned commit, Git blob SHA-1 values, byte sizes and SHA-256 hashes are in `client-unity/UnityProject/Assets/Art/ThirdParty/Flare/armor-manifest.json`.
