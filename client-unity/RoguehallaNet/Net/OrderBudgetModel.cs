using System;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>
    /// The client's mirror of its seat's order budget (rh-sim <c>input::OrderBudget</c>, constants <c>ORDER_BURST</c> and
    /// <c>ORDER_PER_SECOND</c>): a token bucket of <see cref="Burst"/> tokens refilled at <see cref="PerSecond"/>, where every
    /// command but Aim spends one. The server drops a command that finds less than one token, silently. This model lets the
    /// <see cref="InputSender"/> hold such a command until a token is back instead of sending it into the drop.
    /// <para>
    /// Traffic shaping only: it decides when a command leaves, never what it does. The server's bucket stays the authority, and
    /// a command this model lets through can still be dropped there (after a reconnect, or when a link stall bunched earlier
    /// commands into one tick).
    /// </para>
    /// <para>
    /// The server refills on sim time at the tick a frame is applied, so a command sent 67 ms after another can be judged 17 ms
    /// after it (tick rounding plus arrival jitter). <see cref="SafetyTokens"/> covers 100 ms of refill for that.
    /// </para>
    /// </summary>
    public sealed class OrderBudgetModel
    {
        /// <summary>rh-sim <c>ORDER_BURST</c>.</summary>
        public const double Burst = 30.0;
        /// <summary>rh-sim <c>ORDER_PER_SECOND</c>.</summary>
        public const double PerSecond = 15.0;
        /// <summary>Tokens the model never counts on: 100 ms of refill (one 50 ms tick of rounding plus 50 ms of arrival jitter).</summary>
        public const double SafetyTokens = 1.5;

        double _tokens = Burst;
        double _atMs = double.NaN;

        /// <summary>Whether a command spends a token on the server (every kind but Aim).</summary>
        public static bool Costs(WireCommand c) { return c.Kind != CommandKind.Aim; }

        /// <summary>The modelled tokens at <paramref name="nowMs"/>; the clock only moves forward (an earlier time refills nothing).</summary>
        public double Tokens(double nowMs)
        {
            Refill(nowMs);
            return _tokens;
        }

        /// <summary>
        /// Whether one command can leave now and still leave <paramref name="reserve"/> tokens beyond the safety margin.
        /// A reserve of 0 is the test for a command that must not be dropped.
        /// </summary>
        public bool CanSpend(double nowMs, double reserve)
        {
            return Tokens(nowMs) >= 1.0 + SafetyTokens + reserve;
        }

        /// <summary>Records one sent command that costs a token.</summary>
        public void Spend(double nowMs)
        {
            Refill(nowMs);
            _tokens -= 1.0;
        }

        /// <summary>Back to a full bucket (a new seat).</summary>
        public void Reset()
        {
            _tokens = Burst;
            _atMs = double.NaN;
        }

        void Refill(double nowMs)
        {
            if (double.IsNaN(nowMs) || double.IsInfinity(nowMs)) return;
            if (double.IsNaN(_atMs)) { _atMs = nowMs; return; }
            if (nowMs <= _atMs) return;
            _tokens = Math.Min(Burst, _tokens + (nowMs - _atMs) / 1000.0 * PerSecond);
            _atMs = nowMs;
        }
    }

    /// <summary>
    /// How often a held movement key re-sends its steering order. A held key sends a Move to a point <see cref="AheadU"/> ahead of
    /// the predicted position, and must send the next one before the walker arrives there, or it stops. At a full order budget the
    /// repeat is <see cref="RepeatMs"/>; when the budget runs low it slows to <see cref="LowRepeatMs"/>, but never past
    /// <see cref="ReachShare"/> of the time the walk needs to reach the point at the current speed. Presentation and traffic only:
    /// the server still walks whatever order arrives.
    /// </summary>
    public static class SteerPacing
    {
        /// <summary>How far ahead of the predicted position a held key aims its Move, in world units.</summary>
        public const float AheadU = 64f;
        /// <summary>Repeat interval of a held key while the order budget has room.</summary>
        public const double RepeatMs = 100.0;
        /// <summary>Repeat interval of a held key while the order budget is low.</summary>
        public const double LowRepeatMs = 200.0;
        /// <summary>Share of the time to reach the steering point that a low-budget repeat may wait.</summary>
        public const double ReachShare = 0.6;
        /// <summary>
        /// Tokens a held-key repeat leaves for presses, releases, turns and casts (three clicks). Above this, steering repeats at
        /// the full rate.
        /// </summary>
        public const double RepeatReserve = 6.0;

        /// <summary>The repeat interval for a held key: <see cref="RepeatMs"/> with room in the budget, else the slower low-budget interval.</summary>
        public static double RepeatIntervalMs(bool budgetHasRoom, double speedMultiplier)
        {
            if (budgetHasRoom) return RepeatMs;
            double mult = double.IsNaN(speedMultiplier) || speedMultiplier <= 0 ? 1.0 : speedMultiplier;
            double reachMs = AheadU / (LocalMotion.PlayerSpeed * mult) * 1000.0;
            return Math.Max(RepeatMs, Math.Min(LowRepeatMs, ReachShare * reachMs));
        }
    }
}
