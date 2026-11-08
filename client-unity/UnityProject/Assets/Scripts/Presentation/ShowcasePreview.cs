using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;
using TMPro;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>
    /// A self-contained art review scene. Every actor and effect here is staged presentation data;
    /// this component never creates or contacts a match session and has no gameplay simulation.
    /// </summary>
    public sealed class ShowcasePreview : MonoBehaviour
    {
        const int MapWidth = 28, MapHeight = 22;
        readonly List<InterpActor> _actors = new List<InterpActor>(12);
        readonly List<SpriteRenderer> _accentMarks = new List<SpriteRenderer>();
        ArenaView _arena;
        ShowcaseCatalog _catalog;
        SpriteRenderer _previewRenderer;
        TextMeshProUGUI _previewSelectionLabel, _previewStatusLabel;
        int _appearanceIndex = -1;
        ShowcasePreviewAction _previewAction = ShowcasePreviewAction.Idle;
        int _previewDirection = 5;
        float _previewElapsed;
        bool _previewHasFrame, _previewStatusInitialized, _skipElapsedAdvance;
        float _time;
        int _accent = -1;
        Camera _camera;

        public void Initialize(Camera cam)
        {
            if (cam == null) return;
            _camera=cam;

            ShowcaseSprites.Initialize();
            if (ShowcaseSettings.Current == null)
                new GameObject("Showcase presentation settings").AddComponent<ShowcaseSettings>();

            _catalog = Resources.Load<ShowcaseCatalog>("Showcase/Catalog");
            SelectDefaultAppearance();

            _arena = new GameObject("Presentation study arena").AddComponent<ArenaView>();
            _arena.Build(CreateStudyMap());
            StageActors();
            StageEffects();
            CreateAnimationPodium();
            _arena.Present(_actors, null, null, 0f);

            Vector3 center = ArenaView.WorldPoint(MapWidth * 16f, MapHeight * 16f);
            cam.orthographic = true;
            cam.orthographicSize = 8.6f;
            cam.transform.position = new Vector3(center.x, center.y, -30f);
            cam.transform.rotation = Quaternion.identity;
            CreateOverlay();
            UpdateAnimationPreview(ShowcaseSettings.Current != null && ShowcaseSettings.Current.ReducedMotion);
        }

        void Update()
        {
            if (_arena == null) return;
            _arena.Follow(_camera,MapWidth*16f,MapHeight*16f+1.5f/(ArenaView.Scale*ArenaView.GroundSquash));
            _arena.Present(_actors,null,null,0);
            var keyboard = Keyboard.current;
            if (keyboard != null)
            {
                if (keyboard.digit1Key.wasPressedThisFrame || keyboard.numpad1Key.wasPressedThisFrame) SetAccent(0);
                else if (keyboard.digit2Key.wasPressedThisFrame || keyboard.numpad2Key.wasPressedThisFrame) SetAccent(1);
                else if (keyboard.digit3Key.wasPressedThisFrame || keyboard.numpad3Key.wasPressedThisFrame) SetAccent(2);
                else if (keyboard.digit4Key.wasPressedThisFrame || keyboard.numpad4Key.wasPressedThisFrame) SetAccent(3);
                else if (keyboard.digit5Key.wasPressedThisFrame || keyboard.numpad5Key.wasPressedThisFrame) SetAccent(4);

                if (keyboard.leftBracketKey.wasPressedThisFrame) AdvanceAppearance(-1);
                if (keyboard.rightBracketKey.wasPressedThisFrame) AdvanceAppearance(1);
                if (keyboard.upArrowKey.wasPressedThisFrame) ChangeAction(-1);
                if (keyboard.downArrowKey.wasPressedThisFrame) ChangeAction(1);
                if (keyboard.leftArrowKey.wasPressedThisFrame) ChangeDirection(-1);
                if (keyboard.rightArrowKey.wasPressedThisFrame) ChangeDirection(1);
            }

            bool reducedMotion = ShowcaseSettings.Current != null && ShowcaseSettings.Current.ReducedMotion;
            UpdateAnimationPreview(reducedMotion);
            if (reducedMotion) return;
            _time += Time.unscaledDeltaTime;
            for (int i = 0; i < _accentMarks.Count; i++)
            {
                var mark = _accentMarks[i];
                if (mark == null || !mark.enabled) continue;
                float pulse = .88f + .12f * Mathf.Sin(_time * 1.4f + i * .71f);
                mark.transform.localScale = new Vector3(.85f, 2.8f*pulse, 1f);
            }
        }

        static MapBlob CreateStudyMap()
        {
            var tiles = new byte[MapWidth * MapHeight];
            for (int y = 0; y < MapHeight; y++)
            for (int x = 0; x < MapWidth; x++)
            {
                bool boundary = x == 0 || y == 0 || x == MapWidth - 1 || y == MapHeight - 1;
                // Short broken colonnades frame the central display without occluding the cast.
                bool westColumn = x == 4 && (y < 7 || y > 14);
                bool eastColumn = x == 23 && (y < 7 || y > 14);
                bool northPillar = y == 4 && (x == 9 || x == 18);
                bool southPillar = y == 17 && (x == 9 || x == 18);
                tiles[y * MapWidth + x] = (byte)(boundary || westColumn || eastColumn || northPillar || southPillar
                    ? MapBlob.Wall : MapBlob.Floor);
            }
            return new MapBlob(MapWidth, MapHeight, tiles);
        }

        void StageActors()
        {
            _actors.Clear();
            float[] x = { 7f, 10.5f, 14f, 17.5f, 21f };
            for (int faction = 0; faction < 5; faction++)
            {
                _actors.Add(new InterpActor {
                    Id = (uint)(100 + faction), Faction = (FactionId)faction, Status = ActorStatus.Alive,
                    Weapon = (WeaponId)(faction % 5), HpPct = 100, X = x[faction] * 32f, Y = 9f * 32f,
                    Facing = Mathf.PI * .5f, Kind = ActorKind.Player
                });
            }

            // Representative mob silhouettes are arranged as an art lineup, not spawned by game rules.
            AddMob(200, 0, MobTypeId.EmberImp, 9f, 13.2f, WeaponId.Fists);
            AddMob(201, 1, MobTypeId.Bailiff, 12.4f, 13.2f, WeaponId.Sword);
            AddMob(202, 2, MobTypeId.RotMonk, 15.6f, 13.2f, WeaponId.Wand);
            AddMob(203, 3, MobTypeId.IceGolem, 18.9f, 13.2f, WeaponId.Axe);
            AddMob(204, 4, MobTypeId.SeraphShard, 14f, 6.8f, WeaponId.Shield);
        }

        void AddMob(uint id, int faction, MobTypeId mob, float x, float y, WeaponId weapon)
        {
            _actors.Add(new InterpActor {
                Id = id, Faction = (FactionId)faction, Status = ActorStatus.Alive,
                Weapon = weapon, HpPct = 100, X = x * 32f, Y = y * 32f,
                Facing = -Mathf.PI * .5f, Kind = ActorKind.RegionalMob, MobType = mob
            });
        }

        void StageEffects()
        {
            Transform root = new GameObject("Staged elemental artwork").transform;
            root.SetParent(transform, false);
            for (int i = 0; i < 5; i++)
            {
                Color color = ShowcasePalette.Faction(i);
                Vector3 p = ArenaView.WorldPoint((7f + i * 3.5f) * 32f, 11.25f * 32f);
                ShowcaseSprites.Create(root,"Staged elemental material wash","glow",-50,WithAlpha(color,.19f),new Vector2(4.8f,12),p,false);
                var light=ShowcaseSprites.CreateLight(root,"Staged elemental light",p+new Vector3(0,1,-1));
                light.Configure(color,1.7f,.3f,4.3f,.5f,true);light.SetVisible(true);
                var title=new GameObject("Faction study heading");title.transform.SetParent(root,false);title.transform.position=p+new Vector3(0,5.4f,0);
                var label=title.AddComponent<TextMeshPro>();label.font=Resources.Load<TMP_FontAsset>("Showcase/CinzelDecorative")??TMP_Settings.defaultFontAsset;
                label.text=ShowcasePalette.GetFactionName(i).ToUpperInvariant();label.fontSize=2.6f;label.color=color;label.alignment=TextAlignmentOptions.Center;
                label.rectTransform.sizeDelta=new Vector2(3.4f,1);label.GetComponent<MeshRenderer>().sortingOrder=31000;
                ShowcaseSprites.Create(root, "Staged ability ring", "ring", 1200, WithAlpha(color, .72f),
                    new Vector2(2.1f, 1.4f), p, false);
                var column = ShowcaseSprites.Create(root, "Staged ability column", "glow", 1201,
                    WithAlpha(color, .3f), new Vector2(.85f, 2.8f), p + new Vector3(0, .8f), false);
                _accentMarks.Add(column);
                ShowcaseSprites.Create(root, "Staged rune", "rune", 1202, color,
                    new Vector2(.3f, .4f), p + new Vector3(0, 1.2f), false);
            }

            // Small fixed ambient motes add scale and atmosphere without particle simulation.
            for (int i = 0; i < 18; i++)
            {
                float wx = 5.5f + (i * 37 % 170) / 10f;
                float wy = 5.4f + (i * 23 % 105) / 10f;
                Color mote = i % 3 == 0 ? new Color(1f, .67f, .35f, .45f) : new Color(.55f, .73f, .93f, .3f);
                ShowcaseSprites.Create(root, "Staged ambient mote", "spark", 1250 + i,
                    mote, new Vector2(.045f + (i % 3) * .018f, .045f + (i % 3) * .018f),
                    ArenaView.WorldPoint(wx * 32f, wy * 32f), false);
            }
        }

        void CreateOverlay()
        {
            var canvasGo = new GameObject("Presentation study overlay");
            canvasGo.transform.SetParent(transform, false);
            var canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 100;
            canvasGo.AddComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            canvasGo.GetComponent<CanvasScaler>().referenceResolution = new Vector2(1920, 1080);
            canvasGo.GetComponent<CanvasScaler>().matchWidthOrHeight = .5f;
            canvasGo.AddComponent<GraphicRaycaster>();

            AddLabel(canvas.transform, "PRESENTATION STUDY • staged artwork, not a live match",
                new Vector2(.035f, .91f), new Vector2(.965f, .985f), 30, FontStyle.Bold,
                new Color32(244, 231, 204, 255), TextAnchor.MiddleLeft);
            AddLabel(canvas.transform, "FIVE FACTIONS  /  AUTHORED CAST  /  ELEMENTAL STUDIES\n" +
                "1 FIRE     2 SENTENCED     3 PLAGUE     4 FROST     5 HOLY     •     press 1–5 to accent",
                new Vector2(.035f, .025f), new Vector2(.965f, .12f), 19, FontStyle.Normal,
                new Color32(200, 207, 219, 255), TextAnchor.MiddleLeft);

            CreateAnimationPreviewCard(canvas.transform);
        }

        void CreateAnimationPreviewCard(Transform canvas)
        {
            var panelObject = new GameObject("Staged animation preview card");
            panelObject.transform.SetParent(canvas, false);
            var rect = panelObject.AddComponent<RectTransform>();
            rect.anchorMin = new Vector2(.035f, .14f);
            rect.anchorMax = new Vector2(.36f, .42f);
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
            var panel = panelObject.AddComponent<UnityEngine.UI.Image>();
            panel.color = ShowcasePalette.Panel;
            panel.raycastTarget = false;

            AddPreviewLabel(panelObject.transform, "Preview heading", "STAGED ANIMATION PREVIEW\nNO NETWORK",
                new Vector2(.045f, .76f), new Vector2(.96f, .98f), 18, FontStyles.Bold, ShowcasePalette.Gold);
            _previewSelectionLabel = AddPreviewLabel(panelObject.transform, "Preview selection", "",
                new Vector2(.045f, .54f), new Vector2(.96f, .74f), 22, FontStyles.Bold, ShowcasePalette.Text);
            AddPreviewLabel(panelObject.transform, "Preview controls", "[ / ] Appearance    Up / Down Action\nLeft / Right Source Direction",
                new Vector2(.045f, .20f), new Vector2(.96f, .52f), 17, FontStyles.Normal, ShowcasePalette.MutedText);
            _previewStatusLabel = AddPreviewLabel(panelObject.transform, "Preview status", "",
                new Vector2(.045f, .02f), new Vector2(.96f, .16f), 15, FontStyles.Bold, ShowcasePalette.Warning);
            RefreshPreviewLabels();
        }

        static TextMeshProUGUI AddPreviewLabel(Transform parent, string name, string value,
            Vector2 min, Vector2 max, int size, FontStyles style, Color color)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rect = go.AddComponent<RectTransform>();
            rect.anchorMin = min;
            rect.anchorMax = max;
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
            var text = go.AddComponent<TextMeshProUGUI>();
            text.font = TMP_Settings.defaultFontAsset;
            text.text = value;
            text.fontSize = size * (ShowcaseSettings.Current != null ? ShowcaseSettings.Current.TextScale : 1f);
            text.fontStyle = style;
            text.color = color;
            text.alignment = TextAlignmentOptions.MidlineLeft;
            text.enableWordWrapping = true;
            text.raycastTarget = false;
            return text;
        }

        void CreateAnimationPodium()
        {
            var podium = new GameObject("No-network animation podium");
            podium.transform.SetParent(transform, false);
            podium.transform.position = ArenaView.WorldPoint(14f * 32f, 17.5f * 32f);
            _previewRenderer = podium.AddComponent<SpriteRenderer>();
            _previewRenderer.sharedMaterial = ShowcaseSprites.Lit;
            _previewRenderer.color = Color.white;
            _previewRenderer.sortingOrder = 2000 + Mathf.RoundToInt(17.5f * 32f * .5f);
            _previewRenderer.enabled = false;
        }

        void SelectDefaultAppearance()
        {
            _appearanceIndex = -1;
            _previewElapsed = 0f;
            _skipElapsedAdvance = true;
            if (_catalog == null || _catalog.Actors == null) return;
            for (int i = 0; i < _catalog.Actors.Length; i++)
            {
                var appearance = _catalog.Actors[i];
                if (appearance != null && appearance.Key == "hero")
                {
                    _appearanceIndex = i;
                    return;
                }
            }
            for (int i = 0; i < _catalog.Actors.Length; i++)
            {
                if (_catalog.Actors[i] != null)
                {
                    _appearanceIndex = i;
                    return;
                }
            }
        }

        ShowcaseCatalog.Appearance SelectedAppearance
        {
            get
            {
                if (_catalog == null || _catalog.Actors == null || _appearanceIndex < 0 ||
                    _appearanceIndex >= _catalog.Actors.Length) return null;
                return _catalog.Actors[_appearanceIndex];
            }
        }

        void AdvanceAppearance(int delta)
        {
            if (_catalog == null || _catalog.Actors == null || _catalog.Actors.Length == 0) return;
            int count = _catalog.Actors.Length;
            int index = _appearanceIndex;
            for (int checkedEntries = 0; checkedEntries < count; checkedEntries++)
            {
                index = (index + delta + count) % count;
                if (_catalog.Actors[index] == null) continue;
                _appearanceIndex = index;
                _previewElapsed = 0f;
                _skipElapsedAdvance = true;
                RefreshPreviewLabels();
                return;
            }
        }

        void ChangeAction(int delta)
        {
            int count = ShowcaseAnimationPreview.ActionCount;
            int next = ((int)_previewAction + delta + count) % count;
            if (next == (int)_previewAction) return;
            _previewAction = (ShowcasePreviewAction)next;
            _previewElapsed = 0f;
            _skipElapsedAdvance = true;
            RefreshPreviewLabels();
        }

        void ChangeDirection(int delta)
        {
            int count = ShowcaseAnimationPreview.DirectionCount;
            _previewDirection = (_previewDirection + delta + count) % count;
            RefreshPreviewLabels();
        }

        void UpdateAnimationPreview(bool reducedMotion)
        {
            if (_previewRenderer == null) return;
            if (!reducedMotion && !_skipElapsedAdvance) _previewElapsed += Time.unscaledDeltaTime;
            _skipElapsedAdvance = false;
            var appearance = SelectedAppearance;
            Sprite frame = null;
            bool available = appearance != null && ShowcaseAnimationPreview.TryFrame(
                appearance, _previewAction, _previewDirection, _previewElapsed, reducedMotion, out frame);
            if (available && frame != null)
            {
                _previewRenderer.sprite = frame;
                _previewRenderer.enabled = true;
                float height = appearance.WorldHeight;
                if (float.IsNaN(height) || float.IsInfinity(height) || height <= 0f) height = 1f;
                _previewRenderer.transform.localScale = Vector3.one * height;
                if (!_previewHasFrame)
                {
                    _previewHasFrame = true;
                    RefreshPreviewLabels();
                }
            }
            else
            {
                _previewRenderer.sprite = null;
                _previewRenderer.enabled = false;
                if (_previewHasFrame || !_previewStatusInitialized)
                {
                    _previewHasFrame = false;
                    RefreshPreviewLabels();
                }
            }
        }

        void RefreshPreviewLabels()
        {
            if (_previewSelectionLabel != null)
            {
                var appearance = SelectedAppearance;
                string name = appearance != null && !string.IsNullOrEmpty(appearance.Key) ? appearance.Key : "NO APPEARANCE";
                _previewSelectionLabel.text = name.ToUpperInvariant() + "  /  " +
                    _previewAction.ToString().ToUpperInvariant() + "  /  " +
                    ShowcaseAnimationPreview.DirectionName(_previewDirection).ToUpperInvariant();
            }
            if (_previewStatusLabel != null)
            {
                _previewStatusLabel.text = _previewHasFrame ? "" : "MISSING CLIP";
                _previewStatusInitialized = true;
            }
        }

        static void AddLabel(Transform parent, string value, Vector2 min, Vector2 max, int size,
            FontStyle style, Color color, TextAnchor anchor)
        {
            var go = new GameObject("Study label");
            go.transform.SetParent(parent, false);
            var rect = go.AddComponent<RectTransform>();
            rect.anchorMin = min; rect.anchorMax = max;
            rect.offsetMin = Vector2.zero; rect.offsetMax = Vector2.zero;
            var text = go.AddComponent<TextMeshProUGUI>();
            text.font = TMP_Settings.defaultFontAsset;
            text.text = value; text.fontSize = size; text.fontStyle = style==FontStyle.Bold ? FontStyles.Bold : FontStyles.Normal;
            text.color = color; text.alignment = TextAlignmentOptions.MidlineLeft;
            text.enableWordWrapping = true;
            text.raycastTarget = false;
        }

        void SetAccent(int faction)
        {
            _accent = faction;
            Color accent = ShowcasePalette.Faction(_accent);
            for (int i = 0; i < _accentMarks.Count; i++)
            {
                var color = accent;
                color.a = i == _accent ? .48f : .22f;
                // Accent selection remains a local artwork treatment only.
                _accentMarks[i].color = color;
            }
        }

        static Color WithAlpha(Color c, float alpha) { c.a = alpha; return c; }
    }
}
