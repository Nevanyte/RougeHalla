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
        RectTransform _terrainRow;
        TMP_Text _terrainChipText, _terrainNoteText;
        int _terrainKey = -1;
        float _terrainTop = -1f;

        /// <summary>The text of the chip row ("" when hidden).</summary>
        public string TerrainChipLabel => _terrainChipText != null && _terrainChipText.gameObject.activeSelf ? _terrainChipText.text : "";
        /// <summary>The "Home ground" line ("" when hidden).</summary>
        public string TerrainNoteLabel => _terrainNoteText != null && _terrainNoteText.gameObject.activeSelf ? _terrainNoteText.text : "";

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
                _terrainRow = HudUi.Box(_hud, "TerrainChips", HudAnchor.TopLeft, PlateLeft, PlateTop, TerrainWidth, 36f);
                _terrainChipText = HudUi.Label(HudUi.At(_terrainRow, "Chips", 0, 0, TerrainWidth, 18), "Label", "", theme.SizeSmall, theme.Warning, TextAlignmentOptions.TopLeft, bold: true);
                _terrainNoteText = HudUi.Label(HudUi.At(_terrainRow, "Note", 0, 18, TerrainWidth, 18), "Label", "", theme.SizeSmall, theme.Success, TextAlignmentOptions.TopLeft, wrap: true);
                _terrainRow.gameObject.SetActive(false);
            }
            if (visible && _vitalsPanel != null)
            {
                float top = PlateTop + _vitalsPanel.sizeDelta.y + 4f;
                if (!Mathf.Approximately(top, _terrainTop)) { _terrainTop = top; HudUi.Place(_terrainRow, HudAnchor.TopLeft, PlateLeft, top, TerrainWidth, 36f); }
            }
            if (key == _terrainKey) return;
            _terrainKey = key;
            var chips = visible ? TerrainChips.For(terrain, terrainMode, faction) : null;
            string note = visible ? TerrainChips.HomeNote(terrain, terrainMode, faction) : null;
            bool any = chips != null && chips.Length > 0;
            if (any)
            {
                var sb = new System.Text.StringBuilder();
                for (int i = 0; i < chips.Length; i++) { if (i > 0) sb.Append("  "); sb.Append(chips[i].Glyph).Append(' ').Append(chips[i].Label).Append(" — ").Append(chips[i].Explanation); }
                _terrainChipText.text = sb.ToString();
            }
            else _terrainChipText.text = "";
            _terrainChipText.gameObject.SetActive(any);
            _terrainNoteText.text = note ?? "";
            _terrainNoteText.gameObject.SetActive(note != null);
            _terrainRow.gameObject.SetActive(any || note != null);
        }
    }
}
