// Analytic local lights shared by the region ground, wall and prop shaders (presentation only).
//
// LocalLightField.cs gathers every light in view (terrain accents, lanterns, temple lamps, Wish and impact flashes, fireflies, embers)
// into two fixed arrays. Each surface evaluates them per pixel with a distance early-out, so a light shapes the surface it falls on:
//   * relief   : a "delta Lambert" term. A flat surface keeps exactly the brightness a flat light would give; slopes facing the light get
//                brighter, slopes facing away darker (normals come from the baked ground height, the wall face, or the painted luma).
//   * shadows  : soft penumbra from the wall grid, traced once per light on the CPU against a baked signed-distance field and stored in a small atlas (LightShadowAtlas.cs). Surfaces only; actors
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

// Baked wall shadows of the nearest shadowing lights: LightShadowAtlas.cs traces them once on the CPU (the lights and the walls never move) into
// five squares side by side; each covers the light's radius. The shader only samples it.
TEXTURE2D(_RhShadowAtlas); SAMPLER(sampler_RhShadowAtlas);

// Headroom of an already lit pixel: 1 while its brightest channel is below about 0.59, falling to 0 at 0.92. Local lights add through this, so a light
// never blows out a surface that is already bright (sunlit sand, snow, the temple floor): they shape and warm it, and add fully where it is dark.
float RhHeadroom(float3 litRgb) { return saturate((0.92 - max(litRgb.r, max(litRgb.g, litRgb.b))) * 3.0); }

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
        if (att < 0.03) continue;                       // the faint rim of a light: not worth a shadow trace or a cookie
        float3 ln = normalize(float3(dv, lp.z));
        float diff = clamp(1.0 + (dot(n, ln) - ln.z) * relief, 0.3, 1.7);
        float cid = floor(lc.a);
        float vis = 1.0, cm = 1.0; float3 tint = 1.0;
        float sl = round((lc.a - cid) / 0.05) - 1.0;          // baked shadow slot of this light, -1 = none
        [branch] if (_RhLI.z > 0.5 && shadowAmt > 0.01 && sl > -0.5)
        {
            float2 q = clamp((pt - lp.xy) / (lp.w / _RhMapInfo.z) * 0.5 + 0.5, 0.0052, 0.9948);
            vis = lerp(1.0, SAMPLE_TEXTURE2D_LOD(_RhShadowAtlas, sampler_RhShadowAtlas, float2((sl + q.x) * 0.2, q.y), 0).r, shadowAmt);
        }
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
