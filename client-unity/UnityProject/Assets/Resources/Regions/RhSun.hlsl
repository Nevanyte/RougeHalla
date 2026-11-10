// One sun for the whole map, shared by the ground, wall and prop shaders (presentation only; values come from the region
// atmosphere table through Shader globals set by RegionAtmosphere.cs). Hue and strength are blended per pixel from the same
// blurred region-weight textures the ground bakes, so walking across a border grades the light continuously across the screen.
#ifndef RH_SUN_INCLUDED
#define RH_SUN_INCLUDED

TEXTURE2D(_RhRegA); SAMPLER(sampler_RhRegA);
TEXTURE2D(_RhRegB); SAMPLER(sampler_RhRegB);
TEXTURE2D(_RhShadowMask); SAMPLER(sampler_RhShadowMask);
float4 _RhMapInfo;      // x map width (tiles), y map height, z vertical squash, w 1 when the region texture's alpha holds the temple interior weight
float4 _RhSunCol[8];    // rgb = sun colour scaled by strength, per wire region id
float4 _RhAmbCol[8];    // rgb = ambient, a = sun strength (shadow opacity)
float4 _RhShadowCol[8]; // rgb = multiplier applied inside a cast shadow
float4 _RhFloorCol[8];  // rgb = passive-light floor (never below the global minimum), independent of every emitter
float4 _RhSwitch;       // x sun shading, y shadows, z ice translucency, w heat shimmer (1 = on)
float4 _RhCam;          // xy = camera in tile space
float4 _RhActors[8];    // xy = tile position of each presented (server-delivered) actor; surface effects clear a disc around them
float4 _RhActorN;       // x actor count, y cloud shadows on (1/0), z unused, w unused
float4 _RhCloud[8];     // per wire region id: x cloud shadow amount (0..1; cold/sunny zones only)
float4 _RhWind;         // xy unit wind direction (tile space), z sway strength (0 = off), w gust speed
float4 _RhFx;           // x water effects on (refraction, caustics, ripple glints), y/z/w reserved

float RhLNoise(float2 p)
{
    float2 i = floor(p), f = frac(p); f = f * f * (3.0 - 2.0 * f);
    float2 k = float2(123.34, 456.21);
    float4 h; float2 q;
    q = frac(i * k); q += dot(q, q + 45.32); h.x = frac(q.x * q.y);
    q = frac((i + float2(1, 0)) * k); q += dot(q, q + 45.32); h.y = frac(q.x * q.y);
    q = frac((i + float2(0, 1)) * k); q += dot(q, q + 45.32); h.z = frac(q.x * q.y);
    q = frac((i + float2(1, 1)) * k); q += dot(q, q + 45.32); h.w = frac(q.x * q.y);
    return lerp(lerp(h.x, h.y, f.x), lerp(h.z, h.w, f.x), f.y);
}

// 0 at a presented actor, 1 farther than about two tiles away: effects that could soften a character's silhouette multiply by this.
float RhActorClear(float2 t)
{
    float c = 1.0; int n = (int)_RhActorN.x;
    [loop] for (int j = 0; j < 8; j++)
    {
        if (j >= n) break;
        c = min(c, smoothstep(0.9, 2.2, distance(t, _RhActors[j].xy)));
    }
    return c;
}

// Blended sun terms for a world position. ndl: how much of the sun the surface receives (flat ground ~0.65, a south face 0).
float3 RhSunMul(float2 world, float ndl, out float strength, out float3 shadowMul)
{
    float2 t = float2(world.x, -world.y / _RhMapInfo.z);
    float2 uv = t / _RhMapInfo.xy;
    half4 wa = SAMPLE_TEXTURE2D_LOD(_RhRegA, sampler_RhRegA, uv, 0);
    half4 wb = SAMPLE_TEXTURE2D_LOD(_RhRegB, sampler_RhRegB, uv, 0);
    float w[6] = { wa.r, wa.g, wa.b, wa.a, wb.r, wb.g };
    float tot = 1e-3; float3 sun = 0, amb = 0, sh = 0, flo = 0; float st = 0;
    [unroll] for (int k = 0; k < 6; k++)
    {
        tot += w[k];
        sun += _RhSunCol[k + 1].rgb * w[k]; amb += _RhAmbCol[k + 1].rgb * w[k];
        sh += _RhShadowCol[k + 1].rgb * w[k]; st += _RhAmbCol[k + 1].a * w[k]; flo += _RhFloorCol[k + 1].rgb * w[k];
    }
    float inv = 1.0 / tot;
    strength = st * inv; shadowMul = sh * inv;
    // Marsh sunlight is dappled: slow drifting light and shade patches on the plague share of the pixel (weight index 2).
    float pat = sin(world.x * 1.3 + sin(world.y * 2.1) * 1.4) * sin(world.y * 1.5 + sin(world.x * 0.9 + _Time.y * 0.15) * 1.8);
    float dap = lerp(1.0, lerp(0.45, 1.3, smoothstep(-0.25, 0.55, pat)), saturate(w[2] * inv) * 0.9);
    // Drifting cloud shadows on the sunny zones: they only thin the sun term (the passive floor below still holds) and clear away from actors.
    float cl = 1.0;
    [branch] if (_RhActorN.y > 0.5 && ndl > 0.01)
    {
        float ca = 0; [unroll] for (int c = 0; c < 6; c++) ca += _RhCloud[c + 1].x * w[c];
        ca *= inv;
        [branch] if (ca > 0.01)
        {
            float2 cw = t * 0.05 + _RhWind.xy * (_Time.y * 0.022);
            float cn = RhLNoise(cw) * 0.55 + RhLNoise(cw * 2.1 + 5.2) * 0.3 + RhLNoise(cw * 4.3 + 1.7) * 0.15;
            cl = 1.0 - ca * smoothstep(0.5, 0.74, cn) * RhActorClear(t) * 0.62;
        }
    }
    float3 m = max(amb * inv + sun * inv * ndl * dap * cl, flo * inv);   // passive floor: ambient + sun never fall below it
    // Temple interior (profile row 7): even, warm, calm light with almost no cast shadow, blended by the baked interior weight in the region texture's alpha.
    float tw = wb.a * _RhMapInfo.w;
    float3 mT = max(_RhAmbCol[7].rgb + _RhSunCol[7].rgb * ndl, _RhFloorCol[7].rgb);
    m = lerp(m, mT, tw); strength = lerp(strength, _RhAmbCol[7].a, tw); shadowMul = lerp(shadowMul, _RhShadowCol[7].rgb, tw);
    return lerp(float3(1, 1, 1), m, _RhSwitch.x);
}
#endif
