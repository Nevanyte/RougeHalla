using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client
{
    public enum UiFontRole { Body, Display }

    /// <summary>
    /// The single seam for the in-match HUD's look. Every colour, font, corner radius, border width and panel sprite the HUD uses is
    /// read from <see cref="Current"/>, so assigning a different theme (or editing these values) reskins the whole HUD.
    /// The shipped values are a neutral, bright placeholder (parchment surfaces, dark ink text, WCAG 4.5:1 for text roles);
    /// the real palette maps onto the same tokens later. No layout lives here.
    /// </summary>
    public sealed class UiTheme
    {
        static UiTheme _current;
        public static event Action Changed;

        public static UiTheme Current
        {
            get { return _current ?? (_current = Placeholder()); }
            set { _current = value ?? Placeholder(); Changed?.Invoke(); }
        }

        // Surfaces.
        public Color32 Surface;          // panels, cards, plates
        public Color32 SurfaceRaised;    // buttons, rows, chips resting on a surface
        public Color32 SurfaceSunken;    // meter troughs, map backing, inset wells
        public Color32 SurfaceHover;     // hovered / highlighted control fill
        public Color32 SurfaceSelected;  // selected / pressed control fill
        public Color32 SurfaceDisabled;  // disabled control fill
        public Color32 Border;           // hairlines and frames
        public Color32 BorderStrong;     // emphasised frames (active slot, focus)
        public Color32 Scrim;            // full-screen dim behind a modal (alpha carries the strength)
        // Text.
        public Color32 TextPrimary;      // ink on Surface / SurfaceRaised
        public Color32 TextSecondary;    // labels, hints, keycaps
        // Semantic accents.
        public Color32 Accent;           // reward / selection / "gold"
        public Color32 AccentDim;        // accent borders, primary-button fill
        public Color32 Danger;           // refusal, low health, death
        public Color32 Success;          // healthy, ready, own gain
        public Color32 Warning;          // low-ish, amber states
        public Color32 Info;             // barrier / shield blue
        // The five faction accents (Fire, Sentenced, Plague, Frost, Holy). Used as text on Surface, so they hold 4.5:1.
        public Color32[] Faction = new Color32[5];
        // Build stat tints: Offense, Soul, Defense, Soul defense, Health, Attack speed, Move speed, Life steal.
        public Color32[] Stat = new Color32[8];

        // Font roles and sizes (HUD px = stage units).
        public string BodyFontResource = "Fonts & Materials/LiberationSans SDF";
        public string DisplayFontResource = "Showcase/CinzelDecorative";
        public float SizeDisplay = 44f;   // "YOU DIED"
        public float SizeHeading = 17f;   // card titles
        public float SizeBody = 13f;      // settings / help rows
        public float SizeSmall = 11f;     // plate values, chips
        public float SizeTiny = 10f;      // labels, key caps
        public float SizeMicro = 9f;      // scaling lines

        // Shape.
        public float CornerRadius = 6f;
        public float CornerRadiusSmall = 3f;
        public float CornerRadiusLarge = 8f;
        public float BorderWidth = 1f;
        /// <summary>Optional 9-sliced panel sprite. Null uses a generated rounded rectangle at <see cref="CornerRadius"/>.</summary>
        public Sprite PanelSprite;
        /// <summary>Optional 9-sliced frame sprite drawn over panels in the border colour. Null uses a generated ring.</summary>
        public Sprite FrameSprite;

        static readonly Dictionary<string, TMP_FontAsset> FontCache = new Dictionary<string, TMP_FontAsset>();

        public TMP_FontAsset Font(UiFontRole role)
        {
            string path = role == UiFontRole.Display ? DisplayFontResource : BodyFontResource;
            TMP_FontAsset font;
            if (!string.IsNullOrEmpty(path) && FontCache.TryGetValue(path, out font) && font != null) return font;
            font = string.IsNullOrEmpty(path) ? null : Resources.Load<TMP_FontAsset>(path);
            if (font == null && role == UiFontRole.Display) font = Font(UiFontRole.Body);
            if (font == null) font = Resources.Load<TMP_FontAsset>("Fonts & Materials/LiberationSans SDF") ?? TMP_Settings.defaultFontAsset;
            if (!string.IsNullOrEmpty(path) && font != null) FontCache[path] = font;
            return font;
        }

        public Color32 FactionColor(int faction)
        {
            return faction >= 0 && faction < Faction.Length ? Faction[faction] : TextSecondary;
        }

        public Color32 StatColor(int stat)
        {
            return stat >= 0 && stat < Stat.Length ? Stat[stat] : TextPrimary;
        }

        /// <summary>Every colour token (RGB only matters; alpha is a per-use opacity).</summary>
        public IEnumerable<Color32> AllColors()
        {
            yield return Surface; yield return SurfaceRaised; yield return SurfaceSunken; yield return SurfaceHover;
            yield return SurfaceSelected; yield return SurfaceDisabled; yield return Border; yield return BorderStrong;
            yield return Scrim; yield return TextPrimary; yield return TextSecondary; yield return Accent; yield return AccentDim;
            yield return Danger; yield return Success; yield return Warning; yield return Info;
            foreach (var c in Faction) yield return c;
            foreach (var c in Stat) yield return c;
        }

        /// <summary>True when the colour's RGB is one of this theme's tokens (clear and fully transparent colours are neutral).</summary>
        public bool Owns(Color color)
        {
            if (color.a <= 0.001f) return true;
            var c = (Color32)color;
            foreach (var token in AllColors())
                if (token.r == c.r && token.g == c.g && token.b == c.b) return true;
            return false;
        }

        public static Color With(Color32 color, float alpha) { Color c = color; c.a = alpha; return c; }

        /// <summary>Neutral, bright, readable stand-in until the palette lands: light parchment, dark ink.</summary>
        public static UiTheme Placeholder()
        {
            var t = new UiTheme
            {
                Surface = new Color32(244, 235, 214, 245),
                SurfaceRaised = new Color32(252, 247, 233, 255),
                SurfaceSunken = new Color32(226, 214, 187, 255),
                SurfaceHover = new Color32(255, 243, 205, 255),
                SurfaceSelected = new Color32(238, 214, 150, 255),
                SurfaceDisabled = new Color32(214, 206, 188, 255),
                Border = new Color32(122, 94, 56, 255),
                BorderStrong = new Color32(138, 90, 18, 255),
                Scrim = new Color32(38, 28, 18, 140),
                TextPrimary = new Color32(38, 28, 18, 255),
                TextSecondary = new Color32(84, 66, 44, 255),
                Accent = new Color32(138, 90, 18, 255),
                AccentDim = new Color32(190, 150, 70, 255),
                Danger = new Color32(170, 40, 36, 255),
                Success = new Color32(36, 110, 60, 255),
                Warning = new Color32(150, 84, 0, 255),
                Info = new Color32(24, 92, 150, 255),
            };
            t.Faction = new[]
            {
                new Color32(170, 52, 20, 255),   // Fire
                new Color32(96, 56, 150, 255),   // Sentenced
                new Color32(62, 106, 24, 255),   // Plague
                new Color32(20, 96, 150, 255),   // Frost
                new Color32(128, 94, 0, 255),    // Holy
            };
            t.Stat = new[]
            {
                new Color32(176, 72, 36, 255),   // Offense
                new Color32(120, 72, 176, 255),  // Soul
                new Color32(44, 108, 160, 255),  // Defense
                new Color32(24, 120, 104, 255),  // Soul defense
                new Color32(36, 130, 76, 255),   // Health
                new Color32(160, 104, 16, 255),  // Attack speed
                new Color32(20, 120, 150, 255),  // Move speed
                new Color32(160, 64, 130, 255),  // Life steal
            };
            return t;
        }
    }
}
