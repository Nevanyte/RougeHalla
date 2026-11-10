// Contrast lab mask: draws a sprite as a flat colour wherever its alpha (texture x vertex colour) is at least _Cutoff, nothing elsewhere.
// Used only by the contrast lab stage (?contrastlab=1) to extract exact silhouette and marker masks from the real renderers. Unlit, opaque output.
Shader "Roguehalla/ContrastLabMask"
{
    Properties
    {
        [PerRendererData] _MainTex("Sprite Texture", 2D) = "white" {}
        _MaskColor("Mask colour", Color) = (1,0,0,1)
        _Cutoff("Alpha cutoff", Range(0,1)) = 0.5
    }
    SubShader
    {
        Tags { "Queue" = "Transparent" "RenderType" = "Transparent" "RenderPipeline" = "UniversalPipeline" }
        Cull Off
        ZWrite Off
        Blend Off

        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
        CBUFFER_START(UnityPerMaterial)
            half4 _MaskColor;
            half _Cutoff;
        CBUFFER_END
        struct Attributes { float3 positionOS : POSITION; half4 color : COLOR; float2 uv : TEXCOORD0; };
        struct Varyings { float4 positionCS : SV_POSITION; half4 color : COLOR; float2 uv : TEXCOORD0; };
        Varyings Vert(Attributes v)
        {
            Varyings o;
            o.positionCS = TransformObjectToHClip(v.positionOS);
            o.color = v.color; o.uv = v.uv;
            return o;
        }
        half4 Frag(Varyings i) : SV_Target
        {
            half a = i.color.a * SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv).a;
            clip(a - _Cutoff);
            return half4(_MaskColor.rgb, 1);
        }
        ENDHLSL

        Pass
        {
            Name "Mask2D"
            Tags { "LightMode" = "Universal2D" }
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            ENDHLSL
        }
        Pass
        {
            Name "MaskForward"
            Tags { "LightMode" = "UniversalForward" }
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            ENDHLSL
        }
    }
}
