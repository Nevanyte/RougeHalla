using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;
using UnityEngine.Rendering.Universal;

namespace Roguehalla.Client.Tests
{
    /// <summary>Exercises new-page seat resume through owned HTTP, the real MatchClient and decoded wire callbacks.</summary>
    public sealed class MatchResumeEditModeTests
    {
        const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
        const string OwnerToken = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

        sealed class ProfileRequest
        {
            public readonly TaskCompletionSource<AccountHttpResponse> Reply = new TaskCompletionSource<AccountHttpResponse>();
        }

        sealed class SettlementRead
        {
            public AccountApiRequest Request;
            public readonly TaskCompletionSource<AccountApiResponse> Reply = new TaskCompletionSource<AccountApiResponse>();
        }

        sealed class Accounts : IAccountTransport, IAccountApiTransport
        {
            public readonly List<ProfileRequest> Profiles = new List<ProfileRequest>();
            public readonly List<SettlementRead> Reads = new List<SettlementRead>();
            public bool DeferProfiles;
            public bool DeferReads;
            public bool ReturnCreatedProfile;

            public Task<AccountHttpResponse> GetProfileAsync(string url, string ownerToken, string passcode, CancellationToken cancellation)
            {
                var request = new ProfileRequest(); Profiles.Add(request);
                if (!DeferProfiles) request.Reply.TrySetResult(ReturnCreatedProfile ? CreatedReply() : OwnedReply(ownerToken));
                return request.Reply.Task;
            }

            public Task<AccountApiResponse> SendAsync(AccountApiRequest request, CancellationToken cancellation)
            {
                var read = new SettlementRead { Request = request }; Reads.Add(read);
                if (!DeferReads)
                    read.Reply.TrySetResult(new AccountApiResponse(200,
                        settlement: new AccountSettlement(request.MatchId, AccountSettlementStatus.Unknown)));
                return read.Reply.Task;
            }

            public static AccountHttpResponse OwnedReply(string presentedToken) =>
                string.Equals(presentedToken, OwnerToken, StringComparison.Ordinal)
                    ? new AccountHttpResponse(200, new AccountReply
            {
                profile = new AccountProfile { name = "Alice", gv = 12, gvLifetime = 40,
                    stats = new AccountStats { runs = 2, wins = 1, draws = 0, deaths = 1, kills = 4 } },
                token = OwnerToken,
                created = false
            })
                    : new AccountHttpResponse(403);

            public static AccountHttpResponse CreatedReply() => new AccountHttpResponse(200, new AccountReply
            {
                profile = new AccountProfile { name = "Alice", gv = 0, gvLifetime = 0,
                    stats = new AccountStats() },
                token = OwnerToken,
                created = true
            });
        }

        sealed class Credentials : IAccountCredentialStore
        {
            readonly string _token;
            public Credentials(string token = OwnerToken) { _token = token; }
            public string Read(string scope, string name) => _token;
            public bool WriteConfirmed(string scope, string name, string token) => !string.IsNullOrEmpty(token);
        }

        sealed class StorageBox { public string Record; }

        sealed class MemoryStorage : IOwnedSeatCheckpointStorage
        {
            readonly StorageBox _box;
            public int Writes, Clears;
            public Action<string> AfterCompareAndClear;
            public MemoryStorage(StorageBox box) { _box = box; }
            public SeatCheckpointReadStatus Read(out string canonicalRecord)
            {
                canonicalRecord = _box.Record;
                return canonicalRecord == null ? SeatCheckpointReadStatus.Missing : SeatCheckpointReadStatus.Ready;
            }
            public SeatCheckpointWriteStatus Write(string canonicalRecord)
            { Writes++; _box.Record = canonicalRecord; return SeatCheckpointWriteStatus.Saved; }
            public SeatCheckpointClearStatus CompareAndClear(string expectedCanonicalRecord)
            {
                Clears++;
                if (!string.Equals(_box.Record, expectedCanonicalRecord, StringComparison.Ordinal)) return SeatCheckpointClearStatus.Changed;
                _box.Record = null;
                AfterCompareAndClear?.Invoke(expectedCanonicalRecord);
                return SeatCheckpointClearStatus.Cleared;
            }
        }

        sealed class Transport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public readonly List<byte[]> Sent = new List<byte[]>();
            public string ConnectedUrl;
            public int Closes;
            public void Connect(string url) { ConnectedUrl = url; }
            public void Send(byte[] frame) { Sent.Add(frame); }
            public void Close() { Closes++; Closed?.Invoke("resume fixture closed"); }
            public void Poll() { }
            public void Open() { Opened?.Invoke(); }
            public void Deliver(ServerMsg message) { Received?.Invoke(message.Encode()); }
            public List<ClientMsg> Messages() => Sent.Select(ClientMsg.Decode).ToList();
            public List<ClientMsg.Hello> Hellos() => Messages().OfType<ClientMsg.Hello>().ToList();
            public int LeaveCount => Messages().OfType<ClientMsg.Leave>().Count();
        }

        sealed class Fixture : IDisposable
        {
            public readonly GameObject Root;
            public readonly MatchClient Client;
            public readonly MatchHud Hud;
            public readonly AccountCoordinator Owner;
            public readonly Accounts Accounts;
            public readonly MemoryStorage Storage;
            public readonly List<Transport> Transports = new List<Transport>();
            public readonly List<GameObject> Arenas = new List<GameObject>();
            public readonly List<Light2D> Lights = new List<Light2D>();
            readonly StorageBox _box;
            readonly Light2D[] _priorLights = RegisteredLights();
            readonly EventSystem _priorEvents = EventSystem.current;
            readonly GameObject _priorSelection = EventSystem.current != null ? EventSystem.current.currentSelectedGameObject : null;
            GameObject _events;
            bool _runtimeRetired, _disposed;

