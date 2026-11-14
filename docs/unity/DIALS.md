# Unity presentation dials

Named looks-only values a Sonnet agent may change through the [tuning lane](../agent/TUNING_LANE.md). One row per
dial. "Range" is what the pinning test allows; "Scene" is what to render in the [look check](LOOK_CHECK.md).
A value that is not in this table is not a dial yet: adding one is a packet.

| Dial | What the owner sees | File and symbol | Value | Range | Pinned by | Scene |
|---|---|---|---|---|---|---|
| `roof-faded` | How solid a landmark's roof or canopy stays while your own character is under it | `Assets/Scripts/View/Regions/Landmarks/LandmarkView.cs` `RoofFadedAlpha` | 0.1 | above 0, at most 0.15 | `LandmarkRoofPeekEditModeTests` (the constants test) | `cave-inside` |
| `roof-peek` | How solid the roof is while you are outside and someone you can see is under it | same file, `RoofPeekAlpha` | 0.5 | 0.4 to 0.6 | same test | `cave-inside` with the actor outside |
| `roof-fade-rate` | How fast roofs and tall props fade in and out | `RoguehallaNet/Net/Ui/PropFade.cs` `FadeRate` | 9 (alpha units per second) | as `PropFadeTests` pins | `PropFadeTests` | `cave-inside` |

Paths are under `client-unity/UnityProject/` unless they start with `RoguehallaNet/` (then under `client-unity/`,
with a synced copy made by `bash client-unity/sync-net.sh`).

Not yet dials (each needs the packet that names it and gives it a range test): the ground variants' strengths and
colours (`GroundVariantLook`), zone light strengths (`RegionAtmosphereTable`), landmark art colours, HUD sizes and
label sizes (`CampPatienceOutlines.LabelSize`), name plate sizes.
