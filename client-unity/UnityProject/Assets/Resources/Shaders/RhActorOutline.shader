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
        struct Varyings { float4 positionCS : SV_POSITION; half4 color : COLOR; float2 uv : TEXCOORD0; float4 screen : TEXCOORD1; nointerpolation float figure : TEXCOORD2; };

        TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
        TEXTURE2D(_SrcTex); SAMPLER(sampler_SrcTex);
        TEXTURE2D(_CameraSortingLayerTexture);   // sampler_LinearClamp comes from the URP core library

        // Per renderer (MaterialPropertyBlock), deliberately outside UnityPerMaterial.
        float4 _SrcRect;   // u0, v0, du, dv: the source sprite's rectangle in its atlas
        float4 _Outline;   // x,y: margin around the sprite as a fraction of its size; z,w: stroke width in sprite-normalised units
        float4 _Halo;      // x,y: halo radius in sprite-normalised units (0 = none), z: strength 0..1
        float4 _SrcTexel;  // x,y: one source texel in sprite-normalised units
        float _Prior;      // 0 dark, 1 light: dead-zone tie break, and the whole decision when there is no sorting layer texture
        float _MaskMode;
        half4 _MaskColor;
        float _RhOutlineGrab; // global, set by ActorOutline: 1 when _CameraSortingLayerTexture is valid this frame

        // Mirrors ActorOutlineModel.cs; SpriteOutline.PublishGlobals writes them (tunable in a page with ?ol.light=, ol.dark=, ol.cross=, ol.dead=).
        float _RhOutlineRadius; // tuning pages only
        float _RhOutlineGain;  // set once per frame by SpriteOutline.PublishFrame: 2^post exposure of the grade
        float4 _RhOutlineTune;   // set by SpriteOutline.PublishGlobals: light HDR value, dark value, crossover luminance, dead zone half width

        float SrcAlpha(float2 sp)
        {
            float2 inside = step(0.0, sp) * step(sp, 1.0);
            float2 c = clamp(sp, 0.5 * _SrcTexel.xy, 1.0 - 0.5 * _SrcTexel.xy);
            float a = SAMPLE_TEXTURE2D(_SrcTex, sampler_SrcTex, _SrcRect.xy + c * _SrcRect.zw).a;
            return a * inside.x * inside.y;
        }

        // Disc dilation of the source alpha by the stroke width: 12 taps on the rim, 6 on a half-width ring, plus the centre.
        float Dilate(float2 sp, float2 w)
        {
            float a = SrcAlpha(sp);
            const float k = 0.5235988;   // 30 degrees
            [unroll] for (int i = 0; i < 12; i++)
            {
                float s, c; sincos(k * i, s, c);
                a = max(a, SrcAlpha(sp + float2(c, s) * w));
            }
            [unroll] for (int j = 0; j < 6; j++)
            {
                float s, c; sincos(k * 0.5 + 1.0471976 * j, s, c);
                a = max(a, SrcAlpha(sp + float2(c, s) * w * 0.5));
            }
            return a;
        }

        float Luma(float3 c) { return dot(c, float3(0.2126, 0.7152, 0.0722)); }

        // Ground luminance behind the stroke: the MEDIAN of thirteen taps of the (4x box filtered) grab within about 0.2 world units (3 to 12 pixels at 1080p) of the pixel.
        // The gate compares the stroke with the median of the ground just outside it, so the polarity must follow the majority of the ground there: on a ground of bright
        // veins over dark cells the mean reads bright and a geometric mean still leans on the veins, the median does not.
        float TapLum(float2 uv)
        {
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

        // The figure's own ground, wide and slow (nine taps out to one world unit, geometric mean): the tie break inside the dead zone, stable from frame to frame on animated ground.
        float FigureLuma(float2 uv)
        {
            float unit = _ScreenParams.y / max(2.0 * unity_OrthoParams.y, 0.01);
            float2 px = unit / _ScreenParams.xy;
            float sum = log(max(TapLum(uv), 0.004));
            [unroll] for (int k = 0; k < 4; k++)
            {
                float s, c; sincos(1.5707963 * k, s, c);
                sum += log(max(TapLum(uv + float2(c, s) * px * 0.5), 0.004));
                sum += log(max(TapLum(uv + float2(s, -c) * px * 1.0), 0.004));
            }
            return exp(sum / 9.0) * max(_RhOutlineGain, 0.05);
        }

        // The vertex shader decides the figure's own polarity once per quad (four vertices), from the ground behind the object's centre.
        Varyings Vert(Attributes v)
        {
            Varyings o = (Varyings)0;
            o.positionCS = TransformObjectToHClip(v.positionOS);
            float2 pad = _Outline.xy;
            o.uv = v.uv * (1.0 + 2.0 * pad) - pad;   // sprite-normalised: 0..1 is the source sprite
            o.color = v.color * unity_SpriteColor;
            o.screen = ComputeScreenPos(o.positionCS);
            float4 c = ComputeScreenPos(TransformObjectToHClip(float3(0, 0, 0)));
            o.figure = _RhOutlineGrab > 0.5 ? (FigureLuma(c.xy / c.w) < _RhOutlineTune.z ? 1.0 : 0.0) : _Prior;
            return o;
        }

        half4 Frag(Varyings i) : SV_Target
        {
            float dil = Dilate(i.uv, _Outline.zw);
            float fw = max(fwidth(dil), 0.12);
            float cov = saturate((dil - 0.5) / fw + 0.5);
            if (_MaskMode > 0.5)
            {
                clip(cov * i.color.a - 0.5);
                return half4(_MaskColor.rgb, 1);
            }
            if (_Halo.z < 0.001) clip(cov - 0.002);
            float light = _Prior;
            if (_RhOutlineGrab > 0.5)
            {
                float l = GroundLuma(i.screen.xy / i.screen.w);
                // Hard choice per pixel; inside the dead zone the figure's own centre decides (one polarity per figure, never a speckled stroke).
                light = l < _RhOutlineTune.z - _RhOutlineTune.w ? 1.0 : (l > _RhOutlineTune.z + _RhOutlineTune.w ? 0.0 : i.figure);
            }
            float3 dark = float3(_RhOutlineTune.y, _RhOutlineTune.y * 1.25, _RhOutlineTune.y * 2.0);
            float3 lite = float3(_RhOutlineTune.x, _RhOutlineTune.x, _RhOutlineTune.x * 1.03);
            float3 rgb = lerp(dark, lite, light);
            float a = cov;
            // Local calming halo (lever 2 of the contrast brief): only where the stroke is light, i.e. on dark and mid ground, a soft darkening of the ground around the figure
            // takes the edge off bright veins and glints that would sit next to a light stroke. Darkening only; never where the stroke is dark, so pale ground is never dimmed.
            if (light > 0.5 && _Halo.z > 0.001 && cov < 0.999)
            {
                float h = 0.0;
                [unroll] for (int q = 0; q < 8; q++)
                {
                    float s, c; sincos(0.7853982 * q, s, c);
                    h = max(h, 0.9 * SrcAlpha(i.uv + float2(c, s) * _Halo.xy * 0.5));
                    h = max(h, 0.5 * SrcAlpha(i.uv + float2(c, s) * _Halo.xy));
                }
                float ha = h * _Halo.z;
                a = max(cov, ha);
                rgb = lerp(float3(0, 0, 0), rgb, saturate(cov / max(a, 1e-4)));
            }
            return half4(rgb, a * i.color.a);
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
