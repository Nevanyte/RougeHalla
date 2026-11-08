using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Roguehalla.Client
{
    /// <summary>Isolated asset workshop. No session, input commands or game simulation.</summary>
    public sealed class AssetReadinessPreview : MonoBehaviour
    {
        readonly List<SpriteRenderer> _actors = new List<SpriteRenderer>();
        readonly List<ShowcaseCatalog.Appearance> _appearances = new List<ShowcaseCatalog.Appearance>();
        readonly List<GameObject> _effects = new List<GameObject>();
        TextMeshProUGUI _state;
        ShowcasePreviewAction _action = ShowcasePreviewAction.Walk;
        int _direction = 6;
        float _elapsed;
        bool _paused, _reduced;

        public void Initialize(Camera camera, AssetReadinessCatalog catalog)
        {
            ShowcaseSprites.Initialize();
            camera.orthographic = true;
            camera.orthographicSize = 9f;
            camera.transform.SetPositionAndRotation(new Vector3(0, 0, -30), Quaternion.identity);
            camera.backgroundColor = new Color32(14, 19, 27, 255);
            var light = new GameObject("Workshop global light").AddComponent<Light2D>();
            light.transform.SetParent(transform, false);
            light.lightType = Light2D.LightType.Global; light.intensity = .95f;
            light.color = new Color(.85f, .9f, 1f);
            var volume = new GameObject("Workshop atmosphere").AddComponent<Volume>();
            volume.transform.SetParent(transform, false); volume.isGlobal = true;
            volume.sharedProfile = Resources.Load<VolumeProfile>("Showcase/Atmosphere");

            Sprite("Backdrop", ShowcaseSprites.Get("bar"), new Vector3(0, -1, 0), new Vector3(34, 18, 1), ShowcasePalette.Background, -100);
            if (catalog == null) { Debug.LogError("Import Flare Expansion before opening the asset workshop."); return; }
            Sprite("Actor section divider", ShowcaseSprites.Get("bar"), new Vector3(0, .65f), new Vector3(30, .018f, 1), new Color(.25f, .29f, .34f), -90);
            Sprite("Environment section divider", ShowcaseSprites.Get("bar"), new Vector3(0, -3.3f), new Vector3(30, .018f, 1), new Color(.25f, .29f, .34f), -90);
            for (int i = 0; i < catalog.Actors.Length; i++)
            {
                var appearance = catalog.Actors[i];
                if (appearance == null) continue;
                float x = -12f + i * 4f;
                if (catalog.Environment.Length > 0)
                    Sprite("Cave floor podium", catalog.Environment[i % Mathf.Min(6, catalog.Environment.Length)], new Vector3(x, 2.25f), Vector3.one * 2.1f, Color.white, -21);
                Sprite("Contact shadow", ShowcaseSprites.Get("shadow"), new Vector3(x, 2.25f), new Vector3(2.1f, .5f, 1), Color.white, -20);
                Sprite("Podium rim", ShowcaseSprites.Get("ring"), new Vector3(x, 2.25f), new Vector3(2.6f, .8f, 1), new Color(.55f, .45f, .27f, .7f), -19);
                var actor = Sprite(appearance.Key, null, new Vector3(x, 2.25f), Vector3.one * (appearance.WorldHeight * 2.8f), Color.white, 10);
                _actors.Add(actor); _appearances.Add(appearance);
                WorldLabel(appearance.Key.Replace("mob-", "").Replace('-', ' ').ToUpperInvariant(), x, 1.45f, 3.8f, .55f, .28f, ShowcasePalette.Text);
            }
            string[] factions = { "FIRE / EMBER", "SENTENCED / RUNE", "PLAGUE / SPORE", "FROST / CRYSTAL", "HOLY / HALO" };
            for (int i = 0; i < 5; i++)
            {
                float x = -11.5f + i * 5.75f;
                _effects.Add(AssetReadinessEffects.Create(transform, new Vector3(x, -1.15f), i));
                WorldLabel(factions[i], x, -2.65f, 5.4f, .55f, .27f, ShowcasePalette.Faction(i));
            }
            int samples = Mathf.Min(12, catalog.Environment.Length);
            for (int i = 0; i < samples; i++)
            {
                int col = i % 6, row = i / 6;
                float x = -11.5f + col * 4.6f, y = -4.6f - row * 1.45f;
                var tile = catalog.Environment[i];
                if (tile == null) continue;
                // Samples fit individual review cells. This is not a world-scale or obstacle-footprint test.
                float scale = Mathf.Min(2.1f, 3.6f / tile.bounds.size.x, 1.05f / tile.bounds.size.y);
                Vector3 samplePosition = new Vector3(x - tile.bounds.center.x * scale, y - tile.bounds.min.y * scale);
                Sprite(catalog.EnvironmentKeys[i], tile, samplePosition, Vector3.one * scale, Color.white, 15 + row);
                WorldLabel(catalog.EnvironmentKeys[i], x, y - .48f, 4.2f, .4f, .21f, ShowcasePalette.MutedText);
            }
            CreateOverlay();
            RefreshState();
            Animate();
        }

        void Update()
        {
            var keys = Keyboard.current;
            if (keys != null)
            {
                if (keys.aKey.wasPressedThisFrame) { _action = (ShowcasePreviewAction)(((int)_action + 1) % ShowcaseAnimationPreview.ActionCount); _elapsed = 0; RefreshState(); }
                if (keys.dKey.wasPressedThisFrame) { _direction = (_direction + 1) % 8; RefreshState(); }
                if (keys.spaceKey.wasPressedThisFrame) { _paused = !_paused; RefreshState(); }
                if (keys.mKey.wasPressedThisFrame) SetReducedMotion(!_reduced);
            }
            if (!_paused && !_reduced) _elapsed += Time.unscaledDeltaTime;
            Animate();
        }

        public void SetReducedMotion(bool reduced)
        {
            _reduced = reduced;
            for (int i = 0; i < _effects.Count; i++) AssetReadinessEffects.SetReducedMotion(_effects[i], reduced);
            RefreshState();
        }

        public void SelectAction(ShowcasePreviewAction action, int direction)
        {
            _action = action; _direction = ((direction % 8) + 8) % 8; _elapsed = 0; RefreshState(); Animate();
        }

        void Animate()
        {
            for (int i = 0; i < _actors.Count; i++)
            {
                bool exists = ShowcaseAnimationPreview.TryFrame(_appearances[i], _action, _direction, _elapsed, _reduced, out Sprite frame);
                _actors[i].sprite = frame; _actors[i].enabled = exists;
            }
        }

        SpriteRenderer Sprite(string name, Sprite sprite, Vector3 position, Vector3 scale, Color color, int order)
        {
            var go = new GameObject(name); go.transform.SetParent(transform, false);
            go.transform.localPosition = position; go.transform.localScale = scale;
            var renderer = go.AddComponent<SpriteRenderer>(); renderer.sprite = sprite;
            renderer.sharedMaterial = ShowcaseSprites.Lit; renderer.color = color; renderer.sortingOrder = order;
            return renderer;
        }

        void WorldLabel(string label, float x, float y, float width, float height, float size, Color color)
        {
            var go = new GameObject("Label / " + label); go.transform.SetParent(transform, false);
            go.transform.localPosition = new Vector3(x, y, -1);
            var text = go.AddComponent<TextMeshPro>(); text.font = TMP_Settings.defaultFontAsset;
            text.text = label; text.fontSize = size * 10f; text.color = color;
            text.alignment = TextAlignmentOptions.Center; text.enableWordWrapping = false;
            text.rectTransform.sizeDelta = new Vector2(width, height);
            text.GetComponent<MeshRenderer>().sortingOrder = 100;
        }

        void CreateOverlay()
        {
            var canvasGo = new GameObject("Asset workshop labels", typeof(RectTransform), typeof(Canvas), typeof(UnityEngine.UI.CanvasScaler));
            canvasGo.transform.SetParent(transform, false);
            canvasGo.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasGo.GetComponent<UnityEngine.UI.CanvasScaler>();
            scaler.uiScaleMode = UnityEngine.UI.CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1600, 900); scaler.matchWidthOrHeight = .5f;
            Label(canvasGo.transform, "ROGUEHALLA  /  ASSET WORKSHOP", new Vector2(.035f, .89f), new Vector2(.8f, .98f), 34, ShowcasePalette.Gold);
            Label(canvasGo.transform, "STAGED PRESENTATION  ·  FREE FLARE ART + ORIGINAL UNITY EFFECTS  ·  NO LIVE MATCH", new Vector2(.035f, .855f), new Vector2(.97f, .905f), 15, ShowcasePalette.MutedText);
            _state = Label(canvasGo.transform, "", new Vector2(.035f, .795f), new Vector2(.97f, .85f), 17, Color.white);
            Label(canvasGo.transform, "A  animation    D  direction    SPACE  pause actors    M  reduced motion   /   8 directions · 8 clips · review before integration", new Vector2(.035f, .015f), new Vector2(.97f, .065f), 15, ShowcasePalette.Text);
        }

        static TextMeshProUGUI Label(Transform parent, string value, Vector2 min, Vector2 max, int size, Color color)
        {
            var go = new GameObject("Workshop label", typeof(RectTransform)); go.transform.SetParent(parent, false);
            var rect = (RectTransform)go.transform; rect.anchorMin = min; rect.anchorMax = max;
            rect.offsetMin = rect.offsetMax = Vector2.zero;
            var text = go.AddComponent<TextMeshProUGUI>(); text.font = TMP_Settings.defaultFontAsset;
            text.text = value; text.fontSize = size; text.color = color; text.raycastTarget = false;
            text.alignment = TextAlignmentOptions.MidlineLeft; text.enableWordWrapping = false;
            return text;
        }

        void RefreshState()
        {
            if (_state != null) _state.text = "7 NEW APPEARANCES  /  " + _action.ToString().ToUpperInvariant() + "  /  " + ShowcaseAnimationPreview.DirectionName(_direction) +
                (_paused ? "  /  ACTORS PAUSED" : "") + (_reduced ? "  /  REDUCED MOTION" : "  /  PARTICLES ON");
        }

        void OnDestroy() { AssetReadinessEffects.ReleasePreviewMaterials(); }
    }
}
