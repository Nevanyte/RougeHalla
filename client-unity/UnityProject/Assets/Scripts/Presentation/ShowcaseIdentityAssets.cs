using UnityEngine;
using Roguehalla.Net;

namespace Roguehalla.Client
{
    /// <summary>Presentation-only mob role tags. Values mirror shared MOB_ROLE_DEFS order by name, not gameplay rules.</summary>
    public enum ShowcaseMobRole : byte { Grunt, Swarm, Brute, Skirmisher, Caster }

    /// <summary>Canonical, public identity facts for a delivered regional MobTypeId.</summary>
    public struct MobIdentityInfo
    {
        public MobTypeId Type;
        public FactionId Faction;
        public ShowcaseMobRole Role;
        public bool Elite;
        public string DisplayName;

        public MobIdentityInfo(MobTypeId type, FactionId faction, ShowcaseMobRole role, bool elite, string displayName)
        {
            Type = type; Faction = faction; Role = role; Elite = elite; DisplayName = displayName;
        }
    }

    /// <summary>
    /// Cached original vector-derived identity artwork and the explicit map from public MobTypeId to source MOB_TYPES data.
    /// It reads no simulation state and makes no inference about combat, ownership, targetability or hidden actors.
    /// </summary>
    public static class ShowcaseIdentityAssets
    {
        const int TextureSize = 128;
        const float GlyphStroke = .055f;
        static readonly Sprite[] FactionSilhouettes = new Sprite[6];
        static readonly Sprite[] FactionGlyphs = new Sprite[6];
        static readonly Sprite[] RoleGlyphs = new Sprite[5];
        static readonly Sprite[] EliteGlyphs = new Sprite[10];
        static Sprite _badgeBackdrop;
        static Sprite _neutralGlyph;

