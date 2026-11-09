using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Shared high-contrast colors for the dark mythic showcase presentation.</summary>
    public static class ShowcasePalette
    {
        public static readonly Color32 Background = new Color32(9, 13, 20, 255);
        public static readonly Color32 Panel = new Color32(17, 24, 35, 248);
        public static readonly Color32 PanelRaised = new Color32(27, 38, 53, 255);
        public static readonly Color32 PanelStroke = new Color32(65, 81, 101, 255);
        public static readonly Color32 Text = new Color32(244, 242, 235, 255);
        public static readonly Color32 MutedText = new Color32(181, 195, 210, 255);
        public static readonly Color32 Gold = new Color32(237, 199, 123, 255);
        public static readonly Color32 GoldDim = new Color32(144, 107, 52, 255);
        public static readonly Color32 Success = new Color32(140, 224, 178, 255);
        public static readonly Color32 Warning = new Color32(255, 173, 130, 255);

        static readonly Color32[] FactionColors =
        {
            new Color32(255, 126, 94, 255), // Fire
            new Color32(205, 184, 255, 255), // Sentenced
            new Color32(178, 220, 128, 255), // Plague
            new Color32(120, 210, 239, 255), // Frost
            new Color32(255, 226, 145, 255), // Holy
        };

        static readonly string[] FactionNames = { "Fire", "Sentenced", "Plague", "Frost", "Holy" };

        // ASCII-safe labels remain distinct if a platform font lacks the decorative glyph.
        static readonly string[] FactionMarks = { "[F]", "[S]", "[P]", "[I]", "[H]" };

        public static Color32 Faction(int faction)
        {
            return faction >= 0 && faction < FactionColors.Length ? FactionColors[faction] : MutedText;
        }

        public static string GetFactionName(int faction)
        {
            return faction >= 0 && faction < FactionNames.Length ? FactionNames[faction] : "Unknown";
        }

        public static string GetFactionMark(int faction)
        {
            return faction >= 0 && faction < FactionMarks.Length ? FactionMarks[faction] : "[?]";
        }

        /// <summary>WCAG 2.1 relative-luminance contrast ratio, useful for UI palette checks.</summary>
        public static float ContrastRatio(Color foreground, Color background)
        {
            float a = RelativeLuminance(foreground);
            float b = RelativeLuminance(background);
            float lighter = Mathf.Max(a, b), darker = Mathf.Min(a, b);
            return (lighter + 0.05f) / (darker + 0.05f);
        }

        static float RelativeLuminance(Color color)
        {
            float r = Linear(color.r), g = Linear(color.g), b = Linear(color.b);
            return 0.2126f * r + 0.7152f * g + 0.0722f * b;
        }

        static float Linear(float value)
        {
            return value <= 0.04045f ? value / 12.92f : Mathf.Pow((value + 0.055f) / 1.055f, 2.4f);
        }
    }
}
