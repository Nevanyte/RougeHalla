using System.Collections.Generic;
using Roguehalla.Net;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>
    /// The Sentenced hunt target picker (legacy <c>sentencedHuntHud.ts</c> / <c>sentencedHuntHud.css</c>): a small card under the upper-left
    /// status plate, shown only to a living Sentenced in an active run (not Training). Title "Hunt · +N% mark strength" (N = 2 x delivered
    /// hunt stacks), a status line, and one button per living rival the server delivered; a choice sends the ordinary hunt-target input
    /// and the card then reads "Tracking ..." until the target falls. Names are not on the wire, so a rival is "Faction rival" with its
    /// health, not a callsign. Everything else (range, +5% speed, vision of the target) is the server's.
    /// </summary>
    public sealed class SentencedHuntPanel : MonoBehaviour
    {
        const float Width = 240f, Top = 156f, Left = 12f, RowH = 24f, MaxRows = 5;
        RectTransform _root;
        TMP_Text _title, _status;
        readonly List<Button> _rows = new List<Button>();
        readonly List<TMP_Text> _rowText = new List<TMP_Text>();
        readonly List<Image> _rowIcon = new List<Image>();
        readonly List<InterpActor> _actors = new List<InterpActor>(32);
        readonly List<InterpActor> _rivals = new List<InterpActor>(8);
        Session _session;
        uint _pending; float _pendingAt, _nextRefresh;
        string _signature = "";

        public bool IsVisible => _root != null && _root.gameObject.activeSelf;
        public RectTransform Root => _root;

        public void Initialize(Transform parent)
        {
            var theme = UiTheme.Current;
            _root = HudUi.Box(parent, "SentencedHunt", HudAnchor.TopLeft, Left, Top, Width, 60f);
            HudUi.Surface(_root, UiTheme.With(theme.Surface, .93f), 7f, theme.FactionColor(1), true, false);
            _title = HudUi.Label(HudUi.At(_root, "Title", 8f, 5f, Width - 16f, 15f), "Title", "Hunt", 11f, theme.FactionColor(1), bold: true);
            _status = HudUi.Label(HudUi.At(_root, "Status", 8f, 21f, Width - 16f, 28f), "Status", "", 10f, theme.TextSecondary, TextAlignmentOptions.TopLeft, false, UiFontRole.Body, true);
            _root.gameObject.SetActive(false);
        }

        Button Row(int i)
        {
            while (_rows.Count <= i)
            {
                int n = _rows.Count; var theme = UiTheme.Current;
                var button = HudUi.Button(_root, "Rival" + n, "", HudAnchor.TopLeft, 7f, 50f + n * (RowH + 3f), Width - 14f, RowH, () => Choose(n), 10f, 4f);
                var label = button.GetComponentInChildren<TMP_Text>(); label.alignment = TextAlignmentOptions.MidlineLeft; label.rectTransform.offsetMin = new Vector2(30f, label.rectTransform.offsetMin.y);
                var icon = LaunchUi.FactionShape(button.transform, "FactionIcon", 0, 8f, 5f, 14f, theme.TextPrimary);
                _rows.Add(button); _rowText.Add(label); _rowIcon.Add(icon);
            }
            return _rows[i];
        }

        void Choose(int index)
        {
            if (_session == null || _pending != 0 || index < 0 || index >= _rivals.Count) return;
            _pending = _rivals[index].Id; _pendingAt = Time.unscaledTime; _signature = "";
            _session.Input.HuntTarget(_pending);
        }

        /// <summary>Per frame from the HUD; cheap while nothing changed.</summary>
        public void Refresh(Session session, bool hudVisible)
        {
            _session = session;
            var me = session?.Me;
            bool active = hudVisible && me != null && Eligible(me.Faction, me.Status, session.Training, session.Phase) && session.Snapshots.Count > 0;
            if (_root == null) return;
            if (!active) { if (_root.gameObject.activeSelf) _root.gameObject.SetActive(false); _pending = 0; _signature = ""; return; }
            if (Time.unscaledTime < _nextRefresh) return;
            _nextRefresh = Time.unscaledTime + .2f;
            _actors.Clear(); session.Snapshots.Sample(session.Snapshots.NewestMs, _actors);
            _rivals.Clear();
            InterpActor? target = null;
            foreach (var a in _actors)
            {
                if (a.Kind != ActorKind.Player || a.Id == me.Id || a.Status != ActorStatus.Alive) continue;
                _rivals.Add(a);
                if (me.HuntTarget.HasValue && a.Id == me.HuntTarget.Value) target = a;
            }
            // insertion sort by id (a handful of rivals): List<struct>.Sort needs generic code IL2CPP/WebGL may not have compiled
            for (int i = 1; i < _rivals.Count; i++)
            {
                var key = _rivals[i]; int j = i - 1;
                while (j >= 0 && _rivals[j].Id > key.Id) { _rivals[j + 1] = _rivals[j]; j--; }
                _rivals[j + 1] = key;
            }
            if (_pending != 0 && (me.HuntTarget == _pending || Time.unscaledTime - _pendingAt > 2.5f)) _pending = 0;
            var sig = new System.Text.StringBuilder().Append(me.HuntTarget.HasValue ? me.HuntTarget.Value : 0).Append('|').Append(me.HuntStacks).Append('|').Append(_pending);
            foreach (var r in _rivals) sig.Append('|').Append(r.Id).Append(',').Append(r.HpPct);
            string signature = sig.ToString();
            if (signature == _signature) return;
            _signature = signature;
            _root.gameObject.SetActive(true);
            _title.text = TitleFor(me.HuntStacks);
            bool tracking = me.HuntTarget.HasValue;
            if (tracking)
            {
                string who = target.HasValue ? Rival(target.Value) : "rival";
                _status.text = "Tracking " + who + ". +5% speed toward them; choose again when they fall.";
            }
            else _status.text = _pending != 0 ? "Selecting rival…" : _rivals.Count == 0 ? "No rival in sight. They appear here when the server shows one." : "Choose a living rival · +5% speed while moving toward them";
            int rows = tracking ? 0 : Mathf.Min(_rivals.Count, (int)MaxRows);
            for (int i = 0; i < _rows.Count || i < rows; i++)
            {
                var button = Row(i);
                bool on = i < rows; button.gameObject.SetActive(on);
                if (!on) continue;
                var r = _rivals[i];
                _rowText[i].text = Rival(r) + " · " + r.HpPct + "%";
                int f = r.Faction.HasValue ? (int)r.Faction.Value : 0;
                _rowIcon[i].sprite = MapGlyphs.Sprite(LaunchCopy.Houses[Mathf.Clamp(f, 0, 4)].Shape); _rowIcon[i].color = UiTheme.Current.FactionColor(f);
                button.interactable = _pending == 0;
            }
            _root.sizeDelta = new Vector2(Width, 50f + (rows > 0 ? rows * (RowH + 3f) : 0f) + 4f);
        }

        /// <summary>Legacy rule: only a living Sentenced in an active run, never in Training.</summary>
        public static bool Eligible(FactionId faction, ActorStatus status, bool training, MatchPhase? phase)
        { return faction == FactionId.Sentenced && status == ActorStatus.Alive && !training && phase == MatchPhase.Active; }
        public static string TitleFor(int stacks) { return "Hunt · +" + (Mathf.Max(0, stacks) * 2) + "% mark strength"; }
        public static string RivalLabel(FactionId? faction) { return (faction.HasValue ? ShowcasePalette.GetFactionName((int)faction.Value) : "Unknown") + " rival"; }

        static string Rival(InterpActor a)
        {
            return RivalLabel(a.Faction);
        }
    }
}
