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
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Controls;
using UnityEngine.InputSystem.LowLevel;
using UnityEngine.Rendering.Universal;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    /// <summary>Uses TMP's real popup behavior while keeping its documented disposal hooks safe in EditMode.</summary>
    public sealed class EditModeTrainingDropdown : TMP_Dropdown
    {
        public bool HideRequested;

        // TMP creates its alpha tween runner in Start, which EditMode does not invoke here.
        public void InitializeForEditMode() => base.Start();

        protected override void DestroyBlocker(GameObject blocker)
        {
            HideRequested = true;
            if (blocker == null) return;
            if (Application.isPlaying) base.DestroyBlocker(blocker);
            else UnityEngine.Object.DestroyImmediate(blocker);
        }

        protected override void DestroyDropdownList(GameObject dropdownList)
        {
            if (dropdownList == null) return;
            if (Application.isPlaying) base.DestroyDropdownList(dropdownList);
            else UnityEngine.Object.DestroyImmediate(dropdownList);
        }
    }

    /// <summary>Exercises Training console ownership and input through public Join plus decoded server facts.</summary>
    public sealed class TrainingConsoleIntegrationEditModeTests
    {
        const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;

        sealed class Accounts : IAccountTransport
        {
            public readonly List<string> Requests = new List<string>();
            public Task<AccountHttpResponse> GetProfileAsync(string url, string ownerToken, string passcode, CancellationToken cancellation)
            {
                Requests.Add(url);
                return Task.FromResult(new AccountHttpResponse(200, new AccountReply
                {
                    profile = new AccountProfile { name = "Alice", gv = 10, gvLifetime = 20,
                        stats = new AccountStats { runs = 0, wins = 0, draws = 0, deaths = 0, kills = 0 } },
                    token = new string('c', 64), created = true
                }));
            }
        }

        sealed class Credentials : IAccountCredentialStore
        {
            public string Read(string scope, string name) => null;
            public bool WriteConfirmed(string scope, string name, string token) => false;
        }

        sealed class FakeTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public readonly List<byte[]> Sent = new List<byte[]>();
            public string ConnectedUrl;
            public int Closes;
            public void Connect(string url) { ConnectedUrl = url; }
            public void Send(byte[] frame) { Sent.Add(frame); }
            public void Close() { Closes++; Closed?.Invoke("fixture close"); }
            public void Poll() { }
            public void Open() { Opened?.Invoke(); }
            public void Deliver(ServerMsg message) { Received?.Invoke(message.Encode()); }
            public void Drop() { Closed?.Invoke("fixture disconnect"); }
            public List<WireCommand> TakeCommands()
            {
                var result = new List<WireCommand>();
                foreach (var frame in Sent)
                    if (ClientMsg.Decode(frame) is ClientMsg.Input input) result.AddRange(input.Commands);
                Sent.Clear();
                return result;
            }
        }

        sealed class Fixture : IDisposable
        {
            public GameObject Root;
            public MatchClient Client;
            public MatchHud Hud;
            public TrainingConsoleView Console => Hud.TrainingConsole;
            public AccountCoordinator Owner;
            public readonly Accounts Accounts = new Accounts();
            public readonly List<FakeTransport> Transports = new List<FakeTransport>();
            readonly List<GameObject> _arenas = new List<GameObject>();
            readonly List<Light2D> _lights = new List<Light2D>();
            readonly Light2D[] _priorLights = RegisteredLights();
            readonly EventSystem _priorEvents = EventSystem.current;
            readonly GameObject _priorSelection = EventSystem.current != null ? EventSystem.current.currentSelectedGameObject : null;
            readonly Keyboard _priorKeyboard = Keyboard.current;
            readonly InputSettings _priorSettings = InputSystem.settings;
            HideFlags _priorSettingsFlags;
            InputSettings _fixtureSettings;
            Keyboard _keyboard;
            GameObject _events;
            bool _priorMapToggleMode, _mapToggleCaptured;
            bool _disposed;

            public Fixture()
            {
                Assert.That(_priorSettings, Is.Not.Null, "InputSystem must own a live settings object before the fixture starts");
                _priorSettingsFlags = _priorSettings.hideFlags;
                try { Initialize(); }
                catch (Exception setupError)
                {
                    try { Dispose(); }
                    catch (Exception cleanupError) { throw new AggregateException(setupError, cleanupError); }
                    throw;
                }
            }

            void Initialize()
            {
                // Register the test EventSystem through its real lifecycle, then promote it to current.
                _events = new GameObject("Training integration EventSystem", typeof(UiInputRoutingEventSystem));
                var ownedEvents = _events.GetComponent<EventSystem>();
                ownedEvents.enabled = false; ownedEvents.enabled = true;
                EventSystem.current = ownedEvents;
                Assert.That(EventSystem.current, Is.SameAs(ownedEvents), "fixture EventSystem must be actually registered before HUD initialization");

                _fixtureSettings = ScriptableObject.Instantiate(_priorSettings);
                _fixtureSettings.updateMode = InputSettings.UpdateMode.ProcessEventsInDynamicUpdate;
                _fixtureSettings.backgroundBehavior = InputSettings.BackgroundBehavior.IgnoreFocus;
                _fixtureSettings.SetInternalFeatureFlag("RUN_PLAYER_UPDATES_IN_EDIT_MODE", true);
                if (_priorSettingsFlags == HideFlags.HideAndDontSave) _priorSettings.hideFlags = HideFlags.DontSave;
                InputSystem.settings = _fixtureSettings;
                Assert.That(ReferenceEquals(InputSystem.settings, _fixtureSettings), Is.True);
                _keyboard = InputSystem.AddDevice<Keyboard>();
                _keyboard.MakeCurrent();
                Assert.That(Keyboard.current, Is.SameAs(_keyboard));
                Assert.That(_keyboard.enabled, Is.True);

                Root = new GameObject("Training integration fixture");
                Client = Root.AddComponent<MatchClient>(); Client.enabled = false;
                Client.PageUrl = "https://training.example/play";
                Client.Url = "wss://training.example/arena/ws";
                Client.TrainingUrl = "wss://training.example/training/ws";
                Client.Profile = "Alice"; Client.Faction = 4;
                Owner = Root.AddComponent<AccountCoordinator>();
                Owner.Initialize(AccountEndpoint.FromPage(Client.PageUrl), Accounts, new Credentials());
                Field(Client, "<AccountOwner>k__BackingField", Owner);
                Assert.That(Client.AccountFlow, Is.SameAs(Owner.Flow));
                Assert.That(Client.IsDiagnostic, Is.False);

                Hud = Root.AddComponent<MatchHud>(); Hud.Initialize(Client);
                Field(Client, "<Hud>k__BackingField", Hud);
                Assert.That(EventSystem.current, Is.SameAs(ownedEvents));
                _priorMapToggleMode = Hud.TacticalMap.ToggleMode; _mapToggleCaptured = true;
                Hud.TacticalMap.SetToggleMode(false);
                Field(Client, "_transportFactory", new Func<ITransport>(() =>
                {
                    var arena = Client.Arena;
                    Assert.That(arena, Is.Not.Null, "public owned Join must create its real ArenaView");
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
                        // Keep every light reference even if Arena initialization fails partway through.
                        _lights.AddRange(arena.GetComponentsInChildren<Light2D>(true));
                    }
                    var transport = new FakeTransport(); Transports.Add(transport); return transport;
                }));
                Assert.That(Console, Is.Not.Null, "the HUD must own the optional TrainingConsoleView");
            }

            public async Task JoinReady(MatchLaunchMode mode)
            {
                int requestCount = Accounts.Requests.Count;
                int transportCount = Transports.Count;
                Client.Join("alice", 4, mode);
                await WaitFor(() => (Transports.Count > transportCount && Client.Session != null && Transports.Last().ConnectedUrl != null) ||
                    !string.IsNullOrEmpty(Client.AccountUiError) || Owner.Flow.Snapshot.State == AccountHubState.Failed);
                Assert.That(Owner.Flow.Snapshot.State, Is.EqualTo(AccountHubState.Owned));
                Assert.That(Owner.Flow.Snapshot.Failure, Is.EqualTo(AccountFailure.None));
                Assert.That(Owner.Flow.Snapshot.ConnectionFailure, Is.EqualTo(AccountConnectionFailure.None));
                Assert.That(Client.AccountUiError, Is.Empty);
                Assert.That(Accounts.Requests.Count, Is.EqualTo(requestCount + 1), "launch uses ordinary owned profile acquisition");
                Assert.That(Transports.Count, Is.EqualTo(transportCount + 1));
                Assert.That(Transports.Last().ConnectedUrl, Is.EqualTo(Client.LaunchTarget(mode).Url));
                Assert.That(Client.Session, Is.Not.Null);
            }

            public void Welcome()
            {
                Assert.That(Client.Session, Is.Not.Null);
                var transport = Transports.Last(); transport.Open();
                transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16],
                    Session = new byte[16], PlayerId = 3, TickRate = 20, ServerMs = 50, Map = new MapBlob(32, 32, new byte[1024]) });
            }

            public void Snapshot(bool training, uint tick = 1, double serverMs = 50)
            {
                Transports.Last().Deliver(new ServerMsg.Snapshot { Tick = tick, ServerTimeOverrideMs = serverMs, Phase = 1, Training = training,
                    Me = new WireSelf { Id = 3, X = 320, Y = 320, Hp = 100, MaxHp = 100, Status = 1, Weapon = 0 } });
            }

            public void Press(params Key[] keys)
            {
                Assert.That(_keyboard != null && _keyboard.added && _keyboard.enabled, Is.True, "controlled keyboard is still installed");
                _keyboard.MakeCurrent(); InputSystem.QueueStateEvent(_keyboard, new KeyboardState(keys)); InputSystem.Update();
                Assert.That(InputState.currentUpdateType, Is.EqualTo(InputUpdateType.Dynamic));
                Assert.That(_keyboard.wasUpdatedThisFrame, Is.True);
                foreach (var key in keys) Assert.That(Control(key).wasPressedThisFrame, Is.True, "missing player-style press edge for " + key);
            }

            public void ReleaseKeys()
            {
                InputSystem.QueueStateEvent(_keyboard, new KeyboardState()); InputSystem.Update();
                Assert.That(_keyboard.escapeKey.isPressed, Is.False);
                Assert.That(_keyboard.tabKey.isPressed, Is.False);
                Assert.That(_keyboard.wKey.isPressed, Is.False);
                Assert.That(_keyboard.qKey.isPressed, Is.False);
                Assert.That(_keyboard.eKey.isPressed, Is.False);
                Assert.That(_keyboard.digit1Key.isPressed, Is.False);
            }

            public void ReadBothAndFlush()
            {
                Hud.ReadUiInput(); Invoke(Client, "ReadInput"); Client.Session?.FlushInput();
            }

            static KeyControl Control(Key key)
            {
                var keyboard = Keyboard.current;
                switch (key)
                {
                    case Key.Tab: return keyboard.tabKey;
                    case Key.Escape: return keyboard.escapeKey;
                    case Key.W: return keyboard.wKey;
                    case Key.Q: return keyboard.qKey;
                    case Key.E: return keyboard.eKey;
                    case Key.C: return keyboard.cKey;
                    case Key.J: return keyboard.jKey;
                    case Key.B: return keyboard.bKey;
                    case Key.H: return keyboard.hKey;
                    case Key.Digit1: return keyboard.digit1Key;
                    default: Assert.Fail("No explicit input precondition for " + key); return null;
                }
            }

            public void Dispose()
            {
                if (_disposed) return; _disposed = true;
                try { if (Client != null) Client.Leave(); }
                finally
                {
                    try
                    {
                        if (_mapToggleCaptured && Hud != null && Hud.TacticalMap != null)
                            Hud.TacticalMap.SetToggleMode(_priorMapToggleMode);
                        for (int i = _arenas.Count - 1; i >= 0; i--)
                            if (_arenas[i] != null) { _arenas[i].SetActive(false); UnityEngine.Object.DestroyImmediate(_arenas[i]); }
                        if (Root != null) UnityEngine.Object.DestroyImmediate(Root);
                    }
                    finally
                    {
                        try
                        {
                            if (_events != null)
                            {
                                var system = _events.GetComponent<EventSystem>();
                                if (EventSystem.current == system) system.SetSelectedGameObject(null);
                                system.enabled = false; UnityEngine.Object.DestroyImmediate(_events);
                            }
                        }
                        finally
                        {
                            try
                            {
                                if (_priorEvents != null && _priorEvents.isActiveAndEnabled)
                                {
                                    EventSystem.current = _priorEvents;
                                    if (_priorSelection != null && _priorSelection.activeInHierarchy) _priorEvents.SetSelectedGameObject(_priorSelection);
                                }
                            }
                            finally
                            {
                                try { if (_keyboard != null && _keyboard.added) InputSystem.RemoveDevice(_keyboard); }
                                finally
                                {
                                    if (_priorKeyboard != null && _priorKeyboard.added) _priorKeyboard.MakeCurrent();
                                    try
                                    {
                                        if (_priorSettings != null && ReferenceEquals(InputSystem.settings, _fixtureSettings)) InputSystem.settings = _priorSettings;
                                    }
                                    finally
                                    {
                                        try { if (_priorSettings != null) _priorSettings.hideFlags = _priorSettingsFlags; }
                                        finally
                                        {
                                            if (_fixtureSettings != null && !ReferenceEquals(InputSystem.settings, _fixtureSettings)) UnityEngine.Object.DestroyImmediate(_fixtureSettings);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Assert.That(_arenas.All(x => x == null), Is.True, "fixture-owned Arenas are all destroyed");
                Assert.That(_lights.All(x => x == null), Is.True, "fixture-owned Arena lights are all destroyed");
                CollectionAssert.AreEquivalent(_priorLights, RegisteredLights(), "the fixture restores the installed URP light registry");
                Assert.That(EventSystem.current, Is.SameAs(_priorEvents != null && _priorEvents.isActiveAndEnabled ? _priorEvents : null));
                Assert.That(ReferenceEquals(InputSystem.settings, _priorSettings), Is.True);
            }
        }

        [Test]
        public async Task ArenaAndPendingLaunchNeverExposeTrainingConsoleAndArenaTabStillOpensMap()
        {
            using (var f = new Fixture())
            {
                await f.JoinReady(MatchLaunchMode.Arena);
                Assert.That(f.Console.IsOpen, Is.False);
                Assert.That(f.Console.ActionsAvailable, Is.False);
                Assert.That(f.Console.Root.gameObject.activeSelf, Is.False);
                Assert.That(f.Console.SetOpen(true), Is.False, "a pending owned launch cannot open Training controls");

                f.Welcome();
                Assert.That(f.Client.LaunchVerified, Is.False, "Welcome's default Training=false is not launch confirmation");
                Assert.That(f.Console.ActionsAvailable, Is.False);
                f.Snapshot(training: false);
                Assert.That(f.Client.LaunchVerified, Is.True);
                Assert.That(f.Console.ActionsAvailable, Is.False, "an accepted Arena fact never enables Training controls");
                Assert.That(f.Console.IsOpen, Is.False);

                f.Press(Key.Tab); f.Hud.ReadUiInput();
                Assert.That(f.Hud.TacticalMap.IsOpen, Is.True, "Arena Tab remains the map gesture");
                Assert.That(f.Console.IsOpen, Is.False);
                Assert.That(f.Transports.Last().TakeCommands(), Is.Empty);
                f.ReleaseKeys();
            }
        }

        [Test]
        public async Task TrainingRequiresTheExactSessionAndAcceptedSnapshotBeforeOpening()
        {
            using (var f = new Fixture())
            {
                await f.JoinReady(MatchLaunchMode.Training);
                var pending = f.Client.Session;
                Assert.That(f.Console.IsOpen, Is.False);
                Assert.That(f.Console.ActionsAvailable, Is.False);
                Assert.That(f.Console.SetOpen(true), Is.False);
                f.Welcome();
                Assert.That(f.Client.Session, Is.SameAs(pending));
                Assert.That(f.Client.ConfirmedPractice, Is.False, "Welcome alone cannot confirm Training");
                Assert.That(f.Console.ActionsAvailable, Is.False);
                f.Snapshot(training: true);
                Assert.That(f.Client.ConfirmedPractice, Is.True);
                Assert.That(f.Console.ActionsAvailable, Is.True);
                Assert.That(f.Console.IsOpen, Is.False, "matching Training fact enables a closed console without auto-opening it");
                Assert.That(f.Console.SetOpen(true), Is.True);
                Assert.That(f.Console.IsOpen, Is.True);
                Assert.That(f.Transports.Last().TakeCommands(), Is.Empty, "opening the console is read-only");
            }
        }

        [Test]
        public async Task TrainingConsoleFlushesEarlierOrdinaryCommandsBeforeItsExactTrainIntent()
        {
            using (var f = new Fixture())
            {
                await f.JoinReady(MatchLaunchMode.Training); f.Welcome(); f.Snapshot(training: true);
                Assert.That(f.Console.SetOpen(true), Is.True);
                var transport = f.Transports.Last();
                Assert.That(transport.TakeCommands(), Is.Empty, "console opening sends no input");
                f.Client.Session.Input.Swap(1);
                f.Client.Session.Input.UseConsumable();
                f.Console.Root.GetComponentsInChildren<Button>(true).Single(button => button.name == "ClearAction").onClick.Invoke();
                var commands = transport.TakeCommands();
                CollectionAssert.AreEqual(new[] { CommandKind.Swap, CommandKind.UseConsumable, CommandKind.Train }, commands.Select(x => x.Kind).ToArray());
                Assert.That(commands[0].Slot, Is.EqualTo(1));
                Assert.That(commands[2].TrainCommand, Is.EqualTo(5));
                Assert.That(commands[2].TrainId, Is.EqualTo(0));
                Assert.That(commands[2].TrainCount, Is.EqualTo(0UL));
                Assert.That(commands[2].TrainOptions, Is.Empty);
            }
        }

        [Test]
        public async Task ReconnectWelcomeAndSourceClockCutRevokeConsoleUntilAcceptedTrainingFact()
        {
            using (var f = new Fixture())
            {
                await f.JoinReady(MatchLaunchMode.Training); f.Welcome(); f.Snapshot(training: true);
                Assert.That(f.Console.SetOpen(true), Is.True);
                var session = f.Client.Session;
                bool resetObservedClosed = false;
                Action resetObserver = () => resetObservedClosed = !f.Console.IsOpen && !f.Console.ActionsAvailable;
                session.TimelineReset += resetObserver;
                f.Snapshot(training: true, tick: 2, serverMs: 25);
                session.TimelineReset -= resetObserver;
                Assert.That(resetObservedClosed, Is.True, "timeline reset observers see the console revoked before new snapshot callbacks");
                Assert.That(f.Client.ConfirmedPractice, Is.True, "the current accepted Training snapshot can establish the new epoch fact");
                Assert.That(f.Console.ActionsAvailable, Is.True);
                Assert.That(f.Console.IsOpen, Is.False, "clock reset closes the console even when that snapshot reconfirms Training");

                Assert.That(f.Console.SetOpen(true), Is.True);
                f.Transports.Last().Drop();
                Assert.That(f.Console.IsOpen, Is.False);
                Assert.That(f.Console.ActionsAvailable, Is.False, "disconnect revokes the accepted launch context");
                f.Transports.Last().Open();
                f.Transports.Last().Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16],
                    Session = new byte[16], PlayerId = 3, TickRate = 20, ServerMs = 75, Map = new MapBlob(32, 32, new byte[1024]) });
                Assert.That(f.Client.ConfirmedPractice, Is.False, "resumed Welcome starts a new unconfirmed epoch");
                Assert.That(f.Console.IsOpen, Is.False);
                Assert.That(f.Console.ActionsAvailable, Is.False);
                f.Snapshot(training: true, tick: 1, serverMs: 75);
                Assert.That(f.Client.ConfirmedPractice, Is.True);
                Assert.That(f.Console.ActionsAvailable, Is.True);
                Assert.That(f.Console.IsOpen, Is.False, "fresh accepted fact rebinds but does not reopen the console");
            }
        }

        [Test]
        public async Task CapturedConsoleCallbackCannotQueueIntoARetiredOrReplacementSession()
        {
            using (var f = new Fixture())
            {
                await f.JoinReady(MatchLaunchMode.Training); f.Welcome(); f.Snapshot(training: true);
                Assert.That(f.Console.SetOpen(true), Is.True);
                var oldTransport = f.Transports.Last();
                var oldButton = f.Console.Root.GetComponentsInChildren<Button>(true).Single(button => button.name == "CampAction");
                Button.ButtonClickedEvent stale = oldButton.onClick;

                f.Client.Leave();
                Assert.That(f.Client.Session, Is.Null);
                Assert.That(f.Console.ActionsAvailable, Is.False);
                Assert.That(f.Console.IsOpen, Is.False);
                await f.JoinReady(MatchLaunchMode.Training); f.Welcome(); f.Snapshot(training: true);
                Assert.That(f.Client.Session, Is.Not.Null);
                Assert.That(f.Console.SetOpen(true), Is.True);
                stale.Invoke();
                Assert.That(oldTransport.TakeCommands().Where(command => command.Kind == CommandKind.Train), Is.Empty);
                Assert.That(f.Transports.Last().TakeCommands(), Is.Empty, "retired callback cannot borrow the replacement Session");
                f.Console.Root.GetComponentsInChildren<Button>(true).Single(button => button.name == "CampAction").onClick.Invoke();
                Assert.That(f.Transports.Last().TakeCommands().Single().Kind, Is.EqualTo(CommandKind.Train));
            }
        }

        [Test]
        public async Task ClosedTrainingTabEntersConsoleFocusAndFocusedTextOwnsWorldKeys()
        {
            using (var f = new Fixture())
            {
                await f.JoinReady(MatchLaunchMode.Training); f.Welcome(); f.Snapshot(training: true);
                Assert.That(f.Console.IsOpen, Is.False);
                EventSystem.current.SetSelectedGameObject(null);
                f.Press(Key.Tab); f.Hud.ReadUiInput();
                Assert.That(f.Console.ContainsFocus, Is.True, "Tab enters the closed Training console focus root");
                Assert.That(f.Hud.TacticalMap.IsOpen, Is.False, "the console focus root owns Tab during Training");
                f.ReleaseKeys();

                foreach (var key in new[] { Key.W, Key.Q, Key.E, Key.Digit1 })
                {
                    f.Press(key); f.ReadBothAndFlush();
                    Assert.That(f.Transports.Last().TakeCommands(), Is.Empty, "focused console controls own " + key + " over gameplay");
                    f.ReleaseKeys();
                }

                Assert.That(f.Console.SetOpen(true), Is.True);
                var field = f.Console.Root.GetComponentInChildren<TMP_InputField>(true);
                Assert.That(field, Is.Not.Null);
                EventSystem.current.SetSelectedGameObject(field.gameObject); field.ActivateInputField(); Invoke(field, "LateUpdate");
                Assert.That(field.isFocused, Is.True);
                Assert.That(f.Hud.BlocksKeyboardInput, Is.True);
                foreach (var key in new[] { Key.W, Key.Q, Key.E, Key.Digit1, Key.Tab })
                {
                    f.Press(key); f.ReadBothAndFlush();
                    Assert.That(f.Transports.Last().TakeCommands(), Is.Empty, "typing must not become gameplay command " + key);
                    Assert.That(f.Console.IsOpen, Is.True);
                    Assert.That(f.Hud.TacticalMap.IsOpen, Is.False);
                    f.ReleaseKeys();
                }
                field.DeactivateInputField(); EventSystem.current.SetSelectedGameObject(null);
            }
        }

        [Test]
        public async Task EscapeClosesTrainingConsoleAndOnlyTheNextPhysicalEscapeLeavesTraining()
        {
            using (var f = new Fixture())
            {
                await f.JoinReady(MatchLaunchMode.Training); f.Welcome(); f.Snapshot(training: true);
                Assert.That(f.Console.SetOpen(true), Is.True);
                var session = f.Client.Session;
                f.Press(Key.Escape); f.ReadBothAndFlush();
                Assert.That(f.Console.IsOpen, Is.False);
                Assert.That(f.Client.Session, Is.SameAs(session), "the same Escape cannot also trigger Leave");
                Assert.That(f.Transports.Last().Closes, Is.EqualTo(0));
                Assert.That(f.Transports.Last().TakeCommands(), Is.Empty, "closing the console emits no world command");
                uint consumedUpdate = InputState.updateCount;
                f.Hud.ReadUiInput(); f.Hud.ReadUiInput();
                Assert.That(InputState.updateCount, Is.EqualTo(consumedUpdate), "both reads observe the same physical input update");
                Assert.That(f.Client.Session, Is.SameAs(session), "re-reading one Escape edge cannot leave Training");
                Assert.That(f.Console.IsOpen, Is.False);
                f.ReleaseKeys();
                f.Press(Key.Escape); f.Hud.ReadUiInput();
                Assert.That(f.Client.Session, Is.Null, "a new Escape press after the console is closed retains Training's Leave behavior");
                Assert.That(f.Transports.Last().TakeCommands(), Is.Empty);
            }
        }

        [Test]
        public async Task WindowFocusLossClosesTrainingConsoleAndFreshFactCanRestoreIt()
        {
            using (var f = new Fixture())
            {
                await f.JoinReady(MatchLaunchMode.Training); f.Welcome(); f.Snapshot(training: true);
                Assert.That(f.Console.SetOpen(true), Is.True);
                EventSystem.current.SetSelectedGameObject(f.Console.Root.GetComponentInChildren<Button>(true).gameObject);
                Invoke(f.Client, "OnApplicationFocus", false);
                Assert.That(f.Console.IsOpen, Is.False);
                Assert.That(f.Console.ContainsFocus, Is.False);
                Assert.That(f.Console.ActionsAvailable, Is.False, "window-focus loss revokes the console binding until another accepted fact");
                f.ReleaseKeys();
                f.Snapshot(training: true, tick: 2, serverMs: 75);
                Assert.That(f.Console.ActionsAvailable, Is.False, "a valid Training snapshot received while the window is unfocused cannot rebind the console");
                f.Hud.RestoreUiFocusAfterWindowGain();
                Assert.That(f.Console.ActionsAvailable, Is.False, "regaining focus alone does not replay the rejected snapshot");
                f.Snapshot(training: true, tick: 3, serverMs: 100);
                Assert.That(f.Console.ActionsAvailable, Is.True);
                Assert.That(f.Console.IsOpen, Is.False);
            }
        }

        [Test]
        public async Task PointerCloseConsumesItsInputUpdateButWorldInputReturnsOnTheNextUpdate()
        {
            using (var f = new Fixture())
            {
                await f.JoinReady(MatchLaunchMode.Training); f.Welcome(); f.Snapshot(training: true);
                Assert.That(f.Console.SetOpen(true), Is.True);
                var session = f.Client.Session;
                f.Press(Key.W);
                f.Console.Root.GetComponentsInChildren<Button>(true).Single(button => button.name == "Close").onClick.Invoke();
                Assert.That(f.Console.IsOpen, Is.False);
                Assert.That(f.Hud.BlocksKeyboardInput, Is.True, "closing by pointer retains ownership for the current input update");
                f.ReadBothAndFlush();
                Assert.That(f.Transports.Last().TakeCommands(), Is.Empty, "the same W edge cannot leak into world movement");
                Assert.That(f.Client.Session, Is.SameAs(session));

                f.ReleaseKeys();
                f.Press(Key.W); f.ReadBothAndFlush();
                Assert.That(f.Console.ContainsFocus, Is.False);
                Assert.That(f.Hud.BlocksKeyboardInput, Is.False);
                Assert.That(f.Transports.Last().TakeCommands().Any(command => command.Kind == CommandKind.Move), Is.True,
                    "ordinary movement resumes on a later physical input update");
            }
        }

        [Test]
        public async Task OpeningHigherPanelOnTheSameReadCannotAlsoFocusOrChooseAReward()
        {
            foreach (var shortcut in new[] { Key.J, Key.B, Key.H })
            {
                using (var f = new Fixture())
                {
                    await f.JoinReady(MatchLaunchMode.Training);
                    f.Welcome();
                    f.Transports.Last().Deliver(new ServerMsg.State
                    {
                        Tick = 1,
                        Items = new StateItem[]
                        {
                            new RewardChestsState { Rows = new[]
                            {
                                new WireRewardChest
                                {
                                    Handle = new RewardChestHandle(73), X = 320, Y = 320, ExpiresAt = 15000, CanChoose = true,
                                    Options = new[]
                                    {
                                        new WireRewardOption { Kind = 1, Id = 0 },
                                        new WireRewardOption { Kind = 1, Id = 79 },
                                        new WireRewardOption { Kind = 2, Id = 7 }
                                    }
                                }
                            } }
                        }
                    });
                    f.Snapshot(training: true, tick: 1, serverMs: 50);
                    Invoke(f.Hud, "LateUpdate");
                    Assert.That(f.Hud.transform.Find("MatchUI/Rewards").gameObject.activeSelf, Is.True,
                        "the decoded chest snapshot presents three eligible server options before opening a panel");
                    Assert.That(f.Console.SetOpen(true), Is.True);
                    EventSystem.current.SetSelectedGameObject(null); // Exercise the normal pointer-owned, unfocused console policy.

                    f.Press(shortcut, Key.C, Key.Digit1);
                    f.ReadBothAndFlush();
                    bool expectedPanel = shortcut == Key.J ? f.Hud.QuestJournal.IsVisible :
                        f.Hud.transform.Find(shortcut == Key.B ? "MatchUI/BuildDrawer" : "MatchUI/ControlsHelp").gameObject.activeSelf;
                    Assert.That(expectedPanel, Is.True, "the pressed panel shortcut still opens its intended surface");
                    Assert.That(f.Console.IsOpen, Is.False);
                    Assert.That(f.Console.ActionsAvailable, Is.False, "the higher surface revokes Training actions");
                    Assert.That(f.Hud.ChestOwnsDigits, Is.False, "C and Digit1 from the same read cannot establish chest focus");
                    Assert.That(f.Client.Session, Is.Not.Null, "same-read panel routing cannot leave the current Training session");
                    Assert.That(f.Transports.Last().TakeCommands(), Is.Empty, "the same-read Digit1 cannot choose a chest or queue gameplay");
                    f.ReleaseKeys();
                }
            }
        }

        /// <summary>Checks public Escape-to-Hide ownership; TMP's deferred fade pixels belong to a rendered player proof.</summary>
        [Test]
        public async Task DropdownEscapeRequestsPopupHideBeforeConsoleCloseAndTrainingLeave()
        {
            using (var f = new Fixture())
            {
                await f.JoinReady(MatchLaunchMode.Training); f.Welcome(); f.Snapshot(training: true);
                Assert.That(f.Console.SetOpen(true), Is.True);
                var dropdownObject = new GameObject("Training fixture dropdown", typeof(RectTransform), typeof(Image), typeof(EditModeTrainingDropdown));
                dropdownObject.transform.SetParent(f.Console.Panel, false);
                var dropdown = dropdownObject.GetComponent<EditModeTrainingDropdown>();
                var sourceText = f.Console.Panel.GetComponentInChildren<TMP_Text>(true);
                dropdown.captionText = sourceText;
                var template = new GameObject("Dropdown template", typeof(RectTransform), typeof(Image));
                template.transform.SetParent(dropdownObject.transform, false);
                var content = new GameObject("Dropdown content", typeof(RectTransform));
                content.transform.SetParent(template.transform, false);
                var item = new GameObject("Dropdown item", typeof(RectTransform), typeof(Image), typeof(Toggle));
                item.transform.SetParent(content.transform, false);
                var itemTextObject = new GameObject("Item label", typeof(RectTransform), typeof(TextMeshProUGUI));
                itemTextObject.transform.SetParent(item.transform, false);
                var itemText = itemTextObject.GetComponent<TextMeshProUGUI>();
                itemText.font = sourceText.font;
                dropdown.template = (RectTransform)template.transform;
                dropdown.itemText = itemText;
                dropdown.AddOptions(new List<string> { "Choice A", "Choice B" });
                template.SetActive(false);
                dropdown.InitializeForEditMode();
                EventSystem.current.SetSelectedGameObject(dropdownObject);
                dropdown.Show();
                Assert.That(dropdown.IsExpanded, Is.True, "the test opens an actual TMP_Dropdown popup");

                var session = f.Client.Session;
                f.Press(Key.Escape); f.Hud.ReadUiInput();
                Assert.That(dropdown.HideRequested, Is.True, "the selected TMP dropdown receives the first Escape through its public Hide path");
                Assert.That(f.Console.IsOpen, Is.True);
                Assert.That(f.Client.Session, Is.SameAs(session));
                Assert.That(f.Transports.Last().TakeCommands(), Is.Empty);
                dropdown.enabled = false; // TMP's real OnDisable completes popup cleanup without EditMode deferred destruction.
                Assert.That(dropdown.IsExpanded, Is.False);
                f.ReleaseKeys();

                f.Press(Key.Escape); f.Hud.ReadUiInput();
                Assert.That(f.Console.IsOpen, Is.False, "the next Escape closes the console");
                Assert.That(f.Client.Session, Is.SameAs(session));
                f.ReleaseKeys();

                f.Press(Key.Escape); f.Hud.ReadUiInput();
                Assert.That(f.Client.Session, Is.Null, "a later Escape retains the normal Training Leave action");
                Assert.That(f.Transports.Last().TakeCommands(), Is.Empty);
            }
        }

        [Test]
        public async Task HigherSettingsModalUnbindsConsoleUntilANewAcceptedSnapshot()
        {
            using (var f = new Fixture())
            {
                await f.JoinReady(MatchLaunchMode.Training); f.Welcome(); f.Snapshot(training: true);
                Assert.That(f.Console.SetOpen(true), Is.True);
                var settings = f.Hud.transform.Find("MatchUI/Settings").GetComponent<Button>();
                settings.onClick.Invoke();
                Assert.That(f.Hud.transform.Find("MatchUI/ModernSettings").gameObject.activeSelf, Is.True);
                Assert.That(f.Console.IsOpen, Is.False);
                Assert.That(f.Console.ActionsAvailable, Is.False, "a higher modal revokes the Training console binding");
                var session = f.Client.Session;
                f.Press(Key.Escape); f.Hud.ReadUiInput(); f.Hud.ReadUiInput();
                Assert.That(f.Client.Session, Is.SameAs(session), "re-reading the settings Escape edge cannot leave the underlying Training session");
                Assert.That(f.Hud.transform.Find("MatchUI/ModernSettings").gameObject.activeSelf, Is.False);
                Assert.That(f.Console.ActionsAvailable, Is.False, "closing a higher modal still waits for a new accepted snapshot");
                f.ReleaseKeys();
                f.Snapshot(training: true, tick: 2, serverMs: 75);
                Assert.That(f.Console.ActionsAvailable, Is.True);
                Assert.That(f.Console.IsOpen, Is.False);
            }
        }

        [Test]
        public async Task WrongServerModeNeverLeavesAnArenaTrainingConsoleBound()
        {
            using (var f = new Fixture())
            {
                await f.JoinReady(MatchLaunchMode.Arena); f.Welcome();
                f.Snapshot(training: true);
                Assert.That(f.Client.Session, Is.Null, "the launch owner refuses a mismatching delivered mode");
                Assert.That(f.Console.ActionsAvailable, Is.False);
                Assert.That(f.Console.IsOpen, Is.False);
                Assert.That(f.Console.Root.gameObject.activeSelf, Is.False);
                Assert.That(f.Accounts.Requests.Count, Is.EqualTo(1), "mode mismatch does not start another ownership or fallback path");
            }
        }

        static async Task WaitFor(Func<bool> condition)
        {
            var timeout = System.Diagnostics.Stopwatch.StartNew();
            while (!condition() && timeout.Elapsed < TimeSpan.FromSeconds(5)) await Task.Delay(1);
            Assert.That(condition(), Is.True, "public owned Join did not finish its prerequisite");
        }

        static void Field(object target, string name, object value) => target.GetType().GetField(name, Private).SetValue(target, value);
        static object Get(object target, string name) => target.GetType().GetField(name, Private).GetValue(target);
        static object Invoke(object target, string name, params object[] args)
        {
            var method = target.GetType().GetMethod(name, Private);
            Assert.That(method, Is.Not.Null, "missing expected method " + name);
            return method.Invoke(target, args);
        }

        static Light2D[] RegisteredLights()
        {
            var manager = typeof(Light2D).Assembly.GetType("UnityEngine.Rendering.Universal.Light2DManager", true);
            var property = manager.GetProperty("lights", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
            Assert.That(property, Is.Not.Null);
            return ((System.Collections.IEnumerable)property.GetValue(null)).Cast<Light2D>().ToArray();
        }
    }
}
