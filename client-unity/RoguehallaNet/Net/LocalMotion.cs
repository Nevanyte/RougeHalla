using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>Presentation of the local player's last accepted authoritative self snapshot.</summary>
    public sealed class LocalMotion
    {
        bool _pending;
        byte _lastSeq;

        public bool Initialized { get; private set; }
        public float SimX { get; private set; }
        public float SimY { get; private set; }
        // Retained for view callers. Confirmed positions are drawn directly, without client-side motion or smoothing.
        public float VisualX { get { return 0; } }
        public float VisualY { get { return 0; } }
        public float DrawnX { get { return SimX; } }
        public float DrawnY { get { return SimY; } }
        public bool OrderPending { get { return _pending; } }

        // Map remains part of construction for source compatibility with existing session setup.
        public LocalMotion(MapBlob map) { }

        /// <summary>Records the sequence of a transmitted move order; it does not move the presented position.</summary>
        public void Order(float x, float y, byte seq, double nowMs)
        {
            Track(seq);
        }

        /// <summary>Records the sequence of a transmitted stop order; it does not move the presented position.</summary>
        public void StopOrder(byte seq, double nowMs)
        {
            Track(seq);
        }

        void Track(byte seq)
        {
            if (seq == 0) return;
            _lastSeq = seq;
            _pending = true;
        }

        /// <summary>Kept as a no-op for existing frame-loop callers; presentation changes only on accepted snapshots.</summary>
        public void Step(double nowMs) { }

        /// <summary>Applies an accepted authoritative self snapshot immediately, even while an order is pending.</summary>
        public void OnSnapshot(WireSelf me, double nowMs)
        {
            if (me == null) { Clear(); return; }
            Initialized = true;
            SimX = me.X;
            SimY = me.Y;
            if (_pending && me.MoveSeq == _lastSeq) _pending = false;
        }

        /// <summary>Clears the presented self and pending order when the accepted snapshot has no local player.</summary>
        public void Clear()
        {
            Initialized = false;
            SimX = SimY = 0;
            _pending = false;
            _lastSeq = 0;
        }
    }
}