            public Fixture(StorageBox box = null, bool deferProfiles = false, string credentialToken = OwnerToken)
            {
                _box = box ?? new StorageBox();
                Storage = new MemoryStorage(_box);
                Accounts = new Accounts { DeferProfiles = deferProfiles };
                try
                {
                    Root = new GameObject("Owned seat resume test client");
                    Client = Root.AddComponent<MatchClient>(); Client.enabled = false;
                    Client.PageUrl = "https://resume.example/play";
                    Client.AccountApi = "https://resume.example/api";
                    Client.Url = "wss://resume.example/arena/ws";
                    Client.TrainingUrl = "wss://resume.example/training/ws";
                    Client.Profile = "Alice"; Client.Faction = 4; Client.ContentHash = 0x1234UL;

                    Owner = Root.AddComponent<AccountCoordinator>();
                    Owner.Initialize(AccountEndpoint.FromPage(Client.PageUrl, Client.AccountApi), Accounts, new Credentials(credentialToken));
                    Set(Client, "<AccountOwner>k__BackingField", Owner);
                    Set(Client, "_seatStore", new OwnedSeatCheckpointStore(Storage));
                    Call(Client, "InitializeSeatResume");

                    _events = new GameObject("Owned seat resume test EventSystem", typeof(UiInputRoutingEventSystem));
                    var events = _events.GetComponent<EventSystem>();
                    events.enabled = false; events.enabled = true;
                    EventSystem.current = events;
                    Assert.That(EventSystem.current, Is.SameAs(events), "the fixture EventSystem must be lifecycle-registered before HUD setup");
                    Hud = Root.AddComponent<MatchHud>(); Hud.Initialize(Client);
                    Set(Client, "<Hud>k__BackingField", Hud);

                    Set(Client, "_transportFactory", new Func<ITransport>(() =>
                    {
                        var arena = Client.Arena;
                        Assert.That(arena, Is.Not.Null, "MatchClient must create its real ArenaView");
                        Arenas.Add(arena.gameObject);
                        arena.transform.SetParent(Root.transform, false);
                        try
                        {
                            if (Get(arena, "_actors") == null) Call(arena, "Awake");
                            Assert.That(Get(arena, "_actors"), Is.Not.Null);
                        }
                        finally { Lights.AddRange(arena.GetComponentsInChildren<Light2D>(true)); }
                        var transport = new Transport(); Transports.Add(transport); return transport;
                    }));
                }
                catch (Exception setupError)
                {
                    try { Dispose(); }
                    catch (Exception cleanupError) { throw new AggregateException("Fixture setup and rollback both failed.", setupError, cleanupError); }
                    ExceptionDispatchInfo.Capture(setupError).Throw();
                    throw;
                }
            }

            public async Task LoadOwnedProfile()
            {
                int before = Accounts.Profiles.Count;
                Client.OpenProfile("alice", null, null);
                await WaitFor(() => Owner.Flow.Snapshot.State == AccountHubState.Owned || Owner.Flow.Snapshot.State == AccountHubState.Failed);
                Assert.That(Owner.Flow.Snapshot.State, Is.EqualTo(AccountHubState.Owned));
                Assert.That(Accounts.Profiles.Count, Is.EqualTo(before + 1));
                Assert.That(Accounts.Profiles[before].Reply.Task.IsCompletedSuccessfully, Is.True);
                Assert.That(Client.CanResumeCurrentRun, Is.True);
            }

            public async Task StartFreshOwnedRun(MatchLaunchMode mode, byte matchByte = 0x31, byte tokenByte = 0x71, uint player = 7)
            {
                int requestCount = Accounts.Profiles.Count;
                Client.Join("alice", 4, mode);
                await WaitFor(() => Client.Session != null || Owner.Flow.Snapshot.State == AccountHubState.Failed);
                Assert.That(Owner.Flow.Snapshot.State, Is.EqualTo(AccountHubState.Owned));
                Assert.That(Accounts.Profiles.Count, Is.EqualTo(requestCount + 1));
                Assert.That(Transports, Has.Count.EqualTo(1));
                Assert.That(Transports[0].ConnectedUrl, Is.EqualTo(Client.LaunchTarget(mode).Url));
                Welcome(matchByte, tokenByte, player);
            }

            public void Welcome(byte matchByte, byte tokenByte, uint player = 7, ushort protocol = Wire.ProtocolVersion)
            {
                var match = Enumerable.Repeat(matchByte, 16).ToArray();
                var token = Enumerable.Repeat(tokenByte, 16).ToArray();
                var transport = Transports[Transports.Count - 1];
                transport.Open();
                transport.Deliver(new ServerMsg.Welcome { Protocol = protocol, MatchId = match, Session = token,
                    PlayerId = player, TickRate = 20, ServerMs = 50, Map = new MapBlob(8, 8, new byte[64]) });
            }

            public void Snapshot(bool training, uint tick = 1, double serverMs = 50)
            {
                Transports[Transports.Count - 1].Deliver(new ServerMsg.Snapshot { Tick = tick,
                    ServerTimeOverrideMs = serverMs, Phase = (byte)MatchPhase.Active, Training = training,
                    Me = new WireSelf { Id = 7, X = 64, Y = 64, Hp = 100, MaxHp = 100, Status = 1, Weapon = 0 } });
            }

