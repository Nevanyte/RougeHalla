using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-COLISEUM-HEALS-2 oracle (C#): a coliseum heal pickup is prop kind 8 with the cannon's layout
    /// (`handle | x | y | 8 | readyAt varint`) at protocol 20; the client's collections carry it as PropAppearance.Heal with
    /// its clock, and it is lit exactly when the server time has reached that clock (WorldIndicatorRules.HealReady).</summary>
    public class HealPropProtocolTests
    {
        static readonly ushort[] Xs = { 20352, 20608, 20352, 20608 };
        static readonly ushort[] Ys = { 20352, 20352, 20608, 20608 };
        static readonly uint[] Ready = { 0, 30000, uint.MaxValue, 0 };

        static string Hex(string section, string name)
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", Util.FixtureName)));
            foreach (var v in doc.RootElement.GetProperty(section).EnumerateArray())
                if (v.GetProperty("name").GetString() == name) return v.GetProperty("hex").GetString();
            return null;
        }

        static ServerMsg.State Props(params WireProp[] rows)
        {
            return new ServerMsg.State { Tick = 202, Items = new StateItem[] { new PropsState { Rows = rows } } };
        }

        static WireProp Heal(int i)
        {
            return new WireProp { Handle = new PickupHandle((uint)(i + 1)), X = Xs[i], Y = Ys[i], Kind = PropKind.Heal, ReadyAt = Ready[i] };
        }

        [Test] public void CodecSpeaksProtocol22() { Assert.AreEqual(22, Wire.ProtocolVersion, "a new prop kind is an incompatible wire change: 19 -> 20 (origin); P-SYNC-ORIGIN-2 carries it as 22"); }

        [Test]
        public void TheHealKindIsByte8InBothEnums()
        {
            Assert.AreEqual(8, (int)PropKind.Heal);
            Assert.AreEqual(8, (int)PropAppearance.Heal);
        }

        [Test]
        public void AHealRowIsTheCannonLayoutWithKind8AndDecodesBack()
        {
            var cannonRow = Heal(1); cannonRow.Kind = PropKind.Cannon;
            byte[] cannon = Props(cannonRow).Encode();
            byte[] heal = null;
            Assert.DoesNotThrow(() => heal = Props(Heal(1)).Encode(), "a Heal row encodes");
            Assert.AreEqual(cannon.Length, heal.Length, "the cannon's layout");
            var differ = cannon.Zip(heal, (a, b) => (a, b)).Where(p => p.a != p.b).ToArray();
            CollectionAssert.AreEqual(new[] { ((byte)6, (byte)8) }, differ, "only the kind byte differs: cannon 6, heal 8");
            ServerMsg back = null;
            Assert.DoesNotThrow(() => back = ServerMsg.Decode(heal), "a kind 8 row decodes");
            var row = ((PropsState)((ServerMsg.State)back).Items[0]).Rows[0];
            Assert.AreEqual(PropKind.Heal, row.Kind); Assert.AreEqual(30000u, row.ReadyAt);
            Assert.AreEqual(20608, row.X); Assert.AreEqual(20352, row.Y);
        }

        [Test]
        public void TheGoldenHealVectorDecodesToTheFourPickupsAndRoundTrips()
        {
            string hex = Hex("server", "state_heal_props");
            Assert.IsNotNull(hex, "protocol/fixtures/" + Util.FixtureName + " has the server vector state_heal_props");
            var state = (ServerMsg.State)ServerMsg.Decode(Util.FromHex(hex));
            Assert.AreEqual(202u, state.Tick);
            var props = (PropsState)state.Items.Single();
            Assert.IsFalse(props.Focus.HasValue, "no focus");
            Assert.AreEqual(4, props.Rows.Length);
            for (int i = 0; i < 4; i++)
            {
                var r = props.Rows[i];
                Assert.AreEqual((uint)(i + 1), r.Handle.Value, "handle " + i);
                Assert.AreEqual(PropKind.Heal, r.Kind, "kind " + i);
                Assert.AreEqual(Xs[i], r.X, "x " + i); Assert.AreEqual(Ys[i], r.Y, "y " + i);
                Assert.AreEqual(Ready[i], r.ReadyAt, "readyAt " + i);
            }
            Assert.AreEqual(hex, Util.ToHex(state.Encode()), "byte for byte");
        }

        [Test]
        public void AnUnknownPropKindIsRefused()
        {
            // Hand-built (not a shared malformed vector: tools/protocol-js/check-vectors.mjs is provenance-pinned):
            // kind 9 after the heal's place is refused like every unknown byte.
            var nine = new byte[] { 0x88, 0xca, 0x01, 1, 2, 1, 1, 0x50, 0, 0xa0, 0, 9, 0, 0 };
            var e = Assert.Throws<DecodeException>(() => ServerMsg.Decode(nine), "prop kind 9");
            Assert.AreEqual(DecodeError.BadField, e.Error);
        }

        [Test]
        public void TheSessionCollectionsCarryTheHealAppearanceAndItsClock()
        {
            var transport = new FakeTransport(); double now = 0;
            var session = new Session(transport, new SessionOptions { Url = "ws://x/ws", Profile = "p", Ticket = Array.Empty<byte>(), Now = () => now });
            session.Connect(); transport.Open();
            transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16], PlayerId = 3, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
            Assert.DoesNotThrow(() => transport.Deliver(Props(Heal(0), Heal(1), Heal(2), Heal(3))), "the server's heal rows are delivered");
            var props = session.Collections.Props;
            Assert.AreEqual(4, props.Count, "four props");
            for (int i = 0; i < 4; i++)
            {
                Assert.AreEqual(PropAppearance.Heal, props[i].Kind, "appearance " + i);
                Assert.AreEqual(Ready[i], props[i].ReadyAt, "clock " + i);
                Assert.IsFalse(props[i].Focused, "never the focus");
            }
        }

        [Test]
        public void AHealIsLitWhenTheServerTimeHasReachedItsClockAndDimBefore()
        {
            Assert.IsTrue(WorldIndicatorRules.HealReady(0, 0), "available from the start (clock 0)");
            Assert.IsTrue(WorldIndicatorRules.HealReady(0, 125_000), "clock 0 stays available");
            Assert.IsFalse(WorldIndicatorRules.HealReady(30_000, 29_950), "one tick before its clock: dim");
            Assert.IsTrue(WorldIndicatorRules.HealReady(30_000, 30_000), "on the tick its clock reaches: lit (>=, as the sim)");
            Assert.IsTrue(WorldIndicatorRules.HealReady(30_000, 30_050), "after: lit");
            Assert.IsFalse(WorldIndicatorRules.HealReady(uint.MaxValue, 1e9), "the clamp ceiling: dim");
        }
    }
}
