// Data-driven region look table. One entry per wire region id (crates/rh-sim/src/mapdata/model.rs RegionId::code):
// 0 none, 1 fire, 2 sentenced, 3 plague, 4 frost, 5 holy, 6 coliseum. Terrain kinds are the semantic terrain plane codes
// (packages/shared terrain.ts, validated 0..=7 in crates/rh-sim/src/mapdata/validate.rs): 1 lava, 2 fence, 3 crevasse,
// 4 ember, 5 bog, 6 ice, 7 light. Colours come only from RegionPaletteGenerated (docs/art/palette.json); numbers below are
// shading strengths, not colours. Presentation only: nothing here feeds gameplay.
using UnityEngine;

namespace Roguehalla.Client
{
    public enum RegionId : byte { None = 0, Fire = 1, Sentenced = 2, Plague = 3, Frost = 4, Holy = 5, Coliseum = 6 }
    public enum TerrainKind : byte { None = 0, Lava = 1, Fence = 2, Crevasse = 3, Ember = 4, Bog = 5, Ice = 6, Light = 7 }
    /// <summary>Wall and low-obstacle skin.</summary>
    public enum WallStyle : byte { Limestone = 0, Basalt, Timber, Ruin, Glacier, Sandstone, Temple }

    /// <summary>One scatter rule: which procedural prop, how many per 100 eligible tiles, and where it may stand.</summary>
    public readonly struct PropRule
    {
        public readonly string Art;
        public readonly float PerHundredTiles;
        public readonly float ScaleMin, ScaleMax;
        /// <summary>Prefers tiles within 2 tiles of (not on) this terrain kind; 0 = anywhere in the region.</summary>
        public readonly TerrainKind NearTerrain;
        /// <summary>Tiles from any wall or low obstacle the prop must keep (open space for fighting).</summary>
        public readonly int WallClearance;
        /// <summary>Lawn/greenery pocket mask range (0..1, the same value the ground shader uses) the tile must fall inside.</summary>
        public readonly float PocketMin, PocketMax;
        public PropRule(string art, float perHundred, float scaleMin = .9f, float scaleMax = 1.15f, TerrainKind near = TerrainKind.None, int wallClearance = 1, float pocketMin = 0f, float pocketMax = 1f)
        { Art = art; PerHundredTiles = perHundred; ScaleMin = scaleMin; ScaleMax = scaleMax; NearTerrain = near; WallClearance = wallClearance; PocketMin = pocketMin; PocketMax = pocketMax; }
    }

    public sealed class RegionTheme
    {
        public RegionId Id;
        public string Name;
        public Color Base, Secondary, Accent, Key, Ambient, Shadow, Fog;   // linear, for shaders and vertex colours
        public Color32 BaseSrgb, SecondarySrgb, AccentSrgb;
        public WallStyle Wall;
        /// <summary>Wall colours (sRGB 0..1) derived from the palette swatches.</summary>
        public Color WallFace, WallTop, WallEdge;
        /// <summary>x detail contrast, y secondary amount, z accent amount, w pocket threshold (0 = no pockets; else the mask value where greenery starts).</summary>
        public Vector4 GroundParams;
        /// <summary>x macro variation, y accent emission, z reserved, w sparkle.</summary>
        public Vector4 GroundParams2;
        public PropRule[] Props = System.Array.Empty<PropRule>();
    }

    public readonly struct TerrainLook
    {
        public readonly Color Deep, Light, Glow;
        public TerrainLook(Color deep, Color light, Color glow) { Deep = deep; Light = light; Glow = glow; }
    }

    public static class RegionThemes
    {
        public const int RegionCount = 7;
        static readonly RegionTheme[] Themes = BuildThemes();
        static readonly TerrainLook[] Terrain = BuildTerrain();

        public static RegionTheme Get(int id) { return Themes[id >= 0 && id < RegionCount ? id : 0]; }
        public static RegionTheme Get(RegionId id) { return Get((int)id); }
        public static TerrainLook TerrainLookOf(int kind) { return Terrain[kind >= 0 && kind < Terrain.Length ? kind : 0]; }

        static Color S(int region, int slot) { return RegionPaletteGenerated.Srgb[region][slot]; }
        static Color Lin(Color srgb) { return srgb.linear; }
        static Color Mix(Color a, Color b, float t) { return Color.Lerp(a, b, t); }
        static Color Shade(Color c, float k) { return new Color(c.r * k, c.g * k, c.b * k, 1); }

