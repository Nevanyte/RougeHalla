using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Region accent light: a glow placed on clusters of one terrain kind (lava, ice, bog, light).</summary>
    public struct AccentLightSpec
    {
        public TerrainKind Terrain; public Color Color; public float Intensity, Radius, Flicker;
        /// <summary>True for the lantern props of the gothic zone (lights sit on the props, not on terrain).</summary>
        public bool Lantern;
        public bool Enabled { get { return (Terrain != TerrainKind.None || Lantern) && Intensity > 0f; } }
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
        /// <summary>The golden temple that will cover the pillar area: a separate, evenly and warmly lit interior profile for a later pass to select by area.</summary>
        public static RegionAtmosphereRow HolyTempleInterior { get { return _temple; } }
        static RegionAtmosphereRow _temple;
        /// <summary>Warm lamp-stand light inside the temple (pooled and camera culled like every accent light).</summary>
        public static AccentLightSpec TempleLamp { get; private set; }
        /// <summary>Profile ids for area-selected profiles (the regions use <see cref="Get(RegionId)"/>).</summary>
        public enum Profile { HolyTempleInterior }
        public static RegionAtmosphereRow Get(Profile profile) { return _temple; }

        public static RegionAtmosphereRow Get(int index) { return Rows[index >= 0 && index < RowCount ? index : 6]; }

        /// <summary>The accent light spec for a terrain kind (lava, ice, bog, light), or a disabled spec. Lights follow terrain, not the player's region.</summary>
        public static AccentLightSpec AccentFor(TerrainKind kind)
        {
            for (int i = 1; i < RowCount - 1; i++) if (kind == TerrainKind.None ? Rows[i].Accent.Lantern : Rows[i].Accent.Terrain == kind && Rows[i].Accent.Enabled) return Rows[i].Accent;
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
                BloomThreshold = .95f, BloomIntensity = .3f, BloomScatter = .6f, BloomTint = Color.white,
                VignetteIntensity = .12f, VignetteSmoothness = .5f, VignetteColor = Mix(shadow, Color.black, .75f),
                Haze = A(fog, .06f), ShadowTint = Mix(shadow, Color.black, .35f),
                PassiveFloor = Tint(amb, .3f) * .42f,
                Lift = new Vector4(1f, 1f, 1f, 0f), Gain = new Vector4(1f, 1f, 1f, 0f),
            };
            var row = new RegionAtmosphereRow { Region = id, Params = p };
            switch (id)
            {
                case RegionId.Frost:     // bright, whiter, cold sunlight; crisp long shadows; snow
                    row.Name = "Frost";
                    p.SunColor = Tint(key, .45f); p.SunStrength = .92f; p.ShadowLength = 1.4f; p.AmbientColor = Tint(amb, .3f) * .42f;   // passive level about .93
                    p.LightColor = Tint(Mix(amb, key, .4f), .1f);
                    p.LightScale = .8f; p.PostExposure = -.1f; p.Contrast = 12f; p.Saturation = 0f; p.ColorFilter = Tint(accent, .04f);
                    p.SplitShadows = Toning(shadow, .45f); p.SplitHighlights = Toning(key, .1f); p.SplitBalance = -15f;
                    p.BloomThreshold = .97f; p.BloomIntensity = .25f; p.BloomScatter = .7f; p.BloomTint = Tint(accent, .25f);
                    p.VignetteIntensity = .16f; p.Haze = A(fog, .075f);
                    p.Lift = new Vector4(.80f, .90f, 1f, .02f); p.Gain = new Vector4(1f, 1f, 1f, 0f);        // cold, clean blacks; neutral white snow
                    row.Particles = ParticlePresetId.Snow; row.Music = "music_frost"; row.Ambience = "amb_frost";
                    row.Accent = new AccentLightSpec { Terrain = TerrainKind.Ice, Color = Tint(accent, .6f), Intensity = 1.6f, Radius = 4.2f, Flicker = .5f };
                    break;
                case RegionId.Fire:      // under the mountain: almost no sun, lava does the lighting; embers
                    row.Name = "Fire";
                    p.SunColor = Tint(key, .7f); p.LightScale = 1.1f; p.SunStrength = .2f; p.ShadowLength = .35f; p.AmbientColor = Tint(amb, .3f) * .56f;
                    p.LightColor = Tint(Mix(amb, key, .3f), .2f);
                    p.PostExposure = .12f; p.Contrast = 10f; p.Saturation = -6f; p.ColorFilter = Tint(accent, .03f);
                    p.SplitShadows = Toning(shadow, .55f); p.SplitHighlights = Toning(accent, .3f); p.SplitBalance = 10f;
                    p.BloomThreshold = .9f; p.BloomIntensity = .4f; p.BloomScatter = .65f; p.BloomTint = Tint(accent, .6f);
                    p.VignetteIntensity = .2f; p.Haze = A(fog, .09f);
                    p.Lift = new Vector4(.92f, .55f, .45f, .025f); p.Gain = new Vector4(1f, .88f, .74f, 0f);   // ember-warm blacks, hot highlights
                    row.Particles = ParticlePresetId.Embers; row.Music = "music_fire"; row.Ambience = "amb_fire";
                    row.Accent = new AccentLightSpec { Terrain = TerrainKind.Lava, Color = Tint(accent, .85f), Intensity = 2.2f, Radius = 6.5f, Flicker = 1f };
                    break;
                case RegionId.Sentenced: // the one muted zone: hazy harvest dusk
                    row.Name = "Sentenced";
                    p.SunColor = Tint(key, .22f); p.LightScale = 1.0f; p.SunStrength = .24f; p.ShadowLength = .5f; p.AmbientColor = Tint(amb, .5f) * .45f;
                    p.LightColor = Tint(Mix(amb, key, .55f), .15f);
                    p.PostExposure = .55f; p.Contrast = 4f; p.Saturation = -22f; p.ColorFilter = Color.white;
                    p.SplitShadows = Toning(shadow, .3f); p.SplitHighlights = Toning(amb, .1f); p.SplitBalance = -20f;
                    p.BloomThreshold = .9f; p.BloomIntensity = .3f; p.BloomScatter = .75f; p.BloomTint = Tint(key, .4f);
                    p.VignetteIntensity = .22f; p.Haze = A(fog, .13f);
                    p.Lift = new Vector4(.72f, .64f, .86f, .045f); p.Gain = new Vector4(1f, .97f, .94f, 0f);   // hazy violet-grey lifted blacks (gothic dusk), never lighter than the passive floor
                    row.Particles = ParticlePresetId.Dust; row.Music = "music_sentenced"; row.Ambience = "amb_sentenced";
                    row.Accent = new AccentLightSpec { Lantern = true, Color = Mix(Tint(key, .8f), Tint(accent, .8f), .3f), Intensity = 2.4f, Radius = 5.4f, Flicker = .35f };   // iron lanterns: soft warm-cold pools of light
                    break;
                case RegionId.Plague:    // sickly teal-green, dim green-filtered light; spores
                    row.Name = "Plague";
                    p.SunColor = Tint(Mix(key, Palette(RegionId.Holy, RegionPaletteGenerated.Key), .6f), .8f); p.LightScale = .92f; p.SunStrength = .55f; p.ShadowLength = .85f; p.AmbientColor = Tint(amb, .35f) * .42f;   // medium
                    p.LightColor = Tint(Mix(amb, key, .35f), .15f);
                    p.PostExposure = .04f; p.Contrast = 9f; p.Saturation = -16f; p.ColorFilter = Tint(Mix(accent, Palette(id, RegionPaletteGenerated.Base), .7f), .1f);
                    p.SplitShadows = Toning(shadow, .5f); p.SplitHighlights = Toning(key, .2f); p.SplitBalance = -5f;
                    p.BloomThreshold = .92f; p.BloomIntensity = .35f; p.BloomScatter = .65f; p.BloomTint = Tint(accent, .5f);
                    p.VignetteIntensity = .2f; p.Haze = A(fog, .11f);
                    p.Lift = new Vector4(.55f, .90f, .78f, .03f); p.Gain = new Vector4(.94f, 1f, .88f, 0f);    // teal-green shadows, a touch of sickly gold in the light
                    row.Particles = ParticlePresetId.Spores; row.Music = "music_plague"; row.Ambience = "amb_plague";
                    row.Accent = new AccentLightSpec { Terrain = TerrainKind.Bog, Color = Tint(accent, .9f), Intensity = 1.4f, Radius = 4.2f, Flicker = .6f };
                    break;
                case RegionId.Holy:      // strong golden sun, warm dust
                    row.Name = "Holy";
                    p.SunColor = Tint(key, .6f); p.LightScale = 1.22f; p.SunStrength = 1.0f; p.ShadowLength = 1.1f; p.AmbientColor = Tint(amb, .35f) * .46f;   // brightest passive level; the sand itself is darker and richer, rays carry the brightness
                    p.LightColor = Tint(Mix(amb, key, .6f), .15f);
                    p.PostExposure = -.04f; p.Contrast = 6f; p.Saturation = -8f; p.ColorFilter = Tint(key, .06f);
                    p.SplitShadows = Toning(shadow, .3f); p.SplitHighlights = Toning(key, .32f); p.SplitBalance = 5f;
                    p.BloomThreshold = .96f; p.BloomIntensity = .22f; p.BloomScatter = .75f; p.BloomTint = Tint(key, .7f);
                    p.VignetteIntensity = .1f; p.Haze = A(fog, .09f);
                    p.Lift = new Vector4(1f, .86f, .70f, .015f); p.Gain = new Vector4(1f, .95f, .83f, 0f);       // warm golden highlights
                    row.Particles = ParticlePresetId.Pollen; row.Music = "music_holy"; row.Ambience = "amb_holy";
                    row.Accent = new AccentLightSpec { Terrain = TerrainKind.Light, Color = Tint(key, .9f), Intensity = .9f, Radius = 4.6f, Flicker = .25f };
                    break;
                default:                 // coliseum (and region none): neutral daylight
                    row.Name = "Coliseum";
                    p.SunColor = Tint(key, .3f); p.SunStrength = .85f; p.ShadowLength = 1f; p.AmbientColor = Tint(amb, .25f) * .52f;
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
            _temple = Temple();
            rows[0].Name = "None";
            return rows;
        }

        static RegionAtmosphereRow Temple()
        {
            var holy = Row(RegionId.Holy); var p = holy.Params;
            var key = Palette(RegionId.Holy, RegionPaletteGenerated.Key); var amb = Palette(RegionId.Holy, RegionPaletteGenerated.Ambient);
            // Indoors: cooler, softer and more even than the sand outside (the sun is the stone's own cool ivory; the warm light is the lamps and the gold inlay).
            var cool = new Color(.80f, .88f, 1f, 1f);
            p.SunColor = Tint(Mix(key, cool, .5f), .42f); p.SunStrength = .3f; p.ShadowLength = .4f; p.AmbientColor = Tint(Mix(Mix(amb, key, .5f), cool, .4f), .45f) * .8f;
            p.PostExposure = 0f; p.Contrast = 4f; p.BloomThreshold = .94f; p.BloomIntensity = .3f; p.VignetteIntensity = .08f; p.Haze = A(Palette(RegionId.Holy, RegionPaletteGenerated.Fog), .04f);
            p.PassiveFloor = Tint(amb, .3f) * .55f;
            TempleLamp = new AccentLightSpec { Lantern = true, Color = Tint(Mix(key, Palette(RegionId.Fire, RegionPaletteGenerated.Accent), .25f), .8f), Intensity = 1.5f, Radius = 3.6f, Flicker = .3f };
            return new RegionAtmosphereRow { Region = RegionId.Holy, Name = "HolyTempleInterior", Params = p, Particles = ParticlePresetId.None, Music = "music_holy", Ambience = "amb_holy" };
        }

        /// <summary>All music ids the table can request (for the audio loader's fallback and the build check).</summary>
        public static readonly string[] AllAudioIds =
        {
            "music_fire", "music_sentenced", "music_plague", "music_frost", "music_holy", "music_coliseum",
            "amb_fire", "amb_sentenced", "amb_plague", "amb_frost", "amb_holy",
        };
    }
}
