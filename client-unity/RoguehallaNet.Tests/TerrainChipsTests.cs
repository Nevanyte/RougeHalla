using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// Terrain chips, pinned to legacy packages/client/src/render/zoneArt/terrainFeedback.ts chipsOf (:78-97: BURNING :82, SLOWED :86,
    /// ICE :88) and homeNote (:100-108), shown by ui/terrainChips.ts under the vitals (hud.ts:138). Terrain codes are the terrain plane's,
    /// as Rust names them (crates/rh-sim/src/terrain.rs surface(): 4 ember, 5 bog, 6 ice, 7 light). The live server runs
    /// terrain::Mode::All (crates/rh-server/src/runtime.rs:222), which reads every faction as None (systems/terrain/mod.rs:19,
    /// systems/movement.rs:64): home factions are NOT exempt there, so no "Home ground" line is ever true live.
    /// </summary>
    public sealed class TerrainChipsTests
    {
        const byte Off = MapBlob.GroundTerrainOff, Map = MapBlob.GroundTerrainMap, All = MapBlob.GroundTerrainAll;

        static TerrainChip Only(byte terrain, byte mode, FactionId? faction)
        {
            var chips = TerrainChips.For(terrain, mode, faction);
            Assert.AreEqual(1, chips.Length, "terrain " + terrain + " mode " + mode + " faction " + faction);
            return chips[0];
        }

        [Test]
        public void Ember_is_BURNING_with_the_burn_share()
        {
            var c = Only(4, All, FactionId.Holy);
            Assert.AreEqual("burning", c.Id);
            Assert.AreEqual("▲", c.Glyph);
            Assert.AreEqual("BURNING", c.Label);
            Assert.AreEqual("Embers burn 2% of your max hp every second", c.Explanation);
        }

        [Test]
        public void Bog_is_SLOWED_with_the_speed_percent()
        {
            var c = Only(5, All, FactionId.Holy);
            Assert.AreEqual("slowed", c.Id);
            Assert.AreEqual("▼", c.Glyph);
            Assert.AreEqual("SLOWED", c.Label);
            Assert.AreEqual("Bog slows you to 70% speed", c.Explanation);
        }

        [Test]
        public void Ice_is_ICE_with_the_slide_explanation()
        {
            var c = Only(6, All, FactionId.Holy);
            Assert.AreEqual("ice", c.Id);
            Assert.AreEqual("◇", c.Glyph);
            Assert.AreEqual("ICE", c.Label);
            Assert.AreEqual("Slippery: you slide when you start, turn or stop", c.Explanation);
        }

        [Test]
        public void Plain_floor_other_kinds_and_unknown_codes_give_no_chip()
        {
            // 0 plain, 1 lava, 2 fence, 3 crevasse act through tiles, not chips; 7 light is RESTING, which needs a fact the wire lacks.
            foreach (byte code in new byte[] { 0, 1, 2, 3, 7, 8, 200, 255 })
                foreach (byte mode in new[] { Off, Map, All })
                {
                    Assert.AreEqual(0, TerrainChips.For(code, mode, FactionId.Fire).Length, "code " + code + " mode " + mode);
                    Assert.IsNull(TerrainChips.HomeNote(code, mode, FactionId.Fire), "note code " + code + " mode " + mode);
                }
        }

        [Test]
        public void Live_mode_All_chips_every_faction_and_never_shows_home_ground()
        {
            // Home factions (Fire/ember, Plague/bog, Frost/ice) are affected under Mode::All; legacy would have exempted them.
            var homes = new[] { (byte)4, (byte)5, (byte)6 };
            var labels = new[] { "BURNING", "SLOWED", "ICE" };
            var factions = new FactionId?[] { null, FactionId.Fire, FactionId.Sentenced, FactionId.Plague, FactionId.Frost, FactionId.Holy };
            foreach (var f in factions)
                for (int i = 0; i < homes.Length; i++)
                {
                    Assert.AreEqual(labels[i], Only(homes[i], All, f).Label, "faction " + f);
                    Assert.IsNull(TerrainChips.HomeNote(homes[i], All, f), "faction " + f);
                }
        }

        [Test]
        public void Terrain_mode_Off_gives_nothing()
        {
            foreach (byte code in new byte[] { 4, 5, 6 })
            {
                Assert.AreEqual(0, TerrainChips.For(code, Off, FactionId.Holy).Length);
                Assert.IsNull(TerrainChips.HomeNote(code, Off, FactionId.Holy));
            }
        }

        [Test]
        public void Map_mode_keeps_legacy_home_ground_for_the_exempt_faction()
        {
            // terrainFeedback.ts:55-60,104-106; the spec names are TERRAINS[].name lower-cased (shared/src/terrain.ts:67-69).
            Assert.AreEqual(0, TerrainChips.For(4, Map, FactionId.Fire).Length);
            Assert.AreEqual("Home ground: embers can't burn you", TerrainChips.HomeNote(4, Map, FactionId.Fire));
            Assert.AreEqual(0, TerrainChips.For(5, Map, FactionId.Plague).Length);
            Assert.AreEqual("Home ground: bog can't slow you", TerrainChips.HomeNote(5, Map, FactionId.Plague));
            Assert.AreEqual(0, TerrainChips.For(6, Map, FactionId.Frost).Length);
            Assert.AreEqual("Home ground: full grip on ice", TerrainChips.HomeNote(6, Map, FactionId.Frost));
            // Other factions, and a missing faction, are affected and have no note.
            Assert.AreEqual("BURNING", Only(4, Map, FactionId.Holy).Label);
            Assert.AreEqual("BURNING", Only(4, Map, null).Label);
            Assert.AreEqual("SLOWED", Only(5, Map, FactionId.Fire).Label);
            Assert.IsNull(TerrainChips.HomeNote(4, Map, FactionId.Plague));
        }

        [Test]
        public void Mirrored_numbers_match_the_Rust_constants()
        {
            string src = File.ReadAllText(Path.Combine(Util.RepoRoot(), "crates", "rh-sim", "src", "constants.rs"));
            Assert.AreEqual(TerrainChips.BurnShare, Rust(src, "TERRAIN_BURN"), 0);
            Assert.AreEqual(TerrainChips.BogSpeed, Rust(src, "TERRAIN_BOG"), 0);
        }

        static double Rust(string src, string name)
        {
            var m = Regex.Match(src, name + @":\s*f64\s*=\s*([0-9.]+)\s*,");
            Assert.IsTrue(m.Success, name + " not found in constants.rs");
            return double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
        }
    }
}