        static readonly MobIdentityInfo[] MobCatalog =
        {
            new MobIdentityInfo(MobTypeId.EmberImp, FactionId.Fire, ShowcaseMobRole.Swarm, false, "Ember Imp"),
            new MobIdentityInfo(MobTypeId.CinderHound, FactionId.Fire, ShowcaseMobRole.Skirmisher, false, "Cinder Hound"),
            new MobIdentityInfo(MobTypeId.MagmaBrute, FactionId.Fire, ShowcaseMobRole.Brute, false, "Magma Brute"),
            new MobIdentityInfo(MobTypeId.FlameCaller, FactionId.Fire, ShowcaseMobRole.Caster, false, "Flame Caller"),
            new MobIdentityInfo(MobTypeId.Wyrmling, FactionId.Fire, ShowcaseMobRole.Grunt, true, "Wyrmling"),
            new MobIdentityInfo(MobTypeId.AshDrake, FactionId.Fire, ShowcaseMobRole.Caster, true, "Ash Drake"),
            new MobIdentityInfo(MobTypeId.Bailiff, FactionId.Sentenced, ShowcaseMobRole.Grunt, false, "Bailiff"),
            new MobIdentityInfo(MobTypeId.ChainWarden, FactionId.Sentenced, ShowcaseMobRole.Brute, false, "Chain Warden"),
            new MobIdentityInfo(MobTypeId.Inquisitor, FactionId.Sentenced, ShowcaseMobRole.Skirmisher, false, "Inquisitor"),
            new MobIdentityInfo(MobTypeId.Pardoner, FactionId.Sentenced, ShowcaseMobRole.Caster, false, "Pardoner"),
            new MobIdentityInfo(MobTypeId.Executioner, FactionId.Sentenced, ShowcaseMobRole.Grunt, true, "Executioner"),
            new MobIdentityInfo(MobTypeId.Gaoler, FactionId.Sentenced, ShowcaseMobRole.Brute, true, "Gaoler"),
            new MobIdentityInfo(MobTypeId.PlagueRat, FactionId.Plague, ShowcaseMobRole.Swarm, false, "Plague Rat"),
            new MobIdentityInfo(MobTypeId.Bloatfly, FactionId.Plague, ShowcaseMobRole.Skirmisher, false, "Bloatfly"),
            new MobIdentityInfo(MobTypeId.RotMonk, FactionId.Plague, ShowcaseMobRole.Grunt, false, "Rot Monk"),
            new MobIdentityInfo(MobTypeId.MiasmaWitch, FactionId.Plague, ShowcaseMobRole.Caster, false, "Miasma Witch"),
            new MobIdentityInfo(MobTypeId.RatOgre, FactionId.Plague, ShowcaseMobRole.Brute, true, "Rat Ogre"),
            new MobIdentityInfo(MobTypeId.PoxBehemoth, FactionId.Plague, ShowcaseMobRole.Brute, true, "Pox Behemoth"),
            new MobIdentityInfo(MobTypeId.FrostWisp, FactionId.Frost, ShowcaseMobRole.Swarm, false, "Frost Wisp"),
            new MobIdentityInfo(MobTypeId.IceGolem, FactionId.Frost, ShowcaseMobRole.Brute, false, "Ice Golem"),
            new MobIdentityInfo(MobTypeId.RimeStalker, FactionId.Frost, ShowcaseMobRole.Skirmisher, false, "Rime Stalker"),
            new MobIdentityInfo(MobTypeId.FrostbowSentry, FactionId.Frost, ShowcaseMobRole.Caster, false, "Frostbow Sentry"),
            new MobIdentityInfo(MobTypeId.GlacialWarden, FactionId.Frost, ShowcaseMobRole.Grunt, true, "Glacial Warden"),
            new MobIdentityInfo(MobTypeId.AvalancheTroll, FactionId.Frost, ShowcaseMobRole.Brute, true, "Avalanche Troll"),
            new MobIdentityInfo(MobTypeId.Acolyte, FactionId.Holy, ShowcaseMobRole.Grunt, false, "Acolyte"),
            new MobIdentityInfo(MobTypeId.SeraphShard, FactionId.Holy, ShowcaseMobRole.Swarm, false, "Seraph Shard"),
            new MobIdentityInfo(MobTypeId.Penitent, FactionId.Holy, ShowcaseMobRole.Skirmisher, false, "Penitent"),
            new MobIdentityInfo(MobTypeId.Zealot, FactionId.Holy, ShowcaseMobRole.Brute, false, "Zealot"),
            new MobIdentityInfo(MobTypeId.BloodSaint, FactionId.Holy, ShowcaseMobRole.Grunt, true, "Blood Saint"),
            new MobIdentityInfo(MobTypeId.Archon, FactionId.Holy, ShowcaseMobRole.Skirmisher, true, "Archon"),
        };

