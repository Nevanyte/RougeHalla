// Single-pass region ground for the whole map (one quad, one draw call), URP 2D lit so Light2D still applies.
// Inputs are public server data only: a per-tile region plane and a per-tile terrain plane, both baked on the CPU into
// small blurred weight textures (RegionGround.cs). Colours come from the generated palette table, never from this file.
//   _RegA  rgba = weights of region 1..4 (fire, sentenced, plague, frost)       bilinear, 2 texels per tile
//   _RegB  rg   = weights of region 5, 6 (holy, coliseum)
//   _TerA  rgba = coverage of terrain lava, ice, bog, ember                       bilinear, 4 texels per tile
//   _TerB  rgba = coverage of terrain light, crevasse
//   _GroundTex  2D array, one layer per region: r detail, g secondary mask, b accent mask, a height
Shader "Roguehalla/RegionGround"
{
    Properties
    {
        _MainTex("Unused (sprite pipeline needs one)", 2D) = "white" {}
        _GroundTex("Ground detail array", 2DArray) = "" {}
        _RegA("Region weights A", 2D) = "black" {}
        _RegB("Region weights B", 2D) = "black" {}
        _TerA("Terrain A", 2D) = "black" {}
        _TerB("Terrain B", 2D) = "black" {}
        _PlgTex("Plague ground", 2D) = "black" {}
        _Exposure("Exposure", Float) = 1
        _Debug("Debug", Float) = 0
    }

    SubShader
    {
        Tags {"Queue" = "Transparent" "RenderType" = "Transparent" "RenderPipeline" = "UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha, One OneMinusSrcAlpha
        Cull Off
        ZWrite Off

        Pass
        {
            Tags { "LightMode" = "Universal2D" }

            HLSLPROGRAM
            #pragma target 3.5
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/Shaders/2D/Include/Core2D.hlsl"

            #pragma vertex Vert
            #pragma fragment Frag

            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/Shaders/2D/Include/ShapeLightShared.hlsl"

            struct Attributes
            {
                float3 positionOS : POSITION;
                float2 uv         : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 world      : TEXCOORD0;
                half2  lightingUV : TEXCOORD1;
            };

            #include "Packages/com.unity.render-pipelines.universal/Shaders/2D/Include/LightingUtility.hlsl"

            TEXTURE2D_ARRAY(_GroundTex); SAMPLER(sampler_GroundTex);
            TEXTURE2D(_RegA); SAMPLER(sampler_RegA);
            TEXTURE2D(_RegB); SAMPLER(sampler_RegB);
            TEXTURE2D(_TerA); SAMPLER(sampler_TerA);
            TEXTURE2D(_TerB); SAMPLER(sampler_TerB);
            TEXTURE2D(_PlgTex); SAMPLER(sampler_PlgTex);   // r shallow water, g grass, b water depth (Plague only)

            #if USE_SHAPE_LIGHT_TYPE_0
            SHAPE_LIGHT(0)
            #endif
            #if USE_SHAPE_LIGHT_TYPE_1
            SHAPE_LIGHT(1)
            #endif
            #if USE_SHAPE_LIGHT_TYPE_2
            SHAPE_LIGHT(2)
            #endif
            #if USE_SHAPE_LIGHT_TYPE_3
            SHAPE_LIGHT(3)
            #endif

            #include "Packages/com.unity.render-pipelines.universal/Shaders/2D/Include/CombinedShapeLightShared.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half _Exposure;
                half _Debug;
            CBUFFER_END
            #include "RhSun.hlsl"
            // x = map width (tiles), y = map height, z = vertical squash, w = seconds scale
            float4 _Map;
            // Region table, index = wire region id 0..7 (7 unused). Colours are linear-agnostic sRGB bytes as 0..1.
            float4 _PalBase[8];
            float4 _PalSec[8];
            float4 _PalAcc[8];
            float4 _PalKey[8];
            // x detail contrast, y secondary amount, z accent amount, w pocket threshold (0 = none; secondary greenery fills pockets above it)
            float4 _PalPar[8];
            // x macro variation, y accent emission, z highlight toward the key colour (brightest detail), w glint intensity
            float4 _PalPar2[8];
            // Terrain table, index = kind 0..7. rgb colour A (deep), _TerLight (light), _TerGlow (emissive).
            float4 _TerDeep[8];
            float4 _TerLight[8];
            float4 _TerGlow[8];
            float4 _Temple;        // x0, y0, size (tiles), w = 1 when a temple exists
            float4 _TempleInfo;    // centre x, centre y, brazier count
            float4 _TempleBraz[8]; // brazier tile positions
            float4 _Coliseum;      // centre x, centre y, half extent (tiles), w = 1 when found
            static const float2 ShadowT = float2(0.827, 0.561);   // cast direction in tile space (x right, y down), the one sun

            Varyings Vert(Attributes v)
            {
                Varyings o = (Varyings)0;
                o.positionCS = TransformObjectToHClip(v.positionOS);
                o.world = v.positionOS.xy;
                o.lightingUV = half2(ComputeScreenPos(o.positionCS / o.positionCS.w).xy);
                return o;
            }

            float H21(float2 p) { p = frac(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return frac(p.x * p.y); }
            float2 H22(float2 p) { float n = H21(p); return float2(n, H21(p + n + 19.19)); }
            float VNoise(float2 p)
            {
                float2 i = floor(p), f = frac(p); f = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(H21(i), H21(i + float2(1, 0)), f.x), lerp(H21(i + float2(0, 1)), H21(i + float2(1, 1)), f.x), f.y);
            }
            float Fbm(float2 p) { return VNoise(p) * 0.5 + VNoise(p * 2.03 + 11.7) * 0.28 + VNoise(p * 4.1 + 3.3) * 0.15 + VNoise(p * 8.3 + 5.1) * 0.07; }
            // Worley: x = distance to nearest feature, y = distance to the second nearest minus the first (cell edge strength).
            float2 Worley(float2 p)
            {
                float2 i = floor(p), f = frac(p); float d1 = 8, d2 = 8;
                [unroll] for (int y = -1; y <= 1; y++) [unroll] for (int x = -1; x <= 1; x++)
                {
                    float2 g = float2(x, y); float2 o = H22(i + g);
                    float d = length(g + o - f);
                    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
                }
                return float2(d1, d2 - d1);
            }

            struct Ground { float3 col; float3 emis; };

            Ground ShadeRegion(int id, int layer, float2 t, float macro, float pocketN)
            {
                float2 uv1 = t * 0.25;
                float2 uv2 = float2(t.x * 0.8660 - t.y * 0.5, t.x * 0.5 + t.y * 0.8660) * 0.1754 + 0.37;
                float4 a = SAMPLE_TEXTURE2D_ARRAY(_GroundTex, sampler_GroundTex, uv1, layer);
                float4 b = SAMPLE_TEXTURE2D_ARRAY(_GroundTex, sampler_GroundTex, uv2, layer);
                float mix = smoothstep(0.30, 0.70, VNoise(t * 0.21 + layer * 13.0));
                float4 g = lerp(a, b, mix * (layer == 1 ? 0.12 : 0.55));   // stripe layers keep the second tap faint (no moire)
                float4 par = _PalPar[id], par2 = _PalPar2[id];
                float3 baseC = _PalBase[id].rgb, secC = _PalSec[id].rgb, accC = _PalAcc[id].rgb, keyC = _PalKey[id].rgb;

                float lum = 1.0 + (g.r - 0.5) * par.x * 2.0;
                float3 c = baseC * lum;
                // Large scale variation (breaks the 4-tile repeat): brightness and a drift toward the secondary colour.
                c *= 1.0 + (macro - 0.5) * par2.x;
                c = lerp(c, keyC, saturate((g.r - 0.42 + (macro - 0.5) * 0.3) * par2.z));
                float pocketTerm = par.w > 0.01 ? smoothstep(par.w, par.w + 0.10, pocketN + (Fbm(t * 1.3 + 17.0) - 0.5) * 0.10) * (0.55 + 0.45 * g.g) : 0.0;
                float patchTerm = saturate(g.g * par.y + (macro - 0.55) * par2.x * 0.6);
                float secMask = max(pocketTerm, patchTerm);
                c = lerp(c, lerp(secC, accC, 0.20) * (1.0 + 0.9 * g.r), saturate(secMask));
                float3 e = 0;
                float acc = saturate(g.b * par.z);
                c = lerp(c, accC, acc);
                e += accC * g.b * par2.y * (0.75 + 0.25 * sin(_Time.y * 1.4 + t.x * 0.4 + t.y * 0.3));
                // B-channel glints twinkle white (frost glitter, sand shimmer).
                c += g.b * par2.w * (0.5 + 0.5 * sin(_Time.y * 2.3 + t.x * 7.0 + t.y * 5.0)) * float3(0.9, 0.97, 1.0);
                Ground r; r.col = c; r.emis = e; return r;
            }


            // ---- Plague: dark mud, deep grass, shallow translucent water (plg = water, grass, depth) ------------------------------
            Ground ShadePlague(float2 t, float macro, float3 plg)
            {
                float2 uv1 = t * 0.25;
                float2 uv2 = float2(t.x * 0.8660 - t.y * 0.5, t.x * 0.5 + t.y * 0.8660) * 0.1754 + 0.37;
                float4 g = lerp(SAMPLE_TEXTURE2D_ARRAY(_GroundTex, sampler_GroundTex, uv1, 2), SAMPLE_TEXTURE2D_ARRAY(_GroundTex, sampler_GroundTex, uv2, 2), 0.45 * smoothstep(0.3, 0.7, VNoise(t * 0.21 + 5.0)));
                float3 baseC = _PalBase[3].rgb, secC = _PalSec[3].rgb, accC = _PalAcc[3].rgb, keyC = _PalKey[3].rgb;
                float3 mudC = lerp(baseC, _PalSec[2].rgb, 0.72);          // sentenced masonry brown pulled into the Plague base: dark olive mud
                float edgeN = (Fbm(t * 1.7 + 3.1) - 0.5) * 0.30;
                float w = smoothstep(0.34, 0.46, plg.x + edgeN);
                float gr = smoothstep(0.34, 0.52, plg.y + edgeN * 1.2) * (1.0 - w);
                float inner = saturate(plg.z * 1.1 + (plg.x + edgeN - 0.5) * 0.9);
                float time = _Time.y;
                // mud: clods and wet pits
                float3 mud = mudC * (0.95 + 0.9 * g.r);
                mud = lerp(mud, mudC * 0.42, smoothstep(0.55, 0.8, g.b) * 0.55 + smoothstep(0.35, 0.0, g.a) * 0.25);
                // grass: blade strokes from the baked pattern over a dark deep green
                float3 grass = lerp(secC * 1.05, lerp(secC, accC, 0.2) * 1.7, saturate(g.g * 0.85 + (macro - 0.5) * 0.4));
                float3 c = lerp(mud, grass, gr);
                float shore = (1.0 - w) * smoothstep(0.12, 0.34, plg.x + edgeN);   // wet, darker bank around the water
                c = lerp(c, c * 0.5, shore * 0.75);
                float3 emis = 0;
                [branch] if (w > 0.002)
                {
                    float2 flow = float2(time * 0.05, -time * 0.03);
                    float2 dist = (float2(VNoise(t * 2.3 + flow), VNoise(t * 2.3 + 17.0 - flow)) - 0.5) * 0.10;
                    float4 bed = SAMPLE_TEXTURE2D_ARRAY(_GroundTex, sampler_GroundTex, (t + dist) * 0.25, 2);
                    float3 bedC = lerp(mudC * (0.55 + 0.6 * bed.r), secC * 0.6, saturate(plg.y * 0.8));   // the bed shows through at the shore
                    float3 deepC = lerp(baseC, secC, 0.5) * 0.62 + float3(0.0, 0.030, 0.034);    // dark green, not blue
                    float depthT = saturate(inner * 0.9 + 0.12);
                    float3 water = lerp(bedC * 0.85, deepC, depthT * 0.88);
                    float2 perp = float2(-ShadowT.y, ShadowT.x);
                    // sun glints sit along the single sun direction, soft and thin; broken light shafts lie across the surface
                    float gl = pow(saturate(VNoise(float2(dot(t, perp) * 3.6, dot(t, ShadowT) * 11.0) + flow * 4.0)), 18.0);
                    float ray = smoothstep(0.62, 0.95, VNoise(float2(dot(t, perp) * 0.42 + time * 0.03, dot(t, ShadowT) * 0.07)));
                    float rip = 0.5 + 0.5 * sin(dot(t, float2(1.7, 1.1)) * 3.0 + VNoise(t * 1.3) * 6.0 - time * 0.9);
                    water *= 0.92 + 0.12 * rip;
                    water += keyC * 0.11 * rip * depthT;                                                    // faint sky sheen
                    float lip = (1.0 - smoothstep(0.0, 0.22, plg.x + edgeN - 0.40));                        // darker wet edge line
                    water = lerp(water, mudC * 0.3, lip * 0.5);
                    float3 we = keyC * (gl * 0.55 + ray * 0.22) * (0.35 + 0.65 * depthT);
                    c = lerp(c, water, w);
                    emis += we * w;
                }
                Ground r; r.col = c; r.emis = emis; return r;
            }

            // ---- Holy temple floor (inlay tilework, carpet cross, medallion, steps, stained-glass light, brazier pools) ----------------
            void TempleSurface(float2 t, out float3 col, out float3 emis, out float inside)
            {
                float2 p = t - _TempleInfo.xy; float hs = _Temple.z * 0.5; float2 ap = abs(p);
                float dEdge = hs - max(ap.x, ap.y);
                inside = smoothstep(-0.03, 0.03, dEdge);
                float3 sand = _PalBase[5].rgb, gold = _PalAcc[5].rgb, key = _PalKey[5].rgb, green = _PalSec[5].rgb;
                float3 stoneL = lerp(sand, key, 0.40) * 1.05, stoneD = lerp(sand, key, 0.15) * 0.78, gilt = lerp(gold, key, 0.55);
                float time = _Time.y;
                emis = 0;
                // steps: three treads, risers shaded on the sides the camera sees
                float dd = clamp(dEdge, 0.0, 2.0999);
                float kk = floor(dd / 0.7), ff = frac(dd / 0.7);
                float facing = ap.y >= ap.x ? (p.y > 0.0 ? 1.0 : 0.12) : 0.55;
                float riser = (1.0 - smoothstep(0.0, 0.30, ff)) * facing;
                float nosing = 1.0 - smoothstep(0.0, 0.05, abs(ff - 0.30));
                float3 stepCol = lerp(stoneD, stoneL, 0.35 + 0.22 * kk) * (0.80 + 0.10 * kk);
                stepCol = lerp(stepCol, stepCol * 0.5, riser * 0.8) + nosing * 0.10 * key;
                stepCol *= 0.96 + 0.08 * VNoise(t * 6.0);
                // interior: polished one-tile checker with joints
                float2 ti = floor(p), tl = frac(p);
                float chk = fmod(abs(ti.x + ti.y), 2.0);
                float3 fl = lerp(stoneL, stoneD, chk * 0.16 + 0.06 * H21(ti));
                float joint = 1.0 - smoothstep(0.0, 0.035, min(min(tl.x, 1.0 - tl.x), min(tl.y, 1.0 - tl.y)));
                fl = lerp(fl, stoneD * 0.7, joint * 0.4);
                fl += key * 0.05 * smoothstep(0.5, 1.0, VNoise(p * 0.7 + 3.0));
                // inlay: an 8-point star per 3-tile module
                float2 m = frac(p / 3.0 + 0.5) - 0.5; float2 am = abs(m);
                float2 rr = float2(m.x + m.y, m.x - m.y) * 0.7071;
                float sq = min(max(am.x, am.y), max(abs(rr.x), abs(rr.y)));
                float ringS = 1.0 - smoothstep(0.0, 0.014, abs(sq - 0.30));
                float fillS = smoothstep(0.30, 0.27, sq);
                fl = lerp(fl, lerp(green * 0.9, stoneL, 0.55), fillS * 0.40);
                fl = lerp(fl, gilt, ringS * 0.6);
                fl = lerp(fl, gilt, (1.0 - smoothstep(0.0, 0.03, length(m) - 0.09)) * 0.5);
                float dia = 1.0 - smoothstep(0.0, 0.02, abs(am.x - 0.5) + abs(am.y - 0.5) - 0.17);
                fl = lerp(fl, lerp(green, stoneL, 0.45), dia * 0.5);
                // frieze border band inside the steps
                float fr = smoothstep(2.1, 2.15, dEdge) * (1.0 - smoothstep(3.55, 3.6, dEdge));
                float along = ap.y > ap.x ? p.x : p.y;
                float zig = abs(frac(along / 1.5) - 0.5) * 2.0;
                float3 frz = lerp(green * 0.9, gilt, step(zig, 0.45));
                frz = lerp(frz, gilt, 1.0 - smoothstep(0.0, 0.05, abs(dEdge - 2.12)));
                fl = lerp(fl, frz, fr);
                // carpet cross
                float across = min(ap.x, ap.y), alongC = max(ap.x, ap.y);
                float carpet = step(across, 1.6) * step(3.0, alongC) * smoothstep(2.1, 2.2, dEdge);
                float2 cg = frac(float2(across, alongC) / 0.8) - 0.5;
                float3 cp = lerp(green * 0.95, stoneD, 0.30) * (0.9 + 0.12 * VNoise(float2(across, alongC) * 8.0));
                cp = lerp(cp, gilt * 0.7, step(abs(cg.x) + abs(cg.y), 0.30) * step(across, 1.2) * 0.55);
                cp = lerp(cp, gilt, step(1.40, across) * step(across, 1.55));
                cp = lerp(cp, cp * 0.7, step(1.55, across));
                fl = lerp(fl, cp, carpet);
                // medallion
                float r = length(p); float ang = atan2(p.y, p.x);
                float medM = 1.0 - smoothstep(3.30, 3.38, r);
                float3 med = lerp(stoneL * 1.05, lerp(green, stoneL, 0.5), 0.6 * smoothstep(0.35, 0.75, abs(sin(ang * 4.0)) * smoothstep(1.2, 1.6, r) * (1.0 - smoothstep(2.4, 2.7, r))));
                med = lerp(med, gilt, (1.0 - smoothstep(0.0, 0.08, abs(r - 3.15))) + (1.0 - smoothstep(0.0, 0.05, abs(r - 2.55))) + (1.0 - smoothstep(0.0, 0.05, abs(r - 1.2))));
                fl = lerp(fl, med, medM);
                // stained-glass light cast on the floor by tall windows (pointed arches), drifting very slowly
                float2 wq = p / 6.0 + 0.5; float2 wc = floor(wq); float2 fq = (frac(wq) - 0.5) * 6.0 - ShadowT * 1.2;
                float halfW = 0.55 * (fq.y > -0.5 ? 1.0 : sqrt(saturate((fq.y + 1.4) / 0.9)));
                float glass = (1.0 - smoothstep(0.0, 0.12, abs(fq.x) - halfW)) * step(-1.4, fq.y) * step(fq.y, 1.0);
                float hsel = H21(wc + 3.7);
                float3 gcol = hsel < 0.25 ? key : hsel < 0.5 ? _PalSec[5].rgb * 1.5 : hsel < 0.75 ? _PalAcc[6].rgb * 1.8 : _PalSec[4].rgb;
                emis += gcol * glass * 0.13 * (0.75 + 0.25 * sin(time * 0.3 + hsel * 6.28));
                // brazier pools
                for (int b = 0; b < 8; b++)
                {
                    if (b >= (int)_TempleInfo.z) break;
                    float2 dv = t - _TempleBraz[b].xy;
                    float fk = 0.85 + 0.15 * sin(time * 7.0 + b * 2.3) * sin(time * 3.1 + b);
                    emis += lerp(_PalAcc[1].rgb, key, 0.4) * exp(-dot(dv, dv) * 0.30) * 0.22 * fk;
                }
                col = dEdge < 2.1 ? stepCol : fl;
            }

            float3 ColiseumSand(float2 t, float3 c, float rn)
            {
                float2 p = t - _Coliseum.xy; float r = length(p);
                float3 sand = lerp(_PalBase[5].rgb, c, 0.55) * 0.95;      // pale arena sand: the Holy sand pulled toward the limestone, never saturated orange
                float inSand = 1.0 - smoothstep(5.6, 7.2, r);
                float3 s = sand * (0.9 + 0.16 * rn);
                float groove = 1.0 - smoothstep(0.0, 0.07, min(min(abs(r - 3.2), abs(r - 5.2)), abs(r - 7.0)));
                s = lerp(s, s * 0.7, groove * 0.5);
                return lerp(c, s, inSand * 0.85 * _Coliseum.w);
            }

            half4 Frag(Varyings i) : SV_Target
            {
                float2 t = float2(i.world.x, -i.world.y / _Map.z);
                float2 tSun = t;
                // Heat shimmer: ground near lava wobbles slowly (cheap UV warp, only while the switch is on).
                [branch] if (_RhSwitch.w > 0.5)
                {
                    float2 lu = t / _Map.xy; float2 o1 = float2(1.4, 0) / _Map.xy, o2 = float2(0, 1.4) / _Map.xy;
                    float prox = SAMPLE_TEXTURE2D_LOD(_TerA, sampler_TerA, lu, 0).r + SAMPLE_TEXTURE2D_LOD(_TerA, sampler_TerA, lu + o1, 0).r
                               + SAMPLE_TEXTURE2D_LOD(_TerA, sampler_TerA, lu - o1, 0).r + SAMPLE_TEXTURE2D_LOD(_TerA, sampler_TerA, lu + o2, 0).r
                               + SAMPLE_TEXTURE2D_LOD(_TerA, sampler_TerA, lu - o2, 0).r;
                    float amp = smoothstep(0.08, 0.7, prox * 0.2);
                    float tm = _Time.y;
                    t += amp * 0.04 * float2(sin(t.y * 7.0 + tm * 3.1) + sin(t.x * 5.0 - tm * 2.3), cos(t.x * 6.0 + tm * 2.7) + sin(t.y * 4.0 + tm * 1.9));
                }
                // Ragged, noise-warped region borders on top of the blurred weight textures.
                float2 warp = (float2(VNoise(t * 0.55 + 7.3), VNoise(t * 0.55 + 91.7)) - 0.5) * 1.6;
                float2 ruv = (t + warp) / _Map.xy;
                half4 wa = SAMPLE_TEXTURE2D(_RegA, sampler_RegA, ruv);
                half4 wb = SAMPLE_TEXTURE2D(_RegB, sampler_RegB, ruv);
                float wgt[6] = { wa.r, wa.g, wa.b, wa.a, wb.r, wb.g };
                float tot = 0;
                [unroll] for (int k = 0; k < 6; k++) { wgt[k] = smoothstep(0.10, 0.90, wgt[k]); tot += wgt[k]; }
                tot = max(tot, 1e-3);

                float macro = Fbm(t * 0.06);
                float pocketN = wb.b;                                   // baked on the CPU (RegionPocket) so props can use the same mask
                float3 col = 0, emis = 0;
                [unroll] for (int k2 = 0; k2 < 6; k2++)
                {
                    [branch] if (wgt[k2] > 0.004)
                    {
                        Ground g;
                        if (k2 == 2) g = ShadePlague(t, macro, SAMPLE_TEXTURE2D(_PlgTex, sampler_PlgTex, t / _Map.xy).rgb);
                        else g = ShadeRegion(k2 + 1, k2, t, macro, pocketN);
                        if (k2 == 5) g.col = ColiseumSand(t, g.col, VNoise(t * 3.0));
                        float wk = wgt[k2] / tot;
                        col += g.col * wk; emis += g.emis * wk;
                    }
                }

                [branch] if (_Temple.w > 0.5)
                {
                    float3 tcol, temis; float tin;
                    float2 pp = t - _TempleInfo.xy; float dE = _Temple.z * 0.5 - max(abs(pp.x), abs(pp.y));
                    [branch] if (dE > -0.6)
                    {
                        TempleSurface(t, tcol, temis, tin);
                        float outsideShade = (1.0 - tin) * smoothstep(-0.5, 0.0, dE) * (pp.y > 0.0 ? 0.35 : 0.12);
                        col = lerp(col, tcol, tin) * (1.0 - outsideShade);
                        emis = lerp(emis, temis, tin);
                    }
                }

                // Terrain surfaces on top: organic edges from a noise-offset coverage threshold.
                float2 tuv = t / _Map.xy;
                half4 ta = SAMPLE_TEXTURE2D(_TerA, sampler_TerA, tuv);
                half4 tb = SAMPLE_TEXTURE2D(_TerB, sampler_TerB, tuv);
                float edgeNoise = (Fbm(t * 1.7 + 3.1) - 0.5) * 0.30;
                float cov[8] = { 0, ta.r, 0, tb.g, ta.a, ta.b, ta.g, tb.r };   // kind id -> coverage (2 fence has no ground art)
                float tmax = max(max(ta.r, ta.g), max(max(ta.b, ta.a), max(tb.r, tb.g)));
                [branch] if (tmax > 0.06)
                {
                    [unroll] for (int kd = 1; kd < 8; kd++)
                    {
                        float cv = cov[kd];
                        [branch] if (cv > 0.06)
                        {
                            float m = smoothstep(0.34, 0.46, cv + edgeNoise);
                            float inner = saturate((cv + edgeNoise - 0.5) * 2.2);       // 0 at the shore, 1 deep inside
                            float3 deep = _TerDeep[kd].rgb, light = _TerLight[kd].rgb, glow = _TerGlow[kd].rgb;
                            float3 tc = deep; float3 te = 0;
                            float time = _Time.y;
                            if (kd == 1)            // lava: dark crust over warped molten channels
                            {
                                float2 q = t * 1.6 + float2(Fbm(t * 0.9 + time * 0.05), Fbm(t * 0.9 + 9.0 - time * 0.05)) * 2.2;
                                float2 w = Worley(q);
                                float chan = 1.0 - smoothstep(0.0, 0.34, w.y);
                                float heat = saturate(chan * 1.25 + inner * 0.45 + (Fbm(t * 3.0 + time * 0.2) - 0.5) * 0.35);
                                tc = lerp(deep, light, saturate(heat * 1.1));
                                te = glow * (heat * heat * 0.85 + 0.15 * inner) * (0.85 + 0.15 * sin(time * 1.5 + q.x * 2.0));   // a glowing material with crust detail, not a white sheet
                                tc = lerp(tc, deep * 0.5, (1.0 - heat) * 0.5);
                            }
                            else if (kd == 6)       // ice: glassy cyan sheet, pale frozen shore, cracks and moving glints
                            {
                                float2 w = Worley(t * 0.9 + float2(Fbm(t * 0.5), Fbm(t * 0.5 + 5.0)) * 1.2);
                                float crack = 1.0 - smoothstep(0.0, 0.05, w.y);
                                float streak = smoothstep(0.55, 0.9, VNoise(float2(t.x * 0.7 + t.y * 1.9, t.x * 0.2 - t.y * 0.4) * 1.3));
                                float shore = 1.0 - smoothstep(0.0, 0.55, inner);
                                tc = lerp(light, deep, saturate(inner * 0.85 + (Fbm(t * 0.35) - 0.5) * 0.4));
                                tc = lerp(tc, light, streak * 0.42 + shore * 0.45);
                                tc = lerp(tc, float3(0.95, 0.99, 1.0), crack * 0.40);
                                float glint = pow(saturate(VNoise(t * 3.2 + float2(time * 0.35, 0))), 14.0) * 1.4;
                                te = glow * (crack * 0.10 + glint * 0.55);
                                // Translucency: a darker, blurred, parallax-shifted layer beneath (cracks and bubbles at depth),
                                // a fresnel-like sheen toward the screen edge and sun glints.
                                [branch] if (_RhSwitch.z > 0.5)
                                {
                                    float2 tb = t * 0.55 + (t - _RhCam.xy) * 0.07 + float2(Fbm(t * 0.3 + 2.0), Fbm(t * 0.3 + 8.0)) * 0.8;
                                    float2 w2 = Worley(tb);
                                    float deepCrack = 1.0 - smoothstep(0.0, 0.10, w2.y);
                                    float bubbles = smoothstep(0.80, 0.95, VNoise(tb * 5.0 + 3.0));
                                    float3 under = lerp(deep * 0.6, deep * 0.3, Fbm(tb * 0.7)) + float3(0.55, 0.8, 0.95) * (deepCrack * 0.22 + bubbles * 0.18);
                                    float depthMask = saturate(inner * 1.4);
                                    tc = lerp(tc, under, 0.42 * depthMask);
                                    float fres = pow(saturate(length(t - _RhCam.xy) / 13.0), 2.0);
                                    tc += float3(0.55, 0.75, 0.95) * fres * 0.2 * depthMask;
                                    te += glow * pow(saturate(VNoise(t * 7.0 + float2(time * 0.6, -time * 0.4))), 22.0) * 2.4 * depthMask;
                                }
                            }
                            else if (kd == 5)       // bog: thick, opaque sludge with a crust, rising bubbles and a sickly glow (gameplay terrain: never see-through, no sun glints)
                            {
                                float2 sw = Worley(t * 1.1 + Fbm(t * 0.6) * 1.4);
                                float crustLine = 1.0 - smoothstep(0.0, 0.10, sw.y);
                                float slow = VNoise(t * 1.6 + float2(time * 0.04, -time * 0.03));
                                tc = lerp(deep * 0.55, deep, slow) * (0.8 + 0.4 * Fbm(t * 2.4));
                                tc = lerp(tc, light * 0.55, (1.0 - crustLine) * 0.25 * inner);
                                tc = lerp(tc, deep * 0.25, crustLine * 0.7);              // dark cracked skin
                                float2 bc = floor(t * 3.2); float2 bf = frac(t * 3.2) - 0.5;
                                float bub = step(0.80, H21(bc)) * smoothstep(0.24, 0.12, length(bf + (H22(bc) - 0.5) * 0.3)) * (0.5 + 0.5 * sin(time * 2.2 + H21(bc + 3.0) * 6.28));
                                float breathe = 0.5 + 0.5 * sin(time * 1.15 + t.x * 0.45 + t.y * 0.38);
                                te = glow * (crustLine * 0.16 + bub * 0.8 + saturate(inner + 0.2) * (0.07 + 0.12 * breathe));
                                tc += bub * glow * 0.35;
                            }
                            else if (kd == 4)       // embers: charred ground with pulsing glowing cracks
                            {
                                float2 w = Worley(t * 1.5 + Fbm(t * 0.8) * 1.5);
                                float crack = 1.0 - smoothstep(0.0, 0.16, w.y);
                                float pulse = 0.65 + 0.35 * sin(time * 1.7 + w.x * 9.0 + H21(floor(t)) * 6.28);
                                tc = deep * (0.75 + 0.5 * Fbm(t * 2.0));
                                te = glow * crack * pulse * 1.5 + glow * 0.06;
                                tc = lerp(tc, light, crack * 0.6);
                            }
                            else if (kd == 7)       // light: warm sanctified ground, concentric shimmer and slow sparks
                            {
                                float2 c0 = t - floor(t) - 0.5;
                                float ring = 0.5 + 0.5 * sin(length(c0) * 9.0 - time * 1.6);
                                tc = lerp(light, deep, (1.0 - inner) * 0.4 + (Fbm(t * 1.3) - 0.5) * 0.3);
                                te = glow * (0.30 + 0.30 * ring) * (0.6 + 0.4 * inner);
                                float2 sc = floor(t * 3.0); float2 sf = frac(t * 3.0) - 0.5 - (H22(sc) - 0.5) * 0.5;
                                float sp = step(0.55, H21(sc + 7.0)) * smoothstep(0.16, 0.0, length(sf)) * (0.5 + 0.5 * sin(time * 2.4 + H21(sc) * 30.0));
                                te += glow * sp * 1.1;
                            }
                            else                    // crevasse: deep blue-black fissure with a pale lip
                            {
                                float2 w = Worley(t * 1.3 + Fbm(t * 0.7) * 2.0);
                                float lip = smoothstep(0.55, 0.0, inner);
                                tc = lerp(deep, deep * 0.35, inner);
                                tc = lerp(tc, light, lip * 0.75);
                                te = glow * (1.0 - smoothstep(0.0, 0.25, w.y)) * 0.15 * inner;
                            }
                            col = lerp(col, tc, m);
                            emis = lerp(emis, te, m);
                        }
                    }
                }

                // Lava light on the nearby Fire ground (always on, 4 taps): warm falloff within about 3 tiles so lava is the light source even without point lights.
                [branch] if (wgt[0] / tot > 0.05)
                {
                    float lp = 0;
                    [unroll] for (int q = 0; q < 4; q++) lp += SAMPLE_TEXTURE2D_LOD(_TerA, sampler_TerA, tuv + float2(q < 2 ? (q == 0 ? 2.6 : -2.6) : 0.0, q >= 2 ? (q == 2 ? 2.6 : -2.6) : 0.0) / _Map.xy, 0).r;
                    lp = lp * 0.25 + ta.r * 0.5;
                    float lg = smoothstep(0.03, 0.55, lp) * (1.0 - smoothstep(0.4, 0.5, ta.r));
                    emis += _TerGlow[1].rgb * lg * lg * 0.16 * (0.85 + 0.15 * sin(_Time.y * 1.3 + t.x * 0.8));
                    col = lerp(col, col * float3(1.25, 0.95, 0.8), saturate(lg));
                }

                // One sun: region-blended colour and strength per pixel, and the baked cast-shadow mask (walls and props).
                float sunStr; float3 shMul;
                float3 sunM = RhSunMul(i.world, 0.65, sunStr, shMul);
                float shade = SAMPLE_TEXTURE2D_LOD(_RhShadowMask, sampler_RhShadowMask, tSun / _Map.xy, 0).r * sunStr * _RhSwitch.y;
                col *= sunM * lerp(float3(1, 1, 1), shMul, saturate(shade));
                SurfaceData2D surfaceData;
                InputData2D inputData;
                InitializeSurfaceData(col * _Exposure, 1.0, half4(1, 1, 1, 1), half3(0, 0, 1), surfaceData);
                InitializeInputData(i.world, i.lightingUV, inputData);
                half4 lit = CombinedShapeLightShared(surfaceData, inputData);
                if (_Debug > 0.5) lit = half4(col, 1);
                lit.rgb += emis;
                lit.a = 1;
                return lit;
            }
            ENDHLSL
        }
    }
}
