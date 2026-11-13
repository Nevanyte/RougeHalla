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
        const float TerrainTile = 32f, TerrainWidth = 294f, ChipPad = 6f;
        const float TerrainLine = 18f;
        RectTransform _terrainRow;
        TMP_Text _terrainNoteText;
        string _terrainNote;
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
                image.color = new Color(10f / 255f, 12f / 255f, 16f / 255f, .8f);
                var outline = rect.gameObject.AddComponent<UnityEngine.UI.Outline>(); outline.effectDistance = new Vector2(1f, 1f); outline.useGraphicAlpha = false;
                var label = HudUi.Label(rect, "Label", "", theme.SizeSmall, theme.Warning, TextAlignmentOptions.Center, bold: true);
                label.enableWordWrapping = false;
                var button = rect.gameObject.AddComponent<UnityEngine.UI.Button>();
                button.targetGraphic = image;
                button.navigation = new UnityEngine.UI.Navigation { mode = UnityEngine.UI.Navigation.Mode.None };
                var hint = HudIconHint.Attach(button, _root != null ? _root : _hud, "");
                _terrainChips.Add(new TerrainChip { Rect = rect, Label = label, Hint = hint });
            }
            return _terrainChips[i];
        }

        static Color ChipColor(string id)
        {
            switch (id)
            {
                case "burning": return new Color32(0xff, 0x8a, 0x3d, 255);
                case "slowed": return new Color32(0xae, 0xd5, 0x81, 255);
                case "ice": return new Color32(0x81, 0xd4, 0xfa, 255);
                default: return new Color32(0xff, 0xd5, 0x4f, 255);
            }
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

        /// <summary>
        /// Sizes the home-ground note's box to its text at the size the text-size setting asks for (a second wrapped line grows the box), then
        /// fits the label to it. Run when the note changes and again whenever the setting does.
        /// </summary>
        void LayoutTerrainNote()
        {
            if (_terrainRow == null || _terrainNoteText == null) return;
            string note = _terrainNote;
            float noteY = _terrainShown * TerrainLine, noteH = TerrainLine;
            var follow = _terrainNoteText.GetComponent<MythicTextScale>();
            float scale = _showcaseSettings != null ? _showcaseSettings.TextScale : 1f;
            if (note != null)
            {
                if (follow != null) { _terrainNoteText.enableAutoSizing = false; _terrainNoteText.fontSize = follow.BaseSize * Mathf.Clamp(scale, .85f, 1.5f); }
                noteH = Mathf.Max(TerrainLine, Mathf.Ceil(_terrainNoteText.GetPreferredValues(note, TerrainWidth, 0f).y));
                var noteRect = _terrainNoteText.transform.parent as RectTransform;
                HudUi.Place(noteRect, HudAnchor.TopLeft, 0, noteY, TerrainWidth, noteH);
                if (follow != null) follow.Apply(scale);
            }
            _terrainHeight = noteY + (note != null ? noteH : 0f);
            if (_terrainHeight <= 0f) _terrainHeight = TerrainLine;
            if (_terrainTop >= 0f) HudUi.Place(_terrainRow, HudAnchor.TopLeft, PlateLeft, _terrainTop, TerrainWidth, _terrainHeight);
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
                var noteBack = HudUi.At(_terrainRow, "Note", 0, 0, TerrainWidth, TerrainLine);
                noteBack.gameObject.AddComponent<UnityEngine.UI.Image>().color = new Color(10f / 255f, 12f / 255f, 16f / 255f, .8f);
                _terrainNoteText = HudUi.Label(noteBack, "Label", "", theme.SizeSmall, theme.Success, TextAlignmentOptions.TopLeft, wrap: true);
                _terrainRow.gameObject.SetActive(false);
            }
            if (visible && _vitalsPanel != null)
            {
                float top = PlateTop + _vitalsPanel.sizeDelta.y + 4f;
                if (!Mathf.Approximately(top, _terrainTop)) { _terrainTop = top; HudUi.Place(_terrainRow, HudAnchor.TopLeft, PlateLeft, top, TerrainWidth, _terrainHeight); }
            }
            if (key == _terrainKey) { PlaceHuntPanel(); return; }
            _terrainKey = key;
            var chips = visible ? TerrainChips.For(terrain, terrainMode, faction) : null;
            string note = visible ? TerrainChips.HomeNote(terrain, terrainMode, faction) : null;
            int count = chips != null ? chips.Length : 0;
            for (int i = 0; i < _terrainChips.Count; i++) _terrainChips[i].Rect.gameObject.SetActive(i < count);
            for (int i = 0; i < count; i++)
            {
                var chip = TerrainChipAt(i);
                var tone = ChipColor(chips[i].Id);   // legacy terrainChips.css --c
                chip.Label.color = tone; chip.Rect.GetComponent<UnityEngine.UI.Outline>().effectColor = tone;
                chip.Label.text = chips[i].Glyph + " " + chips[i].Label;
                // A pill sized to its text (P-UNITY-HUD-VISUAL-FIX-4), not a full-width bar.
                float pill = Mathf.Ceil(chip.Label.GetPreferredValues(chip.Label.text, 1000f, 0f).x) + ChipPad * 2f;
                HudUi.Place(chip.Rect, HudAnchor.TopLeft, 0, i * TerrainLine, pill, TerrainLine);
                chip.Hint.Text = chips[i].Explanation;
                chip.Rect.gameObject.SetActive(true);
            }
            _terrainShown = count;
            _terrainNote = note;
            _terrainNoteText.text = note ?? "";
            _terrainNoteText.gameObject.SetActive(note != null);
            _terrainNoteText.transform.parent.GetComponent<UnityEngine.UI.Image>().enabled = note != null;
            LayoutTerrainNote();
            _terrainRow.gameObject.SetActive(count > 0 || note != null);
            PlaceHuntPanel();
        }

        /// <summary>The Hunt card sits below the plate, and below the chip row (and home-ground note) when one is shown.</summary>
        void PlaceHuntPanel()
        {
            if (_huntPanel == null) return;
            float top = PlateTop + (_vitalsPanel != null ? _vitalsPanel.sizeDelta.y : 148f) + 4f;
            if (_terrainRow != null && _terrainRow.gameObject.activeSelf && _terrainTop >= 0f) top = _terrainTop + _terrainHeight + 4f;
            _huntPanel.SetTop(top);
        }
    }
}
