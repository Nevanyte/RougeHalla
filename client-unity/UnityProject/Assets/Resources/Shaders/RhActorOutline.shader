// Adaptive neutral outline for actors and their markers (the character-contrast gate: docs/rework/CONTRAST_GATE.md).
//
// It is drawn on a quad (the "bar" sprite, scaled up by SpriteOutline) that sits just under the source sprite it outlines. The shader reads the SOURCE sprite's
// alpha from its own atlas (_SrcTex, rect _SrcRect) and dilates it by a fixed world-space width, so the stroke is generated from the sprite's own silhouette for
// every one of the catalog's frames, with no prebuilt art. The stroke colour is a hard choice per pixel: near black when the ground behind it is brighter than the
// crossover, near white when it is darker. The ground is the camera sorting layer texture (Roguehalla2DRenderer: one grab, after the "World" sorting layer and
// before the actors), blurred by five taps. When that texture is not there, _Prior (0 dark, 1 light; a CPU estimate of the ground) decides.
// The stroke is unlit and opaque; its alpha is the vertex alpha only, so the vision fade, the hidden and the dead states fade it with the actor.
// ActorOutlineModel.cs holds the same constants and is unit tested.
Shader "Roguehalla/ActorOutline"
{
    Properties
    {
        [PerRendererData] _MainTex("Quad sprite (unused)", 2D) = "white" {}
        [HideInInspector] _Color("Tint", Color) = (1,1,1,1)
        [HideInInspector] _RendererColor("RendererColor", Color) = (1,1,1,1)
        [HideInInspector] _AlphaTex("External Alpha", 2D) = "white" {}
        [HideInInspector] _EnableExternalAlpha("Enable External Alpha", Float) = 0
        _MaskMode("Contrast lab mask mode (0 off)", Float) = 0
        _MaskColor("Contrast lab mask colour", Color) = (1,0,0,1)
    }
    SubShader
    {
        Tags { "Queue" = "Transparent" "RenderType" = "Transparent" "RenderPipeline" = "UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha, One OneMinusSrcAlpha
        Cull Off
        ZWrite Off

        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        #include "Packages/com.unity.render-pipelines.universal/Shaders/2D/Include/Core2D.hlsl"

        struct Attributes { float3 positionOS : POSITION; float4 color : COLOR; float2 uv : TEXCOORD0; };
        struct Varyings { float4 positionCS : SV_POSITION; half4 color : COLOR; float2 uv : TEXCOORD0; float4 screen : TEXCOORD1; nointerpolation float figure : TEXCOORD2; float3 posWS : TEXCOORD3; };

        TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
        TEXTURE2D(_SrcTex); SAMPLER(sampler_SrcTex);
        TEXTURE2D(_Src2Tex); SAMPLER(sampler_Src2Tex);
        TEXTURE2D(_CameraSortingLayerTexture);   // sampler_LinearClamp comes from the URP core library

        // Per renderer (MaterialPropertyBlock), deliberately outside UnityPerMaterial.
        float4 _SrcRect;   // u0, v0, du, dv: the source sprite's rectangle in its atlas
        float4 _Outline;   // x,y: margin around the sprite as a fraction of its size; z,w: stroke width in sprite-normalised units
        float4 _UvMap;     // sprite-normalised uv of the source = (quad uv - 0.5) * xy + zw (the quad covers the source and, for a union, its companion, plus the stroke margin)
        float4 _Src2Rect;  // the companion sprite's rectangle in its atlas
        float4 _Src2Texel;
        float4x4 _ToSrc2;  // source sprite-normalised uv -> companion sprite-normalised uv
        float _Src2Mode;   // 0 none; 1 union (the companion is part of the silhouette: one stroke around both); 2 cut (no stroke where the companion is drawn)
        float4 _Tone;      // x: target contrast ratio of this stroke against the ground just outside it
        float4 _SrcTexel;  // x,y: one source texel in sprite-normalised units
        float _Prior;      // 0 dark, 1 light: dead-zone tie break, and the whole decision when there is no sorting layer texture
        float _MaskMode;
        half4 _MaskColor;
        float _RhOutlineGrab; // global, set by ActorOutline: 1 when _CameraSortingLayerTexture is valid this frame

        // Mirrors ActorOutlineModel.cs; SpriteOutline.PublishGlobals writes them (tunable in a page with ?ol.light=, ol.dark=, ol.cross=, ol.dead=).
        float _RhOutlineDebug;  // tuning pages only: 1 paints the polarity (magenta light, green dark, cyan = figure light), 2 paints the ground luminance seen by the shader x3
        float _RhOutlineFlip;   // tuning pages only: 1 flips the grab vertically
        float _RhOutlineRadius; // tuning pages only
        float _RhOutlineGain;  // set once per frame by SpriteOutline.PublishFrame: 2^post exposure of the grade
        float4 _RhOutlineTune;   // set by SpriteOutline.PublishGlobals: lightest tone floor (on-screen luminance), darkest tone, flip luminance, dead zone half width
        float4 _RhOutlineTone;   // w: brightest the dark stroke may get (on-screen luminance)

        float SrcAlpha(float2 sp)
        {
            float2 inside = step(0.0, sp) * step(sp, 1.0);
            float2 c = clamp(sp, 0.5 * _SrcTexel.xy, 1.0 - 0.5 * _SrcTexel.xy);
            float a = SAMPLE_TEXTURE2D(_SrcTex, sampler_SrcTex, _SrcRect.xy + c * _SrcRect.zw).a;
            return a * inside.x * inside.y;
        }

        float Src2Alpha(float2 sp)
        {
            float2 q = mul(_ToSrc2, float4(sp, 0.0, 1.0)).xy;
            float2 inside = step(0.0, q) * step(q, 1.0);
            float2 c = clamp(q, 0.5 * _Src2Texel.xy, 1.0 - 0.5 * _Src2Texel.xy);
            return SAMPLE_TEXTURE2D(_Src2Tex, sampler_Src2Tex, _Src2Rect.xy + c * _Src2Rect.zw).a * inside.x * inside.y;
        }
        // The figure's silhouette: the source, and its companion (the held weapon) when the stroke is one for both.
        float FigAlpha(float2 sp)
        {
            float a = SrcAlpha(sp);
            return (_Src2Mode > 0.5 && _Src2Mode < 1.5) ? max(a, Src2Alpha(sp)) : a;
        }
        // Everything of this figure that hides ground (silhouette plus a cutting companion): a ground tap there is not ground.
        float OccAlpha(float2 sp) { return _Src2Mode > 0.5 ? max(SrcAlpha(sp), Src2Alpha(sp)) : SrcAlpha(sp); }

        // Disc dilation of the source alpha by the stroke width: 12 taps on the rim, 6 on a half-width ring, plus the centre.
        float Dilate(float2 sp, float2 w)
        {
            float a = FigAlpha(sp);
            const float k = 0.5235988;   // 30 degrees
            [unroll] for (int i = 0; i < 12; i++)
            {
                float s, c; sincos(k * i, s, c);
                a = max(a, FigAlpha(sp + float2(c, s) * w));
            }
            [unroll] for (int j = 0; j < 6; j++)
            {
                float s, c; sincos(k * 0.5 + 1.0471976 * j, s, c);
                a = max(a, FigAlpha(sp + float2(c, s) * w * 0.5));
            }
            return a;
        }

        float Luma(float3 c) { return dot(c, float3(0.2126, 0.7152, 0.0722)); }

        // Ground luminance behind the stroke: the MEDIAN of thirteen taps of the (4x box filtered) grab within about 0.2 world units (3 to 12 pixels at 1080p) of the pixel.
        // The gate compares the stroke with the median of the ground just outside it, so the polarity must follow the majority of the ground there: on a ground of bright
        // veins over dark cells the mean reads bright and a geometric mean still leans on the veins, the median does not.
        float TapLum(float2 uv)
        {
            uv.y = _RhOutlineFlip > 0.5 ? 1.0 - uv.y : uv.y;
            return Luma(SAMPLE_TEXTURE2D_LOD(_CameraSortingLayerTexture, sampler_LinearClamp, uv, 0).rgb);
        }

        float GroundLuma(float2 uv)
        {
            float unit = _ScreenParams.y / max(2.0 * unity_OrthoParams.y, 0.01);   // pixels per world unit
            float2 px = unit * max(_RhOutlineRadius, 0.01) / _ScreenParams.xy;
            float v[13];
            v[0] = TapLum(uv);
            [unroll] for (int k = 0; k < 4; k++)
            {
                float s, c; sincos(1.5707963 * k, s, c);
                v[1 + k] = TapLum(uv + float2(c, s) * px * 0.05);
                float s1, c1; sincos(0.7853982 + 1.5707963 * k, s1, c1);
                v[5 + k] = TapLum(uv + float2(c1, s1) * px * 0.11);
                float s2, c2; sincos(0.3926991 + 1.5707963 * k, s2, c2);
                v[9 + k] = TapLum(uv + float2(c2, s2) * px * 0.2);
            }
            float m = v[0];
            [unroll] for (int i = 0; i < 13; i++)
            {
                int below = 0;
                [unroll] for (int j = 0; j < 13; j++) below += (v[j] < v[i] || (v[j] == v[i] && j < i)) ? 1 : 0;
                if (below == 6) m = v[i];
            }
            return m * max(_RhOutlineGain, 0.05);
        }

        // The ground just OUTSIDE the stroke, where the gate measures it: nine taps (three distances 6 to 14 px, three across) along the outward direction of the silhouette at this
        // pixel, median. A stroke is judged against the ring beyond it, not against what lies under it, so a bright vein that crosses the stroke itself must not decide its polarity.
        float RingLuma(float3 pWS, float2 uv, float3 dirWS, out float lo, out float hi)
        {
            float pxw = 2.0 * max(unity_OrthoParams.y, 0.01) / _ScreenParams.y;     // world units per pixel
            float3 latWS = float3(-dirWS.y, dirWS.x, 0.0);
            float v[15];
            float2 uvScale = _UvMap.xy;
            int nValid = 0;
            [unroll] for (int a = 0; a < 3; a++)
                [unroll] for (int b = 0; b < 5; b++)
                {
                    float3 off = dirWS * ((6.0 + 4.0 * a) * pxw) + latWS * ((b - 2) * 8.0 * pxw);
                    float4 cs = ComputeScreenPos(TransformWorldToHClip(pWS + off));
                    float2 duv = TransformWorldToObjectDir(off).xy * uvScale;
                    // A tap that lands on the figure's own body (a thin arm, a notch) is not ground: the grab holds the whole scene, the gate's ring does not hold the body.
                    float own = OccAlpha(uv + duv);
                    v[a * 5 + b] = own > 0.3 ? -1.0 : TapLum(cs.xy / cs.w);
                    nValid += own > 0.3 ? 0 : 1;
                }
            if (nValid < 4)
            {
                [unroll] for (int a2 = 0; a2 < 3; a2++)
                    [unroll] for (int b2 = 0; b2 < 5; b2++)
                    {
                        float3 off = dirWS * ((6.0 + 4.0 * a2) * pxw) + latWS * ((b2 - 2) * 8.0 * pxw);
                        float4 cs = ComputeScreenPos(TransformWorldToHClip(pWS + off));
                        v[a2 * 5 + b2] = TapLum(cs.xy / cs.w);
                    }
                nValid = 15;
            }
            int r25 = (int)round(0.25 * (nValid - 1)), r50 = (int)round(0.5 * (nValid - 1)), r75 = (int)round(0.75 * (nValid - 1));
            float q25 = 0.5, med = 0.5, q75 = 0.5;
            [unroll] for (int i = 0; i < 15; i++)
            {
                int below = 0;
                [unroll] for (int j = 0; j < 15; j++) below += (v[j] >= 0.0 && (v[j] < v[i] || (v[j] == v[i] && j < i))) ? 1 : 0;
                if (v[i] >= 0.0)
                {
                    if (below == r25) q25 = v[i];
                    if (below == r50) med = v[i];
                    if (below == r75) q75 = v[i];
                }
            }
            // A ground of bright veins over dark cells (a wide spread between the quartiles) is judged by its dark cells: the gate's ring median sits there.
            float m = q75 > 3.0 * max(q25, 0.02) ? q25 : med;
            float g = max(_RhOutlineGain, 0.05);
            lo = q25 * g; hi = q75 * g;      // the tone is judged against the dark and the bright end of the ring
            return m * g;
        }

        // The figure's own polarity (the tie break inside the dead zone) is the CPU's ground estimate at its position (_Prior, set by SpriteOutline.Sync): the grab holds the whole
        // scene including the figure itself, so a wide sample of it around the figure's centre would read the figure's own body, not its ground.
        Varyings Vert(Attributes v)
        {
            Varyings o = (Varyings)0;
            o.positionCS = TransformObjectToHClip(v.positionOS);
                o.uv = (v.uv - 0.5) * _UvMap.xy + _UvMap.zw;   // sprite-normalised: 0..1 is the source sprite
            o.color = v.color * unity_SpriteColor;
            o.screen = ComputeScreenPos(o.positionCS);
            o.posWS = TransformObjectToWorld(v.positionOS);
            o.figure = _Prior;
            return o;
        }

        // HDR value that shows as the on-screen luminance L after the neutral tonemapper (identity below 0.74, then compressed: 1.5 shows as about 0.86).
        float ToHdr(float L) { return L <= 0.74 ? L : lerp(0.74, 1.5, saturate((L - 0.74) / 0.12)); }

        half4 Frag(Varyings i) : SV_Target
        {
            float srcA = FigAlpha(i.uv);
            float dil = Dilate(i.uv, _Outline.zw);
            // The source is drawn smaller than its texels (a figure is about 100 px tall on screen), so a single binary dilation aliases into dashes: the coverage is the mean of four
            // rotated-grid samples a quarter of a screen pixel apart (five levels of antialiasing), which keeps a 1 px stroke even and unbroken.
            float2 ddu = ddx(i.uv) * 0.25, ddv = ddy(i.uv) * 0.25;
            float covFull = 0.25 * (step(0.5, Dilate(i.uv + ddu + ddv * 0.5, _Outline.zw)) + step(0.5, Dilate(i.uv - ddu - ddv * 0.5, _Outline.zw))
                                  + step(0.5, Dilate(i.uv - ddu * 0.5 + ddv, _Outline.zw)) + step(0.5, Dilate(i.uv + ddu * 0.5 - ddv, _Outline.zw)));
            if (_MaskMode > 0.5)
            {
                // The mask is the silhouette: the source (drawn by its own mask material) plus the stroke, so the stroke's mask covers the whole dilation.
                clip(covFull * ((_Src2Mode > 1.5) ? 1.0 - smoothstep(0.3, 0.8, Src2Alpha(i.uv)) : 1.0) * i.color.a - 0.5);
                return half4(_MaskColor.rgb, 1);
            }
            if (_RhOutlineDebug > 3.5)
            {
                float2 duv = i.screen.xy / i.screen.w; duv.y = _RhOutlineFlip > 0.5 ? 1.0 - duv.y : duv.y;
                return half4(SAMPLE_TEXTURE2D_LOD(_CameraSortingLayerTexture, sampler_LinearClamp, duv, 0).rgb, 1);
            }
            // The stroke is drawn above the scene, so it must not cover its own source: only the ring outside the silhouette.
            float cov = covFull * (1.0 - smoothstep(0.3, 0.8, srcA));
            if (_Src2Mode > 1.5) cov *= 1.0 - smoothstep(0.3, 0.8, Src2Alpha(i.uv));   // a cutting companion (the body over the footprint) is never stroked over
            clip(cov - 0.002);
            float light = _Prior, l = -1.0, lLo = -1.0, lHi = -1.0;
            if (_RhOutlineGrab > 0.5)
            {
                // Outward direction of the silhouette here: away from the source alpha around the pixel.
                float2 rr = _Outline.zw * 2.0, out2 = 0.0;
                [unroll] for (int k = 0; k < 8; k++)
                {
                    float s, c; sincos(0.7853982 * k, s, c);
                    out2 -= float2(c, s) * FigAlpha(i.uv + float2(c, s) * rr);
                }
                if (dot(out2, out2) > 0.04)
                {
                    float3 dOS = float3(out2.x / _UvMap.x, out2.y / _UvMap.y, 0.0);
                    float3 dWS = TransformObjectToWorldDir(dOS);
                    dWS.z = 0.0; dWS = normalize(dWS);
                    l = RingLuma(i.posWS, i.uv, dWS, lLo, lHi);
                }
                else { l = GroundLuma(i.screen.xy / i.screen.w); lLo = lHi = l; }
                // Hard polarity per pixel; inside the dead zone one polarity per figure decides (a stroke never speckles).
                light = l < _RhOutlineTune.z - _RhOutlineTune.w ? 1.0 : (l > _RhOutlineTune.z + _RhOutlineTune.w ? 0.0 : i.figure);
            }
            // Tone: the stroke is only as strong as the ratio asks for (target _Tone.x against the ground just outside it), clamped, so on dark ground it is a soft
            // light rim and on pale ground a soft dark one; with no grab the full strength stays.
            float R = max(_Tone.x, 1.5), Ls;
            if (l >= 0.0)
                Ls = light > 0.5 ? clamp(R * (lHi + 0.05) - 0.05, _RhOutlineTune.x, 0.86) : clamp((lLo + 0.05) / (R * 1.9) - 0.05, _RhOutlineTune.y, _RhOutlineTone.w);
            else
                Ls = light > 0.5 ? 0.86 : _RhOutlineTune.y;
            float3 rgb = float3(ToHdr(Ls), ToHdr(Ls), ToHdr(Ls) * 1.02);
            if (_RhOutlineDebug > 0.5 && _RhOutlineGrab > 0.5)
            {
                float ld = max(l, 0.0);
                rgb = _RhOutlineDebug < 1.5 ? (light > 0.5 ? float3(1, 0, 1) : float3(0, 1, 0)) : float3(ld, ld, ld) * 3.0;
            }
            return half4(rgb, cov * i.color.a);
        }
        ENDHLSL

        Pass
        {
            Name "Outline2D"
            Tags { "LightMode" = "Universal2D" }
            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            ENDHLSL
        }
        Pass
        {
            Name "OutlineForward"
            Tags { "LightMode" = "UniversalForward" }
            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            ENDHLSL
        }
    }
}
