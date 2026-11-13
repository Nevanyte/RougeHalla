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
    /// P-WIRE17-HUD-2c oracle (C# decoder): State key 13's champion panel carries codes 23-27 (Fire roam speed bonus and
    /// burst, hit multiplier, weapon scaling's physical and magic additions), the Welcome HUD block carries terms 19-22
    /// (the Fire roam constants), and the regenerated vectors <c>state_build_summary_panel_tooltip</c>,
    /// <c>state_build_summary_panel_code_unknown</c> and <c>welcome</c> decode as the brief says
    /// (docs/backlog/packets/P-WIRE17-HUD-2c.md, "Vector names").
    /// </summary>
    public sealed class HudTooltipProtocolTests
    {
        static JsonElement Fixture() { return JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", Util.FixtureName))).RootElement; }

        static string Hex(string list, string name)
        {
            foreach (var v in Fixture().GetProperty(list).EnumerateArray()) if (v.GetProperty("name").GetString() == name) return v.GetProperty("hex").GetString();
            return null;
        }

        static WirePanelValue P(byte code, int value) { return new WirePanelValue { Code = code, Value = value }; }

        /// <summary>The HUD-2 Fire panel (codes 0..9) plus the new codes of the same worked owner (roam bonus 0.125, burst
        /// 54.8, hit mult 2.5, scaling 3.636364 physical and 12.121212 magic), in 1e-4 quanta.</summary>
        static WirePanelValue[] TooltipPanel()
        {
            return new[] {
                P(0, 18182), P(1, 473697), P(2, 0), P(3, 19800), P(4, 643750), P(5, 6000), P(6, 5000), P(7, 12500),
                P(8, 2500000), P(9, 0), P(23, 1250), P(24, 548000), P(25, 25000), P(26, 36364), P(27, 121212),
            };
        }

        static (byte, int)[] Rows(WirePanelValue[] panel) { return panel.Select(p => (p.Code, p.Value)).ToArray(); }

        static ServerMsg.State Frame(WirePanelValue[] panel)
        {
            return new ServerMsg.State { Tick = 5, Items = new StateItem[] { new BuildSummaryState { Value = new WireBuildSummary { Panel = panel } } } };
        }

        [Test]
        public void BoundsMoveForTheAppendedCodes()
        {
            Assert.AreEqual(28, Hud.PanelCodeCount);
            Assert.AreEqual(28, Hud.MaxPanelValues);
            Assert.AreEqual(23, WireHudContent.TermCount);
            Assert.AreEqual(23, WireHudContent.MaxTerms);
            Assert.AreEqual(19, (byte)HudTerm.FireRoamRampMs);
            Assert.AreEqual(20, (byte)HudTerm.FireRoamChargeMax);
            Assert.AreEqual(21, (byte)HudTerm.FireRoamBurstBase);
            Assert.AreEqual(22, (byte)HudTerm.FireRoamBurstAdShare);
        }

        [Test]
        public void TheNewPanelCodesRoundTripAndTheBoundsRefuse()
        {
            var back = (ServerMsg.State)ServerMsg.Decode(Frame(TooltipPanel()).Encode());
            Assert.AreEqual(Rows(TooltipPanel()), Rows(((BuildSummaryState)back.Items[0]).Value.Panel));
            Assert.Throws<EncodeException>(() => Frame(TooltipPanel().Concat(new[] { P(28, 1) }).ToArray()).Encode(), "code 28");
            Assert.Throws<EncodeException>(() => Frame(Enumerable.Range(0, 29).Select(i => P((byte)i, 1)).ToArray()).Encode(), "29 values");
            Assert.DoesNotThrow(() => Frame(Enumerable.Range(0, 28).Select(i => P((byte)i, 1)).ToArray()).Encode(), "28 values");
        }

        [Test]
        public void TheRegeneratedTooltipVectorCarriesTheNewCodes()
        {
            string hex = Hex("server", "state_build_summary_panel_tooltip");
            Assert.IsNotNull(hex, "server vector state_build_summary_panel_tooltip (regenerate protocol/fixtures with protocol-fixtures)");
            var state = (ServerMsg.State)ServerMsg.Decode(Util.FromHex(hex));
            Assert.AreEqual(216u, state.Tick);
            var summary = ((BuildSummaryState)state.Items[0]).Value;
            Assert.AreEqual(Rows(TooltipPanel()), Rows(summary.Panel));
            Assert.AreEqual(54.8, summary.Panel.First(p => p.Code == 24).Scaled, 1e-9, "burst, scaled, no recomputation");
            CollectionAssert.AreEqual(Util.FromHex(hex), state.Encode(), "byte-exact re-encode");
        }

        [Test]
        public void ThePanelRefusalVectorsFollowTheNewBounds()
        {
            Assert.IsNull(Hex("malformedServer", "state_build_summary_panel_code_23"), "retired: code 23 is valid now");
            string unknown = Hex("malformedServer", "state_build_summary_panel_code_unknown");
            Assert.IsNotNull(unknown, "malformed vector state_build_summary_panel_code_unknown");
            var e = Assert.Throws<DecodeException>(() => ServerMsg.Decode(Util.FromHex(unknown)));
            Assert.AreEqual(DecodeError.BadField + ": summary panel code", e.Message);
            Assert.AreEqual(28, Util.FromHex(unknown)[^5], "the row's code is PanelCodeCount");
            string over = Hex("malformedServer", "state_build_summary_panel_count_over");
            Assert.AreEqual(DecodeError.TooMany, Assert.Throws<DecodeException>(() => ServerMsg.Decode(Util.FromHex(over))).Error);
            Assert.AreEqual(29, Util.FromHex(over)[5 + 36 + 1], "29 rows promised");
        }

        [Test]
        public void TheWelcomeVectorCarriesTheFireRoamTerms()
        {
            var w = (ServerMsg.Welcome)ServerMsg.Decode(Util.FromHex(Hex("server", "welcome")));
            Assert.AreEqual(23, w.Hud.Terms.Length, "every code once");
            Assert.AreEqual(20000.0, w.Hud.Term(HudTerm.FireRoamRampMs));
            Assert.AreEqual(1000.0, w.Hud.Term(HudTerm.FireRoamChargeMax));
            Assert.AreEqual(50.0, w.Hud.Term(HudTerm.FireRoamBurstBase));
            Assert.AreEqual(0.4, w.Hud.Term(HudTerm.FireRoamBurstAdShare));
        }
    }
}
