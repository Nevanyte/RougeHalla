using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;
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
        float _time;
        int _accent = -1;

        public void Initialize(Camera cam)
        {
            if (cam == null) return;

            ShowcaseSprites.Initialize();
            if (ShowcaseSettings.Current == null)
                new GameObject("Showcase presentation settings").AddComponent<ShowcaseSettings>();

            _arena = new GameObject("Presentation study arena").AddComponent<ArenaView>();
            _arena.Build(CreateStudyMap());
            StageActors();
            StageEffects();
            _arena.Present(_actors, null, null, 0f);

            Vector3 center = ArenaView.WorldPoint(MapWidth * 16f, MapHeight * 16f);
            cam.orthographic = true;
            cam.orthographicSize = 12f;
            cam.transform.position = new Vector3(center.x, center.y, -30f);
            cam.transform.rotation = Quaternion.identity;
            CreateOverlay();
        }

        void Update()
        {
            if (_arena == null) return;
            var keyboard = Keyboard.current;
            if (keyboard != null)
            {
                if (keyboard.digit1Key.wasPressedThisFrame || keyboard.numpad1Key.wasPressedThisFrame) SetAccent(0);
                else if (keyboard.digit2Key.wasPressedThisFrame || keyboard.numpad2Key.wasPressedThisFrame) SetAccent(1);
                else if (keyboard.digit3Key.wasPressedThisFrame || keyboard.numpad3Key.wasPressedThisFrame) SetAccent(2);
                else if (keyboard.digit4Key.wasPressedThisFrame || keyboard.numpad4Key.wasPressedThisFrame) SetAccent(3);
                else if (keyboard.digit5Key.wasPressedThisFrame || keyboard.numpad5Key.wasPressedThisFrame) SetAccent(4);
            }

            if (ShowcaseSettings.Current != null && ShowcaseSettings.Current.ReducedMotion) return;
            _time += Time.unscaledDeltaTime;
            for (int i = 0; i < _accentMarks.Count; i++)
            {
                var mark = _accentMarks[i];
                if (mark == null || !mark.enabled) continue;
                float pulse = .88f + .12f * Mathf.Sin(_time * 1.4f + i * .71f);
                mark.transform.localScale = new Vector3(mark.transform.localScale.x, pulse, 1f);
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
        }

        static void AddLabel(Transform parent, string value, Vector2 min, Vector2 max, int size,
            FontStyle style, Color color, TextAnchor anchor)
        {
            var go = new GameObject("Study label");
            go.transform.SetParent(parent, false);
            var rect = go.AddComponent<RectTransform>();
            rect.anchorMin = min; rect.anchorMax = max;
            rect.offsetMin = Vector2.zero; rect.offsetMax = Vector2.zero;
            var text = go.AddComponent<Text>();
            text.font = Resources.GetBuiltinResource<Font>("Arial.ttf");
            text.text = value; text.fontSize = size; text.fontStyle = style;
            text.color = color; text.alignment = anchor;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Overflow;
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
