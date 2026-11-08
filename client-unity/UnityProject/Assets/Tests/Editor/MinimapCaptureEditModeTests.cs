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
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    /// <summary>Exercises physical mouse capture reconciliation on the actual tactical map controller.</summary>
    public sealed class MinimapCaptureEditModeTests
    {
        sealed class FakeTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public readonly List<byte[]> Sent = new List<byte[]>();
            public void Connect(string url) { }
            public void Send(byte[] frame) { Sent.Add(frame); }
            public void Close() { Closed?.Invoke("closed"); }
            public void Poll() { }
            public void Open() { Opened?.Invoke(); }
            public void Deliver(ServerMsg message) { Received?.Invoke(message.Encode()); }
            public List<WireCommand> TakeCommands()
            {
                var commands = new List<WireCommand>();
                foreach (var frame in Sent)
                    if (ClientMsg.Decode(frame) is ClientMsg.Input input) commands.AddRange(input.Commands);
                Sent.Clear();
                return commands;
            }
        }

        GameObject _clientObject, _mapObject, _canvasObject, _arenaObject, _cameraObject;
        MatchClient _client;
        TacticalMapController _map;
        TacticalMapSurface _surface;
        Session _session;
        FakeTransport _transport;
        Keyboard _keyboard;
        Mouse _mouse;

        [SetUp]
        public void SetUp()
        {
            _keyboard = InputSystem.AddDevice<Keyboard>();
            _mouse = InputSystem.AddDevice<Mouse>();

            _transport = new FakeTransport();
            _session = new Session(_transport, new SessionOptions { Url = "ws://localhost/minimap-capture", Profile = "fixture", Now = () => 1000 });
            _session.Connect();
            _transport.Open();
            _transport.Deliver(new ServerMsg.Welcome
            {
                Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16], PlayerId = 1,
                TickRate = 20, Map = new MapBlob(4, 4, new byte[16])
            });
            _transport.Deliver(new ServerMsg.Snapshot
            {
                Tick = 1, Phase = 1,
                Me = new WireSelf { Id = 1, X = 48, Y = 48, Hp = 100, MaxHp = 100, Status = 1 }
            });

            _clientObject = new GameObject("Disabled minimap test client");
            _client = _clientObject.AddComponent<MatchClient>();
            _client.enabled = false;
            typeof(MatchClient).GetField("<Session>k__BackingField", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_client, _session);
            _arenaObject = new GameObject("Minimap camera return arena");
            _arenaObject.transform.SetParent(_clientObject.transform, false);
            _client.Arena = _arenaObject.AddComponent<ArenaView>();
            _cameraObject = new GameObject("Minimap test camera", typeof(Camera));
            _cameraObject.transform.SetParent(_clientObject.transform, false);
            _client.Cam = _cameraObject.GetComponent<Camera>();

            _canvasObject = new GameObject("Minimap capture canvas", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster));
            var canvas = _canvasObject.GetComponent<Canvas>(); canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var canvasRect = (RectTransform)_canvasObject.transform; canvasRect.sizeDelta = new Vector2(1000, 800);
            _mapObject = new GameObject("Tactical map controller");
            _map = _mapObject.AddComponent<TacticalMapController>();
            _map.Initialize(_client, _canvasObject.transform);
            _map.Bind(_session);
            _map.Tick();
            _surface = _canvasObject.transform.Find("Minimap/TerrainFrame").GetComponent<TacticalMapSurface>();
            Assert.That(_session.State, Is.EqualTo(SessionState.InMatch));
            Assert.That(_session.Motion.Initialized, Is.True);
        }

        [TearDown]
        public void TearDown()
        {
            if (_map != null) _map.Bind(null);
            if (_session != null) _session.Leave();
            if (_keyboard != null && _keyboard.added) InputSystem.RemoveDevice(_keyboard);
            if (_mouse != null && _mouse.added) InputSystem.RemoveDevice(_mouse);
            if (_mapObject != null) UnityEngine.Object.DestroyImmediate(_mapObject);
            if (_canvasObject != null) UnityEngine.Object.DestroyImmediate(_canvasObject);
            if (_clientObject != null) UnityEngine.Object.DestroyImmediate(_clientObject);
        }

        [Test]
        public void PhysicalLeftReleaseCancelsPeekAndRestoresTheOwnerCamera()
        {
            var peekAt = ScreenAt(.78f, .76f);
            SetMouse(peekAt, MouseButton.Left);
            _surface.OnPointerDown(Pointer(peekAt, PointerEventData.InputButton.Left));
            _map.ReadUiInput(false, false);
            Assert.That(_map.IsPeeking, Is.True);

            _client.Arena.Follow(_client.Cam, 110, 100);
            var peekCameraPosition = _client.Cam.transform.position;
            SetMouse(peekAt);
            _map.ReadUiInput(false, false);

            var expected = ArenaView.WorldPoint(_session.Motion.DrawnX, _session.Motion.DrawnY) + Vector3.up * 1.5f + Vector3.back * 30;
            Assert.That(_map.IsPeeking, Is.False, "physical release must cancel camera peek even without a UI pointer-up");
            Assert.That(peekCameraPosition, Is.Not.EqualTo(expected));
            Assert.That(_client.Cam.transform.position, Is.EqualTo(expected), "camera returns to the current owner's predicted position");
        }

        [Test]
        public void PhysicalRightReleaseProjectsOverlayPositionAndFlushesChangedPointExactlyOnce()
        {
            var down = ScreenAt(.22f, .78f);
            SetMouse(down, MouseButton.Right);
            _surface.OnPointerDown(Pointer(down, PointerEventData.InputButton.Right));
            _session.FlushInput();
            AssertMove(_transport.TakeCommands(), _surface, down);

            var drag = ScreenAt(.38f, .64f);
            _surface.OnDrag(Pointer(drag, PointerEventData.InputButton.Right));
            var release = ScreenAt(.72f, .31f);
            Assert.That(_surface.ScreenWorld(release, null, out var expected), Is.True);
            SetMouse(release);
            _map.ReadUiInput(false, false);
            _session.FlushInput();

            var final = _transport.TakeCommands();
            Assert.That(final.Count, Is.EqualTo(1), "release flushes just the final changed point");
            Assert.That(final[0].Kind, Is.EqualTo(CommandKind.Move));
            Assert.That(final[0].X, Is.EqualTo(expected.x).Within(.01f));
            Assert.That(final[0].Y, Is.EqualTo(expected.y).Within(.01f));
            Assert.That(_map.IsPeeking, Is.False);

            _map.ReadUiInput(false, false);
            _session.FlushInput();
            Assert.That(_transport.TakeCommands(), Is.Empty, "subsequent frames cannot resend the same release destination");
        }

        [Test]
        public void LostMouseCaptureCancelsQueuedRightDragWithoutSendingIt()
        {
            var down = ScreenAt(.25f, .72f);
            SetMouse(down, MouseButton.Right);
            _surface.OnPointerDown(Pointer(down, PointerEventData.InputButton.Right));
            _session.FlushInput();
            Assert.That(_transport.TakeCommands().Count, Is.EqualTo(1));
            _surface.OnDrag(Pointer(ScreenAt(.77f, .27f), PointerEventData.InputButton.Right));

            InputSystem.RemoveDevice(_mouse);
            _mouse = null;
            _map.ReadUiInput(false, false);
            _session.FlushInput();

            Assert.That(_map.IsPeeking, Is.False);
            Assert.That(_transport.TakeCommands(), Is.Empty, "lost capture discards the unsent queued drag destination");
        }

        [TestCase(true, false, "typing")]
        [TestCase(false, true, "modal")]
        public void TypingOrModalAbortPrecedesPhysicalReleaseReconciliation(bool typing, bool modal, string owner)
        {
            var down = ScreenAt(.24f, .74f);
            SetMouse(down, MouseButton.Right);
            _surface.OnPointerDown(Pointer(down, PointerEventData.InputButton.Right));
            _session.FlushInput();
            _transport.TakeCommands();
            _surface.OnDrag(Pointer(ScreenAt(.68f, .29f), PointerEventData.InputButton.Right));

            SetMouse(ScreenAt(.83f, .34f)); // a physical release is visible this frame
            _map.ReadUiInput(typing, modal);
            _session.FlushInput();

            Assert.That(_transport.TakeCommands(), Is.Empty, owner + " ownership aborts the pending minimap point before release reconciliation");
        }

        Vector2 ScreenAt(float x, float y)
        {
            var rect = _surface.Rect.rect;
            var local = new Vector3(Mathf.Lerp(rect.xMin, rect.xMax, x), Mathf.Lerp(rect.yMin, rect.yMax, y), 0);
            return RectTransformUtility.WorldToScreenPoint(null, _surface.Rect.TransformPoint(local));
        }

        void SetMouse(Vector2 position, params MouseButton[] buttons)
        {
            var state = new MouseState { position = position };
            foreach (var button in buttons) state = state.WithButton(button);
            InputSystem.QueueStateEvent(_mouse, state);
            InputSystem.Update();
        }

        static PointerEventData Pointer(Vector2 position, PointerEventData.InputButton button)
            => new PointerEventData(EventSystem.current) { position = position, button = button };

        static void AssertMove(List<WireCommand> commands, TacticalMapSurface surface, Vector2 screen)
        {
            Assert.That(commands.Count, Is.EqualTo(1));
            Assert.That(commands[0].Kind, Is.EqualTo(CommandKind.Move));
            Assert.That(surface.ScreenWorld(screen, null, out var expected), Is.True);
            Assert.That(commands[0].X, Is.EqualTo(expected.x).Within(.01f));
            Assert.That(commands[0].Y, Is.EqualTo(expected.y).Within(.01f));
        }
    }
}
