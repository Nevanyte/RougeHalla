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
        _VariantTex("Ground variants (rgb tint, a strength, 1 texel per tile)", 2D) = "black" {}
        _VariantOn("Ground variants present", Float) = 0
        _VariantSoft("Soft band gains present", Float) = 0
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
            TEXTURE2D_ARRAY(_GroundNrm); SAMPLER(sampler_GroundNrm);   // rg = baked surface tilt (tile space), b = gloss; same layers and mapping as _GroundTex
            // Sampler states shared to stay under the 16 sampler limit of the Web target (GLES3): the state of the texture a sampler is named after governs.
            // sampler_RhRegA (RhSun.hlsl) = bilinear, clamp, no mips: "Region weights A", made by RegionGround.Tex in RegionGround.cs. _RegA/_RegB/_TerA/_TerB/_PlgTex are all made by that same Tex (bilinear, clamp).
            // sampler_TempleTex = point, clamp: "Temple piers" and "Ground variants" are both created point/clamp in RegionGround.cs.
            TEXTURE2D(_RegA);
            TEXTURE2D(_RegB);
            TEXTURE2D(_TerA);
            TEXTURE2D(_TerB);
            TEXTURE2D(_PlgTex);   // r shallow water, g grass, b water depth (Plague only)
            TEXTURE2D(_VariantTex);   // rgb tint, a strength (0 = base ground), point sampled, 1 texel per tile (the crisp plane; the bands' soft gain is in _TempleTex.gba)
            TEXTURE2D(_TempleTex); SAMPLER(sampler_TempleTex);   // r = 1 on tiles of a temple pier block, gba = the ground bands' soft gain (128 = neutral) (point sampled, 1 texel per tile)

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
                half _VariantOn;
                half _VariantSoft;
            CBUFFER_END
            #include "RhSun.hlsl"
            #include "RhLocalLights.hlsl"
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
            // Looks-only dials of the decoration bands (docs/unity/DIALS.md): warp = how far the band's outline wanders (tiles), noise scale = wobbles per tile, width = how much of the
            // tile-to-tile fade is kept (1 = fades across a whole tile, smaller = a narrower, crisper rim).
            #define RH_BAND_WARP 1.5
            #define RH_BAND_NOISE_SCALE 2.2
            #define RH_BAND_WIDTH 0.55
            // Terrain table, index = kind 0..7. rgb colour A (deep), _TerLight (light), _TerGlow (emissive).
            float4 _TerDeep[8];
            float4 _TerLight[8];
            float4 _TerGlow[8];
            float4 _Temple;        // x0, y0, size (tiles), w = 1 when a temple exists
            float4 _TempleInfo;    // great crossing x, y (an aisle intersection of the 6 tile pier grid), light count, apse radius
            float4 _TempleGrid;    // south portal x, east portal y, west portal y, apse flat-edge y (-999 = none)
            float4 _TempleStone;   // the building stone colour (shared with the pier skins and props)
            float4 _TempleBraz[16]; // lamp and brazier tile positions (w = 1 brazier, 2 lamp)
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

            struct Ground { float3 col; float3 emis; float th; float thw; };   // th/thw: procedural surface height (tiles) and its weight, for derivative normals

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
                Ground r; r.col = c; r.emis = e; r.th = 0; r.thw = 0; return r;
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
                float3 emis = 0; float thv = 0;
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
                    thv = (rip - 0.5) * 0.045 + (VNoise(t * 2.3 + flow * 3.0) - 0.5) * 0.04;      // water surface height: ripples take the local lights as moving glints
                    [branch] if (_RhFx.x > 0.5)
                    {
                        // Caustics: a bright net of light crawling over the bed, bent by the ripples, strongest in the shallows.
                        float2 cq = t * 2.4 + float2(sin(time * 0.55 + t.y * 1.4), cos(time * 0.47 + t.x * 1.2)) * 0.5 + (VNoise(t * 1.9 - flow * 6.0) - 0.5) * 0.6;
                        float2 w1 = Worley(cq), w2 = Worley(cq * 1.65 + 4.0 - time * 0.07);
                        float caus = pow(saturate(1.0 - w1.y * 4.5), 2.0) * 0.75 + pow(saturate(1.0 - w2.y * 4.5), 2.0) * 0.55;
                        water += keyC * caus * 0.34 * (1.0 - depthT * 0.55);
                        // Wade ripples from SurfaceFx (delivered actors only): expanding rings bend the surface, so lights and the sun glint on them.
                        int nr = (int)_RhFx.y;
                        [loop] for (int q = 0; q < 6; q++)
                        {
                            if (q >= nr) break;
                            float4 rp = _RhRip[q]; float age = _RhFxNow - rp.z;
                            if (age < 0.0 || age > rp.w) continue;
                            float rad = _RhRipB[q].x * 0.5 * saturate(age / (rp.w * 0.6)), dd = distance(t, rp.xy), fdr = 1.0 - age / rp.w;
                            float ringw = exp(-pow((dd - rad) * 4.5, 2.0)) * fdr;
                            thv += sin((dd - rad) * 20.0) * ringw * 0.06;
                            water += keyC * ringw * 0.10;
                        }
                    }
                    water *= 0.92 + 0.12 * rip;
                    water += keyC * 0.11 * rip * depthT;                                                    // faint sky sheen
                    float lip = (1.0 - smoothstep(0.0, 0.22, plg.x + edgeN - 0.40));                        // darker wet edge line
                    water = lerp(water, mudC * 0.3, lip * 0.5);
                    float3 we = keyC * (gl * 0.55 + ray * 0.22) * (0.35 + 0.65 * depthT);
                    c = lerp(c, water, w);
                    emis += we * w;
                }
                Ground r; r.col = c; r.emis = emis; r.th = thv; r.thw = w; return r;
            }

            // ---- Holy temple: ONE hall seen from above with its roof removed -------------------------------------------------------------
            // Plan (tile space, p = t - great crossing): a 6 tile structural grid; piers (3 x 3 blocks, drawn as walls) stand on its vertices, the open floor
            // between them is a grid of 3 tile aisles. Nave (north-south) and cross axis (east-west) carry carpet runners to the medallion under the main
            // "dome"; an apse with a stepped dais closes the north end; an open arcade on a stepped plinth runs round the edge with portals on the south,
            // east and west axes. Light only: arches and vaults are ribs of light and shade on the floor, never geometry over actors.
            float TLin(float d, float w) { return 1.0 - smoothstep(0.0, w, abs(d)); }
            float TStar(float2 q, float n, float rIn, float rOut)      // > 0 inside an n-pointed star
            {
                float seg = 6.28318 / n; float a = abs(frac(atan2(q.y, q.x) / seg + 0.5) - 0.5) * 2.0;
                return lerp(rOut, rIn, smoothstep(0.0, 1.0, a)) - length(q);
            }
            float TPier(float2 c) { return SAMPLE_TEXTURE2D_LOD(_TempleTex, sampler_TempleTex, c / _Map.xy, 0).r; }
            float3 TGlass(float h)
            {
                return h < 0.25 ? _PalKey[5].rgb : h < 0.5 ? lerp(_PalSec[5].rgb, float3(0.25, 0.6, 0.85), 0.55) * 1.5 : h < 0.75 ? _PalAcc[6].rgb * 1.7 : lerp(_PalSec[4].rgb, float3(0.3, 0.45, 0.95), 0.4) * 1.3;
            }

            void TempleSurface(float2 t, out float3 col, out float3 emis, out float inside)
            {
                float2 p = t - _TempleInfo.xy; float2 ap = abs(p);
                float S = _Temple.z;
                float dW = t.x - _Temple.x, dE2 = _Temple.x + S - t.x, dN = t.y - _Temple.y, dS = _Temple.y + S - t.y;
                float dEdge = min(min(dW, dE2), min(dN, dS));
                inside = smoothstep(-0.03, 0.03, dEdge);
                float time = _Time.y;
                float3 stone = _TempleStone.rgb;
                float3 stoneL = lerp(stone, float3(1, 1, 1), 0.16), stoneD = stone * 0.74;
                float3 keyE = _PalKey[5].rgb, giltE = lerp(_PalAcc[5].rgb, keyE, 0.5);                // emission: the raw palette values, added after lighting
                float3 key = pow(keyE, 2.2), gilt = pow(giltE, 2.2), tileC = pow(_PalSec[5].rgb, 2.2);   // albedo: the palette is sRGB, the framebuffer linear (same as the wall atlas and props)
                float2 sunPerp = float2(-ShadowT.y, ShadowT.x);
                emis = 0;

                // nearest side, perimeter coordinate and the portal on that side (north has the apse instead of a portal)
                bool horiz = min(dN, dS) <= min(dW, dE2);
                float along = horiz ? t.x : t.y, alongC = horiz ? _TempleInfo.x : _TempleInfo.y;
                float axis = horiz ? (dS <= dN ? _TempleGrid.x : -999.0) : (dE2 <= dW ? _TempleGrid.y : _TempleGrid.z);
                float portalD = axis > -900.0 ? abs(along - axis) : 99.0;
                float portalM = 1.0 - smoothstep(1.4, 1.8, portalD);

                // ---- plinth: three treads, risers shaded on the sides the camera sees
                float dd = clamp(dEdge, 0.0, 2.0999);
                float kk = floor(dd / 0.7), ff = frac(dd / 0.7);
                float facing = (horiz ? (dS <= dN ? 1.0 : 0.30) : 0.65);
                float riser = (1.0 - smoothstep(0.30, 0.46, ff)) * facing;             // the riser face you see below each tread's outer lip
                float nosing = 1.0 - smoothstep(0.0, 0.05, abs(ff - 0.46));
                float3 stepCol = lerp(stoneD * 1.05, stoneL * 1.08, 0.40 + 0.22 * kk) * (0.88 + 0.08 * kk);
                stepCol *= 1.0 - 0.10 * smoothstep(0.55, 1.0, ff) * 0.0;
                stepCol = lerp(stepCol, stoneD * 0.52, riser * 0.88) + nosing * 0.10 * giltE;
                stepCol *= 0.97 + 0.05 * VNoise(t * 3.0);

                // ---- floor: polished large slabs, soft mottling (no noisy texture)
                float2 sl = p / 1.5; float2 sf = frac(sl);
                float3 fl = lerp(stoneL, stone, 0.25 + 0.6 * H21(floor(sl) + 7.3));
                float jn = 1.0 - smoothstep(0.0, 0.035, min(min(sf.x, 1.0 - sf.x), min(sf.y, 1.0 - sf.y)));
                fl = lerp(fl, stoneD, jn * 0.20);
                fl *= 0.96 + 0.07 * VNoise(t * 0.8);
                float hall = smoothstep(4.0, 4.3, dEdge);                       // everything structural lives inside the promenade

                // ---- structural grid
                float2 pl = (frac(p / 6.0) - 0.5) * 6.0;        // 0 at a pier centre, -3 / 3 on an aisle centre line
                float2 pb = (frac(p / 6.0 + 0.5) - 0.5) * 6.0;  // 0 at a bay centre (aisle crossing)
                float2 pcn = t - pl, bcn = t - pb;
                float pierHere = TPier(pcn);
                float rp = max(abs(pl.x), abs(pl.y));
                float2 da = 3.0 - abs(pl);
                // aisle centre lines (inlaid gold, glowing softly) and the apron round each pier
                float aisleL = max(TLin(da.x, 0.035), TLin(da.y, 0.035));
                float pulse = 0.5 + 0.5 * sin(time * 0.7 - length(p) * 0.35);
                fl = lerp(fl, gilt * 0.92, aisleL * 0.42 * hall);
                emis += giltE * aisleL * (0.035 + 0.05 * pulse) * hall;
                fl *= 1.0 - 0.10 * (1.0 - smoothstep(1.5, 2.5, rp)) * pierHere * hall;
                float ringP = TLin(rp - 1.95, 0.035) * pierHere;
                fl = lerp(fl, gilt, ringP * 0.55 * hall); emis += giltE * ringP * 0.05 * hall;
                // arch spans between neighbouring piers: a soffit strip across the gap, light on its rim, the cast shade falling away from the sun
                {
                    float gx = step(1.5, abs(pl.x)) * pierHere * TPier(pcn + float2(sign(pl.x) * 6.0, 0.0));
                    float rowS = 1.0 - smoothstep(0.42, 0.52, abs(pl.y));
                    float shdY = (pl.y > 0.0 ? 1.0 : 0.0) * (1.0 - smoothstep(0.5, 1.5, pl.y)) * smoothstep(0.42, 0.55, abs(pl.y));
                    float key1 = TLin(abs(pl.x) - 3.0, 0.2) * (1.0 - smoothstep(0.0, 0.25, abs(pl.y)));
                    float gy = step(1.5, abs(pl.y)) * pierHere * TPier(pcn + float2(0.0, sign(pl.y) * 6.0));
                    float colS = 1.0 - smoothstep(0.42, 0.52, abs(pl.x));
                    float shdX = (pl.x > 0.0 ? 1.0 : 0.0) * (1.0 - smoothstep(0.5, 1.5, pl.x)) * smoothstep(0.42, 0.55, abs(pl.x));
                    float key2 = TLin(abs(pl.y) - 3.0, 0.2) * (1.0 - smoothstep(0.0, 0.25, abs(pl.x)));
                    float arch = max(gx * rowS, gy * colS), shd = max(gx * shdY, gy * shdX);
                    fl *= 1.0 - 0.075 * arch * hall;
                    fl *= 1.0 - 0.16 * shd * hall;
                    float rim = max(gx * TLin(abs(pl.y) - 0.5, 0.05), gy * TLin(abs(pl.x) - 0.5, 0.05));
                    fl += key * 0.05 * rim * hall;
                    fl = lerp(fl, gilt, max(gx * key1, gy * key2) * 0.7 * hall);
                }
                // groin ribs from each pier corner to the bay centre, and a small boss and rosette at the crossing
                {
                    float2 sg = float2(pb.x >= 0.0 ? 1.0 : -1.0, pb.y >= 0.0 ? 1.0 : -1.0);
                    float pq = TPier(bcn + 3.0 * sg);
                    float sd = (abs(pb.x) - abs(pb.y)) * 0.7071, rb = length(pb);
                    float ribM = (1.0 - smoothstep(2.3, 2.6, rb)) * pq * hall;
                    fl = lerp(fl, stoneD, TLin(sd, 0.07) * 0.30 * ribM);
                    fl += key * 0.045 * TLin(abs(sd) - 0.26, 0.07) * ribM;
                    float st = TStar(pb, 8.0, 0.5, 0.98);
                    float ros = smoothstep(-0.02, 0.05, st) * hall;
                    fl = lerp(fl, lerp(tileC * 0.9, stoneL, 0.62), ros * 0.45);
                    fl = lerp(fl, gilt, TLin(st, 0.04) * 0.55 * hall);
                    emis += giltE * TLin(st, 0.05) * 0.04 * hall * (0.6 + 0.4 * pulse);
                }

                // ---- promenade (behind the colonnade): dark gilt border lines, tile frieze, arcade bays
                float prom = smoothstep(2.1, 2.2, dEdge) * (1.0 - smoothstep(3.9, 4.0, dEdge));
                fl = lerp(fl, stoneD * 1.06, prom * 0.34);
                fl = lerp(fl, gilt, (TLin(dEdge - 2.15, 0.04) + TLin(dEdge - 3.95, 0.035) + TLin(dEdge - 4.22, 0.03) * 0.6) * 0.6 * step(2.1, dEdge));
                float frz = smoothstep(3.25, 3.3, dEdge) * (1.0 - smoothstep(3.65, 3.7, dEdge));
                float zig = abs(frac(along / 1.5) - 0.5) * 2.0;
                fl = lerp(fl, lerp(tileC * 0.9, stoneL, 0.55), frz * (1.0 - smoothstep(0.30, 0.46, zig)) * 0.30);
                emis += giltE * TLin(dEdge - 3.95, 0.05) * 0.04;
                // arcade shade on the sides away from the sun (south and east), cool and even: the interior is in shade there
                float awayD = min(dS, dE2);
                fl *= 1.0 - 0.14 * (1.0 - smoothstep(2.5, 9.0, awayD)) * step(2.1, dEdge);
                // sunlit arcade bays on the north and west sides: slanted shafts of coloured light running from each opening along the one sun direction
                // (the two sides are computed separately so the corner has no seam)
                [unroll] for (int sd = 0; sd < 2; sd++)
                {
                    bool isN = sd == 0;
                    float depth = isN ? dN : dW, al = isN ? t.x : t.y, ac2 = isN ? _TempleInfo.x : _TempleInfo.y;
                    float shift = (depth - 2.85) * (isN ? ShadowT.x / ShadowT.y : ShadowT.y / ShadowT.x);
                    float qa = (frac((al - ac2 - shift) / 3.0 + 0.5) - 0.5) * 3.0;
                    float bayId = floor((al - ac2 - shift) / 3.0 + 0.5);
                    float shaft = (1.0 - smoothstep(0.62, 0.92, abs(qa))) * smoothstep(2.9, 3.4, depth) * (1.0 - smoothstep(6.5, 10.5, depth));
                    float on = step(0.30, H21(float2(bayId, isN ? 3.0 : 9.0) + 2.7));
                    float3 gc = TGlass(H21(float2(bayId, isN ? 5.0 : 11.0) + 1.3));
                    float mullion = 1.0 - 0.5 * TLin(qa, 0.05);
                    emis += gc * shaft * on * mullion * 0.12 * (0.8 + 0.2 * sin(time * 0.3 + bayId)) * inside;
                    fl *= 1.0 + 0.05 * shaft * on;
                }

                // ---- carpet runners along the nave (south to the apse) and the cross axis
                float apseOn = _TempleGrid.w > -900.0 ? 1.0 : 0.0;
                float naveTop = apseOn > 0.5 ? _TempleGrid.w : _Temple.y + 2.1;
                float runN = step(ap.x, 1.15) * step(naveTop, t.y) * step(2.1, dS);
                float runC = step(ap.y, 1.15) * step(2.1, dW) * step(2.1, dE2);
                float runner = max(runN, runC);
                {
                    float across = runN > 0.5 ? ap.x : ap.y, alongR = runN > 0.5 ? p.y : p.x;
                    float2 cg = float2(across, (frac(alongR / 1.6) - 0.5) * 1.6);
                    float3 cp = float3(0.09, 0.27, 0.27) * (0.92 + 0.10 * VNoise(float2(across, alongR) * 6.0));
                    cp = lerp(cp, gilt * 0.7, step(abs(cg.x) * 1.0 + abs(cg.y) * 0.9, 0.42) * 0.40);
                    cp = lerp(cp, gilt, TLin(across - 1.1, 0.03));
                    cp = lerp(cp, gilt * 0.9, TLin(across - 0.95, 0.018) * 0.7);
                    fl = lerp(fl, cp, runner * hall * smoothstep(0.0, 0.05, 1.15 - across));
                    emis += giltE * (TLin(across - 1.1, 0.05) * (0.05 + 0.06 * pulse)) * runner * hall;
                    // a slow glimmer travelling along the nave toward the apse
                    float travel = smoothstep(0.85, 1.0, sin(alongR * 0.45 + time * (runN > 0.5 ? 0.8 : 0.5)));
                    emis += giltE * TLin(across, 0.05) * travel * 0.07 * runner * hall;
                }

                // ---- large scale inlay organised on the axes: a great eight-pointed star (two squares) round the crossing, concentric borders inside the promenade
                {
                    float sq1 = max(ap.x, ap.y) - 8.6;
                    float2 rr = float2(p.x + p.y, p.x - p.y) * 0.7071; float sq2 = max(abs(rr.x), abs(rr.y)) - 8.6;
                    float su = min(sq1, sq2), si = max(sq1, sq2) + 5.4;
                    fl = lerp(fl, lerp(tileC * 0.9, stoneL, 0.62), smoothstep(0.05, -0.05, su) * 0.16 * hall);
                    float lines = (TLin(su, 0.045) + TLin(su + 0.32, 0.025) * 0.6 + TLin(si, 0.03) * 0.5) * hall;
                    fl = lerp(fl, gilt, saturate(lines) * 0.5);
                    emis += giltE * saturate(lines) * (0.035 + 0.05 * pulse);
                    float cb = (TLin(dEdge - 5.3, 0.04) + TLin(dEdge - 5.65, 0.025) * 0.6) * hall;
                    fl = lerp(fl, gilt, saturate(cb) * 0.5);
                    emis += giltE * saturate(cb) * 0.04;
                }

                // ---- the great medallion under the main dome (the four nearest piers are its dome piers) and the pool of coloured light
                {
                    float r = length(p), ang = atan2(p.y, p.x);
                    float mM = 1.0 - smoothstep(4.5, 4.62, r);
                    float3 med = lerp(stoneL, stone, 0.25);
                    float a16 = abs(frac(ang * 16.0 / 6.28318) - 0.5) * 2.0;
                    float bandM = smoothstep(3.15, 3.25, r) * (1.0 - smoothstep(4.15, 4.25, r));
                    med = lerp(med, lerp(tileC * 0.9, stoneL, 0.6), bandM * 0.42 * smoothstep(0.35, 0.65, a16));
                    float s16 = TStar(p, 16.0, 1.9, 3.1), s8 = TStar(p, 8.0, 0.9, 2.1);
                    med = lerp(med, lerp(gilt * 0.9, stoneL, 0.45), smoothstep(-0.02, 0.05, s16) * 0.42);
                    med = lerp(med, lerp(tileC, stoneL, 0.5), smoothstep(-0.02, 0.05, s8) * 0.5);
                    float lines = TLin(s16, 0.05) + TLin(s8, 0.04) + TLin(r - 4.45, 0.05) + TLin(r - 4.2, 0.03) * 0.6 + TLin(r - 1.0, 0.035);
                    med = lerp(med, gilt, saturate(lines) * 0.8);
                    fl = lerp(fl, med, mM);
                    emis += giltE * saturate(lines) * mM * (0.10 + 0.08 * pulse);
                    float2 pq2 = p - ShadowT * 1.5;
                    float sector = floor(atan2(pq2.y, pq2.x) / 6.28318 * 8.0 + 8.0);
                    float pool = (1.0 - smoothstep(0.4, 3.4, length(pq2))) * (1.0 - 0.55 * TLin(frac(atan2(pq2.y, pq2.x) / 6.28318 * 8.0), 0.05));
                    emis += TGlass(H21(float2(sector, 4.0))) * pool * 0.11 * (0.85 + 0.15 * sin(time * 0.4));
                }

                // ---- apse at the north end: a stepped half-round dais, a gold arc and the carpet running to the niche
                [branch] if (apseOn > 0.5)
                {
                    float2 q = t - float2(_TempleInfo.x, _TempleGrid.w); float r = length(q), R = _TempleInfo.w;
                    float inA = smoothstep(R, R - 0.12, r) * (1.0 - smoothstep(0.0, 0.25, q.y));
                    float k = r > R - 1.4 ? 0.0 : (r > R - 2.8 ? 1.0 : 2.0);
                    float3 ac = lerp(stoneL, stone, 0.2 - 0.07 * k);
                    ac = lerp(ac, ac * 0.6, (1.0 - smoothstep(0.0, 0.16, abs(r - (R - 1.4)))) * 0.5 + (1.0 - smoothstep(0.0, 0.16, abs(r - (R - 2.8)))) * 0.5);
                    ac = lerp(ac, gilt, (TLin(r - (R - 1.28), 0.04) + TLin(r - (R - 2.68), 0.04) + TLin(r - (R - 4.0), 0.035) + TLin(r - R, 0.05)) * 0.7);
                    float2 ar = float2(abs(q.x), q.y);
                    float rug = step(ar.x, 1.15) * step(r, R - 0.6);
                    ac = lerp(ac, float3(0.09, 0.27, 0.27), rug);
                    ac = lerp(ac, gilt, rug * TLin(ar.x - 1.1, 0.03));
                    ac *= 1.0 - 0.18 * smoothstep(R - 1.0, R, r);                      // the shadowed foot of the niche wall
                    fl = lerp(fl, ac, inA);
                    float2 pq = q - float2(0.0, -R * 0.55);
                    emis += lerp(keyE, giltE, 0.5) * exp(-dot(pq, pq) * 0.07) * 0.09 * inA;
                    emis += giltE * (TLin(r - (R - 4.0), 0.05) + TLin(r - R, 0.05) * 0.6) * (0.06 + 0.06 * pulse) * inA;
                }

                // ---- soft shafts of dusty light from the clerestory across the hall, along the one sun direction
                {
                    float perp = dot(p, sunPerp), alg = dot(p, ShadowT);
                    float kf = floor(perp / 9.0 + 0.5); float lp = perp - 9.0 * kf;
                    float onS = step(0.42, H21(float2(kf, 5.5)));
                    float shaftM = (1.0 - smoothstep(0.5, 1.3, abs(lp))) * smoothstep(0.30, 0.62, VNoise(float2(kf * 3.7, alg * 0.07 + time * 0.01))) * onS * hall;
                    float3 gcS = lerp(keyE, TGlass(H21(float2(kf, 8.0))), 0.35);
                    emis += gcS * shaftM * 0.07;
                    // dust motes drifting inside the shafts
                    float2 dq = t * 4.2 + float2(time * 0.10, time * 0.06);
                    float2 dc = floor(dq), df = frac(dq) - 0.5;
                    float mote = step(0.955, H21(dc)) * smoothstep(0.30, 0.0, length(df + (H22(dc) - 0.5) * 0.4)) * (0.5 + 0.5 * sin(time * 1.3 + H21(dc + 3.0) * 6.28));
                    emis += keyE * mote * shaftM * 0.45;
                }
                // stained-glass pools in some bays: a slanted window image displaced along the sun direction
                {
                    float2 bid = floor(bcn);
                    float h = H21(bid + 3.1);
                    float2 q2 = pb - ShadowT * 0.9;
                    float aq = dot(q2, ShadowT), pq = dot(q2, sunPerp);
                    float win = (1.0 - smoothstep(0.42, 0.58, abs(pq))) * (1.0 - smoothstep(1.1, 1.4, abs(aq - 0.2)));
                    float notMain = step(5.0, length(bcn - _TempleInfo.xy));
                    emis += TGlass(H21(bid + 8.0)) * win * step(0.45, h) * notMain * hall * (1.0 - 0.45 * TLin(pq, 0.04)) * 0.14;
                }
                // lamp and brazier pools
                for (int b = 0; b < 16; b++)
                {
                    if (b >= (int)_TempleInfo.z) break;
                    float2 dv = t - _TempleBraz[b].xy;
                    float fk = 0.88 + 0.12 * sin(time * 7.0 + b * 2.3) * sin(time * 3.1 + b);
                    emis += lerp(_PalAcc[1].rgb, keyE, 0.4) * exp(-dot(dv, dv) * (_TempleBraz[b].w > 1.5 ? 0.45 : 0.30)) * (_TempleBraz[b].w > 1.5 ? 0.16 : 0.22) * fk;
                }

                // ---- portal threshold: a soft dark band just inside every portal, deepest at the sill, so stepping in from the sun feels like entering a building
                float thr = (1.0 - smoothstep(2.0, 7.5, dEdge)) * (1.0 - smoothstep(2.6, 4.8, portalD)) * step(0.0, dEdge);
                fl *= 1.0 - 0.26 * thr;
                fl = lerp(fl, gilt, TLin(dEdge - 2.12, 0.035) * portalM * 0.8);
                // portal treads carry the carpet out to the sand
                float3 pc2 = float3(0.09, 0.27, 0.27); float pAcross = portalD;
                stepCol = lerp(stepCol, pc2, step(pAcross, 1.15) * (axis > -900.0 ? 1.0 : 0.0) * (1.0 - riser * 0.5));
                stepCol = lerp(stepCol, gilt, TLin(pAcross - 1.1, 0.03) * (axis > -900.0 ? 1.0 : 0.0));
                col = dEdge < 2.1 ? stepCol : fl;
                col *= 1.0 - 0.30 * (1.0 - smoothstep(0.0, 0.7, dEdge)) * step(0.0, dEdge);   // dark footing line where the plinth meets the sand
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
                float2 gdx = ddx(tSun * 0.25), gdy = ddy(tSun * 0.25);
                bool locLit = _RhLI.x > 0.5 && RhAnyLight(tSun);          // any analytic local light reaches this pixel
                float2 gTilt = 0; float gGloss = 0, thH = 0, thW = 0;
                // Heat shimmer: ground near lava wobbles slowly (cheap UV warp, only while the switch is on).
                [branch] if (_RhSwitch.w > 0.5)
                {
                    float2 lu = t / _Map.xy; float2 o1 = float2(1.4, 0) / _Map.xy, o2 = float2(0, 1.4) / _Map.xy;
                    float prox = SAMPLE_TEXTURE2D_LOD(_TerA, sampler_RhRegA, lu, 0).r + SAMPLE_TEXTURE2D_LOD(_TerA, sampler_RhRegA, lu + o1, 0).r
                               + SAMPLE_TEXTURE2D_LOD(_TerA, sampler_RhRegA, lu - o1, 0).r + SAMPLE_TEXTURE2D_LOD(_TerA, sampler_RhRegA, lu + o2, 0).r
                               + SAMPLE_TEXTURE2D_LOD(_TerA, sampler_RhRegA, lu - o2, 0).r;
                    float amp = smoothstep(0.08, 0.7, prox * 0.2);
                    float tm = _Time.y;
                    t += amp * 0.04 * float2(sin(t.y * 7.0 + tm * 3.1) + sin(t.x * 5.0 - tm * 2.3), cos(t.x * 6.0 + tm * 2.7) + sin(t.y * 4.0 + tm * 1.9));
                }
                // Ragged, noise-warped region borders on top of the blurred weight textures.
                float2 warp = (float2(VNoise(t * 0.55 + 7.3), VNoise(t * 0.55 + 91.7)) - 0.5) * 1.6;
                float2 ruv = (t + warp) / _Map.xy;
                half4 wa = SAMPLE_TEXTURE2D(_RegA, sampler_RhRegA, ruv);
                half4 wb = SAMPLE_TEXTURE2D(_RegB, sampler_RhRegA, ruv);
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
                        if (k2 == 2) g = ShadePlague(t, macro, SAMPLE_TEXTURE2D(_PlgTex, sampler_RhRegA, t / _Map.xy).rgb);
                        else g = ShadeRegion(k2 + 1, k2, t, macro, pocketN);
                        if (k2 == 5) g.col = ColiseumSand(t, g.col, VNoise(t * 3.0));
                        float wk = wgt[k2] / tot;
                        col += g.col * wk; emis += g.emis * wk;
                        thH += g.th * wk; thW += g.thw * wk;
                        [branch] if (locLit)
                        {
                            float4 nr = SAMPLE_TEXTURE2D_ARRAY_GRAD(_GroundNrm, sampler_GroundNrm, tSun * 0.25, k2, gdx, gdy);
                            gTilt += (nr.rg * 2.0 - 1.0) * wk; gGloss += nr.b * wk;
                        }
                    }
                }

                // Server ground variants: a gain over the blended base ground. _VariantTex is the crisp plane, one texel per tile (rgb gain, a strength: the Sentenced scatter and every Tile-edge
                // variant, whole tiles as ever). The decoration bands' SOFT gain rides in the g, b, a channels of _TempleTex (one texel per tile, 128 = neutral; r is the pier flag). It is blended by
                // hand from the four nearest tile centres (GAINS, never codes), at a point warped by the same noise family as the terrain edge below (Fbm at t * 2.2 against its 1.7), so a
                // band's outline wanders like the bog's beside it. The tile gain times the soft gain is capped at 255/128, as one baked texel always was.
                [branch] if (_VariantOn > 0.5)
                {
                    half4 vt = SAMPLE_TEXTURE2D_LOD(_VariantTex, sampler_TempleTex, (floor(t) + 0.5) / _Map.xy, 0);
                    col *= lerp(1.0, vt.rgb * (255.0 / 128.0), vt.a);
                    [branch] if (_VariantSoft > 0.5)
                    {
                        float2 ts = t + (float2(Fbm(t * RH_BAND_NOISE_SCALE + 3.1), Fbm(t * RH_BAND_NOISE_SCALE + 17.7)) - 0.5) * (2.0 * RH_BAND_WARP);
                        float2 u = ts - 0.5; float2 i0 = floor(u); float2 f = u - i0;
                        f = saturate((f - 0.5) / RH_BAND_WIDTH + 0.5);
                        float2 lo = (clamp(i0, 0.0, _Map.xy - 1.0) + 0.5) / _Map.xy, hi = (clamp(i0 + 1.0, 0.0, _Map.xy - 1.0) + 0.5) / _Map.xy;
                        float3 s00 = SAMPLE_TEXTURE2D_LOD(_TempleTex, sampler_TempleTex, float2(lo.x, lo.y), 0).gba;
                        float3 s10 = SAMPLE_TEXTURE2D_LOD(_TempleTex, sampler_TempleTex, float2(hi.x, lo.y), 0).gba;
                        float3 s01 = SAMPLE_TEXTURE2D_LOD(_TempleTex, sampler_TempleTex, float2(lo.x, hi.y), 0).gba;
                        float3 s11 = SAMPLE_TEXTURE2D_LOD(_TempleTex, sampler_TempleTex, float2(hi.x, hi.y), 0).gba;
                        float3 sg = lerp(lerp(s00, s10, f.x), lerp(s01, s11, f.x), f.y) * (255.0 / 128.0);
                        col *= min(sg, (255.0 / 128.0) / lerp(1.0, vt.rgb * (255.0 / 128.0), vt.a));
                    }
                }

                float templeIn = 0.0;                                   // 1 inside the temple floor: holy-light terrain is then drawn as a translucent pool on the stone so the inlay stays readable
                [branch] if (_Temple.w > 0.5)
                {
                    float3 tcol, temis; float tin;
                    float tS = _Temple.z;
                    float dE = min(min(t.x - _Temple.x, _Temple.x + tS - t.x), min(t.y - _Temple.y, _Temple.y + tS - t.y));
                    [branch] if (dE > -3.2)
                    {
                        TempleSurface(t, tcol, temis, tin); templeIn = tin;
                        // cast shadow line of the plinth and arcade on the sand: the sun is north-west, so the shade falls to the south and east (a hint on the other sides)
                        float oS = t.y - (_Temple.y + tS), oE = t.x - (_Temple.x + tS), oN = _Temple.y - t.y, oW = _Temple.x - t.x;
                        float inX = smoothstep(_Temple.x - 0.5, _Temple.x + 2.5, t.x) * (1.0 - smoothstep(_Temple.x + tS + 1.5, _Temple.x + tS + 3.0, t.x));
                        float inY = smoothstep(_Temple.y - 0.5, _Temple.y + 2.5, t.y) * (1.0 - smoothstep(_Temple.y + tS + 1.5, _Temple.y + tS + 3.0, t.y));
                        float cast = 0.62 * (1.0 - smoothstep(0.0, 3.2, oS)) * step(0.0, oS) * inX + 0.55 * (1.0 - smoothstep(0.0, 2.8, oE)) * step(0.0, oE) * inY
                                   + 0.07 * (1.0 - smoothstep(0.0, 0.9, max(oN, oW))) * step(0.0, max(oN, oW)) * inX * inY;
                        col = lerp(col, tcol, tin) * (1.0 - cast * (1.0 - tin));
                        emis = lerp(emis * (1.0 - cast * (1.0 - tin)), temis, tin);
                    }
                }

                // Terrain surfaces on top: organic edges from a noise-offset coverage threshold.
                float2 tuv = t / _Map.xy;
                half4 ta = SAMPLE_TEXTURE2D(_TerA, sampler_RhRegA, tuv);
                half4 tb = SAMPLE_TEXTURE2D(_TerB, sampler_RhRegA, tuv);
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
                            float3 tc = deep; float3 te = 0; float hh = 0, gl = 0.15;
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
                                hh = (1.0 - heat) * 0.07; gl = 0.30;
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
                                hh = streak * 0.025 - crack * 0.045; gl = 1.0;
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
                                // Contrast pass: calmer bubbles and breathing glow (was bubbles x 0.8, tint x 0.35, breathe 0.07 + 0.12).
                                te = glow * (crustLine * 0.16 + bub * 0.5 + saturate(inner + 0.2) * (0.06 + 0.08 * breathe));
                                tc += bub * glow * 0.2;
                                hh = bub * 0.05 + (1.0 - crustLine) * 0.03; gl = 0.45;
                            }
                            else if (kd == 4)       // embers: charred ground with pulsing glowing cracks
                            {
                                float2 w = Worley(t * 1.5 + Fbm(t * 0.8) * 1.5);
                                float crack = 1.0 - smoothstep(0.0, 0.16, w.y);
                                // Contrast pass (docs/rework/evidence/contrast): the cracks keep their hue and their pulse but their luminance range is calmer, so a fighter's
                                // edge reads against them (was pulse 0.65 + 0.35 sin, emission x 1.5, crack colour mix 0.6; now emission x 0.6, mix 0.3).
                                float pulse = 0.72 + 0.28 * sin(time * 1.7 + w.x * 9.0 + H21(floor(t)) * 6.28);
                                tc = deep * (0.75 + 0.5 * Fbm(t * 2.0));
                                te = glow * crack * pulse * 0.6 + glow * 0.06;
                                tc = lerp(tc, light, crack * 0.3);
                                hh = -crack * 0.05; gl = 0.12;
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
                                gl = 0.25;
                            }
                            else                    // crevasse: deep blue-black fissure with a pale lip
                            {
                                float2 w = Worley(t * 1.3 + Fbm(t * 0.7) * 2.0);
                                float lip = smoothstep(0.55, 0.0, inner);
                                tc = lerp(deep, deep * 0.35, inner);
                                tc = lerp(tc, light, lip * 0.75);
                                te = glow * (1.0 - smoothstep(0.0, 0.25, w.y)) * 0.15 * inner;
                                hh = -inner * 0.12; gl = 0.5;
                            }
                            if (kd == 7) m *= lerp(1.0, 0.5, templeIn);
                            col = lerp(col, tc, m);
                            emis = lerp(emis, te, m);
                            thH = lerp(thH, hh, m); thW = lerp(thW, 1.0, m); gGloss = lerp(gGloss, gl, m);
                        }
                    }
                }

                // Lava light on the nearby Fire ground (always on, 4 taps): warm falloff within about 3 tiles so lava is the light source even without point lights.
                [branch] if (wgt[0] / tot > 0.05)
                {
                    float lp = 0;
                    [unroll] for (int q = 0; q < 4; q++) lp += SAMPLE_TEXTURE2D_LOD(_TerA, sampler_RhRegA, tuv + float2(q < 2 ? (q == 0 ? 2.6 : -2.6) : 0.0, q >= 2 ? (q == 2 ? 2.6 : -2.6) : 0.0) / _Map.xy, 0).r;
                    lp = lp * 0.25 + ta.r * 0.5;
                    float lg = smoothstep(0.03, 0.55, lp) * (1.0 - smoothstep(0.4, 0.5, ta.r));
                    emis += _TerGlow[1].rgb * lg * lg * 0.16 * (0.85 + 0.15 * sin(_Time.y * 1.3 + t.x * 0.8));
                    col = lerp(col, col * float3(1.25, 0.95, 0.8), saturate(lg));
                }

                // One sun: region-blended colour and strength per pixel, and the baked cast-shadow mask (walls and props).
                float sunStr; float3 shMul;
                float3 sunM = RhSunMul(i.world, 0.65, sunStr, shMul);
                float3 albedo = col;
                float shade = SAMPLE_TEXTURE2D_LOD(_RhShadowMask, sampler_RhShadowMask, tSun / _Map.xy, 0).r * sunStr * _RhSwitch.y;
                col *= sunM * lerp(float3(1, 1, 1), shMul, saturate(shade));
                SurfaceData2D surfaceData;
                InputData2D inputData;
                // mask = 0: the "with Mask" light blend styles (accent point lights while the analytic local lights are on) skip this surface; see RhLocalLights.hlsl.
                InitializeSurfaceData(col * _Exposure, 1.0, half4(0, 0, 0, 0), half3(0, 0, 1), surfaceData);
                InitializeInputData(i.world, i.lightingUV, inputData);
                half4 lit = CombinedShapeLightShared(surfaceData, inputData);
                if (_Debug > 0.5) lit = half4(col, 1);
                lit.rgb += emis;
                float dtx = ddx(tSun.x), dty = ddy(tSun.y);
                float2 gT = float2(ddx(thH) / (abs(dtx) > 1e-6 ? dtx : 1e-6), ddy(thH) / (abs(dty) > 1e-6 ? dty : 1e-6));   // derivative normal of the procedural heights
                [branch] if (locLit)
                {
                    float2 tilt = lerp(gTilt, -gT, saturate(thW));
                    float3 dif, spc;
                    float gloss = max(gGloss, templeIn * 0.3);
                    RhLocalLights(tSun, normalize(float3(tilt, 1.0)), gloss, 12.0 + 40.0 * saturate(gloss), 1.0, 1.0, 0.0, dif, spc);
                    float hr = RhHeadroom(lit.rgb);
                    lit.rgb += albedo * _Exposure * dif * hr + spc * saturate(hr + 0.05);
                }
                lit.a = 1;
                lit.rgb = RhFogGrade(i.world, lit.rgb);
                return lit;
            }
            ENDHLSL
        }
    }
}
