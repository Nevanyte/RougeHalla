namespace Roguehalla.Net
{
    /// <summary>
    /// Cosmetic own-attack feedback at the click (competitive netcode plan, Wave 2; owner-approved amendment of ADR 0008's
    /// "do not predict attacks" to animation-only feedback). PRESENTATION ONLY: this decides when the local player's own swing,
    /// draw or cast clip starts, is adopted or is cut short. It never decides a hit, damage, projectile, cooldown or outcome, and it
    /// never gates or changes what is sent to the server: the Attack command goes out on every press whatever this says.
    ///
    /// <para><b>Start</b> (<see cref="TryStart"/>): only on a press the server already says it will act on at once: in play, alive,
    /// no stun or cast effect bit, and the server-sent weapon readiness (<see cref="SelfView.ReadyInMs"/> on the newest snapshot)
    /// falls no later than the press's estimated arrival at the server plus <see cref="ReadyMarginMs"/>. Otherwise nothing starts
    /// and the existing server-driven cue is all the player sees.</para>
    /// <para><b>Adopt</b> (<see cref="Update"/>): the server starting an attack moves the weapon's ready time forward by its
    /// interval. A snapshot newer than the press with a ready time past the press-time one by more than a tick confirms it. A
    /// melee press is also confirmed by the server's own Swing Fx. Once confirmed the clip simply keeps playing.</para>
    /// <para><b>Cancel</b>: while unconfirmed, the clip is cut when the newest server state shows the action cannot happen (dead,
    /// stunned, casting, out of play, weapon changed) or when no confirmation arrived within RTT + 2 ticks (capped at
    /// <see cref="HardCapMs"/>).</para>
    /// <para><b>No double swing</b> (<see cref="AbsorbServerSwing"/>): melee hits land after a windup, so the server's Swing Fx for
    /// this press arrives later. The first own Swing Fx after a started, uncancelled melee press (within
    /// <see cref="AbsorbWindowMs"/>) does not replay the clip; any later one does, exactly as before.</para>
    /// All times are local milliseconds from one monotonic clock, except the server ms values named as such.
    /// </summary>
    public sealed class OwnAttackCue
    {
        public const double TickMs = 50;
        /// <summary>A press that reaches the server at most this long before readiness is buffered and starts on readiness.</summary>
        public const double ReadyMarginMs = TickMs;
        /// <summary>The newest ready time must pass the press-time one by more than this to count as a new attack.</summary>
        public const double ConfirmJumpMs = TickMs;
        public const double ConfirmSlackMs = 2 * TickMs;
        public const double HardCapMs = 500;
        public const double AbsorbWindowMs = 1500;
        /// <summary>Public effect bits (rh-sim status_runtime rules): stun = 1, casting = 4096. Either blocks an attack start.</summary>
        public const ushort StunBit = 1, CastingBit = 4096;
        const byte PlayingPhase = 1;

        enum Stage : byte { Idle, Pending, Adopted }
        Stage _stage;
        double _pressAt, _pressServerMs, _pressReadyAt, _rttMs;
        WeaponId _weapon;
        bool _absorb;

        /// <summary>A provisional clip is playing and the server has not confirmed it yet.</summary>
        public bool Pending => _stage == Stage.Pending;
        /// <summary>The server confirmed the last provisional clip.</summary>
        public bool Adopted => _stage == Stage.Adopted;

        public void Reset() { _stage = Stage.Idle; _absorb = false; }

        static bool Blocked(SelfView me, byte phase)
        {
            return me == null || phase != PlayingPhase || me.Status != ActorStatus.Alive || (me.Effects & (StunBit | CastingBit)) != 0;
        }

        static bool Melee(WeaponId w) { return w != WeaponId.Bow && w != WeaponId.Wand; }

        /// <summary>
        /// Called on an attack press, after the Attack command was queued. True = start the own attack clip now (provisional).
        /// <paramref name="latestServerMs"/> is the newest snapshot's server time (the one <paramref name="me"/> came from);
        /// <paramref name="serverNowMs"/> and <paramref name="rttMs"/> come from the ping clock and are used only when
        /// <paramref name="haveClock"/>.
        /// </summary>
        public bool TryStart(double nowMs, SelfView me, byte phase, double latestServerMs, bool haveClock, double serverNowMs, double rttMs)
        {
            if (_stage == Stage.Pending || !haveClock || Blocked(me, phase) || !(rttMs >= 0)) return false;
            double readyAt = latestServerMs + me.ReadyInMs;
            double arrival = serverNowMs + rttMs / 2;
            if (!(arrival + ReadyMarginMs >= readyAt)) return false;
            _stage = Stage.Pending; _pressAt = nowMs; _pressServerMs = latestServerMs; _pressReadyAt = readyAt;
            _rttMs = rttMs; _weapon = me.Weapon; _absorb = Melee(me.Weapon);
            return true;
        }

        /// <summary>Once per frame after Poll. True = cut the provisional own attack clip now.</summary>
        public bool Update(double nowMs, SelfView me, byte phase, double latestServerMs)
        {
            if (_absorb && nowMs - _pressAt > AbsorbWindowMs) _absorb = false;
            if (_stage != Stage.Pending) return false;
            if (me != null && latestServerMs > _pressServerMs && me.ReadyInMs > 0 &&
                latestServerMs + me.ReadyInMs > _pressReadyAt + ConfirmJumpMs)
            {
                _stage = Stage.Adopted;
                return false;
            }
            double bound = _rttMs + ConfirmSlackMs; if (bound > HardCapMs) bound = HardCapMs;
            if (Blocked(me, phase) || me.Weapon != _weapon || nowMs - _pressAt > bound)
            {
                _stage = Stage.Idle; _absorb = false;
                return true;
            }
            return false;
        }

        /// <summary>
        /// Called for each Swing Fx whose subject is the local player. True = the clip is already playing for this press: do not
        /// restart it (confirmed server effects other than the clip still show).
        /// </summary>
        public bool AbsorbServerSwing(double nowMs)
        {
            if (!_absorb || _stage == Stage.Idle || nowMs - _pressAt > AbsorbWindowMs) return false;
            _absorb = false;
            if (_stage == Stage.Pending) _stage = Stage.Adopted;
            return true;
        }
    }
}
