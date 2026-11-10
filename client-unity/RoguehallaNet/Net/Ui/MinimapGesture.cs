using System;

namespace Roguehalla.Net.Ui
{
    public enum MinimapButton : byte { Left, Right }

    /// <summary>Tracks minimap pointer gestures and yields only changed movement destinations.</summary>
    public sealed class MinimapGesture
    {
        public const double MoveIntervalMs = 100;

        bool _leftHeld, _rightHeld;
        bool _hasMovePoint, _hasSentPoint;
        RoutePoint _peekPoint, _movePoint, _sentPoint;
        double _lastSentAt;
        bool _hasClock;
        double _lastNow;

        public bool IsPeeking { get { return _leftHeld; } }
        public RoutePoint? PeekPoint { get { return _leftHeld ? (RoutePoint?)_peekPoint : null; } }
        public bool IsSteering { get { return _rightHeld; } }

        /// <summary>Left press begins a camera peek; right press yields its initial move immediately.</summary>
        public RoutePoint? Press(MinimapButton button, RoutePoint point, double nowMs)
        {
            double now = Clock(nowMs);
            if (!Finite(point.X) || !Finite(point.Y)) return null;
            if (button == MinimapButton.Left)
            {
                _leftHeld = true;
                _peekPoint = point;
                return null;
            }

            _rightHeld = true;
            _movePoint = point;
            _hasMovePoint = true;
            _hasSentPoint = false;
            return Emit(now, force: true);
        }

        /// <summary>Updates only the matching held gesture. Movement sends are rate-limited by Tick.</summary>
        public void Drag(MinimapButton button, RoutePoint point)
        {
            if (!Finite(point.X) || !Finite(point.Y)) return;
            if (button == MinimapButton.Left && _leftHeld) _peekPoint = point;
            else if (button == MinimapButton.Right && _rightHeld)
            {
                _movePoint = point;
                _hasMovePoint = true;
            }
        }

        /// <summary>Releases one button; right release flushes a changed final destination exactly once.</summary>
        public RoutePoint? Release(MinimapButton button, double nowMs)
        {
            double now = Clock(nowMs);
            if (button == MinimapButton.Left)
            {
                _leftHeld = false;
                return null;
            }

            RoutePoint? final = _rightHeld ? Emit(now, force: true) : null;
            _rightHeld = false;
            _hasMovePoint = false;
            return final;
        }

        /// <summary>Yields the latest changed destination when the 100 ms interval has elapsed.</summary>
        public RoutePoint? Tick(double nowMs)
        {
            double now = Clock(nowMs);
            if (!_rightHeld) return null;
            return Emit(now, force: false);
        }

        /// <summary>Cancels only a lost button capture, without sending its queued movement.</summary>
        public void Cancel(MinimapButton button)
        {
            if (button == MinimapButton.Left) _leftHeld = false;
            else { _rightHeld = false; _hasMovePoint = false; }
        }

        /// <summary>Aborts gestures on blur or cancellation without sending the queued destination.</summary>
        public void Abort()
        {
            _leftHeld = _rightHeld = false;
            _hasMovePoint = false;
        }

        RoutePoint? Emit(double now, bool force)
        {
            if (!_hasMovePoint || _hasSentPoint && _movePoint.Equals(_sentPoint)) return null;
            if (!force && _hasSentPoint && now - _lastSentAt < MoveIntervalMs) return null;
            _sentPoint = _movePoint;
            _hasSentPoint = true;
            _lastSentAt = now;
            return _movePoint;
        }

        double Clock(double value)
        {
            if (!Finite(value)) value = _hasClock ? _lastNow : 0;
            if (_hasClock && value < _lastNow) value = _lastNow;
            _lastNow = value;
            _hasClock = true;
            return value;
        }

        static bool Finite(double value) { return !double.IsNaN(value) && !double.IsInfinity(value); }
    }
}
