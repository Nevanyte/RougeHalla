using System.Collections.Generic;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Small generated soft-particle textures shared by every screen-particle layer (created once, no imported art).</summary>
    public static class AtmosphereTextures
    {
        static readonly Dictionary<string, Texture2D> Cache = new Dictionary<string, Texture2D>();
        public static float Gain(string key) { return key == "ember" ? 1.9f : key == "spore" ? 1.5f : 1f; }

        public static Texture2D Get(string key)
        {
            if (Cache.TryGetValue(key, out var t) && t != null) return t;
            int w = key == "shaft" ? 32 : 64, h = key == "shaft" ? 128 : 64;
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, false, false) { name = "Atmosphere / " + key, wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            var px = new Color32[w * h];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                float u = (x + .5f) / w * 2 - 1, v = (y + .5f) / h * 2 - 1, r = Mathf.Sqrt(u * u + v * v), a; Color rgb = Color.white;
                switch (key)
                {
                    case "flake":   // bright core with a cool blue-grey rim so a flake still reads on pale snow
                        a = Mathf.SmoothStep(1f, .45f, r) * .95f;
                        rgb = Color.Lerp(new Color(.55f, .72f, .93f), Color.white, Mathf.SmoothStep(.62f, .3f, r)); break;
                    case "mote": a = Mathf.Pow(Mathf.Clamp01(1f - r), 1.8f); break;
                    case "ember": a = Mathf.Exp(-r * r * 5.5f) * .7f + Mathf.Exp(-r * r * 40f) * .6f; break;
                    case "spore": a = Mathf.Exp(-r * r * 4f) * .45f + Mathf.Clamp01(1f - Mathf.Abs(r - .5f) * 7f) * .35f + Mathf.Exp(-r * r * 60f) * .6f; break;
                    case "chaff": { float e = Mathf.Sqrt(u * u + v * v * 9f); a = Mathf.SmoothStep(1f, .55f, e); break; }
                    case "shaft": a = Mathf.Pow(Mathf.Clamp01(1f - Mathf.Abs(u)), 1.7f) * Mathf.SmoothStep(1f, .55f, Mathf.Abs(v)); break;
                    default: a = Mathf.Clamp01(1f - r); break;
                }
                px[y * w + x] = new Color32((byte)(rgb.r * 255f), (byte)(rgb.g * 255f), (byte)(rgb.b * 255f), (byte)(Mathf.Clamp01(a) * 255f));
            }
            tex.SetPixelData(px, 0); tex.Apply(false, true);
            Cache[key] = tex; return tex;
        }

        public static void Release()
        {
            foreach (var t in Cache.Values) if (t != null) { if (Application.isPlaying) Object.Destroy(t); else Object.DestroyImmediate(t); }
            Cache.Clear();
        }
    }

    /// <summary>
    /// Camera-space ambient particle layers: two banks of up to four pooled ParticleSystems, one per layer, never created per frame.
    /// A region's preset fills the idle bank (prewarmed, alpha fading in over the blend time) while the previous bank fades out and
    /// is then stopped and cleared, so nothing pops at a border. Layers simulate in a custom space that follows the camera by a
    /// parallax factor. Alpha fades are material tints (a few shared materials per bank), so no per-frame garbage.
    /// </summary>
    public sealed class AtmosphereParticles
    {
        public const float FadeSeconds = 1.5f;
        sealed class Layer
        {
            public GameObject Go; public Transform Anchor; public ParticleSystem Ps; public ParticleSystemRenderer Renderer;
            public ParticleLayerSpec Spec; public bool InUse; public float WindBase; public bool Gust;
        }
        sealed class Bank
        {
            public readonly Layer[] Layers = new Layer[ParticlePresets.MaxLayers];
            public readonly Dictionary<string, Material> Materials = new Dictionary<string, Material>();
            public ParticlePresetId Preset; public float Alpha, Target; public bool Active; public float AppliedAlpha = -1f;
        }

        readonly Bank[] _banks = { new Bank(), new Bank() };
        readonly List<Object> _owned = new List<Object>();
        Transform _root; int _active = -1; ParticlePresetId _desired = ParticlePresetId.None;
        float _density = 1f, _gustClock, _camHalfW = 13f, _camHalfH = 9f;

        public ParticlePresetId Desired { get { return _desired; } }
        public ParticlePresetId Playing { get { return _active >= 0 && _banks[_active].Active ? _banks[_active].Preset : ParticlePresetId.None; } }
        /// <summary>Live particles across all layers (diagnostics and tests).</summary>
        public int ParticleCount { get { int n = 0; foreach (var b in _banks) foreach (var l in b.Layers) if (l != null && l.InUse && l.Ps != null) n += l.Ps.particleCount; return n; } }

        public void Initialize(Transform parent)
        {
            _root = new GameObject("Screen particles").transform; _root.SetParent(parent, false);
            for (int b = 0; b < 2; b++) for (int i = 0; i < ParticlePresets.MaxLayers; i++) _banks[b].Layers[i] = MakeLayer(b, i);
        }

        Layer MakeLayer(int bank, int index)
        {
            var l = new Layer();
            l.Go = new GameObject("Layer " + bank + "." + index); l.Go.transform.SetParent(_root, false);
            var a = new GameObject("Parallax anchor"); a.transform.SetParent(_root, false); l.Anchor = a.transform;
            l.Ps = l.Go.AddComponent<ParticleSystem>();
            var main = l.Ps.main; main.playOnAwake = false; main.loop = true; main.simulationSpace = ParticleSystemSimulationSpace.Custom; main.customSimulationSpace = l.Anchor;
            l.Ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            l.Renderer = l.Go.GetComponent<ParticleSystemRenderer>();
            l.Renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; l.Renderer.receiveShadows = false;
            l.Renderer.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off; l.Renderer.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;
            l.Go.SetActive(false);
            return l;
        }

        Material BankMaterial(Bank bank, string key)
        {
            if (bank.Materials.TryGetValue(key, out var m)) return m;
            m = new Material(ShowcaseSprites.Unlit) { name = "Atmosphere particles / " + key, mainTexture = AtmosphereTextures.Get(key) };
            bank.Materials[key] = m; _owned.Add(m); return m;
        }

        static Gradient MakeFade(in ParticleLayerSpec s)
        {
            var g = new Gradient();
            if (s.Twinkle <= 0f)
            {
                g.SetKeys(new[] { new GradientColorKey(Color.white, 0f), new GradientColorKey(Color.white, 1f) },
                          new[] { new GradientAlphaKey(0f, 0f), new GradientAlphaKey(1f, .14f), new GradientAlphaKey(1f, .72f), new GradientAlphaKey(0f, 1f) });
                return g;
            }
            int pulses = Mathf.Clamp(Mathf.RoundToInt(s.Twinkle * 2f), 2, 4) ;  // up to 4 interior keys (8 alpha keys max)
            var keys = new GradientAlphaKey[pulses + 2];
            keys[0] = new GradientAlphaKey(0f, 0f);
            for (int i = 0; i < pulses; i++) keys[i + 1] = new GradientAlphaKey(i % 2 == 0 ? 1f : .22f, .12f + (.76f * i) / Mathf.Max(1, pulses - 1));
            keys[pulses + 1] = new GradientAlphaKey(0f, 1f);
            g.SetKeys(new[] { new GradientColorKey(Color.white, 0f), new GradientColorKey(Color.white, 1f) }, keys);
            return g;
        }

        void Configure(Bank bank, Layer l, in ParticleLayerSpec s, int order)
        {
            l.Spec = s; l.InUse = true; l.Go.SetActive(true);
            var main = l.Ps.main;
            main.duration = 5f; main.loop = true; main.playOnAwake = false;
            main.startLifetime = new ParticleSystem.MinMaxCurve(s.LifeMin, s.LifeMax);
            main.startSpeed = 0f;
            if (s.StretchY > 1f)
            {
                main.startSize3D = true;
                main.startSizeX = new ParticleSystem.MinMaxCurve(s.SizeMin, s.SizeMax);
                main.startSizeY = new ParticleSystem.MinMaxCurve(s.SizeMin * s.StretchY, s.SizeMax * s.StretchY);
                main.startSizeZ = 1f;
            }
            else { main.startSize3D = false; main.startSize = new ParticleSystem.MinMaxCurve(s.SizeMin, s.SizeMax); }
            if (Mathf.Abs(s.Rotation) > .01f) { main.startRotation3D = false; main.startRotation = s.Rotation * Mathf.Deg2Rad; }
            else main.startRotation = new ParticleSystem.MinMaxCurve(0f, 6.2832f);
            main.startColor = new Color(s.Tint.r, s.Tint.g, s.Tint.b, s.Tint.a);
            main.maxParticles = Mathf.Max(1, ParticlePresets.LayerBudget(s, _density));
            main.simulationSpace = ParticleSystemSimulationSpace.Custom; main.customSimulationSpace = l.Anchor;
            main.scalingMode = ParticleSystemScalingMode.Hierarchy;
            var em = l.Ps.emission; em.enabled = true; em.rateOverTime = s.Rate * Mathf.Min(_density, AtmosphereQuality.MaxParticleDensity);
            var sh = l.Ps.shape; sh.enabled = true; sh.shapeType = ParticleSystemShapeType.Box; sh.scale = new Vector3(_camHalfW * 2f + 4f, _camHalfH * 2f + 4f, .1f);
            var vel = l.Ps.velocityOverLifetime; vel.enabled = true; vel.space = ParticleSystemSimulationSpace.World;
            vel.x = s.Wind.x; vel.y = s.Wind.y; vel.z = 0f; l.WindBase = s.Wind.x; l.Gust = s.Gust > 0f;
            var noise = l.Ps.noise; noise.enabled = s.Noise > 0f;
            if (noise.enabled) { noise.strength = s.Noise; noise.frequency = s.NoiseFreq; noise.quality = ParticleSystemNoiseQuality.Low; noise.scrollSpeed = .15f; noise.damping = true; }
            var col = l.Ps.colorOverLifetime; col.enabled = true; col.color = MakeFade(s);
            var size = l.Ps.sizeOverLifetime; size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1f, new AnimationCurve(new Keyframe(0f, .7f), new Keyframe(.2f, 1f), new Keyframe(1f, .85f)));
            var rot = l.Ps.rotationOverLifetime; rot.enabled = s.Spin > 0f;
            if (rot.enabled) rot.z = new ParticleSystem.MinMaxCurve(-s.Spin * Mathf.Deg2Rad, s.Spin * Mathf.Deg2Rad);
            l.Renderer.renderMode = ParticleSystemRenderMode.Billboard;
            l.Renderer.sharedMaterial = BankMaterial(bank, s.Texture);
            l.Renderer.sortingOrder = (s.AboveActors ? ParticlePresets.AboveActorsOrder : ParticlePresets.BehindActorsOrder) + order;
        }

        static void ReleaseLayer(Layer l)
        {
            if (l == null || !l.InUse) return;
            l.Ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear); l.InUse = false; l.Go.SetActive(false);
        }

        void SetBankAlpha(Bank bank, float a)
        {
            if (Mathf.Abs(a - bank.AppliedAlpha) < .002f) return;
            bank.AppliedAlpha = a;
            foreach (var kv in bank.Materials)
            { float g = AtmosphereTextures.Gain(kv.Key); kv.Value.color = new Color(g, g, g, a); }
        }

        /// <summary>Ask for a region's preset. <paramref name="instant"/> skips the fade-in (first fix after joining).</summary>
        public void SetPreset(ParticlePresetId id, bool instant = false)
        {
            _desired = id; Rebuild(instant);
        }

        /// <summary>Re-read the density switchboard (quality change, reduced motion).</summary>
        public void RefreshQuality()
        {
            _density = AtmosphereQuality.ParticleDensity;
            Rebuild(false);
        }

        void Rebuild(bool instant)
        {
            var target = AtmosphereQuality.ParticlesEnabled ? _desired : ParticlePresetId.None;
            var current = _active >= 0 && _banks[_active].Active ? _banks[_active].Preset : ParticlePresetId.None;
            if (target == current && _active >= 0 && _banks[_active].Active)
            {   // same preset: only density may have changed
                var bank = _banks[_active]; var specs = ParticlePresets.Get(target); bank.Target = 1f;
                for (int i = 0; i < specs.Length; i++) if (bank.Layers[i].InUse) { var main = bank.Layers[i].Ps.main; main.maxParticles = Mathf.Max(1, ParticlePresets.LayerBudget(specs[i], _density)); var em = bank.Layers[i].Ps.emission; em.rateOverTime = specs[i].Rate * Mathf.Min(_density, AtmosphereQuality.MaxParticleDensity); }
                return;
            }
            if (target == ParticlePresetId.None && (_active < 0 || !_banks[_active].Active)) return;
            if (_active >= 0 && _banks[_active].Active) _banks[_active].Target = 0f;     // old bank fades out
            if (target == ParticlePresetId.None) return;
            int idle = _active == 0 ? 1 : 0;
            var nb = _banks[idle];
            for (int i = 0; i < ParticlePresets.MaxLayers; i++) ReleaseLayer(nb.Layers[i]);
            var layers = ParticlePresets.Get(target);
            float longest = 0f;
            for (int i = 0; i < layers.Length; i++) { Configure(nb, nb.Layers[i], layers[i], i); longest = Mathf.Max(longest, layers[i].LifeMax); }
            for (int i = 0; i < layers.Length; i++)
            {   // prewarm so the layer is already full as it fades in
                nb.Layers[i].Ps.Simulate(longest * .9f, false, true, true); nb.Layers[i].Ps.Play(false);
            }
            nb.Preset = target; nb.Active = true; nb.Target = 1f; nb.Alpha = instant ? 1f : 0f; nb.AppliedAlpha = -1f; SetBankAlpha(nb, nb.Alpha);
            _active = idle;
        }

        /// <summary>Per frame: follow the camera, advance fades, modulate wind gusts. No allocation.</summary>
        public void Tick(Camera cam, float dt)
        {
            if (_root == null || cam == null) return;
            if (cam.orthographic)
            {
                float hh = cam.orthographicSize, hw = hh * cam.aspect;
                if (Mathf.Abs(hh - _camHalfH) > .05f || Mathf.Abs(hw - _camHalfW) > .05f)
                {
                    _camHalfH = hh; _camHalfW = hw;
                    foreach (var b in _banks) foreach (var l in b.Layers) if (l != null && l.InUse) { var sh = l.Ps.shape; sh.scale = new Vector3(hw * 2f + 4f, hh * 2f + 4f, .1f); }
                }
            }
            Vector3 c = cam.transform.position; var cp = new Vector3(c.x, c.y, 0f);
            _gustClock += dt; bool gust = true;
            for (int bi = 0; bi < 2; bi++)
            {
                var bank = _banks[bi]; if (!bank.Active) continue;
                bank.Alpha = Mathf.MoveTowards(bank.Alpha, bank.Target, dt / FadeSeconds);
                SetBankAlpha(bank, bank.Alpha * bank.Alpha * (3f - 2f * bank.Alpha));
                for (int i = 0; i < bank.Layers.Length; i++)
                {
                    var l = bank.Layers[i]; if (!l.InUse) continue;
                    l.Go.transform.position = cp; l.Anchor.position = cp * l.Spec.Parallax;
                    if (gust && l.Gust)
                    {
                        float g = 1f + l.Spec.Gust * (.5f * Mathf.Sin(_gustClock * .23f + i) + .3f * Mathf.Sin(_gustClock * .61f + i * 2f));
                        var v = l.Ps.velocityOverLifetime; v.x = l.WindBase * g;
                    }
                }
                if (bank.Target <= 0f && bank.Alpha <= 0f)
                {
                    for (int i = 0; i < bank.Layers.Length; i++) ReleaseLayer(bank.Layers[i]);
                    bank.Active = false;
                }
            }
        }

        public void Dispose()
        {
            foreach (var o in _owned) if (o != null) { if (Application.isPlaying) Object.Destroy(o); else Object.DestroyImmediate(o); }
            _owned.Clear();
            if (_root != null) { if (Application.isPlaying) Object.Destroy(_root.gameObject); else Object.DestroyImmediate(_root.gameObject); }
            AtmosphereTextures.Release();
        }
    }
}
