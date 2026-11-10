using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net;

namespace Roguehalla.Client
{
    /// <summary>
    /// Projectile trails, impact sparks and hit flashes (render pass, switch <c>fx.sparks</c>; the lights are <c>fx.fxlights</c>). Everything is derived
    /// from facts the client already draws: the delivered projectile rows, and confirmed hit and block cues on actors it presents. Two pooled,
    /// capped particle systems (HDR colours, so the cores bloom); no allocation per frame.
    /// </summary>
    public sealed class CombatSparks
    {
        const int MaxShots = 64;
        struct Shot { public float X, Y; public ProjectileKind Kind; public uint Owner; public bool Matched; }
        readonly ParticleSystem _spark, _trail;
        readonly Shot[] _prev = new Shot[MaxShots], _cur = new Shot[MaxShots];
        int _prevN, _curN; uint _tick = uint.MaxValue;

        public CombatSparks(Transform parent)
        {
            _spark = Make(parent, "Impact sparks", WishFxArt.Cross, 220, .55f);
            _trail = Make(parent, "Projectile trails", WishFxArt.Soft, 260, 0f);
        }

        public int Live { get { return _spark.particleCount + _trail.particleCount; } }
        public static bool On { get { return AtmosphereQuality.Sparks && Quality.Particles > 0f; } }

        /// <summary>One trail puff behind a drawn projectile (call each frame per projectile).</summary>
        public void Trail(Vector3 world, Vector3 backward, Color c, float size)
        {
            if (!On) return;
            var ep = new ParticleSystem.EmitParams { position = world, velocity = backward * .6f, startSize = size, startLifetime = .28f, startColor = c };
            _trail.Emit(ep, 1);
        }

        /// <summary>A burst of sparks (impact or hit). <paramref name="speed"/> in world units per second.</summary>
        public void Burst(Vector3 world, Color c, int count, float speed, float size, ref uint rng)
        {
            if (!On) return;
            count = Mathf.Max(1, Mathf.RoundToInt(count * Mathf.Min(1.5f, Quality.Particles)));
            for (int i = 0; i < count; i++)
            {
                float a = Rand(ref rng) * 6.2832f, s = speed * (.35f + .65f * Rand(ref rng));
                var ep = new ParticleSystem.EmitParams
                {
                    position = world, velocity = new Vector3(Mathf.Cos(a) * s, Mathf.Sin(a) * s * ArenaView.GroundSquash + speed * .35f, 0),
                    startSize = size * (.6f + .8f * Rand(ref rng)), startLifetime = .3f + .35f * Rand(ref rng), startColor = c, rotation = a * Mathf.Rad2Deg,
                };
                _spark.Emit(ep, 1);
            }
        }

        /// <summary>
        /// Compare this snapshot's projectile rows with the previous snapshot's (once per new server tick): a shot that was seen and now is gone struck
        /// something (a wall or a body) near where it was last seen; sparks and a flash go there. Only when that spot is well inside the camera.
        /// </summary>
        public void Observe(uint tick, IReadOnlyList<NetProjectileView> shots, Vector3 camCenter, float halfW, float halfH, ref uint rng)
        {
            if (tick == _tick) return;
            _tick = tick;
            _curN = 0;
            if (shots != null) for (int i = 0; i < shots.Count && _curN < MaxShots; i++) _cur[_curN++] = new Shot { X = shots[i].X, Y = shots[i].Y, Kind = shots[i].Kind, Owner = shots[i].Owner ?? 0u };
            for (int i = 0; i < _prevN; i++)
            {
                int best = -1; float bd = 60f * 60f;                     // a shot moves a few tens of sim units per snapshot
                for (int j = 0; j < _curN; j++)
                {
                    if (_cur[j].Matched || _cur[j].Kind != _prev[i].Kind || _cur[j].Owner != _prev[i].Owner) continue;
                    float dx = _cur[j].X - _prev[i].X, dy = _cur[j].Y - _prev[i].Y, d = dx * dx + dy * dy;
                    if (d < bd) { bd = d; best = j; }
                }
                if (best >= 0) { _cur[best].Matched = true; continue; }
                Vector3 w = ArenaView.WorldPoint(_prev[i].X, _prev[i].Y);
                if (Mathf.Abs(w.x - camCenter.x) > halfW - 1.5f || Mathf.Abs(w.y - camCenter.y) > halfH - 1.5f) continue;
                Impact(w, _prev[i].Kind, ref rng);
            }
            _prevN = _curN; for (int i = 0; i < _curN; i++) { _prev[i] = _cur[i]; _prev[i].Matched = false; }
        }

