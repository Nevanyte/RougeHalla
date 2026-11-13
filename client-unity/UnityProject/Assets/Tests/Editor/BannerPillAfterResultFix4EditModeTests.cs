using System;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>P-UNITY-HUD-VISUAL-FIX-4: only a stale Rejected pill is hidden after a result; a dropped connection still shows its notice.</summary>
    public sealed class BannerPillAfterResultFix4EditModeTests
    {
        sealed class DropTransport : ITransport
        {
            public event Action Opened; public event Action<byte[]> Received; public event Action<string> Closed;
            public void Connect(string url) { } public void Send(byte[] frame) { } public void Close() { } public void Poll() { }
            public void Open() { Opened?.Invoke(); }
            public void Deliver(ServerMsg m) { Received?.Invoke(m.Encode()); }
            public void Drop() { Closed?.Invoke("lost"); }
        }

        GameObject _canvas, _owner; MatchHud _hud; UiTheme _saved; Session _session;

        [SetUp]
        public void SetUp()
        {
            _saved = UiTheme.Current; UiTheme.Current = UiTheme.Placeholder();
            _canvas = new GameObject("fix4 banner canvas", typeof(RectTransform), typeof(Canvas));
            _owner = new GameObject("fix4 banner owner"); _hud = _owner.AddComponent<MatchHud>();
            Set("_root", _canvas.GetComponent<RectTransform>());
            Call("EnsureStage"); Call("CreateTopAndToastPills"); Call("CreateLegacyChrome"); Call("CreateCombatHud");
        }

        [TearDown]
        public void TearDown()
        {
            if (_session != null) _session.Leave();
            if (_canvas != null) UnityEngine.Object.DestroyImmediate(_canvas);
            if (_owner != null) UnityEngine.Object.DestroyImmediate(_owner);
            UiTheme.Current = _saved;
        }

        [Test]
        public void ADroppedConnectionAfterAResultStillShowsItsPill()
        {
            var t = new DropTransport();
            _session = new Session(t, new SessionOptions { Url = "ws://fix4/ws", Profile = "fix4", Now = () => 1000 });
            _session.Connect(); t.Open();
            t.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16], PlayerId = 1, TickRate = 20, ServerMs = 50, Map = new MapBlob(4, 4, new byte[16]) });
            t.Deliver(new ServerMsg.Events { Tick = 5, List = { new WireEvent { Kind = EventKind.Result, Result = new WireResult { Outcome = 2, Place = 1, Players = 1, KilledBy = "x", DurationSec = 8 } } } });
            t.Drop();
            Assert.That(_session.State == SessionState.Failed || _session.State == SessionState.Reconnecting, Is.True, "set-up");
            Assert.That(_session.LastResult != null, Is.True, "set-up");
            Set("_session", _session);
            Call("SyncTopCentre");
            Assert.That(((RectTransform)Get("_bannerPill")).gameObject.activeSelf, Is.True);
        }

        object Get(string n) => typeof(MatchHud).GetField(n, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
        void Set(string n, object v) => typeof(MatchHud).GetField(n, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, v);
        void Call(string n) => typeof(MatchHud).GetMethod(n, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, null);
    }
}
