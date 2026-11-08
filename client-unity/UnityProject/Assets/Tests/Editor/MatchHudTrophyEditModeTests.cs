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
    public sealed class MatchHudTrophyEditModeTests
    {
        GameObject _root;
        MatchHud _hud;
        Session _session;
        TestTransport _transport;
        TMP_Text _title;
        UnityEngine.UI.Button[] _buttons;
        UnityEngine.UI.Button _skip;

        [SetUp]
        public void SetUp()
        {
            _root = new GameObject("Trophy HUD fixture");
            _hud = _root.AddComponent<MatchHud>();
            Set("_rewards", Rect("Rewards"));
            var results = Rect("Results"); results.gameObject.SetActive(false); Set("_results", results);
            _title = Label("RewardTitle"); Set("_rewardTitle", _title);
            _buttons = (UnityEngine.UI.Button[])typeof(MatchHud).GetField("_options", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
            for (int i = 0; i < _buttons.Length; i++) _buttons[i] = Button("Option" + i);
            _skip = Button("Skip"); Set("_skip", _skip);
            _transport = new TestTransport();
            _session = new Session(_transport, new SessionOptions { Url = "ws://fixture/ws", Profile = "fixture", Now = () => 1000 });
            _session.Connect(); _transport.Open();
            _transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 1, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
            Set("_session", _session);
        }

        [TearDown]
        public void TearDown() { _session.Leave(); UnityEngine.Object.DestroyImmediate(_root); }

        [Test]
        public void DecodedGainOnlyChangeRefreshesActualHudAndOrdinaryChooseKeepsHandleAndIndex()
        {
            Deliver(.0625, false, true, false);
            StringAssert.StartsWith("Trophy ", _title.text);
            Assert.AreEqual("+6.3% damage", Text(1));
            Assert.AreEqual("Slow Burn", Text(0));
            Assert.AreEqual("Lifesteal", Text(2));
            Assert.IsTrue(_buttons[1].interactable);
            Deliver(.064, false, true, false); // Same row, key and eligibility; only the delivered f64 changed.
            Assert.AreEqual("+6.4% damage", Text(1));
            Invoke("Choose", (sbyte)1); _session.FlushInput();
            ClientMsg.Input input = null;
            foreach (var bytes in _transport.Sent)
                if (bytes.Length > 0 && bytes[0] == 2) input = (ClientMsg.Input)ClientMsg.Decode(bytes);
            Assert.IsNotNull(input);
            Assert.AreEqual(1, input.Commands.Count);
            Assert.AreEqual(CommandKind.Choose, input.Commands[0].Kind);
            Assert.AreEqual(73u, input.Commands[0].RewardRef.Value);
            Assert.AreEqual(1, input.Commands[0].Pick);
        }

        [Test]
        public void CanonicalTakenPickedAndCanChooseControlButtonsAndSkip()
        {
            Deliver(.0625, true, true, false);
            Assert.AreEqual("+6.3% damage · taken", Text(1)); Assert.IsFalse(_buttons[1].interactable);
            Assert.IsTrue(_buttons[0].interactable); Assert.IsTrue(_skip.interactable);
            Deliver(.0625, false, true, true);
            foreach (var button in _buttons) Assert.IsFalse(button.interactable);
            Assert.IsFalse(_skip.interactable);
            Deliver(.0625, false, false, false);
            foreach (var button in _buttons) Assert.IsFalse(button.interactable);
            Assert.IsFalse(_skip.interactable);
        }

        void Deliver(double gain, bool taken, bool canChoose, bool picked)
        {
            _transport.Deliver(new ServerMsg.State { Tick = 20, Items = new StateItem[] { new RewardChestsState { Rows = new[] {
                new WireRewardChest { Handle = new RewardChestHandle(73), X = 10, Y = 20, ExpiresAt = 15000, Picked = picked, CanChoose = canChoose,
                    Options = new[] { new WireRewardOption { Kind = 1, Id = 0 },
                        new WireRewardOption { Kind = 3, KillKey = TrophyStatKey.Damage, KillGain = gain, Taken = taken },
                        new WireRewardOption { Kind = 2, Id = 7 } } }
            } } } });
            Invoke("RefreshRewards");
        }

        string Text(int index) { return _buttons[index].GetComponentInChildren<TMP_Text>().text; }
        RectTransform Rect(string name)
        {
            var rect = (RectTransform)new GameObject(name, typeof(RectTransform)).transform;
            rect.SetParent(_root.transform, false); return rect;
        }
        TMP_Text Label(string name)
        {
            var label = new GameObject(name, typeof(RectTransform), typeof(TextMeshProUGUI)).GetComponent<TextMeshProUGUI>();
            label.transform.SetParent(_root.transform, false); return label;
        }
        UnityEngine.UI.Button Button(string name)
        {
            var button = Rect(name).gameObject.AddComponent<UnityEngine.UI.Button>();
            Label(name + "Label").transform.SetParent(button.transform, false); return button;
        }
        void Set(string field, object value) { typeof(MatchHud).GetField(field, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value); }
        void Invoke(string method, params object[] args) { typeof(MatchHud).GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, args); }

        sealed class TestTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public readonly List<byte[]> Sent = new List<byte[]>();
            public void Connect(string url) { }
            public void Send(byte[] frame) { Sent.Add(frame); }
            public void Close() { }
            public void Poll() { }
            public void Open() { Opened?.Invoke(); }
            public void Deliver(ServerMsg message) { Received?.Invoke(message.Encode()); }
        }
    }
}