            public void Result()
            {
                Transports[Transports.Count - 1].Deliver(new ServerMsg.Events { Tick = 2, List = new List<WireEvent>
                {
                    new WireEvent { Kind = EventKind.Result, Result = new WireResult { Outcome = 0, Place = 1,
                        Players = 8, Kills = 3, GvTotal = 12, DurationSec = 90 } }
                }});
            }

            public void RuntimeRetire()
            {
                Call(Client, "OnDestroy");
                _runtimeRetired = true;
            }

            public void Dispose()
            {
                if (_disposed) return; _disposed = true;
                var failures = new List<Exception>();
                Attempt(failures, () => { if (!_runtimeRetired && Client != null) Client.Leave(); });
                if (Accounts != null)
                {
                    foreach (var read in Accounts.Reads) Attempt(failures, () => read.Reply.TrySetCanceled());
                    foreach (var profile in Accounts.Profiles) Attempt(failures, () => profile.Reply.TrySetCanceled());
                }

                for (int i = Arenas.Count - 1; i >= 0; i--)
                {
                    var arena = Arenas[i];
                    Attempt(failures, () =>
                    {
                        if (arena == null) return;
                        arena.SetActive(false);
                        UnityEngine.Object.DestroyImmediate(arena);
                    });
                }
                Attempt(failures, () => { if (Root != null) UnityEngine.Object.DestroyImmediate(Root); });

                var ownedEvents = _events != null ? _events.GetComponent<EventSystem>() : null;
                if (ownedEvents != null)
                {
                    try
                    {
                        if (EventSystem.current == ownedEvents) Attempt(failures, () => ownedEvents.SetSelectedGameObject(null));
                    }
                    finally
                    {
                        Attempt(failures, () => { if (ownedEvents != null) ownedEvents.enabled = false; });
                        Attempt(failures, () => { if (_events != null) UnityEngine.Object.DestroyImmediate(_events); });
                        _events = null;
                    }
                }
                else if (_events != null)
                {
                    Attempt(failures, () => UnityEngine.Object.DestroyImmediate(_events));
                    _events = null;
                }

                if (_priorEvents != null && _priorEvents.isActiveAndEnabled)
                {
                    Attempt(failures, () => EventSystem.current = _priorEvents);
                    if (_priorSelection != null && _priorSelection.activeInHierarchy)
                        Attempt(failures, () => _priorEvents.SetSelectedGameObject(_priorSelection));
                }

                Attempt(failures, () => Assert.That(Arenas.All(x => x == null), Is.True));
                Attempt(failures, () => Assert.That(Lights.All(x => x == null), Is.True));
                Attempt(failures, () => CollectionAssert.AreEquivalent(_priorLights, RegisteredLights()));
                Attempt(failures, () => Assert.That(EventSystem.current,
                    Is.SameAs(_priorEvents != null && _priorEvents.isActiveAndEnabled ? _priorEvents : null)));

                if (failures.Count == 1) ExceptionDispatchInfo.Capture(failures[0]).Throw();
                if (failures.Count > 1) throw new AggregateException("Fixture cleanup had multiple failures.", failures);
            }

            static void Attempt(List<Exception> failures, Action action)
            {
                try { action(); }
                catch (Exception error) { failures.Add(error); }
            }
        }

