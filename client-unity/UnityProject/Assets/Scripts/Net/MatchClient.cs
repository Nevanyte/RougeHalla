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
        Vector2 _lastDir;
        readonly Pathfinder _steerPathfinder = new Pathfinder();
        double _steerGoalX, _steerGoalY;
        double _lastSteer;
        bool _steering;
        float _aimAngle;
        bool _attackHeld;
        bool _traceLatency;
        MatchLaunchTarget _sessionTarget;
        int _sessionFaction;
        long _sessionGeneration;
        uint _confirmedModeEpoch;
        bool _modeConfirmed;
        Action<SessionState> _boundLaunchState;
        Action<ServerMsg.Snapshot> _boundLaunchSnapshot;
        Action _boundLaunchTimeline;

        // Welcome has no mode. Its default Training=false is never confirmation, including on resume.
        public bool LaunchVerified => this != null && !_destroying && Session != null && (_sessionTarget == null || _modeConfirmed &&
            _sessionGeneration == _joinGeneration && Session.Latest != null &&
            Session.TimelineEpoch == _confirmedModeEpoch && _sessionTarget.MatchesServer(Session.Training));
        public bool LaunchPending => _sessionTarget != null && Session != null && !LaunchVerified &&
            (Session.State == SessionState.Idle || Session.State == SessionState.Connecting || Session.State == SessionState.HelloSent ||
             Session.State == SessionState.InMatch || Session.State == SessionState.Reconnecting);
        public bool ConfirmedPractice => _sessionTarget != null && LaunchVerified && Session != null && Session.Training;
        public string PendingLaunchText => "Verifying " + (_sessionTarget?.Mode == MatchLaunchMode.Training ? "Training" : "Arena") + " with the server…";

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
            InitializeSeatResume();
            Hud = gameObject.AddComponent<MatchHud>();
            Hud.Initialize(this);
            if (AutoJoin) Join(Profile, Faction);
        }

        void JoinCore(string nickname, int faction, MatchLaunchTarget target, string ownerToken, long generation,
            AccountSettlementAccess settlementAccess = null, AccountJoinIntent ownerIntent = null, OwnedSeatCheckpoint resumeRecord = null)
        {
            if (_destroying || generation != _joinGeneration) return;
            CloseCurrentSession(keepCheckpoint: resumeRecord != null);
            if (_destroying || generation != _joinGeneration) return;
            Profile = string.IsNullOrWhiteSpace(nickname) ? Profile : nickname.Trim();
            Faction = faction;
            _actors.Clear(); _steering = false; _attackHeld = false;
            var arena = new GameObject("Arena").AddComponent<ArenaView>();
            Arena = arena;
            var transport = _transportFactory();
            if (_destroying || generation != _joinGeneration)
            {
                if (ReferenceEquals(Arena, arena)) { Arena = null; DestroyOwnedArena(arena.gameObject); }
                transport.Close(); return;
            }
            var session = new Session(transport, new SessionOptions
            {
                Url = target.Url, Profile = Profile, Ticket = System.Text.Encoding.UTF8.GetBytes(ownerToken ?? ""), ContentHash = ContentHash, Build = "unity-web-0.1.0",
                Faction = Faction >= 0 ? (byte)Faction : (byte?)null, Now = NowMs,
                InitialResume = resumeRecord?.CreateSeed(),
            });
            Session = session; _sessionTarget = target; _sessionFaction = faction;
            _sessionGeneration = generation; _modeConfirmed = false;
            BindOwnedSeatSession(session, ownerIntent, target, faction, generation, resumeRecord);
            _boundLaunchState = state =>
            {
                if (!CurrentLaunchSession(session, generation)) return;
                if (state != SessionState.InMatch) { Hud?.UnbindTrainingSession(); _steering = false; _attackHeld = false; }
                if (state == SessionState.Failed || state == SessionState.Rejected || state == SessionState.Ended) Hud?.RefreshLaunchConfirmation(session);
                SeatSessionStateChanged(session, generation, state);
                Debug.Log("[net] " + state + (session.RejectCode.HasValue ? " " + session.RejectCode + ": " + session.RejectReason : "") + (session.Error != null ? " " + session.Error : ""));
            };
            _boundLaunchSnapshot = snapshot =>
            {
                if (!CurrentLaunchSession(session, generation) || !ReferenceEquals(session.Latest, snapshot)) return;
                if (!SeatResumeModeAllowed(session)) { RefuseLaunch("The profile changed. Load it again before resuming."); return; }
                if (!CurrentLaunchTarget(target, faction)) { RefuseLaunch("The connection changed. Start your run again."); return; }
                if (!target.MatchesServer(session.Training))
                {
                    RefuseLaunch("The server returned " + (session.Training ? "Training" : "Arena") +
                        " for the selected " + target.Mode + " destination. Return to the menu and check the connection.");
                    return;
                }
                bool wasVerified = LaunchVerified;
                _confirmedModeEpoch = session.TimelineEpoch; _modeConfirmed = true;
                CaptureConfirmedSeat(session);
                if (!CurrentLaunchSession(session, generation)) return;
                if (!wasVerified) Hud?.RefreshLaunchConfirmation(session);
            };
            _boundLaunchTimeline = () =>
            {
                if (!CurrentLaunchSession(session, generation)) return;
                _modeConfirmed = false;
                Hud?.UnbindTrainingSession();
                Hud?.RefreshLaunchConfirmation(session);
            };
            session.StateChanged += _boundLaunchState;
            // Validate before HUD subscribers see any accepted owner snapshot.
            session.SnapshotReceived += _boundLaunchSnapshot;
            session.TimelineReset += _boundLaunchTimeline;
            BindSettlementSession(session, settlementAccess, generation);
            Hud?.Bind(session);
            if (!CurrentLaunchSession(session, generation)) return;
            BindPresentationSession(session);
            if (!SeatResumeConnectAllowed(session))
            {
                if (CurrentLaunchSession(session, generation)) CloseCurrentSession(detach: true, keepCheckpoint: true);
                return;
            }
            if (!CurrentLaunchSession(session, generation)) return;
            session.Connect();
        }

        bool CurrentLaunchSession(Session session, long generation) => this != null && !_destroying &&
            generation == _joinGeneration && ReferenceEquals(Session, session);

        void RefuseLaunch(string reason)
        {
            AccountUiError = reason;
            CancelOwnedJoin();
        }

        void CloseCurrentSession(bool detach = false, bool keepCheckpoint = false)
        {
            var old = Session;
            var oldArena = Arena;
            long retirementGeneration = _joinGeneration;
            var oldCheckpoint = TakeSeatBinding(keepCheckpoint);
            Hud?.UnbindTrainingSession();
            UnbindSettlementSession();
            Session = null; _sessionTarget = null; _modeConfirmed = false;
            if (old != null)
            {
                old.StateChanged -= _boundLaunchState;
                old.SnapshotReceived -= _boundLaunchSnapshot;
                old.TimelineReset -= _boundLaunchTimeline;
            }
            _boundLaunchState = null; _boundLaunchSnapshot = null; _boundLaunchTimeline = null;
            UnbindPresentationSession(); ResetPresentationTimeline();
            Arena = null;
            _actors.Clear(); _steering = false; _attackHeld = false;
            if (oldArena != null) DestroyOwnedArena(oldArena.gameObject);
            if (!_destroying) Hud?.ShowMenu();
            // Retired-session callbacks may synchronously start another launch. All old
            // binding/arena mutations must finish before invoking the old session's Leave.
            if (!keepCheckpoint) ClearSeatRecord(oldCheckpoint);
            if (detach || this == null || _destroying || retirementGeneration != _joinGeneration) old?.Detach();
            else old?.Leave();
        }

        // The caller has already detached ownership. Never look up a mutable Arena
        // here: teardown callbacks may install a replacement while this root retires.
        static void DestroyOwnedArena(GameObject owned)
        {
            if (owned == null) return;
            owned.SetActive(false);
#if UNITY_EDITOR
            if (!Application.isPlaying)
            {
                if (owned != null) UnityEngine.Object.DestroyImmediate(owned);
                return;
            }
#endif
            if (owned != null) UnityEngine.Object.Destroy(owned);
        }

        public void Leave()
        {
            if (this == null || _destroying) return;
            CancelOwnedJoin();
        }

        void OnApplicationFocus(bool focused)
        {
            if (!focused) Hud?.ReleaseUiFocusForWindowLoss();
            else Hud?.RestoreUiFocusAfterWindowGain();
            if (focused || Session == null || Session.State != SessionState.InMatch) return;
            if (_attackHeld) Session.Input.Release(_aimAngle, Session.Clock.RenderMs);
            if (_steering) Session.OrderStop();
            bool queued = _attackHeld || _steering;
            _attackHeld = _steering = false;
            // A hidden tab may not run Update again for a long time: send the Release/Stop now, not on the next frame.
            if (queued) Session.FlushInput();
            Hud?.TacticalMap?.ReleaseTransient();
        }

        void OnDestroy()
        {
            RetireRuntime();
        }

        void OnApplicationQuit() { RetireRuntime(); }

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

        void PresentFx(ServerMsg.Fx fx)
        {
            if (!LaunchVerified || Arena == null) return;
            // Fx of tick T happened in step T: interpolated remote poses reach it when render time reaches snapshot T's
            // source time. Anchor on the newest snapshot so a source-time override (epoch cut) is respected.
            var s = _presentationSession ?? Session;
            if (s == null) { Arena.ConfirmedFx(fx); return; }
            var latest = s.Latest;
            double dueMs = latest != null ? latest.ServerMs + ((double)fx.Tick - latest.Tick) * Wire.TickMs : double.NaN;
            Arena.ConfirmedFx(fx, s.PlayerId, dueMs);
        }

        void Update()
        {
            if (Session == null) { Hud?.ReadUiInput(); return; }
            var session = Session;
            if (_sessionTarget != null && !CurrentLaunchTarget(_sessionTarget, _sessionFaction))
            { RefuseLaunch("The connection changed. Start your run again."); return; }
            _traceLatency = LatencyTrace.Enabled;
            if (_traceLatency) LatencyTrace.Mark("frameStart", Session.PlayerId, 0, 0, 0);
            session.Poll();
            if (!ReferenceEquals(Session, session)) return;
            Hud?.ReadUiInput();
            if (!ReferenceEquals(Session, session) || !LaunchVerified) return;
            if (Session.State != SessionState.InMatch && Session.State != SessionState.Ended) return;
            if (Arena != null && !Arena.HasMap && Session.Map != null) Arena.Build(Session.Map);
            Session.Snapshots.Sample(Session.Clock.RenderMs, _actors);
            // Camera first: the cursor ground point read by ReadInput must use this frame's camera, or aim is a frame stale.
            FollowCamera();
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
            // Server +y points down the screen. This sends destinations; it never simulates movement. As in legacy
            // keyboardMoveGoal, the destination is the first body-clear straight goal (held heading, then each axis of a
            // diagonal, 64 down to 8 u) so steering into or along a wall slides instead of path-walking around it.
            bool arrows = Hud == null || !Hud.ConsumesArrowNavigation;
            int keyX = (kb.dKey.isPressed || arrows && kb.rightArrowKey.isPressed ? 1 : 0) - (kb.aKey.isPressed || arrows && kb.leftArrowKey.isPressed ? 1 : 0);
            int keyY = (kb.sKey.isPressed || arrows && kb.downArrowKey.isPressed ? 1 : 0) - (kb.wKey.isPressed || arrows && kb.upArrowKey.isPressed ? 1 : 0);
            if (keyX != 0 || keyY != 0)
            {
                var dir = new Vector2(keyX, keyY);
                bool have = Session.Map != null && KeyboardSteer.TryGoal(_steerPathfinder, Session.Map, myX, myY, keyX, keyY, out _steerGoalX, out _steerGoalY);
                if (have)
                {
                    if (!_steering || dir != _lastDir || now - _lastSteer >= SteerRepeatMs)
                    {
                        OrderMove((float)_steerGoalX, (float)_steerGoalY);
                        _lastDir = dir; _lastSteer = now; _steering = true;
                    }
                }
                else if (_steering) { OrderStop(); _steering = false; }
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
            if (LaunchVerified && Session.State == SessionState.InMatch && Session.Collections.Focus.HasValue)
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
                DrawnPosition(actor, out float x, out float y);
                var screen = Cam.WorldToScreenPoint(ArenaView.WorldPoint(x, y));
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
                DrawnPosition(actor, out float x, out float y);
                var screen = Cam.WorldToScreenPoint(ArenaView.WorldPoint(x, y));
                if (screen.z <= 0) continue;
                float d = ((Vector2)screen - pointer).sqrMagnitude;
                if (d < best) { best = d; id = actor.Id; }
            }
            return id;
        }

        // Hit geometry follows ArenaView.Present: remote players are drawn at this frame's render-time sample (_actors),
        // NPCs and players not yet in that sample at their newest delivered position.
        void DrawnPosition(InterpActor newest, out float x, out float y)
        {
            x = newest.X; y = newest.Y;
            if (newest.Kind != ActorKind.Player) return;
            foreach (var drawn in _actors)
                if (drawn.Id == newest.Id) { x = drawn.X; y = drawn.Y; return; }
        }

        void FollowCamera()
        {
            if (Cam == null || Arena == null) return;
            if (Hud != null && Hud.TacticalMap != null && Hud.TacticalMap.IsPeeking)
            { var at = Hud.TacticalMap.PeekAt; Arena.FollowExact(Cam, at.x, at.y); }
            else if (Session.Motion != null && Session.Motion.Initialized)
                Arena.FollowSmoothed(Cam, Session.Motion.DrawnX, Session.Motion.DrawnY, Time.unscaledDeltaTime, false);
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
        }
    }
}