        static RegionTheme[] BuildThemes()
        {
            var t = new RegionTheme[RegionCount];
            for (int id = 0; id < RegionCount; id++)
            {
                var th = new RegionTheme { Id = (RegionId)id };
                th.Name = ((RegionId)id).ToString();
                th.BaseSrgb = RegionPaletteGenerated.Srgb[id][RegionPaletteGenerated.Base];
                th.SecondarySrgb = RegionPaletteGenerated.Srgb[id][RegionPaletteGenerated.Secondary];
                th.AccentSrgb = RegionPaletteGenerated.Srgb[id][RegionPaletteGenerated.Accent];
                th.Base = Lin(S(id, RegionPaletteGenerated.Base)); th.Secondary = Lin(S(id, RegionPaletteGenerated.Secondary));
                th.Accent = Lin(S(id, RegionPaletteGenerated.Accent)); th.Key = Lin(S(id, RegionPaletteGenerated.Key));
                th.Ambient = Lin(S(id, RegionPaletteGenerated.Ambient)); th.Shadow = Lin(S(id, RegionPaletteGenerated.Shadow));
                th.Fog = Lin(S(id, RegionPaletteGenerated.Fog));
                t[id] = th;
            }
            Color B(int id) { return S(id, RegionPaletteGenerated.Base); }
            Color Sec(int id) { return S(id, RegionPaletteGenerated.Secondary); }
            Color Acc(int id) { return S(id, RegionPaletteGenerated.Accent); }

            // 0 none and 6 coliseum: warm limestone.
            foreach (int id in new[] { 0, 6 })
            {
                var th = t[id]; th.Name = id == 0 ? "None" : "Coliseum"; th.Wall = WallStyle.Limestone;
                th.WallTop = B(6); th.WallFace = Shade(B(6), .80f); th.WallEdge = Mix(Sec(6), B(6), .35f);
                th.GroundParams = new Vector4(.55f, .40f, 0, 0); th.GroundParams2 = new Vector4(.12f, 0, .35f, 0);
            }
            // 1 fire: dark basalt, obsidian walls, ember-lit cracks.
            { var th = t[1]; th.Wall = WallStyle.Basalt;
              th.WallTop = Mix(Sec(1), B(1), .55f); th.WallFace = Mix(Sec(1), B(1), .22f); th.WallEdge = Acc(1);
              th.GroundParams = new Vector4(.70f, .30f, .22f, 0); th.GroundParams2 = new Vector4(.40f, .22f, 0, 0);
              th.Props = new[] { new PropRule("fire.spire", 2.4f, .9f, 1.3f), new PropRule("fire.rocks", 3.2f, .85f, 1.2f), new PropRule("fire.stump", 1.6f, .9f, 1.15f),
                                 new PropRule("fire.crystal", 1.4f, .8f, 1.2f), new PropRule("fire.vent", 1.1f, .9f, 1.1f) }; }
            // 2 sentenced: the muted zone. Gothic crypt-yard: dark masonry, iron railings, tombstones, hazy.
            { var th = t[2]; th.Wall = WallStyle.Timber;
              th.WallTop = new Color(.505f, .515f, .565f); th.WallFace = Mix(Sec(2), B(2), .35f); th.WallEdge = new Color(.58f, .59f, .65f);
              th.GroundParams = new Vector4(.55f, .6f, 0, 0); th.GroundParams2 = new Vector4(.22f, 0, .15f, 0);
              th.Props = new[] { new PropRule("sent.tomb", 2.6f, .9f, 1.15f), new PropRule("sent.cross", 1.7f, .9f, 1.15f), new PropRule("sent.slab", 1.4f, .9f, 1.15f),
                                 new PropRule("sent.deadgrass", 6f, .85f, 1.2f), new PropRule("sent.deadtree", 1.1f, .85f, 1.2f), new PropRule("sent.lantern", 3.6f, .95f, 1.05f, wallClearance: 1),
                                 new PropRule("sent.urn", .9f, .9f, 1.1f), new PropRule("sent.gargoyle", .5f, .95f, 1.05f, wallClearance: 1), new PropRule("sent.scarecrow", .12f, .95f, 1.05f, wallClearance: 2) }; }
            // 3 plague: forgotten city. Mossy paving, dense greenery pockets.
            { var th = t[3]; th.Wall = WallStyle.Ruin;
              th.WallTop = Mix(Sec(3), B(3), .45f); th.WallFace = Mix(Sec(3), new Color(.48f, .50f, .46f), .45f); th.WallEdge = Mix(Sec(3), Acc(3), .3f);
              th.GroundParams = new Vector4(.80f, .50f, .30f, RegionPocket.PlagueThreshold); th.GroundParams2 = new Vector4(.32f, .45f, 0, 0);
              th.Props = new[] { new PropRule("plague.bush", 6.5f, .85f, 1.25f, pocketMin: RegionPocket.PlagueThreshold), new PropRule("plague.tree", 2.6f, .9f, 1.2f, wallClearance: 2, pocketMin: RegionPocket.PlagueThreshold + .03f),
                                 new PropRule("plague.fern", 8f, .85f, 1.2f, pocketMin: RegionPocket.PlagueThreshold - .04f), new PropRule("plague.mushroom", 1.8f, .85f, 1.15f, pocketMin: RegionPocket.PlagueThreshold - .02f),
                                 new PropRule("plague.column", 1.5f, .9f, 1.15f, wallClearance: 2, pocketMax: RegionPocket.PlagueThreshold), new PropRule("plague.rubble", 2.6f, .85f, 1.2f, pocketMax: RegionPocket.PlagueThreshold + .04f) }; }
            // 4 frost: frozen plains. Snow, glacier rock, ice lakes. The finished slice.
            { var th = t[4]; th.Wall = WallStyle.Glacier;
              th.WallTop = B(4); th.WallFace = Mix(Sec(4), B(4), .12f); th.WallEdge = Acc(4);
              th.GroundParams = new Vector4(.30f, .24f, 0f, 0); th.GroundParams2 = new Vector4(.16f, 0f, 1.9f, .75f);
              th.Props = new[] { new PropRule("frost.pine", 2.0f, .85f, 1.2f, wallClearance: 2), new PropRule("frost.pine2", 1.3f, .85f, 1.15f, wallClearance: 2),
                                 new PropRule("frost.rock", 1.5f, .8f, 1.2f), new PropRule("frost.rock2", 1.0f, .8f, 1.2f),
                                 new PropRule("frost.drift", 3.4f, .8f, 1.3f), new PropRule("frost.drift2", 2.2f, .8f, 1.3f),
                                 new PropRule("frost.shards", 1.5f, .8f, 1.25f), new PropRule("frost.bush", 1.6f, .85f, 1.15f),
                                 new PropRule("frost.reeds", 16f, .85f, 1.2f, TerrainKind.Ice, 1), new PropRule("frost.shards", 7f, .7f, 1.1f, TerrainKind.Ice, 1) }; }
            // 5 holy: desert, oasis and garden pockets, golden sun.
            { var th = t[5]; th.Wall = WallStyle.Sandstone;
              th.WallTop = Mix(B(5), Acc(5), .22f); th.WallFace = Shade(B(5), .80f); th.WallEdge = Acc(5);
              th.GroundParams = new Vector4(.40f, 0f, .35f, RegionPocket.HolyThreshold); th.GroundParams2 = new Vector4(.20f, .25f, .8f, .25f);
              th.Props = new[] { new PropRule("holy.palm", 5.5f, .9f, 1.2f, wallClearance: 2, pocketMin: RegionPocket.HolyThreshold + .04f), new PropRule("holy.shrub", 9f, .85f, 1.2f, pocketMin: RegionPocket.HolyThreshold + .02f),
                                 new PropRule("holy.flowers", 12f, .85f, 1.2f, pocketMin: RegionPocket.HolyThreshold + .05f), new PropRule("holy.grass", 14f, .85f, 1.2f, pocketMin: RegionPocket.HolyThreshold - .02f),
                                 new PropRule("holy.pillar", 1.0f, .9f, 1.1f, wallClearance: 2, pocketMax: RegionPocket.HolyThreshold - .06f), new PropRule("holy.rock", 2.0f, .85f, 1.2f, pocketMax: RegionPocket.HolyThreshold - .04f) }; }
            return t;
        }

