using System;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class QuestJournalViewEditModeTests
    {
        sealed class TestTransport : ITransport
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
            public void Drop() => Closed?.Invoke("fixture disconnect");
        }

        GameObject _canvas, _host;
        QuestJournalView _view;
        Session _session, _other;
        TestTransport _transport, _otherTransport;
        QuestHandle _first = new QuestHandle(71), _second = new QuestHandle(72);
        int _trackedCalls;
        QuestHandle? _trackedValue;

        [SetUp]
        public void SetUp()
        {
            _canvas = new GameObject("Quest journal canvas", typeof(RectTransform), typeof(Canvas), typeof(UnityEngine.UI.GraphicRaycaster));
            _host = new GameObject("Quest journal host");
            _view = _host.AddComponent<QuestJournalView>();
            _trackedCalls = 0; _trackedValue = null;
            _view.Initialize(_canvas.transform, onTracked: value => { _trackedCalls++; _trackedValue = value; });
            _view.SetVisible(true);
            _transport = new TestTransport(); _session = NewSession(_transport, 1);
            _view.Bind(_session);
        }

        [TearDown]
        public void TearDown()
        {
            if (_session != null) _session.Leave();
            if (_other != null) _other.Leave();
            if (_host != null) UnityEngine.Object.DestroyImmediate(_host);
            if (_canvas != null) UnityEngine.Object.DestroyImmediate(_canvas);
        }

        [Test]
        public void UnseenUnavailableAndAvailableEmptyAreDistinctAndRowsPreserveExactServerText()
        {
            Assert.IsNull(_session.Collections.Quests);
            _view.Refresh();
            Assert.AreEqual("Waiting for quest data…", Text("JournalState"));

            DeliverQuestState(_session, _transport, new QuestsState { Available = false });
            _view.Refresh();
            Assert.IsNotNull(_session.Collections.Quests);
            Assert.IsFalse(_session.Collections.Quests.Available);
            Assert.AreEqual("Quest journal unavailable.", Text("JournalState"));

            DeliverQuestState(_session, _transport, new QuestsState { Available = true, View = new WireQuestView() });
            _view.Refresh();
            Assert.IsTrue(_session.Collections.Quests.Available);
            Assert.AreEqual(0, _session.Collections.Quests.Rows.Count);
            Assert.AreEqual("No quests are currently available.", Text("JournalState"));

            const string brief = "A <strange> brief & exact";
            const string objective = "Do not normalize this objective:  3";
            const string reward = "7 Stone stacks (exact wording) and 5 GV";
            DeliverQuestState(_session, _transport, Available(Row(_first, "Echo", brief, objective, reward, true)));
            _view.Refresh(); _view.SelectQuest(_first);
            Assert.AreEqual("Echo", Text("QuestName"));
            Assert.AreEqual("Wanderer & Co.", Text("QuestGiver"));
            Assert.AreEqual(brief, Text("QuestBrief"));
            Assert.AreEqual(objective, Text("QuestObjective"));
            Assert.AreEqual(reward, Text("QuestReward"));
            Assert.AreEqual("ACCEPT QUEST", ButtonLabel("AcceptQuest"));
            InvokeTrack();
            Assert.AreEqual(_first, _view.TrackedQuest, "a current published Preview row can be tracked");
            _session.FlushInput();
            Assert.AreEqual(0, InputFrames(_transport).Count, "tracking never creates a quest command");
        }

        [Test]
        public void MaximumLengthServerStringsRemainVerbatimInScrollableFixedSizeTextFields()
        {
            string maximum = new string('L', 255);
            WireQuestRow row = Row(_first, maximum, maximum, maximum, maximum, false);
            row.GiverLabel = maximum;
            DeliverQuestState(_session, _transport, Available(row)); _view.Refresh(); _view.SelectQuest(_first);
            Canvas.ForceUpdateCanvases();
            var scroll = typeof(QuestJournalView).GetField("_detailScroll", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_view) as UnityEngine.UI.ScrollRect;
            var content = typeof(QuestJournalView).GetField("_detailContent", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_view) as RectTransform;
            UnityEngine.UI.LayoutRebuilder.ForceRebuildLayoutImmediate(content); Canvas.ForceUpdateCanvases();

            Assert.AreEqual(maximum, Text("QuestName"));
            Assert.AreEqual(maximum, Text("QuestGiver"));
            Assert.AreEqual(maximum, Text("QuestBrief"));
            Assert.AreEqual(maximum, Text("QuestObjective"));
            Assert.AreEqual(maximum, Text("QuestReward"));
            Assert.Greater(content.rect.height, scroll.viewport.rect.height, "long published text can be read by scrolling the detail pane");
            Assert.IsNotNull(_canvas.transform.Find("QuestJournal/QuestDetail/QuestTextScroll").GetComponent<KeyboardScrollPane>());
            Assert.IsNotNull(_canvas.transform.Find("QuestJournal/QuestRows").GetComponent<KeyboardScrollPane>());
            Assert.IsFalse(TextComponent("QuestBrief").enableAutoSizing, "body text does not shrink to fit the fixed viewport");
            Assert.IsFalse(TextComponent("QuestBrief").richText, "opaque server strings are rendered as literal text");
        }

        [Test]
        public void ReplacementPreservesSelectedHandleAndScrollButClearsRemovedSelectionAndTracking()
        {
            DeliverQuestState(_session, _transport, Available(Row(_first, "First", "brief", "objective", "reward", false, true)));
            _view.Bind(_session); _view.Refresh(); _view.SelectQuest(_first);
            InvokeTrack();
            Assert.AreEqual(_first, _view.TrackedQuest);
            Assert.AreEqual(_first, _trackedValue);
            StringAssert.Contains("Ready", Status(), "published OwnerReady is shown as a status fact");

            DeliverQuestState(_session, _transport, Available(Row(_first, "Updated", "new brief", "new objective", "new reward", false, true)));
            _view.Refresh();
            Assert.AreEqual("Updated", Text("QuestName"));
            Assert.AreEqual(_first, _view.TrackedQuest);

            DeliverQuestState(_session, _transport, Available(Row(_second, "Other", "b", "o", "r", false, true)));
            _view.Refresh();
            Assert.IsNull(_view.TrackedQuest);
            Assert.IsNull(_trackedValue);
            Assert.GreaterOrEqual(_trackedCalls, 2);
            Assert.AreEqual("Select a quest", Text("QuestName"));
        }

        [Test]
        public void OldAcceptTrackAndRowCallbacksCannotActAfterReplacementBeforeRefresh()
        {
            DeliverQuestState(_session, _transport, Available(
                Row(_first, "First", "b", "o", "r", true, true),
                Row(_second, "Second", "b", "o", "r", false, true)));
            _view.Refresh(); _view.SelectQuest(_first); InvokeTrack();
            Assert.AreEqual(_first, _view.TrackedQuest);
            var firstRowButton = _canvas.transform.Find("QuestJournal/QuestRows/Viewport/Content/QuestRow0").GetComponent<UnityEngine.UI.Button>();
            var acceptButton = _canvas.transform.Find("QuestJournal/QuestDetail/AcceptQuest").GetComponent<UnityEngine.UI.Button>();
            var trackButton = _canvas.transform.Find("QuestJournal/QuestDetail/TrackQuest").GetComponent<UnityEngine.UI.Button>();

            DeliverQuestState(_session, _transport, Available(Row(_second, "Second", "b", "o", "r", false, true)));
            firstRowButton.onClick.Invoke();
            acceptButton.onClick.Invoke();
            trackButton.onClick.Invoke();
            Assert.AreEqual(_first, _view.TrackedQuest, "stale callbacks cannot retarget or clear tracking before the owner refreshes");
            Assert.AreEqual(_first, _trackedValue);
            Assert.AreEqual(1, _trackedCalls, "stale track callback cannot publish another selection");
            _session.FlushInput();
            Assert.AreEqual(0, InputFrames(_transport).Count, "the old CanAccept fact cannot queue after replacement");

            _view.Refresh();
            Assert.IsNull(_view.TrackedQuest);
            Assert.IsNull(_trackedValue);
            Assert.AreEqual(2, _trackedCalls);
            Assert.AreEqual("Select a quest", Text("QuestName"));
        }

        [Test]
        public void MetadataReplacementPreservesScrollPositionWhenRowsOverflowViewport()
        {
            var rows = new WireQuestRow[10];
            for (int i = 0; i < rows.Length; i++) rows[i] = Row(new QuestHandle((uint)(100 + i)), "Quest " + i, "b", "o", "r", false, true);
            DeliverQuestState(_session, _transport, Available(rows)); _view.Refresh();
            Canvas.ForceUpdateCanvases();
            var scroll = typeof(QuestJournalView).GetField("_scroll", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_view) as UnityEngine.UI.ScrollRect;
            var content = typeof(QuestJournalView).GetField("_content", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_view) as RectTransform;
            UnityEngine.UI.LayoutRebuilder.ForceRebuildLayoutImmediate(content); Canvas.ForceUpdateCanvases();
            Assert.Greater(content.rect.height, scroll.viewport.rect.height, "the fixture exercises an actually scrollable list");
            scroll.verticalNormalizedPosition = .37f;
            Canvas.ForceUpdateCanvases();
            Assert.That(scroll.verticalNormalizedPosition, Is.EqualTo(.37f).Within(.02f));

            rows[0] = Row(new QuestHandle(100), "Metadata changed", "new brief", "new objective", "new reward", false, true);
            DeliverQuestState(_session, _transport, Available(rows)); _view.Refresh();
            UnityEngine.UI.LayoutRebuilder.ForceRebuildLayoutImmediate(content); Canvas.ForceUpdateCanvases();
            Assert.That(scroll.verticalNormalizedPosition, Is.EqualTo(.37f).Within(.02f));
            Assert.AreEqual("Metadata changed", _canvas.transform.Find("QuestJournal/QuestRows/Viewport/Content/QuestRow0/QuestRowLabel").GetComponent<TMP_Text>().text.Split('\n')[0]);
        }

        [Test]
        public void AcceptUsesCurrentHandleAndFreshCanAcceptThenSessionBatchesOnlyThatIntent()
        {
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 20, Phase = 1 });
            WireQuestRow pastButStillAcceptable = Row(_first, "Fresh", "brief", "objective", "reward", true);
            pastButStillAcceptable.ExpiresAt = 500;
            DeliverQuestState(_session, _transport, Available(pastButStillAcceptable));
            _view.Refresh(); _view.SelectQuest(_first);
            StringAssert.Contains("Awaiting server deadline update", Status());
            Assert.IsTrue(_view.TryAccept(_first), "past presentation deadline does not override current server CanAccept");
            StringAssert.Contains("Acceptance queued · waiting for server update", Status());
            Assert.IsFalse(_session.Collections.Quests.Rows[0].OwnerAccepted, "queueing is not an optimistic server acceptance");

            // Server replacement revokes the affordance before dispatch; the old callback cannot queue it.
            DeliverQuestState(_session, _transport, Available(Row(_first, "Fresh", "brief", "objective", "reward", false)));
            _view.Refresh();
            Assert.IsFalse(_view.TryAccept(_first));
            StringAssert.DoesNotContain("Acceptance queued", Status(), "a new reliable replacement clears only local pending feedback");
            _session.FlushInput();
            var frames = InputFrames(_transport);
            Assert.AreEqual(1, frames.Count);
            Assert.AreEqual(1, frames[0].Commands.Count);
            Assert.AreEqual(CommandKind.QuestAccept, frames[0].Commands[0].Kind);
            Assert.AreEqual(_first, frames[0].Commands[0].QuestRef);

            int before = _transport.Sent.Count;
            _session.Input.QuestAccept(default(QuestHandle));
            _session.FlushInput();
            Assert.AreEqual(before, _transport.Sent.Count, "invalid handle is dropped by InputSender");
            Assert.AreEqual(1, _session.Input.Dropped);

            DeliverQuestState(_session, _transport, Available(Row(_first, "Fresh", "brief", "objective", "reward", true)));
            _view.Refresh();
            _transport.Deliver(new ServerMsg.Events { Tick = 21, List = new List<WireEvent> {
                new WireEvent { Kind = EventKind.Result, Result = new WireResult { Place = 1, Players = 2 } } } });
            Assert.AreEqual(SessionState.InMatch, _session.State, "Result may precede MatchEnded");
            Assert.IsFalse(_view.TryAccept(_first), "a current result blocks new acceptance before the next UI refresh");
            _view.Refresh();
            Assert.IsFalse(_canvas.transform.Find("QuestJournal/QuestDetail/AcceptQuest").GetComponent<UnityEngine.UI.Button>().interactable);
            _session.FlushInput();
            Assert.AreEqual(before, _transport.Sent.Count);
        }

        [Test]
        public void OldSessionCallbacksAndRemovedRowsCannotAcceptAfterRebindWelcomeOrDisconnect()
        {
            DeliverQuestState(_session, _transport, Available(Row(_first, "Old", "b", "o", "r", true)));
            _view.Refresh(); _view.SelectQuest(_first);
            UnityEngine.UI.Button accept = _canvas.transform.Find("QuestJournal/QuestDetail/AcceptQuest").GetComponent<UnityEngine.UI.Button>();
            Assert.IsTrue(accept.interactable);

            _otherTransport = new TestTransport(); _other = NewSession(_otherTransport, 2);
            _view.Bind(_other);
            Assert.IsFalse(_view.TryAccept(_first), "handle from prior session is not actionable after rebind");
            Assert.IsFalse(accept.interactable);
            Assert.IsNull(_view.TrackedQuest);

            DeliverQuestState(_other, _otherTransport, Available(Row(_first, "New", "b", "o", "r", true)));
            _view.Refresh(); _view.SelectQuest(_first);
            _otherTransport.Drop(); _view.Refresh();
            Assert.AreEqual(SessionState.Reconnecting, _other.State);
            Assert.IsFalse(_view.TryAccept(_first));
            Assert.AreEqual("Quest journal unavailable while disconnected.", Text("JournalState"));
            Assert.IsFalse(_canvas.transform.Find("QuestJournal/QuestRows/Viewport/Content/QuestRow0").gameObject.activeSelf);

            _otherTransport.Open();
            var resumedMatch = new byte[16]; resumedMatch[0] = 2;
            _otherTransport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = resumedMatch, Session = new byte[16],
                PlayerId = 1, TickRate = 20, Map = new MapBlob(2, 2, new byte[4]) });
            Assert.AreEqual(SessionState.InMatch, _other.State);
            Assert.IsNull(_other.Collections.Quests, "resumed Welcome clears retained quest rows until a new reliable replacement arrives");
            _view.Refresh();
            Assert.AreEqual("Waiting for quest data…", Text("JournalState"));
            Assert.IsFalse(_view.TryAccept(_first));
        }

        static Session NewSession(TestTransport transport, byte id)
        {
            var session = new Session(transport, new SessionOptions { Url = "ws://quest-test/ws", Profile = "quest-test", Now = () => 1000 });
            session.Connect(); transport.Open();
            var match = new byte[16]; match[0] = id;
            transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = match, Session = new byte[16],
                PlayerId = 1, TickRate = 20, Map = new MapBlob(2, 2, new byte[4]) });
            return session;
        }

        static void DeliverQuestState(Session session, TestTransport transport, QuestsState quests)
        {
            transport.Deliver(new ServerMsg.State { Tick = 1, Items = new StateItem[] { quests } });
        }

        static QuestsState Available(params WireQuestRow[] rows) => new QuestsState { Available = true, View = new WireQuestView { Rows = rows } };

        static WireQuestRow Row(QuestHandle handle, string name, string brief, string objective, string reward, bool canAccept, bool accepted = false)
        {
            return new WireQuestRow { Handle = handle, Def = "test", GiverX = 1, GiverY = 2, State = accepted ? QuestRowState.Open : QuestRowState.Preview,
                ExpiresAt = 12345.5, Participants = Array.Empty<WireQuestParticipant>(), DoneBy = null,
                CanAccept = canAccept, OwnerAccepted = accepted, OwnerCompleted = false, OwnerReady = accepted, OwnerProgress = accepted ? 2u : 0u,
                OwnerVisited = 0, Name = name, GiverLabel = "Wanderer & Co.", Brief = brief, Objective = objective, Reward = reward };
        }

        List<ClientMsg.Input> InputFrames(TestTransport transport)
        {
            var result = new List<ClientMsg.Input>();
            foreach (byte[] frame in transport.Sent)
                if (ClientMsg.Decode(frame) is ClientMsg.Input input) result.Add(input);
            return result;
        }

        string Text(string name)
        {
            string suffix = name == "JournalState" ? name : "QuestDetail/QuestTextScroll/Viewport/Content/" + name + "/Value";
            return _canvas.transform.Find("QuestJournal/" + suffix).GetComponent<TMP_Text>().text;
        }
        string Status() => _canvas.transform.Find("QuestJournal/QuestDetail/QuestStatus").GetComponent<TMP_Text>().text;
        TMP_Text TextComponent(string name) => _canvas.transform.Find("QuestJournal/QuestDetail/QuestTextScroll/Viewport/Content/" + name + "/Value").GetComponent<TMP_Text>();
        string ButtonLabel(string name) => _canvas.transform.Find("QuestJournal/QuestDetail/" + name + "/Label").GetComponent<TMP_Text>().text;
        void InvokeTrack() => _canvas.transform.Find("QuestJournal/QuestDetail/TrackQuest").GetComponent<UnityEngine.UI.Button>().onClick.Invoke();
    }
}
