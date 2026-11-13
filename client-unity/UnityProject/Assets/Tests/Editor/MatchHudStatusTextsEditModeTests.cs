using System;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-HUD-STATUS-2: the lobby line, the healing slot and the wind-emblem slot draw the texts of legacy hud.ts:44 and weaponBar.ts:144-148
    /// from a <see cref="CollectionsView"/> that carries the new facts, measured against the session's server clock (Session.ServerTimeMs, the clock
    /// the lobby countdown already uses). Rig: the HudVisualFix3EditModeTests one (Fix3Transport, a real Session, the HUD built through the same
    /// private Create* calls). Seams kept as they are: RefreshCollections(CollectionsView), RefreshOwnerPresentation(SelfView, double),
    /// UpdateInventoryHints(InventoryView?) (ChampionPanelNoGarbageEditModeTests binds a delegate to it), TickMetrics().
    /// Tests marked GUARD are green today and must stay so. The engine-free texts are pinned in RoguehallaNet.Tests/HudStatusClocksTests.cs.
    /// </summary>
    public sealed class MatchHudStatusTextsEditModeTests
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

        // ---- 1. the lobby line ----
        [TestCase(1, 2, 1, "Waiting for players 1/2 " + Dash + " run starts in 0:40")]
        [TestCase(1, 1, 1, "Waiting for players 1/1 " + Dash + " run starts in 0:40")]
        [TestCase(3, 8, 3, "Waiting for players 3/8 " + Dash + " run starts in 0:40")]
        public void TheLobbyLineShowsPlayersOverTheMinimumTheRoomDelivered(int roster, int min, int expectedPlayers, string expected)
        {
            var rows = new WireRosterRow[roster];
            for (int i = 0; i < roster; i++) rows[i] = new WireRosterRow { Id = (uint)(i + 1), Name = "P" + (i + 1) };
            State(new ArenaState { Value = new WireArena { LobbyEndsAt = 45000, MinPlayers = (byte)min } }, new RosterState { Rows = rows });
            Snapshot(MatchPhase.Lobby, 5000);
            Assert.That(_session.State, Is.EqualTo(SessionState.InMatch));
            Assert.That(_session.Collections.Roster.Count, Is.EqualTo(expectedPlayers));
            Assert.That(PhaseStrip(), Is.EqualTo(expected), "hud.ts:44: players/min, countdown against Session.ServerTimeMs");
        }

        [Test]
        public void GUARD_ALobbyWithoutADeliveredMinimumKeepsTodaysLineWithoutASlash()
        {
            State(new ArenaState { Value = new WireArena { LobbyEndsAt = 45000, MinPlayers = 0 } },
                new RosterState { Rows = new[] { new WireRosterRow { Id = 1, Name = "P1" } } });
            Snapshot(MatchPhase.Lobby, 5000);
            Assert.That(PhaseStrip(), Is.EqualTo("Waiting for players 1 " + Dash + " run starts in 0:40"));
        }

        // ---- 2. the healing slot ----
        [Test]
        public void TheHealingSlotShowsTheCountAndTheSecondsLeftAndFollowsTheServerClock()
        {
            Snapshot(MatchPhase.Active, 1000);
            State(Inventory(2, 6000, null));
            Frame();
            Assert.That(HealStatus(), Is.EqualTo("Healing x2 5s"), "weaponBar.ts:147 against the accepted server clock");
            Snapshot(MatchPhase.Active, 5001);
            Frame();
            Assert.That(HealStatus(), Is.EqualTo("Healing x2 1s"), "the last second shows 1s: the countdown redraws with the clock, not only on a collections change");
            Snapshot(MatchPhase.Active, 6000);
            Frame();
            Assert.That(HealStatus(), Is.EqualTo(""), "a clock at the server time shows nothing");
        }

        [Test]
        public void TheHealingSlotDropsTheCountWhenOnePotionRuns()
        {
            Snapshot(MatchPhase.Active, 1000);
            State(Inventory(1, 6000, null));
            Frame();
            Assert.That(HealStatus(), Is.EqualTo("Healing 5s"), "no \"x1\"");
        }

        [Test]
        public void GUARD_AHealingCountWithoutADeliveredClockKeepsTodaysCountOnlyText()
        {
            Snapshot(MatchPhase.Active, 1000);
            State(Inventory(2, null, null));
            Frame();
            Assert.That(HealStatus(), Is.EqualTo("Healing x2"));
        }

        [Test]
        public void ARunningClockAllocatesNothingWhileTheSecondStays()
        {
            Snapshot(MatchPhase.Active, 1000);
            State(Inventory(2, 6000, 7000));
            var hints = (Action<InventoryView?>)Delegate.CreateDelegate(typeof(Action<InventoryView?>), _hud,
                typeof(MatchHud).GetMethod("UpdateInventoryHints", BindingFlags.Instance | BindingFlags.NonPublic));
            var inventory = _session.Collections.Inventory;
            for (int i = 0; i < 5; i++) hints(inventory);
            Assert.That(HealStatus(), Is.EqualTo("Healing x2 5s"), "(red today on the text; then the allocation check below)");
            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < 200; i++) hints(inventory);
            long grown = GC.GetAllocatedBytesForCurrentThread() - before;
            Assert.That(grown, Is.LessThanOrEqualTo(0), "200 frames with unchanged inputs and clock allocated " + grown + " bytes");
        }

        // ---- 3. the wind emblem ----
        [Test]
        public void TheWindEmblemShowsActiveSecondsAndFitsItsLabel()
        {
            Snapshot(MatchPhase.Active, 1000);
            State(Inventory(0, null, 6000));
            Frame();
            Assert.That(Wind(), Is.EqualTo("+50% speed " + Dot + " Active 5s"), "weaponBar.ts:146,148 against the accepted server clock");
            var label = (TMP_Text)GetField("_windText");
            Assert.That(label.enableAutoSizing || label.GetPreferredValues(label.text, 0f, 0f).x <= label.rectTransform.rect.width + .5f, Is.True,
                "the longer text fits the 100-unit label or the label fits it by auto-size (HudTextScaleEditModeTests lists only the old texts)");
            Snapshot(MatchPhase.Active, 5001);
            Frame();
            Assert.That(Wind(), Is.EqualTo("+50% speed " + Dot + " Active 1s"));
        }

        [Test]
        public void GUARD_TheWindEmblemReadsIdleWhenTheBoostHasEndedOrWasNeverDelivered()
        {
            Snapshot(MatchPhase.Active, 6000);
            State(Inventory(0, null, 6000));
            Frame();
            Assert.That(Wind(), Is.EqualTo("Walk over emblems"), "a clock at the server time reads idle");
            State(Inventory(0, null, null));
            Frame();
            Assert.That(Wind(), Is.EqualTo("Walk over emblems"), "an absent clock reads idle");
        }

        object GetField(string name) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
        void SetField(string name, object value) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value);
        void Invoke(string name, params object[] args) => typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, args.Length == 0 ? null : args);
    }
}