        static TerrainLook[] BuildTerrain()
        {
            var r = new TerrainLook[8];
            Color Fire(int slot) { return S(1, slot); }
            // lava: obsidian crust, lava accent, hot core
            r[(int)TerrainKind.Lava] = new TerrainLook(Lin(Mix(S(1, 1), S(1, 5), .55f)), Lin(Mix(Fire(2), Color.white, .30f)), Lin(Fire(2)) * 2.0f);
            // ember: charred floor, same fire accent
            r[(int)TerrainKind.Ember] = new TerrainLook(Lin(Shade(Mix(S(1, 0), S(1, 1), .5f), .8f)), Lin(Fire(2)), Lin(Fire(2)) * 1.6f);
            // bog: murky plague green, spore glow
            r[(int)TerrainKind.Bog] = new TerrainLook(Lin(Shade(Mix(S(3, 1), S(3, 0), .35f), .72f)), Lin(Mix(S(3, 0), S(3, 2), .25f)), Lin(S(3, 2)) * 1.4f);
            // ice: glacier cyan over frost white
            r[(int)TerrainKind.Ice] = new TerrainLook(Lin(Mix(S(4, 2), S(4, 1), .50f)), Lin(Mix(S(4, 0), Color.white, .55f)), Lin(S(4, 2)) * 1.1f);
            // light: sanctified gold
            r[(int)TerrainKind.Light] = new TerrainLook(Lin(Mix(S(5, 2), S(5, 0), .35f)), Lin(Mix(S(5, 0), S(5, 3), .5f)), Lin(S(5, 3)) * 0.9f);
            // crevasse: deep frost shadow with pale lip
            r[(int)TerrainKind.Crevasse] = new TerrainLook(Lin(Shade(S(4, 5), .55f)), Lin(S(4, 0)), Lin(S(4, 2)) * .7f);
            return r;
        }
    }
}
