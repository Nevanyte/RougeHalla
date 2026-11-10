using UnityEngine;

namespace Roguehalla.Client
{
    public enum ParticlePresetId : byte { None = 0, Snow, Embers, Dust, Spores, Pollen }

    /// <summary>
    /// One screen-particle layer. Plain data: the runtime (<see cref="AtmosphereParticles"/>) turns it into a pooled ParticleSystem.
    /// Sizes and speeds are world units (a tile is 1 unit wide); the camera shows about 24 x 18 units.
    /// </summary>
    public struct ParticleLayerSpec
    {
        public string Texture;                // "flake", "mote", "ember", "spore", "shaft"
        public int MaxParticles; public float Rate;
        public float LifeMin, LifeMax, SizeMin, SizeMax;
        public Vector2 Wind;                  // base velocity (world units/s)
        public float Gust;                    // 0..1 slow modulation of Wind.x
        public float Noise, NoiseFreq;        // swirl strength / frequency
        public Color Tint;                    // rgb colour, a = peak alpha
        public float Parallax;                // custom-space follow factor: 0 world-fixed, <0 faster than ground, >0 slower
        public bool AboveActors;              // false = sorts above ground but below props, walls and actors
        public float Spin;                    // degrees/s
        public float Twinkle;                 // 0 none, else alpha pulse cycles per lifetime
        public float StretchY;                // visual elongation (shafts, streaks)
        public float Rotation;                // fixed rotation in degrees (shafts)
    }

    /// <summary>Data-driven layer tables per preset and the pure particle-budget maths.</summary>
    public static class ParticlePresets
    {
        public const int MaxLayers = 4;
        /// <summary>Hard cap on live screen particles at density 1, summed over all layers of a preset.</summary>
        public const int HardBudget = 420;
        public const int BehindActorsOrder = 1500, AboveActorsOrder = 29980;

