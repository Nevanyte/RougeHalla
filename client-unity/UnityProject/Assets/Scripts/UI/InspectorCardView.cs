using System.Collections.Generic;
using Roguehalla.Net;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// The legacy opponent inspector (ui/opponentInspector.css): a fixed panel at the top right, top 88 / right 18, width min(330, 40% of the view);
    /// at 650 or narrower top 80 / right 8 / width 230. It shows <see cref="InspectorCard"/>'s lines for the hovered fighter, else the locked one.
    /// Never takes input. The lines are rebuilt only when the shown fighter or its delivered row changes.
    /// </summary>
    public sealed class InspectorCardView
    {
        public const float WideTop = 88f, WideRight = 18f, WideMax = 330f, NarrowTop = 80f, NarrowRight = 8f, NarrowWidth = 230f, NarrowScreen = 650f;
        const float Pad = 10f, BaseSize = 14f;

        readonly RectTransform _root;
        readonly TMP_Text _text;
        readonly List<string> _lines = new List<string>();
        uint _shownId; int _shownSig; bool _visible;
        readonly MythicTextScale _follow;
        float _lastWidth = -1f, _lastScale = -1f;

        public InspectorCardView(Transform parent)
        {
            _root = HudUi.Box(parent, "InspectorCard", HudAnchor.TopRight, WideRight, WideTop, WideMax, 60f);
            HudUi.Surface(_root, new Color(0f, 0f, 0f, .78f), 8f, ShowcasePalette.PanelStroke, raycast: false);
            var body = HudUi.Inset(_root, "Lines", Pad, Pad, Pad, Pad);
            _text = HudUi.Label(body, "Text", "", 14f, Color.white, TextAlignmentOptions.TopLeft, false, UiFontRole.Body, true);
            _follow = _text.GetComponent<MythicTextScale>();
            _root.gameObject.SetActive(false);
        }

        public bool Visible { get { return _visible; } }
        public uint ShownId { get { return _visible ? _shownId : 0u; } }
        public IReadOnlyList<string> Lines { get { return _lines; } }
        public string Text { get { return _text.text; } }
        public RectTransform Root { get { return _root; } }

        /// <summary>Legacy <c>hoverId || lockId</c>: the hovered fighter wins, else the locked one. Hidden when the model gives no card.</summary>
        public void Show(IList<InterpActor> rows, uint hoverId, uint lockId, uint selfId, bool localAlive = true)
        {
            if (hoverId == 0 && !localAlive) lockId = 0;   // RaidScene.ts:1648: the lock only counts while the local fighter is alive
            uint id = hoverId != 0 ? hoverId : lockId;
            int at = -1;
            if (id != 0 && rows != null)
                for (int i = 0; i < rows.Count; i++) if (rows[i].Id == id) { at = i; break; }
            if (at < 0) { Hide(); return; }
            var row = rows[at];
            int sig = Signature(row);
            if (_visible && _shownId == id && _shownSig == sig) { Layout(); return; }
            if (!InspectorCard.Build(row, selfId, _lines)) { Hide(); return; }
            _shownId = id; _shownSig = sig;
            _text.text = string.Join("\n", _lines);
            _lastWidth = -1f;
            _visible = true;
            _root.gameObject.SetActive(true);
            Layout();
        }

        public void Hide()
        {
            if (!_visible) return;
            _visible = false; _shownId = 0; _lines.Clear();
            _root.gameObject.SetActive(false);
        }

        static int Signature(in InterpActor r)
        {
            unchecked
            {
                int h = (int)r.Kind;
                h = h * 31 + (int)r.Status;
                h = h * 31 + (r.Faction.HasValue ? (int)r.Faction.Value + 1 : 0);
                h = h * 31 + (r.Weapon.HasValue ? (int)r.Weapon.Value + 1 : 0);
                h = h * 31 + r.HpPct;
                h = h * 31 + r.Effects;
                h = h * 31 + (r.TopStat1.HasValue ? (int)r.TopStat1.Value : 0);
                h = h * 31 + (r.TopStat2.HasValue ? (int)r.TopStat2.Value : 0);
                return h;
            }
        }

        void Layout()
        {
            var parent = _root.parent as RectTransform;
            float view = parent != null ? parent.rect.width : 1920f;
            // The card is on its own canvas, so MatchHud.ApplyTextScale never reaches it: it reads the setting itself, here, every time it is shown.
            float scale = ShowcaseSettings.Current != null ? ShowcaseSettings.Current.TextScale : 1f;
            if (Mathf.Approximately(view, _lastWidth) && Mathf.Approximately(scale, _lastScale)) return;
            _lastWidth = view; _lastScale = scale;
            bool narrow = view <= NarrowScreen;
            float width = narrow ? NarrowWidth : Mathf.Min(WideMax, view * .4f);
            // The box grows with the lines: measure the (wrapped) text at the size the setting asks for, then size the card to it.
            float wanted = BaseSize * Mathf.Clamp(scale, .85f, 1.5f);
            _text.enableAutoSizing = false; _text.fontSize = wanted;
            float lines = _text.GetPreferredValues(_text.text, width - Pad * 2f, 0f).y;
            float height = Mathf.Ceil(lines) + Pad * 2f;
            HudUi.Place(_root, HudAnchor.TopRight, narrow ? NarrowRight : WideRight, narrow ? NarrowTop : WideTop, width, height);
            if (_follow != null) _follow.Apply(scale);
        }
    }
}