        // Source zone order: Fire, Sentenced, Plague, Frost, Holy. Coordinates use a -1..1 unit square.
        static readonly Vector2[][][] SilhouettePolygons =
        {
            new[] { // Fire: vented obsidian mantle, high paired horns.
                new[] { new Vector2(-.88f,-.52f),new Vector2(-.78f,.06f),new Vector2(-.53f,.21f),new Vector2(-.39f,.50f),new Vector2(-.26f,.23f),new Vector2(-.12f,.34f),new Vector2(0,.72f),new Vector2(.12f,.34f),new Vector2(.26f,.23f),new Vector2(.39f,.50f),new Vector2(.53f,.21f),new Vector2(.78f,.06f),new Vector2(.88f,-.52f),new Vector2(.46f,-.30f),new Vector2(0,-.42f),new Vector2(-.46f,-.30f) },
                new[] { new Vector2(-.62f,.20f),new Vector2(-.70f,.74f),new Vector2(-.37f,.47f),new Vector2(-.31f,.12f) },
                new[] { new Vector2(.62f,.20f),new Vector2(.70f,.74f),new Vector2(.37f,.47f),new Vector2(.31f,.12f) },
            },
            new[] { // Sentenced: iron diamond mantle with hanging chain corners.
                new[] { new Vector2(0,.78f),new Vector2(.78f,.02f),new Vector2(.55f,-.50f),new Vector2(0,-.78f),new Vector2(-.55f,-.50f),new Vector2(-.78f,.02f) },
                new[] { new Vector2(-.68f,.20f),new Vector2(-.83f,-.18f),new Vector2(-.57f,-.54f),new Vector2(-.35f,-.36f) },
                new[] { new Vector2(.68f,.20f),new Vector2(.83f,-.18f),new Vector2(.57f,-.54f),new Vector2(.35f,-.36f) },
            },
            new[] { // Plague: ragged hood with three spore crowns.
                new[] { new Vector2(-.82f,-.54f),new Vector2(-.72f,.17f),new Vector2(-.55f,.53f),new Vector2(-.29f,.63f),new Vector2(0,.55f),new Vector2(.29f,.63f),new Vector2(.55f,.53f),new Vector2(.72f,.17f),new Vector2(.82f,-.54f),new Vector2(.53f,-.36f),new Vector2(.33f,-.57f),new Vector2(.12f,-.43f),new Vector2(-.12f,-.60f),new Vector2(-.34f,-.42f),new Vector2(-.55f,-.56f) },
                new[] { new Vector2(-.43f,.54f),new Vector2(-.55f,.94f),new Vector2(-.25f,.73f) },
                new[] { new Vector2(-.15f,.62f),new Vector2(0,1),new Vector2(.15f,.62f) },
                new[] { new Vector2(.43f,.54f),new Vector2(.55f,.94f),new Vector2(.25f,.73f) },
            },
            new[] { // Frost: crystalline crown and six angular shoulder shards.
                new[] { new Vector2(-.85f,-.42f),new Vector2(-.68f,.02f),new Vector2(-.48f,-.17f),new Vector2(-.26f,.16f),new Vector2(-.14f,.60f),new Vector2(0,.95f),new Vector2(.14f,.60f),new Vector2(.26f,.16f),new Vector2(.48f,-.17f),new Vector2(.68f,.02f),new Vector2(.85f,-.42f),new Vector2(.45f,-.31f),new Vector2(0,-.60f),new Vector2(-.45f,-.31f) },
                new[] { new Vector2(-.75f,-.34f),new Vector2(-1,-.04f),new Vector2(-.58f,-.12f) },
                new[] { new Vector2(.75f,-.34f),new Vector2(1,-.04f),new Vector2(.58f,-.12f) },
            },
            new[] { // Holy: ivory mantle with a halo arch.
                new[] { new Vector2(-.90f,-.54f),new Vector2(-.68f,.12f),new Vector2(-.39f,.30f),new Vector2(-.25f,.17f),new Vector2(-.15f,.52f),new Vector2(0,.68f),new Vector2(.15f,.52f),new Vector2(.25f,.17f),new Vector2(.39f,.30f),new Vector2(.68f,.12f),new Vector2(.90f,-.54f),new Vector2(.48f,-.36f),new Vector2(0,-.46f),new Vector2(-.48f,-.36f) },
            }
        };

        public static int MobTypeCount { get { return MobCatalog.Length; } }
        public static int EliteTypeCount { get { return 10; } }

        /// <summary>Returns canonical type metadata, or false for an unknown/future enum value.</summary>
        public static bool TryGetMobInfo(MobTypeId type, out MobIdentityInfo info)
        {
            int index = (int)type;
            if ((uint)index < (uint)MobCatalog.Length && MobCatalog[index].Type == type)
            {
                info = MobCatalog[index];
                return true;
            }
            info = default;
            return false;
        }

        public static Sprite GetFactionSilhouette(int faction)
        {
            int index = faction >= 0 && faction < 5 ? faction : 5;
            if (FactionSilhouettes[index] == null) FactionSilhouettes[index] = BuildSilhouette(index);
            return FactionSilhouettes[index];
        }

        public static Sprite GetFactionGlyph(int faction)
        {
            int index = faction >= 0 && faction < 5 ? faction : 5;
            if (FactionGlyphs[index] == null) FactionGlyphs[index] = BuildGlyph(0, index);
            return FactionGlyphs[index];
        }