        static readonly ParticleLayerSpec[] None = new ParticleLayerSpec[0];
        static readonly ParticleLayerSpec[] Snow =
        {
            // far: tiny, dense, slow, faint, drifting slower than the ground
            new ParticleLayerSpec { Texture = "flake", MaxParticles = 150, Rate = 24, LifeMin = 6, LifeMax = 9, SizeMin = .06f, SizeMax = .11f, Wind = new Vector2(.55f, -.85f), Gust = .5f, Noise = .35f, NoiseFreq = .35f, Tint = new Color(.95f, .98f, 1f, .62f), Parallax = .25f, Spin = 10f },
            // mid: flakes with sway, behind actors
            new ParticleLayerSpec { Texture = "flake", MaxParticles = 90, Rate = 12, LifeMin = 5, LifeMax = 7.5f, SizeMin = .11f, SizeMax = .19f, Wind = new Vector2(.8f, -1.35f), Gust = .65f, Noise = .55f, NoiseFreq = .28f, Tint = new Color(1f, 1f, 1f, .82f), Parallax = 0f, Spin = 25f },
            // near: a few large soft out-of-focus flakes, quick, low alpha, above everything (never large enough to hide an actor)
            new ParticleLayerSpec { Texture = "flake", MaxParticles = 22, Rate = 3.4f, LifeMin = 3.5f, LifeMax = 5f, SizeMin = .30f, SizeMax = .46f, Wind = new Vector2(1.5f, -2.5f), Gust = .8f, Noise = .8f, NoiseFreq = .22f, Tint = new Color(.92f, .97f, 1f, .26f), Parallax = -.3f, AboveActors = true, Spin = 40f },
            // glitter: tiny twinkling ice sparkles hanging in the air
            new ParticleLayerSpec { Texture = "mote", MaxParticles = 40, Rate = 6.5f, LifeMin = 1.6f, LifeMax = 3f, SizeMin = .05f, SizeMax = .1f, Wind = new Vector2(.1f, -.1f), Noise = .12f, NoiseFreq = .5f, Tint = new Color(.82f, .95f, 1f, .95f), Parallax = .1f, Twinkle = 2f },
        };
        static readonly ParticleLayerSpec[] Embers =
        {
            new ParticleLayerSpec { Texture = "ember", MaxParticles = 70, Rate = 10, LifeMin = 3.5f, LifeMax = 6f, SizeMin = .05f, SizeMax = .12f, Wind = new Vector2(.4f, 1.1f), Gust = .5f, Noise = .6f, NoiseFreq = .4f, Tint = new Color(1f, .55f, .16f, .95f), Parallax = .15f, Twinkle = 3f },
            new ParticleLayerSpec { Texture = "ember", MaxParticles = 36, Rate = 5, LifeMin = 3f, LifeMax = 5f, SizeMin = .1f, SizeMax = .2f, Wind = new Vector2(.6f, 1.7f), Gust = .6f, Noise = .8f, NoiseFreq = .3f, Tint = new Color(1f, .42f, .1f, .8f), Parallax = -.1f, AboveActors = true, Twinkle = 2f },
            new ParticleLayerSpec { Texture = "mote", MaxParticles = 40, Rate = 6, LifeMin = 6, LifeMax = 9, SizeMin = .08f, SizeMax = .16f, Wind = new Vector2(.25f, .35f), Noise = .35f, NoiseFreq = .25f, Tint = new Color(.28f, .2f, .2f, .35f), Parallax = .2f },
        };
        static readonly ParticleLayerSpec[] Dust =
        {
            new ParticleLayerSpec { Texture = "mote", MaxParticles = 60, Rate = 5, LifeMin = 9, LifeMax = 14, SizeMin = .06f, SizeMax = .12f, Wind = new Vector2(.35f, .05f), Gust = .5f, Noise = .45f, NoiseFreq = .2f, Tint = new Color(.9f, .75f, .5f, .5f), Parallax = .2f },
            new ParticleLayerSpec { Texture = "chaff", MaxParticles = 26, Rate = 2.2f, LifeMin = 8, LifeMax = 12, SizeMin = .1f, SizeMax = .18f, Wind = new Vector2(.5f, -.12f), Gust = .6f, Noise = .6f, NoiseFreq = .25f, Tint = new Color(.86f, .7f, .44f, .55f), Parallax = 0f, Spin = 45f },
        };
        static readonly ParticleLayerSpec[] Spores =
        {
            new ParticleLayerSpec { Texture = "spore", MaxParticles = 70, Rate = 6, LifeMin = 7, LifeMax = 11, SizeMin = .07f, SizeMax = .15f, Wind = new Vector2(.05f, .22f), Noise = .5f, NoiseFreq = .22f, Tint = new Color(.66f, 1f, .38f, .8f), Parallax = .1f, Twinkle = 2.5f },
            new ParticleLayerSpec { Texture = "mote", MaxParticles = 50, Rate = 5, LifeMin = 8, LifeMax = 12, SizeMin = .05f, SizeMax = .1f, Wind = new Vector2(.1f, .12f), Noise = .4f, NoiseFreq = .3f, Tint = new Color(.55f, .95f, .75f, .6f), Parallax = .25f },
            new ParticleLayerSpec { Texture = "spore", MaxParticles = 14, Rate = 1.2f, LifeMin = 8, LifeMax = 12, SizeMin = .16f, SizeMax = .26f, Wind = new Vector2(.08f, .2f), Noise = .6f, NoiseFreq = .18f, Tint = new Color(.7f, 1f, .5f, .3f), Parallax = -.2f, AboveActors = true, Twinkle = 1.5f },
        };
        static readonly ParticleLayerSpec[] Pollen =
        {
            new ParticleLayerSpec { Texture = "mote", MaxParticles = 70, Rate = 6.5f, LifeMin = 8, LifeMax = 13, SizeMin = .05f, SizeMax = .12f, Wind = new Vector2(.4f, .12f), Gust = .5f, Noise = .45f, NoiseFreq = .25f, Tint = new Color(1f, .9f, .5f, .75f), Parallax = .15f, Twinkle = 1.5f },
            new ParticleLayerSpec { Texture = "shaft", MaxParticles = 5, Rate = .5f, LifeMin = 9, LifeMax = 14, SizeMin = 5f, SizeMax = 8f, Wind = new Vector2(.12f, -.05f), Tint = new Color(1f, .92f, .6f, .10f), Parallax = .35f, StretchY = 4.5f, Rotation = 38f },
        };

        public static ParticleLayerSpec[] Get(ParticlePresetId id)
        {
            switch (id)
            {
                case ParticlePresetId.Snow: return Snow;
                case ParticlePresetId.Embers: return Embers;
                case ParticlePresetId.Dust: return Dust;
                case ParticlePresetId.Spores: return Spores;
                case ParticlePresetId.Pollen: return Pollen;
                default: return None;
            }
        }

        /// <summary>Live-particle cap for a layer at the given density multiplier (0 = off). Never below 1 while density is on.</summary>
        public static int LayerBudget(in ParticleLayerSpec layer, float density)
        {
            if (density <= .001f) return 0;
            return Mathf.Max(1, Mathf.CeilToInt(layer.MaxParticles * Mathf.Min(density, AtmosphereQuality.MaxParticleDensity)));
        }

        /// <summary>Total live-particle cap of a preset at the given density, clamped to <see cref="HardBudget"/> x density.</summary>
        public static int Budget(ParticlePresetId id, float density)
        {
            var layers = Get(id); int sum = 0;
            for (int i = 0; i < layers.Length; i++) sum += LayerBudget(layers[i], density);
            return Mathf.Min(sum, Mathf.CeilToInt(HardBudget * Mathf.Min(Mathf.Max(density, 0f), AtmosphereQuality.MaxParticleDensity)));
        }
    }
}
