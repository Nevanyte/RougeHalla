using System;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-FROST-WALL-2b oracle (C# client state): standing Frost Walls in <see cref="CollectionsView.Fields"/> as map
    /// tiles, a stable key, refusal of an off-map tile, and the typed Frost's Wish answer on the Welcome's HUD block.
    /// The wire decoder/encoder for kind 3 and HUD codes 23-29 is P-FROST-WALL-2; these tests build the decoded state objects
    /// directly (as HudClockProtocolTests does) so they test the client-state layer and hold once the decoder lands. Only
    /// the last Session test needs the encoder and says so when it is missing.
    /// Map: 6 wide x 4 tall (24 tiles), so x and y differ and index = y * 6 + x.</summary>
    public sealed class FrostWallStateTests
    {
        const ushort W = 6, H = 4;

        static CollectionsView NewView()
        {
            var view = new CollectionsView();
            view.BindMap(new MapBlob(W, H, new byte[W * H]));
            return view;
        }

        static void Apply(CollectionsView view, ServerMsg.State state)
        {
            typeof(CollectionsView).GetMethod("Apply", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, new object[] { state });
        }

        static ServerMsg.State Fields(uint tick, params WireField[] rows) =>
            new ServerMsg.State { Tick = tick, Items = new StateItem[] { new FieldsState { Rows = rows } } };

        static WireField Wall(uint? owner, double start, double end, params uint[] tiles) => new WireField
        {
            Kind = FieldsState.KindWall, Ability = 0, Owner = owner, X = 100, Y = 100, X2 = 140, Y2 = 100,
            StartedAt = start, EndsAt = end, Tiles = tiles,
        };

        static WireField Zone() => new WireField { Kind = 0, Ability = 2, Subject = 1, X = 10, Y = 20, Radius = 50, StartedAt = 1000, EndsAt = 9000 };

        static AreaView OnlyWall(CollectionsView view)
        {
            AreaView found = default; int n = 0;
            foreach (var f in view.Fields) if (f.Kind == AreaKind.Wall) { found = f; n++; }
            Assert.AreEqual(1, n, "exactly one standing wall");
            return found;
        }

        static (int, int) At(MapTile t) => (t.X, t.Y);

        [Test]
        public void AWallListsItsTilesAsMapCoordinatesOnANonSquareMap()
        {
            var view = NewView();
            // indices 7, 13, 19 and 23 on a 6-wide map: (1,1) (1,2) (1,3) and the last tile (5,3).
            Apply(view, Fields(5, Wall(4, 10000, 14000, 7, 13, 19, 23)));
            var wall = OnlyWall(view);
            Assert.AreEqual(AreaKind.Wall, wall.Kind);
            Assert.IsNotNull(wall.Tiles, "a wall carries its tiles");
            Assert.AreEqual(4, wall.Tiles.Length);
            var expect = new[] { (1, 1), (1, 2), (1, 3), (5, 3) };
            for (int i = 0; i < expect.Length; i++) Assert.AreEqual(expect[i], At(wall.Tiles[i]), "tile " + i);
        }

        [Test]
        public void ARowEdgeDoesNotSpillIntoTheNextRow()
        {
            var view = NewView();
            Apply(view, Fields(5, Wall(null, 1000, 5000, 0, 5, 6, 23)));
            var t = OnlyWall(view).Tiles;
            Assert.IsNotNull(t);
            Assert.AreEqual((0, 0), At(t[0]));
            Assert.AreEqual((5, 0), At(t[1]), "last column of row 0");
            Assert.AreEqual((0, 1), At(t[2]), "first column of row 1");
            Assert.AreEqual((5, 3), At(t[3]), "the last tile of the map is inside");
        }

        [Test]
        public void AWallCarriesItsTimesAndOwnerAsTheOtherFieldsDoAndOtherKindsHaveNoTiles()
        {
            var view = NewView();
            Apply(view, Fields(5, Wall(4, 10000.5, 14000.5, 7, 13), Zone()));
            Assert.AreEqual(2, view.Fields.Count);
            var wall = OnlyWall(view);
            Assert.AreEqual(14000.5, wall.EndsAt, "server milliseconds, a double, as every field time");
            Assert.AreEqual(10000.5, wall.StartedAt);
            Assert.AreEqual(4u, wall.Owner);
            Assert.IsNotNull(wall.Tiles, "the wall is read (not just present)");
            foreach (var f in view.Fields) if (f.Kind != AreaKind.Wall) Assert.IsNull(f.Tiles, "only a wall has tiles");
        }

        [Test]
        public void AnOwnerTheViewerMayNotSeeStaysNull()
        {
            var view = NewView();
            Apply(view, Fields(5, Wall(null, 10000, 14000, 7, 13)));
            Assert.IsNull(OnlyWall(view).Owner, "the wire redacts it; the view must not invent one");
            Assert.IsNotNull(OnlyWall(view).Tiles);
        }

        [Test]
        public void AWallKeepsItsKeyAcrossSnapshotsEvenWhenTheOwnerAppearsAndTheRowMoves()
        {
            var view = NewView();
            Apply(view, Fields(5, Wall(null, 10000, 14000, 7, 13, 19)));
            var first = OnlyWall(view).Key;
            Assert.AreNotEqual(default(AreaKey), first, "a wall has a key");
            Apply(view, Fields(6, Zone(), Wall(4, 10000, 14000, 7, 13, 19)));
            Assert.AreEqual(first, OnlyWall(view).Key, "same wall, same key: the owner became visible and the row moved in the list");
        }

        [Test]
        public void TwoWallsHaveDifferentKeys()
        {
            var view = NewView();
            Apply(view, Fields(5, Wall(4, 10000, 14000, 7, 13, 19), Wall(9, 10000, 14000, 8, 14), Wall(4, 12000, 16000, 7, 13, 19)));
            Assert.AreEqual(3, view.Fields.Count);
            Assert.AreNotEqual(default(AreaKey), view.Fields[0].Key);
            Assert.AreNotEqual(view.Fields[0].Key, view.Fields[1].Key, "same start, other tiles");
            Assert.AreNotEqual(view.Fields[0].Key, view.Fields[2].Key, "same tiles, later cast");
        }

        [Test]
        public void AWallLeavesTheListInTheSnapshotTheServerStopsSendingIt()
        {
            var view = NewView();
            Apply(view, Fields(5, Wall(4, 10000, 14000, 7, 13), Wall(null, 11000, 15000, 20, 21)));
            Assert.AreEqual(2, view.Fields.Count);
            var survivor = view.Fields[1].Key;
            Assert.AreNotEqual(default(AreaKey), survivor);
            Apply(view, Fields(6, Wall(null, 11000, 15000, 20, 21)));
            Assert.AreEqual(1, view.Fields.Count);
            Assert.AreEqual(survivor, OnlyWall(view).Key, "the second wall survives, with the same key");
            Assert.AreEqual((2, 3), At(OnlyWall(view).Tiles[0]));
            Apply(view, Fields(7));
            Assert.AreEqual(0, view.Fields.Count, "an empty key 3 clears the last wall");
        }

        [TestCase(24u, TestName = "TileAtTheMapTileCountIsRefused")]
        [TestCase(25u, TestName = "TileJustPastTheMapTileCountIsRefused")]
        [TestCase(1048575u, TestName = "TileFarBeyondTheMapButBelowTheWireCapIsRefused")]
        public void AnOffMapTileIsRefusedAsACollectionStateError(uint tile)
        {
            var view = NewView();
            Apply(view, Fields(5, Wall(4, 10000, 14000, 7, 13)));
            var ex = Assert.Throws<TargetInvocationException>(() => Apply(view, Fields(6, Wall(4, 10000, 14000, 23, tile))));
            Assert.AreEqual("InvalidCollectionStateException", ex.InnerException.GetType().Name,
                "the exception Session turns into SessionState.Failed (the bad trade state precedent)");
            StringAssert.Contains("wall tile", ex.InnerException.Message);
            Assert.AreEqual(1, view.Fields.Count, "the refused frame changed nothing: the earlier wall still stands");
            Assert.AreEqual(2, OnlyWall(view).Tiles.Length);
        }

        [Test]
        public void ARefusedWallStopsTheWholeFrameBeforeAnyKeyIsApplied()
        {
            var view = NewView();
            var state = new ServerMsg.State { Tick = 6, Items = new StateItem[] {
                new InventoryState { Value = new WireInventory { ActiveSlot = 1 } },
                new FieldsState { Rows = new[] { Wall(4, 10000, 14000, 99) } } } };
            Assert.Throws<TargetInvocationException>(() => Apply(view, state));
            Assert.IsNull(view.Inventory, "validation runs before any item is applied");
        }

        static WireHudContent Hud(params (HudTerm, double)[] terms)
        {
            var hud = new WireHudContent { Terms = new WireHudTerm[terms.Length] };
            for (int i = 0; i < terms.Length; i++) hud.Terms[i] = new WireHudTerm { Code = (byte)terms[i].Item1, Value = terms[i].Item2 };
            return hud;
        }

        static (HudTerm, double)[] Numbers() => new[]
        {
            (HudTerm.FrostWallRange, 450.0), (HudTerm.FrostWallMinRange, 64.0), (HudTerm.FrostWallLength, 224.0),
            (HudTerm.FrostWallMs, 4000.0), (HudTerm.FrostWallCellReach, 24.0), (HudTerm.FrostWallEndSlack, 8.0),
        };

        static WireHudContent WithWish(double wish)
        {
            var terms = new List<(HudTerm, double)> { (HudTerm.FrostWish, wish) };
            terms.AddRange(Numbers());
            return Hud(terms.ToArray());
        }

        [Test]
        public void FrostsWishIsTheWallWhenTheBlockSaysOne()
        {
            var hud = WithWish(1);
            Assert.IsTrue(hud.CarriesFrostWish);
            Assert.AreEqual(FrostWishKind.Wall, hud.FrostWish);
        }

        [Test]
        public void FrostsWishIsFreezeWhenTheBlockSaysZero()
        {
            var hud = WithWish(0);
            Assert.IsTrue(hud.CarriesFrostWish, "term 23 is there and says Freeze");
            Assert.AreEqual(FrostWishKind.Freeze, hud.FrostWish);
        }

        [Test]
        public void FrostsWishIsFreezeWhenTheBlockLacksTheTermAsAnOlderServerDoes()
        {
            var hud = Hud((HudTerm.FreezeStunMs, 1500), (HudTerm.FireRoamBurstAdShare, 0.5));
            Assert.IsFalse(hud.CarriesFrostWish);
            Assert.AreEqual(FrostWishKind.Freeze, hud.FrostWish);
            Assert.IsNull(hud.FrostWall, "no numbers either");
            Assert.AreEqual(FrostWishKind.Freeze, new WireHudContent().FrostWish, "an empty block too");
        }

        [Test]
        public void OnlyTheValueOneMeansWall()
        {
            // the Rust decoder accepts any value in 0..1e6; a future code must never turn the preview on by accident.
            Assert.AreEqual(FrostWishKind.Wall, WithWish(1).FrostWish);
            Assert.AreEqual(FrostWishKind.Freeze, WithWish(2).FrostWish);
        }

        [Test]
        public void TheWallsSixNumbersComeFromTheBlock()
        {
            var n = WithWish(1).FrostWall;
            Assert.IsTrue(n.HasValue);
            Assert.AreEqual(450.0, n.Value.Range);
            Assert.AreEqual(64.0, n.Value.MinRange);
            Assert.AreEqual(224.0, n.Value.Length);
            Assert.AreEqual(4000.0, n.Value.Ms);
            Assert.AreEqual(24.0, n.Value.CellReach);
            Assert.AreEqual(8.0, n.Value.EndSlack);
        }

        [Test]
        public void TheNumbersAreAnsweredWhateverTheWishAndEvenWithoutTheWishTerm()
        {
            // every real Welcome carries them (P-FROST-WALL-2 F5); the wish term alone says whether to offer the preview.
            Assert.IsTrue(WithWish(0).FrostWall.HasValue);
            Assert.IsTrue(Hud(Numbers()).FrostWall.HasValue);
            Assert.AreEqual(FrostWishKind.Freeze, Hud(Numbers()).FrostWish);
        }

        [Test]
        public void AnIncompleteSetOfNumbersIsNull()
        {
            var terms = Numbers(); Array.Resize(ref terms, 5);
            Assert.IsNull(Hud(terms).FrostWall, "five of six: no partial answer");
        }

        [Test]
        public void TheSessionBindsTheWelcomeMapSoAWallDecodesAgainstIt()
        {
            // Needs the wire encoder of P-FROST-WALL-2 (kind 3 rows); until it lands this fails here, on purpose.
            var t = new FakeTransport();
            var s = new Session(t, new SessionOptions { Url = "ws://x/ws", Profile = "p", Ticket = new byte[] { 1 }, Faction = 2, Now = () => 1000, ReconnectBaseMs = 500, MaxReconnectAttempts = 3 });
            var token = new byte[16]; for (int i = 0; i < 16; i++) token[i] = 0xAB;
            var id = new byte[16]; id[0] = 1;
            s.Connect(); t.Open();
            t.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = id, PlayerId = 3, Session = token, TickRate = 20, Tick = 1, ServerMs = 50, Map = new MapBlob(W, H, new byte[W * H]) });
            Assert.AreEqual(SessionState.InMatch, s.State);
            try { t.Deliver(Fields(2, Wall(4, 10000, 14000, 7, 13, 23))); }
            catch (EncodeException e) { Assert.Fail("cannot build the frame: the P-FROST-WALL-2 encoder is missing (" + e.Message + ")"); }
            Assert.AreEqual(SessionState.InMatch, s.State, "an on-map wall is accepted");
            Assert.AreEqual((5, 3), At(OnlyWall(s.Collections).Tiles[2]), "decoded against the 6-wide Welcome map");
            t.Deliver(Fields(3, Wall(4, 10000, 14000, 24)));
            Assert.AreEqual(SessionState.Failed, s.State, "an off-map tile fails the session");
            StringAssert.Contains("wall tile", s.Error);
        }
    }
}