        [TestCase(MatchLaunchMode.Arena, false)]
        [TestCase(MatchLaunchMode.Training, true)]
        public async Task ConfirmedCheckpointResumesExactSeatOnlyAfterFreshModeFact(MatchLaunchMode mode, bool training)
        {
            var box = new StorageBox();
            string capabilityHex = "71717171717171717171717171717171";
            using (var first = new Fixture(box))
            {
                await first.StartFreshOwnedRun(mode);
                Assert.That(first.Client.LaunchVerified, Is.False, "Welcome alone is not mode confirmation");
                Assert.That(first.Storage.Writes, Is.Zero, "no checkpoint before the matching accepted snapshot");
                first.Snapshot(training);
                Assert.That(first.Client.LaunchVerified, Is.True);
                Assert.That(first.Storage.Writes, Is.EqualTo(1), "the confirmed Welcome is saved immediately once");
                first.Snapshot(training, tick: 2, serverMs: 100);
                Assert.That(first.Storage.Writes, Is.EqualTo(1), "ordinary snapshots do not rewrite the checkpoint");
                Assert.That(box.Record, Does.Contain("capability=" + capabilityHex));
                var retiringSession = first.Client.Session;
                string checkpoint = box.Record;
                int profilesBeforeRetire = first.Accounts.Profiles.Count;
                bool lateClosedCallbackRan = false;
                Action<string> lateClosedCallback = _ =>
                {
                    lateClosedCallbackRan = true;
                    first.Client.Leave();
                    first.Client.Join("alice", 4, MatchLaunchMode.Arena);
                    first.Client.ResumeCurrentRun("alice", 4, mode);
                };
                first.Transports[0].Closed += lateClosedCallback;
                first.RuntimeRetire();
                first.Transports[0].Closed -= lateClosedCallback;
                Assert.That(lateClosedCallbackRan, Is.True, "detaching the old transport exercises a late external close callback");
                Assert.That(retiringSession.State, Is.EqualTo(SessionState.Detached));
                Assert.That(first.Transports[0].LeaveCount, Is.Zero, "page retirement detaches without a wire Leave");
                Assert.That(first.Accounts.Profiles, Has.Count.EqualTo(profilesBeforeRetire), "late callbacks cannot restart account HTTP");
                Assert.That(first.Transports, Has.Count.EqualTo(1), "late callbacks cannot open another socket");
                Assert.That(box.Record, Is.EqualTo(checkpoint), "late callbacks cannot clear the saved seat");
            }

            using (var next = new Fixture(box))
            {
                int httpBefore = next.Accounts.Profiles.Count;
                next.Client.ResumeCurrentRun("alice", 4, mode);
                await Task.Yield();
                Assert.That(next.Accounts.Profiles.Count, Is.EqualTo(httpBefore), "a saved name/checkpoint without current owned proof cannot auto-claim");
                Assert.That(next.Transports, Is.Empty, "no automatic socket before explicit LOAD");

                await next.LoadOwnedProfile();
                Assert.That(next.Client.CanResumeCurrentRun, Is.True);
                next.Client.ResumeCurrentRun("alice", 4, mode);
                await WaitFor(() => next.Transports.Count == 1 || !next.Client.ResumeBusy);
                Assert.That(next.Transports, Has.Count.EqualTo(1));
                Assert.That(next.Transports[0].ConnectedUrl, Is.EqualTo(next.Client.LaunchTarget(mode).Url), "the configured target is used");
                next.Transports[0].Open();
                var hello = next.Transports[0].Hellos().Single();
                CollectionAssert.AreEqual(Enumerable.Repeat((byte)0x71, 16), hello.Resume, "the existing seat capability is sent on the first Hello");

                next.Transports[0].Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion,
                    MatchId = Enumerable.Repeat((byte)0x31, 16).ToArray(), Session = Enumerable.Repeat((byte)0x72, 16).ToArray(),
                    PlayerId = 7, TickRate = 20, ServerMs = 150, Map = new MapBlob(8, 8, new byte[64]) });
                Assert.That(next.Client.LaunchVerified, Is.False, "matching seat Welcome is not a mode fact");
                if (training)
                {
                    Assert.That(next.Client.ConfirmedPractice, Is.False, "Welcome alone cannot confirm the resumed Training session");
                    Assert.That(next.Hud.TrainingConsole.ActionsAvailable, Is.False);
                }
                else
                {
                    next.Result();
                    Assert.That(next.Accounts.Reads, Is.Empty, "a retained Result received before mode confirmation does not auto-query");
                }
                next.Snapshot(training);
                Assert.That(next.Client.LaunchVerified, Is.True, "the fresh accepted matching snapshot confirms this Session");
                if (training)
                {
                    Assert.That(next.Client.ConfirmedPractice, Is.True);
                    Assert.That(next.Hud.TrainingConsole.ActionsAvailable, Is.True, "fresh matching Training fact enables the console");
                    next.Result();
                    Assert.That(next.Client.CanCheckSettlement, Is.False);
                    Assert.That(next.Accounts.Reads, Is.Empty, "Training has no settlement access");
                }
                else
                {
                    Assert.That(next.Client.CanCheckSettlement, Is.True, "the retained genuine Arena Result is manually checkable after mode confirmation");
                    next.Client.CheckSettlementAgain();
                    await WaitFor(() => next.Accounts.Reads.Count == 1);
                    Assert.That(next.Accounts.Reads[0].Request.ReadKind, Is.EqualTo(AccountApiReadKind.Settlement));
                    Assert.That(next.Accounts.Reads[0].Request.MatchId, Is.EqualTo("31313131-3131-3131-3131-313131313131"));
                }
            }
        }

        [Test]
        public async Task TypedExpiredSeatClearsOnlyItsCapturedRevisionWhileGenericFailureRetainsIt()
        {
            var box = await CreateSavedRun(MatchLaunchMode.Arena);
            using (var f = new Fixture(box))
            {
                await f.LoadOwnedProfile();
                f.Client.ResumeCurrentRun("alice", 4, MatchLaunchMode.Arena);
                await WaitFor(() => f.Transports.Count == 1 || !f.Client.ResumeBusy);
                f.Transports[0].Open();
                string revisionA = box.Record;
                await WriteNewerRevision(f, box);
                string revisionB = box.Record;
                Assert.That(revisionB, Is.Not.EqualTo(revisionA));
                f.Transports[0].Deliver(new ServerMsg.Reject { Code = RejectCode.NoSuchSession, Reason = "expired" });
                await WaitFor(() => f.Client.Session == null || f.Client.Session.State == SessionState.Rejected);
                Assert.That(box.Record, Is.EqualTo(revisionB), "typed rejection compare-clears only captured A and preserves newer B");
                Assert.That(f.Transports, Has.Count.EqualTo(1), "terminal rejection never falls back to a fresh admission");
            }

            box = await CreateSavedRun(MatchLaunchMode.Arena);
            using (var f = new Fixture(box))
            {
                await f.LoadOwnedProfile();
                string captured = box.Record;
                f.Client.ResumeCurrentRun("alice", 4, MatchLaunchMode.Arena);
                await WaitFor(() => f.Transports.Count == 1 || !f.Client.ResumeBusy);
                f.Transports[0].Open();
                f.Transports[0].Deliver(new ServerMsg.Welcome { Protocol = (ushort)(Wire.ProtocolVersion + 1),
                    MatchId = Enumerable.Repeat((byte)0x31, 16).ToArray(), Session = new byte[16], PlayerId = 7,
                    TickRate = 20, Map = new MapBlob(8, 8, new byte[64]) });
                var failedSession = f.Client.Session;
                Assert.That(failedSession, Is.Not.Null);
                Assert.That(failedSession.State, Is.EqualTo(SessionState.Failed));
                await WaitFor(() => f.Client.Session == null);
                Assert.That(box.Record, Is.EqualTo(captured), "generic protocol failure does not erase a retryable checkpoint");
                Assert.That(f.Transports, Has.Count.EqualTo(1));
                Assert.That(f.Client.CanForgetSavedRun, Is.True, "retained record is forgettable after failed session retirement");
                Assert.That(f.Client.ResumeStatus, Does.Contain("checkpoint was kept"));
                f.Client.OpenProfile("alice", null, null);
                await WaitFor(() => f.Owner.Flow.Snapshot.State == AccountHubState.Owned || f.Owner.Flow.Snapshot.State == AccountHubState.Failed);
                Assert.That(f.Owner.Flow.Snapshot.State, Is.EqualTo(AccountHubState.Owned));
                Assert.That(box.Record, Is.EqualTo(captured), "re-verifying the same inactive owner preserves its kept checkpoint");
                Assert.That(f.Client.CanForgetSavedRun, Is.True);
                f.Client.ForgetSavedRun();
                Assert.That(box.Record, Is.Null, "forget is an explicit user action after generic failure");
            }

            box = await CreateSavedRun(MatchLaunchMode.Arena);
            using (var f = new Fixture(box))
            {
                await f.LoadOwnedProfile();
                string captured = box.Record;
                f.Client.ResumeCurrentRun("alice", 4, MatchLaunchMode.Arena);
                await WaitFor(() => f.Transports.Count == 1 || !f.Client.ResumeBusy);
                f.Transports[0].Open();
                f.Transports[0].Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion,
                    MatchId = Enumerable.Repeat((byte)0x31, 16).ToArray(), Session = Enumerable.Repeat((byte)0x72, 16).ToArray(),
                    PlayerId = 8, TickRate = 20, ServerMs = 150, Map = new MapBlob(8, 8, new byte[64]) });
                await WaitFor(() => f.Client.Session == null);
                Assert.That(box.Record, Is.EqualTo(captured), "wrong-identity Welcome failure retains the retryable checkpoint");
                Assert.That(f.Transports, Has.Count.EqualTo(1), "identity failure does not fall back to admission");
                Assert.That(f.Client.ResumeStatus, Does.Contain("checkpoint was kept"));
            }

            box = await CreateSavedRun(MatchLaunchMode.Arena);
            using (var f = new Fixture(box))
            {
                await f.LoadOwnedProfile();
                string captured = box.Record;
                f.Client.ResumeCurrentRun("alice", 4, MatchLaunchMode.Arena);
                await WaitFor(() => f.Transports.Count == 1 || !f.Client.ResumeBusy);
                f.Transports[0].Open();
                f.Transports[0].Deliver(new ServerMsg.Reject { Code = RejectCode.ServerDraining, Reason = "draining" });
                await WaitFor(() => f.Client.Session == null);
                Assert.That(box.Record, Is.EqualTo(captured), "an ambiguous server refusal retains the checkpoint for explicit retry");
                Assert.That(f.Client.CanForgetSavedRun, Is.True, "retained checkpoint can be explicitly forgotten");
                Assert.That(f.Client.ResumeStatus, Does.Contain("kept"));
                Assert.That(f.Transports, Has.Count.EqualTo(1), "a refusal never auto-admits a fresh run");
            }
        }

        [Test]
        public async Task MissingOrWrongCredentialCannotClaimAndCreatedProfileCannotResume()
        {
            var box = await CreateSavedRun(MatchLaunchMode.Arena);
            using (var f = new Fixture(box, credentialToken: null))
            {
                f.Client.ResumeCurrentRun("alice", 4, MatchLaunchMode.Arena);
                await Task.Yield();
                Assert.That(f.Accounts.Profiles, Is.Empty, "resume without current ownership proof makes no HTTP request");
                Assert.That(f.Transports, Is.Empty);
                f.Client.OpenProfile("alice", null, null);
                await WaitFor(() => f.Owner.Flow.Snapshot.State == AccountHubState.Failed);
                Assert.That(f.Accounts.Profiles, Has.Count.EqualTo(1));
                Assert.That(f.Accounts.Profiles[0].Reply.Task.Result.Status, Is.EqualTo(403), "missing credentials cannot be echoed into a valid fake owner reply");
                Assert.That(f.Transports, Is.Empty, "a failed owner lookup cannot create a resume socket");
                Assert.That(box.Record, Is.Not.Null, "failed ownership lookup leaves the saved run untouched");
            }

            box = await CreateSavedRun(MatchLaunchMode.Arena);
            using (var f = new Fixture(box, credentialToken: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"))
            {
                f.Client.OpenProfile("alice", null, null);
                await WaitFor(() => f.Owner.Flow.Snapshot.State == AccountHubState.Failed);
                Assert.That(f.Accounts.Profiles[0].Reply.Task.Result.Status, Is.EqualTo(403), "wrong credentials are rejected by the fake owner service");
                Assert.That(f.Transports, Is.Empty);
                Assert.That(box.Record, Is.Not.Null);
            }

            box = await CreateSavedRun(MatchLaunchMode.Arena);
            using (var f = new Fixture(box))
            {
                await f.LoadOwnedProfile();
                f.Accounts.ReturnCreatedProfile = true;
                int before = f.Accounts.Profiles.Count;
                f.Client.ResumeCurrentRun("alice", 4, MatchLaunchMode.Arena);
                await WaitFor(() => f.Accounts.Profiles.Count == before + 1 || !f.Client.ResumeBusy);
                Assert.That(f.Accounts.Profiles, Has.Count.EqualTo(before + 1));
                Assert.That(f.Accounts.Profiles[before].Reply.Task.Result.Reply.created, Is.True);
                Assert.That(f.Transports, Is.Empty, "a profile-creation response cannot authorize resuming an existing seat");
                Assert.That(box.Record, Is.Not.Null);
            }
        }

        [Test]
        public async Task DelayedResumeOwnerReplyCannotConnectAfterTargetOrProfileChanges()
        {
            var box = await CreateSavedRun(MatchLaunchMode.Arena);
            using (var f = new Fixture(box))
            {
                await f.LoadOwnedProfile();
                f.Accounts.DeferProfiles = true;
                string captured = box.Record;
                int before = f.Accounts.Profiles.Count;
                f.Client.ResumeCurrentRun("alice", 4, MatchLaunchMode.Arena);
                await WaitFor(() => f.Accounts.Profiles.Count == before + 1);
                f.Client.Url = "wss://resume.example/changed/ws";
                f.Accounts.Profiles[before].Reply.TrySetResult(Accounts.OwnedReply(OwnerToken));
                await WaitFor(() => !f.Client.ResumeBusy);
                Assert.That(f.Transports, Is.Empty, "the original captured destination cannot be used after endpoint mutation");
                Assert.That(box.Record, Is.EqualTo(captured), "a stale completion preserves the retry checkpoint");

                f.Client.Url = "wss://resume.example/arena/ws";
                f.Accounts.DeferProfiles = true;
                before = f.Accounts.Profiles.Count;
                f.Client.ResumeCurrentRun("alice", 4, MatchLaunchMode.Arena);
                await WaitFor(() => f.Accounts.Profiles.Count == before + 1);
                var diagnosticReply = f.Accounts.Profiles[before];
                f.Client.DiagnosticRequested = true;
                diagnosticReply.Reply.TrySetResult(Accounts.OwnedReply(OwnerToken));
                await WaitFor(() => !f.Client.ResumeBusy);
                Assert.That(f.Transports, Is.Empty, "diagnostic-mode mutation revokes an in-flight ordinary resume");
                Assert.That(box.Record, Is.EqualTo(captured));
                f.Client.DiagnosticRequested = false;

                before = f.Accounts.Profiles.Count;
                f.Client.ResumeCurrentRun("alice", 4, MatchLaunchMode.Arena);
                await WaitFor(() => f.Accounts.Profiles.Count == before + 1);
                var cancelledReply = f.Accounts.Profiles[before];
                f.Owner.Flow.Cancel();
                cancelledReply.Reply.TrySetResult(Accounts.OwnedReply(OwnerToken));
                await WaitFor(() => !f.Client.ResumeBusy);
                Assert.That(f.Transports, Is.Empty, "cancelling the owner flow revokes its pending resume");
                Assert.That(box.Record, Is.EqualTo(captured), "cancellation before checkpoint capture preserves the shared record");

                f.Accounts.DeferProfiles = false;
                await f.LoadOwnedProfile();
                f.Accounts.DeferProfiles = true;
                before = f.Accounts.Profiles.Count;
                f.Client.ResumeCurrentRun("alice", 4, MatchLaunchMode.Arena);
                await WaitFor(() => f.Accounts.Profiles.Count == before + 1);
                var factionReply = f.Accounts.Profiles[before];
                f.Client.SelectFaction(3);
                factionReply.Reply.TrySetResult(Accounts.OwnedReply(OwnerToken));
                await WaitFor(() => !f.Client.ResumeBusy);
                Assert.That(f.Transports, Is.Empty, "changing faction revokes a pending resume");
                Assert.That(box.Record, Is.EqualTo(captured));

                f.Client.SelectFaction(4);
                f.Accounts.DeferProfiles = false;
                await f.LoadOwnedProfile();
                before = f.Accounts.Profiles.Count;
                f.Accounts.DeferProfiles = true;
                f.Client.TrainingUrl = "wss://resume.example/training/ws";
                f.Client.ResumeCurrentRun("alice", 4, MatchLaunchMode.Arena);
                await WaitFor(() => f.Accounts.Profiles.Count == before + 1);
                var pendingResume = f.Accounts.Profiles[before];
                f.Client.SelectProfile("Bob");
                pendingResume.Reply.TrySetResult(Accounts.OwnedReply(OwnerToken));
                await WaitFor(() => !f.Client.ResumeBusy);
                Assert.That(f.Transports, Is.Empty, "profile replacement revokes the captured async owner intent");
                Assert.That(box.Record, Is.EqualTo(captured), "a profile change before checkpoint capture cannot clear an unowned shared record");
            }
        }

        [Test]
        public async Task ExplicitLeaveSendsLeaveAndPreservesANewerCheckpoint()
        {
            var box = await CreateSavedRun(MatchLaunchMode.Arena);
            using (var f = new Fixture(box))
            {
                await f.LoadOwnedProfile();
                f.Client.ResumeCurrentRun("alice", 4, MatchLaunchMode.Arena);
                await WaitFor(() => f.Transports.Count == 1 || !f.Client.ResumeBusy);
                f.Transports[0].Open();
                f.Transports[0].Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion,
                    MatchId = Enumerable.Repeat((byte)0x31, 16).ToArray(), Session = Enumerable.Repeat((byte)0x72, 16).ToArray(),
                    PlayerId = 7, TickRate = 20, ServerMs = 150, Map = new MapBlob(8, 8, new byte[64]) });
                Assert.That(box.Record, Is.Not.Null);
                await WriteNewerRevision(f, box);
                string newer = box.Record;
                f.Client.Leave();
                Assert.That(f.Transports[0].LeaveCount, Is.EqualTo(1), "explicit user Leave uses the normal wire Leave path");
                Assert.That(box.Record, Is.EqualTo(newer), "compare-clear of the active captured revision preserves a newer record");
            }
        }

        [Test]
        public async Task ReentrantCheckpointClearCannotLeaveOrReplaceANewerResumedSession()
        {
            var box = new StorageBox();
            using (var f = new Fixture(box))
            {
                await f.StartFreshOwnedRun(MatchLaunchMode.Arena);
                f.Snapshot(training: false);
                var oldSession = f.Client.Session;
                var oldTransport = f.Transports[0];
                string oldRecord = box.Record;
                string newerRecord = null;
                bool reenteredResume = false;
                f.Storage.AfterCompareAndClear = expected =>
                {
                    if (!string.Equals(expected, oldRecord, StringComparison.Ordinal)) return;
                    WriteNewerRevision(f, box).GetAwaiter().GetResult();
                    newerRecord = box.Record;
                    f.Client.ResumeCurrentRun("alice", 4, MatchLaunchMode.Arena);
                    reenteredResume = true;
                };

                f.Client.Leave();
                f.Storage.AfterCompareAndClear = null;
                Assert.That(reenteredResume, Is.True, "the fake storage reenters after its atomic comparison");
                Assert.That(oldSession.State, Is.EqualTo(SessionState.Detached), "the superseded local session is detached after reentry");
                Assert.That(oldTransport.LeaveCount, Is.Zero, "the old close path must not leave the seat now being resumed");
                await WaitFor(() => f.Transports.Count == 2 || !f.Client.ResumeBusy);
                Assert.That(f.Transports, Has.Count.EqualTo(2));
                Assert.That(f.Client.Session, Is.Not.Null);
                Assert.That(box.Record, Is.EqualTo(newerRecord), "the new revision remains the active checkpoint");

                var newTransport = f.Transports[1];
                newTransport.Open();
                CollectionAssert.AreEqual(Enumerable.Repeat((byte)0x72, 16), newTransport.Hellos().Single().Resume,
                    "the replacement session resumes the exact reentrant revision");
            }
        }

        [Test]
        public async Task ResumeChooserDisablesActionsForTypedCallsignThatDiffersFromLoadedOwner()
        {
            InputSettings priorSettings = InputSystem.settings;
            Keyboard priorKeyboard = Keyboard.current;
            InputSettings fixtureSettings = null;
            Keyboard keyboard = null;
            HideFlags priorSettingsFlags = HideFlags.None;
            bool capturedSettingsFlags = false;
            try
            {
                Assert.That(priorSettings, Is.Not.Null, "InputSystem settings must exist before the scoped keyboard fixture");
                priorSettingsFlags = priorSettings.hideFlags;
                capturedSettingsFlags = true;
                fixtureSettings = ScriptableObject.Instantiate(priorSettings);
                fixtureSettings.updateMode = InputSettings.UpdateMode.ProcessEventsInDynamicUpdate;
                fixtureSettings.backgroundBehavior = InputSettings.BackgroundBehavior.IgnoreFocus;
                fixtureSettings.SetInternalFeatureFlag("RUN_PLAYER_UPDATES_IN_EDIT_MODE", true);
                if (priorSettingsFlags == HideFlags.HideAndDontSave) priorSettings.hideFlags = HideFlags.DontSave;
                InputSystem.settings = fixtureSettings;
                Assert.That(ReferenceEquals(InputSystem.settings, fixtureSettings), Is.True);
                keyboard = InputSystem.AddDevice<Keyboard>();
                keyboard.MakeCurrent();
                Assert.That(Keyboard.current, Is.SameAs(keyboard));

                using (var f = new Fixture())
                {
                    await f.LoadOwnedProfile();
                    Assert.That(f.Client.CanResumeCurrentRun, Is.True, "Alice is the currently verified owner");
                    Call(f.Hud, "OpenResumeChooser");
                    var overlay = (RectTransform)Get(f.Hud, "_resumeOverlay");
                    var selected = EventSystem.current.currentSelectedGameObject;
                    Assert.That(selected, Is.Not.Null);
                    Assert.That(selected.transform.IsChildOf(overlay), Is.True, "opening the chooser focuses one of its own controls");

                    InputSystem.QueueStateEvent(keyboard, new KeyboardState(Key.Tab));
                    InputSystem.Update();
                    Assert.That(InputState.currentUpdateType, Is.EqualTo(InputUpdateType.Dynamic));
                    Assert.That(keyboard.wasUpdatedThisFrame, Is.True);
                    Assert.That(keyboard.tabKey.isPressed, Is.True);
                    Assert.That(keyboard.tabKey.wasPressedThisFrame, Is.True);
                    f.Hud.ReadUiInput();
                    var afterTab = EventSystem.current.currentSelectedGameObject;
                    Assert.That(afterTab, Is.Not.Null);
                    Assert.That(afterTab.transform.IsChildOf(overlay), Is.True, "Tab navigation remains inside the modal");
                    Assert.That(afterTab, Is.Not.SameAs(selected), "Tab advances modal focus");
                    f.Hud.ReadUiInput();
                    Assert.That(EventSystem.current.currentSelectedGameObject, Is.SameAs(afterTab), "the same input update cannot cycle focus twice");

                    InputSystem.QueueStateEvent(keyboard, new KeyboardState(Key.Escape));
                    InputSystem.Update();
                    Assert.That(InputState.currentUpdateType, Is.EqualTo(InputUpdateType.Dynamic));
                    Assert.That(keyboard.escapeKey.isPressed, Is.True);
                    Assert.That(keyboard.escapeKey.wasPressedThisFrame, Is.True);
                    f.Hud.ReadUiInput();
                    Assert.That(overlay.gameObject.activeSelf, Is.False, "Escape closes the resume chooser");
                    f.Hud.ReadUiInput();
                    Assert.That(f.Client.Session, Is.Null, "the Escape edge cannot fall through to world actions");
                    Assert.That(f.Accounts.Profiles, Has.Count.EqualTo(1), "modal keyboard input does not make another profile request");
                    Assert.That(f.Transports, Is.Empty, "modal keyboard input does not connect a match transport");

                    InputSystem.QueueStateEvent(keyboard, new KeyboardState());
                    InputSystem.Update();
                    Assert.That(keyboard.tabKey.isPressed, Is.False);
                    Assert.That(keyboard.escapeKey.isPressed, Is.False);

                    var nickname = (TMP_InputField)Get(f.Hud, "_nickname");
                    nickname.SetTextWithoutNotify("Bob");
                    Call(f.Hud, "OpenResumeChooser");
                    var arena = (UnityEngine.UI.Button)Get(f.Hud, "_resumeArena");
                    var training = (UnityEngine.UI.Button)Get(f.Hud, "_resumeTraining");
                    Assert.That(arena.interactable, Is.False, "a loaded owner does not authorize the different typed callsign");
                    Assert.That(training.interactable, Is.False);
                    Assert.That(((TMP_Text)Get(f.Hud, "_resumeHint")).text, Does.Contain("Load or sign in"));
                    Assert.That(f.Transports, Is.Empty, "opening the chooser does not start a session");
                }
            }
            finally
            {
                try { if (keyboard != null && keyboard.added) InputSystem.RemoveDevice(keyboard); }
                finally
                {
                    try { if (priorKeyboard != null && priorKeyboard.added) priorKeyboard.MakeCurrent(); }
                    finally
                    {
                        try
                        {
                            if (priorSettings != null && fixtureSettings != null && ReferenceEquals(InputSystem.settings, fixtureSettings))
                                InputSystem.settings = priorSettings;
                        }
                        finally
                        {
                            try { if (capturedSettingsFlags) priorSettings.hideFlags = priorSettingsFlags; }
                            finally
                            {
                                if (fixtureSettings != null && !ReferenceEquals(InputSystem.settings, fixtureSettings))
                                    UnityEngine.Object.DestroyImmediate(fixtureSettings);
                            }
                        }
                    }
                }
            }
        }

        static async Task WriteNewerRevision(Fixture f, StorageBox box)
        {
            var replacementAccounts = new Accounts();
            var endpoint = AccountEndpoint.FromPage(f.Client.PageUrl, f.Client.AccountApi);
            var replacementFlow = new AccountHubFlow(new AccountSession(endpoint, replacementAccounts, new Credentials()));
            var intent = await replacementFlow.PrepareJoinAsync("alice", f.Client.LaunchTarget(MatchLaunchMode.Arena).Url);
            var writer = new OwnedSeatCheckpointStore(new MemoryStorage(box));
            var context = new OwnedSeatCheckpointContext(intent.Account, endpoint,
                f.Client.LaunchTarget(MatchLaunchMode.Arena).Url, OwnedSeatMode.Arena, Wire.ProtocolVersion, f.Client.ContentHash);
            var newer = writer.Save(context, Enumerable.Repeat((byte)0x72, 16).ToArray(),
                Enumerable.Repeat((byte)0x32, 16).ToArray(), 7);
            Assert.That(newer.Status, Is.EqualTo(SeatCheckpointWriteStatus.Saved));
        }

        static async Task<StorageBox> CreateSavedRun(MatchLaunchMode mode)
        {
            var box = new StorageBox();
            using (var f = new Fixture(box))
            {
                await f.StartFreshOwnedRun(mode);
                f.Snapshot(mode == MatchLaunchMode.Training);
                Assert.That(box.Record, Is.Not.Null);
                f.RuntimeRetire();
            }
            return box;
        }

        static async Task WaitFor(Func<bool> predicate)
        {
            for (int i = 0; i < 2000; i++)
            {
                if (predicate()) return;
                await Task.Yield();
            }
            Assert.Fail("The real owner/session callback did not complete within the deterministic fixture window.");
        }

        static void Set(object target, string name, object value)
        {
            var field = target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);
            Assert.That(field, Is.Not.Null, "fixture seam field " + name);
            field.SetValue(target, value);
        }

        static object Get(object target, string name)
        {
            var field = target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);
            Assert.That(field, Is.Not.Null, "fixture seam field " + name);
            return field.GetValue(target);
        }

        static void Call(object target, string name)
        {
            var method = target.GetType().GetMethod(name, Private);
            Assert.That(method, Is.Not.Null, "fixture seam method " + name);
            method.Invoke(target, null);
        }

        static Light2D[] RegisteredLights() => Resources.FindObjectsOfTypeAll<Light2D>().Where(light => light != null && light.isActiveAndEnabled).ToArray();
    }
}
