using System;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-FROST-WALL-2 oracle (C# decoder): a State key 3 row of kind 3 is a standing Frost Wall, followed by
    /// <c>count u8 (1..64) | count x tile u32 LE</c> (row-major indices, strictly ascending, below the map tile cap); rows of
    /// other kinds keep their bytes. Refusals and their order are the Rust decoder's ("field", "wall tiles", Truncated,
    /// "wall tile", "wall order"). The Welcome's HUD block gains codes 23-29 (23: Frost's Wish, 0 Freeze, 1 Wall). The client
    /// STATE (walls in map coordinates) is P-FROST-WALL-2b. Layout: docs/backlog/packets/P-FROST-WALL-2.md F4, F5.</summary>
    public sealed class FrostWallProtocolTests
    {
        const uint MapTiles = 1024 * 1024; // rh-protocol map::MAX_MAP_TILES

        static JsonElement Fixture() => JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", Util.FixtureName))).RootElement;

        static byte[] Vector(string group, string name)
        {
            foreach (var v in Fixture().GetProperty(group).EnumerateArray())
                if (v.GetProperty("name").GetString() == name) return Util.FromHex(v.GetProperty("hex").GetString());
            throw new AssertionException("missing Rust vector " + group + "/" + name + " (P-FROST-WALL-2 adds it)");
        }

        static uint[] Tiles() { var t = new uint[7]; for (uint y = 37; y <= 43; y++) t[y - 37] = y * 40 + 12; return t; }

        static WireField Wall(uint[] tiles) => new WireField
        {
            Kind = 3, Ability = 0, Owner = 5, Subject = null, X = 400, Y = 1408, X2 = 400, Y2 = 1184, Radius = 0, Vx = 0, Vy = 0,
            StartedAt = 10000, EndsAt = 14000, Tiles = tiles,
        };

        static WireField Trail() => new WireField
        {
            Kind = 2, Ability = 3, Owner = null, Subject = 1, X = 20, Y = 30, X2 = 40, Y2 = 50, Radius = 12, Vx = -2, Vy = 0,
            StartedAt = 1000.5, EndsAt = 6000.5,
        };

        static void Head(Writer w, WireField f)
        {
            w.U8(f.Kind); w.U8(f.Ability);
            if (f.Owner.HasValue) { w.U8(1); w.Varint(f.Owner.Value); } else w.U8(0);
            if (f.Subject.HasValue) { w.U8(1); w.Varint(f.Subject.Value); } else w.U8(0);
            w.F32(f.X); w.F32(f.Y); w.F32(f.X2); w.F32(f.Y2); w.F32(f.Radius); w.F32(f.Vx); w.F32(f.Vy);
            w.F64(f.StartedAt); w.F64(f.EndsAt);
        }

        /// <summary>A State frame, tick 300, key 3 holding one row (head, then the raw bytes after it).</summary>
        static byte[] Frame(WireField f, int count, uint[] tiles)
        {
            var w = new Writer();
            w.U8(0x88); w.Varint(300); w.Varint(1); w.Varint(3); w.Varint(1);
            Head(w, f);
            if (count >= 0) { w.U8((byte)count); foreach (var t in tiles) w.U32(t); }
            return w.Finish();
        }

        static ServerMsg.State State(params WireField[] rows) =>
            new ServerMsg.State { Tick = 300, Items = new StateItem[] { new FieldsState { Rows = rows } } };

        static FieldsState Fields(ServerMsg msg)
        {
            foreach (var item in ((ServerMsg.State)msg).Items) if (item is FieldsState f) return f;
            throw new AssertionException("no key 3");
        }

        [Test]
        public void ConstantsMatchTheBrief()
        {
            Assert.AreEqual(4, FieldsState.KindCount, "zone, cloud, trail, wall");
            Assert.AreEqual(3, FieldsState.KindWall);
            Assert.AreEqual(64, FieldsState.MaxWallTiles);
            Assert.AreEqual(30, WireHudContent.TermCount, "codes 23-29 appended");
            Assert.AreEqual(23, (int)HudTerm.FrostWish);
            Assert.AreEqual(29, (int)HudTerm.FrostWallEndSlack);
        }

        [Test]
        public void AWallRowDecodesWithItsTilesAndReencodes()
        {
            byte[] bytes = Frame(Wall(Tiles()), 7, Tiles());
            ServerMsg msg = null;
            Assert.DoesNotThrow(() => msg = ServerMsg.Decode(bytes), "a wall row decodes");
            var row = Fields(msg).Rows[0];
            Assert.AreEqual(3, row.Kind);
            CollectionAssert.AreEqual(Tiles(), row.Tiles);
            CollectionAssert.AreEqual(bytes, msg.Encode(), "and re-encodes byte for byte");
            CollectionAssert.AreEqual(bytes, State(Wall(Tiles())).Encode(), "the writer emits the tile list");
        }

        [Test]
        public void OtherKindsCarryNoTileList()
        {
            byte[] bytes = Frame(Trail(), -1, null);
            CollectionAssert.AreEqual(bytes, State(Trail()).Encode(), "a trail row is today's bytes");
            var row = Fields(ServerMsg.Decode(bytes)).Rows[0];
            Assert.IsTrue(row.Tiles == null || row.Tiles.Length == 0);
        }

        static string Refusal(byte[] bytes)
        {
            try { ServerMsg.Decode(bytes); }
            catch (DecodeException e) { return e.Error == DecodeError.Truncated ? "Truncated" : e.Message; }
            return "accepted";
        }

        [Test]
        public void TheDecoderRefusesMalformedWallRowsForTheRustReasons()
        {
            var kind4 = Wall(null); kind4.Kind = 4;
            var over = new uint[65]; for (uint i = 0; i < 65; i++) over[i] = i;
            Assert.AreEqual("BadField: field", Refusal(Frame(kind4, -1, null)), "kind 4");
            Assert.AreEqual("BadField: wall tiles", Refusal(Frame(Wall(Tiles()), 0, new uint[0])), "count 0");
            Assert.AreEqual("BadField: wall tiles", Refusal(Frame(Wall(Tiles()), 65, over)), "count 65");
            Assert.AreEqual("Truncated", Refusal(Frame(Wall(Tiles()), 3, new uint[] { 1, 2 })), "count 3, two tiles");
            Assert.AreEqual("BadField: wall tile", Refusal(Frame(Wall(Tiles()), 2, new uint[] { 5, MapTiles })), "off every map");
            Assert.AreEqual("BadField: wall order", Refusal(Frame(Wall(Tiles()), 2, new uint[] { 5, 5 })), "repeated");
            Assert.AreEqual("BadField: wall order", Refusal(Frame(Wall(Tiles()), 2, new uint[] { 6, 5 })), "descending");
        }

        static string EncodeRefusal(ServerMsg msg)
        {
            try { msg.Encode(); }
            catch (EncodeException e) { return e.Message; }
            return "accepted";
        }

        [Test]
        public void TheEncoderRefusesWhatADecoderWould()
        {
            var onTrail = Trail(); onTrail.Tiles = new uint[] { 1 };
            var over = new uint[65]; for (uint i = 0; i < 65; i++) over[i] = i;
            Assert.AreEqual("wall tiles", EncodeRefusal(State(Wall(new uint[0]))), "no tiles");
            Assert.AreEqual("wall tiles", EncodeRefusal(State(Wall(null))), "null tiles");
            Assert.AreEqual("wall tiles", EncodeRefusal(State(Wall(over))), "65 tiles");
            Assert.AreEqual("wall tile", EncodeRefusal(State(Wall(new uint[] { MapTiles }))), "off every map");
            Assert.AreEqual("wall order", EncodeRefusal(State(Wall(new uint[] { 9, 3 }))), "unordered");
            Assert.AreEqual("field", EncodeRefusal(State(onTrail)), "tiles on a trail");
        }

        [Test]
        public void TheRustWallVectorsDecodeAndReencode()
        {
            byte[] bytes = Vector("server", "state_frost_wall");
            var msg = ServerMsg.Decode(bytes);
            var rows = Fields(msg).Rows;
            Assert.AreEqual(2, rows.Length);
            CollectionAssert.AreEqual(Tiles(), rows[0].Tiles, "the wall's tiles");
            Assert.AreEqual(5u, rows[0].Owner);
            Assert.AreEqual(14000.0, rows[0].EndsAt);
            Assert.AreEqual(2, rows[1].Kind, "then a trail");
            CollectionAssert.AreEqual(bytes, msg.Encode());
            byte[] max = Vector("server", "state_frost_wall_max");
            var maxRow = Fields(ServerMsg.Decode(max)).Rows[0];
            Assert.AreEqual(64, maxRow.Tiles.Length);
            Assert.AreEqual(MapTiles - 1, maxRow.Tiles[63]);
            CollectionAssert.AreEqual(max, ServerMsg.Decode(max).Encode());
        }

        [Test]
        public void TheRustWelcomeVectorsSayWhichWishFrostHas()
        {
            var freeze = ((ServerMsg.Welcome)ServerMsg.Decode(Vector("server", "welcome"))).Hud;
            var wall = ((ServerMsg.Welcome)ServerMsg.Decode(Vector("server", "welcome_frost_wall"))).Hud;
            Assert.AreEqual(0.0, freeze.Term(HudTerm.FrostWish), "Freeze");
            Assert.AreEqual(1.0, wall.Term(HudTerm.FrostWish), "Frost Wall");
            foreach (var h in new[] { freeze, wall })
            {
                Assert.AreEqual(450.0, h.Term(HudTerm.FrostWallRange));
                Assert.AreEqual(64.0, h.Term(HudTerm.FrostWallMinRange));
                Assert.AreEqual(224.0, h.Term(HudTerm.FrostWallLength));
                Assert.AreEqual(4000.0, h.Term(HudTerm.FrostWallMs));
                Assert.AreEqual(24.0, h.Term(HudTerm.FrostWallCellReach));
                Assert.AreEqual(8.0, h.Term(HudTerm.FrostWallEndSlack));
            }
        }

        [Test]
        public void TheRustMalformedVectorsAreRefusedForTheirReasons()
        {
            var wanted = new (string, string)[]
            {
                ("state_field_kind_unknown", "BadField: field"), ("state_wall_tiles_zero", "BadField: wall tiles"),
                ("state_wall_tiles_over", "BadField: wall tiles"), ("state_wall_tiles_truncated", "Truncated"),
                ("state_wall_tile_off_map", "BadField: wall tile"), ("state_wall_tile_order", "BadField: wall order"),
            };
            foreach (var (name, reason) in wanted)
                Assert.AreEqual(reason, Refusal(Vector("malformedServer", name)), name);
        }
    }
}
