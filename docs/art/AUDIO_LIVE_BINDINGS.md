# Live soundscape bindings

`ShowcaseSoundscape.cs` starts from the existing Unity soundscape. It continues to load the stable `ShowcaseCatalog` and uses its `AudioLibrary` reference; it does not load the staged library from `Resources`, modify mixer routing, create gameplay events, or edit UI code.

## Delivered FX bindings

| Delivered fact | Audio-library key | Fallback / gate |
|---|---|---|
| `FxKind.Swing`, with authoritative `WireFx.Weapon` | Sword/Axe/Fists → `combat.melee.swing`; Bow → `combat.ranged.launch`; Wand → `combat.magic.shock` | Missing cue or Shield/future weapon code uses existing `Catalog.Swings`. The animation hand/weapon view is not used to guess the swing weapon. |
| `FxKind.Hit`, victim `WireFx.Victim` | Observed public appearance family → `mob.skeleton.hit`, `mob.antlion.hit`, or `mob.goblin.hit` | Missing/unknown species cue uses existing `Catalog.Hits`. No removal or HP change is interpreted as a hit. |
| `FxKind.Block`, subject `WireFx.Id` | `combat.block` | No generic fallback; the starter had no block voice. |
| `FxKind.WishLanded`, ability code | 0 Freeze → `wish.freeze`; 1 Swarm → `wish.swarm`; 2 Trial → `wish.trial`; 3 Blaze → `wish.blaze`; 4 LastStand → `wish.last-stand` | No starter Wish sound fallback. A named caster must be in the current observed set. An anonymous landing is eligible only when the protocol marks a public anchor; it plays through the existing global 2D pool. |

Hit and death actor typing comes from `Arena.TrySoundContext` after current observation succeeds. Regional mob type and faction must agree with the canonical identity table. Explicit sound-family reuse follows the same approved appearance mapping: skeleton, antlion, goblin and zombie looks use those Flare audio families. This is creative reuse, not a claim of unique species audio. Player and uncovered mage/hero looks use the generic hit or silence for death. Zombie hit falls back because no zombie-hit clip is supplied.

`WishStarted`, `WishEnded`, `Stagger`, `Teleport`, target removal, pickup deltas, HP/stat deltas, and inferred heals do not create new audio. Existing FX queueing copies scalar fields before the decoded message can be recycled, checks current visibility before playback, drops overflow, and clears pending cues on session detach/reset. Actor-bound voices stop when their actor leaves the observed set; anonymous/global UI voices are not bound to an actor. The eight-voice limit, SFX mixer group, settings volume updates, and gesture-unlocked music/ambience remain as before.

## Reliable event bindings

- `PotionNotice` Used/LargeUsed use `ui.potion`; Stored/LargeStored use `reward.pickup`. Other notices retain the starter generic `Catalog.Ui[0]` response, so refusals never play potion-use audio.
- Death events are queued as actor IDs, then gated against the current observed set and `TrySoundContext`. A covered observed appearance family can use its explicit reusable death clip; an uncovered look stays silent. A removal or dead status alone never triggers death audio.
- Existing generic event fallback stays unchanged: CannonNotice/Toast/Potion failure → `Catalog.Ui[0]`; PickupRefused → `Catalog.Ui[1]`; Bounty → `Catalog.Ui[2]`.

The cue library is optional. Missing entries use only the corresponding existing generic swing, hit, or UI fallback listed above; missing block, Wish, or death keys remain silent where the starter had no voice. No audio key is treated as proof of an unprovided gameplay event.
