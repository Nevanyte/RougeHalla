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
        public MatchHud Hud => _client.Hud;
        public void Initialize(Camera camera, string mode)
        {
            _camera = camera; _mode = mode;
            _transport = new LayoutTransport();
            _session = new Session(_transport, new SessionOptions { Url = "ws://127.0.0.1/layout-review", Profile = "Layout review", Now = () => Time.realtimeSinceStartupAsDouble * 1000 });
            _client = gameObject.AddComponent<MatchClient>(); _client.enabled = false;
            _client.Url = "ws://127.0.0.1/layout-review"; _client.Profile = "Layout review";
            _client.InitializeLayoutReview(_session);
            _session.Connect(); _transport.Open();
            var map = Map();
            _transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 1, TickRate = 20, Tick = _tick, ServerMs = _tick * 50, Map = map });
            var cards = new byte[80]; for (int i = 0; i < cards.Length; i++) cards[i] = 255;
            _transport.Deliver(new ServerMsg.State { Tick = _tick, Items = new StateItem[] {
                new InventoryState { Value = new WireInventory { Slot0 = 0, Slot1 = 1, ActiveSlot = 0, PotionSmall = 255, PotionLarge = 255, PotionsHealing = 255 } },
                new BuildState { Value = new WireBuild { Cards = cards, Boosts = new byte[] {255,255,255,255,255,255,255,255} } },
                new PropsState(), new CampsState(), new ProjectilesState(), new FieldsState(),
                new RewardChestsState { Rows = new [] { new WireRewardChest { Handle = new RewardChestHandle(1), X = 730, Y = 650, ExpiresAt = 100000,
                    CanChoose = true, Options = new [] { new WireRewardOption { Kind = 1, Id = 0 }, new WireRewardOption { Kind = 1, Id = 79 }, new WireRewardOption { Kind = 2, Id = 7 } } } } },
                new ArenaState { Value = new WireArena { RaidStartedAt = 5000, SuddenDeathAt = 90000, StartedWith = 8 } },
                new PlanState { Value = mode == "planning" ? new WirePlan { EndsAt = 95000, Spawn0 = 5, Spawn1 = 8, Pick = 0, Boon = 1,
                    Boons = new [] { "Guardian's resolve", "Wanderer's fortune" }, Option0 = new WirePlanOption { Index = 5, X = 1408, Y = 1408, Zone = 1 },
                    Option1 = new WirePlanOption { Index = 8, X = 4096, Y = 2560, Zone = 4 } } : null }
            } });
            PublishSnapshot();
            _arena = new GameObject("Offline layout terrain").AddComponent<ArenaView>(); _arena.Build(map);
            _client.Arena = _arena; _client.Cam = camera;
            if (mode == "map") Hud.TacticalMap.SetOpen(true);
            var label = MythicUi.Text(Hud.transform.Find("MatchUI"), "OfflineReviewLabel", "STAGED UI LAYOUT REVIEW · NO NETWORK", new Vector2(.25f, .86f), new Vector2(.75f, .92f), 26, ShowcasePalette.Gold);
            label.alignment = TMPro.TextAlignmentOptions.Center;
            _nextTick = Time.realtimeSinceStartupAsDouble;
        }
        public void SetTextScale(float scale)
        {
            ShowcaseSettings.Current.SetTextScale(scale);
        }
        void Update()
        {
            if (_session == null || _client.Session == null) return;
            if (Time.realtimeSinceStartupAsDouble >= _nextTick) { _tick++; PublishSnapshot(); _nextTick = Time.realtimeSinceStartupAsDouble + .05; }
            Hud.ReadUiInput(); _session.FlushInput();
            _session.Snapshots.Sample(_session.Snapshots.NewestMs, _actors);
            _arena.RefreshVisibility(_session); _arena.PresentCollections(_session.Collections);
            _arena.Present(_actors, _session.Me, _session.Motion, 0);
            var at = Hud.TacticalMap.IsPeeking ? Hud.TacticalMap.PeekAt : new Vector2(700, 650);
            _arena.Follow(_camera, at.x, at.y);
        }
        void PublishSnapshot()
        {
            var actors = new WireActor[7];
            for (int i = 0; i < actors.Length; i++) actors[i] = new WireActor { Id = (uint)(i + 2), X = 450 + (i % 4) * 150, Y = 520 + (i / 4) * 250,
                Faction = (byte)(i % 5), Weapon = (byte)(i % 5), Kind = 0, Status = 1, HpPct = 100 };
            _transport.Deliver(new ServerMsg.Snapshot { Tick = _tick, Phase = (byte)(_mode == "planning" ? 0 : 1), Actors = actors,
                Me = new WireSelf { Id = 1, Faction = 4, X = 700, Y = 650, Hp = 99999, MaxHp = 99999, Barrier = 99999, Kills = ushort.MaxValue, Gv = ushort.MaxValue, Weapon = 0, Status = 1,
                    Wish = new WireWishOwner { Ability = 4, MaxCharges = 2, Charges = 1, ReadyAt = 6000, RechargeMs = 45000, NextChargeAt = 51000, FullAt = 96000 } } });
        }
        static MapBlob Map()
        {
            const int w = 48, h = 36; var tiles = new byte[w * h];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
                if (x == 0 || y == 0 || x == w - 1 || y == h - 1 || (x == 12 || x == 32) && y % 12 > 4) tiles[y * w + x] = MapBlob.Wall;
            return new MapBlob(w, h, tiles);
        }
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
