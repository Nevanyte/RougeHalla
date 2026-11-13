using System;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>P-UNITY-HUD-STATUS-2 review notes: the wind label fits under the text-size fit (MythicTextScale), and a session with no snapshot shows no seconds.</summary>
    public sealed class MatchHudStatusNotesEditModeTests
    {
        const string Dash = "—", Dot = "·";
        GameObject _canvas, _owner;
        MatchHud _hud;
        UiTheme _savedTheme;
        Session _session;
        Fix3Transport _transport;
        uint _tick;

        [SetUp]
        public void SetUp()
        {
            _savedTheme = UiTheme.Current;
            UiTheme.Current = UiTheme.Placeholder();
            _canvas = new GameObject("status texts canvas", typeof(RectTransform), typeof(Canvas));
            _owner = new GameObject("status texts hud owner");
            _hud = _owner.AddComponent<MatchHud>();
            SetField("_root", _canvas.GetComponent<RectTransform>());
            Invoke("EnsureStage"); Invoke("CreateTopAndToastPills"); Invoke("CreateLegacyChrome"); Invoke("CreateCombatHud");
            _transport = new Fix3Transport();
            _session = Fix3Transport.Join(_transport, new MapBlob(4, 4, new byte[16]), null);
            SetField("_session", _session);
            _tick = 1;
        }

        [TearDown]
        public void TearDown()
        {
            if (_session != null) _session.Leave();
            if (_canvas != null) UnityEngine.Object.DestroyImmediate(_canvas);
            if (_owner != null) UnityEngine.Object.DestroyImmediate(_owner);
            UiTheme.Current = _savedTheme;
        }

        // ---- rig helpers ----
        void Snapshot(MatchPhase phase, double serverMs)
        {
            _tick++;
            _transport.Deliver(new ServerMsg.Snapshot
            {
                Tick = _tick, ServerTimeOverrideMs = serverMs, Phase = (byte)phase,
                Me = new WireSelf { Id = 1, Faction = (byte)FactionId.Holy, X = 64, Y = 64, Hp = 100, MaxHp = 100, Status = 1, Weapon = 2 },
                Actors = new WireActor[0],
            });
        }
        void State(params StateItem[] items) { _tick++; _transport.Deliver(new ServerMsg.State { Tick = _tick, Items = items }); }
        static InventoryState Inventory(byte healing, double? healingUntil, double? boostUntil)
        {
            return new InventoryState { Value = new WireInventory { ActiveSlot = 0, Slot0 = (byte)WeaponId.Sword, Slot1 = (byte)WeaponId.Bow, PotionSmall = 1, PotionLarge = 1,
                PotionsHealing = healing, HealingUntil = healingUntil, SpeedBoostUntil = boostUntil } };
        }
        /// <summary>The frame order the HUD runs: a collections change, then the per-frame owner refresh with the same accepted clock.</summary>
        void Frame()
        {
            Invoke("RefreshCollections", _session.Collections);
            Invoke("RefreshOwnerPresentation", _session.Me, _session.ServerTimeMs);
        }
        string HealStatus() => ((TMP_Text)GetField("_healStatus")).text;
        string Wind() => ((TMP_Text)GetField("_windText")).text;
        string PhaseStrip()
        {
            if (GetField("_uiPrefs") == null) SetField("_uiPrefs", new UiDisplayPreferences());   // set by InitializeFeatures in the running client
            SetField("_nextMetricsAt", 0d);
            Invoke("TickMetrics");
            return ((TMP_Text)GetField("_phaseStrip")).text;
        }

        static string Windy(int seconds) => "+50% speed " + Dot + " Active " + seconds + "s";

        [TestCase(1f, 6000.0, 5)] [TestCase(1f, 60000.0, 59)] [TestCase(1f, 121000.0, 120)]
        [TestCase(1.5f, 6000.0, 5)] [TestCase(1.5f, 60000.0, 59)] [TestCase(1.5f, 121000.0, 120)]
        public void TheWindLabelFitsItsRectAtTheAppliedSizeAtTextScales(float scale, double until, int seconds)
        {
            Snapshot(MatchPhase.Active, 1000);
            State(Inventory(0, null, until));
            Frame();
            Assert.That(Wind(), Is.EqualTo(Windy(seconds)));
            var label = (TMP_Text)GetField("_windText");
            var follow = label.GetComponent<MythicTextScale>();
            follow.Apply(scale);
            float width = label.GetPreferredValues(label.text, 0f, 0f).x;
            Debug.Log("wind label " + label.text + " scale " + scale + ": size " + label.fontSize + ", preferred width " + width + ", rect " + label.rectTransform.rect.width);
            Assert.That(label.enableAutoSizing, Is.False);
            Assert.That(label.fontSize, Is.GreaterThanOrEqualTo(7f - .01f));
            Assert.That(width, Is.LessThanOrEqualTo(label.rectTransform.rect.width + .01f));
        }

        [Test]
        public void ASessionWithNoSnapshotYetShowsNoSeconds()
        {
            State(Inventory(2, 9000000, 9000000));   // old end times, no snapshot: ServerTimeMs reads 0
            Assert.That(_session.Latest, Is.Null);
            Invoke("RefreshCollections", _session.Collections);
            Assert.That(HealStatus(), Is.EqualTo("Healing x2"), "count-only, no huge seconds");
            Assert.That(Wind(), Is.EqualTo("Walk over emblems"));
        }

        object GetField(string name) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
        void SetField(string name, object value) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value);
        void Invoke(string name, params object[] args) => typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, args.Length == 0 ? null : args);
    }
}
