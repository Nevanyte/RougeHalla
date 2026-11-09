using System;
using System.Collections.Generic;
using System.Reflection;
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

namespace Roguehalla.Client.Tests
{
    [ExecuteAlways]
    sealed class UiInputRoutingEventSystem : EventSystem { }

    /// <summary>Exercises the actual UI and gameplay input readers with a decoded local Session.</summary>
    public sealed class UiInputRoutingEditModeTests
    {
        sealed class FakeTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            readonly Queue<byte[]> _incoming = new Queue<byte[]>();
            public readonly List<byte[]> Sent = new List<byte[]>();
            public void Connect(string url) { }
            public void Send(byte[] frame) { Sent.Add(frame); }
            public void Close() { Closed?.Invoke("closed"); }
            public void Poll() { while (_incoming.Count != 0) Received?.Invoke(_incoming.Dequeue()); }
            public void Open() { Opened?.Invoke(); }
            public void Deliver(ServerMsg message) { _incoming.Enqueue(message.Encode()); }
            public List<WireCommand> TakeCommands()
            {
                var commands = new List<WireCommand>();
                for (int i = 0; i < Sent.Count; i++)
                    if (ClientMsg.Decode(Sent[i]) is ClientMsg.Input input)
                        commands.AddRange(input.Commands);
                Sent.Clear();
                return commands;
            }
        }

        GameObject _root, _ownedEvents;
        EventSystem _previousEvents;
        MatchClient _client;
        MatchHud _hud;
        Session _session;
        FakeTransport _transport;
        Keyboard _keyboard;
        Keyboard _previousKeyboard;
        InputSettings _originalInputSettings, _fixtureInputSettings;
        HideFlags _originalInputSettingsHideFlags;
        TMP_InputField _typingField;
        bool _oldToggleMode, _cleanupFinished;

        [SetUp]
        public void SetUp()
        {
            _cleanupFinished = false;
            _previousEvents = EventSystem.current;
            _originalInputSettings = InputSystem.settings;
            _previousKeyboard = Keyboard.current;
            try
            {
                Assert.That(_originalInputSettings != null, Is.True, "the manager must start with live InputSettings");
                _originalInputSettingsHideFlags = _originalInputSettings.hideFlags;
                SetUpFixture();
            }
            catch (Exception setupError)
            {
                try { TearDown(); }
                catch (Exception cleanupError) { throw new AggregateException(setupError, cleanupError); }
                throw;
            }
        }

