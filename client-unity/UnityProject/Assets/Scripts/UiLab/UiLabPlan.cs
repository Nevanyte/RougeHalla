// UI lab plan (?uilab=1): the synthetic map, the three grounds, the grid geometry and the data of every gallery cell. Pure data and
// arithmetic (no GPU, no scene), so EditMode tests can check coverage. Presentation tooling only: it feeds no game rule and never
// reaches a server. The stage (UiLabStage.cs) turns these specs into the SAME view data the match feeds the real presenters.
//
// Time-based cells carry an Age: how many seconds the effect has been running at the moment the page freezes. The stage schedules each
// effect at (freeze - age), so one frozen frame shows a whole filmstrip of the same effect at different ages, and a capture catches it
// mid-flight without any timing luck. `?uilab.t=<seconds>` overrides every age with one value (step by hand); `?uilab.loop=1` replays live.
using System;
using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client
{
    /// <summary>The three grounds every cell is shown on: hardest dark, hardest bright, and the snow zone.</summary>
    public enum UiLabGround : byte { Dark = 0, Bright = 1, Snow = 2 }

    public sealed class UiLabActor
    {
        public float Dx, Dy;                              // tiles from the cell anchor (the feet)
        public bool Own;                                  // the local fighter (SelfView); at most one per page
        public ActorKind Kind = ActorKind.Player;
        public FactionId? Faction; public MobTypeId? Mob; public WeaponId? Weapon = WeaponId.Sword;
        public byte HpPct = 100; public ushort Effects; public byte Sig; public ushort Bounty; public byte BarrierPct, BarrierRing;
        public float Facing = Mathf.PI / 2f;              // south, toward the camera
        // Time-based events, as ages at the freeze (seconds; negative = none).
        public float AppearAge = -1, LeaveAge = -1, DieAge = -1, HitAge = -1;
        public float HitAmount = 30; public bool HitPassive, HitByMe; public bool DeathMark;
        // Role relative to the local fighter.
        public bool Hover, Lock, Hunt;
        // Own-fighter extras.
        public byte WishAbility = 255; public bool WishReady = true; public WeaponId? Second = null; public bool NoInventory;
        public float Hp = 100f, Barrier;
        public bool HitOnMe;                              // a Hit fx lands on this (own) actor at HitAge
    }

    public sealed class UiLabProp
    {
        public float Dx, Dy; public PropAppearance Kind; public WeaponId? Weapon; public bool Focused, Open, QuestFetch; public string BodyLabel, CorpseLabel;
    }
    public sealed class UiLabQuest { public float Dx, Dy; public bool Accepted, Ready; public string Label = "Maren the Warden"; }
    public sealed class UiLabMerchant { public float Dx, Dy; public TradeKind Kind; public string Name; }
    public sealed class UiLabChest { public float Dx, Dy; public double LeftMs = 12000; }

    public enum UiLabShot : byte { Cell = 0, Screen = 1 }

    public sealed class UiLabCell
    {
        public string Row = "", Variant = "", Caption = "", Legacy = "";
        public UiLabShot Shot = UiLabShot.Cell;
        public readonly List<UiLabActor> Actors = new List<UiLabActor>();
        public readonly List<UiLabProp> Props = new List<UiLabProp>();
        public readonly List<UiLabQuest> Quests = new List<UiLabQuest>();
        public readonly List<UiLabMerchant> Merchants = new List<UiLabMerchant>();
        public readonly List<UiLabChest> Chests = new List<UiLabChest>();
        public bool EdgeGlows;                            // W15: the HUD edge threat glows (screen shot)
        public float Age = -1;                            // largest time-based age in the cell (negative = a still cell)
        public string Id { get { return (Variant.Length == 0 ? Row : Row + "." + Variant).Replace('+', '_'); } }
        public UiLabCell A(UiLabActor a) { Actors.Add(a); if (a.AppearAge > Age) Age = a.AppearAge; if (a.LeaveAge > Age) Age = a.LeaveAge; if (a.DieAge > Age) Age = a.DieAge; if (a.HitAge > Age) Age = a.HitAge; return this; }
        public bool NeedsMe { get { foreach (var a in Actors) if (a.Own || a.Hover || a.Lock || a.Hunt || a.HitByMe) return true; return Chests.Count > 0 && Near; } }
        public bool Near;                                 // the chest is meant to be within reach of the local fighter (seconds text shown)
        public bool Fades;                                // the cell needs vision exit fades enabled
        public int Span = 1;                              // grid columns the cell is wide (a reward chest's ring is wider than one cell)
        public bool Tall;                                 // the crop also takes the empty slot above (a stack taller than one cell); needs headroom
    }

    public sealed class UiLabPage
    {
        public string Name; public UiLabShot Shot; public bool Fades; public bool HasMe;
        public int StartSlot;                             // first slot used; pages with tall cells start on row 1 so row 0 is their headroom
        public readonly List<UiLabCell> Cells = new List<UiLabCell>();
    }

    public static class UiLabMap
    {
        // Blocks left to right: Sentenced (dark flagstone), Frost (snow), Holy (temple floor under a generated temple).
        public const int Border = 2, H = 76, SentencedX0 = 0, SentencedW = 48, FrostX0 = 48, FrostW = 48, HolyX0 = 96, HolyW = 112;
        public static int W { get { return HolyX0 + HolyW; } }
        // Grid centres, in tiles. The Holy grid sits east of the pillar hall, inside the temple footprint, on fenced (prop-free) floor.
        public static readonly Vector2[] GridCentre = { new Vector2(24f, 38f), new Vector2(132f, 38f), new Vector2(72f, 38f) };
        public static string GroundName(UiLabGround g) { return g == UiLabGround.Dark ? "sentenced-flagstone" : g == UiLabGround.Bright ? "holy-temple-floor" : "frost-snow"; }
        public static RegionId ZoneOf(UiLabGround g) { return g == UiLabGround.Dark ? RegionId.Sentenced : g == UiLabGround.Bright ? RegionId.Holy : RegionId.Frost; }
        public static SurfaceKind SurfaceOf(UiLabGround g) { return g == UiLabGround.Dark ? SurfaceKind.Flagstone : g == UiLabGround.Bright ? SurfaceKind.TempleFloor : SurfaceKind.Snow; }

        public static MapBlob Build()
        {
            int w = W, h = H;
            var tiles = new byte[w * h]; var regions = new byte[w * h]; var terrain = new byte[w * h];
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int i = y * w + x;
                    if (x < Border || y < Border || x >= w - Border || y >= h - Border) { tiles[i] = MapBlob.Wall; continue; }
                    regions[i] = (byte)(x < FrostX0 ? RegionId.Sentenced : x < HolyX0 ? RegionId.Frost : RegionId.Holy);
                }
            // Fence terrain draws nothing but keeps props and temple decor off the tile: one band under each grid.
            Fence(terrain, w, 4, 10, SentencedX0 + SentencedW - 2, h - 10);
            Fence(terrain, w, FrostX0 + 4, 10, FrostX0 + FrostW - 2, h - 10);
            Fence(terrain, w, HolyX0 + 20, 26, HolyX0 + HolyW - 2, h - 6);   // the south-east of the Holy block, edge steps included
            // The temple's pillar hall: 3 x 2 isolated 3 x 3 blocks on the 6 tile pitch, north of the grid. Its centre sits far enough from the block's
            // west and north edges for the footprint square (35 to 70 percent of Holy) to grow east and south over the grid.
            for (int by = 0; by < 2; by++)
                for (int bx = 0; bx < 3; bx++)
                    for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++)
                        tiles[(14 + by * 6 + j) * w + HolyX0 + 14 + bx * 6 + i] = MapBlob.Wall;
            return new MapBlob((ushort)w, (ushort)h, tiles, terrain, regions, MapBlob.GroundTerrainAll);
        }

        static void Fence(byte[] terrain, int w, int x0, int y0, int x1, int y1)
        {
            for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) terrain[y * w + x] = (byte)TerrainKind.Fence;
        }
    }

    /// <summary>Grid geometry shared by the stage, the JSON it publishes and the tests.</summary>
    public static class UiLabGrid
    {
        public const int Cols = 8, Rows = 3, PerPage = Cols * Rows;
        public const float PitchX = 3.6f, PitchY = 7.1f;      // tiles
        public const float FeetFromTop = 6.0f, CaptionFromTop = 6.6f;
        public static float Width { get { return Cols * PitchX; } }
        public static float Height { get { return Rows * PitchY; } }
        /// <summary>Top-left tile of cell <paramref name="slot"/> (row-major) for a grid centred on <paramref name="centre"/>.</summary>
        public static Vector2 TopLeft(Vector2 centre, int slot)
        {
            int c = slot % Cols, r = slot / Cols;
            return new Vector2(centre.x - Width * .5f + c * PitchX, centre.y - Height * .5f + r * PitchY);
        }
        public static Vector2 Feet(Vector2 centre, int slot, int span = 1) { var t = TopLeft(centre, slot); return new Vector2(t.x + PitchX * span * .5f, t.y + FeetFromTop); }

        /// <summary>The slot of each cell in order: from <paramref name="start"/>, a cell wider than the columns left moves to the next row.</summary>
        public static int[] Slots(IList<UiLabCell> cells, int start, out int used)
        {
            var slots = new int[cells.Count]; int slot = start;
            for (int i = 0; i < cells.Count; i++)
            {
                int span = Math.Max(1, Math.Min(Cols, cells[i].Span));
                if (slot % Cols + span > Cols) slot += Cols - slot % Cols;
                slots[i] = slot; slot += span;
            }
            used = slot; return slots;
        }
    }

    /// <summary>The gallery: one cell per audit row (LEGACY_INDICATORS.md) and variant, packed into pages.</summary>
    public static class UiLabCatalog
    {
        static readonly FactionId[] Rotation = { FactionId.Fire, FactionId.Holy, FactionId.Frost, FactionId.Sentenced, FactionId.Plague };
        static int _rot;
        static FactionId NextFaction() { return Rotation[_rot++ % Rotation.Length]; }

        static UiLabCell Cell(string row, string variant, string caption, string legacy)
        {
            return new UiLabCell { Row = row, Variant = variant, Caption = caption, Legacy = legacy };
        }
        static UiLabCell CellSpan2(string row, string variant, string caption, string legacy) { var c = Cell(row, variant, caption, legacy); c.Span = 2; return c; }
        static UiLabActor Player(Action<UiLabActor> set = null) { var a = new UiLabActor { Faction = NextFaction() }; if (set != null) set(a); return a; }
        static UiLabActor Mob(MobTypeId type, Action<UiLabActor> set = null)
        {
            ShowcaseIdentityAssets.TryGetMobInfo(type, out var info);
            var a = new UiLabActor { Kind = ActorKind.RegionalMob, Mob = type, Faction = info.Faction, Weapon = null };
            if (set != null) set(a); return a;
        }

        public static readonly string[] StatusNames = { "stunned", "rooted", "silenced", "slowed", "attack-slowed", "anti-heal", "damage over time", "untargetable", "hidden", "zoned", "last stand", "haste", "casting" };
        static readonly string[] StatusLegacy =
        {
            "three yellow crosses circling the head", "iron ring round the feet, front half", "face disc with a crossed-out mouth, right of the head", "pale-blue streaks dragging behind the body",
            "clock face, left of the head", "white square, red cross and a crack, left of the hp bar", "small flames licking up off the body", "dashed pale outline round the body",
            "remote: not drawn; own: alpha .45", "purple chain ring round the feet", "gold rim hugging the body, pulsing", "short yellow streaks off both flanks", "soft warm glow round the body, breathing"
        };
        public static readonly string[] EliteNames = { "Wyrmling", "Ash Drake", "Executioner", "Gaoler", "Rat Ogre", "Pox Behemoth", "Glacial Warden", "Avalanche Troll", "Blood Saint", "Archon" };
        static readonly MobTypeId[] Elites = { MobTypeId.Wyrmling, MobTypeId.AshDrake, MobTypeId.Executioner, MobTypeId.Gaoler, MobTypeId.RatOgre, MobTypeId.PoxBehemoth, MobTypeId.GlacialWarden, MobTypeId.AvalancheTroll, MobTypeId.BloodSaint, MobTypeId.Archon };

        public static List<UiLabPage> Build()
        {
            _rot = 0;
            var grid = new List<UiLabCell>();
            var timed = new List<UiLabCell>();

            // ---- P: player overhead and body ----------------------------------------------------------------------------------
            grid.Add(Cell("P4", "green", "P4 hp green (100%)", "28x4 bar, green 66bb6a above 50%").A(Player(a => a.HpPct = 100)));
            grid.Add(Cell("P4", "amber", "P4 hp amber (40%)", "amber ffca28 above 25%").A(Player(a => a.HpPct = 40)));
            grid.Add(Cell("P4", "red", "P4 hp red (15%)", "red ef5350 at or below 25%").A(Player(a => a.HpPct = 15)));
            grid.Add(Cell("P5", "remote", "P5 barrier 60% + 5 steps", "blue 81d4fa bubble r16 on the body, strength by step; blue segment on the bar").A(Player(a => { a.BarrierPct = 60; a.BarrierRing = 5; })));
            grid.Add(Cell("P5", "full", "P5 barrier full (8 steps)", "full shield: strongest bubble").A(Player(a => { a.BarrierPct = 100; a.BarrierRing = 8; a.HpPct = 70; })));
            grid.Add(Cell("P7", "25", "P7 bounty 25", "gold crown 22x13 and number, scale 1.0 to 1.5 at 150").A(Player(a => a.Bounty = 25)));
            grid.Add(Cell("P7", "80", "P7 bounty 80", "crown and number").A(Player(a => a.Bounty = 80)));
            grid.Add(Cell("P7", "150", "P7 bounty 150 (max scale)", "crown 1.5x").A(Player(a => a.Bounty = 150)));
            grid.Add(Cell("P7", "all", "P7 bounty + barrier + status", "crown above the cluster, nothing overlapping").A(Player(a => { a.Bounty = 120; a.BarrierRing = 8; a.BarrierPct = 80; a.Effects = Indicators.Stunned | Indicators.AntiHeal; })));
            grid.Add(CellSpan2("P9+G5", "taxed", "P9/G5 taxed (sig 16)", "text AS -N% right of the name, 9 px bold white").A(Player(a => a.Sig = 16)));
            grid.Add(CellSpan2("P9+G5", "suppressed", "P9/G5 suppressed (sig 32)", "text DMG -N% right of the name").A(Player(a => a.Sig = 32)));
            grid.Add(CellSpan2("P9+G6", "execblocked", "P9/G6 exec blocked (sig 64)", "text EXEC BLOCKED with a skull glyph").A(Player(a => a.Sig = 64)));
            grid.Add(Cell("P15", "remote", "P15 hidden remote (not drawn)", "remote hidden fighters are not drawn at all").A(Player(a => a.Effects = Indicators.Hidden)));
            grid.Add(Cell("S9", "remote", "S9 hidden (remote: not drawn)", StatusLegacy[8]).A(Player(a => a.Effects = Indicators.Hidden)));

            // ---- S1-S13 status glyphs (S9 above) ---------------------------------------------------------------------------------
            ushort[] bits = { Indicators.Stunned, Indicators.Rooted, Indicators.Silenced, Indicators.Slowed, Indicators.AttackSlowed, Indicators.AntiHeal, Indicators.Dot, Indicators.Untargetable, Indicators.Hidden, Indicators.Zoned, Indicators.LastStand, Indicators.Haste, Indicators.Casting };
            for (int i = 0; i < bits.Length; i++)
            {
                if (bits[i] == Indicators.Hidden) continue;
                ushort bit = bits[i];
                grid.Add(Cell("S" + (i + 1), "", "S" + (i + 1) + " " + StatusNames[i], StatusLegacy[i]).A(Player(a => a.Effects = bit)));
            }
            grid.Add(Cell("S", "stack", "S all drawn statuses at once", "legacy draws every layer; the cluster must stay readable").A(Player(a => a.Effects = Indicators.DrawnMask)));

            // ---- G: signatures -------------------------------------------------------------------------------------------------
            grid.Add(Cell("G1", "", "G1 chilled (sig 1)", "pale film, icy rim, six crystals").A(Player(a => a.Sig = 1)));
            grid.Add(Cell("G2", "", "G2 burning (sig 2)", "rim ff7043, six rising embers").A(Player(a => a.Sig = 2)));
            grid.Add(Cell("G3", "", "G3 diseased (sig 4)", "green haze on the floor, motes").A(Player(a => a.Sig = 4)));
            grid.Add(Cell("G4", "", "G4 execute (sig 8)", "toothed ring c6ff00 on the floor + skull right of the bar").A(Player(a => a.Sig = 8)));
            grid.Add(Cell("G", "stack", "G all signatures at once", "chilled + burning + diseased + execute + exec-blocked").A(Player(a => a.Sig = (byte)(1 | 2 | 4 | 8 | 64))));

            // ---- M: creatures ----------------------------------------------------------------------------------------------------
            grid.Add(Cell("M1", "swarm", "M1 swarm role (Ember Imp)", "swarm: 3 dots on the disc").A(Mob(MobTypeId.EmberImp)));
            grid.Add(Cell("M1", "skirmisher", "M1 skirmisher (Cinder Hound)", "chevron toward facing").A(Mob(MobTypeId.CinderHound)));
            grid.Add(Cell("M1", "caster", "M1 caster (Flame Caller)", "inner ring").A(Mob(MobTypeId.FlameCaller)));
            grid.Add(Cell("M1", "brute", "M1 brute (Magma Brute)", "5 px rim").A(Mob(MobTypeId.MagmaBrute)));
            grid.Add(Cell("M1", "grunt", "M1 grunt (Bailiff)", "no mark").A(Mob(MobTypeId.Bailiff)));
            grid.Add(Cell("M2+M3", "calm", "M2/M3 calm: name, no bar", "name 11 px grey; bar only when hurt or fighting").A(Mob(MobTypeId.RotMonk)));
            grid.Add(Cell("M2+M3", "hurt", "M2/M3 hurt 55%: bar", "36 px bar, tones as players").A(Mob(MobTypeId.RotMonk, a => a.HpPct = 55)));
            grid.Add(Cell("M2", "hurtred", "M2 hurt 18%: red bar", "red at or below 25%").A(Mob(MobTypeId.IceGolem, a => a.HpPct = 18)));
            grid.Add(Cell("M7", "", "M7 training dummy", "grey, bar and name always on").A(new UiLabActor { Kind = ActorKind.TrainingDummy, Weapon = null }));
            grid.Add(Cell("P4", "zombie", "P4 zombie (hp bar + tone)", "zombie: creature art, bar shown when hurt").A(new UiLabActor { Kind = ActorKind.Zombie, Weapon = null, HpPct = 60 }));
            for (int i = 0; i < Elites.Length; i++)
            {
                var type = Elites[i]; int index = i;
                grid.Add(Cell("M4+M5", "elite" + (i + 1), "M4/M5 elite " + EliteNames[i], "gold double ring, gold rim, star above the name, type emblem layers").A(Mob(type, a => a.HpPct = (byte)(index % 2 == 0 ? 100 : 62))));
            }

            // ---- W: world objects ------------------------------------------------------------------------------------------------
            var w1 = Cell("W1", "", "W1 container ring (focused)", "ground ellipse r24, gold ffd54f, flattened .8"); w1.Props.Add(new UiLabProp { Kind = PropAppearance.Ground, Weapon = WeaponId.Axe, Focused = true }); grid.Add(w1);
            var w2a = Cell("W2", "weapon", "W2 label: ground weapon (focused)", "weapon name over the container when highlighted"); w2a.Props.Add(new UiLabProp { Kind = PropAppearance.Ground, Weapon = WeaponId.Shield, Focused = true }); grid.Add(w2a);
            var w2b = Cell("W2", "chest", "W2 label: chest (focused)", "Chest over the highlighted chest"); w2b.Props.Add(new UiLabProp { Kind = PropAppearance.Chest, Focused = true }); grid.Add(w2b);
            var w2c = Cell("W2", "body", "W2 label: body (always)", "body label always shown"); w2c.Props.Add(new UiLabProp { Kind = PropAppearance.Body, BodyLabel = "Varro's body" }); grid.Add(w2c);
            var w2d = Cell("W2", "unfocused", "W2 unfocused chest (no label)", "no label unless highlighted"); w2d.Props.Add(new UiLabProp { Kind = PropAppearance.Chest }); grid.Add(w2d);
            var w3f = Cell("W3", "far", "W3 reward chest: ring, no seconds", "ring drains over 15 s; seconds only when near"); w3f.Chests.Add(new UiLabChest { LeftMs = 9000 }); w3f.Span = 2; grid.Add(w3f);
            var w5a = Cell("W5", "offer", "W5 giver offer: ! unobstructed", "bright ! in the kind colour over the giver, name below");
            w5a.A(new UiLabActor { Kind = ActorKind.QuestGiver, Weapon = null, Faction = null }); w5a.Quests.Add(new UiLabQuest { Accepted = false }); grid.Add(w5a);
            var w5b = Cell("W5", "accepted", "W5 giver accepted: ?", "dim ? (a .6) over a giver whose quest is held");
            w5b.A(new UiLabActor { Kind = ActorKind.QuestGiver, Weapon = null, Faction = null }); w5b.Quests.Add(new UiLabQuest { Accepted = true }); grid.Add(w5b);
            var w5c = Cell("W5", "turnin", "W5 giver ready: Turn in here", "Turn in here, 12 px bold fff59d");
            w5c.A(new UiLabActor { Kind = ActorKind.QuestGiver, Weapon = null, Faction = null }); w5c.Quests.Add(new UiLabQuest { Accepted = true, Ready = true }); grid.Add(w5c);
            var w6a = Cell("W6", "crate", "W6 quest item: fetch crate", "crate marker, label when highlighted"); w6a.Props.Add(new UiLabProp { Kind = PropAppearance.QuestItem, QuestFetch = true }); grid.Add(w6a);
            var w6b = Cell("W6", "token", "W6 quest item: token diamond", "diamond marker"); w6b.Props.Add(new UiLabProp { Kind = PropAppearance.QuestItem, QuestFetch = false }); grid.Add(w6b);
            var w6c = Cell("W6", "focused", "W6 quest item focused: label", "Quest item label when highlighted"); w6c.Props.Add(new UiLabProp { Kind = PropAppearance.QuestItem, QuestFetch = true, Focused = true }); grid.Add(w6c);
            var w8a = Cell("W8", "stats", "W8 trader marker: stats merchant", "diamond ba9bed and name 12 px"); w8a.Merchants.Add(new UiLabMerchant { Kind = TradeKind.Stats, Name = "Orrin the Smith" }); grid.Add(w8a);
            var w8b = Cell("W8", "barter", "W8 trader marker: barter merchant", "diamond e2bc72 and name"); w8b.Merchants.Add(new UiLabMerchant { Kind = TradeKind.Barter, Name = "Tessa the Trader" }); grid.Add(w8b);
            var w9 = Cell("W9", "", "W9 Plague corpse puddle", "green puddle ellipses and pale bones"); w9.Props.Add(new UiLabProp { Kind = PropAppearance.Corpse, CorpseLabel = "Corpse" }); grid.Add(w9);
            var w9b = Cell("W9", "label", "W9 corpse focused", "corpse label when highlighted"); w9b.Props.Add(new UiLabProp { Kind = PropAppearance.Corpse, CorpseLabel = "Corpse", Focused = true }); grid.Add(w9b);

            // ---- time-based cells (ages at the freeze) ---------------------------------------------------------------------------
            foreach (float age in new[] { .04f, .12f, .2f })
                timed.Add(Cell("P16", "a" + AgeText(age), "P16 hit flash +" + age.ToString("0.00") + "s", "body white 120 ms on a landed hit (the Hit clip)").A(Player(a => { a.HitAge = age; a.HitAmount = 34; })));
            foreach (float age in new[] { .12f, .3f })
                timed.Add(Cell("F1", "others" + AgeText(age), "F1 damage 34 (grey) +" + age.ToString("0.00") + "s", "700 ms rise 34 px, 13 px + 1 per 40 damage, grey cfd8dc on others").A(Player(a => { a.HitAge = age; a.HitAmount = 34; })));
            timed.Add(Cell("F1", "big", "F1 damage 140 (large size)", "size 13 + min(7, amount/40)").A(Mob(MobTypeId.Zealot, a => { a.HitAge = .2f; a.HitAmount = 140; a.HpPct = 70; })));
            foreach (float age in new[] { .12f, .3f })
                timed.Add(Cell("F2", "a" + AgeText(age), "F2 damage over time 6 +" + age.ToString("0.00") + "s", "11 px per 500 ms chunk in the signature colour").A(Player(a => { a.HitAge = age; a.HitAmount = 6; a.HitPassive = true; a.Sig = 2; })));
            foreach (float age in new[] { 0f, .12f, .24f, .4f })
                timed.Add(Cell("M6", "a" + AgeText(age), "M6 mob death +" + age.ToString("0.00") + "s", "shrink to .45 and fade over 450 ms").A(Mob(MobTypeId.PlagueRat, a => a.DieAge = age)));
            foreach (float age in new[] { .3f, 1.3f })
            {
                var cell = Cell("F8", "a" + AgeText(age), "F8 death X +" + age.ToString("0.00") + "s", "X, 14 px half-width, fades after 25% of 2 s");
                cell.A(Player(a => { a.DieAge = age; a.DeathMark = true; })); timed.Add(cell);
            }

            var pages = new List<UiLabPage>();
            var all = new List<UiLabCell>(grid); all.AddRange(timed);
            var current = new UiLabPage { Name = "grid1", Shot = UiLabShot.Cell }; int used = 0;
            foreach (var cell in all)
            {
                int span = Math.Max(1, cell.Span), at = used;
                if (at % UiLabGrid.Cols + span > UiLabGrid.Cols) at += UiLabGrid.Cols - at % UiLabGrid.Cols;
                if (at + span > UiLabGrid.PerPage) { pages.Add(current); current = new UiLabPage { Name = "grid" + (pages.Count + 1), Shot = UiLabShot.Cell }; at = 0; }
                current.Cells.Add(cell); used = at + span;
            }
            pages.Add(current);

            // ---- pages with the local fighter -------------------------------------------------------------------------------------
            // me A: own Wish ready + off-hand badge + local ring; lock, hover and hunt rings on three targets; a gold own-damage number; a reward chest in reach.
            var meA = new UiLabPage { Name = "me-ready", HasMe = true, StartSlot = UiLabGrid.Cols };
            meA.Cells.Add(Cell("P1+P6", "own", "P1 own ring + P6 Wish ready + off-hand", "white local ring; Wish glyph beside the name (ready: faction colour); build row").A(new UiLabActor { Own = true, Faction = FactionId.Frost, Weapon = WeaponId.Sword, WishAbility = (byte)AbilityId.Freeze, WishReady = true, Second = WeaponId.Bow })); meA.Cells[0].Tall = true;
            var near = Cell("W3", "near", "W3 reward chest: ring + seconds", "ring and 12s when the player is within reach"); near.Chests.Add(new UiLabChest { LeftMs = 12000 }); near.Near = true; near.Span = 2; meA.Cells.Add(near);
            meA.Cells.Add(Cell("P17", "lock", "P17 attack lock ring", "red ff5252 fill and 4 px ring, breathes").A(Player(a => a.Lock = true)));
            meA.Cells.Add(Cell("P17", "hover", "P17 hover ring", "1.5 px eceff1 ring under the fighter a click would lock").A(Player(a => a.Hover = true)));
            meA.Cells.Add(Cell("W17", "hunt", "W17 Sentenced hunt ring", "violet ring on the hunt target").A(Player(a => a.Hunt = true)));
            meA.Cells.Add(Cell("F1", "byme", "F1 damage by me (gold)", "gold ffd54f on my hits").A(Player(a => { a.HitAge = .2f; a.HitAmount = 52; a.HitByMe = true; })));
            pages.Add(meA);
            // me B: own Wish recharging (grey), own barrier, own bounty, own status.
            var meB = new UiLabPage { Name = "me-recharging", HasMe = true, StartSlot = UiLabGrid.Cols };
            meB.Cells.Add(Cell("P5+P6+P7", "recharging", "P6 own Wish recharging + P5/P7 own", "grey glyph while recharging; own barrier bubble; bounty crown").A(new UiLabActor { Own = true, Faction = FactionId.Fire, Weapon = WeaponId.Axe, WishAbility = (byte)AbilityId.Blaze, WishReady = false, Second = WeaponId.Fists, Bounty = 90, BarrierRing = 8, Barrier = 60, Hp = 62, Effects = Indicators.Haste })); meB.Cells[0].Tall = true;
            var nearUrgent = Cell("W3", "urgent", "W3 chest nearly gone (red ring)", "turns red late"); nearUrgent.Chests.Add(new UiLabChest { LeftMs = 3500 }); nearUrgent.Near = true; nearUrgent.Span = 2; meB.Cells.Add(nearUrgent);
            pages.Add(meB);
            // me C: the own fighter hidden by Swarm (alpha .45).
            var meC = new UiLabPage { Name = "me-hidden", HasMe = true, StartSlot = UiLabGrid.Cols };
            meC.Cells.Add(Cell("P15+S9", "own", "P15/S9 own hidden (alpha .45)", "the local fighter is drawn at .45").A(new UiLabActor { Own = true, Faction = FactionId.Plague, Weapon = WeaponId.Wand, WishAbility = (byte)AbilityId.Swarm, WishReady = false, Effects = Indicators.Hidden, Second = WeaponId.Sword })); meC.Cells[0].Tall = true;
            pages.Add(meC);
            // me D: own damage taken: red number on the own fighter and the hurt vignette (screen shot).
            var meD = new UiLabPage { Name = "me-hurt", HasMe = true, Shot = UiLabShot.Cell, StartSlot = UiLabGrid.Cols + 3 };
            meD.Cells.Add(Cell("F1", "onme", "F1 damage on me (red)", "red ff5252 on me").A(new UiLabActor { Own = true, Faction = FactionId.Holy, Weapon = WeaponId.Sword, HitOnMe = true, HitAge = .12f, HitAmount = 40, Hp = 60 })); meD.Cells[0].Tall = true;
            meD.Cells.Add(new UiLabCell { Row = "F5", Caption = "F5 hurt vignette (whole frame)", Legacy = "red edge tint scaled by damage share, 350 ms linear decay", Shot = UiLabShot.Screen });
            pages.Add(meD);

            // me E: the attack lock on a creature (one lock target per local fighter, so it has its own page).
            var meE = new UiLabPage { Name = "me-lock-creature", HasMe = true, StartSlot = UiLabGrid.Cols + 3 };
            meE.Cells.Add(Cell("P1", "plain", "P1 own ring (no extras)", "white local ring on the ground, nothing above").A(new UiLabActor { Own = true, Faction = FactionId.Sentenced, Weapon = WeaponId.Bow, WishAbility = 255, NoInventory = true }));
            meE.Cells.Add(Cell("P17", "lockmob", "P17 lock ring on a creature", "ring under a locked creature").A(Mob(MobTypeId.CinderHound, a => a.Lock = true)));
            pages.Add(meE);

            // ---- vision fades: the natural leaving-sight and arriving fades through the real exit/enter path -------------------------
            var fade = new UiLabPage { Name = "vision-fades", Fades = true };
            float[] exitAges = { 0f, .07f, .13f, .19f, .25f }, enterAges = { 0f, .03f, .06f, .09f, .125f };
            for (int i = 0; i < 5; i++) { int k = i; fade.Cells.Add(Cell("X1", "p" + k, "X1 player leaves sight +" + exitAges[k].ToString("0.00") + "s", "legacy: vanishes; Unity fades over .26 s").A(Player(a => a.LeaveAge = exitAges[k]))); }
            for (int i = 0; i < 3; i++) fade.Cells.Add(Cell("", "pad" + i, "", ""));
            for (int i = 0; i < 5; i++) { int k = i; fade.Cells.Add(Cell("X2", "m" + k, "X2 creature leaves sight +" + exitAges[k].ToString("0.00") + "s", "creature fades with its bar and name").A(Mob(MobTypeId.Pardoner, a => a.LeaveAge = exitAges[k]))); }
            for (int i = 0; i < 3; i++) fade.Cells.Add(Cell("", "pad" + (i + 3), "", ""));
            for (int i = 0; i < 5; i++) { int k = i; fade.Cells.Add(Cell("X3", "p" + k, "X3 player arrives +" + enterAges[k].ToString("0.000") + "s", "fades in over .12 s").A(Player(a => a.AppearAge = enterAges[k]))); }
            for (int i = 0; i < 3; i++) fade.Cells.Add(Cell("", "pad" + (i + 6), "", ""));
            pages.Add(fade);
            // Pads are only spacing: they carry no row, so the stage draws no caption and the script saves no crop for them.
            // (X4, a creature arrival, shares the page below.)
            var fade2 = new UiLabPage { Name = "vision-fades-2", Fades = true };
            for (int i = 0; i < 5; i++) { int k = i; fade2.Cells.Add(Cell("X4", "m" + k, "X4 creature arrives +" + enterAges[k].ToString("0.000") + "s", "creature fades in with its bar and name").A(Mob(MobTypeId.MiasmaWitch, a => a.AppearAge = enterAges[k]))); }
            pages.Add(fade2);

            // ---- screen pages ----------------------------------------------------------------------------------------------------
            var edge = new UiLabPage { Name = "edge-threats", Shot = UiLabShot.Screen };
            edge.Cells.Add(new UiLabCell { Row = "W15", Caption = "W15 edge threat glows (whole frame)", Legacy = "one dot per visible enemy at the screen edge, hue red (near) to green (far)", Shot = UiLabShot.Screen, EdgeGlows = true });
            pages.Add(edge);
            return pages;
        }

        static string AgeText(float age) { return ((int)Math.Round(age * 1000f)).ToString("000"); }

        /// <summary>Every audit row id the gallery has a cell for (the row field, the part before any '+').</summary>
        public static HashSet<string> Rows(List<UiLabPage> pages)
        {
            var rows = new HashSet<string>();
            foreach (var p in pages) foreach (var c in p.Cells) foreach (var id in c.Row.Split('+')) if (id.Length > 0) rows.Add(id);
            return rows;
        }
    }
}
