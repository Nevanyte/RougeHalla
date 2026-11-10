using System;

namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// Pure rules of the world indicators built in the third UI pass, each cited to its legacy source. No engine types; Unity only draws
    /// what these return. Every input is a delivered public fact.
    /// </summary>
    public static class WorldIndicatorRules
    {
        // ---- hurt vignette: screenFeedback.ts:14 (decay) -------------------------------------------------------------------
        public const float VignetteDecayMs = 350f;
        /// <summary>The vignette's strength now: <paramref name="strength"/> at the hit, falling linearly to 0 after 350 ms.</summary>
        public static float VignetteDecayed(float strength, float elapsedMs)
        {
            if (!(strength > 0f)) return 0f;
            return Math.Max(0f, strength * (1f - Math.Max(0f, elapsedMs) / VignetteDecayMs));
        }
        /// <summary>One decaying pulse; overlapping hits keep the stronger of what is left and what just landed (DamagePulse).</summary>
        public struct Pulse
        {
            float _strength, _at;
            public float Value(float nowMs) { return VignetteDecayed(_strength, nowMs - _at); }
            public void Hit(float strength, float nowMs) { _strength = Math.Max(Value(nowMs), Math.Min(1f, strength)); _at = nowMs; }
        }

        // ---- reward chest ring and seconds: ContainerView.ts:30-68,153 ----------------------------------------------------
        public const float ChestSeconds = 15f, ChestRange = 96f, UrgentSeconds = 5f, DropCueMs = 450f, FadeOutSeconds = .5f, TimerTextReach = 2f;
        public const int RingSteps = 60; // CHEST_SECONDS * 4: a quarter second each
        /// <summary>The ring's drain as a step count (0..60) for <paramref name="left"/> seconds.</summary>
        public static int RingStep(float left, float life = ChestSeconds)
        {
            if (!(life > 0f)) return 0;
            return Math.Max(0, Math.Min(RingSteps, (int)Math.Ceiling(left / life * RingSteps)));
        }
        public static bool Urgent(float left) { return left <= UrgentSeconds; }
        /// <summary>The chest fades out over its last half second, so it is gone before the server removes it.</summary>
        public static float RewardAlpha(float left) { return left >= FadeOutSeconds ? 1f : Math.Max(0f, left / FadeOutSeconds); }
        /// <summary>The seconds-left text, e.g. "12s"; null when it is not shown (not near, or time is up).</summary>
        public static string SecondsText(float left, bool near)
        {
            if (!near || !(left > 0f)) return null;
            return ((int)Math.Ceiling(left)).ToString(System.Globalization.CultureInfo.InvariantCulture) + "s";
        }
        public static bool Near(float dx, float dy) { float r = ChestRange * TimerTextReach; return dx * dx + dy * dy <= r * r; }
        /// <summary>The expanding drop cue: 0..1 progress while younger than 450 ms, else -1.</summary>
        public static float DropCue(float ageMs) { return ageMs >= 0f && ageMs < DropCueMs ? ageMs / DropCueMs : -1f; }

        // ---- death X decal: FxView.ts:84-92,687 ----------------------------------------------------------------------------
        public const float DecalMs = 2000f, DecalHold = .25f, DecalHalfWidth = 14f;
        /// <summary>Opacity of a death X <paramref name="ageMs"/> after the death: fully opaque for the first quarter of its life, then fading out.</summary>
        public static float DecalAlpha(float ageMs)
        {
            if (ageMs < 0f || ageMs >= DecalMs) return 0f;
            float t = ageMs / DecalMs;
            return t <= DecalHold ? 1f : 1f - (t - DecalHold) / (1f - DecalHold);
        }

        // ---- container labels: ContainerView.ts:111-113,200 -----------------------------------------------------------------
        public static readonly string[] WeaponNames = { "Sword", "Bow", "Wand", "Shield", "Axe", "Fists" };
        /// <summary>
        /// The name above a container: bodies always show who they were, everything else only when it is the interaction target (focused).
        /// Null means no label. Kind codes follow PropAppearance (1 ground weapon, 2 chest, 3 body, 4 plague corpse, 6 cannon).
        /// </summary>
        public static string ContainerLabel(byte kind, bool focused, int weapon, string bodyLabel, string corpseLabel, bool reloading, int reloadSeconds)
        {
            switch (kind)
            {
                case 3: return string.IsNullOrEmpty(bodyLabel) ? "Body" : bodyLabel;
                case 4: return focused ? (string.IsNullOrEmpty(corpseLabel) ? "Corpse" : corpseLabel) : null;
                case 2: return focused ? "Chest" : null;
                case 1: return focused ? (weapon >= 0 && weapon < WeaponNames.Length ? WeaponNames[weapon] : "Weapon") : null;
                case 6: return focused ? (reloading ? "Cannon · reloading " + reloadSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture) + "s" : "Travel cannon · F to blast") : null;
                default: return null;
            }
        }

        // ---- champion HUD multipliers (OwnerCombat, in milli) ---------------------------------------------------------------
        /// <summary>"x1.25" for a multiplier delivered in milli (1000 = x1.00); "x1.00" for a value that is not a number.</summary>
        public static string Multiplier(double milli)
        {
            if (double.IsNaN(milli) || double.IsInfinity(milli)) milli = 1000d;
            return "x" + (milli / 1000d).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture);
        }
    }
}
