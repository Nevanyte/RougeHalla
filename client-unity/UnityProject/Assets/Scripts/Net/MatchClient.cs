// Owns the network session, turns input into orders and exposes authoritative state for presentation.
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public sealed partial class MatchClient : MonoBehaviour
    {
        public string Url = "ws://127.0.0.1:7777/ws", Profile = "unity1";
        /// <summary>The admission ticket, sent as its UTF-8 bytes (the dev server checks the callsign secret; P-HOST-1 defines hosted tickets).</summary>
        public string Token = "t1";
        public ulong ContentHash;
        /// <summary>-1 = server default.</summary>
        public int Faction = -1;
        public bool AutoJoin;
        public MatchHud Hud { get; private set; }
        public ArenaView Arena;
        public Camera Cam;

        public Session Session { get; private set; }
        Session _presentationSession;
        Func<ITransport> _transportFactory = TransportFactory.Create;
        readonly List<InterpActor> _actors = new List<InterpActor>();
        readonly List<InterpActor> _targetActors = new List<InterpActor>();
        const double SteerRepeatMs = 100;
        const float SteerAheadU = 64f;
        Vector2 _lastDir;
        double _lastSteer;
        bool _steering;
        float _aimAngle;
        bool _attackHeld;
        bool _traceLatency;

        static double NowMs() { return Time.realtimeSinceStartupAsDouble * 1000.0; }

#if UNITY_EDITOR || DEVELOPMENT_BUILD
        internal void InitializeLayoutReview(Session session)
        {
            Session = session;
            Hud = gameObject.AddComponent<MatchHud>(); Hud.Initialize(this); Hud.Bind(session);
        }
#endif

        void Start()
        {
            InitializeAccounts();
            Hud = gameObject.AddComponent<MatchHud>();
            Hud.Initialize(this);
            if (AutoJoin) Join(Profile, Faction);
        }

        void JoinCore(string nickname, int faction, string validatedMatchUrl, string ownerToken)
        {
            if (Session != null) { UnbindPresentationSession(); ResetPresentationTimeline(); Session.Leave(); }
            Profile = string.IsNullOrWhiteSpace(nickname) ? Profile : nickname.Trim();
            Faction = faction;
            _actors.Clear(); _steering = false; _attackHeld = false;
            if (Arena != null) Destroy(Arena.gameObject);
            Arena = new GameObject("Arena").AddComponent<ArenaView>();
            Session = new Session(_transportFactory(), new SessionOptions
            {
                Url = validatedMatchUrl, Profile = Profile, Ticket = System.Text.Encoding.UTF8.GetBytes(ownerToken ?? ""), ContentHash = ContentHash, Build = "unity-web-0.1.0",
                Faction = Faction >= 0 ? (byte)Faction : (byte?)null, Now = NowMs,
            });
            Session.StateChanged += state =>
            {
                if (state != SessionState.InMatch) { _steering = false; _attackHeld = false; }
                Debug.Log("[net] " + state + (Session.RejectCode.HasValue ? " " + Session.RejectCode + ": " + Session.RejectReason : "") + (Session.Error != null ? " " + Session.Error : ""));
            };
            Hud.Bind(Session);
            BindPresentationSession(Session);
            Session.Connect();
        }

        public void Leave()
        {
            bool hadResult = Session != null && Session.LastResult != null;
            CancelOwnedJoin();
            UnbindPresentationSession(); ResetPresentationTimeline();
            if (Session != null) Session.Leave();
            if (Arena != null) Destroy(Arena.gameObject);
            Session = null;
            Hud.ShowMenu();
            if (hadResult) RefreshAccountAfterResult();
        }

        void OnApplicationFocus(bool focused)
        {
            if (!focused) Hud?.ReleaseUiFocusForWindowLoss();
            if (focused || Session == null || Session.State != SessionState.InMatch) return;
            if (_attackHeld) Session.Input.Release(_aimAngle, Session.Clock.RenderMs);
            if (_steering) Session.OrderStop();
            _attackHeld = _steering = false;
            Hud?.TacticalMap?.ReleaseTransient();
        }

        void OnDestroy()
        {
            CancelOwnedJoin();
            UnbindPresentationSession(); ResetPresentationTimeline();
            if (Session != null) Session.Leave();
            if (Arena != null) { Arena.gameObject.SetActive(false); Destroy(Arena.gameObject); }
        }

        void BindPresentationSession(Session session)
        {
            UnbindPresentationSession();
            _presentationSession = session;
            ResetPresentationTimeline();
            if (session == null) return;
            session.FxReceived += PresentFx;
            session.TimelineReset += ResetPresentationTimeline;
        }
        void UnbindPresentationSession()
        {
            if (_presentationSession == null) return;
            _presentationSession.FxReceived -= PresentFx;
            _presentationSession.TimelineReset -= ResetPresentationTimeline;
            _presentationSession = null;
        }
        void ResetPresentationTimeline()
        {
            if (Arena != null) Arena.ResetTransientPresentation(Session != null ? Session.ServerTimeMs : 0);
            if (Hud != null) Hud.ResetTransientPresentation();
            var soundscape = GetComponent<ShowcaseSoundscape>();
            if (soundscape != null) soundscape.ResetTransientCues();
        }

        void PresentFx(ServerMsg.Fx fx) { if (Arena != null) Arena.ConfirmedFx(fx); }

        void Update()
        {
            if (Session == null) { Hud?.ReadUiInput(); return; }
            _traceLatency = LatencyTrace.Enabled;
            if (_traceLatency) LatencyTrace.Mark("frameStart", Session.PlayerId, 0, 0, 0);
            Session.Poll();
            Hud?.ReadUiInput();
            if (Session.State != SessionState.InMatch && Session.State != SessionState.Ended) return;
            if (Arena != null && !Arena.HasMap && Session.Map != null) Arena.Build(Session.Map);
            Session.Snapshots.Sample(Session.Clock.RenderMs, _actors);
            if (_traceLatency && LatencyTrace.TakeTargetRequest()) TraceTargetScreens();
            if (Session.State == SessionState.InMatch)
            {
                ReadInput();
                Session.FlushInput();
            }
            Present();
        }

        void ReadInput()
        {
            var m = Session.Motion;
            if (m == null || !m.Initialized) return;
            double now = NowMs();
            float myX = m.DrawnX, myY = m.DrawnY;

            var mouse = Mouse.current;
            // Release is always forwarded, even if the pointer moved onto a panel after pressing.
            if (_attackHeld && mouse != null && mouse.leftButton.wasReleasedThisFrame)
            {
                Session.Input.Release(_aimAngle, Session.Clock.RenderMs); _attackHeld = false;
            }
            bool keyboardBlocked = Hud != null && Hud.BlocksKeyboardInput;
            bool blocked = Hud != null && Hud.BlocksPointerInput;
            // Opening a map/menu cancels a held attack immediately; release is never swallowed by UI capture.
            if ((keyboardBlocked || Hud != null && Hud.TacticalMap != null && Hud.TacticalMap.PointerBlocked) && _attackHeld)
            {
                Session.Input.Release(_aimAngle, Session.Clock.RenderMs); _attackHeld = false;
            }
            if (keyboardBlocked)
            {
                if (_steering) { OrderStop(); _steering = false; }
                return;
            }
            float sx = myX, sy = myY;
            bool haveCursor = !blocked && mouse != null && Cam != null && Arena != null && Arena.ScreenToServer(Cam, mouse.position.ReadValue(), out sx, out sy);
            if (haveCursor)
            {
                _aimAngle = Mathf.Atan2(sy - myY, sx - myX);
                Session.Input.Aim(_aimAngle);
                if (mouse.leftButton.wasPressedThisFrame)
                {
                    // UI hit geometry only. The server resolves sight, eligibility and all targeting rules.
                    uint target = VisibleActorAt(mouse.position.ReadValue());
                    if (Session.Me != null && Session.Me.Weapon == WeaponId.Wand && target != 0)
                        Session.Input.Target(target);
                    else
                    {
                        Session.Input.Attack(_aimAngle, Session.Clock.RenderMs); _attackHeld = true;
                        if (mouse.leftButton.wasReleasedThisFrame)
                        {
                            Session.Input.Release(_aimAngle, Session.Clock.RenderMs); _attackHeld = false;
                        }
                    }
                }
                if (mouse.rightButton.wasPressedThisFrame)
                {
                    if (Keyboard.current != null && Keyboard.current.leftShiftKey.isPressed) Session.Input.AttackMove(sx, sy);
                    else OrderMove(sx, sy);
                }
            }
            var kb = Keyboard.current;
            if (kb == null) return;
            if (kb.rKey.wasPressedThisFrame)
            {
                uint target = haveCursor && mouse != null ? VisibleActorAt(mouse.position.ReadValue()) : 0;
                byte seq = Session.CollectWishInput(true, blocked, haveCursor, sx, sy, target == 0 ? (uint?)null : target);
                if (_traceLatency && seq != 0) LatencyTrace.Mark("sampleWish", Session.PlayerId, seq, sx, sy);
            }
            if (Hud == null || !Hud.ChestOwnsDigits)
            {
                if (kb.digit1Key.wasPressedThisFrame) Session.Input.Swap(0);
                if (kb.digit2Key.wasPressedThisFrame) Session.Input.Swap(1);
            }
            if (kb.qKey.wasPressedThisFrame) Session.Input.Swap();
            if (kb.eKey.wasPressedThisFrame) Session.Input.UseConsumable();
            if (kb.fKey.wasPressedThisFrame) PickupFocus();
            // Server +y points down the screen. This sends destinations; it never simulates movement.
            bool arrows = Hud == null || !Hud.ConsumesArrowNavigation;
            var dir = new Vector2((kb.dKey.isPressed || arrows && kb.rightArrowKey.isPressed ? 1 : 0) - (kb.aKey.isPressed || arrows && kb.leftArrowKey.isPressed ? 1 : 0),
                (kb.sKey.isPressed || arrows && kb.downArrowKey.isPressed ? 1 : 0) - (kb.wKey.isPressed || arrows && kb.upArrowKey.isPressed ? 1 : 0));
            if (dir != Vector2.zero)
            {
                dir.Normalize();
                if (!_steering || dir != _lastDir || now - _lastSteer >= SteerRepeatMs)
                {
                    OrderMove(myX + dir.x * SteerAheadU, myY + dir.y * SteerAheadU);
                    _lastDir = dir; _lastSteer = now; _steering = true;
                }
            }
            else if (_steering) { OrderStop(); _steering = false; }
        }

        void OrderMove(float x, float y)
        {
            byte seq = Session.OrderMove(x, y);
            if (_traceLatency && seq != 0) LatencyTrace.Mark("sampleMove", Session.PlayerId, seq, x, y);
        }

        void OrderStop()
        {
            byte seq = Session.OrderStop();
            if (_traceLatency) LatencyTrace.Mark("sampleStop", Session.PlayerId, seq, 0, 0);
        }

        public void PickupFocus()
        {
            if (Session != null && Session.State == SessionState.InMatch && Session.Collections.Focus.HasValue)
                Session.Input.Pickup(Session.Collections.Focus.Value.Handle);
        }

        // One-shot, explicitly enabled proof data from the same delivered set and camera as the input picker.
        void TraceTargetScreens()
        {
            if (Cam == null || Arena == null || Session.Me == null) return;
            LatencyTrace.Mark("targetViewport", 0, 0, Screen.width, Screen.height);
            var self = Cam.WorldToScreenPoint(ArenaView.WorldPoint(Session.Me.X, Session.Me.Y));
            if (self.z > 0) LatencyTrace.Mark("targetSelf", Session.PlayerId, 0, self.x, self.y);
            Session.Snapshots.Sample(Session.Snapshots.NewestMs, _targetActors);
            foreach (var actor in _targetActors)
            {
                if (actor.Id == Session.PlayerId) continue;
                var screen = Cam.WorldToScreenPoint(ArenaView.WorldPoint(actor.X, actor.Y));
                if (screen.z > 0) LatencyTrace.Mark("targetActor", actor.Id, (int)actor.Kind, screen.x, screen.y);
            }
        }

        uint VisibleActorAt(Vector2 pointer)
        {
            uint id = 0; float best = 22f * 22f;
            // Use the newest delivered membership: observer refs can change between snapshots.
            Session.Snapshots.Sample(Session.Snapshots.NewestMs, _targetActors);
            foreach (var actor in _targetActors)
            {
                if (actor.Id == Session.PlayerId) continue;
                var screen = Cam.WorldToScreenPoint(ArenaView.WorldPoint(actor.X, actor.Y));
                if (screen.z <= 0) continue;
                float d = ((Vector2)screen - pointer).sqrMagnitude;
                if (d < best) { best = d; id = actor.Id; }
            }
            return id;
        }

        void Present()
        {
            if (Arena == null) return;
            // Renderer membership is refreshed independently of optional audio components.
            Arena.RefreshVisibility(Session);
            Arena.PresentCollections(Session.Collections);
            Arena.Present(_actors, Session.Me, Session.Motion, _aimAngle);
            if (_traceLatency)
            {
                if (Session.Me != null && Session.Motion != null)
                    LatencyTrace.Mark("presentSelf", Session.PlayerId, Session.Me.MoveSeq, Session.Motion.DrawnX, Session.Motion.DrawnY);
                foreach (var actor in _actors)
                    LatencyTrace.Mark("presentActor", actor.Id, 0, actor.X, actor.Y);
            }
            if (Cam != null && Hud != null && Hud.TacticalMap != null && Hud.TacticalMap.IsPeeking)
            {
                var at = Hud.TacticalMap.PeekAt; Arena.Follow(Cam, at.x, at.y);
            }
            else if (Cam != null && Session.Motion != null && Session.Motion.Initialized) Arena.Follow(Cam, Session.Motion.DrawnX, Session.Motion.DrawnY);
        }
    }
}
