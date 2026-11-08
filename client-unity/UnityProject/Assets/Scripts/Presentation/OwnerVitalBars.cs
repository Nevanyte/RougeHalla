using System;
using Roguehalla.Net;

namespace Roguehalla.Client
{
    /// <summary>Presentation geometry for the delivered owner HP and barrier values.</summary>
    public static class OwnerVitalBars
    {
        /// <summary>Returns normalized percentages without changing or inferring any gameplay vital.</summary>
        public static void Percent(SelfView me, out float healthPercent, out float barrierPercent)
        {
            healthPercent = 0f;
            barrierPercent = 0f;
            if (me == null || !Finite(me.Hp) || !Finite(me.MaxHp) || !Finite(me.Barrier)) return;

            double hp = me.Hp > 0f ? me.Hp : 0d;
            double barrier = me.Barrier > 0f ? me.Barrier : 0d;
            double denominator = Math.Max((double)me.MaxHp, hp + barrier);
            if (!(denominator > 0d) || double.IsInfinity(denominator) || double.IsNaN(denominator)) return;

            healthPercent = (float)(100d * hp / denominator);
            barrierPercent = (float)(100d * barrier / denominator);
        }

        static bool Finite(float value) { return !float.IsNaN(value) && !float.IsInfinity(value); }
    }
}
