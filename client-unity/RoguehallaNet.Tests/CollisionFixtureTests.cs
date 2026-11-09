using System;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public class CollisionFixtureTests
    {
        static byte[] Fixture()
        {
            using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol/fixtures/pathfinding_v1.json")));
            return Util.FromHex(json.RootElement.GetProperty("mapBlob").GetProperty("hex").GetString());
        }

        [Test]
        public void RetainedCollisionFixtureCannotBypassCurrentWelcomeGroundValidation()
        {
            var bytes = Fixture(); var reader = new Reader(bytes);
            var map = MapBlob.ReadCollisionFixture(ref reader); reader.End();
            Assert.AreEqual(160, map.W); Assert.AreEqual(160, map.H);
            Assert.IsNull(map.Terrain); Assert.IsNull(map.Regions); Assert.AreEqual(MapBlob.GroundTerrainOff, map.TerrainMode);
            Assert.Throws<DecodeException>(() => { var current = new Reader(bytes); MapBlob.Read(ref current); });

            var welcome = new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], PlayerId = 3,
                Session = new byte[16], TickRate = 20, Map = map };
            var valid = welcome.Encode();
            Assert.IsInstanceOf<ServerMsg.Welcome>(ServerMsg.Decode(valid));
            int extensionBytes = map.EncodedLength - bytes.Length;
            Assert.Greater(extensionBytes, 0);
            var truncated = new byte[valid.Length - extensionBytes]; Array.Copy(valid, truncated, truncated.Length);
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(truncated), "current Welcome never falls back to a collision-only record");
            var fullMap = new Writer(); map.Write(fullMap);
            Assert.Throws<DecodeException>(() => { var legacy = new Reader(fullMap.Finish()); MapBlob.ReadCollisionFixture(ref legacy); },
                "the explicit fixture decoder does not swallow a current map's trailing section");
        }

        [Test]
        public void CollisionFixtureStillChecksItsHashBeforeAcceptingTiles()
        {
            var bytes = Fixture(); bytes[4] ^= 1;
            Assert.Throws<DecodeException>(() => { var reader = new Reader(bytes); MapBlob.ReadCollisionFixture(ref reader); });
        }
    }
}
