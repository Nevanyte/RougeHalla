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

        /// <summary>Pure: rim opacity for a ground of the given relative luminance (0 black .. 1 white): strong on dark ground, faint on light ground.</summary>
        public static float RimAlpha(float groundLuma) { return Mathf.Lerp(.2f, 1f, 1f - Mathf.Clamp01(groundLuma * 1.5f)); }

        /// <summary>Character separation: the soft light rim outside the dark outline, tuned to the ground under the actor (palette base luminance blended by region weights).</summary>
        public static void ApplyRim(SpriteRenderer rim, float tileX, float tileY, float scale)
        {
            if (rim == null) return;
            float luma = .5f;
            if (Field != null && Field.Ready)
            {
                Field.Sample(tileX, tileY, W); luma = 0f;
                for (int k = 0; k < RegionField.Regions; k++)
                { var c = RegionPaletteGenerated.Srgb[k + 1][RegionPaletteGenerated.Base]; luma += W[k] * (.2126f * c.r + .7152f * c.g + .0722f * c.b) / 255f; }
            }
            float dark = 1f - Mathf.Clamp01(luma * 1.5f);
            rim.transform.localScale *= 1f + .07f * dark;          // a slightly wider light rim on dark ground (the presenter resets the scale every frame)
            float boost = 1f + 1.3f * dark * dark;                      // HDR rim on dark ground: the sprite is lit by the zone light, so a plain white rim is only about L 0.3 there
            rim.color = new Color(.97f * boost, .98f * boost, boost, RimAlpha(luma) * Mathf.Clamp01(scale));
        }

        public static void ApplyActor(SpriteRenderer shadow, float tileX, float tileY)
        {
            if (shadow == null) return;
            float strength = 0f, length = 0f; Color tint = new Color(1f, 1f, 1f, 1f);
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
                tint = new Color(Mathf.Lerp(1f, tr / m, .55f), Mathf.Lerp(1f, tg / m, .55f), Mathf.Lerp(1f, tb / m, .55f), 1f);
            }
            float len = BlobLength(strength, length);
            float stretch = Mathf.Clamp01((len - ContactLength) / 1.4f);
            var tr2 = shadow.transform;
            tr2.localScale = new Vector3(len, Mathf.Lerp(ContactWidth, ContactWidth * .85f, stretch), 1f);
            tr2.localRotation = Quaternion.Euler(0f, 0f, AngleDeg * stretch);
            float shift = (len - ContactLength) * .46f;
            tr2.localPosition = new Vector3(.13f + Dir.x * shift, -.04f + Dir.y * shift, 0f);
            tint.a = Mathf.Lerp(.85f, 1f, stretch);
            shadow.color = tint;
        }
    }
}
