using System;

namespace Roguehalla.Net
{
    /// <summary>Loudness and stereo placement of a footstep for a listener at the local player (pure).</summary>
    public static class FootstepVoicing
    {
        /// <summary>Beyond this many tiles from the local player a step is not played at all.</summary>
        public const float RadiusTiles = 13f;
        public const float LocalGain = 0.30f, PlayerGain = 0.19f, MobGain = 0.11f;
        public const float MinGain = 0.01f;
        public const float MaxPan = 0.8f;

        /// <summary>
        /// Gain 0..1 and stereo pan -1..1 for a step. <paramref name="screenX"/> is the actor's horizontal position on screen in
        /// -1 (left edge) to 1 (right edge). Returns false when it would be inaudible.
        /// </summary>
        public static bool Plan(bool local, bool mob, float distanceTiles, float screenX, out float gain, out float pan)
        {
            gain = 0f; pan = 0f;
            if (local) { gain = LocalGain; return true; }
            if (!(distanceTiles >= 0f) || distanceTiles >= RadiusTiles) return false;
            float t = 1f - distanceTiles / RadiusTiles;
            gain = (mob ? MobGain : PlayerGain) * t * t;
            if (gain < MinGain) return false;
            pan = Math.Max(-MaxPan, Math.Min(MaxPan, screenX * MaxPan));
            return true;
        }
    }

    /// <summary>
    /// A small fixed set of sound voices with priority to the nearest source: a new request takes a free voice, otherwise it steals the
    /// voice of the farthest (quietest) step if the request is nearer, otherwise it is dropped. The local player (distance 0) always wins.
    /// </summary>
    public sealed class VoicePicker
    {
        public const int DefaultVoices = 6;
        readonly float[] _end, _dist;
        public int Count { get { return _end.Length; } }
        public VoicePicker(int voices = DefaultVoices) { _end = new float[voices]; _dist = new float[voices]; for (int i = 0; i < voices; i++) _end[i] = -1f; }

        /// <summary>Returns the voice index to use, or -1 when the request loses to every playing voice.</summary>
        public int Acquire(float now, float distance, float duration)
        {
            int free = -1, farthest = -1; float farD = -1f;
            for (int i = 0; i < _end.Length; i++)
            {
                if (_end[i] <= now) { free = i; break; }
                if (_dist[i] > farD) { farD = _dist[i]; farthest = i; }
            }
            int pick = free >= 0 ? free : (distance < farD ? farthest : -1);
            if (pick < 0) return -1;
            _end[pick] = now + duration; _dist[pick] = distance;
            return pick;
        }
        public int Active(float now) { int n = 0; for (int i = 0; i < _end.Length; i++) if (_end[i] > now) n++; return n; }
        public void Clear() { for (int i = 0; i < _end.Length; i++) _end[i] = -1f; }
    }

    /// <summary>
    /// Procedural footstep clips: filtered noise bursts shaped per surface, deterministic per (sound, variant). Used because no CC0 source
    /// could be fetched and verified in this environment; it is original code, so there is no third-party licence.
    /// </summary>
    public static class FootstepSynth
    {
        public const int SampleRate = 22050;
        public const int Variants = 4;

