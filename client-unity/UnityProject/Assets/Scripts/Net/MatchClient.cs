// NOT COMPILED in Stage 1 (no Unity). Owns the Session, pumps it each frame, turns input into orders, exposes state for the view.
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public sealed class MatchClient : MonoBehaviour
    {
        public string Url = "ws://127.0.0.1:7777/ws", Profile = "unity1";
        /// <summary>The admission ticket, sent as its UTF-8 bytes (the dev server checks the callsign secret; P-HOST-1 defines hosted tickets).</summary>
        public string Token = "t1";
        public ulong ContentHash;
        /// <summary>-1 = server default.</summary>
        public int Faction = -1;
        public ArenaView Arena;
        public Camera Cam;

        public Session Session { get; private set; }
        readonly List<InterpActor> _actors = new List<InterpActor>();
        const double SteerRepeatMs = 100;
        const float SteerAheadU = 64f;
        Vector2 _lastDir;
        double _lastSteer;
        bool _steering;
        float _aimAngle;

        static double NowMs() { return Time.realtimeSinceStartupAsDouble * 1000.0; }

        void Start()
        {
            Session = new Session(TransportFactory.Create(), new SessionOptions
            {
                Url = Url, Profile = Profile, Ticket = System.Text.Encoding.UTF8.GetBytes(Token ?? ""), ContentHash = ContentHash, Build = "unity-web-0.1.0",
                Faction = Faction >= 0 ? (byte)Faction : (byte?)null, Now = NowMs,
            });
            Session.StateChanged += s => Debug.Log("[net] " + s + (Session.RejectCode.HasValue ? " " + Session.RejectCode + ": " + Session.RejectReason : "") + (Session.Error != null ? " " + Session.Error : ""));
            Session.Connect();
        }

        void OnDestroy() { if (Session != null && Session.State == SessionState.InMatch) Session.Leave(); }

        void Update()
        {
            if (Session == null) return;
            Session.Update();
            if (Session.State != SessionState.InMatch && Session.State != SessionState.Ended) return;
            if (Arena != null && !Arena.HasMap && Session.Map != null) Arena.Build(Session.Map);
            if (Session.State == SessionState.InMatch) ReadInput();
            Present();
        }

        void ReadInput()
        {
            var m = Session.Motion;
            if (m == null || !m.Initialized) return;
            double now = NowMs();
            float myX = m.DrawnX, myY = m.DrawnY;

            var mouse = Mouse.current;
            float sx = myX, sy = myY;
            bool haveCursor = mouse != null && Cam != null && Arena != null && Arena.ScreenToServer(Cam, mouse.position.ReadValue(), out sx, out sy);
            if (haveCursor)
            {
                _aimAngle = Mathf.Atan2(sy - myY, sx - myX);
                Session.Input.Aim(_aimAngle);
                double t = Session.Clock.RenderMs; // server ms the player is looking at (lag compensation)
                if (mouse.leftButton.wasPressedThisFrame) Session.Input.Attack(_aimAngle, t);
                if (mouse.leftButton.wasReleasedThisFrame) Session.Input.Release(_aimAngle, t);
                if (mouse.rightButton.wasPressedThisFrame) Session.OrderMove(sx, sy);
            }

            var kb = Keyboard.current;
            if (kb == null) return;
            // Server +y points down the screen, so S is +y.
            var dir = new Vector2((kb.dKey.isPressed ? 1 : 0) - (kb.aKey.isPressed ? 1 : 0), (kb.sKey.isPressed ? 1 : 0) - (kb.wKey.isPressed ? 1 : 0));
            if (dir != Vector2.zero)
            {
                dir.Normalize();
                if (!_steering || dir != _lastDir || now - _lastSteer >= SteerRepeatMs)
                {
                    Session.OrderMove(myX + dir.x * SteerAheadU, myY + dir.y * SteerAheadU);
                    _lastDir = dir; _lastSteer = now; _steering = true;
                }
            }
            else if (_steering) { Session.OrderStop(); _steering = false; }
        }

        void Present()
        {
            if (Arena == null) return;
            Session.Snapshots.Sample(Session.Clock.RenderMs, _actors);
            Arena.Present(_actors, Session.Me, Session.Motion, _aimAngle);
            if (Cam != null && Session.Motion != null && Session.Motion.Initialized) Arena.Follow(Cam, Session.Motion.DrawnX, Session.Motion.DrawnY);
        }
    }
}
