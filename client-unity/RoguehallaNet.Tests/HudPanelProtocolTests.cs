using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-WIRE17-HUD-2 oracle (C# decoder): the champion panel appended to State key 13 (count u8, then code u8 and
    /// value i32 LE per row, codes strictly ascending and below 23, at most 23 rows), the regenerated golden vector
    /// <c>state_build_summary_panel</c>, and the shared negative vectors for the HUD fields
    /// (docs/backlog/packets/P-WIRE17-HUD-2.md, "Wire layout" and "Vector names").
    /// </summary>
    public sealed class HudPanelProtocolTests
    {
        static JsonElement Fixture() { return JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", Util.FixtureName))).RootElement; }

        static WirePanelValue P(byte code, int value) { return new WirePanelValue { Code = code, Value = value }; }

        static WirePanelValue[] FirePanel()
        {
            return new[] {
                P(0, 18182), P(1, 473697), P(2, 0), P(3, 19800), P(4, 643750),
                P(5, 6000), P(6, 5000), P(7, 12500), P(8, 2500000), P(9, 0),
            };
        }

        static (byte, int)[] Rows(WirePanelValue[] panel) { return panel.Select(p => (p.Code, p.Value)).ToArray(); }

        static ServerMsg.State Frame(WirePanelValue[] panel)
        {
            var s = new WireBuildSummary { Panel = panel };
            return new ServerMsg.State { Tick = 5, Items = new StateItem[] { new BuildSummaryState { Value = s } } };
        }

        [Test]
        public void PanelConstantsMatchTheBrief()
        {
            // P-WIRE17-HUD-2c: codes 23-27 appended.
            Assert.AreEqual(28, Hud.PanelCodeCount);
            Assert.AreEqual(28, Hud.MaxPanelValues);
        }

        [Test]
        public void ThePanelIsWrittenAfterTheMobRowsAndReadBack()
        {
            byte[] bytes = Frame(FirePanel()).Encode();
            var want = new List<byte> { 0x88, 5, 1, 13, 1 };
            want.AddRange(new byte[36]);
            want.Add(0);
            want.Add(10);
            foreach (var p in FirePanel()) { want.Add(p.Code); want.AddRange(BitConverter.GetBytes(p.Value)); }
            Assert.AreEqual(want.ToArray(), bytes, "key 13 bytes with the Fire panel");

            var decoded = (ServerMsg.State)ServerMsg.Decode(bytes);
            var summary = ((BuildSummaryState)decoded.Items[0]).Value;
            Assert.AreEqual(Rows(FirePanel()), Rows(summary.Panel), "panel round trip");
            Assert.AreEqual(250.0, summary.Panel[8].Scaled, 1e-9, "scaled accessor, no recomputation");
        }

        [Test]
        public void TheEncoderRefusesABadPanel()
        {
            var unknown = FirePanel().Concat(new[] { P(28, 1) }).ToArray();
            Assert.Throws<EncodeException>(() => Frame(unknown).Encode(), "code 28");
            var dup = FirePanel(); dup[1].Code = 0;
            Assert.Throws<EncodeException>(() => Frame(dup).Encode(), "duplicate code");
            var over = Enumerable.Range(0, 29).Select(i => P((byte)i, 1)).ToArray();
            Assert.Throws<EncodeException>(() => Frame(over).Encode(), "29 values");
        }

        [Test]
        public void TheRegeneratedVectorCarriesTheFirePanel()
        {
            string hex = null;
            foreach (var v in Fixture().GetProperty("server").EnumerateArray())
                if (v.GetProperty("name").GetString() == "state_build_summary_panel") hex = v.GetProperty("hex").GetString();
            Assert.IsNotNull(hex, "server vector state_build_summary_panel (regenerate protocol/fixtures with protocol-fixtures)");
            var state = (ServerMsg.State)ServerMsg.Decode(Util.FromHex(hex));
            Assert.AreEqual(216u, state.Tick);
            var summary = ((BuildSummaryState)state.Items[0]).Value;
            Assert.AreEqual(new[] { 25000, 15000, 0, -5000, 0, 0, 0, 0, 0 }, summary.Gains);
            Assert.AreEqual(0, summary.MobRows.Length);
            Assert.AreEqual(Rows(FirePanel()), Rows(summary.Panel));
        }

        static readonly string[] NewNegatives = {
            "state_camp_reward_stat_10", "state_camp_ward_verdict_3", "state_camp_ward_missing_expiry",
            "state_build_summary_gains_short", "state_build_summary_mob_stat_9",
            "state_build_summary_panel_code_unknown", "state_build_summary_panel_order", "state_build_summary_panel_count_over",
        };

        [Test]
        public void TheSharedHudNegativeVectorsArePresent()
        {
            var names = Fixture().GetProperty("malformedServer").EnumerateArray().Select(v => v.GetProperty("name").GetString()).ToHashSet();
            Assert.AreEqual(Array.Empty<string>(), NewNegatives.Where(n => !names.Contains(n)).ToArray(), "missing malformedServer vectors");
        }
    }
}
