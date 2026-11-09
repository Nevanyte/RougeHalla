#if UNITY_EDITOR || DEVELOPMENT_BUILD
using System;
using System.Collections.Generic;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Explicit offline layout fixture. It does not open sockets or certify gameplay/server behavior.</summary>
    public sealed class UiLayoutReview : MonoBehaviour
    {
        readonly List<InterpActor> _actors = new List<InterpActor>();
        Session _session;
        MatchClient _client;
        ArenaView _arena;
        Camera _camera;
        LayoutTransport _transport;
        string _mode;
        uint _tick = 100;
        double _nextTick;
        bool _initialized;
        public bool IsReady => _initialized;
        public MatchHud Hud => _client.Hud;
        public void Initialize(Camera camera, string mode)
        {
            if (_session != null) throw new InvalidOperationException("Layout review is already initialized.");
            if (camera == null) throw new ArgumentNullException(nameof(camera));
            if (mode != "hud" && mode != "planning" && mode != "map") throw new ArgumentException("Unknown layout review mode.", nameof(mode));
            enabled = false;
            _camera = camera; _mode = mode;
            _transport = new LayoutTransport();
            _session = new Session(_transport, new SessionOptions { Url = "ws://127.0.0.1/layout-review", Profile = "Layout review", Now = () => Time.realtimeSinceStartupAsDouble * 1000 });
            _client = gameObject.AddComponent<MatchClient>(); _client.enabled = false;
            _client.Url = "ws://127.0.0.1/layout-review"; _client.Profile = "Layout review";
            _client.InitializeLayoutReview(_session);
            _session.Connect(); _transport.Open();
            var map = UiLayoutReviewFrames.Map();
            _transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 1, TickRate = 20, Tick = _tick, ServerMs = _tick * 50, Map = map });
            _transport.Deliver(UiLayoutReviewFrames.State(mode, _tick));
            PublishSnapshot();
            _arena = new GameObject("Offline layout terrain").AddComponent<ArenaView>(); _arena.Build(map);
            _client.Arena = _arena; _client.Cam = camera;
            if (mode == "map") Hud.TacticalMap.SetOpen(true);
            var connection = Hud.transform.Find("MatchUI/Connection"); if (connection != null) connection.gameObject.SetActive(false);
            var label = MythicUi.Text(Hud.transform.Find("MatchUI"), "OfflineReviewLabel", "STAGED UI REVIEW\nNO NETWORK", new Vector2(.02f, .92f), new Vector2(.30f, .995f), 14, ShowcasePalette.Gold);
            label.alignment = TMPro.TextAlignmentOptions.Center;
            _nextTick = Time.realtimeSinceStartupAsDouble;
            _initialized = true; enabled = true;
        }
        public void SetTextScale(float scale)
        {
            ShowcaseSettings.Current.SetTextScale(scale);
        }
        void Update()
        {
            if (!_initialized) return;
            if (Time.realtimeSinceStartupAsDouble >= _nextTick) { _tick++; PublishSnapshot(); _nextTick = Time.realtimeSinceStartupAsDouble + .05; }
            Hud.ReadUiInput(); _session.FlushInput();
            _session.Snapshots.Sample(_session.Snapshots.NewestMs, _actors);
            _arena.RefreshVisibility(_session); _arena.PresentCollections(_session.Collections);
            _arena.Present(_actors, _session.Me, _session.Motion, 0);
            var at = Hud.TacticalMap.IsPeeking ? Hud.TacticalMap.PeekAt : new Vector2(700, 650);
            _arena.Follow(_camera, at.x, at.y);
        }
        void PublishSnapshot() => _transport.Deliver(UiLayoutReviewFrames.Snapshot(_mode, _tick));
        void OnDestroy() { _session?.Leave(); if (_arena != null) Destroy(_arena.gameObject); }
        sealed class LayoutTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed { add { } remove { } }
            public void Open() => Opened?.Invoke();
            public void Deliver(ServerMsg message) => Received?.Invoke(message.Encode());
            public void Connect(string url) { }
            public void Send(byte[] frame) { }
            public void Close() { }
            public void Poll() { }
        }
    }
}
#endif
