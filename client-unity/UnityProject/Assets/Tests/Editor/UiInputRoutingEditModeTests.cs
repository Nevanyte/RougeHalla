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
using UnityEngine.InputSystem.LowLevel;

namespace Roguehalla.Client.Tests
{
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
        bool _eventsWereActive;
        EventSystem _previousEvents;
        GameObject _previousSelection;
        MatchClient _client;
        MatchHud _hud;
        Session _session;
        FakeTransport _transport;
        Keyboard _keyboard;
        TMP_InputField _typingField;
        bool _oldToggleMode;

        [SetUp]
        public void SetUp()
        {
            _previousEvents = EventSystem.current;
            _eventsWereActive = _previousEvents != null && _previousEvents.gameObject.activeSelf;
            _previousSelection = _previousEvents != null ? _previousEvents.currentSelectedGameObject : null;
            if (_previousEvents != null && _eventsWereActive) _previousEvents.gameObject.SetActive(false);
            _keyboard = InputSystem.AddDevice<Keyboard>();

            _root = new GameObject("UI input routing fixture");
            _client = _root.AddComponent<MatchClient>();
            _client.enabled = false;
            Invoke(_client, "InitializeLayoutReview", CreateSession());
            var currentEvents = EventSystem.current;
            if (currentEvents != null && (_previousEvents == null || currentEvents.gameObject != _previousEvents.gameObject))
                _ownedEvents = currentEvents.gameObject;
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
            if (_typingField != null) _typingField.DeactivateInputField();
            if (EventSystem.current != null) EventSystem.current.SetSelectedGameObject(null);
            if (_hud != null && _hud.TacticalMap != null) _hud.TacticalMap.SetToggleMode(_oldToggleMode);
            if (_keyboard != null && _keyboard.added) InputSystem.RemoveDevice(_keyboard);
            if (_root != null) UnityEngine.Object.DestroyImmediate(_root);
            if (_ownedEvents != null) UnityEngine.Object.DestroyImmediate(_ownedEvents);
            if (_previousEvents != null)
            {
                _previousEvents.gameObject.SetActive(_eventsWereActive);
                if (_eventsWereActive && _previousSelection != null && _previousSelection.activeInHierarchy)
                    _previousEvents.SetSelectedGameObject(_previousSelection);
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
        public void FocusedTextInputPreventsTabFromOpeningMap()
        {
            _typingField = _hud.transform.Find("MatchUI/JoinMenu/Nickname").GetComponent<TMP_InputField>();
            _hud.transform.Find("MatchUI/JoinMenu").gameObject.SetActive(true);
            _typingField.transform.SetParent(_root.transform, false);
            EventSystem.current.SetSelectedGameObject(_typingField.gameObject);
            _typingField.ActivateInputField();
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
            ReleaseKeys();
            _hud.ReadUiInput();

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
            InputSystem.QueueStateEvent(_keyboard, new KeyboardState(keys));
            InputSystem.Update();
        }

        void ReleaseKeys()
        {
            InputSystem.QueueStateEvent(_keyboard, new KeyboardState());
            InputSystem.Update();
        }

        static object Invoke(object target, string method, params object[] args)
        {
            var info = target.GetType().GetMethod(method, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            Assert.That(info, Is.Not.Null, "missing method " + method);
            return info.Invoke(target, args);
        }
    }
}
