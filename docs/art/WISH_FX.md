# Wish effects (Unity client)

Animation and visual effects for the five faction Wishes (Freeze, Swarm, Trial, Blaze Step, Last Stand; `docs/GAME_DESIGN.md` 8.8). Everything is drawn from facts the server delivers; the client decides no rule. Code: `Presentation/WishFxPresenter.cs` (sequences), `WishFxModel.cs` (pure model, also compiled by the .NET tests), `WishFxArt.cs` (generated textures), `ConfirmedWishPresenter.cs` (the older small glyph layer, kept), `SpriteActorPresenter.WishCue/SetWishTint`, and the Wish tile in `MatchHud.Legacy.cs`.

## What the client receives, per phase (measured against a live `rh-server`, protocol 14)

| Phase | Source | Fields used |
|---|---|---|
| Cast starts (Freeze 250 ms, Swarm 250 ms, Trial 350 ms) | `WishStarted` fx | event time, duration, caster, optional target handle, optional anchor (the target's ground point) |
| Owner cast bar | self `Wish` record | ability, ready-at, stock, recharge, cast {started, lands} |
| Landing | `WishLanded` fx | event time, optional caster (absent for a hidden Swarm), optional target, anchor, Blaze destination |
| Area while it lives | `Fields` collection | kind (zone, cloud, trail), ability, owner (absent for an observed Swarm cloud), subject, x/y, x2/y2, radius (trail: half-width), started/ends |
| Status on an actor | `effects` bits on every observed actor | stunned 1, dot 64, hidden 256 (owner only), zoned 512, last stand 1024, haste 2048, casting 4096 |
| End | `WishEnded` fx (cast cancelled), the row leaving `Fields`, a bit clearing | |

Measured values: Freeze stun bit for the delivered 1.25 s; Trial zone radius 300 centred on the target for 5 s with `zoned` on the target; Swarm cloud radius 72 for 8 s and `hidden` on the owner; Blaze trail half-width 20 for 2.5 s; Last Stand bits `1024|2048` for 5 s.

## Not on the wire (so not drawn)

- The Trial ring radius and the Swarm cloud radius during the cast: they appear only in the `Fields` row at landing, so the windup shows a lock-on marker, not an area.
- A Swarm cloud's current place for anyone but its owner: the row is anonymous and static (the cast origin); the owner is hidden, so its movement is not published. The owner's own cloud follows the owner.
- Freeze/Trial stun duration and Last Stand duration (only the bit's presence is delivered), and which Wish caused a stun. A stun is drawn as ice only when a Freeze landing was delivered at that spot within 2.2 s.
- NPC observer handles renew on every snapshot, so an NPC's status can be drawn from the current bits but never "started" or "ended": shatter, radiant and chain-break end effects fire only for players, whose ids are stable.

## Costs and budgets

Sprites are immediate-mode from a pool capped at 420 (`SpriteCap`); a quiet match with one live Wish draws 20 to 60. Particles come from four systems with a combined `maxParticles` of 720, emitted only when `Quality.Particles > 0` and motion is not reduced (Low draws none). Cues are capped at 48, ended-area ghosts at 12, tracked areas at 32. Generated textures total about 0.9 MB of RGBA, created once. The frame allocates nothing: no closures, no LINQ, `EmitParams` is a struct.

## Reduced motion

Particles, flies' flapping, bead tails, pulses, expanding rings, spinning stars and shatter pieces are dropped; the area ring (at full size at once), its time bead, the status tint, the ice crystals, the judged chains, the halo and column remain.