        public static Sprite GetRoleGlyph(ShowcaseMobRole role)
        {
            int index = (int)role;
            if ((uint)index >= (uint)RoleGlyphs.Length) index = RoleGlyphs.Length;
            // Slot five is the neutral unknown glyph shared by future role ids.
            if (index == RoleGlyphs.Length) return NeutralGlyph();
            if (RoleGlyphs[index] == null) RoleGlyphs[index] = BuildGlyph(1, index);
            return RoleGlyphs[index];
        }

        public static Sprite GetEliteGlyph(MobTypeId type)
        {
            if (!TryGetEliteIndex(type, out int index)) return NeutralGlyph();
            if (EliteGlyphs[index] == null) EliteGlyphs[index] = BuildGlyph(2, index);
            return EliteGlyphs[index];
        }

        public static bool TryGetEliteIndex(MobTypeId type, out int index)
        {
            switch (type)
            {
                case MobTypeId.Wyrmling: index = 0; return true;
                case MobTypeId.AshDrake: index = 1; return true;
                case MobTypeId.Executioner: index = 2; return true;
                case MobTypeId.Gaoler: index = 3; return true;
                case MobTypeId.RatOgre: index = 4; return true;
                case MobTypeId.PoxBehemoth: index = 5; return true;
                case MobTypeId.GlacialWarden: index = 6; return true;
                case MobTypeId.AvalancheTroll: index = 7; return true;
                case MobTypeId.BloodSaint: index = 8; return true;
                case MobTypeId.Archon: index = 9; return true;
                default: index = -1; return false;
            }
        }

        public static Sprite GetBadgeBackdrop()
        {
            if (_badgeBackdrop == null) _badgeBackdrop = BuildBadgeBackdrop();
            return _badgeBackdrop;
        }

        public static Sprite GetNeutralGlyph() { return NeutralGlyph(); }

        static Sprite BuildBadgeBackdrop()
        {
            var pixels = new Color32[TextureSize * TextureSize];
            var dark = new Color32(10, 15, 24, 248);
            var edge = new Color32(238, 233, 219, 255);
            for (int y = 0; y < TextureSize; y++)
            for (int x = 0; x < TextureSize; x++)
            {
                float u = (x + .5f) / TextureSize * 2f - 1f;
                float v = (y + .5f) / TextureSize * 2f - 1f;
                float radius = Mathf.Sqrt(u * u + v * v);
                if (radius > .96f) continue;
                pixels[y * TextureSize + x] = radius > .82f ? edge : dark;
            }
            return CreateSprite("badge-backdrop", pixels);
        }

        public static Material UnlitMaterial
        {
            get { ShowcaseSprites.Initialize(); return ShowcaseSprites.Unlit; }
        }

        static Sprite NeutralGlyph()
        {
            if (_neutralGlyph == null) _neutralGlyph = BuildGlyph(3, 1);
            return _neutralGlyph;
        }

        static Sprite BuildSilhouette(int faction)
        {
            var pixels = new Color32[TextureSize * TextureSize];
            Color32 fill = faction < 5 ? ShowcasePalette.Faction(faction) : new Color32(135, 147, 160, 255);
            Color32 edge = new Color32(8, 12, 19, 255);
            for (int y = 0; y < TextureSize; y++)
            for (int x = 0; x < TextureSize; x++)
            {
                float u = (x + .5f) / TextureSize * 2f - 1f;
                float v = (y + .5f) / TextureSize * 2f - 1f;
                float mask = 0;
                if (faction < 5)
                {
                    var polygons = SilhouettePolygons[faction];
                    for (int p = 0; p < polygons.Length; p++) mask = Mathf.Max(mask, PolygonCoverage(u, v, polygons[p]));
                }
                else mask = PolygonCoverage(u, v, NeutralSilhouette);
                if (mask <= 0) continue;
                float cut = SilhouetteDetail(faction, u, v);
                Color32 c = cut > .5f ? edge : fill;
                c.a = (byte)Mathf.RoundToInt(mask * 255);
                pixels[y * TextureSize + x] = c;
            }
            return CreateSprite("faction-silhouette-" + faction, pixels);
        }

        static readonly Vector2[] NeutralSilhouette =
        {
            new Vector2(-.66f,-.56f),new Vector2(-.66f,.38f),new Vector2(0,.76f),new Vector2(.66f,.38f),new Vector2(.66f,-.56f),new Vector2(0,-.78f)
        };

