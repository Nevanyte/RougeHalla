// Analytic local lights shared by the region ground, wall and prop shaders (presentation only).
//
// LocalLightField.cs gathers every light in view (terrain accents, lanterns, temple lamps, Wish and impact flashes, fireflies, embers)
// into two fixed arrays. Each surface evaluates them per pixel with a distance early-out, so a light shapes the surface it falls on:
//   * relief   : a "delta Lambert" term. A flat surface keeps exactly the brightness a flat light would give; slopes facing the light get
//                brighter, slopes facing away darker (normals come from the baked ground height, the wall face, or the painted luma).
//   * shadows  : soft penumbra from the wall grid by sphere tracing a baked signed-distance texture (_RhWallSdf). Surfaces only; actors
//                are never darkened by it, so darkness cannot hide a visible character.
//   * cookies  : procedural light patterns (grated lantern, leaf dapple, stained glass).
//   * gloss    : a broad specular on polished or wet surfaces (ice, water, temple floor, wet flags).
// All positions are in tile space (x right, y down, z up); the radius is measured in screen space (the ground is drawn squashed).
#ifndef RH_LOCAL_LIGHTS_INCLUDED
#define RH_LOCAL_LIGHTS_INCLUDED

#define RH_MAX_LIGHTS 24
float4 _RhLP[RH_MAX_LIGHTS];   // xy tile position, z height (tiles), w radius (tiles, screen measure)
float4 _RhLC[RH_MAX_LIGHTS];   // rgb colour x intensity (already faded and flickered), a = cookie id + 0.5 when the light casts shadows
float4 _RhLI;                  // x light count, y relief amount (0 off), z shadow amount (0 off), w cookie amount (0 off)
float4 _RhLG;                  // x gloss amount (0 off)
TEXTURE2D(_RhWallSdf); SAMPLER(sampler_RhWallSdf);

// Signed distance (tiles, negative inside a wall) from the baked texture; encoded as 0.5 + d / 8.
float RhWallDist(float2 t)
{
    return (SAMPLE_TEXTURE2D_LOD(_RhWallSdf, sampler_RhWallSdf, t / _RhMapInfo.xy, 0).r - 0.5) * 8.0;
}

// Soft shadow of the wall grid between a surface point p and a light l (tile space): 1 lit, 0 in full shade.
float RhShadowVis(float2 p, float2 l, float k)
{
    float2 dir = l - p; float len = length(dir);
    if (len < 0.9) return 1.0;
    if (RhWallDist(p) < 0.0) return 1.0;          // a wall top is the lit roof of its own block
    dir /= len;
    float tEnd = len - 0.7, t = 0.3, res = 1.0;
    [loop] for (int s = 0; s < 14; s++)
    {
        if (t >= tEnd) break;
        float d = RhWallDist(p + dir * t);
        res = min(res, k * d / t);
        if (res < 0.03) break;
        t += clamp(d, 0.18, 1.2);
    }
    return smoothstep(0.0, 1.0, saturate(res));
}

// True when any light's radius reaches this point: lets the caller skip normals and everything else far from light.
bool RhAnyLight(float2 pt)
{
    int n = (int)_RhLI.x;
    [loop] for (int i = 0; i < RH_MAX_LIGHTS; i++)
    {
        if (i >= n) break;
        float2 d = (_RhLP[i].xy - pt) * float2(1.0, _RhMapInfo.z);
        float r = _RhLP[i].w;
        if (dot(d, d) < r * r) return true;
    }
    return false;
}

float3 RhGlassTint(float2 id)
{
    float h = frac(sin(dot(id, float2(12.9898, 78.233))) * 43758.5453);
    return h < 0.2 ? float3(1.0, 0.45, 0.30) : h < 0.4 ? float3(1.0, 0.82, 0.30) : h < 0.6 ? float3(0.35, 0.80, 0.60) : h < 0.8 ? float3(0.35, 0.60, 1.0) : float3(0.85, 0.45, 0.95);
}

