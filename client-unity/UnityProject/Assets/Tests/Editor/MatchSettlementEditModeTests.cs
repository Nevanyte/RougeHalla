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
using UnityEngine.Rendering.Universal;

/// <summary>Actual MatchClient/account/decoded Session seams. Editor execution and browser routing are separate gates.</summary>
public sealed class MatchSettlementEditModeTests
{
    const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
    sealed class Request
    {
        public readonly TaskCompletionSource<AccountHttpResponse> Reply = new TaskCompletionSource<AccountHttpResponse>();
    }
    sealed class Accounts : IAccountTransport, IAccountApiTransport
    {
        public readonly List<Request> Requests = new List<Request>();
        public bool Immediate;
        public readonly List<ReceiptRequest> Reads = new List<ReceiptRequest>();
        public Task<AccountApiResponse> SendAsync(AccountApiRequest request, CancellationToken cancellation)
        {
            var read = new ReceiptRequest { Request = request, Cancellation = cancellation };
            Reads.Add(read); return read.Reply.Task;
        }
        public Task<AccountHttpResponse> GetProfileAsync(string url, string token, string passcode, CancellationToken cancellation)
        {
            var request = new Request(); Requests.Add(request);
            return Immediate ? Task.FromResult(Owned()) : request.Reply.Task;
        }
    }
    sealed class ReceiptRequest
    {
        public AccountApiRequest Request;
        public CancellationToken Cancellation;
        public readonly TaskCompletionSource<AccountApiResponse> Reply = new TaskCompletionSource<AccountApiResponse>();
    }
    sealed class DelayRequest
    {
        public int Milliseconds;
        public readonly TaskCompletionSource<bool> Reply = new TaskCompletionSource<bool>();
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
        readonly List<GameObject> _arenas = new List<GameObject>();
        readonly List<Light2D> _lights = new List<Light2D>();
        readonly Light2D[] _priorRegisteredLights = RegisteredLights();
        readonly EventSystem _priorEvents = EventSystem.current;
        readonly GameObject _priorSelection = EventSystem.current != null ? EventSystem.current.currentSelectedGameObject : null;
        GameObject _events;
        public MatchHud Hud;
        public double Now = 10000;
        public readonly List<DelayRequest> Delays = new List<DelayRequest>();
        public readonly byte[] MatchId = Enumerable.Range(0, 16).Select(i => (byte)i).ToArray();
        public Fixture(bool immediate = false)
        {
            Client = Root.AddComponent<MatchClient>(); Client.enabled = false;
            Field(Client, "_settlementNow", new Func<double>(() => Now));
            Field(Client, "_settlementDelay", new Func<int, CancellationToken, Task>((ms, token) =>
            {
                var delay = new DelayRequest { Milliseconds = ms }; Delays.Add(delay);
                token.Register(() => delay.Reply.TrySetCanceled()); return delay.Reply.Task;
            }));
            Client.PageUrl = "https://launch.example/play";
            Client.Url = "wss://launch.example/arena/ws";
            Client.TrainingUrl = "wss://launch.example/training/ws";
            Client.Profile = "Alice"; Client.Faction = 4;
            Accounts.Immediate = immediate;
            Owner = Root.AddComponent<AccountCoordinator>();
            Owner.Initialize(AccountEndpoint.FromPage(Client.PageUrl), Accounts, new Credentials());
            Field(Client, "<AccountOwner>k__BackingField", Owner);
            Assert.That(Client.AccountFlow, Is.SameAs(Owner.Flow));
            Assert.That(Client.IsDiagnostic, Is.False);
            Assert.That(Client.Session, Is.Null);
            Assert.That(Client.LaunchTarget(MatchLaunchMode.Arena).Available, Is.True);
            Assert.That(Client.LaunchTarget(MatchLaunchMode.Training).Available, Is.True);
            Field(Client, "_transportFactory", new Func<ITransport>(() =>
            {
                var arena = Client.Arena;
                Assert.That(arena, Is.Not.Null, "the public launch must create its real ArenaView");
                _arenas.Add(arena.gameObject);
                arena.transform.SetParent(Root.transform, false);
                try
                {
                    if (Get(arena, "_actors") == null) Invoke(arena, "Awake");
                    Assert.That(Get(arena, "_actors"), Is.Not.Null);
                    Assert.That(Get(arena, "_wishes"), Is.Not.Null);
                }
                finally
                {
                    // Awake creates registered ExecuteAlways lights even in EditMode.
                    // Keep ownership if a later part of initialization throws as well.
                    _lights.AddRange(arena.GetComponentsInChildren<Light2D>(true));
                }
                var transport = new Transport(); Matches.Add(transport); return transport;
            }));
        }
        public void InitializeHud()
        {
            // Use the same actual EditMode registration lifecycle as the passing input
            // fixtures. A plain EventSystem has not registered merely by being created.
            _events = new GameObject("Launch fixture events", typeof(Roguehalla.Client.Tests.UiInputRoutingEventSystem));
            var system = _events.GetComponent<EventSystem>();
            system.enabled = false; system.enabled = true;
            EventSystem.current = system;
            Assert.That(EventSystem.current, Is.SameAs(system), "owned EventSystem must be registered before HUD setup");
            Hud = Root.AddComponent<MatchHud>(); Hud.Initialize(Client);
            Field(Client, "<Hud>k__BackingField", Hud);
            Assert.That(EventSystem.current, Is.SameAs(system), "HUD must reuse the registered owned EventSystem");
        }
        public void Join(MatchLaunchMode mode) { Client.Join("alice", 4, mode); }
        public async Task JoinReady(MatchLaunchMode mode)
        {
            int requests = Accounts.Requests.Count, matches = Matches.Count;
            Join(mode);
            await WaitFor(() => Matches.Count > matches && Client.Session != null && Matches.Last().Url != null || !string.IsNullOrEmpty(Client.AccountUiError) ||
                Owner.Flow.Snapshot.State == AccountHubState.Failed);
            Assert.That(Owner.Flow.Snapshot.Failure, Is.EqualTo(AccountFailure.None), "owned reply must be valid before testing Session behavior");
            Assert.That(Owner.Flow.Snapshot.ConnectionFailure, Is.EqualTo(AccountConnectionFailure.None));
            Assert.That(Owner.Flow.Snapshot.State, Is.EqualTo(AccountHubState.Owned));
            Assert.That(Client.AccountUiError, Is.Empty);
            Assert.That(Accounts.Requests.Count, Is.EqualTo(requests + 1), "normal public Join must check profile ownership");
            Assert.That(Matches.Count, Is.EqualTo(matches + 1), "normal public Join must create exactly one transport");
            Assert.That(Client.Session, Is.Not.Null);
            Assert.That(Matches.Last().Url, Is.EqualTo(Client.LaunchTarget(mode).Url), "transport.Connect must reach the chosen owned target");
        }
        public void Welcome(byte[] matchId = null)
        {
            Assert.That(Client.Session, Is.Not.Null, "normal Join must finish before a server Welcome can be delivered");
            Assert.That(Matches, Is.Not.Empty);
            Assert.That(Matches.Last().Url, Is.Not.Null, "transport.Connect must run before server delivery");
            Matches.Last().Open();
            Matches.Last().Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion,
                MatchId = matchId ?? MatchId, Session = new byte[16], PlayerId = 1, TickRate = 20,
                ServerMs = 50, Map = new MapBlob(8, 8, new byte[64]) });
        }
        public void Snapshot(bool training, uint tick = 1, double ms = 50)
        {
            Matches.Last().Deliver(new ServerMsg.Snapshot { Tick = tick, ServerTimeOverrideMs = ms, Training = training, Phase = 1,
                Me = new WireSelf { Id = 1, X = 64, Y = 64, Hp = 100, MaxHp = 100, Status = 1, Weapon = 0 } });
        }
        public void Result(uint gv = 999)
        {
            Matches.Last().Deliver(new ServerMsg.Events { Tick = 1, List = new List<WireEvent> {
                new WireEvent { Kind = EventKind.Result, Result = new WireResult { Outcome = 0, Place = 1, Players = 8,
                    GvTotal = gv, GvWin = 500, Kills = 4, DurationSec = 90 } } } });
        }
        public void Complete(int index, AccountSettlementStatus status = AccountSettlementStatus.Committed,
            long credit = 7, AccountSettlementOutcome? outcome = AccountSettlementOutcome.Won)
        {
            var request = Accounts.Reads[index];
            var receipt = status == AccountSettlementStatus.Unknown
                ? new AccountSettlement(request.Request.MatchId, status)
                : new AccountSettlement(request.Request.MatchId, status, outcome, credit);
            request.Reply.SetResult(new AccountApiResponse(200, settlement: receipt));
        }
        public void Dispose()
        {
            try
            {
                // The player component's OnDestroy/deferred Destroy is not the fixture's
                // EditMode lifetime. Exercise normal Leave while its objects still live.
                if (Client != null) Client.Leave();
                foreach (var read in Accounts.Reads) read.Reply.TrySetCanceled();
            }
            finally
            {
                try
                {
                    // JoinCore creates independent roots; retain every retired/replaced
                    // Arena too, and retire its registered light before the next case.
                    for (int i = _arenas.Count - 1; i >= 0; i--)
                        if (_arenas[i] != null)
                        {
                            _arenas[i].SetActive(false);
                            UnityEngine.Object.DestroyImmediate(_arenas[i]);
                        }
                    if (Root != null) UnityEngine.Object.DestroyImmediate(Root);
                }
                finally
                {
                    if (_events != null)
                    {
                        var system = _events.GetComponent<EventSystem>();
                        if (EventSystem.current == system) system.SetSelectedGameObject(null);
                        system.enabled = false;
                        UnityEngine.Object.DestroyImmediate(_events);
                    }
                    if (_priorEvents != null && _priorEvents.isActiveAndEnabled)
                    {
                        EventSystem.current = _priorEvents;
                        if (_priorSelection != null && _priorSelection.activeInHierarchy)
                            _priorEvents.SetSelectedGameObject(_priorSelection);
                    }
                }
                Assert.That(_arenas.All(arena => arena == null), Is.True, "every fixture-owned Arena must be destroyed immediately");
                Assert.That(_lights.All(light => light == null), Is.True, "every fixture-owned light must be destroyed");
                CollectionAssert.AreEquivalent(_priorRegisteredLights, RegisteredLights(), "fixture must restore the real URP light registry without mutating unrelated lights");
                var expectedEvents = _priorEvents != null && _priorEvents.isActiveAndEnabled ? _priorEvents : null;
                Assert.That(EventSystem.current, Is.SameAs(expectedEvents), "fixture must restore the prior registered EventSystem");
            }
        }
    }
    // Read-only observation of the installed URP's actual registration list. Never
    // clear/remove entries or treat a logged package error as an expected test result.
    static Light2D[] RegisteredLights()
    {
        var manager = typeof(Light2D).Assembly.GetType("UnityEngine.Rendering.Universal.Light2DManager", true);
        var property = manager.GetProperty("lights", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
        Assert.That(property, Is.Not.Null);
        return ((System.Collections.IEnumerable)property.GetValue(null)).Cast<Light2D>().ToArray();
    }
    static void Field(object target, string name, object value) => target.GetType().GetField(name, Private).SetValue(target, value);
    static object Get(object target, string name) => target.GetType().GetField(name, Private).GetValue(target);
    static void Invoke(object target, string name) => target.GetType().GetMethod(name, Private).Invoke(target, null);
    static AccountHttpResponse Owned() => new AccountHttpResponse(200, new AccountReply {
        profile = new AccountProfile { name = "Alice", gv = 13, gvLifetime = 17,
            stats = new AccountStats { runs = 0, wins = 0, draws = 0, deaths = 0, kills = 0 } },
        token = new string('c', 64), created = true });
    static async Task WaitFor(Func<bool> completed)
    {
        var timeout = System.Diagnostics.Stopwatch.StartNew();
        while (!completed() && timeout.Elapsed < TimeSpan.FromSeconds(5)) await Task.Delay(1);
        Assert.That(completed(), Is.True, "public Join did not complete its ownership/session prerequisite");
    }
    [Test]
    public async Task GenuineResultBeforeModeConfirmationNeedsAnAcceptedOwnedArenaFactAndExplicitCheck()
    {
        using (var f = new Fixture(true))
        {
            await f.JoinReady(MatchLaunchMode.Arena); f.Welcome();
            Assert.That(f.Accounts.Reads, Is.Empty);
            f.Result(); Assert.That(f.Accounts.Reads, Is.Empty, "Welcome.Training=false is not an accepted Arena fact");
            Assert.That(f.Client.CanCheckSettlement, Is.False);
            f.Snapshot(false); Assert.That(f.Accounts.Reads, Is.Empty, "a later mode fact must not silently restart a postponed check");
            f.Client.CheckSettlementAgain(); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(1));
            var request = f.Accounts.Reads[0].Request;
            Assert.That(request.Url, Is.EqualTo("https://launch.example/api/profile/Alice/matches/00010203-0405-0607-0809-0a0b0c0d0e0f/settlement"));
            Assert.That(request.Method, Is.EqualTo("GET")); Assert.That(request.ReadKind, Is.EqualTo(AccountApiReadKind.Settlement));
            Assert.That(f.Client.SettlementText, Is.EqualTo("Checking saved credit…"));
            f.Complete(0); await WaitFor(() => f.Client.SettlementText.Contains("confirmed: +7 GV"));
            Assert.That(f.Owner.Snapshot.Profile.Gv, Is.EqualTo(13), "receipt credit must never be added to the loaded balance");
            Assert.That(f.Owner.Snapshot.ResultBankConfirmed, Is.False);
            Assert.That(f.Accounts.Requests, Has.Count.EqualTo(1), "the result must not open/claim the profile again");
            Assert.That(f.Client.Session.LastResult.GvTotal, Is.EqualTo(999), "wire reward and saved credit are independent facts");
            f.Client.Leave(); Assert.That(f.Accounts.Requests, Has.Count.EqualTo(1), "Leave must not open/claim the profile");
        }
    }

    [Test]
    public async Task AcceptedArenaWithoutAGenuineResultNeverSendsAReceiptRead()
    {
        using (var f = new Fixture(true))
        {
            await f.JoinReady(MatchLaunchMode.Arena); f.Welcome(); f.Snapshot(false);
            Assert.That(f.Client.LaunchVerified, Is.True); Assert.That(f.Client.Session.LastResult, Is.Null);
            f.Client.CheckSettlementAgain();
            Assert.That(f.Accounts.Reads, Is.Empty); Assert.That(f.Client.SettlementText, Is.Empty);
            Assert.That(f.Client.CanCheckSettlement, Is.False);
        }
    }

    [Test]
    public async Task AcceptedTrainingWithAGenuineResultNeverQueriesOrClaimsSavedCredit()
    {
        using (var f = new Fixture(true))
        {
            await f.JoinReady(MatchLaunchMode.Training); f.Welcome(); f.Snapshot(true); f.Result();
            Assert.That(f.Client.ConfirmedPractice, Is.True); Assert.That(f.Client.Session.LastResult, Is.Not.Null);
            f.Client.CheckSettlementAgain();
            Assert.That(f.Accounts.Reads, Is.Empty); Assert.That(f.Client.SettlementText, Is.Empty);
            Assert.That(f.Client.CanCheckSettlement, Is.False); Assert.That(f.Owner.Snapshot.ResultBankConfirmed, Is.False);
        }
    }

    [TestCase(false, 0L)]
    [TestCase(true, 0L)]
    [TestCase(false, 9007199254740991L)]
    public async Task CommittedZeroVoidAndMaximumCreditsAreDisplayedWithoutBalanceInference(bool isVoid, long credit)
    {
        using (var f = new Fixture(true))
        {
            await f.JoinReady(MatchLaunchMode.Arena); f.Welcome(); f.Snapshot(false); f.Result();
            f.Complete(0, credit: credit, outcome: isVoid ? (AccountSettlementOutcome?)null : AccountSettlementOutcome.Won);
            await WaitFor(() => f.Client.SettlementText.Contains("confirmed: +"));
            Assert.That(f.Client.SettlementText, Does.Contain("+" + credit + " GV"));
            Assert.That(f.Client.SettlementText.Contains("Match voided"), Is.EqualTo(isVoid));
            Assert.That(f.Owner.Snapshot.Profile.Gv, Is.EqualTo(13)); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(1));
        }
    }

    [Test]
    public async Task UnknownOnlyBurstHasThreeSequentialReadsAtTwoAndFiveSecondsAndManualCooldown()
    {
        using (var f = new Fixture(true))
        {
            await f.JoinReady(MatchLaunchMode.Arena); f.Welcome(); f.Snapshot(false); f.Result();
            f.Client.CheckSettlementAgain(); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(1), "in-flight manual click cannot overlap");
            f.Complete(0, AccountSettlementStatus.Unknown); await WaitFor(() => f.Delays.Count == 1);
            Assert.That(f.Delays[0].Milliseconds, Is.EqualTo(2000)); Assert.That(f.Client.CanCheckSettlement, Is.False);
            Assert.That(f.Client.SettlementText, Is.EqualTo("Saved credit not confirmed for this match."));
            f.Delays[0].Reply.SetResult(true); await WaitFor(() => f.Accounts.Reads.Count == 2);
            f.Complete(1, AccountSettlementStatus.Unknown); await WaitFor(() => f.Delays.Count == 2);
            Assert.That(f.Delays[1].Milliseconds, Is.EqualTo(5000));
            f.Delays[1].Reply.SetResult(true); await WaitFor(() => f.Accounts.Reads.Count == 3);
            f.Complete(2, AccountSettlementStatus.Unknown);
            await WaitFor(() => Get(f.Client, "_settlementCancellation") == null);
            Assert.That(f.Delays, Has.Count.EqualTo(2)); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(3));
            f.Now = 14999; f.Client.CheckSettlementAgain(); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(3));
            f.Now = 15000; Assert.That(f.Client.CanCheckSettlement, Is.True);
            f.Client.CheckSettlementAgain(); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(4));
            f.Complete(3); await WaitFor(() => f.Client.SettlementText.Contains("confirmed: +7"));
        }
    }

    [TestCase(403)]
    [TestCase(408)]
    [TestCase(429)]
    [TestCase(500)]
    [TestCase(503)]
    public async Task HttpErrorsStopTheBurstAndNeverBecomeUnknownOrSaved(int status)
    {
        using (var f = new Fixture(true))
        {
            await f.JoinReady(MatchLaunchMode.Arena); f.Welcome(); f.Snapshot(false); f.Result();
            f.Accounts.Reads[0].Reply.SetResult(new AccountApiResponse(status, error: new AccountApiError(AccountApiFailure.Unavailable)));
            await WaitFor(() => f.Client.SettlementText == "Saved credit could not be checked.");
            Assert.That(f.Delays, Is.Empty); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(1));
            Assert.That(f.Owner.Snapshot.ResultBankConfirmed, Is.False);
        }
    }

    [TestCase(false)]
    [TestCase(true)]
    public async Task TimelineCutCancelsSuccessAndErrorAndRequiresAnExplicitNewBurst(bool error)
    {
        using (var f = new Fixture(true))
        {
            await f.JoinReady(MatchLaunchMode.Arena); f.Welcome(); f.Snapshot(false); f.Result();
            uint origin = f.Client.Session.TimelineEpoch;
            f.Snapshot(false, 2, 25);
            Assert.That(f.Client.Session.TimelineEpoch, Is.GreaterThan(origin));
            Assert.That(f.Client.LaunchVerified, Is.True); Assert.That(f.Accounts.Reads[0].Cancellation.IsCancellationRequested, Is.True);
            if (error) f.Accounts.Reads[0].Reply.SetResult(new AccountApiResponse(503)); else f.Complete(0);
            await WaitFor(() => !(bool)Get(f.Client, "_settlementInFlight"));
            Assert.That(f.Client.SettlementText, Does.Contain("paused")); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(1));
            f.Now += 5000; f.Client.CheckSettlementAgain(); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(2));
            f.Complete(1); await WaitFor(() => f.Client.SettlementText.Contains("confirmed: +7"));
        }
    }

    [Test]
    public async Task ReconnectCannotRestartOrClaimUntilAFreshSameMatchArenaFactAndManualAction()
    {
        using (var f = new Fixture(true))
        {
            await f.JoinReady(MatchLaunchMode.Arena); f.Welcome(); f.Snapshot(false); f.Result();
            f.Matches.Last().Drop(); f.Welcome();
            f.Complete(0); await WaitFor(() => !(bool)Get(f.Client, "_settlementInFlight"));
            f.Now += 5000; f.Client.CheckSettlementAgain();
            Assert.That(f.Client.CanCheckSettlement, Is.False); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(1));
            Assert.That(f.Client.SettlementText, Does.Contain("paused"));
            f.Snapshot(false); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(1));
            f.Client.CheckSettlementAgain(); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(2));
            f.Complete(1); await WaitFor(() => f.Client.SettlementText.Contains("confirmed: +7"));
        }
    }

    [Test]
    public async Task DifferentWelcomeCannotPairRetainedLastResultWithANewMatchUuid()
    {
        using (var f = new Fixture(true))
        {
            await f.JoinReady(MatchLaunchMode.Arena); f.Welcome(); f.Snapshot(false); f.Result();
            var retained = f.Client.Session.LastResult;
            f.Matches.Last().Drop(); f.Welcome(Enumerable.Repeat((byte)255, 16).ToArray());
            f.Complete(0); await WaitFor(() => !(bool)Get(f.Client, "_settlementInFlight"));
            f.Snapshot(false); f.Now += 5000; f.Client.CheckSettlementAgain();
            Assert.That(f.Client.Session.LastResult, Is.SameAs(retained)); Assert.That(f.Client.SettlementText, Is.Empty);
            Assert.That(f.Accounts.Reads, Has.Count.EqualTo(1));
            f.Result(); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(2));
            Assert.That(f.Accounts.Reads[1].Request.MatchId, Is.EqualTo("ffffffff-ffff-ffff-ffff-ffffffffffff"));
            f.Complete(1); await WaitFor(() => f.Client.SettlementText.Contains("confirmed: +7"));
        }
    }

    [Test]
    public async Task DuplicateDecodedResultFencesTheOldIdentityWithoutReplenishingAutomaticBudget()
    {
        using (var f = new Fixture(true))
        {
            await f.JoinReady(MatchLaunchMode.Arena); f.Welcome(); f.Snapshot(false); f.Result();
            var first = f.Client.Session.LastResult; f.Result();
            Assert.That(f.Client.Session.LastResult, Is.Not.SameAs(first));
            Assert.That(f.Accounts.Reads, Has.Count.EqualTo(1)); Assert.That(f.Accounts.Reads[0].Cancellation.IsCancellationRequested, Is.True);
            f.Complete(0); await WaitFor(() => !(bool)Get(f.Client, "_settlementInFlight"));
            Assert.That(f.Client.SettlementText, Does.Contain("paused"));
            f.Now += 5000; f.Client.CheckSettlementAgain(); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(2));
            f.Complete(1); await WaitFor(() => f.Client.SettlementText.Contains("confirmed: +7"));
        }
    }

    [TestCase(false)]
    [TestCase(true)]
    public async Task OwnerChangeHidesTheRowAndFencesBothOldSuccessAndError(bool error)
    {
        using (var f = new Fixture(true))
        {
            await f.JoinReady(MatchLaunchMode.Arena); f.Welcome(); f.Snapshot(false); f.Result();
            f.Owner.Flow.SelectName("Bob"); Assert.That(f.Accounts.Reads[0].Cancellation.IsCancellationRequested, Is.True);
            if (error) f.Accounts.Reads[0].Reply.SetResult(new AccountApiResponse(403)); else f.Complete(0);
            await WaitFor(() => !(bool)Get(f.Client, "_settlementInFlight"));
            f.Now += 5000; f.Client.CheckSettlementAgain();
            Assert.That(f.Client.SettlementText, Is.Empty); Assert.That(f.Client.CanCheckSettlement, Is.False);
            Assert.That(f.Accounts.Reads, Has.Count.EqualTo(1)); Assert.That(f.Accounts.Requests, Has.Count.EqualTo(1));
        }
    }

    [Test]
    public async Task LeaveIsImmediateAndRetiredCallbacksCannotTouchTheReplacementResults()
    {
        using (var f = new Fixture(true))
        {
            await f.JoinReady(MatchLaunchMode.Arena); f.Welcome(); f.Snapshot(false); f.Result();
            var retired = (Action<ServerMsg.Events>)Get(f.Client, "_boundSettlementEvents");
            var oldResult = f.Client.Session.LastResult;
            f.Client.Leave(); Assert.That(f.Client.Session, Is.Null); Assert.That(f.Client.SettlementText, Is.Empty);
            Assert.That(f.Accounts.Reads[0].Cancellation.IsCancellationRequested, Is.True);
            Assert.That(f.Accounts.Reads[0].Reply.Task.IsCompleted, Is.False, "this transport deliberately ignores cancellation");
            await f.JoinReady(MatchLaunchMode.Arena); f.Welcome(); f.Snapshot(false);
            retired(new ServerMsg.Events { List = new List<WireEvent> { new WireEvent { Kind = EventKind.Result, Result = oldResult } } });
            Assert.That(f.Accounts.Reads, Has.Count.EqualTo(1)); Assert.That(f.Client.SettlementText, Is.Empty);
            f.Result();
            Assert.That(f.Client.SettlementText, Does.Contain("paused"));
            Assert.That(f.Client.CanCheckSettlement, Is.False, "new session must not overlap the retired HTTP await");
            f.Client.CheckSettlementAgain(); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(1));
            f.Complete(0); await WaitFor(() => !(bool)Get(f.Client, "_settlementInFlight"));
            Assert.That(f.Client.SettlementText, Does.Contain("paused"), "retired credit must not publish or silently start the new result's read");
            Assert.That(f.Accounts.Reads, Has.Count.EqualTo(1)); Assert.That(f.Client.CanCheckSettlement, Is.True);
            f.Client.CheckSettlementAgain(); Assert.That(f.Accounts.Reads, Has.Count.EqualTo(2));
            f.Complete(1, credit: 4); await WaitFor(() => f.Client.SettlementText.Contains("confirmed: +4"));
        }
    }

    [Test]
    public async Task LeavingDuringUnknownDelayCancelsTheTimerAndDoesNotSendAnotherRequest()
    {
        using (var f = new Fixture(true))
        {
            await f.JoinReady(MatchLaunchMode.Arena); f.Welcome(); f.Snapshot(false); f.Result();
            f.Complete(0, AccountSettlementStatus.Unknown); await WaitFor(() => f.Delays.Count == 1);
            f.Client.Leave(); await WaitFor(() => f.Delays[0].Reply.Task.IsCanceled);
            Assert.That(f.Accounts.Reads, Has.Count.EqualTo(1)); Assert.That(f.Client.SettlementText, Is.Empty);
        }
    }

    [Test]
    public async Task ResultsRowUsesActualReceiptStateAndNeverBlocksReturnToMenu()
    {
        using (var f = new Fixture(true))
        {
            f.InitializeHud(); await f.JoinReady(MatchLaunchMode.Arena); f.Welcome(); f.Snapshot(false); f.Result();
            Invoke(f.Hud, "LateUpdate");
            var row = (TMP_Text)Get(f.Hud, "_settlementText");
            var retry = (UnityEngine.UI.Button)Get(f.Hud, "_settlementRetry");
            Assert.That(row.text, Is.EqualTo("Checking saved credit…")); Assert.That(retry.interactable, Is.False);
            Assert.That(((RectTransform)Get(f.Hud, "_results")).gameObject.activeSelf, Is.True);
            f.Complete(0); await WaitFor(() => f.Client.SettlementText.Contains("confirmed: +7"));
            Invoke(f.Hud, "LateUpdate"); Assert.That(row.text, Does.Contain("+7 GV"));
            Assert.That(f.Accounts.Requests, Has.Count.EqualTo(1));
            f.Client.Leave(); Invoke(f.Hud, "LateUpdate");
            Assert.That(row.text, Is.Empty); Assert.That(retry.gameObject.activeSelf, Is.False);
        }
    }
}
