// Pure rules of the adaptive actor outline (no UnityEngine: linked into RoguehallaNet.Tests). The shader (Resources/Shaders/RhActorOutline.shader)
// mirrors these constants; ActorOutlineModelTests pin the maths. Docs: docs/rework/CONTRAST_GATE.md, docs/rework/evidence/contrast/README.md.
//
// Why an adaptive, opaque, neutral stroke: against a ground of relative luminance Lg, a black stroke gives (Lg + .05) / (Ld + .05) and a white one gives
// (Ll + .05) / (Lg + .05). Below the crossover the white one is better, above it the black one, so a hard choice made against the ground actually behind
// the stroke always keeps at least sqrt((Ll + .05) / (Ld + .05)) (about 4 with the colours below) and normally far more, on any ground, without touching the landscape.
using System;

namespace Roguehalla.Client
{
    public static class ActorOutlineModel
    {
        /// <summary>Relative luminance the dark stroke shows on screen (near black, a touch of blue so it reads as ink rather than a hole).</summary>
        public const float DarkLuma = .004f;
        /// <summary>Relative luminance the light stroke shows on screen. HDR input of the shader is higher (see <see cref="LightLinear"/>) because the neutral tonemapper compresses it.</summary>
        public const float LightLuma = .86f;
        /// <summary>Linear colour the shader writes for the dark and the light stroke (the light one is a little above 1 to land at <see cref="LightLuma"/> after tonemapping; it is a few pixels wide so it does not visibly bloom).</summary>
        public const float DarkLinear = .004f, LightLinear = 1.5f;

        /// <summary>Stroke width in world units (final size on screen: 60 px per unit at 1080p, so 3 px; 4 px at 1440p: the same share of the figure).</summary>
        public const float Width = .05f;
        /// <summary>Radius (world units) and peak opacity of the calming halo around a figure on dark and mid ground (see RhActorOutline.shader).</summary>
        public const float HaloRadius = .16f, HaloStrength = .7f;

        /// <summary>Stroke width of marker outlines (hp track, footprint, insignia plate).</summary>
        public const float MarkerWidth = .04f;

        /// <summary>WCAG relative luminance of linear RGB.</summary>
        public static float Luma(float r, float g, float b) { return .2126f * r + .7152f * g + .0722f * b; }
        /// <summary>WCAG contrast ratio of two relative luminances.</summary>
        public static float Ratio(float a, float b) { float hi = Math.Max(a, b), lo = Math.Min(a, b); return (hi + .05f) / (lo + .05f); }

        /// <summary>
        /// Ground luminance (as the shader estimates it from the camera sorting layer texture, scaled by the post exposure) at which the stroke flips from dark to light.
        /// Measured with the contrast lab: a dark stroke is not black on screen in a bright, glowing zone (bloom and haze lift it to about .05 to .07), so the flip sits
        /// above the crossover of the nominal colours and below the crossover of the lifted ones. Ice (final luminance about .27) must stay dark, Plague bog (about .11 to .18) light; inside the dead zone one polarity is chosen per figure from the ground around its centre.
        /// </summary>
        public const float Threshold = .26f;
        /// <summary>The dark stroke's luminance on screen in the glowing zones (Fire lava, Holy light), after bloom and haze.</summary>
        public const float LiftedDarkLuma = .07f;

        /// <summary>Ground luminance at which the dark and the light stroke give the same ratio (for the given on-screen luminances).</summary>
        public static float Crossover(float darkLuma = DarkLuma, float lightLuma = LightLuma)
        {
            return (float)Math.Sqrt((darkLuma + .05) * (lightLuma + .05)) - .05f;
        }

        /// <summary>The ratio both strokes give at the crossover: the worst case of the hard choice.</summary>
        public static float WorstRatio(float darkLuma = DarkLuma, float lightLuma = LightLuma)
        {
            return (float)Math.Sqrt((lightLuma + .05) / (darkLuma + .05));
        }

        /// <summary>
        /// True when the stroke should be light. A hard choice with a small dead zone around the crossover: inside it the previous choice stays
        /// (temporal and spatial stability), so a figure on a light/dark boundary gets a clean split and never a grey blend.
        /// </summary>
        public static bool ChooseLight(float groundLuma, bool previousLight, float deadZone = DeadZone)
        {
            float t = Threshold;
            if (groundLuma < t - deadZone) return true;
            if (groundLuma > t + deadZone) return false;
            return previousLight;
        }

        /// <summary>Rough factor from the palette base luminance to the lit ground luminance (ambient plus sun) for the CPU estimate.</summary>
        public const float LitFactor = .85f;

        /// <summary>Half width of the dead zone, in luminance.</summary>
        public const float DeadZone = .06f;

        /// <summary>The ratio the chosen stroke gives against a ground of this luminance.</summary>
        public static float StrokeRatio(float groundLuma, bool previousLight)
        {
            bool light = ChooseLight(groundLuma, previousLight);
            return Ratio(light ? LightLuma : DarkLuma, groundLuma);
        }

        /// <summary>Ground luminance estimated on the CPU (the fallback when the camera sorting layer texture is unavailable): region palette base luminance lit by the ambient and the sun.</summary>
        public static float EstimateLit(float baseLuma, float ambient, float sun) { return Math.Max(0f, baseLuma * (ambient + sun)); }

        /// <summary>Texel margin a quad needs around a sprite so a stroke of <paramref name="widthWorld"/> fits: world width over world size of the sprite, plus one texel of safety, as a fraction of the sprite size.</summary>
        public static float PadFraction(float widthWorld, float spriteWorldSize) { return spriteWorldSize <= 1e-5f ? 0f : widthWorld / spriteWorldSize + .01f; }

        /// <summary>Opacity of the stroke for an actor state: dead actors keep a fainter one, hidden fighters follow the body's own alpha, everything else is opaque.</summary>
        public static float StateAlpha(bool dead, float hiddenAlpha) { return (dead ? .6f : 1f) * (hiddenAlpha < 0f ? 0f : hiddenAlpha > 1f ? 1f : hiddenAlpha); }
    }
}
