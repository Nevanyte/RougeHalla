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