        static float SilhouetteDetail(int faction, float x, float y)
        {
            switch (faction)
            {
                case 0: return Mathf.Max(Line(x, y, -.32f, .18f, -.18f, .48f, .035f), Line(x, y, .32f, .18f, .18f, .48f, .035f));
                case 1:
                    return Mathf.Max(Ring(x, y, .55f, .36f, .13f, .035f), Mathf.Max(Ring(x, y, -.55f, .36f, .13f, .035f), Line(x, y, 0, -.46f, 0, .44f, .035f)));
                case 2:
                    return Mathf.Max(Circle(x, y, -.34f, .60f, .10f, .025f), Mathf.Max(Circle(x, y, 0, .72f, .10f, .025f), Circle(x, y, .34f, .60f, .10f, .025f)));
                case 3:
                    return Mathf.Max(Line(x, y, -.45f, -.28f, .45f, .38f, .035f), Line(x, y, .45f, -.28f, -.45f, .38f, .035f));
                case 4:
                    return Mathf.Max(Ring(x, y, 0, .55f, .27f, .035f), Line(x, y, -.4f, -.20f, .4f, -.20f, .035f));
                default: return 0;
            }
        }

        static Sprite BuildGlyph(int family, int index)
        {
            var pixels = new Color32[TextureSize * TextureSize];
            for (int y = 0; y < TextureSize; y++)
            for (int x = 0; x < TextureSize; x++)
            {
                float u = (x + .5f) / TextureSize * 2f - 1f;
                float v = (y + .5f) / TextureSize * 2f - 1f;
                float a = GlyphCoverage(family, index, u, v);
                if (a > 0) pixels[y * TextureSize + x] = new Color32(255, 255, 248, (byte)Mathf.RoundToInt(a * 255));
            }
            string name = family == 0 ? "faction-glyph-" + index : family == 1 ? "role-glyph-" + index : family == 2 ? "elite-glyph-" + index : index == 0 ? "badge-backdrop" : "neutral-glyph";
            return CreateSprite(name, pixels);
        }

        static float GlyphCoverage(int family, int index, float x, float y)
        {
            if (family == 3)
            {
                if (index == 0) return Mathf.Max(Ring(x, y, 0, 0, .76f, .045f), Ring(x, y, 0, 0, .93f, .035f));
                return Mathf.Max(PolygonOutline(x, y, NeutralDiamond, .06f), Line(x, y, -.25f, 0, .25f, 0, .07f));
            }
            if (family == 0)
            {
                switch (index)
                {
                    case 0: return Mathf.Max(PolygonOutline(x, y, Triangle, GlyphStroke), Polyline(x, y, FireFlame, GlyphStroke));
                    case 1: return Mathf.Max(PolygonOutline(x, y, Diamond, GlyphStroke), Mathf.Max(Ring(x, y, -.47f, 0, .17f, GlyphStroke), Ring(x, y, .47f, 0, .17f, GlyphStroke)));
                    case 2: return Mathf.Max(Polyline(x, y, PlagueLinks, GlyphStroke), Mathf.Max(Circle(x, y, -.38f, -.25f, .19f, GlyphStroke), Mathf.Max(Circle(x, y, .38f, -.25f, .19f, GlyphStroke), Circle(x, y, 0, .40f, .19f, GlyphStroke))));
                    case 3: return Mathf.Max(Polyline(x, y, FrostSixfold, GlyphStroke), Ring(x, y, 0, 0, .20f, GlyphStroke));
                    case 4: return Mathf.Max(Ring(x, y, 0, 0, .49f, GlyphStroke), Mathf.Max(Line(x, y, 0, -.74f, 0, .74f, GlyphStroke), Mathf.Max(Line(x, y, -.74f, 0, .74f, 0, GlyphStroke), FourRays(x, y))));
                    default: return GlyphCoverage(3, 1, x, y);
                }
            }
            if (family == 1)
            {
                switch (index)
                {
                    case 0: return Mathf.Max(PolygonOutline(x, y, Shield, GlyphStroke), Circle(x, y, 0, -.1f, .11f, GlyphStroke));
                    case 1: return Mathf.Max(Circle(x, y, -.4f, -.25f, .14f, GlyphStroke), Mathf.Max(Circle(x, y, .4f, -.25f, .14f, GlyphStroke), Circle(x, y, 0, .4f, .14f, GlyphStroke)));
                    case 2: return PolygonOutline(x, y, Hexagon, GlyphStroke);
                    case 3: return Mathf.Max(Polyline(x, y, Arrow, GlyphStroke), Line(x, y, -.55f, -.42f, .55f, .42f, GlyphStroke));
                    case 4: return Mathf.Max(Line(x, y, 0, -.70f, 0, .48f, GlyphStroke), Mathf.Max(Ring(x, y, 0, .58f, .19f, GlyphStroke), Line(x, y, -.38f, -.12f, .38f, -.12f, GlyphStroke)));
                }
            }
            if (family == 2) return EliteGlyphCoverage(index, x, y);
            return 0;
        }

