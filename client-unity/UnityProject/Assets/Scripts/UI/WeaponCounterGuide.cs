using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>Presentation-only model and uGUI view for the five-item weapon counter loop.</summary>
    public sealed class WeaponCounterGuide
    {
        public readonly struct Edge
        {
            public readonly string Winner;
            public readonly string Loser;
            public readonly bool Diagonal;
            public Edge(string winner, string loser, bool diagonal) { Winner = winner; Loser = loser; Diagonal = diagonal; }
        }

        static readonly string[] RingData = { "sword", "axe", "wand", "shield", "bow" };
        static readonly Edge[] EdgeData = BuildEdges();
        static readonly Dictionary<string, string> Labels = new Dictionary<string, string>
        {
            { "sword", "Sword" }, { "bow", "Bow" }, { "wand", "Wand" }, { "shield", "Shield" }, { "axe", "Axe" },
        };

        readonly Action<string> _onSelect;
        readonly RectTransform _wheel;
        readonly RectTransform _artRoot;
        readonly RawImage _art;
        readonly Texture2D _texture;
        readonly Button[] _nodes;
        readonly TMPro.TMP_Text _legend;
        string _active;

        public static IReadOnlyList<string> RingOrder { get { return Array.AsReadOnly((string[])RingData.Clone()); } }
        public static IReadOnlyList<Edge> Edges { get { return Array.AsReadOnly((Edge[])EdgeData.Clone()); } }
        public static bool IsWheelWeapon(string id) { return RingData.Contains(Normalize(id)); }
        public RectTransform WheelRoot { get { return _wheel; } }
        public RectTransform LegendRoot { get { return _legend == null ? null : _legend.transform.parent as RectTransform; } }
        public Texture2D Texture { get { return _texture; } }

        /// <summary>Places the wheel and its legend inside a caller-owned region, such as a compact map rail.</summary>
        public void SetLayout(Vector2 wheelMin, Vector2 wheelMax, Vector2 legendMin, Vector2 legendMax)
        {
            SetAnchors(_wheel, wheelMin, wheelMax);
            SetAnchors(LegendRoot, legendMin, legendMax);
        }

        static void SetAnchors(RectTransform rect, Vector2 min, Vector2 max)
        {
            if (rect == null) return;
            rect.anchorMin = min; rect.anchorMax = max;
            rect.offsetMin = Vector2.zero; rect.offsetMax = Vector2.zero;
            rect.pivot = new Vector2(.5f, .5f);
        }

        public static void Matchups(string weapon, out string[] beats, out string[] losesTo)
        {
            string id = Normalize(weapon);
            beats = EdgeData.Where(e => e.Winner == id).Select(e => e.Loser).ToArray();
            losesTo = EdgeData.Where(e => e.Loser == id).Select(e => e.Winner).ToArray();
        }

        public static string Describe(string weapon)
        {
            string id = Normalize(weapon);
            if (!IsWheelWeapon(id)) return "Fists are your unarmed starting weapon. They sit outside the five-weapon counter loop.";
            Matchups(id, out var beats, out var losesTo);
            return "ACTIVE  " + Labels[id] + "     + ADVANTAGE  " + Names(beats) + "     ! WATCH FOR  " + Names(losesTo);
        }

        public WeaponCounterGuide(Transform parent, string activeWeapon, Action<string> onSelect = null)
        {
            _onSelect = onSelect;
            _wheel = MythicUi.Rect(parent, "WeaponCounterWheel", new Vector2(0, 1), new Vector2(1, 1));
            _wheel.pivot = new Vector2(.5f, 1);
            _wheel.sizeDelta = new Vector2(0, 410);
            _wheel.gameObject.AddComponent<LayoutElement>().preferredHeight = 410;
            _artRoot = MythicUi.Rect(_wheel, "SquareWheelArt", Vector2.zero, Vector2.one);
            var fit = _artRoot.gameObject.AddComponent<AspectRatioFitter>();
            fit.aspectMode = AspectRatioFitter.AspectMode.FitInParent;
            fit.aspectRatio = 1f;
            _art = _artRoot.gameObject.AddComponent<RawImage>();
            _art.raycastTarget = false;
            _texture = new Texture2D(512, 512, TextureFormat.RGBA32, false) { filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp, name = "Weapon counter wheel" };
            _art.texture = _texture;
            _nodes = new Button[RingData.Length];
            for (int i = 0; i < RingData.Length; i++)
            {
                int index = i;
                double angle = -Math.PI / 2 + i * Math.PI * 2 / RingData.Length;
                float x = .5f + Mathf.Cos((float)angle) * .34f;
                float y = .5f - Mathf.Sin((float)angle) * .34f;
                string id = RingData[i];
                var button = MythicUi.Button(_artRoot, "Weapon_" + id, Labels[id], new Vector2(x, y), new Vector2(x, y), () => Select(RingData[index]));
                button.GetComponent<RectTransform>().sizeDelta = new Vector2(84, 56);
                // A generated weapon icon over the label and a state mark in the corner replace the old "[ ]" text prefix.
                // Anchored by fraction (icon in the top half, label in the bottom half) so it holds at any node size.
                var iconRect = MythicUi.Rect(button.transform, "WeaponIcon", new Vector2(.25f, .46f), new Vector2(.75f, .98f));
                var iconImage = iconRect.gameObject.AddComponent<Image>(); iconImage.sprite = ShowcaseSprites.Get("weapon" + WeaponSpriteIndex(id)); iconImage.preserveAspect = true; iconImage.raycastTarget = false;
                var label0 = button.GetComponentInChildren<TMPro.TMP_Text>(); label0.rectTransform.anchorMin = new Vector2(0, 0); label0.rectTransform.anchorMax = new Vector2(1, .5f); label0.rectTransform.offsetMin = new Vector2(1, 1); label0.rectTransform.offsetMax = new Vector2(-1, 0);
                label0.alignment = TMPro.TextAlignmentOptions.Center; label0.enableWordWrapping = false; label0.enableAutoSizing = true; label0.fontSizeMin = 8; label0.fontSizeMax = 13;
                var markRect = MythicUi.Rect(button.transform, "StateMark", new Vector2(1, 1), new Vector2(1, 1));
                markRect.sizeDelta = new Vector2(18, 18); markRect.anchoredPosition = new Vector2(-10, -10);
                var markText = markRect.gameObject.AddComponent<TMPro.TextMeshProUGUI>(); markText.font = UiTheme.Current.Font(UiFontRole.Body); markText.fontSize = 16; markText.fontStyle = TMPro.FontStyles.Bold; markText.alignment = TMPro.TextAlignmentOptions.Center; markText.raycastTarget = false;
                button.GetComponent<LayoutElement>().minHeight = 44;
                _nodes[i] = button;
                button.navigation = new Navigation { mode = Navigation.Mode.Automatic };
            }
            var legendRoot = MythicUi.Rect(parent, "WeaponCounterLegend", new Vector2(0, 1), new Vector2(1, 1));
            legendRoot.pivot = new Vector2(.5f, 1);
            legendRoot.sizeDelta = new Vector2(0, 80);
            legendRoot.gameObject.AddComponent<LayoutElement>().preferredHeight = 80;
            _legend = MythicUi.Text(legendRoot, "Legend", "Arrows point from the weapon with the advantage to the weapon it counters. Solid: next clockwise. Dashed: one after that. + means advantage; ! means be careful.", Vector2.zero, Vector2.one, 15, ShowcasePalette.MutedText, TMPro.TextAlignmentOptions.Center);
            _legend.enableWordWrapping = true;
            _active = Normalize(activeWeapon);
            Redraw();
        }

        static int WeaponSpriteIndex(string id) { switch (id) { case "sword": return 0; case "bow": return 1; case "wand": return 2; case "shield": return 3; case "axe": return 4; default: return 5; } }

        public string ActiveWeapon { get { return _active; } }

        public void SetWeapon(string weapon)
        {
            string normalized = Normalize(weapon);
            if (_active == normalized) return;
            _active = normalized;
            Redraw();
        }

        public void Select(string weapon)
        {
            SetWeapon(weapon);
            if (IsWheelWeapon(_active)) _onSelect?.Invoke(_active);
        }

        public void Destroy()
        {
            DestroyOwned(_texture);
            if (_wheel != null) DestroyOwned(_wheel.gameObject);
            if (_legend != null) DestroyOwned(_legend.transform.parent.gameObject);
        }

        static void DestroyOwned(UnityEngine.Object obj)
        {
            if (obj == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(obj);
            else UnityEngine.Object.DestroyImmediate(obj);
        }

        void Redraw()
        {
            var pixels = new Color32[512 * 512];
            Color32 baseLine = ShowcasePalette.PanelStroke;
            foreach (var edge in EdgeData)
            {
                int from = Array.IndexOf(RingData, edge.Winner), to = Array.IndexOf(RingData, edge.Loser);
                Vector2 a = At(from), b = At(to);
                bool pickedEdge = IsWheelWeapon(_active) && (edge.Winner == _active || edge.Loser == _active);
                Color32 color = pickedEdge ? (edge.Winner == _active ? ShowcasePalette.Success : ShowcasePalette.Warning) : baseLine;
                DrawArrow(pixels, a, b, color, edge.Diagonal);
            }
            for (int i = 0; i < RingData.Length; i++)
            {
                Vector2 p = At(i);
                bool selected = _active == RingData[i];
                DrawRing(pixels, (int)p.x, (int)p.y, selected ? 34 : 30, selected ? ShowcasePalette.Gold : ShowcasePalette.MutedText, selected ? 4 : 2);
            }
            _texture.SetPixels32(pixels);
            _texture.Apply(false, false);
            for (int i = 0; i < _nodes.Length; i++)
            {
                string id = RingData[i];
                bool selected = _active == id;
                Matchups(id, out var wins, out var losses);
                // "+" = this weapon has the advantage over the active one, "!" = the active weapon beats it (the legend's wording).
                bool advantage = IsWheelWeapon(_active) && !selected && losses.Contains(_active), danger = IsWheelWeapon(_active) && !selected && wins.Contains(_active);
                var mark = _nodes[i].transform.Find("StateMark").GetComponent<TMPro.TextMeshProUGUI>();
                mark.text = advantage ? "+" : danger ? "!" : ""; mark.color = advantage ? (Color)UiTheme.Current.Success : (Color)UiTheme.Current.Warning;
                _nodes[i].GetComponentInChildren<TMPro.TMP_Text>().text = Labels[id];
                MythicUi.Select(_nodes[i], selected);
            }
            _legend.text = IsWheelWeapon(_active)
                ? Describe(_active) + "\nArrows point winner → countered weapon. Solid: next clockwise · Dashed: one after that."
                : "Fists are your unarmed starting weapon. They sit outside the five-weapon counter loop.\nArrows point winner → countered weapon. Solid: next clockwise · Dashed: one after that.";
        }

        static Vector2 At(int index)
        {
            double angle = -Math.PI / 2 + index * Math.PI * 2 / RingData.Length;
            return new Vector2(256 + Mathf.Cos((float)angle) * 174, 256 - Mathf.Sin((float)angle) * 174);
        }

        static void DrawArrow(Color32[] pixels, Vector2 a, Vector2 b, Color32 color, bool dashed)
        {
            Vector2 delta = b - a;
            float length = delta.magnitude;
            if (length < 1) return;
            Vector2 unit = delta / length, normal = new Vector2(-unit.y, unit.x);
            Vector2 start = a + unit * 38, end = b - unit * 40;
            float lineLength = Vector2.Distance(start, end);
            int steps = Mathf.CeilToInt(lineLength);
            for (int i = 0; i <= steps; i++)
            {
                if (dashed && (i / 8) % 2 == 1) continue;
                Vector2 p = Vector2.Lerp(start, end, i / (float)Mathf.Max(1, steps));
                Pixel(pixels, (int)p.x, (int)p.y, color);
                Pixel(pixels, (int)(p.x + normal.x), (int)(p.y + normal.y), color);
                Pixel(pixels, (int)(p.x - normal.x), (int)(p.y - normal.y), color);
            }
            Vector2 basePoint = end - unit * 12;
            FillTriangle(pixels, end, basePoint + normal * 6, basePoint - normal * 6, color);
        }

        static void DrawRing(Color32[] pixels, int cx, int cy, int radius, Color32 color, int thickness)
        {
            int outer = radius * radius, inner = (radius - thickness) * (radius - thickness);
            for (int y = -radius; y <= radius; y++) for (int x = -radius; x <= radius; x++)
            { int d = x * x + y * y; if (d <= outer && d >= inner) Pixel(pixels, cx + x, cy + y, color); }
        }

        static void FillTriangle(Color32[] pixels, Vector2 a, Vector2 b, Vector2 c, Color32 color)
        {
            int minX = Mathf.Max(0, Mathf.FloorToInt(Mathf.Min(a.x, Mathf.Min(b.x, c.x))));
            int maxX = Mathf.Min(511, Mathf.CeilToInt(Mathf.Max(a.x, Mathf.Max(b.x, c.x))));
            int minY = Mathf.Max(0, Mathf.FloorToInt(Mathf.Min(a.y, Mathf.Min(b.y, c.y))));
            int maxY = Mathf.Min(511, Mathf.CeilToInt(Mathf.Max(a.y, Mathf.Max(b.y, c.y))));
            for (int y = minY; y <= maxY; y++) for (int x = minX; x <= maxX; x++)
                if (SameSide(new Vector2(x, y), a, b, c) && SameSide(new Vector2(x, y), b, c, a) && SameSide(new Vector2(x, y), c, a, b)) Pixel(pixels, x, y, color);
        }

        static bool SameSide(Vector2 p, Vector2 a, Vector2 b, Vector2 c)
        { float cp1 = Cross(b - a, p - a), cp2 = Cross(b - a, c - a); return cp1 == 0 || cp2 == 0 || Mathf.Sign(cp1) == Mathf.Sign(cp2); }
        static float Cross(Vector2 a, Vector2 b) { return a.x * b.y - a.y * b.x; }
        static void Pixel(Color32[] pixels, int x, int y, Color32 color) { if (x >= 0 && x < 512 && y >= 0 && y < 512) pixels[y * 512 + x] = color; }
        static string Normalize(string id) { return (id ?? "").Trim().ToLowerInvariant(); }
        static string Names(IEnumerable<string> ids) { return string.Join(", ", ids.Select(id => Labels[id])); }

        static Edge[] BuildEdges()
        {
            var result = new List<Edge>(10);
            for (int i = 0; i < RingData.Length; i++)
            {
                result.Add(new Edge(RingData[i], RingData[(i + 1) % RingData.Length], false));
                result.Add(new Edge(RingData[i], RingData[(i + 2) % RingData.Length], true));
            }
            return result.ToArray();
        }
    }
}
