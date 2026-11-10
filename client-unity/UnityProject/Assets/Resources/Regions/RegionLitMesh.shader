// URP 2D lit shader for baked region meshes (wall rows). _MainTex atlas x vertex colour, Light2D applies. The vertex colour
// is the per-tile brightness tint; uv comes straight from the atlas cell.
Shader "Roguehalla/RegionLitMesh"
{
    Properties
    {
        _MainTex("Atlas", 2D) = "white" {}
        _Exposure("Exposure", Float) = 1
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

            struct Attributes { float3 positionOS : POSITION; float4 color : COLOR; float2 uv : TEXCOORD0; float2 kind : TEXCOORD2; };
            struct Varyings { float4 positionCS : SV_POSITION; half4 color : COLOR; float2 uv : TEXCOORD0; half2 lightingUV : TEXCOORD1; float3 world : TEXCOORD2; };

            #include "Packages/com.unity.render-pipelines.universal/Shaders/2D/Include/LightingUtility.hlsl"

            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);

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

            #include "RhSun.hlsl"
            CBUFFER_START(UnityPerMaterial)
                half _Exposure;
            CBUFFER_END

            Varyings Vert(Attributes v)
            {
                Varyings o = (Varyings)0;
                o.positionCS = TransformObjectToHClip(v.positionOS);
                o.uv = v.uv;
                o.color = v.color;
                o.world = float3(v.positionOS.xy, v.kind.x);
                o.lightingUV = half2(ComputeScreenPos(o.positionCS / o.positionCS.w).xy);
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                half4 main = i.color * SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv);
                clip(main.a - 0.004);
                // Surface kind (mesh uv3.x): 0 flat top, 1 south face, 2 west edge, 3 east edge, 4 unlit decal (contact shadows).
                float kind = i.world.z;
                float ndl = kind < 0.5 ? 0.65 : kind < 1.5 ? 0.0 : kind < 2.5 ? 0.55 : 0.0;
                float sunStr; float3 shMul;
                float3 sunM = kind > 3.5 ? float3(1, 1, 1) : RhSunMul(i.world.xy, ndl, sunStr, shMul);
                main.rgb *= sunM;
                SurfaceData2D surfaceData;
                InputData2D inputData;
                InitializeSurfaceData(main.rgb * _Exposure, main.a, half4(1, 1, 1, 1), half3(0, 0, 1), surfaceData);
                InitializeInputData(i.uv, i.lightingUV, inputData);
                return CombinedShapeLightShared(surfaceData, inputData);
            }
            ENDHLSL
        }
    }
}
