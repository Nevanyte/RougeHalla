// The owner's native readout strip: one text line per row of the viewer's own Collections.Readouts (counters, meters, marks as pips).
// Formatting lives in NativeReadoutText; this part only places and refreshes the text (presentation only).
using System.Text;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>HUD part that shows the owner native readout strip (counters, meters and mark pips) from the delivered readout rows.</summary>
    public sealed partial class MatchHud
    {
        TMP_Text _readoutStrip;
        object _readoutSource;

        void RefreshReadouts()
        {
            if (_session == null || _hud == null) return;
            var rows = _session.Collections.Readouts;
            if (ReferenceEquals(rows, _readoutSource) && _readoutStrip != null) return;
            _readoutSource = rows;
            if (_readoutStrip == null)
            {
                if (rows.Count == 0) return;
                _readoutStrip = Text(_hud, "NativeReadouts", "", .012f, .36f, .26f, .56f, 14);
                _readoutStrip.alignment = TextAlignmentOptions.TopLeft; _readoutStrip.enableWordWrapping = false;
                _readoutStrip.color = ShowcasePalette.MutedText; SetBaseSize(_readoutStrip, 8.5f);
                _readoutStrip.raycastTarget = false;
            }
            var sb = new StringBuilder();
            foreach (var line in NativeReadoutText.Lines(rows))
            {
                if (sb.Length > 0) sb.Append('\n');
                sb.Append(line.Text);
                if (line.Pips > 0)
                {
                    sb.Append("  ");
                    for (int p = 0; p < line.Pips; p++) sb.Append(p < line.PipsOn ? '#' : '.');
                }
            }
            Set(_readoutStrip, sb.ToString());
        }
    }
}
