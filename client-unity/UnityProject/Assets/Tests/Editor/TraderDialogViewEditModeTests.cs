using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class TraderDialogViewEditModeTests
    {
        GameObject _canvas, _host;
        TraderDialogView _view;
        TestTransport _transport;
        Session _session;
        double _now = 1000;

        [SetUp]
        public void SetUp()
        {
            _canvas = new GameObject("Trader canvas", typeof(RectTransform), typeof(Canvas), typeof(UnityEngine.UI.CanvasScaler), typeof(UnityEngine.UI.GraphicRaycaster));
            _host = new GameObject("Trader view host");
            _view = _host.AddComponent<TraderDialogView>();
            _view.Initialize(_canvas.transform);
            _transport = new TestTransport();
            _session = NewSession(_transport, 1);
            _transport.Sent.Clear();
            _view.Bind(_session);
        }

        [TearDown]
        public void TearDown()
        {
            if (_session != null) _session.Leave();
            UnityEngine.Object.DestroyImmediate(_host);
            UnityEngine.Object.DestroyImmediate(_canvas);
        }

        [Test]
        public void MissingUnavailableAndAvailableEmptyTradeViewsStayDistinctAndOpeningIsReadOnly()
        {
            _view.SetVisible(true);
            Assert.IsNull(_session.Collections.Trade);
            Assert.That(_canvas.transform.Find("TraderDialog/Status").GetComponent<TMP_Text>().text, Does.Contain("awaiting trade view"));
            _session.Update();
            Assert.AreEqual(0, InputMessages().SelectMany(x => x.Commands).Count(c => c.Kind == CommandKind.Trade));

            DeliverTrade(Unavailable());
            _view.Refresh();
            Assert.IsFalse(_session.Collections.Trade.Available);
            Assert.AreEqual(0, _view.MerchantCount);
            Assert.That(_canvas.transform.Find("TraderDialog/Status").GetComponent<TMP_Text>().text, Does.Contain("unavailable"));

            DeliverTrade(Available());
            _view.Refresh();
            Assert.IsTrue(_session.Collections.Trade.Available);
            Assert.AreEqual(0, _session.Collections.Trade.Merchants.Count);
            Assert.That(_canvas.transform.Find("TraderDialog/Status").GetComponent<TMP_Text>().text, Does.Contain("no visible merchants"));
            Assert.AreEqual(0, InputMessages().SelectMany(x => x.Commands).Count(c => c.Kind == CommandKind.Trade));
        }

        [Test]
        public void DuplicateMerchantRowsLabelsAndSignedStatDeltasRenderInSourceOrder()
        {
            var value = Available(
                merchants: new[]
                {
                    new WireMerchant { Kind = TradeKind.Stats, X = 31.25, Y = 44.5, Name = "The Ledger" },
                    new WireMerchant { Kind = TradeKind.Stats, X = 91.75, Y = 44.5, Name = "The Ledger" }
                },
                offers: new[]
                {
                    new WireTradeOffer { Cost = TradeStat.Ad, CostValue = .25, Gain = TradeStat.Ap, GainValue = .5, Label = "Same offer" },
                    new WireTradeOffer { Cost = TradeStat.Ad, CostValue = .25, Gain = TradeStat.Ap, GainValue = .5, Label = "Same offer" },
                    new WireTradeOffer { Cost = TradeStat.Shield, CostValue = 2, Gain = TradeStat.MaxHp, GainValue = 10, Label = "Third offer" }
                },
                stats: new[]
                {
                    new WireTradeDelta { Stat = TradeStat.Ad, Value = -1.25 },
                    new WireTradeDelta { Stat = TradeStat.Ad, Value = .5 },
                    new WireTradeDelta { Stat = TradeStat.MaxHp, Value = -12 }
                });
            value.BarterLabels = new[] { "Potion", "Potion", "Leave empty handed" };
            DeliverTrade(value); _view.Refresh(); _view.SetVisible(true);

            Assert.AreEqual(2, _view.MerchantCount, "same-kind and same-name merchant rows remain distinct");
            Assert.IsTrue(_view.SelectMerchant(0));
            Assert.AreEqual(3, _view.ChoiceCount);
            Assert.That(ChoiceLabel(0).text, Does.Contain("Same offer"));
            Assert.That(ChoiceLabel(1).text, Does.Contain("Same offer"));
            Assert.That(ChoiceLabel(2).text, Does.Contain("Third offer"));
            Assert.That(ChoiceLabel(0).text, Does.Contain("Costs 0.25 AD  ·  Gives 0.5 AP"));
            Assert.AreEqual("AD  -1.25", ChoiceContent().Find("AppliedStat_0").GetComponent<TMP_Text>().text);
            Assert.AreEqual("AD  0.5", ChoiceContent().Find("AppliedStat_1").GetComponent<TMP_Text>().text);
            Assert.AreEqual("max HP  -12", ChoiceContent().Find("AppliedStat_2").GetComponent<TMP_Text>().text);

            Assert.IsTrue(_view.SelectMerchant(1));
            StringAssert.Contains("Choose one permanent exchange for this run", _canvas.transform.Find("TraderDialog/OfferPanel/DetailSummary").GetComponent<TMP_Text>().text);
        }

        [Test]
        public void StatUsedBlocksOnlyStatTradeWhileBarterPicksAreSentAsOrdinaryInput()
        {
            var value = Available(
                merchants: new[]
                {
                    new WireMerchant { Kind = TradeKind.Barter, X = 10, Y = 12, Name = "The Villager" },
                    new WireMerchant { Kind = TradeKind.Stats, X = 14, Y = 16, Name = "The Ledger" }
                }, offers: new[]
                {
                    new WireTradeOffer { Cost = TradeStat.Ad, CostValue = 1, Gain = TradeStat.Ap, GainValue = 1, Label = "Costly bargain" }
                });
            value.TradeUsed = true;
            value.BarterLabels = new[] { "Potion", "Potion", "Empty hand" };
            DeliverTrade(value); _view.Refresh(); _view.SetVisible(true);

            Assert.IsTrue(_view.SelectMerchant(1));
            Assert.IsFalse(_view.TryTrade(TradeKind.Stats, 0), "the server's used-stat fact applies to Stats only");
            Assert.IsTrue(_view.SelectMerchant(0));
            Assert.IsTrue(_view.TryTrade(TradeKind.Barter, 2), "TradeUsed does not disable barter");
            _session.FlushInput();
            var trade = InputMessages().SelectMany(x => x.Commands).Single(c => c.Kind == CommandKind.Trade);
            Assert.AreEqual(TradeKind.Barter, trade.TradeKind);
            Assert.AreEqual(2, trade.Pick);

            int before = _transport.Sent.Count;
            _transport.Deliver(new ServerMsg.Events { Tick = 2, List = new List<WireEvent> {
                new WireEvent { Kind = EventKind.Result, Result = new WireResult { Place = 1, Players = 2 } } } });
            Assert.AreEqual(SessionState.InMatch, _session.State, "Result may precede MatchEnded");
            Assert.IsFalse(_view.TryTrade(TradeKind.Barter, 0), "a current result blocks new spending before the next UI refresh");
            _view.Refresh();
            Assert.IsFalse(ChoiceContent().Find("Choice_0").GetComponent<UnityEngine.UI.Button>().interactable);
            _session.FlushInput(); Assert.AreEqual(before, _transport.Sent.Count);
        }

        [Test]
        public void CurrentOptionsQueueEveryOrdinaryStatPickAndMetadataReplacementInvalidatesOldCallbacks()
        {
            var value = Available(merchants: new[] { new WireMerchant { Kind = TradeKind.Stats, X = 20, Y = 30, Name = "The Ledger" } }, offers: new[]
            {
                new WireTradeOffer { Cost = TradeStat.Ad, CostValue = .1, Gain = TradeStat.Ap, GainValue = .2, Label = "One" },
                new WireTradeOffer { Cost = TradeStat.Ad, CostValue = .2, Gain = TradeStat.Ap, GainValue = .3, Label = "Two" },
                new WireTradeOffer { Cost = TradeStat.Ad, CostValue = .3, Gain = TradeStat.Ap, GainValue = .4, Label = "Three" }
            });
            DeliverTrade(value); _view.Refresh(); _view.SetVisible(true); _view.SelectMerchant(0);

            var oldView = _session.Collections.Trade;
            int oldGeneration = (int)typeof(TraderDialogView).GetField("_renderGeneration", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_view);
            Assert.IsTrue(_view.TryTrade(TradeKind.Stats, 1));
            _session.FlushInput();
            var first = InputMessages().SelectMany(x => x.Commands).Last(c => c.Kind == CommandKind.Trade);
            Assert.AreEqual(1, first.Pick);

            DeliverTrade(value);
            _view.Refresh();
            var stale = typeof(TraderDialogView).GetMethod("TryTradeBound", BindingFlags.Instance | BindingFlags.NonPublic);
            bool staleAccepted = (bool)stale.Invoke(_view, new object[] { _session, _session.TimelineEpoch, oldView, oldGeneration, 0, TradeKind.Stats, (byte)2 });
            Assert.IsFalse(staleAccepted, "a callback from the replaced TradeView cannot submit using new rows");

            for (byte pick = 0; pick < 3; pick++)
            {
                if (pick > 0) { DeliverTrade(value); _view.Refresh(); }
                Assert.IsTrue(_view.TryTrade(TradeKind.Stats, pick));
                _session.FlushInput();
                var current = InputMessages().SelectMany(x => x.Commands).Last(c => c.Kind == CommandKind.Trade);
                Assert.AreEqual(TradeKind.Stats, current.TradeKind);
                Assert.AreEqual(pick, current.Pick);
            }
        }

        [Test]
        public void DisconnectAndResumedWelcomeInvalidateOldRowsAndDropQueuedTradeInput()
        {
            DeliverTrade(Available(merchants: new[] { new WireMerchant { Kind = TradeKind.Barter, X = 1, Y = 2, Name = "The Villager" } }));
            _view.Refresh(); _view.SetVisible(true);
            Assert.IsTrue(_view.TryTrade(TradeKind.Barter, 0)); // Still queued in InputSender when the socket drops.

            _transport.Drop();
            _view.Refresh();
            Assert.AreEqual(SessionState.Reconnecting, _session.State);
            Assert.IsFalse(_view.TryTrade(TradeKind.Barter, 1));

            _now += 500;
            _session.Poll();
            Assert.AreEqual(SessionState.HelloSent, _session.State);
            _transport.Deliver(Welcome(2));
            _view.Refresh();
            Assert.IsNull(_session.Collections.Trade, "Welcome resets the collection before new State arrives");
            Assert.AreEqual(0, _view.MerchantCount, "old merchant rows must leave the resumed presentation");
            Assert.AreEqual(0, _view.ChoiceCount, "old choices must leave the resumed presentation");
            Assert.AreEqual(-1, _view.SelectedMerchantIndex);
            Assert.IsFalse(_canvas.GetComponentsInChildren<TMP_Text>().Any(x => x.text.Contains("The Villager")),
                "an unseen view must not retain old merchant text");
            Assert.IsFalse(_view.TryTrade(TradeKind.Barter, 0));
            _session.FlushInput();
            Assert.AreEqual(0, InputMessages().SelectMany(x => x.Commands).Count(c => c.Kind == CommandKind.Trade),
                "queued command from the prior timeline is cleared by Welcome");
        }

        [Test]
        public void RebindingAnUnseenSessionClearsMerchantChoicesAndPendingCopyImmediately()
        {
            DeliverTrade(Available(merchants: new[] { new WireMerchant { Kind = TradeKind.Barter, X = 1, Y = 2, Name = "Old merchant" } }));
            _view.Refresh(); _view.SetVisible(true);
            Assert.IsTrue(_view.TryTrade(TradeKind.Barter, 0));
            Assert.AreEqual(3, _view.ChoiceCount);
            var nextTransport = new TestTransport();
            var next = NewSession(nextTransport, 2);
            try
            {
                _view.Bind(next);
                Assert.IsNull(next.Collections.Trade);
                Assert.AreEqual(0, _view.MerchantCount);
                Assert.AreEqual(0, _view.ChoiceCount);
                Assert.AreEqual(-1, _view.SelectedMerchantIndex);
                Assert.IsFalse(_canvas.GetComponentsInChildren<TMP_Text>().Any(x => x.text.Contains("Old merchant")));
                StringAssert.Contains("awaiting trade view", _canvas.transform.Find("TraderDialog/Status").GetComponent<TMP_Text>().text);
                Assert.IsFalse(_view.TryTrade(TradeKind.Barter, 1));
                next.FlushInput();
                Assert.IsFalse(nextTransport.Sent.Where(x => x.Length > 0 && x[0] == 2)
                    .Select(x => ClientMsg.Decode(x)).OfType<ClientMsg.Input>().Any());
            }
            finally { _view.Bind(_session); next.Leave(); }
        }

        TMP_Text ChoiceLabel(int index) => ChoiceContent().Find("Choice_" + index + "/Label").GetComponent<TMP_Text>();
        RectTransform ChoiceContent() => (RectTransform)_canvas.transform.Find("TraderDialog/OfferPanel/ChoiceScroll/Viewport/Content");

        void DeliverTrade(WireTradeView view)
        {
            DeliverTrade(new TradeState { Available = true, Value = view });
        }

        void DeliverTrade(TradeState state)
        {
            _transport.Deliver(new ServerMsg.State { Tick = 1, Items = new StateItem[] { state } });
        }

        static TradeState Unavailable() => new TradeState { Available = false, Value = null };
        static WireTradeView Available(WireMerchant[] merchants = null, WireTradeOffer[] offers = null, WireTradeDelta[] stats = null)
        {
            return new WireTradeView
            {
                Merchants = merchants ?? Array.Empty<WireMerchant>(), Offers = offers ?? Array.Empty<WireTradeOffer>(),
                Stats = stats ?? Array.Empty<WireTradeDelta>(), BarterLabels = new[] { "One", "Two", "Three" }
            };
        }

        Session NewSession(TestTransport transport, byte matchId)
        {
            var session = new Session(transport, new SessionOptions { Url = "ws://fixture/ws", Profile = "trader-test", Now = () => _now, ReconnectBaseMs = 500 });
            session.Connect();
            transport.Deliver(Welcome(matchId));
            return session;
        }

        static ServerMsg.Welcome Welcome(byte matchId)
        {
            var id = new byte[16]; id[0] = matchId;
            return new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = id, Session = new byte[16], PlayerId = 1,
                TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) };
        }

        IEnumerable<ClientMsg.Input> InputMessages()
        {
            foreach (var frame in _transport.Sent)
            {
                ClientMsg decoded;
                try { decoded = ClientMsg.Decode(frame); }
                catch (DecodeException) { continue; }
                var input = decoded as ClientMsg.Input;
                if (input != null) yield return input;
            }
        }

        sealed class TestTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public readonly List<byte[]> Sent = new List<byte[]>();
            public void Connect(string url) { Opened?.Invoke(); }
            public void Send(byte[] frame) { Sent.Add(frame); }
            public void Close() { }
            public void Poll() { }
            public void Deliver(ServerMsg msg) { Received?.Invoke(msg.Encode()); }
            public void Drop() { Closed?.Invoke("fixture disconnect"); }
        }
    }
}
