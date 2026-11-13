using System.Collections.Generic;

namespace Roguehalla.Net.Ui
{
    /// <summary>One decoration kind the server may send (a rule kind of crates/rh-mapdress/rules/zones.json).</summary>
    public readonly struct DecorationKind
    {
        /// <summary>The rule file's name, e.g. "fire.spire".</summary>
        public readonly string Name;
        public readonly byte Code;
        /// <summary>The rule file's tall flag (the flag on the wire row is what the client obeys).</summary>
        public readonly bool Tall;
        /// <summary>Key of the sprite drawn for this kind in RegionPropArt: the kind's own name when art exists, else the nearest existing prop.</summary>
        public readonly string Art;
        public DecorationKind(string name, byte code, bool tall, string art) { Name = name; Code = code; Tall = tall; Art = art; }
    }

    /// <summary>Kind code (MapProp.Kind of a rule prop) to sprite. P-UNITY-DRESS-1 fills it and checks it against zones.json.</summary>
    public static class DecorationKinds
    {
        /// <summary>The sprite key drawn for a kind the table does not know (and for a legacy prop): visible, never nothing.</summary>
        public const string Placeholder = "dress.unknown";

        // Generated from crates/rh-mapdress/rules/zones.json; DecorationKindsTests fails on any difference. A kind whose Art differs from its Name has no sprite of its own yet (art-pass list).
        static readonly DecorationKind[] Table =
        {
            new DecorationKind("fire.spire", 1, true, "fire.spire"),
            new DecorationKind("fire.crystal", 2, false, "fire.crystal"),
            new DecorationKind("fire.rocks", 3, false, "fire.rocks"),
            new DecorationKind("fire.vent", 4, false, "fire.vent"),
            new DecorationKind("fire.ash", 5, false, "fire.rocks"),
            new DecorationKind("fire.crust", 6, false, "fire.rocks"),
            new DecorationKind("fire.basalt", 7, false, "fire.rocks"),
            new DecorationKind("fire.emberjet", 8, false, "fire.vent"),
            new DecorationKind("fire.boulder", 9, false, "fire.rocks"),
            new DecorationKind("fire.ashheap", 10, false, "fire.rocks"),
            new DecorationKind("sent.tomb", 11, false, "sent.tomb"),
            new DecorationKind("sent.cross", 12, false, "sent.cross"),
            new DecorationKind("sent.slab", 13, false, "sent.slab"),
            new DecorationKind("sent.deadtree", 14, true, "sent.deadtree"),
            new DecorationKind("sent.lantern", 15, false, "sent.lantern"),
            new DecorationKind("sent.deadgrass", 16, false, "sent.deadgrass"),
            new DecorationKind("sent.flag", 17, false, "sent.slab"),
            new DecorationKind("sent.grave", 18, false, "sent.tomb"),
            new DecorationKind("sent.lamp", 19, false, "sent.lantern"),
            new DecorationKind("sent.stump", 20, true, "sent.deadtree"),
            new DecorationKind("sent.fence", 61, false, "sent.cross"),
            new DecorationKind("plague.column", 21, true, "plague.column"),
            new DecorationKind("plague.rubble", 22, false, "plague.rubble"),
            new DecorationKind("plague.tree", 23, true, "plague.tree"),
            new DecorationKind("plague.bush", 24, false, "plague.bush"),
            new DecorationKind("plague.fern", 25, false, "plague.fern"),
            new DecorationKind("plague.mushroom", 26, false, "plague.mushroom"),
            new DecorationKind("plague.root", 27, false, "plague.rubble"),
            new DecorationKind("plague.reed", 28, false, "plague.fern"),
            new DecorationKind("plague.fungus", 29, false, "plague.mushroom"),
            new DecorationKind("plague.sedge", 30, false, "plague.fern"),
            new DecorationKind("frost.rock2", 31, false, "frost.rock2"),
            new DecorationKind("frost.shards", 32, false, "frost.shards"),
            new DecorationKind("frost.pine", 33, true, "frost.pine"),
            new DecorationKind("frost.pine2", 34, true, "frost.pine2"),
            new DecorationKind("frost.drift", 35, false, "frost.drift"),
            new DecorationKind("frost.rock", 36, false, "frost.rock"),
            new DecorationKind("frost.shelf", 37, false, "frost.rock"),
            new DecorationKind("frost.crag", 38, false, "frost.rock2"),
            new DecorationKind("frost.snowbank", 39, false, "frost.drift"),
            new DecorationKind("frost.flurry", 40, false, "frost.drift"),
            new DecorationKind("frost.spire", 81, true, "frost.pine2"),
            new DecorationKind("holy.pillar", 41, true, "holy.pillar"),
            new DecorationKind("holy.rock", 42, false, "holy.rock"),
            new DecorationKind("holy.palm", 43, true, "holy.palm"),
            new DecorationKind("holy.shrub", 44, false, "holy.shrub"),
            new DecorationKind("holy.flowers", 45, false, "holy.flowers"),
            new DecorationKind("holy.grass", 46, false, "holy.grass"),
            new DecorationKind("holy.paver", 47, false, "holy.rock"),
            new DecorationKind("holy.banner", 48, false, "col.banner"),
            new DecorationKind("holy.hedge", 49, false, "holy.shrub"),
            new DecorationKind("holy.turf", 50, false, "holy.grass"),
            new DecorationKind("holy.brazier", 91, false, "temple.brazier"),
        };

        static readonly Dictionary<byte, int> ByCode = BuildIndex();
        static Dictionary<byte, int> BuildIndex() { var m = new Dictionary<byte, int>(); for (int i = 0; i < Table.Length; i++) m[Table[i].Code] = i; return m; }

        public static IReadOnlyList<DecorationKind> All { get { return Table; } }

        public static bool TryGet(byte code, out DecorationKind kind)
        {
            if (ByCode.TryGetValue(code, out int i)) { kind = Table[i]; return true; }
            kind = default(DecorationKind); return false;
        }

        /// <summary>The sprite key for a prop row: <see cref="Placeholder"/> for a legacy prop (flag 2) or an unknown code, else the kind's art, or its variant's art when it has one (variant 1 of frost.drift is frost.drift2).</summary>
        public static string ArtKey(byte kind, byte variant, byte flags)
        {
            if ((flags & 2) != 0) return Placeholder;
            if (!TryGet(kind, out var k)) return Placeholder;
            if (variant == 1 && k.Art == "frost.drift") return "frost.drift2";
            return k.Art;
        }
    }
}
