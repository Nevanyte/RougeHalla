using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-WIRE17-HUD-3 oracle (C# decoder): State key 1 appends the owner's healing-potion and wind-emblem end times (each
    /// a flag byte, then an f64 of server ms when 1) and State key 9 appends the room's minimum players (u8, 0..32) after
    /// <c>started_with</c>; <see cref="CollectionsView"/> exposes them; the regenerated vectors decode as the brief says
    /// (docs/backlog/packets/P-WIRE17-HUD-3.md, "Wire layout" and "Vector names").
    /// </summary>
    public sealed class HudClockProtocolTests
    {
        static JsonElement Fixture() { return JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", Util.FixtureName))).RootElement; }

        static string Hex(string list, string name)
        {
            foreach (var v in Fixture().GetProperty(list).EnumerateArray()) if (v.GetProperty("name").GetString() == name) return v.GetProperty("hex").GetString();
            return null;
        }

        static WireInventory Inv(double? healing, double? boost)
        {
            return new WireInventory { ActiveSlot = 1, Slot0 = 0, Slot1 = null, PotionSmall = 2, PotionLarge = 1, PotionsHealing = 1, HealingUntil = healing, SpeedBoostUntil = boost };
        }

        static ServerMsg.State InvFrame(WireInventory inv) { return new ServerMsg.State { Tick = 5, Items = new StateItem[] { new InventoryState { Value = inv } } }; }

        /// <summary>The key-1 bytes before this packet: tag, tick 5, one item, key 1, present, slot 1, Sword, empty, 2, 1, 1.</summary>
        static byte[] InvPrefix() { return new byte[] { 0x88, 5, 1, 1, 1, 1, 1, 0, 2, 1, 1 }; }

        static byte[] Clock(double? v) { return v.HasValue ? new byte[] { 1 }.Concat(BitConverter.GetBytes(v.Value)).ToArray() : new byte[] { 0 }; }

        static WireArena Arena(byte min)
        {
            return new WireArena { LobbyEndsAt = 30000, PlanEndsAt = 0, RaidStartedAt = 0, PatienceEndsAt = null, InColiseum = false, GatesLocked = false, SuddenDeathAt = 0, StartedWith = 0, MinPlayers = min };
        }

        static ServerMsg.State ArenaFrame(WireArena a) { return new ServerMsg.State { Tick = 5, Items = new StateItem[] { new ArenaState { Value = a } } }; }

        static byte[] ArenaPrefix()
        {
            return new byte[] { 0x88, 5, 1, 9, 1 }.Concat(BitConverter.GetBytes(30000.0)).Concat(new byte[16]).Concat(new byte[] { 0, 0, 0 })
                .Concat(new byte[8]).Concat(new byte[] { 0 }).ToArray();
        }

        static void ApplyDirect(CollectionsView collections, ServerMsg.State state)
        {
            typeof(CollectionsView).GetMethod("Apply", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(collections, new object[] { state });
        }

        [Test]
        public void Key1AppendsTheOwnerClocks()
        {
            Assert.IsTrue(BitConverter.IsLittleEndian);
            foreach (var (h, s) in new (double?, double?)[] { (null, null), (15050, null), (null, 17000), (15050, 17000), (0, double.MaxValue) })
            {
                byte[] bytes = InvFrame(Inv(h, s)).Encode();
                CollectionAssert.AreEqual(InvPrefix().Concat(Clock(h)).Concat(Clock(s)).ToArray(), bytes, "layout " + h + " " + s);
                var back = ((InventoryState)((ServerMsg.State)ServerMsg.Decode(bytes)).Items[0]).Value.Value;
                Assert.AreEqual(h, back.HealingUntil, "healing round trip");
                Assert.AreEqual(s, back.SpeedBoostUntil, "boost round trip");
            }
        }

        [Test]
        public void Key1RefusesANonFiniteOrNegativeClock()
        {
            foreach (double bad in new[] { double.NaN, double.PositiveInfinity, double.NegativeInfinity, -50.0 })
            {
                Assert.Throws<EncodeException>(() => InvFrame(Inv(bad, null)).Encode(), "healing " + bad);
                Assert.Throws<EncodeException>(() => InvFrame(Inv(null, bad)).Encode(), "boost " + bad);
                byte[] frame = InvPrefix().Concat(Clock(bad)).Concat(Clock(null)).ToArray();
                Assert.AreEqual(DecodeError.BadField, Assert.Throws<DecodeException>(() => ServerMsg.Decode(frame)).Error, "decode " + bad);
            }
            Assert.AreEqual(DecodeError.Truncated, Assert.Throws<DecodeException>(() => ServerMsg.Decode(InvPrefix())).Error, "the old layout is refused");
        }

        [Test]
        public void Key9AppendsTheRoomsMinimumPlayers()
        {
            Assert.AreEqual(32, WireArena.MaxMinPlayers);
            foreach (byte min in new byte[] { 0, 1, 2, 8, 32 })
            {
                byte[] bytes = ArenaFrame(Arena(min)).Encode();
                CollectionAssert.AreEqual(ArenaPrefix().Concat(new[] { min }).ToArray(), bytes, "layout " + min);
                Assert.AreEqual(min, ((ArenaState)((ServerMsg.State)ServerMsg.Decode(bytes)).Items[0]).Value.Value.MinPlayers);
            }
            Assert.Throws<EncodeException>(() => ArenaFrame(Arena(33)).Encode(), "33 refused");
            Assert.AreEqual(DecodeError.BadField, Assert.Throws<DecodeException>(() => ServerMsg.Decode(ArenaPrefix().Concat(new byte[] { 33 }).ToArray())).Error);
            Assert.AreEqual(DecodeError.Truncated, Assert.Throws<DecodeException>(() => ServerMsg.Decode(ArenaPrefix())).Error, "the old layout is refused");
        }

        [Test]
        public void CollectionsExposeTheClocksAndTheMinimum()
        {
            var view = new CollectionsView();
            ApplyDirect(view, new ServerMsg.State { Tick = 7, Items = new StateItem[] { new InventoryState { Value = Inv(15050, 17000) }, new ArenaState { Value = Arena(3) } } });
            Assert.AreEqual(15050.0, view.Inventory.Value.HealingUntil);
            Assert.AreEqual(17000.0, view.Inventory.Value.SpeedBoostUntil);
            Assert.AreEqual(3, view.Arena.Value.MinPlayers);
            ApplyDirect(view, new ServerMsg.State { Tick = 8, Items = new StateItem[] { new InventoryState { Value = Inv(null, null) } } });
            Assert.IsNull(view.Inventory.Value.HealingUntil, "absent: nothing running");
            Assert.IsNull(view.Inventory.Value.SpeedBoostUntil);
        }

        [Test]
        public void TheRegeneratedVectorsCarryTheClocksAndTheMinimum()
        {
            string hex = Hex("server", "state_inventory_clocks");
            Assert.IsNotNull(hex, "server vector state_inventory_clocks (regenerate protocol/fixtures with protocol-fixtures)");
            var state = (ServerMsg.State)ServerMsg.Decode(Util.FromHex(hex));
            Assert.AreEqual(216u, state.Tick);
            var inv = ((InventoryState)state.Items[0]).Value.Value;
            Assert.AreEqual((1, (byte?)0, (byte?)2, 3, 1, 2), (inv.ActiveSlot, inv.Slot0, inv.Slot1, inv.PotionSmall, inv.PotionLarge, inv.PotionsHealing));
            Assert.AreEqual(15050.0, inv.HealingUntil);
            Assert.AreEqual(17000.0, inv.SpeedBoostUntil);
            CollectionAssert.AreEqual(Util.FromHex(hex), state.Encode(), "byte-exact re-encode");

            hex = Hex("server", "state_inventory_speed_boost");
            Assert.IsNotNull(hex, "server vector state_inventory_speed_boost");
            inv = ((InventoryState)((ServerMsg.State)ServerMsg.Decode(Util.FromHex(hex))).Items[0]).Value.Value;
            Assert.AreEqual(0, inv.PotionsHealing);
            Assert.IsNull(inv.HealingUntil);
            Assert.AreEqual(17000.0, inv.SpeedBoostUntil);

            var planning = (ServerMsg.State)ServerMsg.Decode(Util.FromHex(Hex("server", "state_planning")));
            Assert.AreEqual(2, planning.Items.OfType<ArenaState>().Single().Value.Value.MinPlayers, "legacy MIN_PLAYERS_TO_START");

            var all = (ServerMsg.State)ServerMsg.Decode(Util.FromHex(Hex("server", "state_all")));
            var allInv = all.Items.OfType<InventoryState>().Single().Value.Value;
            Assert.IsNull(allInv.HealingUntil);
            Assert.IsNull(allInv.SpeedBoostUntil);

            byte[] max = Util.FromHex(Hex("server", "state_all_max_budget"));
            Assert.AreEqual(247696, max.Length);
            var maxState = (ServerMsg.State)ServerMsg.Decode(max);
            Assert.AreEqual(double.MaxValue, maxState.Items.OfType<InventoryState>().Single().Value.Value.HealingUntil);
            Assert.AreEqual(32, maxState.Items.OfType<ArenaState>().Single().Value.Value.MinPlayers);
        }

        [Test]
        public void TheRefusalVectorsArePresent()
        {
            foreach (var name in new[] { "state_inventory_healing_nan", "state_inventory_healing_negative", "state_inventory_boost_infinite",
                "state_inventory_clock_truncated", "state_arena_min_players_over", "state_arena_min_players_missing" })
                Assert.IsNotNull(Hex("malformedServer", name), "malformed vector " + name);
        }
    }
}
