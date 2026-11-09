using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.ExceptionServices;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    public sealed class TrainingConsoleViewEditModeTests
    {
        sealed class TestTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public readonly List<byte[]> Sent = new List<byte[]>();
            public bool CloseCalled;
            public Action<byte[]> OnSend;

            public void Connect(string url) { }
            public void Send(byte[] frame) { Sent.Add(frame); OnSend?.Invoke(frame); }
            public void Close() { CloseCalled = true; Closed?.Invoke("fixture close"); }
            public void Poll() { }
            public void Open() { Opened?.Invoke(); }
            public void Deliver(ServerMsg message) { Received?.Invoke(message.Encode()); }
            public void Drop() { Closed?.Invoke("fixture disconnect"); }
        }

        sealed class SessionFixture
        {
            public TestTransport Transport;
            public Session Session;
        }

        GameObject _canvasObject, _hostObject, _eventsObject;
        EventSystem _previousEvents;
        GameObject _previousSelection;
        TrainingConsoleView _view;
        SessionFixture _active;
        readonly List<SessionFixture> _sessions = new List<SessionFixture>();
        double _now = 1000;
        byte _nextMatchId = 1;

        [SetUp]
        public void SetUp()
        {
            _previousEvents = EventSystem.current;
            _previousSelection = _previousEvents != null ? _previousEvents.currentSelectedGameObject : null;
            try
            {
                _eventsObject = new GameObject("Training console test EventSystem", typeof(UiInputRoutingEventSystem));
                var eventSystem = _eventsObject.GetComponent<UiInputRoutingEventSystem>();
                eventSystem.enabled = false;
                eventSystem.enabled = true;
                EventSystem.current = eventSystem;
                Assert.AreSame(eventSystem, EventSystem.current, "the fixture must register its current EventSystem before UI setup");

                _canvasObject = new GameObject("Training console test canvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
                _hostObject = new GameObject("Training console view host");
                _view = _hostObject.AddComponent<TrainingConsoleView>();
                _view.Initialize(_canvasObject.transform);
                _active = CreateSession(training: false, deliverSnapshot: true);
                _view.Bind(_active.Session);
            }
            catch (Exception setupFailure)
            {
                try { CleanupFixture(); }
                catch (Exception cleanupFailure) { throw new AggregateException("Training console fixture setup and cleanup both failed.", setupFailure, cleanupFailure); }
                ExceptionDispatchInfo.Capture(setupFailure).Throw();
                throw;
            }
        }

        [TearDown]
        public void TearDown()
        {
            CleanupFixture();
        }

        void CleanupFixture()
        {
            var failures = new List<Exception>();
            CaptureFailure(failures, () => { if (_view != null) _view.Bind(null); });
            for (int i = 0; i < _sessions.Count; i++)
            {
                var fixture = _sessions[i];
                if (fixture?.Session == null || fixture.Session.State == SessionState.Ended) continue;
                CaptureFailure(failures, fixture.Session.Leave);
            }

            CaptureFailure(failures, () => DestroyOwned(ref _hostObject));
            CaptureFailure(failures, () => DestroyOwned(ref _canvasObject));
            CaptureFailure(failures, RetireOwnedEventSystem);
            CaptureFailure(failures, RestorePriorSelectionIfCurrent);
            _sessions.Clear();
            _view = null;
            _active = null;
            _previousEvents = null;
            _previousSelection = null;
            ThrowCleanupFailures(failures);
        }

        static void CaptureFailure(List<Exception> failures, Action cleanup)
        {
            try { cleanup(); }
            catch (Exception error) { failures.Add(error); }
        }

        static void ThrowCleanupFailures(List<Exception> failures)
        {
            if (failures.Count == 1) ExceptionDispatchInfo.Capture(failures[0]).Throw();
            if (failures.Count > 1) throw new AggregateException("Multiple training console fixture cleanup steps failed.", failures);
        }

        static void DestroyOwned(ref GameObject owned)
        {
            var target = owned;
            owned = null;
            if (target != null) UnityEngine.Object.DestroyImmediate(target);
        }

        void RetireOwnedEventSystem()
        {
            var target = _eventsObject;
            _eventsObject = null;
            if (target == null) return;
            var failures = new List<Exception>();
            EventSystem ownedSystem = null;
            CaptureFailure(failures, () => ownedSystem = target.GetComponent<EventSystem>());
            try
            {
                if (ownedSystem != null && EventSystem.current == ownedSystem)
                    CaptureFailure(failures, () => ownedSystem.SetSelectedGameObject(null));
            }
            finally
            {
                try
                {
                    if (ownedSystem != null) CaptureFailure(failures, () => ownedSystem.enabled = false);
                }
                finally
                {
                    CaptureFailure(failures, () => UnityEngine.Object.DestroyImmediate(target));
                }
            }
            ThrowCleanupFailures(failures);
        }

        void RestorePriorSelectionIfCurrent()
        {
            var prior = _previousEvents;
            if (prior == null || !prior.isActiveAndEnabled || EventSystem.current != prior) return;
            var selection = _previousSelection;
            if (selection != null && selection.activeInHierarchy) prior.SetSelectedGameObject(selection);
        }

        [Test]
        public void StartsClosedAndRequiresAcceptedTrainingFactAndMatchingExplicitLaunchContext()
        {
            Assert.IsFalse(_view.IsOpen);
            Assert.IsFalse(_view.ActionsAvailable);
            Assert.IsNotNull(_view.Panel);

            var pending = CreateSession(training: true, deliverSnapshot: false);
            _view.Bind(pending.Session);
            Assert.IsFalse(_view.SetLaunchContext(pending.Session, pending.Session.TimelineEpoch, MatchLaunchMode.Training),
                "a Training confirmation before an accepted phase/training fact cannot arm actions");
            Assert.IsFalse(_view.ActionsAvailable);
            Assert.IsFalse(_view.TryClear());

            var training = CreateSession(training: true, deliverSnapshot: true);
            _view.Bind(training.Session);
            Assert.IsTrue(training.Session.Training);
            Assert.IsTrue(training.Session.Phase.HasValue);
            Assert.IsFalse(_view.ActionsAvailable, "binding does not invent launch confirmation");
            Assert.IsTrue(_view.SetLaunchContext(training.Session, training.Session.TimelineEpoch, MatchLaunchMode.Training));
            Assert.IsTrue(_view.ActionsAvailable);

            Assert.IsFalse(_view.SetLaunchContext(training.Session, training.Session.TimelineEpoch, MatchLaunchMode.Arena));
            Assert.IsFalse(_view.ActionsAvailable);
            Assert.IsFalse(_view.TryClear());

            Assert.IsTrue(_view.SetLaunchContext(training.Session, training.Session.TimelineEpoch, MatchLaunchMode.Training));
            Assert.IsFalse(_view.SetLaunchContext(training.Session, training.Session.TimelineEpoch, null));
            Assert.IsFalse(_view.ActionsAvailable, "Arena launch context cannot arm the Training console");
            Assert.IsTrue(_view.SetLaunchContext(training.Session, training.Session.TimelineEpoch, MatchLaunchMode.Training));

            uint retiredEpoch = training.Session.TimelineEpoch;
            training.Transport.Drop();
            _now += 500;
            training.Session.Poll();
            training.Transport.Open();
            Assert.AreEqual(SessionState.HelloSent, training.Session.State);
            training.Transport.Deliver(new ServerMsg.Welcome
            {
                Protocol = Wire.ProtocolVersion,
                MatchId = new byte[16],
                Session = new byte[16],
                PlayerId = 7,
                TickRate = 20,
                Map = new MapBlob(4, 4, new byte[16])
            });
            Assert.Greater(training.Session.TimelineEpoch, retiredEpoch);
            Assert.IsFalse(_view.ActionsAvailable, "a new Welcome revokes the retired timeline confirmation");
            Assert.IsFalse(_view.SetLaunchContext(training.Session, retiredEpoch, MatchLaunchMode.Training));
            Assert.IsFalse(_view.TryClear());
        }

        [Test]
        public void EachTrainingActionQueuesOneExactTrainWireIntentInExistingSessionOrder()
        {
            var training = CreateSession(training: true, deliverSnapshot: true);
            _view.Bind(training.Session);
            Assert.IsTrue(_view.SetLaunchContext(training.Session, training.Session.TimelineEpoch, MatchLaunchMode.Training));
            Assert.IsTrue(_view.SetOpen(true));

            Assert.IsTrue(_view.SelectMob(12));
            Assert.IsTrue(_view.TrySpawnCamp());
            AssertTrain(training.Transport, 0, 3, TrainingConsoleSelectors.MobChoices[12].Position, 0, Array.Empty<byte>());

            _view.SetStatText("0");
            Assert.IsTrue(_view.TrySetStacks(), "the console preserves the zero stat request for the server door to validate");
            AssertTrain(training.Transport, 1, 2, TrainingConsoleSelectors.MobChoices[12].Position, 0, Array.Empty<byte>());

            Assert.IsTrue(_view.SelectCard(1));
            Assert.IsTrue(_view.SelectCopies(4), "the final offered count choice is the source's zero/remove request");
            Assert.IsTrue(_view.TrySetCard());
            AssertTrain(training.Transport, 2, 1, TrainingConsoleSelectors.InteractiveCardIndices[1], 0, Array.Empty<byte>());

            Assert.IsTrue(_view.SelectCard(2));
            Assert.IsTrue(_view.TryDropChest(chosen: true));
            AssertTrain(training.Transport, 3, 4, 0, 0, new[] { TrainingConsoleSelectors.InteractiveCardIndices[2] });

            Assert.IsTrue(_view.TryDropChest(chosen: false));
            AssertTrain(training.Transport, 4, 4, 0, 0, Array.Empty<byte>());

            Assert.IsTrue(_view.TryClear());
            AssertTrain(training.Transport, 5, 5, 0, 0, Array.Empty<byte>());

            var commands = TrainCommands(training.Transport);
            CollectionAssert.AreEqual(new byte[] { 3, 2, 1, 4, 4, 5 }, commands.Select(x => x.TrainCommand).ToArray());
            Assert.AreEqual(6, commands.Count, "each button action flushes one command; no helper transport is introduced");
        }

        [Test]
        public void InvalidStatTextAndDisconnectedSessionCannotQueueTrainingCommands()
        {
            var training = CreateSession(training: true, deliverSnapshot: true);
            _view.Bind(training.Session);
            Assert.IsTrue(_view.SetLaunchContext(training.Session, training.Session.TimelineEpoch, MatchLaunchMode.Training));
            Assert.IsTrue(_view.SetOpen(true));
            Assert.IsTrue(_view.SelectMob(0));

            foreach (string invalid in new[] { "", "-1", "+1", "1.5", "9007199254740992" })
            {
                _view.SetStatText(invalid);
                Assert.IsFalse(_view.TrySetStacks(), "invalid exact integer text is refused: " + invalid);
            }
            Assert.AreEqual(0, TrainCommands(training.Transport).Count);

            training.Transport.Drop();
            _view.Refresh();
            Assert.AreEqual(SessionState.Reconnecting, training.Session.State);
            Assert.IsFalse(_view.ActionsAvailable);
            Assert.IsFalse(_view.TrySpawnCamp());
            training.Session.FlushInput();
            Assert.AreEqual(0, TrainCommands(training.Transport).Count);
        }

        [Test]
        public void CapturedActionCallbackCannotTargetAReboundSession()
        {
            var first = CreateSession(training: true, deliverSnapshot: true);
            _view.Bind(first.Session);
            Assert.IsTrue(_view.SetLaunchContext(first.Session, first.Session.TimelineEpoch, MatchLaunchMode.Training));
            Assert.IsTrue(_view.SetOpen(true));
            Assert.IsTrue(_view.SelectMob(1));
            var oldButton = FindButton("CampAction");
            Button.ButtonClickedEvent staleEvent = oldButton.onClick;

            var second = CreateSession(training: true, deliverSnapshot: true);
            _view.Bind(second.Session);
            Assert.IsTrue(second.Session.Training && second.Session.Phase.HasValue);
            Assert.IsTrue(_view.SetLaunchContext(second.Session, second.Session.TimelineEpoch, MatchLaunchMode.Training));
            Assert.IsTrue(_view.SetOpen(true));
            staleEvent.Invoke();

            Assert.AreEqual(0, TrainCommands(first.Transport).Count, "the old callback cannot enqueue on its retired session");
            Assert.AreEqual(0, TrainCommands(second.Transport).Count, "the old callback cannot borrow the newly bound session");
            Assert.IsTrue(_view.ActionsAvailable, "the fresh session is explicitly confirmed and open while the stale callback is rejected");
            Assert.IsTrue(_view.SelectMob(2));
            Assert.IsTrue(_view.TrySpawnCamp(), "a newly wired callback remains usable after the stale callback is rejected");
            AssertTrain(second.Transport, 0, 3, TrainingConsoleSelectors.MobChoices[2].Position, 0, Array.Empty<byte>());
            Assert.AreEqual(0, TrainCommands(first.Transport).Count);
        }

        [Test]
        public void CapturedActionCannotCrossSameSessionSourceClockCutEvenAfterEpochReconfirmation()
        {
            var training = CreateSession(training: true, deliverSnapshot: true);
            _view.Bind(training.Session);
            Assert.IsTrue(_view.SetLaunchContext(training.Session, training.Session.TimelineEpoch, MatchLaunchMode.Training));
            Assert.IsTrue(_view.SetOpen(true));
            Button.ButtonClickedEvent oldEvent = FindButton("CampAction").onClick;
            uint oldEpoch = training.Session.TimelineEpoch;
            Assert.AreEqual(50d, training.Session.ServerTimeMs, "the accepted initial snapshot establishes the source-time baseline");

            training.Transport.Deliver(new ServerMsg.Snapshot
            {
                Tick = 2,
                ServerTimeOverrideMs = 25,
                Phase = (byte)MatchPhase.Active,
                Training = true
            });
            _view.Refresh();
            Assert.AreEqual(25d, training.Session.ServerTimeMs);
            Assert.AreEqual(oldEpoch + 1, training.Session.TimelineEpoch, "the lower source time on a later tick creates a genuine epoch cut");
            Assert.IsFalse(_view.ActionsAvailable, "the source-clock cut revokes the old confirmation");
            Assert.IsTrue(_view.SetLaunchContext(training.Session, training.Session.TimelineEpoch, MatchLaunchMode.Training));
            Assert.IsTrue(_view.ActionsAvailable, "the new epoch is explicitly reconfirmed before invoking the stale event");
            Assert.IsTrue(_view.SetOpen(true));

            oldEvent.Invoke();
            Assert.AreEqual(0, TrainCommands(training.Transport).Count, "the captured old event remains invalid after same-session reconfirmation");
            Assert.IsTrue(_view.SelectMob(3));
            Assert.IsTrue(_view.TrySpawnCamp());
            AssertTrain(training.Transport, 0, 3, TrainingConsoleSelectors.MobChoices[3].Position, 0, Array.Empty<byte>());
        }

        [Test]
        public void TrainingActionFlushPreservesEarlierOrdinaryPendingInputOrder()
        {
            var training = CreateSession(training: true, deliverSnapshot: true);
            _view.Bind(training.Session);
            Assert.IsTrue(_view.SetLaunchContext(training.Session, training.Session.TimelineEpoch, MatchLaunchMode.Training));
            Assert.IsTrue(_view.SetOpen(true));
            training.Session.Input.Target(777);
            Assert.IsTrue(_view.TryClear());

            var inputs = InputMessages(training.Transport);
            Assert.AreEqual(1, inputs.Count, "the ordinary pending input and Training action share the normal flush");
            Assert.AreEqual(2, inputs[0].Commands.Count);
            Assert.AreEqual(CommandKind.Target, inputs[0].Commands[0].Kind);
            Assert.AreEqual(777u, inputs[0].Commands[0].ActorRef);
            Assert.AreEqual(CommandKind.Train, inputs[0].Commands[1].Kind);
            Assert.AreEqual((byte)5, inputs[0].Commands[1].TrainCommand);

            training.Session.FlushInput();
            Assert.AreEqual(1, InputMessages(training.Transport).Count, "the standard flush emptied the outbox");
        }

        [Test]
        public void ReentrantSendRebindDoesNotSendToOrPoisonTheNewSession()
        {
            var old = CreateSession(training: true, deliverSnapshot: true);
            _view.Bind(old.Session);
            Assert.IsTrue(_view.SetLaunchContext(old.Session, old.Session.TimelineEpoch, MatchLaunchMode.Training));
            Assert.IsTrue(_view.SetOpen(true));
            Assert.IsTrue(_view.SelectMob(4));
            SessionFixture fresh = null;
            old.Transport.OnSend = frame =>
            {
                if (!FrameHasTrain(frame)) return;
                old.Transport.OnSend = null;
                fresh = CreateSession(training: true, deliverSnapshot: true);
                _view.Bind(fresh.Session);
                Assert.IsTrue(_view.SetLaunchContext(fresh.Session, fresh.Session.TimelineEpoch, MatchLaunchMode.Training));
                Assert.IsTrue(_view.SetOpen(true));
            };

            Assert.IsTrue(_view.TrySpawnCamp());
            Assert.IsNotNull(fresh, "the transport callback rebound synchronously after recording the old Train frame");
            Assert.AreEqual(1, TrainCommands(old.Transport).Count, "one already-queued Train belongs to the old session");
            Assert.AreEqual(0, TrainCommands(fresh.Transport).Count, "reentrant binding cannot duplicate the Train on the new session");
            var status = _view.Panel.GetComponentsInChildren<TMP_Text>(true).Single(x => x.name == "Status");
            StringAssert.DoesNotContain("Request sent", status.text, "old-send feedback cannot overwrite the newly bound panel");
        }

        [Test]
        public void EscapeClosesFocusedConsoleOnceAndDestroyedViewRemovesCapturedListener()
        {
            var training = CreateSession(training: true, deliverSnapshot: true);
            _view.Bind(training.Session);
            Assert.IsTrue(_view.SetLaunchContext(training.Session, training.Session.TimelineEpoch, MatchLaunchMode.Training));
            Assert.IsTrue(_view.SetOpen(true));
            var field = _view.Panel.GetComponentsInChildren<TMP_InputField>(true).Single();
            EventSystem.current.SetSelectedGameObject(field.gameObject);
            field.ActivateInputField();
            Assert.IsTrue(_view.ContainsFocus);

            Assert.IsTrue(_view.HandleEscape(), "first Escape closes the console and releases its text focus");
            Assert.IsFalse(_view.IsOpen);
            Assert.IsFalse(_view.ContainsFocus);
            Assert.IsFalse(_view.HandleEscape(), "a second Escape is unhandled so the parent may process Leave once");
            Assert.AreEqual(SessionState.InMatch, training.Session.State);
            Assert.IsFalse(training.Transport.CloseCalled);

            Assert.IsTrue(_view.SetOpen(true));
            Assert.IsTrue(_view.SelectMob(0));
            Button.ButtonClickedEvent afterDestroy = FindButton("CampAction").onClick;
            UnityEngine.Object.DestroyImmediate(_hostObject);
            _hostObject = null;
            _view = null;
            afterDestroy.Invoke();
            training.Session.FlushInput();
            Assert.AreEqual(0, TrainCommands(training.Transport).Count, "a captured listener cannot enqueue after its owner is destroyed");
        }

        SessionFixture CreateSession(bool training, bool deliverSnapshot)
        {
            var fixture = new SessionFixture { Transport = new TestTransport() };
            fixture.Session = new Session(fixture.Transport, new SessionOptions
            {
                Url = "ws://training-console-test/ws",
                Profile = "training-console-test",
                Now = () => _now,
                ReconnectBaseMs = 500,
                MaxReconnectAttempts = 2
            });
            _sessions.Add(fixture);
            fixture.Session.Connect();
            fixture.Transport.Open();
            var matchId = new byte[16];
            matchId[0] = _nextMatchId++;
            fixture.Transport.Deliver(new ServerMsg.Welcome
            {
                Protocol = Wire.ProtocolVersion,
                MatchId = matchId,
                Session = new byte[16],
                PlayerId = 7,
                TickRate = 20,
                Map = new MapBlob(4, 4, new byte[16])
            });
            if (deliverSnapshot)
            {
                fixture.Transport.Deliver(new ServerMsg.Snapshot
                {
                    Tick = 1,
                    ServerTimeOverrideMs = 50,
                    Phase = (byte)MatchPhase.Active,
                    Training = training
                });
            }
            fixture.Transport.Sent.Clear();
            return fixture;
        }

        Button FindButton(string name)
        {
            var button = _view.Panel.GetComponentsInChildren<Button>(true).SingleOrDefault(x => x.name == name);
            Assert.IsNotNull(button, "expected named action button " + name);
            return button;
        }

        static List<WireCommand> TrainCommands(TestTransport transport)
        {
            var result = new List<WireCommand>();
            foreach (byte[] frame in transport.Sent)
            {
                var input = ClientMsg.Decode(frame) as ClientMsg.Input;
                if (input == null) continue;
                result.AddRange(input.Commands.Where(x => x.Kind == CommandKind.Train));
            }
            return result;
        }

        static List<ClientMsg.Input> InputMessages(TestTransport transport)
        {
            var result = new List<ClientMsg.Input>();
            foreach (byte[] frame in transport.Sent)
            {
                var input = ClientMsg.Decode(frame) as ClientMsg.Input;
                if (input != null) result.Add(input);
            }
            return result;
        }

        static bool FrameHasTrain(byte[] frame)
        {
            var input = ClientMsg.Decode(frame) as ClientMsg.Input;
            return input != null && input.Commands.Any(x => x.Kind == CommandKind.Train);
        }

        static void AssertTrain(TestTransport transport, int previousCount, byte command, uint id, ulong count, byte[] options)
        {
            var commands = TrainCommands(transport);
            Assert.AreEqual(previousCount + 1, commands.Count, "one Train command is flushed for this action");
            var actual = commands[commands.Count - 1];
            Assert.AreEqual(command, actual.TrainCommand);
            Assert.AreEqual(id, actual.TrainId);
            Assert.AreEqual(count, actual.TrainCount);
            CollectionAssert.AreEqual(options, actual.TrainOptions);
        }
    }
}
