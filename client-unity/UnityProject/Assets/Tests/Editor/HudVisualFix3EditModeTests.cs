using System;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    /// <summary>A transport that hands encoded server messages to a session (shared by the P-UNITY-HUD-VISUAL-FIX-3 fixtures).</summary>
    internal sealed class Fix3Transport : ITransport
    {
        public event Action Opened;
        public event Action<byte[]> Received;
        public event Action<string> Closed;
        public void Connect(string url) { }
        public void Send(byte[] frame) { }
        public void Close() { }
        public void Poll() { }
        public void Open() { Opened?.Invoke(); }
        public void Deliver(ServerMsg message) { Received?.Invoke(message.Encode()); }

        public static Session Join(Fix3Transport transport, MapBlob map, WireSelf me, params WireActor[] actors)
        {
            var session = new Session(transport, new SessionOptions { Url = "ws://fix3/ws", Profile = "fix3", Now = () => 1000 });
            session.Connect(); transport.Open();
            transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 1, TickRate = 20, ServerMs = 50, Map = map });
            if (me != null)
                transport.Deliver(new ServerMsg.Snapshot { Tick = 1, ServerTimeOverrideMs = 50, Phase = 1, Me = me, Actors = actors });
            return session;
        }
    }

    /// <summary>
    /// P-UNITY-HUD-VISUAL-FIX-3, HUD half: the drawer label's count (item 1), the terrain chips as the running client draws them (item 2)
    /// and the Sentenced Hunt card text (item 3). Text is measured after the run-time text scale (MatchHud.ApplyTextScale /
    /// MythicUi.ApplyTextScale), the way the client leaves it.
    /// </summary>
    public sealed class HudVisualFix3EditModeTests
    {
        GameObject _canvas, _owner;
        MatchHud _hud;
        UiTheme _savedTheme;
        Session _session;
        Fix3Transport _transport;

        [SetUp]
        public void SetUp()
        {
            _savedTheme = UiTheme.Current;
            UiTheme.Current = UiTheme.Placeholder();
            _canvas = new GameObject("fix3 canvas", typeof(RectTransform), typeof(Canvas));
            _owner = new GameObject("fix3 hud owner");
            _hud = _owner.AddComponent<MatchHud>();
            SetField("_root", _canvas.GetComponent<RectTransform>());
            Invoke("EnsureStage"); Invoke("CreateTopAndToastPills"); Invoke("CreateLegacyChrome"); Invoke("CreateCombatHud");
            _transport = new Fix3Transport();
        }

        [TearDown]
        public void TearDown()
        {
            if (_session != null) _session.Leave();
            if (_canvas != null) UnityEngine.Object.DestroyImmediate(_canvas);
            if (_owner != null) UnityEngine.Object.DestroyImmediate(_owner);
            UiTheme.Current = _savedTheme;
        }

        // ------------------------------------------------------------------ item 1: the drawer label

        // Diagnosis (packet): the rows reach the HUD (BuildHudTextTests, BuildHudHeaderTests); the label's "0" is the count of card TYPES
        // held (MatchHud.cs:458 CountCards), and it only refreshes when cards or boosts change, never when the summary does.
        [Test]
        public void TheDrawerLabelCountsFarmedMobTypesAndFollowsTheSummaryWithoutAnyCardChange()
        {
            _session = Fix3Transport.Join(_transport, new MapBlob(4, 4, new byte[16]), Self(FactionId.Holy, 48, 48));
            SetField("_session", _session);
            _transport.Deliver(new ServerMsg.State { Tick = 2, Items = new StateItem[]
            {
                new BuildState { Value = new WireBuild { Cards = new byte[80], Boosts = new byte[8] } },
                new BuildSummaryState { Value = new WireBuildSummary() },
            } });
            Invoke("RefreshCollections", _session.Collections);
            Assert.That(Label(), Is.EqualTo("Cards & mob bonuses · 0"), "no cards, no mob rows");

            var summary = new WireBuildSummary();
            summary.MobRows = new[]
            {
                new WireMobBonusRow { MobType = (byte)MobTypeId.EmberImp, Stat = 2, Stacks = 3, Total = 300 },
                new WireMobBonusRow { MobType = (byte)MobTypeId.SeraphShard, Stat = 7, Stacks = 12, Total = 180000 },
            };
            _transport.Deliver(new ServerMsg.State { Tick = 3, Items = new StateItem[] { new BuildSummaryState { Value = summary } } });
            Invoke("RefreshCollections", _session.Collections);
            Assert.That(Label(), Is.EqualTo("Cards & mob bonuses · 2"), "two farmed mob types after four kills; the cards did not change");
        }

        string Label() => ((TMP_Text)GetField("_build")).text;

        // ------------------------------------------------------------------ item 2: terrain chips, through the path the client runs

        // Diagnosis (packet): the chain map plane -> tile under the drawn position -> TerrainChips -> ShowTerrain works (this test's text
        // assertions pass today); the chip is drawn as bare pale text with no backing (MatchHud.Terrain.cs:60-63 colour alpha 0), unreadable
        // on snow and sand. Legacy draws a dark pill (terrainChips.css: rgba(10,12,16,.72) with a coloured border).
        const int Tile = 3;

        void StandOn(FactionId faction, byte terrainCode, byte mode = MapBlob.GroundTerrainMap)
        {
            var terrain = new byte[64]; terrain[Tile * 8 + Tile] = terrainCode;
            var map = new MapBlob(8, 8, new byte[64], terrain, null, mode);
            _session = Fix3Transport.Join(_transport, map, Self(faction, (Tile + .5f) * 32f, (Tile + .5f) * 32f));
            SetField("_session", _session); SetField("_plateActive", true);
            Invoke("TickTerrain");
        }

        [Test]
        public void AHolyPlayerOnIceGetsTheIceChipAndItIsReadableOnPaleGround()
        {
            StandOn(FactionId.Holy, 6);
            Assert.That(_hud.TerrainChipLabel, Is.EqualTo("◇ ICE"));
            Assert.That(_hud.TerrainChipTooltip, Is.EqualTo("Slippery: you slide when you start, turn or stop"));
            AssertReadable(Chip("Chip0").GetComponent<Image>(), Chip("Chip0/Label").GetComponent<TMP_Text>(), "ice chip");
        }

        [Test]
        public void AFrostPlayerOnIceGetsTheReadableHomeGroundNoteAndNoChip()
        {
            StandOn(FactionId.Frost, 6);
            Assert.That(_hud.TerrainChipLabel, Is.Empty);
            Assert.That(_hud.TerrainNoteLabel, Is.EqualTo("Home ground: full grip on ice"));
            var note = (TMP_Text)GetField("_terrainNoteText");
            AssertReadable(note.transform.parent.GetComponent<Image>(), note, "home note");
        }

        [Test]
        public void StandingOffHazardGroundShowsNothing()
        {
            StandOn(FactionId.Holy, 0);
            Assert.That(_hud.TerrainChipLabel, Is.Empty);
            Assert.That(_hud.TerrainNoteLabel, Is.Empty);
        }

        Transform Chip(string path) => ((RectTransform)GetField("_terrainRow")).Find(path);

        /// <summary>The text is on a backing at least 60 percent opaque; the text against that backing laid over the palest ground (white) keeps 3:1.</summary>
        static void AssertReadable(Image plate, TMP_Text text, string what)
        {
            Assert.That(plate, Is.Not.Null, what + " has no backing plate");
            Color c = plate.color;
            Assert.That(c.a, Is.GreaterThanOrEqualTo(.6f), what + " backing is see-through (alpha " + c.a + ")");
            Color over = new Color(c.r * c.a + (1f - c.a), c.g * c.a + (1f - c.a), c.b * c.a + (1f - c.a));
            float ratio = (Luminance(text.color) + .05f) / (Luminance(over) + .05f);
            if (ratio < 1f) ratio = 1f / ratio;
            Assert.That(ratio, Is.GreaterThanOrEqualTo(3f), what + " text/backing contrast over white ground");
        }

        static float Luminance(Color c)
        {
            Func<float, float> lin = v => v <= .03928f ? v / 12.92f : Mathf.Pow((v + .055f) / 1.055f, 2.4f);
            return .2126f * lin(c.r) + .7152f * lin(c.g) + .0722f * lin(c.b);
        }

        // ------------------------------------------------------------------ item 3: the Hunt card

        // "No rival" is shown at about 8 px in a mostly empty card (shot 16): the label's fixed 28 unit box makes the fit shrink the text.
        [TestCase(1f, false)]
        [TestCase(1.5f, false)]
        [TestCase(1f, true)]
        [TestCase(1.5f, true)]
        public void TheHuntCardTextIsAtLeastTheBodySizeAndFitsInsideTheCard(float scale, bool tracking)
        {
            var me = Self(FactionId.Sentenced, 64, 64);
            WireActor[] actors = tracking
                ? new[] { new WireActor { Id = 2, X = 100, Y = 100, Status = 1, HpPct = 80, Faction = 2 } }
                : new WireActor[0];
            if (tracking) me.HuntTarget = 2;
            _session = Fix3Transport.Join(_transport, new MapBlob(4, 4, new byte[16]), me, actors);
            var panel = _owner.AddComponent<SentencedHuntPanel>();
            panel.Initialize(_canvas.transform);
            panel.Refresh(_session, true);
            Assert.That(panel.IsVisible, Is.True, "the card shows for a living Sentenced in an active run");
            MythicUi.ApplyTextScale(_canvas.transform, scale);

            var status = panel.Root.Find("Status/Status").GetComponent<TMP_Text>();
            StringAssert.Contains(tracking ? "Tracking" : "No rival in sight", status.text);
            float body = UiTheme.Current.SizeSmall * scale;
            Assert.That(status.fontSize, Is.GreaterThanOrEqualTo(body - .01f), "Hunt body text at least the HUD small-text size (" + body + ")");
            var box = status.rectTransform.rect;
            float needed = status.GetPreferredValues(status.text, box.width, 0f).y;
            Assert.That(needed, Is.LessThanOrEqualTo(box.height + .5f), "the wrapped text fits its box");
            var corners = new Vector3[4]; status.rectTransform.GetWorldCorners(corners);
            float labelBottom = panel.Root.InverseTransformPoint(corners[0]).y, cardBottom = panel.Root.rect.yMin;
            Assert.That(labelBottom, Is.GreaterThanOrEqualTo(cardBottom + 2f), "the text box ends inside the card");
        }

        // ------------------------------------------------------------------ helpers

        static WireSelf Self(FactionId faction, float x, float y)
        {
            return new WireSelf { Id = 1, Faction = (byte)faction, X = x, Y = y, Hp = 100, MaxHp = 100, Status = 1, Weapon = 2 };
        }

        object GetField(string name) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
        void SetField(string name, object value) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value);
        void Invoke(string name, params object[] args) => typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, args.Length == 0 ? null : args);
    }
}
