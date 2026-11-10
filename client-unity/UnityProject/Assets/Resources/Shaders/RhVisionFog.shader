// Fog of war veil (presentation only). ONE quad over the map; the fog amount per tile comes from a small texture the client
// rebuilds from the public map and its own position (see Roguehalla.Net.VisionField / FogMask). Where the amount is 1 the scene
// is multiplied down and lifted toward a cool grey, so a bright zone dims clearly and a dark zone still reads as veiled; where it
// is 0 the pixel is untouched. Blend One SrcAlpha: result = src.rgb + dst.rgb * src.a. Separate from all lighting shaders.
Shader "Roguehalla/VisionFog"
{
    Properties
    {
        _MainTex("Unused (the sprite pipeline wants one)", 2D) = "white" {}
        _FogTex("Fog (alpha = amount)", 2D) = "black" {}
        _Veil("Veil colour (rgb)", Color) = (0.09, 0.12, 0.19, 1)
        _Dim("Dim (0..1)", Range(0, 1)) = 0.62
        _Lift("Lift toward the veil colour (0..1)", Range(0, 1)) = 0.40
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+100" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" }
        Pass
        {
            Name "VisionFog"
            // The URP 2D renderer draws Universal2D passes (RegionGround does the same); UniversalForward is never drawn by it.
            Tags { "LightMode"="Universal2D" }
            Cull Off
            ZWrite Off
            ZTest Always
            Blend One SrcAlpha
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            TEXTURE2D(_FogTex); SAMPLER(sampler_FogTex);
            CBUFFER_START(UnityPerMaterial)
                half4 _Veil;
                half _Dim;
                half _Lift;
            CBUFFER_END
            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; };
            Varyings vert(Attributes i) { Varyings o; o.positionCS = TransformObjectToHClip(i.positionOS.xyz); o.uv = i.uv; return o; }
            half4 frag(Varyings i) : SV_Target
            {
                half amount = SAMPLE_TEXTURE2D(_FogTex, sampler_FogTex, i.uv).a;
                // rgb is added, a is the multiplier on what is already there.
                return half4(_Veil.rgb * (amount * _Lift), 1.0h - amount * _Dim);
            }
            ENDHLSL
        }
    }
}
