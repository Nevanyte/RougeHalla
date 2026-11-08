using System;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public sealed class MapBlobGroundTests
    {
        static ServerMsg.Welcome Welcome(MapBlob map) => new ServerMsg.Welcome
        {
            Protocol = Wire.ProtocolVersion,
            MatchId = new byte[16],
            Session = new byte[16],
            PlayerId = 1,
            TickRate = 20,
            Map = map,
        };

        static ServerMsg.Welcome RoundTrip(MapBlob map) => (ServerMsg.Welcome)ServerMsg.Decode(Welcome(map).Encode());

        static byte[] BasicTiles() => new byte[]
        {
            MapBlob.Wall, MapBlob.Low, MapBlob.Floor, MapBlob.Floor,
            MapBlob.Wall, MapBlob.Low, MapBlob.Floor, MapBlob.Floor,
            MapBlob.Floor, MapBlob.Floor, MapBlob.Floor, MapBlob.Floor,
        };

        static int ExtensionOffset(byte[] frame, uint collisionRuns)
        {
            int offset = 60 + 12 + 3 * checked((int)collisionRuns);
            return offset + 4;
        }

        static uint ReadU32(byte[] bytes, int offset)
        {
            return (uint)(bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24));
        }

        [Test]
        public void PresentGroundPlanesRoundTripAndHashesAreRecomputed()
        {
            byte[] terrain = { 1, 3, 4, 7, 1, 3, 4, 7, 0, 0, 0, 0 };
            byte[] regions = { 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5 };
            var map = new MapBlob(4, 3, BasicTiles(), terrain, regions, MapBlob.GroundTerrainMap);

            var decoded = RoundTrip(map).Map;

            Assert.AreEqual((ushort)4, decoded.W);
            Assert.AreEqual((ushort)3, decoded.H);
            CollectionAssert.AreEqual(map.Tiles, decoded.Tiles);
            CollectionAssert.AreEqual(terrain, decoded.Terrain);
            CollectionAssert.AreEqual(regions, decoded.Regions);
            Assert.AreEqual(MapBlob.GroundTerrainMap, decoded.TerrainMode);
            Assert.AreEqual(MapBlob.ComputeHash(map.W, map.H, map.Tiles), decoded.LayerHash);
            Assert.AreEqual(MapBlob.ComputeSemanticHash(map.W, map.H, terrain, regions), decoded.SemanticHash);
            Assert.AreEqual(MapBlob.ComputeContextHash(decoded.LayerHash, decoded.SemanticHash, decoded.TerrainMode), decoded.ContextHash);
            Assert.IsTrue(map.CanonicalEquals(decoded));
        }

        [Test]
        public void AbsenceDiffersFromPresentZeroPlanesAndModeIsPartOfCanonicalEquality()
        {
            byte[] collision = BasicTiles();
            var absent = new MapBlob(4, 3, collision);
            var explicitZero = new MapBlob(4, 3, collision, new byte[12], null, MapBlob.GroundTerrainOff);
            var anotherMode = RoundTrip(new MapBlob(4, 3, collision, new byte[12], null, MapBlob.GroundTerrainMap)).Map;

            Assert.IsNull(RoundTrip(absent).Map.Terrain);
            Assert.IsNull(RoundTrip(absent).Map.Regions);
            CollectionAssert.AreEqual(new byte[12], RoundTrip(explicitZero).Map.Terrain);
            Assert.AreNotEqual(absent.SemanticHash, explicitZero.SemanticHash);
            Assert.AreNotEqual(absent.ContextHash, explicitZero.ContextHash);
            Assert.IsFalse(absent.CanonicalEquals(explicitZero));
            Assert.IsFalse(explicitZero.CanonicalEquals(anotherMode));
            Assert.AreEqual(explicitZero.LayerHash, anotherMode.LayerHash);
            Assert.AreEqual(explicitZero.SemanticHash, anotherMode.SemanticHash);
            Assert.AreNotEqual(explicitZero.ContextHash, anotherMode.ContextHash);
        }

        [Test]
        public void WriterCanUseTheRoomModeWithoutChangingTheCollisionOrGroundIdentity()
        {
            var source = new MapBlob(4, 3, BasicTiles(), new byte[12], null, MapBlob.GroundTerrainOff);
            var writer = new Writer();
            source.Write(writer, MapBlob.GroundTerrainAll);
            var reader = new Reader(writer.Finish());
            var decoded = MapBlob.Read(ref reader);
            reader.End();

            Assert.AreEqual(MapBlob.GroundTerrainAll, decoded.TerrainMode);
            Assert.AreEqual(source.LayerHash, decoded.LayerHash);
            Assert.AreEqual(source.SemanticHash, decoded.SemanticHash);
            Assert.AreEqual(MapBlob.ComputeContextHash(source.LayerHash, source.SemanticHash, MapBlob.GroundTerrainAll), decoded.ContextHash);
            Assert.AreEqual(MapBlob.GroundTerrainOff, source.TerrainMode);
        }

        [TestCase(0)]
        [TestCase(1)]
        [TestCase(2)]
        public void RejectsUnknownOrTamperedGroundHeaderFields(int relativeOffset)
        {
            var frame = Welcome(new MapBlob(4, 3, BasicTiles(), new byte[12], new byte[12])).Encode();
            uint collisionRuns = ReadU32(frame, 68);
            int extension = ExtensionOffset(frame, collisionRuns);
            if (relativeOffset == 0) frame[extension] = 2;
            else if (relativeOffset == 1) frame[extension + relativeOffset] |= 0x80;
            else frame[extension + relativeOffset] ^= 1;

            Assert.AreEqual(DecodeError.BadMap, Assert.Throws<DecodeException>(() => ServerMsg.Decode(frame)).Error);
        }

        [Test]
        public void RejectsMalformedRunDomainModeContextAndSectionLength()
        {
            var map = new MapBlob(4, 3, BasicTiles(), new byte[12], new byte[12]);
            byte[] valid = Welcome(map).Encode();
            uint collisionRuns = ReadU32(valid, 68);
            int extension = ExtensionOffset(valid, collisionRuns);
            uint extensionLength = ReadU32(valid, extension - 4);

            byte[] badTerrain = (byte[])valid.Clone();
            int firstTerrainValue = extension + 10;
            badTerrain[firstTerrainValue] = 8;
            Assert.AreEqual(DecodeError.BadMap, Assert.Throws<DecodeException>(() => ServerMsg.Decode(badTerrain)).Error);

            byte[] badMode = (byte[])valid.Clone();
            badMode[extension + (int)extensionLength - 5] = 3;
            Assert.AreEqual(DecodeError.BadField, Assert.Throws<DecodeException>(() => ServerMsg.Decode(badMode)).Error);

            byte[] badContext = (byte[])valid.Clone();
            badContext[extension + (int)extensionLength - 1] ^= 1;
            Assert.AreEqual(DecodeError.BadMap, Assert.Throws<DecodeException>(() => ServerMsg.Decode(badContext)).Error);

            byte[] tooLong = (byte[])valid.Clone();
            int lengthOffset = extension - 4;
            tooLong[lengthOffset] = 0xff; tooLong[lengthOffset + 1] = 0xff;
            tooLong[lengthOffset + 2] = 0xff; tooLong[lengthOffset + 3] = 0x7f;
            Assert.AreEqual(DecodeError.BadMap, Assert.Throws<DecodeException>(() => ServerMsg.Decode(tooLong)).Error);
        }

        [Test]
        public void ValidatesMaximumDecodedPlaneBudgetBeforeAllocatingAndHonorsFrameCap()
        {
            const int side = 1024;
            var map = new MapBlob(side, side, new byte[side * side], new byte[side * side], new byte[side * side]);
            var decoded = RoundTrip(map).Map;
            Assert.AreEqual(Wire.MaxMapDecodedBytes, decoded.Tiles.Length + decoded.Terrain.Length + decoded.Regions.Length);

            var oversized = new byte[Wire.MaxServerFrame + 1];
            Assert.AreEqual(DecodeError.TooLarge, Assert.Throws<DecodeException>(() => ServerMsg.Decode(oversized)).Error);
        }
    }
}