        void SetUpFixture()
        {
            // ExecuteAlways ensures EventSystem.OnEnable registers this test instance in EditMode.
            // Keep the project EventSystem active and move this known-registered instance to the front.
            _ownedEvents = new GameObject("UI input routing test EventSystem", typeof(UiInputRoutingEventSystem));
            var ownedSystem = _ownedEvents.GetComponent<UiInputRoutingEventSystem>();
            // Force a real disable/enable lifecycle before promoting it; EditMode creation alone may not register it.
            ownedSystem.enabled = false;
            ownedSystem.enabled = true;
            EventSystem.current = ownedSystem;
            Assert.That(EventSystem.current, Is.SameAs(ownedSystem), "test EventSystem must be registered before UI setup");
            // EditMode's no-argument InputSystem.Update() normally selects the Editor update. In Input System 1.20,
            // that path swaps editor buffers without advancing InputDevice.m_CurrentUpdateStepCount, so button edges
            // fail the wasUpdatedThisFrame guard used by wasPressedThisFrame. Use a temporary settings clone with the
            // package's supported player-updates-in-EditMode feature enabled, and restore the original settings asset.
            _fixtureInputSettings = ScriptableObject.Instantiate(_originalInputSettings);
            _fixtureInputSettings.updateMode = InputSettings.UpdateMode.ProcessEventsInDynamicUpdate;
            _fixtureInputSettings.backgroundBehavior = InputSettings.BackgroundBehavior.IgnoreFocus;
            _fixtureInputSettings.SetInternalFeatureFlag("RUN_PLAYER_UPDATES_IN_EDIT_MODE", true);
            // InputManager treats the exact HideAndDontSave combination as an internally-owned settings object
            // and destroys it when replaced. Retain the no-save/unload flags while the fixture owns the reference.
            if (_originalInputSettingsHideFlags == HideFlags.HideAndDontSave)
                _originalInputSettings.hideFlags = HideFlags.DontSave;
            InputSystem.settings = _fixtureInputSettings;
            Assert.That(_originalInputSettings != null, Is.True, "replacing settings must not destroy the leased original");
            Assert.That(ReferenceEquals(InputSystem.settings, _fixtureInputSettings), Is.True);
            _keyboard = InputSystem.AddDevice<Keyboard>();
            _keyboard.MakeCurrent();
            Assert.That(_keyboard.enabled, Is.True, "injected test keyboard must be enabled");
            Assert.That(Keyboard.current, Is.SameAs(_keyboard), "keyboard consumers must see the controlled device");

            _root = new GameObject("UI input routing fixture");
            _client = _root.AddComponent<MatchClient>();
            _client.enabled = false;
            Invoke(_client, "InitializeLayoutReview", CreateSession());
            _hud = _client.Hud;
            _session = _client.Session;
            _oldToggleMode = _hud.TacticalMap.ToggleMode;
            _hud.TacticalMap.SetToggleMode(false);

            _session.Connect();
            _transport.Open();
            _transport.Deliver(new ServerMsg.Welcome
            {
                Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16], PlayerId = 3,
                TickRate = 20, Tick = 1, ServerMs = 50, Map = new MapBlob(32, 32, new byte[1024])
            });
            _transport.Deliver(new ServerMsg.State
            {
                Tick = 1,
                Items = new StateItem[]
                {
                    new RewardChestsState { Rows = new[] { new WireRewardChest
                    {
                        Handle = new RewardChestHandle(73), X = 320, Y = 320, ExpiresAt = 15000, CanChoose = true,
                        Options = new[]
                        {
                            new WireRewardOption { Kind = 1, Id = 0 },
                            new WireRewardOption { Kind = 1, Id = 79 },
                            new WireRewardOption { Kind = 2, Id = 7 }
                        }
                    } } }
                }
            });
            _transport.Deliver(new ServerMsg.Snapshot
            {
                Tick = 1, ServerTimeOverrideMs = 1000, Phase = 1,
                Me = new WireSelf { Id = 3, X = 320, Y = 320, Hp = 100, MaxHp = 100, Status = 1, Weapon = 0 }
            });
            _session.Poll();
            Invoke(_hud, "LateUpdate");
            Assert.That(_session.State, Is.EqualTo(SessionState.InMatch));
            Assert.That(_hud.transform.Find("MatchUI/Rewards").gameObject.activeSelf, Is.True, "decoded chest is visible and eligible");
        }

        [TearDown]
        public void TearDown()
        {
            if (_cleanupFinished) return;
            _cleanupFinished = true;
            try
            {
                CleanupUi();
            }
            finally
            {
                try
                {
                    CleanupEventSystem();
                }
                finally
                {
                    try
                    {
                        CleanupKeyboard();
                    }
                    finally
                    {
                        RestoreInputSettings();
                    }
                }
            }
        }

        void CleanupUi()
        {
            try
            {
                if (_typingField != null) _typingField.DeactivateInputField();
            }
            finally
            {
                try
                {
                    if (_hud != null && _hud.TacticalMap != null) _hud.TacticalMap.SetToggleMode(_oldToggleMode);
                }
                finally
                {
                    if (_root != null) UnityEngine.Object.DestroyImmediate(_root);
                }
            }
        }

        void CleanupEventSystem()
        {
            try
            {
                if (_ownedEvents != null)
                {
                    var ownedSystem = _ownedEvents.GetComponent<EventSystem>();
                    if (ownedSystem != null && EventSystem.current == ownedSystem) ownedSystem.SetSelectedGameObject(null);
                }
            }
            finally
            {
                try
                {
                    if (_ownedEvents != null) _ownedEvents.SetActive(false);
                }
                finally
                {
                    try
                    {
                        if (_ownedEvents != null) UnityEngine.Object.DestroyImmediate(_ownedEvents);
                    }
                    finally
                    {
                        if (_previousEvents != null && EventSystem.current != _previousEvents) EventSystem.current = _previousEvents;
                        Assert.That(EventSystem.current == _previousEvents,
                            "the fixture must restore the previously current EventSystem");
                    }
                }
            }
        }

        void CleanupKeyboard()
        {
            try
            {
                if (_keyboard != null && _keyboard.added) InputSystem.RemoveDevice(_keyboard);
            }
            finally
            {
                if (_previousKeyboard != null && _previousKeyboard.added) _previousKeyboard.MakeCurrent();
            }
        }

        void RestoreInputSettings()
        {
            try
            {
                // Only replace the settings object installed by this fixture. A foreign replacement is a failure,
                // not permission to destroy another owner's settings object.
                if (_originalInputSettings != null && ReferenceEquals(InputSystem.settings, _fixtureInputSettings))
                    InputSystem.settings = _originalInputSettings;
            }
            finally
            {
                try
                {
                    if (_originalInputSettings != null) _originalInputSettings.hideFlags = _originalInputSettingsHideFlags;
                }
                finally
                {
                    try
                    {
                        if (_fixtureInputSettings != null && !ReferenceEquals(InputSystem.settings, _fixtureInputSettings))
                            UnityEngine.Object.DestroyImmediate(_fixtureInputSettings);
                    }
                    finally
                    {
                        Assert.That(_originalInputSettings != null, Is.True, "the original InputSettings asset must remain alive");
                        Assert.That(ReferenceEquals(InputSystem.settings, _originalInputSettings), Is.True,
                            "the exact original InputSettings reference must be restored");
                        Assert.That(_originalInputSettings.hideFlags, Is.EqualTo(_originalInputSettingsHideFlags),
                            "the original InputSettings hide flags must be restored exactly");
                    }
                }
            }
        }

        Session CreateSession()
        {
            _transport = new FakeTransport();
            return new Session(_transport, new SessionOptions { Url = "ws://ui-input-test/ws", Profile = "input-test", Now = () => 1000 });
        }

        [Test]
        public void PlainDigitOneQueuesWeaponSwap()
        {
            Press(Key.Digit1);
            ReadBothAndFlush();

            var commands = _transport.TakeCommands();
            Assert.That(commands.Count, Is.EqualTo(1));
            Assert.That(commands[0].Kind, Is.EqualTo(CommandKind.Swap));
            Assert.That(commands[0].Slot, Is.EqualTo((byte?)0));
        }

        [Test]
        public void ChestChoiceConsumesDigitEvenAsItReleasesChestFocus()
        {
            Press(Key.C);
            _hud.ReadUiInput();
            Assert.That(_hud.ChestOwnsDigits, Is.True);
            ReleaseKeys();
            _hud.ReadUiInput();

            Press(Key.Digit1);
            ReadBothAndFlush();

            var commands = _transport.TakeCommands();
            Assert.That(commands.Count, Is.EqualTo(1));
            Assert.That(commands[0].Kind, Is.EqualTo(CommandKind.Choose));
            Assert.That(commands[0].RewardRef.Value, Is.EqualTo(73));
            Assert.That(commands[0].Pick, Is.EqualTo((sbyte)0));
            Assert.That(_hud.ChestOwnsDigits, Is.True, "the same-frame consume marker survives focus release");

            ReleaseKeys();
            ReadBothAndFlush();
            Assert.That(_transport.TakeCommands(), Is.Empty);
        }

        [Test]
        public void TabOpensMapAndBlocksPointerWhileWasdStillQueuesMove()
        {
            Press(Key.Tab, Key.W);
            ReadBothAndFlush();

            Assert.That(_hud.TacticalMap.IsOpen, Is.True);
            Assert.That(_hud.BlocksPointerInput, Is.True);
            Assert.That(_hud.BlocksKeyboardInput, Is.False);
            var commands = _transport.TakeCommands();
            Assert.That(commands.Exists(command => command.Kind == CommandKind.Move), Is.True);
        }

        [Test]
        public void MenuAndResultsPreventTabFromOpeningMap()
        {
            var menu = _hud.transform.Find("MatchUI/JoinMenu").gameObject;
            menu.SetActive(true);
            Press(Key.Tab);
            _hud.ReadUiInput();
            Assert.That(_hud.TacticalMap.IsOpen, Is.False);
            Assert.That(_hud.BlocksKeyboardInput, Is.True);
            ReleaseKeys();
            menu.SetActive(false);

            var results = _hud.transform.Find("MatchUI/Results").gameObject;
            results.SetActive(true);
            Press(Key.Tab);
            _hud.ReadUiInput();
            Assert.That(_hud.TacticalMap.IsOpen, Is.False);
            Assert.That(_hud.BlocksKeyboardInput, Is.True);
        }

        [Test]
        public void ClosingSettingsRestoresThePreviouslyFocusedWorldHudControl()
        {
            var control = _hud.transform.Find("MatchUI/PlayerHUD/BuildStrip/BuildDetails").gameObject;
            var selectable = control.GetComponent<UnityEngine.UI.Selectable>();
            Assert.That(control.activeInHierarchy, Is.True);
            Assert.That(selectable != null && selectable.IsInteractable(), Is.True, "the build control must be available to focus");
            EventSystem.current.SetSelectedGameObject(control);
            Assert.That(EventSystem.current.currentSelectedGameObject, Is.SameAs(control));
            Invoke(_hud, "RefreshWorldHudVisibility");

            Invoke(_hud, "ToggleSettings");
            Invoke(_hud, "RefreshWorldHudVisibility");
            Assert.That(control.activeInHierarchy, Is.False,
                "opening settings hides the previously focused combat HUD control");

            Invoke(_hud, "ToggleSettings");
            Invoke(_hud, "RefreshWorldHudVisibility");
            Assert.That(control.activeInHierarchy, Is.True);
            Assert.That(EventSystem.current.currentSelectedGameObject, Is.SameAs(control),
                "the exact prior HUD control is restored after settings closes");
        }

        [Test]
        public void SettingsOwnsKeyboardAndBlocksBuildHelpShortcutsWithoutWorldCommands()
        {
            Invoke(_hud, "ToggleSettings");
            var settings = _hud.transform.Find("MatchUI/SettingsPanel").gameObject;
            Assert.That(settings.activeSelf, Is.True);

            Press(Key.B);
            ReadBothAndFlush();
            Assert.That(settings.activeSelf, Is.True);
            Assert.That(_hud.transform.Find("MatchUI/BuildDrawer").gameObject.activeSelf, Is.False,
                "B must not open the build drawer over settings");
            Assert.That(_hud.transform.Find("MatchUI/ControlsHelp").gameObject.activeSelf, Is.False,
                "B must not open Help over settings");
            Assert.That(_transport.TakeCommands(), Is.Empty, "modal shortcut input must not enqueue world commands");

            ReleaseKeys();
            Press(Key.H);
            ReadBothAndFlush();
            Assert.That(settings.activeSelf, Is.True);
            Assert.That(_hud.transform.Find("MatchUI/BuildDrawer").gameObject.activeSelf, Is.False);
            Assert.That(_hud.transform.Find("MatchUI/ControlsHelp").gameObject.activeSelf, Is.False,
                "H must not open Help over settings");
            Assert.That(_transport.TakeCommands(), Is.Empty, "modal shortcut input must not enqueue world commands");
        }

        [Test]
        public void BuildAndHelpShortcutsStillToggleAndSwitchBetweenTheirPanels()
        {
            var drawer = _hud.transform.Find("MatchUI/BuildDrawer").gameObject;
            var help = _hud.transform.Find("MatchUI/ControlsHelp").gameObject;

            Press(Key.B);
            _hud.ReadUiInput();
            Assert.That(drawer.activeSelf, Is.True);
            ReleaseKeys();
            Press(Key.B);
            _hud.ReadUiInput();
            Assert.That(drawer.activeSelf, Is.False, "B closes the build drawer when it owns the modal");
            ReleaseKeys();

            Press(Key.H);
            _hud.ReadUiInput();
            Assert.That(help.activeSelf, Is.True);
            ReleaseKeys();
            Press(Key.H);
            _hud.ReadUiInput();
            Assert.That(help.activeSelf, Is.False, "H closes Help when it owns the modal");
            ReleaseKeys();

            Press(Key.B);
            _hud.ReadUiInput();
            Assert.That(drawer.activeSelf, Is.True);
            ReleaseKeys();
            Press(Key.H);
            _hud.ReadUiInput();
            Assert.That(help.activeSelf, Is.True);
            Assert.That(drawer.activeSelf, Is.False, "Help replaces the build drawer");
            ReleaseKeys();
            Press(Key.B);
            _hud.ReadUiInput();
            Assert.That(drawer.activeSelf, Is.True, "the build drawer replaces Help");
            Assert.That(help.activeSelf, Is.False);
        }

        [Test]
        public void FocusedTextInputPreventsTabFromOpeningMap()
        {
            _typingField = _hud.transform.Find("MatchUI/JoinMenu/Nickname").GetComponent<TMP_InputField>();
            _hud.transform.Find("MatchUI/JoinMenu").gameObject.SetActive(true);
            _typingField.transform.SetParent(_root.transform, false);
            EventSystem.current.SetSelectedGameObject(_typingField.gameObject);
            _typingField.ActivateInputField();
            Invoke(_typingField, "LateUpdate"); // TMP activates a requested field in its real LateUpdate lifecycle.
            Assert.That(_typingField.isFocused, Is.True);
            _hud.transform.Find("MatchUI/JoinMenu").gameObject.SetActive(false);

            Press(Key.Tab);
            _hud.ReadUiInput();

            Assert.That(_hud.BlocksKeyboardInput, Is.True);
            Assert.That(_hud.TacticalMap.IsOpen, Is.False);
        }

        [Test]
        public void WindowBlurReleasesChestAndHeldMapFocus()
        {
            Press(Key.C);
            _hud.ReadUiInput();
            Assert.That(_hud.ChestOwnsDigits, Is.True);

            // Chest focus owns modal keyboard input, so first verify its independent blur release.
            _hud.ReleaseUiFocusForWindowLoss();
            Assert.That(_hud.ChestOwnsDigits, Is.False);
            ReleaseKeys();
            _hud.ReadUiInput();

            // With the chest modal released, Tab can open the map; blur must release this held state too.
            Press(Key.Tab);
            _hud.ReadUiInput();
            Assert.That(_hud.TacticalMap.IsOpen, Is.True);

            _hud.ReleaseUiFocusForWindowLoss();

            Assert.That(_hud.ChestOwnsDigits, Is.False);
            Assert.That(_hud.TacticalMap.IsOpen, Is.False);
        }

        void ReadBothAndFlush()
        {
            _hud.ReadUiInput();
            Invoke(_client, "ReadInput");
            _session.FlushInput();
        }

        void Press(params Key[] keys)
        {
            Assert.That(_keyboard != null && _keyboard.added && _keyboard.enabled, Is.True, "synthetic keyboard remains active");
            _keyboard.MakeCurrent();
            InputSystem.QueueStateEvent(_keyboard, new KeyboardState(keys));
            InputSystem.Update();
            Assert.That(InputState.currentUpdateType, Is.EqualTo(InputUpdateType.Dynamic), "input update must use player semantics in EditMode");
            Assert.That(_keyboard.wasUpdatedThisFrame, Is.True, "player update must advance the device's frame counter");
            Assert.That(Keyboard.current, Is.SameAs(_keyboard), "queued event must target the keyboard consumers read");
            foreach (var key in keys)
            {
                Assert.That(KeyControlFor(key).isPressed, Is.True, key + " state was not applied");
                Assert.That(KeyControlFor(key).wasPressedThisFrame, Is.True, key + " press edge was not observed this input update");
            }
        }

        void ReleaseKeys()
        {
            Assert.That(_keyboard != null && _keyboard.added && _keyboard.enabled, Is.True, "synthetic keyboard remains active");
            InputSystem.QueueStateEvent(_keyboard, new KeyboardState());
            InputSystem.Update();
            Assert.That(Keyboard.current, Is.SameAs(_keyboard), "release event must reach the controlled keyboard");
            Assert.That(_keyboard.cKey.isPressed, Is.False);
            Assert.That(_keyboard.digit1Key.isPressed, Is.False);
            Assert.That(_keyboard.tabKey.isPressed, Is.False);
            Assert.That(_keyboard.wKey.isPressed, Is.False);
        }

        KeyControl KeyControlFor(Key key)
        {
            switch (key)
            {
                case Key.C: return _keyboard.cKey;
                case Key.Digit1: return _keyboard.digit1Key;
                case Key.B: return _keyboard.bKey;
                case Key.H: return _keyboard.hKey;
                case Key.Tab: return _keyboard.tabKey;
                case Key.W: return _keyboard.wKey;
                default: Assert.Fail("No injected-key precondition configured for " + key); return null;
            }
        }

        static object Invoke(object target, string method, params object[] args)
        {
            var info = target.GetType().GetMethod(method, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            Assert.That(info, Is.Not.Null, "missing method " + method);
            return info.Invoke(target, args);
        }
    }
}
