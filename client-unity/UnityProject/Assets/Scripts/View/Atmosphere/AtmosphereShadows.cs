using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Sun-directed contact shadow for actors: the existing soft blob stretched along the one sun direction, its length and opacity
    /// following the regional sun at the actor's position. It is the actor's own child sprite sorted under the body, darkening
    /// only, so it can never hide an actor, hp bar or telegraph. Reads the CPU region field; allocation free.
    /// </summary>
    public static class AtmosphereShadows
    {
        public static RegionField Field;
        static readonly float[] W = new float[RegionField.Regions];
        static readonly float AngleDeg = Mathf.Atan2(RegionShadowMap.ShadowPerHeight.y, RegionShadowMap.ShadowPerHeight.x) * Mathf.Rad2Deg;
        static readonly Vector2 Dir = RegionShadowMap.ShadowPerHeight.normalized;
        const float ContactLength = 1.2f, ContactWidth = .45f, ActorHeight = 1.9f;

        /// <summary>Pure shape maths (tested): strength 0..1 of the sun, length factor, returns the blob length in actor-local units.</summary>
        public static float BlobLength(float sunStrength, float lengthFactor)
        {
            return ContactLength + ActorHeight * .85f * Mathf.Clamp01(sunStrength) * Mathf.Max(0f, lengthFactor);
        }

        /// <summary>
        /// CPU estimate of the lit ground's linear relative luminance at a tile: the region palette's base colour (blended by region weights)
        /// under the ambient and the sun. It is only the tie break inside the outline's dead zone and the fallback when the camera sorting layer
        /// texture is unavailable; the real decision is made per pixel against the rendered ground (RhActorOutline.shader).
        /// </summary>
        public static float GroundLumaLinear(float tileX, float tileY)
        {
            if (Field == null || !Field.Ready) return .2f;
            Field.Sample(tileX, tileY, W); float luma = 0f;
            for (int k = 0; k < RegionField.Regions; k++)
            {
                var c = RegionPaletteGenerated.Srgb[k + 1][RegionPaletteGenerated.Base];
                luma += W[k] * ActorOutlineModel.Luma(Mathf.GammaToLinearSpace(c.r / 255f), Mathf.GammaToLinearSpace(c.g / 255f), Mathf.GammaToLinearSpace(c.b / 255f));
            }
            return luma * ActorOutlineModel.LitFactor;
        }

        /// <summary>True when the ground estimate is below the outline crossover (the stroke would be light).</summary>
        public static bool GroundIsDark(float tileX, float tileY) { return GroundLumaLinear(tileX, tileY) < ActorOutlineModel.Threshold; }

        /// <summary>Multiplier of the ground shadow sprite's own opacity profile (its core peaks at .8; the renderer alpha stays between .9 and 1). Tunable on measurement pages with <c>?sh.a=</c>, size with <c>?sh.s=</c>.</summary>
        public static float CoreAlpha = 1f, SizeScale = 1f;
        static bool _tuned;
        static void Tune()
        {
            if (_tuned) return; _tuned = true;
            string u; try { u = Application.absoluteURL; } catch (System.Exception) { return; }
            if (string.IsNullOrEmpty(u)) return;
            CoreAlpha = Query(u, "sh.a", CoreAlpha); SizeScale = Query(u, "sh.s", SizeScale);
        }
        static float Query(string url, string key, float fallback)
        {
            int i = url.IndexOf(key + "=", System.StringComparison.Ordinal); if (i < 0) return fallback;
            i += key.Length + 1; int j = i; while (j < url.Length && url[j] != '&' && url[j] != '#') j++;
            return float.TryParse(url.Substring(i, j - i), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float v) ? v : fallback;
        }

        /// <summary>Length and depth of the contact shadow in actor-local units (the look's foot box, widened a little), and of the cast shadow (that, stretched along the sun by the zone's sun strength and shadow length).</summary>
        public static void BlobSize(float footWidth, float footDepth, float sunStrength, float lengthFactor, out float length, out float depth)
        {
            float baseL = footWidth > 0f ? Mathf.Max(.55f, footWidth * 1.45f) : ContactLength, baseD = footDepth > 0f ? Mathf.Max(.28f, footDepth * 1.7f) : ContactWidth;
            length = baseL + ActorHeight * .85f * Mathf.Clamp01(sunStrength) * Mathf.Max(0f, lengthFactor) * .55f;
            depth = baseD;
        }

        /// <param name="shadow">the contact shadow: a firm soft ellipse under the feet, sized to the look's foot box, never stretched (it is what stops a figure floating)</param>
        /// <param name="cast">the cast shadow: the same ellipse stretched along the one sun direction by the zone's sun, softer and half as strong; may be null</param>
        /// <param name="footWidth">the look's foot box width in actor-local units (0: unknown, fixed contact size)</param>
        /// <param name="footDepth">the look's foot box depth, already squashed to the ground plane (0: unknown)</param>
        public static void ApplyActor(SpriteRenderer shadow, float tileX, float tileY, float footWidth = 0f, float footDepth = 0f, SpriteRenderer cast = null)
        {
            if (shadow == null) return;
            Tune();
            float strength = 0f, length = 0f;
            Color zone = new Color(.2f, .24f, .34f, 1f);   // the shadow's own colour when no zone is known: a cool near-black
            if (AtmosphereQuality.Shadows && AtmosphereQuality.SunLighting && Field != null && Field.Ready)
            {
                Field.Sample(tileX, tileY, W);
                float tr = 0, tg = 0, tb = 0;
                for (int k = 0; k < RegionField.Regions; k++)
                {
                    var p = RegionAtmosphereTable.Get(k + 1).Params; float w = W[k];
                    strength += p.SunStrength * w; length += p.ShadowLength * w;
                    tr += p.ShadowTint.r * w; tg += p.ShadowTint.g * w; tb += p.ShadowTint.b * w;
                }
                float m = Mathf.Max(.001f, Mathf.Max(tr, Mathf.Max(tg, tb)));
                zone = new Color(Mathf.Lerp(.2f, tr / m, .55f), Mathf.Lerp(.24f, tg / m, .55f), Mathf.Lerp(.34f, tb / m, .55f), 1f);
            }
            float baseL = footWidth > 0f ? Mathf.Max(.55f, footWidth * SizeScale * 1.45f) : ContactLength;
            BlobSize(footWidth * SizeScale, footDepth * SizeScale, strength, length, out float len, out float depth);
            float stretch = Mathf.Clamp01((len - baseL) / 1.0f);
            // Contact: centred just below the pivot, not rotated, the foot box's size.
            var tc = shadow.transform;
            tc.localScale = new Vector3(baseL, depth, 1f); tc.localRotation = Quaternion.identity; tc.localPosition = new Vector3(.03f, -.05f, 0f);
            // Colour: a near-black, tinted by the zone (a seventh of its tint, so it stays a shadow); alpha stays between .9 and 1 (the sprite's profile carries the opacity, peak .8).
            var rgb = new Color(zone.r * .14f, zone.g * .14f, zone.b * .14f, 1f);
            rgb.a = Mathf.Clamp01(CoreAlpha) * .95f; shadow.color = rgb;
            if (cast == null) return;
            var tr2 = cast.transform;
            cast.enabled = stretch > .02f;
            tr2.localScale = new Vector3(len, depth * Mathf.Lerp(1f, .8f, stretch), 1f);
            tr2.localRotation = Quaternion.Euler(0f, 0f, AngleDeg * stretch);
            float shift = (len - baseL) * .46f;
            tr2.localPosition = new Vector3(.03f + Dir.x * shift, -.05f + Dir.y * shift, 0f);
            rgb.a = Mathf.Clamp01(CoreAlpha) * .55f * Mathf.Clamp01(stretch * 2f); cast.color = rgb;
        }
    }
}
