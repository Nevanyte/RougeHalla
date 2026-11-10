// One sun for the whole map, shared by the ground, wall and prop shaders (presentation only; values come from the region
// atmosphere table through Shader globals set by RegionAtmosphere.cs). Hue and strength are blended per pixel from the same
// blurred region-weight textures the ground bakes, so walking across a border grades the light continuously across the screen.
#ifndef RH_SUN_INCLUDED
#define RH_SUN_INCLUDED

TEXTURE2D(_RhRegA); SAMPLER(sampler_RhRegA);
TEXTURE2D(_RhRegB); SAMPLER(sampler_RhRegB);
TEXTURE2D(_RhShadowMask); SAMPLER(sampler_RhShadowMask);
float4 _RhMapInfo;      // x map width (tiles), y map height, z vertical squash
float4 _RhSunCol[8];    // rgb = sun colour scaled by strength, per wire region id
float4 _RhAmbCol[8];    // rgb = ambient, a = sun strength (shadow opacity)
float4 _RhShadowCol[8]; // rgb = multiplier applied inside a cast shadow
float4 _RhSwitch;       // x sun shading, y shadows, z ice translucency, w heat shimmer (1 = on)
float4 _RhCam;          // xy = camera in tile space

// Blended sun terms for a world position. ndl: how much of the sun the surface receives (flat ground ~0.65, a south face 0).
float3 RhSunMul(float2 world, float ndl, out float strength, out float3 shadowMul)
{
    float2 t = float2(world.x, -world.y / _RhMapInfo.z);
    float2 uv = t / _RhMapInfo.xy;
    half4 wa = SAMPLE_TEXTURE2D_LOD(_RhRegA, sampler_RhRegA, uv, 0);
    half4 wb = SAMPLE_TEXTURE2D_LOD(_RhRegB, sampler_RhRegB, uv, 0);
    float w[6] = { wa.r, wa.g, wa.b, wa.a, wb.r, wb.g };
    float tot = 1e-3; float3 sun = 0, amb = 0, sh = 0; float st = 0;
    [unroll] for (int k = 0; k < 6; k++)
    {
        tot += w[k];
        sun += _RhSunCol[k + 1].rgb * w[k]; amb += _RhAmbCol[k + 1].rgb * w[k];
        sh += _RhShadowCol[k + 1].rgb * w[k]; st += _RhAmbCol[k + 1].a * w[k];
    }
    float inv = 1.0 / tot;
    strength = st * inv; shadowMul = sh * inv;
    float3 m = amb * inv + sun * inv * ndl;
    return lerp(float3(1, 1, 1), m, _RhSwitch.x);
}
#endif
