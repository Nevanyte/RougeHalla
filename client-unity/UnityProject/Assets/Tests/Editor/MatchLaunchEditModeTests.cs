using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;

/// <summary>Actual MatchClient/account/decoded Session seams. Editor execution and browser routing are separate gates.</summary>
public sealed class MatchLaunchEditModeTests
{
    const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
    sealed class Request
    {
        public readonly TaskCompletionSource<AccountHttpResponse> Reply = new TaskCompletionSource<AccountHttpResponse>();
    }
    sealed class Accounts : IAccountTransport
    {
        public readonly List<Request> Requests = new List<Request>();
        public bool Immediate;
        public Task<AccountHttpResponse> GetProfileAsync(string url, string token, string passcode, CancellationToken cancellation)
        {
            var request = new Request(); Requests.Add(request);
            return Immediate ? Task.FromResult(Owned()) : request.Reply.Task;
        }
    }
    sealed class Credentials : IAccountCredentialStore
    {
        public string Read(string scope, string name) => null;
        public bool WriteConfirmed(string scope, string name, string token) => false;
    }
    sealed class Transport : ITransport
    {
        public event Action Opened;
        public event Action<byte[]> Received;
        public event Action<string> Closed;
        public readonly List<byte[]> Sent = new List<byte[]>();
        public string Url;
        public int Closes;
        public void Connect(string url) { Url = url; }
        public void Send(byte[] frame) { Sent.Add(frame); }
        public void Close() { Closes++; }
        public void Poll() { }
        public void Open() { Opened?.Invoke(); }
        public void Deliver(ServerMsg message) { Received?.Invoke(message.Encode()); }
        public void Drop() { Closed?.Invoke("launch test"); }
    }
    sealed class Fixture : IDisposable
    {
        public readonly GameObject Root = new GameObject("Launch mode fixture");
        public readonly MatchClient Client;
        public readonly AccountCoordinator Owner;
        public readonly Accounts Accounts = new Accounts();
        public readonly List<Transport> Matches = new List<Transport>();
        readonly EventSystem _priorEvents = EventSystem.current;
        GameObject _events;
        public MatchHud Hud;
        public Fixture(bool immediate = false)
        {
            Client = Root.AddComponent<MatchClient>(); Client.enabled = false;
            Client.PageUrl = "https://launch.example/play";
            Client.Url = "wss://launch.example/arena/ws";
            Client.TrainingUrl = "wss://launch.example/training/ws";
            Client.Profile = "Alice"; Client.Faction = 4;
            Accounts.Immediate = immediate;
            Owner = Root.AddComponent<AccountCoordinator>();
            Owner.Initialize(AccountEndpoint.FromPage(Client.PageUrl), Accounts, new Credentials());
            Field(Client, "<AccountOwner>k__BackingField", Owner);
            Field(Client, "_transportFactory", new Func<ITransport>(() =>
            {
                var arena = Client.Arena;
                if (Get(arena, "_actors") == null) Invoke(arena, "Awake");
                var transport = new Transport(); Matches.Add(transport); return transport;
            }));
        }
        public void InitializeHud()
        {
            _events = new GameObject("Launch fixture events", typeof(EventSystem), typeof(UnityEngine.InputSystem.UI.InputSystemUIInputModule));
            EventSystem.current = _events.GetComponent<EventSystem>();
            Hud = Root.AddComponent<MatchHud>(); Hud.Initialize(Client);
            Field(Client, "<Hud>k__BackingField", Hud);
        }
        public void Join(MatchLaunchMode mode) { Client.Join("alice", 4, mode); }
        // Await the exact production account worker for cancellation tests. Separate cases
        // exercise the public Join dispatcher/Hello, so no timing sleeps are needed here.
        public Task BeginOwned(MatchLaunchMode mode)
        {
            Assert.That(Client.SelectLaunchMode(mode), Is.True);
            return (Task)typeof(MatchClient).GetMethod("JoinOwned", Private).Invoke(Client,
                new object[] { "alice", 4, Client.LaunchTarget(mode) });
        }
        public void Welcome()
        {
            Matches.Last().Open();
            Matches.Last().Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion,
                MatchId = new byte[16], Session = new byte[16], PlayerId = 1, TickRate = 20,
                ServerMs = 50, Map = new MapBlob(8, 8, new byte[64]) });
        }
        public void Snapshot(bool training, uint tick = 1, double ms = 50)
        {
            Matches.Last().Deliver(new ServerMsg.Snapshot { Tick = tick, ServerTimeOverrideMs = ms, Training = training, Phase = 1,
                Me = new WireSelf { Id = 1, X = 64, Y = 64, Hp = 100, MaxHp = 100, Status = 1, Weapon = 0 } });
        }
        public void Dispose()
        {
            if (Root != null) UnityEngine.Object.DestroyImmediate(Root);
            if (_events != null) UnityEngine.Object.DestroyImmediate(_events);
            if (_priorEvents != null) EventSystem.current = _priorEvents;
        }
    }
    static void Field(object target, string name, object value) => target.GetType().GetField(name, Private).SetValue(target, value);
    static object Get(object target, string name) => target.GetType().GetField(name, Private).GetValue(target);
    static void Invoke(object target, string name) => target.GetType().GetMethod(name, Private).Invoke(target, null);
    static AccountHttpResponse Owned() => new AccountHttpResponse(200, new AccountReply {
        profile = new AccountProfile { name = "Alice", stats = new AccountStats() }, token = new string('c', 64), created = true });
    [Test]
    public void MissingTrainingNeverFallsBackOrStartsAnOwnershipRequest()
    {
        using (var f = new Fixture())
        {
            f.Client.TrainingUrl = ""; f.Join(MatchLaunchMode.Training);
            Assert.That(f.Client.SelectedLaunchMode, Is.EqualTo(MatchLaunchMode.Arena));
            Assert.That(f.Client.AccountUiError, Does.Contain("Training"));
            Assert.That(f.Accounts.Requests, Is.Empty); Assert.That(f.Matches, Is.Empty);
        }
    }
    [Test]
    public void CrossOriginTrainingCannotSendOwnerCredentialsOrStartAClaim()
    {
        using (var f = new Fixture())
        {
            f.Client.TrainingUrl = "wss://elsewhere.example/training/ws"; f.Join(MatchLaunchMode.Training);
            Assert.That(f.Accounts.Requests, Is.Empty); Assert.That(f.Matches, Is.Empty);
            Assert.That(f.Client.LaunchTarget(MatchLaunchMode.Arena).Available, Is.True);
        }
    }
    [Test]
    public async Task SwitchingModeWhileOwnerReplyIsDeferredInvalidatesTheOldIntent()
    {
        using (var f = new Fixture())
        {
            var pending = f.BeginOwned(MatchLaunchMode.Arena);
            Assert.That(f.Client.SelectLaunchMode(MatchLaunchMode.Training), Is.True);
            f.Accounts.Requests[0].Reply.SetResult(Owned()); await pending;
            Assert.That(f.Matches, Is.Empty); Assert.That(f.Client.Session, Is.Null);
            Assert.That(f.Client.SelectedLaunchMode, Is.EqualTo(MatchLaunchMode.Training));
        }
    }
    [Test]
    public async Task RapidModeChangesOnlyConnectTheCurrentOwnerIntentToItsCapturedTarget()
    {
        using (var f = new Fixture())
        {
            var first = f.BeginOwned(MatchLaunchMode.Arena);
            f.Client.SelectLaunchMode(MatchLaunchMode.Training); f.Client.SelectLaunchMode(MatchLaunchMode.Arena);
            var second = f.BeginOwned(MatchLaunchMode.Training);
            f.Accounts.Requests[0].Reply.SetResult(Owned()); await first;
            Assert.That(f.Matches, Is.Empty);
            f.Accounts.Requests[1].Reply.SetResult(Owned()); await second;
            Assert.That(f.Matches[0].Url, Is.EqualTo("wss://launch.example/training/ws"));
        }
    }
    [Test]
    public async Task EditingTrainingTargetDuringOwnerRequestCannotUseItsCapturedToken()
    {
        using (var f = new Fixture())
        {
            var pending = f.BeginOwned(MatchLaunchMode.Training); f.Client.TrainingUrl = "wss://launch.example/other/ws";
            f.Accounts.Requests[0].Reply.SetResult(Owned()); await pending;
            Assert.That(f.Matches, Is.Empty); Assert.That(f.Client.AccountUiError, Does.Contain("connection changed"));
        }
    }
    [Test]
    public async Task SynchronousFactionCancellationCannotOverwriteOrRelaunchANewerMode()
    {
        using (var f = new Fixture())
        {
            var pending = f.BeginOwned(MatchLaunchMode.Arena); f.Accounts.Immediate = true;
            bool switched = false;
            f.Owner.Flow.Changed += state =>
            {
                if (!switched && state.State == AccountHubState.Idle)
                { switched = true; f.Join(MatchLaunchMode.Training); }
            };
            f.Client.Join("alice", 2);
            f.Accounts.Requests[0].Reply.SetResult(Owned()); await pending;
            Assert.That(switched, Is.True); Assert.That(f.Matches, Has.Count.EqualTo(1));
            Assert.That(f.Matches[0].Url, Is.EqualTo(f.Client.TrainingUrl));
            Assert.That(f.Client.Faction, Is.EqualTo(4)); Assert.That(f.Client.AccountUiError, Is.Empty);
        }
    }
    [TestCase(false)]
    [TestCase(true)]
    public async Task LeaveOrDestroyDuringOwnershipRequestPreventsLateSocketCreation(bool destroy)
    {
        using (var f = new Fixture())
        {
            var pending = f.BeginOwned(MatchLaunchMode.Training);
            if (destroy) UnityEngine.Object.DestroyImmediate(f.Root); else f.Client.Leave();
            f.Accounts.Requests[0].Reply.SetResult(Owned()); await pending;
            Assert.That(f.Matches, Is.Empty);
        }
    }
    [TestCase(MatchLaunchMode.Arena, false)]
    [TestCase(MatchLaunchMode.Training, true)]
    public void OrdinaryOwnedTargetAndModeRemainUnconfirmedUntilAnAcceptedMatchingSnapshot(MatchLaunchMode mode, bool training)
    {
        using (var f = new Fixture(true))
        {
            f.Join(mode); Assert.That(f.Matches, Has.Count.EqualTo(1));
            Assert.That(f.Matches[0].Url, Is.EqualTo(training ? f.Client.TrainingUrl : f.Client.Url));
            f.Welcome();
            var hello = (ClientMsg.Hello)ClientMsg.Decode(f.Matches[0].Sent[0]);
            Assert.That(hello.Profile, Is.EqualTo("Alice")); Assert.That(hello.Faction, Is.EqualTo((byte)4));
            CollectionAssert.AreEqual(System.Text.Encoding.UTF8.GetBytes(new string('c', 64)), hello.Ticket);
            Assert.That(f.Client.Session.Latest, Is.Null); Assert.That(f.Client.LaunchVerified, Is.False);
            Invoke(f.Client, "Update");
            Assert.That(f.Matches[0].Sent.Select(ClientMsg.Decode).OfType<ClientMsg.Input>(), Is.Empty);
            f.Snapshot(training);
            Assert.That(f.Client.LaunchVerified, Is.True); Assert.That(f.Client.ConfirmedPractice, Is.EqualTo(training));
            Assert.That(f.Client.SelectedLaunchMode, Is.EqualTo(mode));
        }
    }
    [TestCase(MatchLaunchMode.Arena, true)]
    [TestCase(MatchLaunchMode.Training, false)]
    public void WrongDeliveredModeClosesTheExactSessionWithoutFallbackOrGameplayInput(MatchLaunchMode mode, bool deliveredTraining)
    {
        using (var f = new Fixture(true))
        {
            f.Join(mode); f.Welcome(); f.Snapshot(deliveredTraining);
            Assert.That(f.Client.Session, Is.Null); Assert.That(f.Matches[0].Closes, Is.GreaterThan(0));
            Assert.That(f.Client.SelectedLaunchMode, Is.EqualTo(mode)); Assert.That(f.Matches, Has.Count.EqualTo(1));
            Assert.That(f.Client.AccountUiError, Does.Contain("server returned"));
            Assert.That(f.Matches[0].Sent.Select(ClientMsg.Decode).OfType<ClientMsg.Input>(), Is.Empty);
        }
    }
    [Test]
    public void ReconnectWelcomeRevokesConfirmationAndRequiresANewMatchingFact()
    {
        using (var f = new Fixture(true))
        {
            f.Join(MatchLaunchMode.Training); f.Welcome(); f.Snapshot(true);
            uint epoch = f.Client.Session.TimelineEpoch;
            f.Matches[0].Drop(); f.Welcome();
            Assert.That(f.Client.Session.TimelineEpoch, Is.GreaterThan(epoch));
            Assert.That(f.Client.LaunchVerified, Is.False); Assert.That(f.Client.ConfirmedPractice, Is.False);
            f.Snapshot(false); Assert.That(f.Client.Session, Is.Null);
            Assert.That(f.Client.AccountUiError, Does.Contain("server returned Arena"));
        }
    }
    [Test]
    public void RetiredCallbacksCannotResetOrRefuseANewerSession()
    {
        using (var f = new Fixture(true))
        {
            f.Join(MatchLaunchMode.Training); f.Welcome(); f.Snapshot(true);
            var old = f.Client.Session;
            var snapshot = (Action<ServerMsg.Snapshot>)Get(f.Client, "_boundLaunchSnapshot");
            var state = (Action<SessionState>)Get(f.Client, "_boundLaunchState");
            var timeline = (Action)Get(f.Client, "_boundLaunchTimeline");
            f.Client.Leave(); f.Join(MatchLaunchMode.Arena); f.Welcome(); f.Snapshot(false);
            var current = f.Client.Session;
            snapshot(old.Latest); state(SessionState.Failed); timeline();
            Assert.That(f.Client.Session, Is.SameAs(current)); Assert.That(f.Client.LaunchVerified, Is.True);
            Assert.That(f.Matches[1].Closes, Is.EqualTo(0)); Assert.That(f.Client.AccountUiError, Is.Empty);
        }
    }
    [Test]
    public void ReentrantLeaveCallbackCannotHaveItsReplacementCancelledOrArenaDestroyed()
    {
        using (var f = new Fixture(true))
        {
            f.Join(MatchLaunchMode.Arena); f.Welcome(); f.Snapshot(false);
            f.Client.Session.StateChanged += state => { if (state == SessionState.Ended) f.Join(MatchLaunchMode.Training); };
            f.Client.Leave();
            Assert.That(f.Matches, Has.Count.EqualTo(2)); Assert.That(f.Client.Session, Is.Not.Null);
            Assert.That(f.Matches[1].Url, Is.EqualTo(f.Client.TrainingUrl));
            Assert.That(f.Owner.Flow.Snapshot.State, Is.EqualTo(AccountHubState.Owned));
            Assert.That(f.Client.Arena, Is.Not.Null); Assert.That(f.Client.Arena.gameObject.activeSelf, Is.True);
        }
    }
    [Test]
    public void PendingMenuAndPracticeCopyFollowDeliveredFactAndPlayAgainPreservesTraining()
    {
        using (var f = new Fixture(true))
        {
            f.InitializeHud(); f.Join(MatchLaunchMode.Training); f.Welcome();
            var menu = (RectTransform)Get(f.Hud, "_menu");
            Assert.That(menu.gameObject.activeSelf, Is.True); Assert.That(menu.GetComponent<CanvasGroup>().interactable, Is.False);
            Assert.That(f.Hud.BlocksKeyboardInput, Is.True); Assert.That(f.Client.ConfirmedPractice, Is.False);
            f.Hud.ShowPlayerFlow(0);
            Assert.That(f.Hud.QuestJournal.IsVisible, Is.False, "pending mode cannot launch J/player flows");
            Assert.That(Get(f.Hud.TacticalMap, "_bound"), Is.Null, "pending mode cannot expose reliable planning controls");
            f.Snapshot(true); Assert.That(menu.gameObject.activeSelf, Is.False);
            Field(f.Hud, "_nextMetricsAt", 0d); Invoke(f.Hud, "TickMetrics");
            Assert.That(((TMP_Text)Get(f.Hud, "_phaseStrip")).text, Does.Contain("PRACTICE"));
            f.Matches[0].Deliver(new ServerMsg.Events { Tick = 2, List = new List<WireEvent> { new WireEvent { Kind = EventKind.MatchEnded } } });
            Invoke(f.Hud, "JoinAgain");
            Assert.That(f.Matches, Has.Count.EqualTo(2)); Assert.That(f.Matches[1].Url, Is.EqualTo(f.Client.TrainingUrl));
            f.Client.Leave(); Assert.That(f.Client.SelectedLaunchMode, Is.EqualTo(MatchLaunchMode.Training));
            Assert.That(menu.gameObject.activeSelf, Is.True); Assert.That(menu.GetComponent<CanvasGroup>().interactable, Is.True);
        }
    }
    [Test]
    public void EndingBeforeTheFirstModeFactUnlocksRecoveryAndLeavePermitsAnotherDestination()
    {
        using (var f = new Fixture(true))
        {
            f.InitializeHud(); f.Join(MatchLaunchMode.Arena); f.Welcome();
            f.Matches[0].Deliver(new ServerMsg.Events { Tick = 1, List = new List<WireEvent> { new WireEvent { Kind = EventKind.MatchEnded } } });
            var menu = (RectTransform)Get(f.Hud, "_menu");
            Assert.That(f.Client.LaunchVerified, Is.False); Assert.That(menu.gameObject.activeSelf, Is.True);
            Assert.That(menu.GetComponent<CanvasGroup>().interactable, Is.True);
            Assert.That(f.Client.SelectLaunchMode(MatchLaunchMode.Training), Is.False, "a retained seat must be left explicitly");
            Assert.That(f.Client.AccountUiError, Does.Contain("Leave / menu"));
            f.Client.Leave(); Assert.That(f.Client.SelectLaunchMode(MatchLaunchMode.Training), Is.True);
            Assert.That(f.Client.Session, Is.Null);
        }
    }
}