        static float EliteGlyphCoverage(int i, float x, float y)
        {
            switch (i)
            {
                case 0: return Mathf.Max(PolygonOutline(x, y, HornedCrest, GlyphStroke), Polyline(x, y, WyrmlingHorns, GlyphStroke));
                case 1: return Mathf.Max(Polyline(x, y, DrakeWings, GlyphStroke), Line(x, y, 0, -.55f, 0, .48f, GlyphStroke));
                case 2: return Mathf.Max(PolygonOutline(x, y, AxeBlade, GlyphStroke), Line(x, y, .28f, -.65f, -.35f, .65f, GlyphStroke));
                case 3: return Mathf.Max(Line(x, y, -.35f, .55f, .3f, .55f, GlyphStroke), Mathf.Max(Ring(x, y, .05f, .16f, .17f, GlyphStroke), Line(x, y, .05f, .16f, .05f, -.65f, GlyphStroke)));
                case 4: return Mathf.Max(Ring(x, y, -.42f, .28f, .23f, GlyphStroke), Mathf.Max(Ring(x, y, .42f, .28f, .23f, GlyphStroke), Mathf.Max(Circle(x, y, 0, -.05f, .25f, GlyphStroke), Polyline(x, y, OgreTusks, GlyphStroke))));
                case 5: return Mathf.Max(Circle(x, y, -.3f, .3f, .18f, GlyphStroke), Mathf.Max(Circle(x, y, .27f, .28f, .22f, GlyphStroke), Mathf.Max(Circle(x, y, -.08f, -.24f, .24f, GlyphStroke), Ring(x, y, 0, 0, .72f, .035f))));
                case 6: return Polyline(x, y, ThreeCrystals, GlyphStroke);
                case 7: return Mathf.Max(PolygonOutline(x, y, BoulderBody, GlyphStroke), Mathf.Max(Circle(x, y, -.53f, -.08f, .2f, GlyphStroke), Circle(x, y, .53f, -.08f, .2f, GlyphStroke)));
                case 8: return Mathf.Max(Ring(x, y, 0, .43f, .31f, GlyphStroke), PolygonOutline(x, y, BloodDrop, GlyphStroke));
                case 9: return EightRayStar(x, y);
                default: return GlyphCoverage(3, 1, x, y);
            }
        }

