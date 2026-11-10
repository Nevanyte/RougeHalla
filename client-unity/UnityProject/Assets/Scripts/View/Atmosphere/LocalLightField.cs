using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Every light the region shaders evaluate analytically (RhLocalLights.hlsl), gathered once per frame into two fixed arrays:
    /// terrain accents and lanterns (AccentLights), short flashes (Wish casts, impacts, hits) and small living lights (fireflies, embers).
    /// Positions are tile space (x right, y down); heights and radii are in tiles. No allocation: the arrays and the flash ring are fixed.
    /// Presentation only: a light exists only because the client drew the thing that emits it.
    /// </summary>
    public static class LocalLightField
    {
        public const int Max = 24, MaxFlashes = 16;
        public const int CookieNone = 0, CookieGrate = 1, CookieDapple = 2, CookieGlass = 3;
        struct FlashLight { public float X, Y, H, Radius, Age, Life; public Vector3 Rgb; public bool Live; }

        static readonly Vector4[] P = new Vector4[Max], C = new Vector4[Max];
        static readonly FlashLight[] Flashes = new FlashLight[MaxFlashes];
        const int MaxStaged = 16;
        static readonly Vector4[] StagedP = new Vector4[MaxStaged], StagedC = new Vector4[MaxStaged];
        static int _staged;
        static int _count, _limit = Max;
        static int _idP = Shader.PropertyToID("_RhLP"), _idC = Shader.PropertyToID("_RhLC"), _idI = Shader.PropertyToID("_RhLI"), _idG = Shader.PropertyToID("_RhLG");

        /// <summary>Lights written this frame (what the shaders loop over).</summary>
        public static int Count { get { return _count; } }
        public static int LiveFlashes { get { int n = 0; for (int i = 0; i < MaxFlashes; i++) if (Flashes[i].Live) n++; return n; } }
        public static Vector4 PositionAt(int i) { return P[i]; }
        public static Vector4 ColorAt(int i) { return C[i]; }

        /// <summary>Start a frame with room for <paramref name="limit"/> lights (the quality cap).</summary>
        public static void Begin(int limit) { _count = 0; _limit = Mathf.Clamp(limit, 0, Max); }

        /// <summary>Add one light. Returns false when the cap is reached (callers add the most important lights first).</summary>
        public static bool Add(float tx, float ty, float height, float radius, float r, float g, float b, int cookie = CookieNone, bool shadow = false)
        {
            if (_count >= _limit || radius <= .01f) return false;
            P[_count] = new Vector4(tx, ty, height, radius);
            C[_count] = new Vector4(r, g, b, cookie + (shadow ? .5f : 0f));
            _count++; return true;
        }

        /// <summary>A short bright flash that lights its surroundings (a cast, an impact, a hit). Oldest is replaced when the ring is full.</summary>
        public static void Flash(float tx, float ty, float height, float radius, Color color, float peak, float life)
        {
            int slot = -1; float oldest = -1f;
            for (int i = 0; i < MaxFlashes; i++)
            {
                if (!Flashes[i].Live) { slot = i; break; }
                float frac = Flashes[i].Age / Mathf.Max(Flashes[i].Life, .01f);
                if (frac > oldest) { oldest = frac; slot = i; }
            }
            Flashes[slot] = new FlashLight { X = tx, Y = ty, H = height, Radius = radius, Age = 0f, Life = Mathf.Max(life, .05f), Rgb = new Vector3(color.r, color.g, color.b) * peak, Live = true };
        }

        /// <summary>
        /// A light for exactly the next composition (call every frame while the emitter exists: a Wish area, a projectile). Staged lights are merged by
        /// <see cref="AddFlashes"/> and cleared; past <see cref="MaxStaged"/> in one frame the extra are dropped.
        /// </summary>
        public static void Stage(float tx, float ty, float height, float radius, float r, float g, float b)
        {
            if (_staged >= MaxStaged || radius <= .01f) return;
            StagedP[_staged] = new Vector4(tx, ty, height, radius); StagedC[_staged] = new Vector4(r, g, b, 0f); _staged++;
        }
        public static void StageWorld(Vector3 world, float height, float radius, Color color, float intensity)
        {
            Stage(world.x, -world.y / ArenaView.GroundSquash, height, radius, color.r * intensity, color.g * intensity, color.b * intensity);
        }
        public static int Staged { get { return _staged; } }

        /// <summary>Convenience: a flash at a Unity world position.</summary>
        public static void FlashWorld(Vector3 world, float height, float radius, Color color, float peak, float life)
        {
            Flash(world.x, -world.y / ArenaView.GroundSquash, height, radius, color, peak, life);
        }

        /// <summary>Ages the flashes by dt and adds the live ones (call right after <see cref="Begin"/>, so short bright lights win the cap).</summary>
        public static void AddFlashes(float dt)
        {
            for (int i = 0; i < _staged; i++) Add(StagedP[i].x, StagedP[i].y, StagedP[i].z, StagedP[i].w, StagedC[i].x, StagedC[i].y, StagedC[i].z);
            _staged = 0;
            for (int i = 0; i < MaxFlashes; i++)
            {
                if (!Flashes[i].Live) continue;
                Flashes[i].Age += dt;
                if (Flashes[i].Age >= Flashes[i].Life) { Flashes[i].Live = false; continue; }
                float k = 1f - Flashes[i].Age / Flashes[i].Life; k *= k;
                var f = Flashes[i];
                Add(f.X, f.Y, f.H, f.Radius * (.7f + .3f * k), f.Rgb.x * k, f.Rgb.y * k, f.Rgb.z * k);
            }
        }

        /// <summary>Upload the arrays and the switches. Call once per frame after every source has added its lights.</summary>
        public static void Push(bool relief, bool shadows, bool cookies, bool gloss)
        {
            Shader.SetGlobalVectorArray(_idP, P); Shader.SetGlobalVectorArray(_idC, C);
            Shader.SetGlobalVector(_idI, new Vector4(_count, relief ? 1f : 0f, shadows ? 1f : 0f, cookies ? 1f : 0f));
            Shader.SetGlobalVector(_idG, new Vector4(gloss ? 1f : 0f, 0, 0, 0));
        }

        /// <summary>Switch the field off: no lights, no flashes (the legacy flat Light2D look on the ground is restored by AccentLights).</summary>
        public static void Clear()
        {
            _count = 0; _staged = 0; for (int i = 0; i < MaxFlashes; i++) Flashes[i].Live = false;
            Push(false, false, false, false);
        }
    }
}
