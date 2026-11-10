using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Region accent light: a glow placed on clusters of one terrain kind (lava, ice, bog, light).</summary>
    public struct AccentLightSpec
    {
        public TerrainKind Terrain; public Color Color; public float Intensity, Radius, Flicker;
        public bool Enabled { get { return Terrain != TerrainKind.None && Intensity > 0f; } }
    }

    /// <summary>One data row per region. Colours are derived from docs/art/palette.json through <see cref="RegionPaletteGenerated"/> only.</summary>
    public sealed class RegionAtmosphereRow
    {
        public RegionId Region; public string Name;
        public AtmosphereParams Params;
        public ParticlePresetId Particles;
        public string Music, Ambience;     // ids of files under StreamingAssets/Audio (null = none)
        public AccentLightSpec Accent;
    }

    public static class RegionAtmosphereTable
    {
        public const int RowCount = 7;
        static readonly RegionAtmosphereRow[] Rows = Build();

        /// <summary>Row for a region id (None uses the coliseum row, like the palette).</summary>
        public static RegionAtmosphereRow Get(RegionId region)
        {
            int i = (int)region; return Rows[i >= 0 && i < RowCount ? i : 6];
        }
        public static RegionAtmosphereRow Get(int index) { return Rows[index >= 0 && index < RowCount ? index : 6]; }

        /// <summary>The accent light spec for a terrain kind (lava, ice, bog, light), or a disabled spec. Lights follow terrain, not the player's region.</summary>
        public static AccentLightSpec AccentFor(TerrainKind kind)
        {
            for (int i = 1; i < RowCount - 1; i++) if (Rows[i].Accent.Terrain == kind && Rows[i].Accent.Enabled) return Rows[i].Accent;
            return default(AccentLightSpec);
        }

        public static Color Palette(RegionId region, int slot) { return (Color)RegionPaletteGenerated.Srgb[(int)region][slot]; }

        /// <summary>The colour scaled so its largest channel is 1, then blended with white: a hue without a brightness.</summary>
        public static Color Tint(Color c, float strength)
        {
            float m = Mathf.Max(c.r, Mathf.Max(c.g, c.b)); if (m < .001f) return Color.white;
            var n = new Color(c.r / m, c.g / m, c.b / m, 1f);
            return Color.Lerp(Color.white, n, strength);
        }
        static Color Mix(Color a, Color b, float t) { return Color.Lerp(a, b, t); }
        /// <summary>Neutral grey blended toward the colour: how split toning takes its input.</summary>
        static Color Toning(Color c, float strength) { var o = Color.Lerp(new Color(.5f, .5f, .5f, 1f), c, strength); o.a = 1f; return o; }
        static Color A(Color c, float a) { c.a = a; return c; }

        static RegionAtmosphereRow Row(RegionId id)
        {
            var key = Palette(id, RegionPaletteGenerated.Key); var amb = Palette(id, RegionPaletteGenerated.Ambient);
            var shadow = Palette(id, RegionPaletteGenerated.Shadow); var fog = Palette(id, RegionPaletteGenerated.Fog);
            var accent = Palette(id, RegionPaletteGenerated.Accent);
            var p = new AtmosphereParams
            {
                LightColor = Color.white, LightScale = 1f,
                SunColor = Tint(key, .85f), SunStrength = .8f, ShadowLength = 1f, AmbientColor = Tint(amb, .5f) * .6f,
                PostExposure = .1f, Contrast = 8f, Saturation = 0f, ColorFilter = Color.white,
                SplitShadows = Toning(shadow, .3f), SplitHighlights = Toning(key, .15f), SplitBalance = 0f,
                BloomThreshold = .95f, BloomIntensity = .4f, BloomScatter = .6f, BloomTint = Color.white,
                VignetteIntensity = .12f, VignetteSmoothness = .5f, VignetteColor = Mix(shadow, Color.black, .75f),
                Haze = A(fog, .06f), ShadowTint = Mix(shadow, Color.black, .35f),
            };
            var row = new RegionAtmosphereRow { Region = id, Params = p };
            switch (id)
            {
                case RegionId.Frost:     // bright, whiter, cold sunlight; crisp long shadows; snow
                    row.Name = "Frost";
                    p.SunColor = Tint(key, .6f) * 1.02f; p.SunStrength = .95f; p.ShadowLength = 1.3f; p.AmbientColor = Tint(amb, .8f) * .62f;
                    p.LightColor = Tint(Mix(amb, key, .4f), .35f);
                    p.PostExposure = .12f; p.Contrast = 10f; p.Saturation = 8f; p.ColorFilter = Tint(accent, .1f);
                    p.SplitShadows = Toning(shadow, .45f); p.SplitHighlights = Toning(key, .1f); p.SplitBalance = -15f;
                    p.BloomThreshold = .86f; p.BloomIntensity = .5f; p.BloomScatter = .7f; p.BloomTint = Tint(accent, .25f);
                    p.VignetteIntensity = .16f; p.Haze = A(fog, .075f);
                    row.Particles = ParticlePresetId.Snow; row.Music = "music_frost"; row.Ambience = "amb_frost";
                    row.Accent = new AccentLightSpec { Terrain = TerrainKind.Ice, Color = Tint(accent, .55f), Intensity = .8f, Radius = 3.4f, Flicker = .5f };
                    break;
                case RegionId.Fire:      // under the mountain: almost no sun, lava does the lighting; embers
                    row.Name = "Fire";
                    p.SunColor = Tint(key, .9f); p.SunStrength = .07f; p.ShadowLength = .2f; p.AmbientColor = Tint(amb, .9f) * .62f;
                    p.LightColor = Tint(Mix(amb, key, .3f), .45f);
                    p.PostExposure = .08f; p.Contrast = 16f; p.Saturation = 12f; p.ColorFilter = Tint(accent, .12f);
                    p.SplitShadows = Toning(shadow, .55f); p.SplitHighlights = Toning(accent, .3f); p.SplitBalance = 10f;
                    p.BloomThreshold = .72f; p.BloomIntensity = .8f; p.BloomScatter = .65f; p.BloomTint = Tint(accent, .6f);
                    p.VignetteIntensity = .26f; p.Haze = A(fog, .1f);
                    row.Particles = ParticlePresetId.Embers; row.Music = "music_fire"; row.Ambience = "amb_fire";
                    row.Accent = new AccentLightSpec { Terrain = TerrainKind.Lava, Color = Tint(accent, .85f), Intensity = 1.5f, Radius = 5.2f, Flicker = 1f };
                    break;
                case RegionId.Sentenced: // the one muted zone: hazy harvest dusk
                    row.Name = "Sentenced";
                    p.SunColor = Tint(key, .85f); p.SunStrength = .24f; p.ShadowLength = .5f; p.AmbientColor = Tint(amb, .6f) * .66f;
                    p.LightColor = Tint(Mix(amb, key, .55f), .35f);
                    p.PostExposure = .02f; p.Contrast = 4f; p.Saturation = -22f; p.ColorFilter = Tint(key, .18f);
                    p.SplitShadows = Toning(shadow, .45f); p.SplitHighlights = Toning(key, .3f); p.SplitBalance = -20f;
                    p.BloomThreshold = .9f; p.BloomIntensity = .3f; p.BloomScatter = .75f; p.BloomTint = Tint(key, .4f);
                    p.VignetteIntensity = .22f; p.Haze = A(fog, .13f);
                    row.Particles = ParticlePresetId.Dust; row.Music = "music_sentenced"; row.Ambience = "amb_sentenced";
                    break;
                case RegionId.Plague:    // sickly teal-green, dim green-filtered light; spores
                    row.Name = "Plague";
                    p.SunColor = Tint(key, .8f); p.SunStrength = .42f; p.ShadowLength = .65f; p.AmbientColor = Tint(amb, .85f) * .6f;
                    p.LightColor = Tint(Mix(amb, key, .35f), .5f);
                    p.PostExposure = .04f; p.Contrast = 9f; p.Saturation = 4f; p.ColorFilter = Tint(Mix(accent, Palette(id, RegionPaletteGenerated.Base), .7f), .22f);
                    p.SplitShadows = Toning(shadow, .5f); p.SplitHighlights = Toning(key, .2f); p.SplitBalance = -5f;
                    p.BloomThreshold = .8f; p.BloomIntensity = .5f; p.BloomScatter = .65f; p.BloomTint = Tint(accent, .5f);
                    p.VignetteIntensity = .22f; p.Haze = A(fog, .12f);
                    row.Particles = ParticlePresetId.Spores; row.Music = "music_plague"; row.Ambience = "amb_plague";
                    row.Accent = new AccentLightSpec { Terrain = TerrainKind.Bog, Color = Tint(accent, .9f), Intensity = .9f, Radius = 3.2f, Flicker = .6f };
                    break;
                case RegionId.Holy:      // strong golden sun, warm dust
                    row.Name = "Holy";
                    p.SunColor = Tint(key, .95f) * 1.04f; p.SunStrength = 1f; p.ShadowLength = 1.1f; p.AmbientColor = Tint(amb, .7f) * .6f;
                    p.LightColor = Tint(Mix(amb, key, .6f), .45f);
                    p.PostExposure = .16f; p.Contrast = 8f; p.Saturation = 10f; p.ColorFilter = Tint(key, .12f);
                    p.SplitShadows = Toning(shadow, .3f); p.SplitHighlights = Toning(key, .32f); p.SplitBalance = 5f;
                    p.BloomThreshold = .78f; p.BloomIntensity = .6f; p.BloomScatter = .75f; p.BloomTint = Tint(key, .7f);
                    p.VignetteIntensity = .1f; p.Haze = A(fog, .09f);
                    row.Particles = ParticlePresetId.Pollen; row.Music = "music_holy"; row.Ambience = "amb_holy";
                    row.Accent = new AccentLightSpec { Terrain = TerrainKind.Light, Color = Tint(key, .9f), Intensity = 1.1f, Radius = 4f, Flicker = .25f };
                    break;
                default:                 // coliseum (and region none): neutral daylight
                    row.Name = "Coliseum";
                    p.SunColor = Tint(key, .4f); p.SunStrength = .85f; p.ShadowLength = 1f; p.AmbientColor = Tint(amb, .3f) * .62f;
                    p.LightColor = Color.white;
                    p.PostExposure = .1f; p.Contrast = 8f; p.Saturation = 2f;
                    p.VignetteIntensity = .1f; p.Haze = A(fog, .05f);
                    row.Particles = ParticlePresetId.None; row.Music = "music_coliseum"; row.Ambience = null;
                    break;
            }
            row.Params = p;
            return row;
        }

        static RegionAtmosphereRow[] Build()
        {
            var rows = new RegionAtmosphereRow[RowCount];
            for (int i = 0; i < RowCount; i++) rows[i] = Row((RegionId)i);
            rows[0].Name = "None";
            return rows;
        }

        /// <summary>All music ids the table can request (for the audio loader's fallback and the build check).</summary>
        public static readonly string[] AllAudioIds =
        {
            "music_fire", "music_sentenced", "music_plague", "music_frost", "music_holy", "music_coliseum",
            "amb_fire", "amb_sentenced", "amb_plague", "amb_frost", "amb_holy",
        };
    }
}
