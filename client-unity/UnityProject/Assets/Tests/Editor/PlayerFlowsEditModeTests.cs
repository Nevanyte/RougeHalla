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
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;

namespace Roguehalla.Client.Tests
{
    /// <summary>Decoded Session integration; rendered hits and browser authority are separate gates.</summary>
    public sealed class PlayerFlowsEditModeTests
    {
        sealed class Transport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public readonly List<byte[]> Sent = new List<byte[]>();
            public void Connect(string url) { }
            public void Send(byte[] frame) => Sent.Add(frame);
            public void Close() => Closed?.Invoke("closed");
            public void Poll() { }
            public void Open() => Opened?.Invoke();
            public void Deliver(ServerMsg message) => Received?.Invoke(message.Encode());
            public void Raw(byte[] frame) => Received?.Invoke(frame);
            public void Drop() => Closed?.Invoke("fixture disconnect");
            public List<ClientMsg.Input> Inputs() => Sent.Where(x => x.Length > 0 && x[0] == 2).Select(x => ClientMsg.Decode(x)).OfType<ClientMsg.Input>().ToList();
        }
        GameObject _root, _events;
        EventSystem _priorEvents;
        MatchClient _client;
        MatchHud _hud;
        Session _session;
        Transport _transport;

        [SetUp]
        public void SetUp()
        {
            _priorEvents = EventSystem.current;
            _events = new GameObject("Player flow events", typeof(UiInputRoutingEventSystem));
            var system = _events.GetComponent<UiInputRoutingEventSystem>(); system.enabled = false; system.enabled = true;
            EventSystem.current = system;
            _root = new GameObject("Player flow fixture");
            _client = _root.AddComponent<MatchClient>(); _client.enabled = false;
            _transport = new Transport();
            _session = new Session(_transport, new SessionOptions { Url = "ws://flows/ws", Profile = "flows", Now = () => 1000 });
            Invoke(_client, "InitializeLayoutReview", _session); _hud = _client.Hud;
            _session.Connect(); _transport.Open(); Welcome();
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 1, ServerTimeOverrideMs = 50, Phase = 1,
                Me = new WireSelf { Id = 1, X = 64, Y = 64, Hp = 100, MaxHp = 100, Status = 1, Weapon = 0 } });
            _transport.Sent.Clear();
        }
        [TearDown]
        public void TearDown()
        {
            if (_root != null) UnityEngine.Object.DestroyImmediate(_root);
            if (_events != null) UnityEngine.Object.DestroyImmediate(_events);
            if (_priorEvents != null) EventSystem.current = _priorEvents;
        }
        void Welcome() => _transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16],
            Session = new byte[16], PlayerId = 1, TickRate = 20, ServerMs = 50, Map = new MapBlob(32, 32, new byte[1024]) });

        [Test]
        public void ReceivedNoticeOrderIncludesDuplicatesAndResumeClearsBeforeNewBatch()
        {
            _transport.Deliver(new ServerMsg.Events { Tick = 2, List = new List<WireEvent> {
                new WireEvent { Kind = EventKind.Toast, ToastText = "same <literal>" },
                new WireEvent { Kind = EventKind.PickupRefused, PickupReason = 1 },
                new WireEvent { Kind = EventKind.Toast, ToastText = "same <literal>" } } });
            _transport.Deliver(new ServerMsg.Events { Tick = 2, List = new List<WireEvent> {
                new WireEvent { Kind = EventKind.Toast, ToastText = "same <literal>" },
                new WireEvent { Kind = EventKind.Toast, ToastText = "" } } });
            CollectionAssert.AreEqual(new[] { "same <literal>", "Pickup refused by server (1)", "same <literal>", "same <literal>", "" },
                _hud.ServerNotices.Entries.Select(x => x.Text).ToArray());
            _hud.ShowPlayerFlow(2);
            var text = _hud.ServerNotices.Root.Find("History/Viewport/Content").GetComponent<TMP_Text>();
            Assert.IsFalse(text.richText);
            StringAssert.Contains("1 · same <literal>", text.text); StringAssert.Contains("5 · ", text.text);
            _session.Input.QuestAccept(new QuestHandle(71));
            _transport.Drop(); Assert.AreEqual(SessionState.Reconnecting, _session.State);
            _transport.Open(); Welcome();
            Assert.IsNull(_session.Collections.Quests); Assert.IsNull(_session.Collections.Trade);
            Assert.AreEqual(0, _hud.ServerNotices.Entries.Count);
            _transport.Deliver(new ServerMsg.Events { Tick = 1, List = new List<WireEvent> {
                new WireEvent { Kind = EventKind.Toast, ToastText = "new epoch" } } });
            Invoke(_hud, "TickPlayerFlows");
            Assert.AreEqual("new epoch", _hud.ServerNotices.Entries.Single().Text,
                "the first post-Welcome batch must not be erased by a later UI tick");
            _session.FlushInput(); Assert.AreEqual(0, _transport.Inputs().Count, "old accept must not cross the resumed Welcome");
        }

        [Test]
        public void InFlightOldSessionNoticeCallbackCannotAppendAfterRebind()
        {
            _hud.ShowMenu();
            var otherTransport = new Transport();
            var other = new Session(otherTransport, new SessionOptions { Url = "ws://flows/ws", Profile = "other", Now = () => 1000 });
            other.Connect(); otherTransport.Open();
            otherTransport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16],
                Session = new byte[16], PlayerId = 2, TickRate = 20, Map = new MapBlob(32, 32, new byte[1024]) });
            Action<ServerMsg.Events> rebind = batch => _hud.Bind(other);
            try
            {
                _session.EventsReceived += rebind;
                _hud.Bind(_session); // Put the rebind callback before the HUD listener in the old invocation list.
                _transport.Deliver(new ServerMsg.Events { Tick = 2, List = new List<WireEvent> {
                    new WireEvent { Kind = EventKind.Toast, ToastText = "old session" } } });
                Assert.AreEqual(0, _hud.ServerNotices.Entries.Count);
                otherTransport.Deliver(new ServerMsg.Events { Tick = 1, List = new List<WireEvent> {
                    new WireEvent { Kind = EventKind.Toast, ToastText = "current session" } } });
                Assert.AreEqual("current session", _hud.ServerNotices.Entries.Single().Text);
            }
            finally { _session.EventsReceived -= rebind; _hud.Bind(_session); other.Leave(); }
        }

        [Test]
        public void InFlightSameSessionNoticeCallbackCannotCrossSourceClockCutAndNewEpochKeepsDuplicates()
        {
            _hud.ShowMenu();
            bool cutArmed = false;
            Action<ServerMsg.Events> cut = batch =>
            {
                if (!cutArmed) return;
                cutArmed = false;
                // A later authoritative tick with equal source time starts a new timeline.
                // This decoded snapshot arrives before the old HUD callback in the invocation list.
                _transport.Deliver(new ServerMsg.Snapshot { Tick = 2, ServerTimeOverrideMs = 50, Phase = 1,
                    Me = new WireSelf { Id = 1, X = 64, Y = 64, Hp = 100, MaxHp = 100, Status = 1, Weapon = 0 } });
            };
            try
            {
                _session.EventsReceived += cut;
                _hud.Bind(_session);
                uint epoch = _session.TimelineEpoch;
                _transport.Deliver(new ServerMsg.Events { Tick = 1, List = new List<WireEvent> {
                    new WireEvent { Kind = EventKind.Toast, ToastText = "before cut" } } });
                Assert.AreEqual("before cut", _hud.ServerNotices.Entries.Single().Text);
                cutArmed = true;
                _transport.Deliver(new ServerMsg.Events { Tick = 1, List = new List<WireEvent> {
                    new WireEvent { Kind = EventKind.Toast, ToastText = "old in flight" },
                    new WireEvent { Kind = EventKind.Toast, ToastText = "old in flight" } } });
                Assert.AreEqual(epoch + 1, _session.TimelineEpoch, "the encoded snapshot must cause a real Session source-clock cut");
                Assert.AreEqual(SessionState.InMatch, _session.State);
                Assert.AreEqual(0, _hud.ServerNotices.Entries.Count, "the old invocation cannot repopulate the cleared new epoch");
                _transport.Deliver(new ServerMsg.Events { Tick = 2, List = new List<WireEvent> {
                    new WireEvent { Kind = EventKind.Toast, ToastText = "fresh" },
                    new WireEvent { Kind = EventKind.PickupRefused, PickupReason = 1 },
                    new WireEvent { Kind = EventKind.Toast, ToastText = "fresh" } } });
                _transport.Deliver(new ServerMsg.Events { Tick = 2, List = new List<WireEvent> {
                    new WireEvent { Kind = EventKind.Toast, ToastText = "fresh" } } });
                Invoke(_hud, "TickPlayerFlows");
                CollectionAssert.AreEqual(new[] { "fresh", "Pickup refused by server (1)", "fresh", "fresh" },
                    _hud.ServerNotices.Entries.Select(x => x.Text).ToArray(),
                    "the rotated listener must accept every subsequent notice in order, including duplicates");
            }
            finally { _session.EventsReceived -= cut; }
        }

        [Test]
        public void OrdinaryMixedQuestTradeQueueSplitsAtSixteenWithoutUiGeneratedCommands()
        {
            _hud.ShowPlayerFlow(1); _session.FlushInput();
            Assert.AreEqual(0, _transport.Inputs().Count, "opening the trader must never roll or spend");
            for (int i = 0; i < 17; i++)
                if (i % 2 == 0) _session.Input.QuestAccept(new QuestHandle((uint)i + 1));
                else _session.Input.Trade(TradeKind.Barter, (byte)(i % 3));
            _session.FlushInput();
            var inputs = _transport.Inputs(); Assert.AreEqual(2, inputs.Count);
            Assert.AreEqual(16, inputs[0].Commands.Count); Assert.AreEqual(1, inputs[1].Commands.Count);
            var commands = inputs.SelectMany(x => x.Commands).ToArray();
            for (int i = 0; i < commands.Length; i++)
            {
                Assert.AreEqual(i % 2 == 0 ? CommandKind.QuestAccept : CommandKind.Trade, commands[i].Kind);
                if (i % 2 == 0) Assert.AreEqual((uint)i + 1, commands[i].QuestRef.Value);
                else { Assert.AreEqual(TradeKind.Barter, commands[i].TradeKind); Assert.AreEqual(i % 3, commands[i].Pick); }
            }
        }

        [Test]
        public void DeliveredMapPointsReplaceWithoutActorFabricationOrNameDeduplication()
        {
            var handle = new QuestHandle(71);
            _transport.Deliver(new ServerMsg.State { Tick = 2, Items = new StateItem[] {
                QuestState(handle), new TradeState { Available = true, Value = new WireTradeView { Merchants = new[] {
                    new WireMerchant { Kind = TradeKind.Barter, X = 100, Y = 100, Name = "same" },
                    new WireMerchant { Kind = TradeKind.Barter, X = 140, Y = 100, Name = "same" } } } } } });
            _hud.TacticalMap.SetTrackedQuest(handle);
            var marks = _hud.GetComponentsInChildren<TacticalMapMarks>(true);
            Assert.AreEqual(2, marks.Length);
            foreach (var mark in marks)
            { Assert.AreEqual(2, mark.MerchantCount); Assert.AreEqual(1, mark.QuestGiverCount); Assert.AreEqual(1, mark.QuestObjectiveCount); }
            _transport.Deliver(new ServerMsg.State { Tick = 2, Items = new StateItem[] {
                new QuestsState { Available = true, View = new WireQuestView() },
                new TradeState { Available = true, Value = new WireTradeView() } } });
            foreach (var mark in marks)
            { Assert.AreEqual(0, mark.MerchantCount); Assert.AreEqual(0, mark.QuestGiverCount); Assert.AreEqual(0, mark.QuestObjectiveCount); }
            _transport.Deliver(new ServerMsg.State { Tick = 3, Items = new StateItem[] { QuestState(handle) } });
            _transport.Drop();
            foreach (var mark in marks) Assert.AreEqual(0, mark.QuestGiverCount, "disconnect removes current point cues immediately");
            Assert.AreEqual(0, _root.GetComponentsInChildren<SpriteRenderer>(true).Count(x => x.name == "Observed merchant"));
        }

        [Test]
        public void MalformedFrameRetainsCanonicalViewButInvalidQuestItemReferenceFailsAndDisablesActions()
        {
            var handle = new QuestHandle(71);
            _transport.Deliver(new ServerMsg.State { Tick = 2, Items = new StateItem[] { QuestState(handle) } });
            var held = _session.Collections.Quests;
            _transport.Raw(new byte[] { 0x88, 3, 1, 11, 2 });
            Assert.AreSame(held, _session.Collections.Quests); Assert.AreEqual(SessionState.InMatch, _session.State);
            Assert.Greater(_session.DecodeErrors, 0);
            _transport.Deliver(new ServerMsg.State { Tick = 3, Items = new StateItem[] { new PropsState { Rows = new[] {
                new WireProp { Handle = new PickupHandle(8), X = 64, Y = 64, Kind = PropKind.QuestItem, QuestRef = new QuestHandle(99) } } } } });
            Assert.AreEqual(SessionState.Failed, _session.State);
            StringAssert.Contains("bad server collection state", _session.Error);
            Assert.IsFalse(_hud.QuestJournal.TryAccept(handle));
        }

        [Test]
        public void JournalKeyboardOwnsSimultaneousMapAndWorldKeysAndRespectsExistingModals()
        {
            WithKeyboard(keyboard =>
            {
                Assert.IsTrue(_session.Motion.Initialized, "world-input reader must be active for this test");
                InputSystem.QueueStateEvent(keyboard, new KeyboardState(Key.J, Key.Tab, Key.W, Key.Digit1, Key.F)); InputSystem.Update();
                Assert.IsTrue(keyboard.jKey.wasPressedThisFrame);
                _hud.ReadUiInput(); Invoke(_client, "ReadInput"); _session.FlushInput();
                Assert.IsTrue(_hud.QuestJournal.IsVisible); Assert.IsFalse(_hud.TacticalMap.IsOpen);
                Assert.IsTrue(_hud.BlocksKeyboardInput); Assert.IsTrue(_hud.BlocksPointerInput);
                Assert.AreEqual(0, _transport.Inputs().Count, "journal focus must not leak movement, weapon or pickup actions");
                foreach (string name in new[] { "Help", "Settings", "Leave", "Journal" })
                    Assert.IsFalse(_hud.transform.Find("MatchUI/" + name).gameObject.activeSelf);
                InputSystem.QueueStateEvent(keyboard, new KeyboardState()); InputSystem.Update();
                InputSystem.QueueStateEvent(keyboard, new KeyboardState(Key.Escape)); InputSystem.Update(); _hud.ReadUiInput();
                Assert.IsFalse(_hud.QuestJournal.IsVisible);
                Assert.IsTrue(_hud.transform.Find("MatchUI/Journal").gameObject.activeSelf);
                Invoke(_hud, "ToggleSettings"); _hud.ShowPlayerFlow(0);
                Assert.IsFalse(_hud.QuestJournal.IsVisible, "the launcher cannot stack a flow over settings");
            });
        }

        [Test]
        public void PlanningQuestReviewPreservesMapChoicesAndFocusWhileBlockingOtherPagesAndWorldKeys()
        {
            _hud.ShowPlayerFlow(1); Assert.IsTrue(_hud.TraderDialog.IsVisible);
            DeliverPlanning(new QuestHandle(71));
            Assert.IsFalse(_hud.TraderDialog.IsVisible, "entering planning closes a previously open trader");
            var plan = _session.Collections.Plan;
            var map = _hud.transform.Find("MatchUI/TacticalMap");
            var ready = map.Find("PlanningDecisions/Ready").GetComponent<UnityEngine.UI.Button>();
            string readyText = ready.GetComponentInChildren<TMP_Text>().text;
            Assert.IsTrue(ready.IsInteractable());
            EventSystem.current.SetSelectedGameObject(ready.gameObject);
            WithKeyboard(keyboard =>
            {
                InputSystem.QueueStateEvent(keyboard, new KeyboardState(Key.J, Key.Tab, Key.Digit1, Key.W, Key.F)); InputSystem.Update();
                _hud.ReadUiInput(); Invoke(_client, "ReadInput"); _session.FlushInput();
                Assert.IsTrue(_hud.QuestJournal.IsVisible); Assert.IsTrue(_hud.TacticalMap.IsOpen);
                Assert.IsTrue(map.Find("PlanningDecisions").gameObject.activeSelf);
                Assert.IsTrue(_hud.BlocksKeyboardInput); Assert.IsTrue(_hud.BlocksPointerInput);
                var group = map.GetComponent<UnityEngine.CanvasGroup>();
                Assert.IsFalse(group.interactable); Assert.IsFalse(group.blocksRaycasts); Assert.AreEqual(1f, group.alpha);
                Assert.IsFalse(ready.IsInteractable(), "the exposed edge of the planning rail must not accept pointer/submit input behind the journal");
                Assert.AreSame(plan, _session.Collections.Plan);
                Assert.AreEqual((byte)1, plan.Pick); Assert.AreEqual((byte)0, plan.Boon); Assert.IsFalse(plan.Ready);
                Assert.AreEqual(readyText, ready.GetComponentInChildren<TMP_Text>().text);
                Assert.AreEqual(0, _transport.Inputs().Count, "reviewing must not choose a spawn, ready, accept or send a world action");
                foreach (string tab in new[] { "TradersTab", "NoticesTab" })
                    Assert.IsFalse(_hud.QuestJournal.Root.Find(tab).GetComponent<UnityEngine.UI.Button>().interactable);
                _hud.ShowPlayerFlow(1); _hud.ShowPlayerFlow(2);
                Assert.IsTrue(_hud.QuestJournal.IsVisible); Assert.IsFalse(_hud.TraderDialog.IsVisible); Assert.IsFalse(_hud.ServerNotices.IsVisible);
                InputSystem.QueueStateEvent(keyboard, new KeyboardState()); InputSystem.Update();
                InputSystem.QueueStateEvent(keyboard, new KeyboardState(Key.J)); InputSystem.Update(); _hud.ReadUiInput();
                Assert.IsFalse(_hud.QuestJournal.IsVisible); Assert.IsTrue(_hud.TacticalMap.IsOpen);
                Assert.IsTrue(group.interactable); Assert.IsTrue(group.blocksRaycasts); Assert.AreEqual(1f, group.alpha);
                Assert.AreSame(ready.gameObject, EventSystem.current.currentSelectedGameObject);
                Assert.AreSame(plan, _session.Collections.Plan); _session.FlushInput(); Assert.AreEqual(0, _transport.Inputs().Count);
            });
            DeliverPlanning(new QuestHandle(71), ready: true);
            var confirmed = _session.Collections.Plan;
            _hud.ShowPlayerFlow(0);
            _hud.QuestJournal.Root.Find("CloseJournal").GetComponent<UnityEngine.UI.Button>().onClick.Invoke();
            Assert.AreSame(confirmed, _session.Collections.Plan); Assert.IsTrue(confirmed.Ready);
            _session.FlushInput(); Assert.AreEqual(0, _transport.Inputs().Count, "review never changes or resubmits a confirmed Ready");
        }

        [Test]
        public void PlanningPreviewRetiresDeferredAcceptAndWaitsForFreshNativePermission()
        {
            var handle = new QuestHandle(71);
            _transport.Deliver(new ServerMsg.State { Tick = 1, Items = new StateItem[] { QuestState(handle) } });
            _hud.ShowPlayerFlow(0); _hud.QuestJournal.SelectQuest(handle);
            var priorView = _session.Collections.Quests; uint epoch = _session.TimelineEpoch;
            DeliverPlanning(handle);
            Assert.IsTrue(_hud.QuestJournal.IsVisible);
            Assert.IsFalse(_session.Collections.Quests.Rows[0].CanAccept);
            Assert.IsFalse((bool)Invoke(_hud.QuestJournal, "TryAcceptFrom", _session, epoch, priorView, handle),
                "a deferred previously-enabled callback cannot act against a new planning preview");
            Assert.IsFalse(_hud.QuestJournal.TryAccept(handle));
            _session.FlushInput(); Assert.AreEqual(0, _transport.Inputs().Count);

            var active = QuestState(handle); active.View.Rows[0].State = QuestRowState.Open;
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 3, ServerTimeOverrideMs = 150, Phase = (byte)MatchPhase.Active });
            _transport.Deliver(new ServerMsg.State { Tick = 3, Items = new StateItem[] { new PlanState(), active } });
            Assert.IsFalse(_hud.TacticalMap.IsPlanning);
            Assert.IsTrue(_hud.QuestJournal.TryAccept(handle), "only the new delivered CanAccept enables acceptance");
            Assert.IsFalse(_session.Collections.Quests.Rows[0].OwnerAccepted, "local pending feedback is not server acceptance");
            StringAssert.Contains("Acceptance queued", _hud.QuestJournal.Root.Find("QuestDetail/QuestStatus").GetComponent<TMP_Text>().text);
            _session.FlushInput();
            var command = _transport.Inputs().SelectMany(x => x.Commands).Single();
            Assert.AreEqual(CommandKind.QuestAccept, command.Kind); Assert.AreEqual(handle, command.QuestRef);
            Assert.IsTrue(_hud.QuestJournal.Root.Find("TradersTab").GetComponent<UnityEngine.UI.Button>().interactable,
                "nonplanning pages recover when the delivered planning state ends");
        }

        [Test]
        public void PlanningJournalDropAndResumedWelcomeClearRowsAndRestoreMapInput()
        {
            var handle = new QuestHandle(71); DeliverPlanning(handle);
            _hud.ShowPlayerFlow(0); _hud.QuestJournal.SelectQuest(handle);
            var view = _session.Collections.Quests; uint epoch = _session.TimelineEpoch;
            var group = _hud.transform.Find("MatchUI/TacticalMap").GetComponent<UnityEngine.CanvasGroup>();
            _transport.Drop();
            Assert.AreEqual(SessionState.Reconnecting, _session.State);
            Assert.IsFalse(_hud.QuestJournal.TryAccept(handle));
            StringAssert.Contains("Reconnecting", _hud.QuestJournal.Root.Find("JournalState").GetComponent<TMP_Text>().text);
            WithKeyboard(keyboard =>
            {
                InputSystem.QueueStateEvent(keyboard, new KeyboardState(Key.J)); InputSystem.Update(); _hud.ReadUiInput();
                Assert.IsFalse(_hud.QuestJournal.IsVisible); Assert.IsTrue(group.interactable);
                InputSystem.QueueStateEvent(keyboard, new KeyboardState()); InputSystem.Update();
                InputSystem.QueueStateEvent(keyboard, new KeyboardState(Key.J)); InputSystem.Update(); _hud.ReadUiInput();
                Assert.IsTrue(_hud.QuestJournal.IsVisible, "reconnecting planning defaults to quests, never a forbidden notices page");
            });
            _transport.Open(); Welcome();
            Assert.Greater(_session.TimelineEpoch, epoch);
            Assert.IsNull(_session.Collections.Plan); Assert.IsNull(_session.Collections.Quests);
            Assert.IsFalse(_hud.QuestJournal.IsVisible); Assert.IsTrue(group.interactable); Assert.IsTrue(group.blocksRaycasts);
            Assert.IsFalse((bool)Invoke(_hud.QuestJournal, "TryAcceptFrom", _session, epoch, view, handle));
            Assert.IsFalse(_hud.QuestJournal.Root.Find("QuestRows/Viewport/Content/QuestRow0").gameObject.activeSelf);
            _session.FlushInput(); Assert.AreEqual(0, _transport.Inputs().Count);
            DeliverPlanning(new QuestHandle(72)); _hud.ShowPlayerFlow(0);
            _hud.QuestJournal.SelectQuest(new QuestHandle(72));
            var title = _hud.QuestJournal.Root.Find("QuestDetail/QuestTextScroll/Viewport/Content/QuestName/Value").GetComponent<TMP_Text>();
            Assert.AreEqual("Planning quest 72", title.text);
            _hud.QuestJournal.SelectQuest(handle);
            Assert.AreEqual("Planning quest 72", title.text, "a stale removed handle cannot replace the selected current quest");
            Assert.IsFalse(_hud.QuestJournal.TryAccept(handle));
        }

        [Test]
        public void PlanningJournalRespectsSettingsAndFocusedTextEntry()
        {
            DeliverPlanning(new QuestHandle(71));
            Invoke(_hud, "ToggleSettings"); _hud.ShowPlayerFlow(0);
            Assert.IsFalse(_hud.QuestJournal.IsVisible);
            Invoke(_hud, "ToggleSettings");
            var field = _hud.transform.Find("MatchUI/JoinMenu/Nickname").GetComponent<TMP_InputField>();
            var parent = field.transform.parent;
            try
            {
                field.transform.SetParent(_root.transform, false);
                EventSystem.current.SetSelectedGameObject(field.gameObject); field.ActivateInputField(); Invoke(field, "LateUpdate");
                Assert.IsTrue(field.isFocused);
                WithKeyboard(keyboard =>
                {
                    InputSystem.QueueStateEvent(keyboard, new KeyboardState(Key.J, Key.Tab, Key.Digit1, Key.W)); InputSystem.Update();
                    _hud.ShowPlayerFlow(0); _hud.ReadUiInput(); Invoke(_client, "ReadInput"); _session.FlushInput();
                    Assert.IsFalse(_hud.QuestJournal.IsVisible); Assert.IsTrue(field.isFocused);
                    Assert.AreEqual(0, _transport.Inputs().Count, "text entry owns planning digits and world keys");
                });
            }
            finally { field.DeactivateInputField(); field.transform.SetParent(parent, false); EventSystem.current.SetSelectedGameObject(null); }
            _hud.ShowPlayerFlow(0); Assert.IsTrue(_hud.QuestJournal.IsVisible, "journal access recovers when text focus ends");
        }

        void DeliverPlanning(QuestHandle handle, bool ready = false)
        {
            var quests = QuestState(handle); quests.View.Rows[0].CanAccept = false;
            quests.View.Rows[0].Name = "Planning quest " + handle.Value;
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 2, ServerTimeOverrideMs = 100, Phase = (byte)MatchPhase.Planning,
                Me = new WireSelf { Id = 1, X = 64, Y = 64, Hp = 100, MaxHp = 100, Status = 1, Weapon = 0 } });
            _transport.Deliver(new ServerMsg.State { Tick = 2, Items = new StateItem[] { new PlanState { Value = new WirePlan {
                EndsAt = 10000, Spawn0 = 5, Spawn1 = 8, Pick = 1, Boon = 0, Ready = ready, Boons = new[] { "First native boon", "Second native boon" },
                Option0 = new WirePlanOption { Index = 5, X = 64, Y = 64, Zone = 1 },
                Option1 = new WirePlanOption { Index = 8, X = 96, Y = 96, Zone = 2 } } }, quests } });
            _hud.TacticalMap.Tick();
            Assert.AreEqual(MatchPhase.Planning, _session.Phase); Assert.IsTrue(_hud.TacticalMap.IsPlanning);
        }

        static QuestsState QuestState(QuestHandle handle) => new QuestsState { Available = true, View = new WireQuestView {
            Rows = new[] { new WireQuestRow { Handle = handle, Def = "fixture", GiverX = 64, GiverY = 80,
                State = QuestRowState.Preview, ExpiresAt = 10000, CanAccept = true, Name = "same", GiverLabel = "same",
                Brief = "native brief", Objective = "native objective", Reward = "native reward" } },
            Objectives = new[] { new WireQuestObjective { Quest = handle, X = 200, Y = 220 } } } };

        static void WithKeyboard(Action<Keyboard> action)
        {
            var original = InputSystem.settings; var flags = original.hideFlags; var previous = Keyboard.current;
            var settings = ScriptableObject.Instantiate(original); Keyboard keyboard = null;
            try
            {
                settings.updateMode = InputSettings.UpdateMode.ProcessEventsInDynamicUpdate;
                settings.backgroundBehavior = InputSettings.BackgroundBehavior.IgnoreFocus;
                settings.SetInternalFeatureFlag("RUN_PLAYER_UPDATES_IN_EDIT_MODE", true);
                if (flags == HideFlags.HideAndDontSave) original.hideFlags = HideFlags.DontSave;
                InputSystem.settings = settings; keyboard = InputSystem.AddDevice<Keyboard>(); keyboard.MakeCurrent();
                action(keyboard);
            }
            finally
            {
                if (keyboard != null && keyboard.added) InputSystem.RemoveDevice(keyboard);
                if (original != null) { InputSystem.settings = original; original.hideFlags = flags; }
                if (settings != null) UnityEngine.Object.DestroyImmediate(settings);
                if (previous != null && previous.added) previous.MakeCurrent();
            }
        }
        static object Invoke(object target, string method, params object[] args) => target.GetType()
            .GetMethod(method, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic).Invoke(target, args);
    }
}