        static readonly Vector2[] Triangle = { new Vector2(0,.74f),new Vector2(.67f,-.52f),new Vector2(-.67f,-.52f) };
        static readonly Vector2[] Diamond = { new Vector2(0,.78f),new Vector2(.68f,0),new Vector2(0,-.78f),new Vector2(-.68f,0) };
        static readonly Vector2[] NeutralDiamond = { new Vector2(0,.72f),new Vector2(.65f,0),new Vector2(0,-.72f),new Vector2(-.65f,0) };
        static readonly Vector2[] Shield = { new Vector2(-.62f,.58f),new Vector2(.62f,.58f),new Vector2(.54f,-.12f),new Vector2(0,-.70f),new Vector2(-.54f,-.12f) };
        static readonly Vector2[] Hexagon = { new Vector2(-.55f,.45f),new Vector2(0,.75f),new Vector2(.55f,.45f),new Vector2(.55f,-.45f),new Vector2(0,-.75f),new Vector2(-.55f,-.45f) };
        static readonly Vector2[] Arrow = { new Vector2(-.62f,.48f),new Vector2(.62f,-.48f),new Vector2(.18f,-.44f),new Vector2(.62f,-.48f),new Vector2(.58f,-.02f) };
        static readonly Vector2[] FireFlame = { new Vector2(0,-.37f),new Vector2(-.20f,-.08f),new Vector2(-.12f,.15f),new Vector2(0,.48f),new Vector2(.10f,.15f),new Vector2(.20f,-.08f),new Vector2(0,-.37f) };
        static readonly Vector2[] PlagueLinks = { new Vector2(-.38f,-.25f),new Vector2(0,.22f),new Vector2(.38f,-.25f),new Vector2(-.38f,-.25f),new Vector2(-.38f,-.25f),new Vector2(0,.22f),new Vector2(0,.4f) };
        static readonly Vector2[] FrostSixfold = { new Vector2(0,-.76f),new Vector2(0,.76f),new Vector2(-.66f,-.38f),new Vector2(.66f,.38f),new Vector2(.66f,-.38f),new Vector2(-.66f,.38f) };
        static readonly Vector2[] WyrmlingHorns = { new Vector2(-.1f,.25f),new Vector2(-.54f,.70f),new Vector2(-.42f,.16f),new Vector2(0,.38f),new Vector2(.42f,.16f),new Vector2(.54f,.70f),new Vector2(.1f,.25f) };
        static readonly Vector2[] HornedCrest = { new Vector2(-.42f,.28f),new Vector2(0,.53f),new Vector2(.42f,.28f),new Vector2(.35f,-.19f),new Vector2(0,-.62f),new Vector2(-.35f,-.19f) };
        static readonly Vector2[] DrakeWings = { new Vector2(0,-.14f),new Vector2(-.12f,.10f),new Vector2(-.34f,.52f),new Vector2(-.74f,.62f),new Vector2(-.62f,.22f),new Vector2(-.84f,.05f),new Vector2(-.42f,-.10f),new Vector2(0,-.42f),new Vector2(.42f,-.10f),new Vector2(.84f,.05f),new Vector2(.62f,.22f),new Vector2(.74f,.62f),new Vector2(.34f,.52f),new Vector2(.12f,.10f) };
        static readonly Vector2[] AxeBlade = { new Vector2(-.56f,.60f),new Vector2(-.08f,.52f),new Vector2(.25f,.25f),new Vector2(.64f,.34f),new Vector2(.50f,-.06f),new Vector2(.64f,-.42f),new Vector2(.18f,-.32f),new Vector2(-.10f,-.08f) };
        static readonly Vector2[] OgreTusks = { new Vector2(-.22f,-.08f),new Vector2(-.42f,-.58f),new Vector2(-.02f,-.30f),new Vector2(.22f,-.08f),new Vector2(.42f,-.58f),new Vector2(.02f,-.30f) };
        static readonly Vector2[] ThreeCrystals = { new Vector2(-.47f,-.38f),new Vector2(-.47f,.10f),new Vector2(-.24f,.74f),new Vector2(0,.10f),new Vector2(0,-.38f),new Vector2(0,.10f),new Vector2(.24f,.74f),new Vector2(.47f,.10f),new Vector2(.47f,-.38f) };
        static readonly Vector2[] BoulderBody = { new Vector2(-.42f,-.42f),new Vector2(-.58f,.28f),new Vector2(-.28f,.58f),new Vector2(0,.42f),new Vector2(.28f,.58f),new Vector2(.58f,.28f),new Vector2(.42f,-.42f),new Vector2(0,-.68f) };
        static readonly Vector2[] BloodDrop = { new Vector2(0,.62f),new Vector2(.42f,.03f),new Vector2(.36f,-.42f),new Vector2(0,-.66f),new Vector2(-.36f,-.42f),new Vector2(-.42f,.03f),new Vector2(0,.62f) };

