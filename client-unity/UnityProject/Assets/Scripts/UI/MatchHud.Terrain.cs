using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Terrain chips (legacy ui/terrainChips.ts): a row directly under the vitals stack naming what the ground under the local player
    /// is doing, plus the "Home ground" line. The text comes from <see cref="TerrainChips"/>; this file only reads the terrain code
    /// under the predicted position and draws. Rebuilt only when the code, mode, faction or visibility changes.
    /// </summary>
    public sealed partial class MatchHud
    {
        const float TerrainTile = 32f, TerrainWidth = 256f;
        const float TerrainLine = 18f;
        RectTransform _terrainRow;
        TMP_Text _terrainNoteText;
        readonly System.Collections.Generic.List<TerrainChip> _terrainChips = new System.Collections.Generic.List<TerrainChip>(2);
        int _terrainKey = -1, _terrainShown;
        float _terrainTop = -1f, _terrainHeight = TerrainLine;

        sealed class TerrainChip { public RectTransform Rect; public TMP_Text Label; public HudIconHint Hint; }

        /// <summary>The chip text ("glyph LABEL", one per line; "" when hidden).</summary>
        public string TerrainChipLabel
        {
            get
            {
                if (_terrainShown == 0) return "";
                var sb = new System.Text.StringBuilder();
                for (int i = 0; i < _terrainShown; i++) { if (i > 0) sb.Append('\n'); sb.Append(_terrainChips[i].Label.text); }
                return sb.ToString();
            }
        }
        /// <summary>The hover tooltips of the shown chips (their explanations), one per line.</summary>
        public string TerrainChipTooltip
        {
            get
            {
                if (_terrainShown == 0) return "";
                var sb = new System.Text.StringBuilder();
                for (int i = 0; i < _terrainShown; i++) { if (i > 0) sb.Append('\n'); sb.Append(_terrainChips[i].Hint.Text); }
                return sb.ToString();
            }
        }
        /// <summary>The "Home ground" line ("" when hidden).</summary>
        public string TerrainNoteLabel => _terrainNoteText != null && _terrainNoteText.gameObject.activeSelf ? _terrainNoteText.text : "";

        TerrainChip TerrainChipAt(int i)
        {
            while (_terrainChips.Count <= i)
            {
                var theme = UiTheme.Current;
                int n = _terrainChips.Count;
                var rect = HudUi.At(_terrainRow, "Chip" + n, 0, n * TerrainLine, TerrainWidth, TerrainLine);
                var image = rect.gameObject.AddComponent<UnityEngine.UI.Image>();
                image.color = new Color(0f, 0f, 0f, 0f);
                var label = HudUi.Label(rect, "Label", "", theme.SizeSmall, theme.Warning, TextAlignmentOptions.TopLeft, bold: true);
                var button = rect.gameObject.AddComponent<UnityEngine.UI.Button>();
                button.targetGraphic = image;
                button.navigation = new UnityEngine.UI.Navigation { mode = UnityEngine.UI.Navigation.Mode.None };
                var hint = HudIconHint.Attach(button, _root != null ? _root : _hud, "");
                _terrainChips.Add(new TerrainChip { Rect = rect, Label = label, Hint = hint });
            }
            return _terrainChips[i];
        }

        void TickTerrain()
        {
            var me = _session?.Me;
            var map = _session?.Map;
            bool show = Active && _plateActive && me != null && me.Status == ActorStatus.Alive && map != null && map.Terrain != null;
            byte code = 0;
            if (show)
            {
                var motion = _session.Motion;
                float x = motion != null ? motion.DrawnX : me.X, y = motion != null ? motion.DrawnY : me.Y;
                int tx = Mathf.FloorToInt(x / TerrainTile), ty = Mathf.FloorToInt(y / TerrainTile);
                if (tx >= 0 && ty >= 0 && tx < map.W && ty < map.H && ty * map.W + tx < map.Terrain.Length) code = map.Terrain[ty * map.W + tx];
            }
            ShowTerrain(show, code, show ? map.TerrainMode : (byte)0, show ? me.Faction : (FactionId?)null);
        }

        /// <summary>Draws the chips for a terrain code, or hides the row. No-op while the inputs are unchanged.</summary>
        public void ShowTerrain(bool visible, byte terrain, byte terrainMode, FactionId? faction)
        {
            int key = visible ? 1 | terrain << 1 | terrainMode << 9 | (faction.HasValue ? (int)faction.Value + 1 : 0) << 17 : 0;
            if (_terrainRow == null)
            {
                if (key == 0 || _hud == null) return;
                var theme = UiTheme.Current;
                _terrainRow = HudUi.Box(_hud, "TerrainChips", HudAnchor.TopLeft, PlateLeft, PlateTop, TerrainWidth, TerrainLine);
                _terrainNoteText = HudUi.Label(HudUi.At(_terrainRow, "Note", 0, 0, TerrainWidth, TerrainLine), "Label", "", theme.SizeSmall, theme.Success, TextAlignmentOptions.TopLeft, wrap: true);
                _terrainRow.gameObject.SetActive(false);
            }
            if (visible && _vitalsPanel != null)
            {
                float top = PlateTop + _vitalsPanel.sizeDelta.y + 4f;
                if (!Mathf.Approximately(top, _terrainTop)) { _terrainTop = top; HudUi.Place(_terrainRow, HudAnchor.TopLeft, PlateLeft, top, TerrainWidth, _terrainHeight); }
            }
            if (key == _terrainKey) return;
            _terrainKey = key;
            var chips = visible ? TerrainChips.For(terrain, terrainMode, faction) : null;
            string note = visible ? TerrainChips.HomeNote(terrain, terrainMode, faction) : null;
            int count = chips != null ? chips.Length : 0;
            for (int i = 0; i < _terrainChips.Count; i++) _terrainChips[i].Rect.gameObject.SetActive(i < count);
            for (int i = 0; i < count; i++)
            {
                var chip = TerrainChipAt(i);
                chip.Label.text = chips[i].Glyph + " " + chips[i].Label;
                chip.Hint.Text = chips[i].Explanation;
                chip.Rect.gameObject.SetActive(true);
            }
            _terrainShown = count;
            float noteY = count * TerrainLine, noteH = TerrainLine;
            _terrainNoteText.text = note ?? "";
            _terrainNoteText.gameObject.SetActive(note != null);
            if (note != null)
            {
                noteH = Mathf.Max(TerrainLine, Mathf.Ceil(_terrainNoteText.GetPreferredValues(note, TerrainWidth, 0f).y));
                var noteRect = _terrainNoteText.transform.parent as RectTransform;
                HudUi.Place(noteRect, HudAnchor.TopLeft, 0, noteY, TerrainWidth, noteH);
            }
            _terrainHeight = noteY + (note != null ? noteH : 0f);
            if (_terrainHeight <= 0f) _terrainHeight = TerrainLine;
            if (_terrainTop >= 0f) HudUi.Place(_terrainRow, HudAnchor.TopLeft, PlateLeft, _terrainTop, TerrainWidth, _terrainHeight);
            _terrainRow.gameObject.SetActive(count > 0 || note != null);
        }
    }
}