        struct Rng { uint s; public Rng(uint seed) { s = seed * 2654435761u + 0x9E3779B9u; if (s == 0) s = 1; } public float Next() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s & 0xFFFFFF) / (float)0x1000000; } public float Signed() { return Next() * 2f - 1f; } }

        /// <summary>Renders one clip (mono, -1..1). Length 0.12 to 0.4 s. Never returns null; None gives silence of 1 sample.</summary>
        public static float[] Render(StepSound sound, int variant)
        {
            if (sound == StepSound.None) return new float[1];
            var r = new Rng((uint)((int)sound * 131 + variant * 17 + 7));
            float v = variant % Variants;
            float[] b;
            switch (sound)
            {
                case StepSound.Snow: b = Snow(ref r, v); break;
                case StepSound.Sand: b = Noise(ref r, .17f, .03f, .09f, 2200f + v * 250f, 350f, .55f); break;
                case StepSound.Grass: b = Noise(ref r, .15f, .045f, .07f, 4800f + v * 300f, 1800f, .38f); break;
                case StepSound.Mud: b = Mud(ref r, v, false); break;
                case StepSound.Bog: b = Mud(ref r, v, true); break;
                case StepSound.Water: b = Splash(ref r, v); break;
                case StepSound.Stone: b = Tap(ref r, v, 950f, .045f, false, 0f); break;
                case StepSound.Temple: b = Tap(ref r, v, 780f, .09f, true, 0f); break;
                case StepSound.Gritty: b = Gritty(ref r, v); break;
                default: b = Tap(ref r, v, 1500f, .05f, false, 2300f); break;   // Ice: hard tap plus a short high squeak
            }
            Normalise(b, .8f);
            return b;
        }

        public static float Duration(StepSound sound) { var b = Render(sound, 0); return b.Length / (float)SampleRate; }

        static float[] Alloc(float seconds) { return new float[(int)(seconds * SampleRate)]; }
        static float Env(float t, float attack, float decay) { return (t < attack ? t / attack : 1f) * (float)Math.Exp(-Math.Max(0f, t - attack) / decay); }

        // one-pole filters
        static float Lp(ref float st, float x, float hz) { float a = 1f - (float)Math.Exp(-2 * Math.PI * hz / SampleRate); st += a * (x - st); return st; }
        static float Bp(ref float lo, ref float hi, float x, float low, float high) { float l = Lp(ref lo, x, high); return l - Lp(ref hi, l, low); }

        static float[] Noise(ref Rng r, float len, float attack, float decay, float high, float low, float gain)
        {
            var b = Alloc(len); float lo = 0, hi = 0;
            for (int i = 0; i < b.Length; i++) { float t = i / (float)SampleRate; b[i] = Bp(ref lo, ref hi, r.Signed(), low, high) * Env(t, attack, decay) * gain; }
            return b;
        }

        static float[] Snow(ref Rng r, float v)
        {
            var b = Alloc(.2f); float lo = 0, hi = 0; int grains = 7 + (int)v;
            for (int g = 0; g < grains; g++)
            {
                int at = (int)((r.Next() * .09f) * SampleRate); int len = (int)((.004f + r.Next() * .008f) * SampleRate); float amp = .5f + r.Next() * .5f;
                for (int i = 0; i < len && at + i < b.Length; i++) b[at + i] += r.Signed() * amp * (1f - i / (float)len);
            }
            for (int i = 0; i < b.Length; i++) { float t = i / (float)SampleRate; b[i] = Bp(ref lo, ref hi, b[i], 1400f, 5200f) * Env(t, .002f, .07f) * 2.4f; }
            float th = 0; for (int i = 0; i < b.Length; i++) { float t = i / (float)SampleRate; b[i] += Lp(ref th, r.Signed(), 220f) * Env(t, .004f, .04f) * .5f; }
            return b;
        }

        static float[] Gritty(ref Rng r, float v)
        {
            var b = Alloc(.17f); float lo = 0, hi = 0; int grains = 9 + (int)v;
            for (int g = 0; g < grains; g++)
            {
                int at = (int)((r.Next() * .07f) * SampleRate); int len = (int)((.002f + r.Next() * .006f) * SampleRate); float amp = .4f + r.Next() * .6f;
                for (int i = 0; i < len && at + i < b.Length; i++) b[at + i] += r.Signed() * amp * (1f - i / (float)len);
            }
            for (int i = 0; i < b.Length; i++) { float t = i / (float)SampleRate; b[i] = Bp(ref lo, ref hi, b[i], 500f, 3000f) * Env(t, .002f, .055f) * 2.2f; }
            return b;
        }

        static float[] Mud(ref Rng r, float v, bool bog)
        {
            var b = Alloc(bog ? .38f : .26f); float lo = 0, ph = 0, bub = 0;
            float f0 = (bog ? 110f : 190f) + v * 14f, f1 = bog ? 48f : 85f;
            float cut = bog ? 380f : 700f;
            for (int i = 0; i < b.Length; i++)
            {
                float t = i / (float)SampleRate; float k = Math.Min(1f, t / (bog ? .26f : .16f));
                float f = f0 + (f1 - f0) * k; ph += (float)(2 * Math.PI * f / SampleRate);
                float body = (float)Math.Sin(ph) * Env(t, .006f, bog ? .13f : .07f) * .9f;
                float slosh = Lp(ref lo, r.Signed(), cut) * Env(t, bog ? .05f : .02f, bog ? .12f : .06f) * 1.6f;
                float bt = (bog ? .14f : .09f) + v * .01f; float bubble = t > bt ? (float)Math.Sin(2 * Math.PI * (320f + 900f * (t - bt)) * (t - bt)) * Env(t - bt, .002f, .025f) * .35f : 0f;
                b[i] = body + slosh + bubble; bub += 0;
            }
            return b;
        }

        static float[] Splash(ref Rng r, float v)
        {
            var b = Alloc(.34f); float lo = 0, hi = 0;
            for (int i = 0; i < b.Length; i++) { float t = i / (float)SampleRate; b[i] = Bp(ref lo, ref hi, r.Signed(), 900f, 6500f) * Env(t, .004f, .09f) * 1.2f; }
            for (int d = 0; d < 3; d++)
            {
                float start = .03f + d * .045f + r.Next() * .03f, f0 = 700f + r.Next() * 600f + v * 60f;
                for (int i = (int)(start * SampleRate); i < b.Length; i++)
                {
                    float t = i / (float)SampleRate - start; if (t > .08f) break;
                    b[i] += (float)Math.Sin(2 * Math.PI * (f0 + 2600f * t) * t) * Env(t, .002f, .018f) * .3f;
                }
            }
            return b;
        }

        static float[] Tap(ref Rng r, float v, float freq, float decay, bool resonant, float squeak)
        {
            float len = resonant ? .38f : .16f; var b = Alloc(len); float lo = 0;
            float f = freq * (1f + (v - 1.5f) * .04f); float ph = 0;
            for (int i = 0; i < b.Length; i++)
            {
                float t = i / (float)SampleRate; ph += (float)(2 * Math.PI * f / SampleRate);
                float click = Lp(ref lo, r.Signed(), 5000f) * Env(t, .0005f, .004f) * 1.4f;
                float ring = ((float)Math.Sin(ph) + .4f * (float)Math.Sin(ph * 2.31f)) * Env(t, .001f, decay) * .55f;
                float thump = (float)Math.Sin(2 * Math.PI * 130f * t) * Env(t, .001f, .03f) * .5f;
                b[i] = click + ring + thump;
            }
            if (squeak > 0f)
                for (int i = (int)(.02f * SampleRate); i < (int)(.07f * SampleRate) && i < b.Length; i++)
                { float t = i / (float)SampleRate - .02f; b[i] += (float)Math.Sin(2 * Math.PI * (squeak + 600f * t) * t) * Env(t, .004f, .02f) * .22f; }
            if (resonant)
            {   // a little tail of the hall: two decaying echoes
                int d1 = (int)(.031f * SampleRate), d2 = (int)(.057f * SampleRate);
                for (int i = b.Length - 1; i >= d1; i--) b[i] += b[i - d1] * .38f + (i >= d2 ? b[i - d2] * .22f : 0f);
            }
            return b;
        }

        static void Normalise(float[] b, float peak)
        {
            float m = 1e-6f; for (int i = 0; i < b.Length; i++) m = Math.Max(m, Math.Abs(b[i]));
            float g = peak / m; for (int i = 0; i < b.Length; i++) b[i] *= g;
            int fade = Math.Min(b.Length, 64); for (int i = 0; i < fade; i++) b[b.Length - 1 - i] *= i / (float)fade;   // no click at the end
        }
    }
}