        static float FourRays(float x, float y)
        {
            float a = Mathf.Max(Line(x, y, -.70f, -.70f, -.42f, -.42f, GlyphStroke), Line(x, y, .70f, .70f, .42f, .42f, GlyphStroke));
            return Mathf.Max(a, Mathf.Max(Line(x, y, -.70f, .70f, -.42f, .42f, GlyphStroke), Line(x, y, .70f, -.70f, .42f, -.42f, GlyphStroke)));
        }
        static float EightRayStar(float x, float y)
        {
            float c = 0;
            for (int i = 0; i < 8; i++)
            {
                float a = i * Mathf.PI / 4f;
                c = Mathf.Max(c, Line(x, y, Mathf.Cos(a) * .30f, Mathf.Sin(a) * .30f, Mathf.Cos(a) * .82f, Mathf.Sin(a) * .82f, GlyphStroke));
            }
            return Mathf.Max(c, Ring(x, y, 0, 0, .24f, GlyphStroke));
        }
        static float Polyline(float x, float y, Vector2[] points, float width)
        {
            float a = 0;
            for (int i = 1; i < points.Length; i++) a = Mathf.Max(a, Line(x, y, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, width));
            return a;
        }
        static float PolygonOutline(float x, float y, Vector2[] points, float width)
        {
            float a = 0;
            for (int i = 0; i < points.Length; i++)
            {
                Vector2 p = points[i], q = points[(i + 1) % points.Length];
                a = Mathf.Max(a, Line(x, y, p.x, p.y, q.x, q.y, width));
            }
            return a;
        }
        static float PolygonCoverage(float x, float y, Vector2[] points)
        {
            bool inside = false; float distance = 2;
            for (int i = 0, j = points.Length - 1; i < points.Length; j = i++)
            {
                Vector2 a = points[i], b = points[j];
                bool intersects = ((a.y > y) != (b.y > y)) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x;
                if (intersects) inside = !inside;
                distance = Mathf.Min(distance, SegmentDistance(x, y, a.x, a.y, b.x, b.y));
            }
            float signed = inside ? distance : -distance;
            return Mathf.Clamp01(.5f + signed * TextureSize);
        }
        static float Line(float x, float y, float ax, float ay, float bx, float by, float halfWidth)
        { return Mathf.Clamp01(.5f + (halfWidth - SegmentDistance(x, y, ax, ay, bx, by)) * TextureSize); }
        static float SegmentDistance(float x, float y, float ax, float ay, float bx, float by)
        {
            float dx = bx - ax, dy = by - ay, den = dx * dx + dy * dy;
            float t = den > 0 ? Mathf.Clamp01(((x - ax) * dx + (y - ay) * dy) / den) : 0;
            float px = ax + dx * t, py = ay + dy * t;
            float ex = x - px, ey = y - py;
            return Mathf.Sqrt(ex * ex + ey * ey);
        }
        static float Ring(float x, float y, float cx, float cy, float radius, float halfWidth)
        { return Mathf.Clamp01(.5f + (halfWidth - Mathf.Abs(Mathf.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) - radius)) * TextureSize); }
        static float Circle(float x, float y, float cx, float cy, float radius, float halfWidth)
        { return Mathf.Clamp01(.5f + (halfWidth - Mathf.Abs(Mathf.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) - radius)) * TextureSize); }

        static Sprite CreateSprite(string key, Color32[] pixels)
        {
            var texture = new Texture2D(TextureSize, TextureSize, TextureFormat.RGBA32, false)
            {
                name = "Identity artwork / " + key,
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp,
                hideFlags = HideFlags.HideAndDontSave
            };
            texture.SetPixels32(pixels);
            texture.Apply(false, true);
            var sprite = Sprite.Create(texture, new Rect(0, 0, TextureSize, TextureSize), new Vector2(.5f, .5f), 64f, 0, SpriteMeshType.FullRect);
            sprite.name = "Identity artwork / " + key;
            sprite.hideFlags = HideFlags.HideAndDontSave;
            return sprite;
        }
    }
}
