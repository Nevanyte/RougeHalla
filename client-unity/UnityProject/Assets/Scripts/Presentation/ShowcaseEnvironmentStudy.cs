using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>
    /// Staged, no-network art review for faction floors, actor silhouettes, terrain and elite glyphs.
    /// This component owns only preview children; it never creates match facts, collision or gameplay.
    /// </summary>
    public sealed class ShowcaseEnvironmentStudy : MonoBehaviour
    {
        static readonly FactionId[] Factions =
        {
            FactionId.Fire, FactionId.Sentenced, FactionId.Plague, FactionId.Frost, FactionId.Holy
        };
        static readonly ShowcaseBiome[] Biomes =
        {
            ShowcaseBiome.Fire, ShowcaseBiome.Sentenced, ShowcaseBiome.Plague, ShowcaseBiome.Frost, ShowcaseBiome.Holy
        };
        static readonly ShowcaseTerrainArt[] Terrain =
        {
            ShowcaseTerrainArt.Lava, ShowcaseTerrainArt.Bog, ShowcaseTerrainArt.Ice, ShowcaseTerrainArt.HealingLight
        };
        static readonly MobTypeId[] Elites =
        {
            MobTypeId.Wyrmling, MobTypeId.AshDrake, MobTypeId.Executioner, MobTypeId.Gaoler,
            MobTypeId.RatOgre, MobTypeId.PoxBehemoth, MobTypeId.GlacialWarden, MobTypeId.AvalancheTroll,
            MobTypeId.BloodSaint, MobTypeId.Archon
        };
        static readonly string[] FactionLabels = { "FIRE", "SENTENCED", "PLAGUE", "FROST", "HOLY" };
        static readonly float[] ColumnX = { -12f, -6f, 0f, 6f, 12f };
        const float ActorScreenY = 2.15f;
        const float FloorScreenY = 2.65f;
        const float ScreenWorldScale = ArenaView.Scale;
        const float GroundSquash = ArenaView.GroundSquash;

        readonly List<GameObject> _owned = new List<GameObject>(48);
        readonly List<ShowcaseTerrainVignette> _vignettes = new List<ShowcaseTerrainVignette>(4);
        SpriteActorPresenter _actors;
        ShowcaseCatalog _actorCatalog;
        float _nextSwingAt;
        int _nextSwingActor;
        bool _pauseSwingSamples;
        bool _initialized;

        public void Initialize(Camera camera, AssetReadinessCatalog stagedCatalog)
        {
            if (_initialized) ClearOwned();
            _initialized = false;
            if (camera == null || stagedCatalog == null)
            {
                Debug.LogError("Environment study needs a camera and staged asset catalog.", this);
                return;
            }

            ShowcaseSprites.Initialize();
            camera.orthographic = true;
            camera.orthographicSize = 9f;
            camera.transform.SetPositionAndRotation(new Vector3(0f, 0f, -30f), Quaternion.identity);
            camera.backgroundColor = new Color32(14, 19, 27, 255);

            var ambient = Own("Environment study global light").AddComponent<Light2D>();
            ambient.lightType = Light2D.LightType.Global;
            ambient.intensity = .95f;
            ambient.color = new Color(.85f, .9f, 1f);

            var volume = Own("Environment study atmosphere").AddComponent<Volume>();
            volume.isGlobal = true;
            volume.sharedProfile = Resources.Load<VolumeProfile>("Showcase/Atmosphere");

            CreateBackdrop();
            CreateFactionPlinths();
            CreateTerrainSamples();
            CreateEliteGlyphRow();
            CreateStudyLabels();

            // Adapt the staged appearance array to the already-used SpriteActorPresenter API.
            // This in-memory ScriptableObject is owned by this preview and is never saved as an asset.
            _actorCatalog = ScriptableObject.CreateInstance<ShowcaseCatalog>();
            _actorCatalog.name = "Environment study / transient actor catalog";
            _actorCatalog.hideFlags = HideFlags.DontSave;
            _actorCatalog.Actors = MergeActorAppearances(stagedCatalog);
            var actorRoot = Own("Staged faction actor presenters");
            _actors = new SpriteActorPresenter(actorRoot.transform, _actorCatalog);
            _nextSwingAt = Time.unscaledTime + 2.5f;
            _nextSwingActor = 0;
            _initialized = true;
            PresentActors();
        }

        void Update()
        {
            if (!_initialized) return;
            Keyboard keyboard = Keyboard.current;
            if (keyboard != null)
            {
                if (keyboard.spaceKey.wasPressedThisFrame)
                {
                    _pauseSwingSamples = !_pauseSwingSamples;
                    _actors.ResetTransientTimers();
                }
                if (keyboard.mKey.wasPressedThisFrame && ShowcaseSettings.Current != null)
                    ShowcaseSettings.Current.ToggleReducedMotion();
            }

            if (!_pauseSwingSamples &&
                (ShowcaseSettings.Current == null || !ShowcaseSettings.Current.ReducedMotion) &&
                Time.unscaledTime >= _nextSwingAt)
            {
                _actors.ConfirmedCue((uint)(1001 + _nextSwingActor), FxKind.Swing);
                _nextSwingActor = (_nextSwingActor + 1) % Factions.Length;
                _nextSwingAt = Time.unscaledTime + 3.8f;
            }
            PresentActors();
        }

        void PresentActors()
        {
            _actors.Begin();
            for (int i = 0; i < Factions.Length; i++)
            {
                float x = ColumnX[i] / ScreenWorldScale;
                float y = -ActorScreenY / (ScreenWorldScale * GroundSquash);
                WeaponId weapon = i == 2 || i == 4 ? WeaponId.Wand : WeaponId.Sword;
                _actors.Present((uint)(1001 + i), x, y, Mathf.PI / 4f, 100f, Factions[i],
                    ActorStatus.Alive, weapon, ActorKind.Player, null, 0, 0, false);
            }
            _actors.End();
        }

        void CreateBackdrop()
        {
            Sprite("Study backdrop", ShowcaseSprites.Get("bar"), Vector3.zero,
                new Vector2(34f, 18f), ShowcasePalette.Background, -100);
            Sprite("Plinth section rule", ShowcaseSprites.Get("bar"), new Vector3(0f, .25f),
                new Vector2(30f, .025f), new Color(.24f, .29f, .35f, 1f), -90);
            Sprite("Terrain section rule", ShowcaseSprites.Get("bar"), new Vector3(0f, -2.25f),
                new Vector2(24f, .025f), new Color(.24f, .29f, .35f, 1f), -90);
        }

        void CreateFactionPlinths()
        {
            for (int i = 0; i < Factions.Length; i++)
            {
                float x = ColumnX[i];
                Sprite("Faction floor / " + Biomes[i], ShowcaseBiomeArt.Floor(Biomes[i], i % 3),
                    new Vector3(x, FloorScreenY, .06f), new Vector2(5.4f, 4.4f * GroundSquash), Color.white, -30, ShowcaseSprites.Lit);
                Sprite("Plinth frame / " + FactionLabels[i], ShowcaseSprites.Get("bar"),
                    new Vector3(x, FloorScreenY, .04f), new Vector2(5.52f, .12f), ShowcasePalette.Faction(i), -29);
                Sprite("Actor footing / " + FactionLabels[i], ShowcaseSprites.Get("shadow"),
                    new Vector3(x, ActorScreenY - .55f, .02f), new Vector2(2.1f, .55f), Color.white, 100);
                WorldLabel("Faction / " + FactionLabels[i], FactionLabels[i] + "  ·  AUTHORED SE IDLE", x, 5.22f,
                    5.3f, .45f, .25f, ShowcasePalette.Faction(i), 110);
            }
        }

        void CreateTerrainSamples()
        {
            float[] x = { -9f, -3f, 3f, 9f };
            for (int i = 0; i < Terrain.Length; i++)
            {
                var go = Own("Terrain vignette / " + Terrain[i]);
                go.transform.localPosition = new Vector3(x[i], -4.65f, 0f);
                var vignette = go.AddComponent<ShowcaseTerrainVignette>();
                vignette.Configure(Terrain[i], new Vector2(4.8f, 2.7f * GroundSquash), optionalLight: i == 0 || i == 3);
                _vignettes.Add(vignette);
                WorldLabel("Terrain label / " + Terrain[i], TerrainLabel(Terrain[i]), x[i], -6.35f,
                    4.8f, .42f, .24f, TerrainColor(Terrain[i]), 130);
            }
        }

        void CreateEliteGlyphRow()
        {
            float left = -10.8f;
            for (int i = 0; i < Elites.Length; i++)
            {
                float x = left + i * 2.4f;
                var badge = ShowcaseIdentityAssets.GetBadgeBackdrop();
                Sprite("Elite badge backing / " + Elites[i], badge, new Vector3(x, 7.35f, 0f),
                    new Vector2(.82f, .82f), Color.white, 140);
                Sprite("Elite glyph / " + Elites[i], ShowcaseIdentityAssets.GetEliteGlyph(Elites[i]),
                    new Vector3(x, 7.35f, -.01f), new Vector2(.61f, .61f), Color.white, 141);
                WorldLabel("Elite label / " + Elites[i], Elites[i].ToString(), x, 6.72f,
                    2.25f, .32f, .16f, ShowcasePalette.MutedText, 142);
            }
        }

        void CreateStudyLabels()
        {
            WorldLabel("Study title", "ENVIRONMENT + FACTION ART REVIEW  /  STAGED ONLY  /  NO LIVE MATCH",
                0f, 8.25f, 30f, .42f, .26f, ShowcasePalette.Gold, 200);
            WorldLabel("Study subtitle", "Original faction floors · 8-direction Flare actors · lava / bog / ice / healing-light render samples",
                0f, .02f, 28f, .38f, .21f, ShowcasePalette.Text, 200);
            WorldLabel("Study controls", "SPACE pauses new attack samples     M toggles existing reduced-motion setting",
                0f, -8.35f, 28f, .36f, .20f, ShowcasePalette.MutedText, 200);
        }

        GameObject Own(string name)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            _owned.Add(go);
            return go;
        }

        SpriteRenderer Sprite(string name, Sprite sprite, Vector3 position, Vector2 size,
            Color color, int sortingOrder, Material material = null)
        {
            var go = Own(name);
            go.transform.localPosition = position;
            go.transform.localScale = new Vector3(size.x, size.y, 1f);
            var renderer = go.AddComponent<SpriteRenderer>();
            renderer.sprite = sprite;
            renderer.sharedMaterial = material != null ? material : ShowcaseSprites.Unlit;
            renderer.color = color;
            renderer.sortingOrder = sortingOrder;
            return renderer;
        }

        void WorldLabel(string objectName, string value, float x, float y, float width, float height,
            float fontSize, Color color, int sortingOrder)
        {
            var go = Own(objectName);
            go.transform.localPosition = new Vector3(x, y, -1f);
            var text = go.AddComponent<TextMeshPro>();
            text.font = TMP_Settings.defaultFontAsset;
            text.text = value;
            text.fontSize = fontSize * 10f;
            text.color = color;
            text.alignment = TextAlignmentOptions.Center;
            text.enableWordWrapping = false;
            text.rectTransform.sizeDelta = new Vector2(width, height);
            text.GetComponent<MeshRenderer>().sortingOrder = sortingOrder;
        }

        static string TerrainLabel(ShowcaseTerrainArt terrain)
        {
            switch (terrain)
            {
                case ShowcaseTerrainArt.Lava: return "LAVA  /  EMISSION + WARM LIGHT";
                case ShowcaseTerrainArt.Bog: return "BOG  /  SURFACE + MOTES";
                case ShowcaseTerrainArt.Ice: return "ICE  /  TRANSLUCENCY + COLD LIGHT";
                default: return "HEALING LIGHT  /  TRANSLUCENCY + GOLD";
            }
        }

        static ShowcaseCatalog.Appearance[] MergeActorAppearances(AssetReadinessCatalog stagedCatalog)
        {
            var merged = new List<ShowcaseCatalog.Appearance>();
            if (stagedCatalog.Actors != null) merged.AddRange(stagedCatalog.Actors);
            // The staged expansion carries mage bodies; the original showcase catalog carries
            // hero and hero-female bodies used by the other three faction appearance mappings.
            ShowcaseCatalog baseline = Resources.Load<ShowcaseCatalog>("Showcase/Catalog");
            if (baseline != null && baseline.Actors != null)
            {
                for (int i = 0; i < baseline.Actors.Length; i++)
                {
                    ShowcaseCatalog.Appearance appearance = baseline.Actors[i];
                    if (appearance == null) continue;
                    bool alreadyPresent = false;
                    for (int j = 0; j < merged.Count; j++)
                    {
                        if (merged[j] != null && merged[j].Key == appearance.Key)
                        { alreadyPresent = true; break; }
                    }
                    if (!alreadyPresent) merged.Add(appearance);
                }
            }
            return merged.ToArray();
        }

        static Color TerrainColor(ShowcaseTerrainArt terrain)
        {
            switch (terrain)
            {
                case ShowcaseTerrainArt.Lava: return new Color(1f, .55f, .28f);
                case ShowcaseTerrainArt.Bog: return new Color(.74f, .9f, .44f);
                case ShowcaseTerrainArt.Ice: return new Color(.63f, .88f, 1f);
                default: return new Color(1f, .88f, .55f);
            }
        }

        void OnDestroy() { ClearOwned(); }

        void ClearOwned()
        {
            _actors = null;
            _vignettes.Clear();
            for (int i = _owned.Count - 1; i >= 0; i--)
            {
                GameObject go = _owned[i];
                if (go != null) Destroy(go);
            }
            _owned.Clear();
            if (_actorCatalog != null)
            {
                Destroy(_actorCatalog);
                _actorCatalog = null;
            }
            _initialized = false;
        }
    }
}
