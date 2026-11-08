using System;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// Tracks local pending planning inputs beside the owned server PlanView. This class presents intent only; a pending
    /// choice never replaces the confirmed server pick and expires if reliable State does not confirm it.
    /// </summary>
    public sealed class PlanningSelections
    {
        public const double PendingTimeoutMs = 600;

        PlanView _plan;
        bool _connected;
        bool _seenUpdate;
        double _lastNowMs;
        byte? _pendingSpawn, _pendingBoon;
        byte? _spawnBaseline, _boonBaseline;
        double _pendingSpawnAt = double.NaN, _pendingBoonAt = double.NaN, _pendingReadyAt = double.NaN;

        public PlanView Plan { get { return _plan; } }
        public bool IsConnected { get { return _connected; } }
        public byte? PendingSpawn { get { return _pendingSpawn; } }
        public byte? PendingBoon { get { return _pendingBoon; } }
        public bool PendingReady { get { return !double.IsNaN(_pendingReadyAt); } }
        public byte? ConfirmedSpawn { get { return _plan == null ? (byte?)null : _plan.Pick; } }
        public byte? ConfirmedBoon { get { return _plan == null ? (byte?)null : _plan.Boon; } }
        public bool ServerReady { get { return _plan != null && _plan.Ready; } }
        public string Feedback { get; private set; } = "";

        public bool CanPickSpawn(byte pick)
        {
            if (!CanChangePlan || pick > 1 || _pendingSpawn.HasValue || PendingReady) return false;
            if (pick == _plan.Pick) return false;
            return SpawnExists(pick) && !SpawnTaken(pick);
        }

        public bool CanPickBoon(byte pick)
        {
            if (!CanChangePlan || pick > 1 || _pendingBoon.HasValue || PendingReady) return false;
            if (pick == _plan.Boon) return false;
            return _plan.Boons != null && pick < _plan.Boons.Count;
        }

        public bool CanReady
        {
            get { return CanChangePlan && !PendingReady && !_pendingSpawn.HasValue && !_pendingBoon.HasValue; }
        }

        bool CanChangePlan { get { return _connected && _plan != null && !_plan.Ready; } }

        public void Update(PlanView plan, bool connected, double monotonicMs)
        {
            double now = ObserveClock(monotonicMs);
            bool reconnecting = _seenUpdate && _connected && !connected;
            _seenUpdate = true;

            if (reconnecting)
            {
                bool hadPending = ClearPending();
                if (hadPending) Feedback = "Connection interrupted; pending choices were cleared. Server-confirmed choices are retained.";
            }
            _connected = connected;

            // A disconnected Session may temporarily expose an empty collection while it resumes. Retain its last
            // server-confirmed plan until the resumed reliable State explicitly replaces or clears it.
            if (!connected && plan == null)
            {
                Expire(now);
                return;
            }

            if (plan == null)
            {
                if (_plan != null)
                {
                    bool pending = ClearPending();
                    _plan = null;
                    if (pending) Feedback = "Planning ended before the pending choice was confirmed.";
                }
                Expire(now);
                return;
            }

            if (_plan != null && !SameDeal(_plan, plan))
            {
                bool pending = ClearPending();
                if (pending) Feedback = "Planning options changed; review the server's current choices.";
            }
            else if (_plan != null)
            {
                AnnounceTaken(_plan, plan);
                SettleSpawn(plan);
                SettleBoon(plan);
                if (plan.Ready && PendingReady)
                {
                    ClearPending();
                    Feedback = "Ready confirmed by the server.";
                }
                else if (plan.Ready)
                {
                    // Ready freezes every choice. Never keep a local preview around a latched server fact.
                    ClearPending();
                }
            }

            _plan = plan;
            Expire(now);
        }

        public bool TryPickSpawn(byte pick, InputSender sender, double nowMs)
        {
            AdvanceForIntent(nowMs);
            if (sender == null) throw new ArgumentNullException(nameof(sender));
            if (!CanPickSpawn(pick)) return RefusePick("spawn", pick);
            sender.Plan(spawn: pick);
            _pendingSpawn = pick; _spawnBaseline = _plan.Pick; _pendingSpawnAt = _lastNowMs;
            Feedback = "Spawn " + (pick + 1) + " sent; waiting for server confirmation.";
            return true;
        }

        public bool TryPickBoon(byte pick, InputSender sender, double nowMs)
        {
            AdvanceForIntent(nowMs);
            if (sender == null) throw new ArgumentNullException(nameof(sender));
            if (!CanPickBoon(pick)) return RefusePick("boon", pick);
            sender.Plan(boon: pick);
            _pendingBoon = pick; _boonBaseline = _plan.Boon; _pendingBoonAt = _lastNowMs;
            Feedback = "Boon choice sent; waiting for server confirmation.";
            return true;
        }

        public bool TryReady(InputSender sender, double nowMs)
        {
            AdvanceForIntent(nowMs);
            if (sender == null) throw new ArgumentNullException(nameof(sender));
            if (!CanReady)
            {
                if (!_connected) Feedback = "Reconnect before marking ready.";
                else if (_plan == null) Feedback = "Planning choices are not available.";
                else if (_plan.Ready) Feedback = "Ready is already confirmed by the server.";
                else if (PendingReady) Feedback = "Waiting for the server to confirm Ready.";
                else Feedback = "Wait for your pending planning choices to settle before Ready.";
                return false;
            }
            sender.Plan(ready: true);
            _pendingReadyAt = _lastNowMs;
            Feedback = "Ready sent; waiting for server confirmation.";
            return true;
        }

        bool RefusePick(string kind, byte pick)
        {
            if (!_connected) Feedback = "Reconnect before changing planning choices.";
            else if (_plan == null) Feedback = "Planning choices are not available.";
            else if (_plan.Ready) Feedback = "Your planning choices are locked by server-confirmed Ready.";
            else if (kind == "spawn" && pick <= 1 && SpawnTaken(pick)) Feedback = "Spawn " + (pick + 1) + " was taken by another player.";
            else if (kind == "spawn" && pick <= 1 && pick == _plan.Pick) Feedback = "That spawn is already confirmed.";
            else if (kind == "boon" && pick <= 1 && pick == _plan.Boon) Feedback = "That boon is already confirmed.";
            else if (kind == "spawn" && _pendingSpawn.HasValue || kind == "boon" && _pendingBoon.HasValue)
                Feedback = "Wait for the current choice to be confirmed.";
            else Feedback = "That planning option is unavailable.";
            return false;
        }

        void AdvanceForIntent(double nowMs)
        {
            double now = ObserveClock(nowMs);
            Expire(now);
        }

        double ObserveClock(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) value = _seenUpdate ? _lastNowMs : 0;
            if (_seenUpdate && value < _lastNowMs) value = _lastNowMs;
            _lastNowMs = value;
            return value;
        }

        void Expire(double now)
        {
            bool expired = false;
            if (!double.IsNaN(_pendingSpawnAt) && now - _pendingSpawnAt >= PendingTimeoutMs)
            { ClearSpawn(); expired = true; }
            if (!double.IsNaN(_pendingBoonAt) && now - _pendingBoonAt >= PendingTimeoutMs)
            { ClearBoon(); expired = true; }
            if (!double.IsNaN(_pendingReadyAt) && now - _pendingReadyAt >= PendingTimeoutMs)
            { _pendingReadyAt = double.NaN; expired = true; }
            if (expired) Feedback = "The server did not confirm the planning choice.";
        }

        void SettleSpawn(PlanView plan)
        {
            if (!_pendingSpawn.HasValue) return;
            byte pending = _pendingSpawn.Value;
            if (plan.Pick == pending)
            {
                ClearSpawn(); Feedback = "Spawn " + (pending + 1) + " confirmed by the server.";
            }
            else if (SpawnTaken(plan, pending))
            {
                ClearSpawn(); Feedback = "Spawn " + (pending + 1) + " was taken by another player.";
            }
            else if (plan.Pick != _spawnBaseline)
            {
                ClearSpawn(); Feedback = "The server confirmed a different spawn choice.";
            }
        }

        void SettleBoon(PlanView plan)
        {
            if (!_pendingBoon.HasValue) return;
            byte pending = _pendingBoon.Value;
            if (plan.Boon == pending)
            {
                ClearBoon(); Feedback = "Boon choice confirmed by the server.";
            }
            else if (plan.Boon != _boonBaseline)
            {
                ClearBoon(); Feedback = "The server confirmed a different boon choice.";
            }
        }

        void AnnounceTaken(PlanView before, PlanView now)
        {
            for (byte i = 0; i < 2; i++)
            {
                if (!SpawnTaken(before, i) && SpawnTaken(now, i))
                {
                    if (_pendingSpawn == i) Feedback = "Spawn " + (i + 1) + " was taken by another player.";
                    else Feedback = "Spawn " + (i + 1) + " was taken by another player.";
                }
            }
        }

        bool SpawnExists(byte pick) { return SpawnExists(_plan, pick); }
        static bool SpawnExists(PlanView plan, byte pick) { return plan != null && (pick == 0 ? plan.Spawn0.HasValue : pick == 1 && plan.Spawn1.HasValue); }
        bool SpawnTaken(byte pick) { return SpawnTaken(_plan, pick); }
        static bool SpawnTaken(PlanView plan, byte pick) { return plan != null && (pick == 0 ? plan.Taken0 : pick == 1 && plan.Taken1); }

        static bool SameDeal(PlanView a, PlanView b)
        {
            if (a == null || b == null || a.EndsAt != b.EndsAt || a.Spawn0 != b.Spawn0 || a.Spawn1 != b.Spawn1) return false;
            if (a.Boons == null || b.Boons == null) return a.Boons == b.Boons;
            if (a.Boons.Count != b.Boons.Count) return false;
            for (int i = 0; i < a.Boons.Count; i++) if (a.Boons[i] != b.Boons[i]) return false;
            return SameOption(a.Option0, b.Option0) && SameOption(a.Option1, b.Option1);
        }
        static bool SameOption(PlanOptionView? a, PlanOptionView? b)
        {
            if (a.HasValue != b.HasValue) return false;
            if (!a.HasValue) return true;
            return a.Value.Index == b.Value.Index && a.Value.X == b.Value.X && a.Value.Y == b.Value.Y &&
                a.Value.Zone == b.Value.Zone && a.Value.WalkSeconds == b.Value.WalkSeconds;
        }

        bool ClearPending()
        {
            bool had = _pendingSpawn.HasValue || _pendingBoon.HasValue || PendingReady;
            ClearSpawn(); ClearBoon(); _pendingReadyAt = double.NaN;
            return had;
        }
        void ClearSpawn() { _pendingSpawn = null; _spawnBaseline = null; _pendingSpawnAt = double.NaN; }
        void ClearBoon() { _pendingBoon = null; _boonBaseline = null; _pendingBoonAt = double.NaN; }
    }
}
