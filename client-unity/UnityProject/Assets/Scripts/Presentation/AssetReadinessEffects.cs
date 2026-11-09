using System.Collections.Generic;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Original procedural faction VFX for the isolated asset-readiness preview. These marks are presentation only;
    /// a server-fed actor must supply its faction and visibility before a caller creates this vignette.
    /// </summary>
    public static class AssetReadinessEffects
    {
        const int FactionCount = 5;
        const int MaxParticles = 32;
        const int RingOrder = 10;
        const int ParticleOrder = 11;
        const int GlyphOrder = 12;

        static readonly string[] GlyphKeys = { "sigil0", "rune", "sigil2", "sigil3", "sigil4" };
        static readonly string[] ParticleKeys = { "spark", "rune", "sigil2", "spark", "spark" };
        static readonly Dictionary<string, Material> ParticleMaterials = new Dictionary<string, Material>();

        /// <summary>
        /// Creates a preview-only, looping faction vignette. Position is local to parent. Exactly one bounded
        /// ParticleSystem is added (max 32 particles); the ring and non-hue glyph remain visible without particles.
        /// </summary>
        public static GameObject Create(Transform parent, Vector3 position, int faction)
        {
            int id = Mathf.Clamp(faction, 0, FactionCount - 1);
            Color tint = ShowcasePalette.Faction(id);
            var root = new GameObject("Asset readiness / " + ShowcasePalette.GetFactionName(id));
            if (parent != null) root.transform.SetParent(parent, false);
            root.transform.localPosition = position;

            AddSprite(root.transform, "Essential ring", "ring", new Color32(235, 229, 211, 235),
                new Vector3(1.72f, 1.72f, 1), Vector3.zero, RingOrder);
            AddGlyph(root.transform, id, tint);
            AddFactionDetails(root.transform, id, tint);
            CreateParticles(root.transform, id, tint);
            return root;
        }

        /// <summary>Stops and clears decorative particles while preserving the ring and non-hue faction glyph.</summary>
        public static void SetReducedMotion(GameObject vignette, bool reducedMotion)
        {
            if (vignette == null) return;
            var motion = vignette.GetComponent<AssetReadinessEffectMotion>();
            if (motion == null) motion = vignette.AddComponent<AssetReadinessEffectMotion>();
            motion.SetReducedMotion(reducedMotion);
        }

        static void AddGlyph(Transform parent, int faction, Color tint)
        {
            // The base glyph is white so faction identity is not carried by hue alone. The colored underlay is a secondary cue.
            AddSprite(parent, "Faction glyph / color", GlyphKeys[faction], tint,
                new Vector3(.88f, .88f, 1), new Vector3(0, 0, -.01f), GlyphOrder - 1);
            AddSprite(parent, "Faction glyph / readable", GlyphKeys[faction], ShowcasePalette.Text,
                new Vector3(.68f, .68f, 1), new Vector3(0, 0, -.02f), GlyphOrder);
        }

        static void AddFactionDetails(Transform parent, int faction, Color tint)
        {
            switch (faction)
            {
                case 0: // Fire: ember arc and a pointed flame mark.
                    AddSprite(parent, "Ember arc", "spark", tint, new Vector3(.46f, .2f, 1), new Vector3(0, .68f, -.03f), GlyphOrder - 1);
                    break;
                case 1: // Sentenced: linked, narrow loops make the chain motif legible at still-frame scale.
                    for (int i = 0; i < 3; i++)
                    {
                        float y = -.42f + i * .42f;
                        AddSprite(parent, "Chain link " + i, "ring", ShowcasePalette.Text,
                            new Vector3(.17f, .31f, 1), new Vector3(.54f, y, -.03f), GlyphOrder);
                    }
                    AddSprite(parent, "Judgment rune", "rune", tint,
                        new Vector3(.35f, .35f, 1), new Vector3(-.55f, .52f, -.03f), GlyphOrder - 1);
                    break;
                case 2: // Plague: the three lobes echo the three-lobed glyph.
                    for (int i = 0; i < 3; i++)
                    {
                        float a = (i * 120f + 30f) * Mathf.Deg2Rad;
                        AddSprite(parent, "Toxic lobe " + i, "sigil2", ShowcasePalette.Text,
                            new Vector3(.24f, .24f, 1), new Vector3(Mathf.Cos(a) * .57f, Mathf.Sin(a) * .57f, -.03f), GlyphOrder);
                    }
                    break;
                case 3: // Frost: six discrete crystal points are a non-color sixfold cue.
                    for (int i = 0; i < 6; i++)
                    {
                        float a = i * 60f * Mathf.Deg2Rad;
                        var shard = AddSprite(parent, "Frost shard " + i, "spark", ShowcasePalette.Text,
                            new Vector3(.2f, .36f, 1), new Vector3(Mathf.Cos(a) * .68f, Mathf.Sin(a) * .68f, -.03f), GlyphOrder);
                        shard.transform.localEulerAngles = new Vector3(0, 0, -i * 60f);
                    }
                    break;
                case 4: // Holy: an unmistakable halo with eight static rays.
                    AddSprite(parent, "Holy halo", "ring", ShowcasePalette.Text,
                        new Vector3(1.18f, 1.18f, 1), Vector3.zero, GlyphOrder - 1);
                    for (int i = 0; i < 8; i++)
                    {
                        float a = i * 45f * Mathf.Deg2Rad;
                        var ray = AddSprite(parent, "Radiant ray " + i, "spark", tint,
                            new Vector3(.14f, .38f, 1), new Vector3(Mathf.Cos(a) * .72f, Mathf.Sin(a) * .72f, -.03f), GlyphOrder - 1);
                        ray.transform.localEulerAngles = new Vector3(0, 0, -i * 45f);
                    }
                    break;
            }
        }

        static void CreateParticles(Transform parent, int faction, Color tint)
        {
            var go = new GameObject("Decorative particles");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();
            var main = system.main;
            main.loop = true;
            main.playOnAwake = false;
            main.maxParticles = MaxParticles;
            main.simulationSpace = ParticleSystemSimulationSpace.Local;
            main.cullingMode = ParticleSystemCullingMode.PauseAndCatchup;
            main.startLifetime = new ParticleSystem.MinMaxCurve(1.1f, 1.8f);
            main.startSpeed = new ParticleSystem.MinMaxCurve(.05f, .24f);
            main.startSize = new ParticleSystem.MinMaxCurve(.07f, .15f);
            main.startColor = new ParticleSystem.MinMaxGradient(tint, new Color(tint.r, tint.g, tint.b, .55f));
            main.gravityModifier = 0;

            var emission = system.emission;
            emission.rateOverTime = faction == 2 ? 5f : 4f;
            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Circle;
            shape.radius = faction == 0 ? .72f : .88f;
            shape.arc = faction == 0 ? 105f : 360f;
            shape.rotation = new Vector3(0, 0, faction == 0 ? 215f : 0f);

            var rotation = system.rotationOverLifetime;
            rotation.enabled = true;
            rotation.z = new ParticleSystem.MinMaxCurve(-80f * Mathf.Deg2Rad, 80f * Mathf.Deg2Rad);

            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Billboard;
            renderer.sortingOrder = ParticleOrder;
            renderer.sharedMaterial = ParticleMaterial(ParticleKeys[faction]);

            var motion = parent.gameObject.AddComponent<AssetReadinessEffectMotion>();
            motion.Initialize(system);
            motion.SetReducedMotion(false);
        }

        static SpriteRenderer AddSprite(Transform parent, string name, string spriteKey, Color color, Vector3 scale, Vector3 position, int order)
        {
            var renderer = ShowcaseSprites.Create(parent, name, spriteKey, order, color, new Vector2(scale.x, scale.y), position, false);
            renderer.transform.localScale = scale;
            return renderer;
        }

        static Material ParticleMaterial(string spriteKey)
        {
            if (ParticleMaterials.TryGetValue(spriteKey, out var cached)) return cached;
            ShowcaseSprites.Initialize();
            var material = new Material(ShowcaseSprites.Unlit)
            {
                name = "Roguehalla / particle / " + spriteKey,
                hideFlags = HideFlags.HideAndDontSave
            };
            material.mainTexture = ShowcaseSprites.Get(spriteKey).texture;
            ParticleMaterials.Add(spriteKey, material);
            return material;
        }

        /// <summary>Called when the single isolated workshop is destroyed; no live presentation uses this cache.</summary>
        public static void ReleasePreviewMaterials()
        {
            foreach (var material in ParticleMaterials.Values)
                if (material != null)
                {
                    if (Application.isPlaying) Object.Destroy(material);
                    else Object.DestroyImmediate(material);
                }
            ParticleMaterials.Clear();
        }
    }

    /// <summary>Small owner for decorative motion controls. No per-frame work is performed.</summary>
    public sealed class AssetReadinessEffectMotion : MonoBehaviour
    {
        ParticleSystem _system;
        bool _reducedMotion;

        internal void Initialize(ParticleSystem system)
        {
            _system = system;
        }

        public void SetReducedMotion(bool reducedMotion)
        {
            _reducedMotion = reducedMotion;
            if (_system == null) _system = GetComponentInChildren<ParticleSystem>();
            if (_system == null) return;
            if (reducedMotion) _system.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            else if (isActiveAndEnabled && gameObject.activeInHierarchy) _system.Play(true);
        }

        void OnEnable()
        {
            if (!_reducedMotion && _system != null) _system.Play(true);
        }

        void OnDisable()
        {
            if (_system != null) _system.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
        }
    }
}
