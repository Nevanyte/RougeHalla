using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;
using UnityEngine.Rendering.Universal;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-TRAINING-HUD-1 test rig: the real MatchClient + MatchHud + TacticalMapController on a fake transport, driven by a real
    /// (test-owned) Keyboard through the Input System, the way TrainingConsoleIntegrationEditModeTests drives them. One "frame" is what
    /// the player loop does: an accepted snapshot, the HUD's UI input read, the client's input read, the HUD's LateUpdate.
    /// </summary>
    public enum HudEvent { DrawerOpen, DrawerClose, TabHold, TabRelease, WishCast }

    public sealed class TrainingHudRig : IDisposable
    {
        const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;

        sealed class Accounts : IAccountTransport
        {
            public Task<AccountHttpResponse> GetProfileAsync(string url, string ownerToken, string passcode, CancellationToken cancellation) =>
                Task.FromResult(new AccountHttpResponse(200, new AccountReply
                {
                    profile = new AccountProfile { name = "Alice", gv = 10, gvLifetime = 20,
                        stats = new AccountStats { runs = 0, wins = 0, draws = 0, deaths = 0, kills = 0 } },
                    token = new string('c', 64), created = true
                }));
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
            public string ConnectedUrl;
            public void Connect(string url) { ConnectedUrl = url; }
            public void Send(byte[] frame) { }
            public void Close() { Closed?.Invoke("fixture close"); }
            public void Poll() { }
            public void Open() { Opened?.Invoke(); }
            public void Deliver(ServerMsg message) { Received?.Invoke(message.Encode()); }
        }

        public GameObject Root;
        public MatchClient Client;
        public MatchHud Hud;
        public AccountCoordinator Owner;
        public bool Practice { get; private set; }
        Transport _transport;
        readonly List<GameObject> _arenas = new List<GameObject>();
        readonly List<Light2D> _lights = new List<Light2D>();
        readonly EventSystem _priorEvents = EventSystem.current;
        readonly Keyboard _priorKeyboard = Keyboard.current;
        readonly InputSettings _priorSettings = InputSystem.settings;
        readonly HashSet<Key> _held = new HashSet<Key>();
        HideFlags _priorSettingsFlags;
        InputSettings _settings;
        Keyboard _keyboard;
        GameObject _events;
        bool _priorToggle;
        uint _tick = 1; double _serverMs = 50;

        public static async Task<TrainingHudRig> Start(bool practice)
        {
            var rig = new TrainingHudRig { Practice = practice };
            try { rig.Initialize(); await rig.Join(); }
            catch { rig.Dispose(); throw; }
            return rig;
        }

        TrainingHudRig() { }

        void Initialize()
        {
            _priorSettingsFlags = _priorSettings.hideFlags;
            _events = new GameObject("TrainingHudRig EventSystem", typeof(UiInputRoutingEventSystem));
            var system = _events.GetComponent<EventSystem>();
            system.enabled = false; system.enabled = true;
            EventSystem.current = system;
            _settings = ScriptableObject.Instantiate(_priorSettings);
            _settings.updateMode = InputSettings.UpdateMode.ProcessEventsInDynamicUpdate;
            _settings.backgroundBehavior = InputSettings.BackgroundBehavior.IgnoreFocus;
            _settings.SetInternalFeatureFlag("RUN_PLAYER_UPDATES_IN_EDIT_MODE", true);
            if (_priorSettingsFlags == HideFlags.HideAndDontSave) _priorSettings.hideFlags = HideFlags.DontSave;
            InputSystem.settings = _settings;
            _keyboard = InputSystem.AddDevice<Keyboard>();
            _keyboard.MakeCurrent();

            Root = new GameObject("TrainingHudRig");
            Client = Root.AddComponent<MatchClient>(); Client.enabled = false;
            Client.PageUrl = "https://training.example/play";
            Client.Url = "wss://training.example/arena/ws";
            Client.TrainingUrl = "wss://training.example/training/ws";
            Client.Profile = "Alice"; Client.Faction = 4;
            Owner = Root.AddComponent<AccountCoordinator>();
            Owner.Initialize(AccountEndpoint.FromPage(Client.PageUrl), new Accounts(), new Credentials());
            SetField(Client, "<AccountOwner>k__BackingField", Owner);
            Hud = Root.AddComponent<MatchHud>(); Hud.Initialize(Client);
            SetField(Client, "<Hud>k__BackingField", Hud);
            _priorToggle = Hud.TacticalMap.ToggleMode;
            Hud.TacticalMap.SetToggleMode(false);   // Tab is a hold, as in legacy
            SetField(Client, "_transportFactory", new Func<ITransport>(() =>
            {
                var arena = Client.Arena;
                _arenas.Add(arena.gameObject);
                arena.transform.SetParent(Root.transform, false);
                try { if (GetField(arena, "_actors") == null) Call(arena, "Awake"); }
                finally { _lights.AddRange(arena.GetComponentsInChildren<Light2D>(true)); }
                _transport = new Transport(); return _transport;
            }));
        }

        async Task Join()
        {
            Client.Join("alice", 4, Practice ? MatchLaunchMode.Training : MatchLaunchMode.Arena);
            var timeout = System.Diagnostics.Stopwatch.StartNew();
            while ((_transport == null || Client.Session == null || _transport.ConnectedUrl == null) && timeout.Elapsed < TimeSpan.FromSeconds(5))
                await Task.Delay(1);
            Assert.That(_transport?.ConnectedUrl, Is.Not.Null, "set-up: the owned join reached the fake transport");
            _transport.Open();
            _transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 3, TickRate = 20, ServerMs = 50, Map = new MapBlob(32, 32, new byte[1024]) });
            Snapshot();
            Assert.That(Client.LaunchVerified, Is.True, "set-up: the first accepted snapshot confirms the mode");
            Assert.That(Client.ConfirmedPractice, Is.EqualTo(Practice), "set-up: the room is " + (Practice ? "practice" : "the arena"));
            Frame();
        }

        void Snapshot()
        {
            _tick++; _serverMs += 50;
            _transport.Deliver(new ServerMsg.Snapshot { Tick = _tick, ServerTimeOverrideMs = _serverMs, Phase = 1, Training = Practice,
                Me = new WireSelf { Id = 3, X = 320, Y = 320, Hp = 100, MaxHp = 100, Status = 1, Weapon = 0 } });
        }

        /// <summary>One player-loop frame: a snapshot arrives, then the HUD and the client read input, then the HUD's LateUpdate runs.</summary>
        public void Frame()
        {
            Snapshot();
            Hud.ReadUiInput();
            Call(Client, "ReadInput");
            Client.Session?.FlushInput();
            Call(Hud, "LateUpdate");
        }

        void Send()
        {
            _keyboard.MakeCurrent();
            InputSystem.QueueStateEvent(_keyboard, new KeyboardState(_held.ToArray())); InputSystem.Update();
        }

        public void Tap(Key key) { _held.Add(key); Send(); Frame(); _held.Remove(key); Send(); Frame(); }
        public void Hold(Key key) { _held.Add(key); Send(); Frame(); }
        public void Let(Key key) { _held.Remove(key); Send(); Frame(); }
        public void ReleaseAll() { _held.Clear(); Send(); Frame(); }

        public bool DrawerOpen => ((BuildDrawer)GetField(Hud, "_drawer")).IsVisible;
        public bool MapOpen => Hud.TacticalMap.IsOpen;
        public bool TabIsDown => _held.Contains(Key.Tab);

        /// <summary>One of the five inputs of the acceptance sequence; an event that does not apply to the current state does nothing.</summary>
        public void Do(HudEvent e)
        {
            switch (e)
            {
                case HudEvent.DrawerOpen: if (!DrawerOpen) Tap(Key.B); break;
                case HudEvent.DrawerClose: if (DrawerOpen) Tap(Key.B); break;
                case HudEvent.TabHold: if (!TabIsDown) Hold(Key.Tab); break;
                case HudEvent.TabRelease: if (TabIsDown) Let(Key.Tab); break;
                case HudEvent.WishCast: Tap(Key.R); break;
            }
        }

        /// <summary>Back to the quiet in-match state: Tab let go, the drawer closed, then a few more frames.</summary>
        public void Settle()
        {
            if (TabIsDown) Let(Key.Tab);
            if (DrawerOpen) Tap(Key.B);
            Frame(); Frame();
        }

        /// <summary>Isolates sequences from each other: the pointer or focus is moved off whatever a sequence selected (a click elsewhere).</summary>
        public void ClickAway()
        {
            EventSystem.current.SetSelectedGameObject(null);
            Frame(); Frame();
        }

        /// <summary>The HUD panels the player sees in a match, by name, as activeInHierarchy.</summary>
        public SortedDictionary<string, bool> Panels()
        {
            bool On(object o) => o is Component c && c != null && c.gameObject.activeInHierarchy;
            return new SortedDictionary<string, bool>
            {
                { "champion panel", On(GetField(Hud, "_championHud")) },
                { "hotbar and potion bar", On(GetField(Hud, "_weaponBar")) },
                { "plate", On(GetField(Hud, "_vitalsPanel")) },
                { "minimap", On(Hud.TacticalMap.MinimapRoot) },
            };
        }

        public static string Describe(SortedDictionary<string, bool> panels) =>
            string.Join(", ", panels.Select(p => p.Key + "=" + (p.Value ? "on" : "OFF")));

        public static object GetField(object target, string name)
        {
            var field = target.GetType().GetField(name, Private);
            Assert.That(field, Is.Not.Null, "missing field " + name);
            return field.GetValue(target);
        }
        static void SetField(object target, string name, object value) => target.GetType().GetField(name, Private).SetValue(target, value);
        public static object Call(object target, string name, params object[] args)
        {
            var method = target.GetType().GetMethod(name, Private);
            Assert.That(method, Is.Not.Null, "missing method " + name);
            return method.Invoke(target, args);
        }

        public void Dispose()
        {
            try { if (Client != null) Client.Leave(); }
            finally
            {
                if (Hud != null && Hud.TacticalMap != null) Hud.TacticalMap.SetToggleMode(_priorToggle);
                for (int i = _arenas.Count - 1; i >= 0; i--)
                    if (_arenas[i] != null) { _arenas[i].SetActive(false); UnityEngine.Object.DestroyImmediate(_arenas[i]); }
                if (Root != null) UnityEngine.Object.DestroyImmediate(Root);
                if (_events != null)
                {
                    var system = _events.GetComponent<EventSystem>();
                    if (EventSystem.current == system) system.SetSelectedGameObject(null);
                    system.enabled = false; UnityEngine.Object.DestroyImmediate(_events);
                }
                if (_priorEvents != null && _priorEvents.isActiveAndEnabled) EventSystem.current = _priorEvents;
                if (_keyboard != null && _keyboard.added) InputSystem.RemoveDevice(_keyboard);
                if (_priorKeyboard != null && _priorKeyboard.added) _priorKeyboard.MakeCurrent();
                if (_priorSettings != null && ReferenceEquals(InputSystem.settings, _settings)) InputSystem.settings = _priorSettings;
                if (_priorSettings != null) _priorSettings.hideFlags = _priorSettingsFlags;
                if (_settings != null && !ReferenceEquals(InputSystem.settings, _settings)) UnityEngine.Object.DestroyImmediate(_settings);
            }
        }
    }
}
