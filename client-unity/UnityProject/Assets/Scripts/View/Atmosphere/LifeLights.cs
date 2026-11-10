using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Small living lights inside the camera view: fireflies wandering over the Plague marsh (switch <c>fx.fireflies</c>) and embers that rise off
    /// the lava and light the rock around them (<c>fx.emberlight</c>). A fixed pool of CPU-simulated motes; each writes one entry into
    /// <see cref="LocalLightField"/> and draws one tiny HDR glow sprite. Purely decorative and random: they are never derived from, and never
    /// say anything about, actors or hidden state. No allocation per frame.
    /// </summary>
    public sealed class LifeLights : System.IDisposable
    {
        public const int Cap = 14, MaxFireflies = 9, MaxEmbers = 6;
        sealed class Mote { public bool Live, Ember; public float X, Y, Z, Age, Life, Phase, Seed; public SpriteRenderer Sprite; }
        readonly Mote[] _m = new Mote[Cap];
        Transform _root; uint _rng = 99991u;

        public int Live { get { int n = 0; foreach (var m in _m) if (m != null && m.Live) n++; return n; } }
        public int LiveFireflies { get { int n = 0; foreach (var m in _m) if (m != null && m.Live && !m.Ember) n++; return n; } }
        public int LiveEmbers { get { int n = 0; foreach (var m in _m) if (m != null && m.Live && m.Ember) n++; return n; } }
        /// <summary>Glow sprites currently drawn (zero when both switches are off).</summary>
        public int DrawnSprites { get { int n = 0; foreach (var m in _m) if (m != null && m.Sprite != null && m.Sprite.enabled) n++; return n; } }

        public void Initialize(Transform parent)
        {
            _root = new GameObject("Living lights").transform; _root.SetParent(parent, false);
            for (int i = 0; i < Cap; i++)
            {
                var sr = ShowcaseSprites.Create(_root, "Mote glow", "glow", 29970, Color.white, new Vector2(.3f, .3f), Vector3.zero, false);
                sr.enabled = false; _m[i] = new Mote { Sprite = sr };
            }
        }

        float Rand() { _rng = _rng * 1664525u + 1013904223u; return ((_rng >> 8) & 0xFFFF) / 65535f; }

        /// <param name="firefly">Plague weight under the camera (0..1); <paramref name="fire"/> the Fire weight.</param>
        public void Tick(float dt, float time, float camTx, float camTy, float halfW, float halfH, float firefly, float fire, AccentLightPlanner planner)
        {
            float density = Mathf.Min(1f, Quality.Particles);
            bool ffOn = AtmosphereQuality.Fireflies && firefly > .15f && density > 0f, emOn = AtmosphereQuality.EmberLight && fire > .15f && density > 0f && planner != null;
            int wantFf = ffOn ? Mathf.RoundToInt(MaxFireflies * firefly * density) : 0, wantEm = emOn ? Mathf.RoundToInt(MaxEmbers * fire * density) : 0;
            int nFf = 0, nEm = 0;
            foreach (var m in _m) if (m.Live) { if (m.Ember) nEm++; else nFf++; }
            if (nFf < wantFf) Spawn(false, camTx, camTy, halfW, halfH, planner);
            if (nEm < wantEm) Spawn(true, camTx, camTy, halfW, halfH, planner);
            bool analytic = AtmosphereQuality.AnalyticLights;
            for (int i = 0; i < Cap; i++)
            {
                var m = _m[i];
                if (!m.Live) { if (m.Sprite.enabled) m.Sprite.enabled = false; continue; }
                m.Age += dt;
                bool wanted = m.Ember ? emOn : ffOn;
                bool outside = Mathf.Abs(m.X - camTx) > halfW + 3f || Mathf.Abs(m.Y - camTy) > halfH + 3f;
                if (m.Age >= m.Life || outside || (!wanted && m.Age < m.Life - .8f)) { if (m.Age < m.Life - .8f) m.Life = m.Age + .8f; if (m.Age >= m.Life || outside) { m.Live = false; m.Sprite.enabled = false; continue; } }
                float fadeIn = Mathf.Clamp01(m.Age / .7f), fadeOut = Mathf.Clamp01((m.Life - m.Age) / .8f), fade = fadeIn * fadeOut;
                float bright, radius, k; Color col; float size;
                if (m.Ember)
                {
                    float u = m.Age / m.Life;
                    m.Z = .25f + 2.6f * u; m.X += (.22f + .25f * Mathf.PerlinNoise(time * .6f + m.Phase, 3.1f)) * dt; m.Y += (Mathf.PerlinNoise(m.Phase, time * .5f) - .5f) * .3f * dt;
                    bright = (.75f + .25f * Mathf.Sin(time * 11f + m.Phase * 5f)) * (1f - .55f * u);
                    radius = 1.9f; k = 1.15f * bright * fade; col = new Color(1f, .5f, .17f); size = .22f * (1f - .4f * u);
                }
                else
                {
                    float a = (Mathf.PerlinNoise(time * .28f + m.Phase, m.Phase * .71f) - .5f) * 12.57f;
                    m.X += Mathf.Cos(a) * .5f * dt; m.Y += Mathf.Sin(a) * .35f * dt; m.Z = .55f + .3f * Mathf.Sin(time * .9f + m.Phase * 3f);
                    float s = .5f + .5f * Mathf.Sin(time * (1.1f + (m.Seed % 1f) * .8f) + m.Phase * 6f); bright = .2f + .8f * s * s * s;
                    radius = 1.7f; k = .95f * bright * fade; col = new Color(.78f, 1f, .36f); size = .16f + .1f * bright;
                }
                if (analytic && k > .02f) LocalLightField.Add(m.X, m.Y, m.Z, radius, col.r * k, col.g * k, col.b * k);
                var world = ArenaView.WorldPoint(m.X * 32f, m.Y * 32f) + new Vector3(0, m.Z, 0);
                m.Sprite.enabled = true; m.Sprite.transform.position = world; m.Sprite.transform.localScale = new Vector3(size * 2f, size * 2f, 1f);
                m.Sprite.color = new Color(col.r * 2.2f, col.g * 2.2f, col.b * 2.2f, Mathf.Clamp01(bright * fade));
            }
        }

        void Spawn(bool ember, float camTx, float camTy, float halfW, float halfH, AccentLightPlanner planner)
        {
            Mote slot = null; foreach (var m in _m) if (!m.Live) { slot = m; break; }
            if (slot == null) return;
            float x, y;
            if (ember)
            {
                // a random lava site in view (reservoir pick over the planner's clusters, only on the frame a spawn happens)
                int seen = 0; x = y = float.NaN;
                var cl = planner.Clusters;
                for (int i = 0; i < cl.Count; i++)
                {
                    var c = cl[i]; if (c.Kind != TerrainKind.Lava) continue;
                    if (Mathf.Abs(c.X - camTx) > halfW || Mathf.Abs(c.Y - camTy) > halfH) continue;
                    seen++; if (Rand() * seen < 1f) { x = c.X + (Rand() - .5f) * 3.5f; y = c.Y + (Rand() - .5f) * 3.5f; }
                }
                if (float.IsNaN(x)) return;
            }
            else { x = camTx + (Rand() * 2f - 1f) * halfW; y = camTy + (Rand() * 2f - 1f) * halfH; }
            slot.Live = true; slot.Ember = ember; slot.X = x; slot.Y = y; slot.Age = 0f; slot.Phase = Rand() * 40f; slot.Seed = Rand() * 10f;
            slot.Life = ember ? 2.4f + Rand() * 1.6f : 9f + Rand() * 7f; slot.Z = ember ? .25f : .6f;
        }

        public void Clear() { foreach (var m in _m) if (m != null) { m.Live = false; if (m.Sprite != null) m.Sprite.enabled = false; } }
        public void Dispose() { if (_root != null) { if (Application.isPlaying) Object.Destroy(_root.gameObject); else Object.DestroyImmediate(_root.gameObject); } }
    }
}