// pt: tile position. n: tile-space normal (z up). gloss: specular amount for this surface (0 matte). shin: specular exponent.
// shadowAmt: how strongly the wall shadow applies (0 for surfaces that are walls themselves). diffuse is multiplied by the albedo by the
// caller; spec is added as is.
// cookieAmt: how much the light patterns show (0 for actors). rimAmt: thin light on the edge facing a light (characters; added to spec).
void RhLocalLights(float2 pt, float3 n, float gloss, float shin, float shadowAmt, float cookieAmt, float rimAmt, out float3 diffuse, out float3 spec)
{
    diffuse = 0; spec = 0;
    int cnt = (int)_RhLI.x;
    float relief = _RhLI.y * 1.35;
    float time = _Time.y;
    [loop] for (int i = 0; i < RH_MAX_LIGHTS; i++)
    {
        if (i >= cnt) break;
        float4 lp = _RhLP[i];
        float2 dv = lp.xy - pt;
        float dScr = length(dv * float2(1.0, _RhMapInfo.z));
        if (dScr >= lp.w) continue;
        float4 lc = _RhLC[i];
        float a2 = saturate((1.0 - dScr / lp.w) * 1.3);
        float att = a2 * a2 * (3.0 - 2.0 * a2);
        float3 ln = normalize(float3(dv, lp.z));
        float diff = clamp(1.0 + (dot(n, ln) - ln.z) * relief, 0.3, 1.7);
        float cid = floor(lc.a);
        float vis = 1.0, cm = 1.0; float3 tint = 1.0;
        [branch] if (_RhLI.z > 0.5 && shadowAmt > 0.01 && lc.a - cid > 0.25)
            vis = lerp(1.0, RhShadowVis(pt, lp.xy, 5.0), shadowAmt);
        [branch] if (cid > 0.5 && _RhLI.w > 0.5 && cookieAmt > 0.01)
        {
            float2 q = pt - lp.xy;
            if (cid < 1.5)            // grated lantern: slow, waving cage bars of shade around the flame
            {
                float ang = atan2(q.y, q.x);
                float s = abs(sin(ang * 4.0 + time * 0.22 + sin(time * 1.7) * 0.25));
                cm = lerp(1.0, lerp(0.55, 1.2, smoothstep(0.1, 0.75, s)), saturate(a2 * 2.2));
            }
            else if (cid < 2.5)       // leaf dapple: drifting light and shade through foliage
            {
                float2 w = pt * 1.25 + float2(time * 0.09, time * 0.04);
                float nz = RhLNoise(w) * 0.6 + RhLNoise(w * 2.1 + 7.0) * 0.4;
                cm = lerp(1.0, lerp(0.35, 1.4, smoothstep(0.30, 0.70, nz)), saturate(a2 * 1.8));
            }
            else                      // stained glass: coloured wedges of light with dark leading
            {
                float ang = atan2(q.y, q.x) / 6.2832 + 0.5;
                float sec = ang * 10.0, ring = dScr * 1.1;
                float2 id = float2(floor(sec), floor(ring));
                float lead = max(1.0 - smoothstep(0.0, 0.06, abs(frac(sec) - 0.5) * 2.0 - 0.94), 1.0 - smoothstep(0.0, 0.05, abs(frac(ring) - 0.5) * 2.0 - 0.94));
                tint = lerp(1.0, RhGlassTint(id), 0.62 * saturate(a2 * 1.5));
                cm = 1.0 - 0.55 * lead;
            }
        }
        cm = lerp(1.0, cm, cookieAmt); tint = lerp(1.0, tint, cookieAmt);
        float3 lcol = lc.rgb * (att * vis * cm);
        diffuse += lcol * tint * diff;
        [branch] if (rimAmt > 0.01)
        {
            float2 ld = normalize(dv + 1e-4);
            spec += lcol * tint * (pow(saturate(1.0 - n.z), 1.5) * saturate(dot(normalize(n.xy + 1e-4), ld) * 1.4) * rimAmt);
        }
        [branch] if (gloss > 0.01 && _RhLG.x > 0.5)
        {
            float3 h = normalize(ln + float3(0.0, 0.45, 0.9));
            spec += lcol * tint * (pow(saturate(dot(n, h)), shin) * gloss);
        }
    }
}

#endif
