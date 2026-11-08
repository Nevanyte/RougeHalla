using System.Collections.Generic;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Self-owned, presentation-only terrain study patch. This component never selects map terrain,
    /// creates colliders, or represents a hazard or healing rule.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class ShowcaseTerrainVignette : MonoBehaviour
    {
        const int MaxParticles = 16;
        const int BackdropOrder = 20;
        const int SurfaceOrder = 21;
        const int GlowOrder = 22;
        const int ParticleOrder = 23;
        const int MarkOrder = 25;
        const int BoundaryOrder = 30;

        readonly List<GameObject> _children = new List<GameObject>(12);
        ParticleSystem _particles;
        ParticleSystem.EmissionModule _emission;
        ShowcasePointLight _light;
        ShowcaseSettings _settings;
        Material _glowMaterial;
        Material _particleMaterial;
        Vector2 _worldSize;
        bool _configured;
        bool _optionalLight;

        /// <summary>Build or replace the preview patch. Invalid terrain values leave the root unconfigured.</summary>
        public void Configure(ShowcaseTerrainArt terrain, Vector2 worldSize, bool optionalLight = false)
        {
            ClearOwnedChildren();
            _configured = false;
            if ((uint)terrain > (uint)ShowcaseTerrainArt.Bog)
            {
                Debug.LogWarning("ShowcaseTerrainVignette ignored an unknown terrain art value.", this);
                return;
            }

            _worldSize = SanitizeSize(worldSize);
            _optionalLight = optionalLight;
            ShowcaseSprites.Initialize();

            Sprite surface = ShowcaseBiomeArt.Terrain(terrain, false);
            Sprite emissionMask = ShowcaseBiomeArt.Terrain(terrain, true);
            if (surface == null || emissionMask == null)
            {
                Debug.LogWarning("ShowcaseTerrainVignette has no authored surface for " + terrain + ".", this);
                return;
            }

            CreateSprite("Dark contrast backing", ShowcaseSprites.Get("bar"), BackdropOrder,
                new Color(.012f, .018f, .028f, 1f), Vector3.zero, _worldSize);

            Vector2 surfaceSize = _worldSize * .82f;
            CreateSprite("Visible stone beneath translucent terrain", ShowcaseBiomeArt.Floor(ShowcaseBiome.Neutral),
                BackdropOrder, Color.white, new Vector3(0,0,-.005f), surfaceSize, lit:true);
            CreateSprite("Terrain surface / " + terrain, surface, SurfaceOrder, Color.white,
                new Vector3(0, 0, -.01f), surfaceSize, lit: true);

            // Keep the colored terrain signal present at every quality. The mask alpha is authored
            // per terrain; HDR tint makes the visible parts respond to the project's Bloom volume.
            _glowMaterial = new Material(ShowcaseSprites.Unlit) { name = "Terrain vignette glow / " + terrain };
            if (_glowMaterial.HasProperty("_Color")) _glowMaterial.SetColor("_Color", GlowColor(terrain));
            else _glowMaterial.color = GlowColor(terrain);
            CreateSprite("Static terrain glow / " + terrain, emissionMask, GlowOrder,
                Color.white, new Vector3(0, 0, -.02f), surfaceSize, lit: false, material: _glowMaterial);

            CreateSprite("Soft reflected terrain radiance / " + terrain, ShowcaseSprites.Get("glow"), BackdropOrder - 1,
                new Color(1f,1f,1f,.19f), new Vector3(0,0,.01f), _worldSize * 1.42f,
                lit:false, material:_glowMaterial);
            CreateTerrainMark(terrain);
            CreateBoundary();
            CreateParticles(terrain);
            if (optionalLight) CreateOptionalLight(terrain);

            _configured = true;
            ApplySettings();
        }

        void OnEnable()
        {
            _settings = ShowcaseSettings.Current;
            if (_settings != null) _settings.Changed += ApplySettings;
            ApplySettings();
        }

        void OnDisable()
        {
            if (_settings != null) _settings.Changed -= ApplySettings;
            _settings = null;
            StopParticles();
            if (_light != null) _light.SetVisible(false);
        }

        void OnDestroy()
        {
            ClearOwnedChildren();
            DestroyOwned(ref _glowMaterial);
            DestroyOwned(ref _particleMaterial);
        }

        void ApplySettings()
        {
            if (!_configured || !isActiveAndEnabled) return;
            bool reducedMotion = _settings != null && _settings.ReducedMotion;
            ShowcaseQuality quality = _settings != null ? _settings.EffectiveQuality : ShowcaseQuality.High;
            int rate = quality == ShowcaseQuality.High ? 3 : quality == ShowcaseQuality.Medium ? 1 : 0;

            if (_particles != null)
            {
                if (reducedMotion || rate == 0) StopParticles();
                else
                {
                    _emission.rateOverTime = rate;
                    if (!_particles.isPlaying) _particles.Play(true);
                }
            }
            if (_light != null)
                _light.SetVisible(_optionalLight && !reducedMotion && quality == ShowcaseQuality.High);
        }

        SpriteRenderer CreateSprite(string objectName, Sprite sprite, int order, Color color,
            Vector3 localPosition, Vector2 size, bool lit = false, Material material = null)
        {
            var go = new GameObject(objectName);
            go.transform.SetParent(transform, false);
            go.transform.localPosition = localPosition;
            go.transform.localScale = new Vector3(size.x, size.y, 1f);
            _children.Add(go);

            var renderer = go.AddComponent<SpriteRenderer>();
            renderer.sprite = sprite;
            renderer.sharedMaterial = material != null ? material : (lit ? ShowcaseSprites.Lit : ShowcaseSprites.Unlit);
            renderer.color = color;
            renderer.sortingOrder = order;
            return renderer;
        }

        void CreateTerrainMark(ShowcaseTerrainArt terrain)
        {
            string sigil;
            Color mark;
            switch (terrain)
            {
                case ShowcaseTerrainArt.Lava: sigil = "sigil0"; mark = new Color(1f, .77f, .45f, 1f); break;
                case ShowcaseTerrainArt.HealingLight: sigil = "sigil4"; mark = new Color(1f, .91f, .66f, 1f); break;
                case ShowcaseTerrainArt.Ice: sigil = "sigil3"; mark = new Color(.78f, .97f, 1f, 1f); break;
                default: sigil = "sigil2"; mark = new Color(.82f, 1f, .66f, 1f); break;
            }
            float glyphSize = Mathf.Min(_worldSize.x, _worldSize.y) * .17f;
            Vector3 position = new Vector3(-_worldSize.x * .31f, -_worldSize.y * .31f, -.03f);
            CreateSprite("Terrain mark backing", ShowcaseSprites.Get("bar"), MarkOrder,
                new Color(.008f, .012f, .02f, .96f), position, Vector2.one * (glyphSize * 1.55f));
            CreateSprite("Terrain mark / " + terrain, ShowcaseSprites.Get(sigil), MarkOrder + 1,
                mark, position + new Vector3(0, 0, -.001f), Vector2.one * glyphSize);
        }

        void CreateBoundary()
        {
            float minDimension = Mathf.Min(_worldSize.x, _worldSize.y);
            float thickness = Mathf.Clamp(minDimension * .035f, .035f, .12f);
            Color edge = new Color(1f, .97f, .86f, 1f);
            CreateSprite("Boundary north", ShowcaseSprites.Get("bar"), BoundaryOrder, edge,
                new Vector3(0, _worldSize.y * .5f - thickness * .5f, -.04f), new Vector2(_worldSize.x, thickness));
            CreateSprite("Boundary south", ShowcaseSprites.Get("bar"), BoundaryOrder, edge,
                new Vector3(0, -_worldSize.y * .5f + thickness * .5f, -.04f), new Vector2(_worldSize.x, thickness));
            CreateSprite("Boundary east", ShowcaseSprites.Get("bar"), BoundaryOrder, edge,
                new Vector3(_worldSize.x * .5f - thickness * .5f, 0, -.04f), new Vector2(thickness, _worldSize.y));
            CreateSprite("Boundary west", ShowcaseSprites.Get("bar"), BoundaryOrder, edge,
                new Vector3(-_worldSize.x * .5f + thickness * .5f, 0, -.04f), new Vector2(thickness, _worldSize.y));
        }

        void CreateParticles(ShowcaseTerrainArt terrain)
        {
            var go = new GameObject("Decorative terrain motes / " + terrain);
            go.transform.SetParent(transform, false);
            go.transform.localPosition = new Vector3(0, 0, -.05f);
            _children.Add(go);

            _particles = go.AddComponent<ParticleSystem>();
            _particles.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = _particles.main;
            main.loop = true;
            main.playOnAwake = false;
            main.maxParticles = MaxParticles;
            main.simulationSpace = ParticleSystemSimulationSpace.Local;
            _particles.useAutoRandomSeed = false;
            _particles.randomSeed = (uint)(1001 + (int)terrain * 137);
            main.startLifetime = terrain == ShowcaseTerrainArt.Ice ? 2.8f : 1.8f;
            main.startSpeed = terrain == ShowcaseTerrainArt.Ice ? .035f : .12f;
            main.startSize = terrain == ShowcaseTerrainArt.Ice ? .055f : .045f;
            main.startColor = ParticleColor(terrain);

            var emission = _particles.emission;
            emission.enabled = true;
            emission.rateOverTime = 0f;
            _emission = emission;

            var shape = _particles.shape;
            shape.enabled = true;
            shape.shapeType = ParticleSystemShapeType.Box;
            shape.scale = new Vector3(_worldSize.x * .68f, _worldSize.y * .68f, .01f);

            var particleRenderer = go.GetComponent<ParticleSystemRenderer>();
            particleRenderer.renderMode = ParticleSystemRenderMode.Billboard;
            particleRenderer.sortingOrder = ParticleOrder;
            particleRenderer.alignment = ParticleSystemRenderSpace.View;
            _particleMaterial = new Material(ShowcaseSprites.Unlit) { name = "Terrain motes / " + terrain };
            _particleMaterial.mainTexture = ShowcaseSprites.Get("spark").texture;
            particleRenderer.sharedMaterial = _particleMaterial;
            _particles.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
        }

        void CreateOptionalLight(ShowcaseTerrainArt terrain)
        {
            _light = ShowcaseSprites.CreateLight(transform, "Optional terrain point light / " + terrain, Vector3.zero);
            Color color;
            switch (terrain)
            {
                case ShowcaseTerrainArt.Lava: color = new Color(1f, .34f, .09f, 1f); break;
                case ShowcaseTerrainArt.HealingLight: color = new Color(1f, .78f, .38f, 1f); break;
                case ShowcaseTerrainArt.Ice: color = new Color(.26f, .72f, 1f, 1f); break;
                default: color = new Color(.42f, .82f, .19f, 1f); break;
            }
            float radius = Mathf.Max(_worldSize.x, _worldSize.y) * .9f;
            _children.Add(_light.gameObject);
            _light.Configure(color, .85f, 0f, radius, .8f, false, highOnly: true);
            _light.SetVisible(false);
        }

        static Color GlowColor(ShowcaseTerrainArt terrain)
        {
            switch (terrain)
            {
                case ShowcaseTerrainArt.Lava: return new Color(5f, 1.05f, .18f, .9f);
                case ShowcaseTerrainArt.HealingLight: return new Color(3f, 2.2f, .65f, .8f);
                case ShowcaseTerrainArt.Ice: return new Color(.65f, 1.8f, 4.5f, .8f);
                default: return new Color(.62f, 1.55f, .26f, .56f);
            }
        }

        static Color ParticleColor(ShowcaseTerrainArt terrain)
        {
            switch (terrain)
            {
                case ShowcaseTerrainArt.Lava: return new Color(1f, .47f, .14f, .88f);
                case ShowcaseTerrainArt.HealingLight: return new Color(1f, .84f, .48f, .82f);
                case ShowcaseTerrainArt.Ice: return new Color(.68f, .94f, 1f, .85f);
                default: return new Color(.58f, .92f, .24f, .82f);
            }
        }

        void StopParticles()
        {
            if (_particles != null) _particles.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
        }

        void ClearOwnedChildren()
        {
            StopParticles();
            for (int i = _children.Count - 1; i >= 0; i--)
            {
                GameObject child = _children[i];
                if (child == null) continue;
                child.SetActive(false);
                if (Application.isPlaying) Destroy(child);
                else DestroyImmediate(child);
            }
            _children.Clear();
            _particles = null;
            _light = null;
            DestroyOwned(ref _glowMaterial);
            DestroyOwned(ref _particleMaterial);
        }

        static void DestroyOwned(ref Material material)
        {
            if (material == null) return;
            if (Application.isPlaying) Destroy(material);
            else DestroyImmediate(material);
            material = null;
        }

        static Vector2 SanitizeSize(Vector2 size)
        {
            if (float.IsNaN(size.x) || float.IsInfinity(size.x) || size.x <= 0f) size.x = 3f;
            if (float.IsNaN(size.y) || float.IsInfinity(size.y) || size.y <= 0f) size.y = 3f;
            size.x = Mathf.Clamp(size.x, .5f, 32f);
            size.y = Mathf.Clamp(size.y, .5f, 32f);
            return size;
        }
    }
}