        void Impact(Vector3 world, ProjectileKind kind, ref uint rng)
        {
            Color c = kind == ProjectileKind.Arrow ? new Color(2.2f, 1.5f, .6f) : new Color(1.9f, .7f, 2.6f);
            Burst(world + new Vector3(0, .25f, 0), c, 9, 2.4f, .13f, ref rng);
            if (AtmosphereQuality.AnalyticLights && AtmosphereQuality.FxLights) LocalLightField.FlashWorld(world, .6f, 2.6f, kind == ProjectileKind.Arrow ? new Color(1f, .75f, .4f) : new Color(.8f, .45f, 1f), 1.5f, .22f);
        }

        /// <summary>A confirmed hit or block on a presented actor: sparks and a flash that lights the ground and nearby surfaces.</summary>
        public void Hit(Vector3 actorWorld, bool block, ref uint rng)
        {
            Color c = block ? new Color(1.1f, 1.8f, 2.8f) : new Color(2.6f, 1.6f, .7f);
            Burst(actorWorld + new Vector3(0, .65f, 0), c, block ? 8 : 6, 2.1f, .12f, ref rng);
            if (AtmosphereQuality.AnalyticLights && AtmosphereQuality.FxLights) LocalLightField.FlashWorld(actorWorld, .8f, 2.4f, block ? new Color(.5f, .8f, 1f) : new Color(1f, .8f, .45f), 1.3f, .2f);
        }

        public void Clear() { _spark.Clear(false); _trail.Clear(false); _prevN = 0; _curN = 0; _tick = uint.MaxValue; }

        static float Rand(ref uint s) { s = s * 1664525u + 1013904223u; return ((s >> 8) & 0xFFFF) / 65535f; }

        static ParticleSystem Make(Transform parent, string name, string textureKey, int max, float gravity)
        {
            var go = new GameObject(name); go.transform.SetParent(parent, false);
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = ps.main;
            main.loop = true; main.playOnAwake = false; main.maxParticles = max; main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.startLifetime = .4f; main.startSpeed = 0f; main.startSize = .1f; main.gravityModifier = gravity; main.scalingMode = ParticleSystemScalingMode.Hierarchy;
            main.cullingMode = ParticleSystemCullingMode.AlwaysSimulate;
            var emission = ps.emission; emission.enabled = false; emission.rateOverTime = 0f;
            var shape = ps.shape; shape.enabled = false;
            var col = ps.colorOverLifetime; col.enabled = true;
            var g = new Gradient();
            g.SetKeys(new[] { new GradientColorKey(Color.white, 0), new GradientColorKey(Color.white, 1) },
                new[] { new GradientAlphaKey(0f, 0f), new GradientAlphaKey(1f, .08f), new GradientAlphaKey(.7f, .5f), new GradientAlphaKey(0f, 1f) });
            col.color = new ParticleSystem.MinMaxGradient(g);
            var size = ps.sizeOverLifetime; size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1f, new AnimationCurve(new Keyframe(0, 1f), new Keyframe(1, .2f)));
            var r = go.GetComponent<ParticleSystemRenderer>();
            r.renderMode = ParticleSystemRenderMode.Billboard; r.sortingOrder = 29985; r.sharedMaterial = WishFxArt.ParticleMaterial(textureKey);
            ps.Play();
            return ps;
        }
    }
}
