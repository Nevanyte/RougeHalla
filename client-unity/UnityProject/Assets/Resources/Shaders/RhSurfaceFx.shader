// Ground marks for the surface effects (prints, ripples, wakes): one alpha-blended, per-vertex-animated quad batch lit like props
// (2D lights x the shared one-sun term in RhSun.hlsl). Age, fade and ripple growth are computed here from the birth time in the
// vertex data, so the CPU only touches a vertex when a mark is born. Fade mirrors TrackLife.Alpha in RoguehallaNet/Net/SurfaceFxModel.cs.
//   TEXCOORD0 atlas uv | TEXCOORD1 (corner offset xy in world units at scale 1, birth, life) | TEXCOORD2 (scale from, scale to, style, fade seconds)
//   TEXCOORD3 sun direction in the quad's atlas uv space | COLOR tint rgb and peak alpha
// style: 0 flat, 1 sand dent, 2 snow print, 3 wet/mud print with a brief glisten, 5 glow (lit only 30%)
Shader "Roguehalla/SurfaceFx"
{
    Properties { _MainTex("Atlas", 2D) = "white" {} }
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

            struct Attributes { float3 positionOS : POSITION; float2 uv : TEXCOORD0; float4 a : TEXCOORD1; float4 b : TEXCOORD2; float2 sun : TEXCOORD3; float4 color : COLOR; };
            struct Varyings
            {
                float4 positionCS : SV_POSITION; half4 color : COLOR; float2 uv : TEXCOORD0; half2 lightingUV : TEXCOORD1;
                float2 world : TEXCOORD2; float4 info : TEXCOORD3; float2 sun : TEXCOORD4;   // info: age, life, style, fade seconds
            };

            #include "Packages/com.unity.render-pipelines.universal/Shaders/2D/Include/LightingUtility.hlsl"

            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
            // _RhFxNow (seconds, set by SurfaceFx each frame, same clock as the birth times) is declared in RhSun.hlsl, included below; declaring it twice is an error on GLES3 (contrast branch fix)
            float _RhFxGlisten;   // 1 lets mud and wet prints glisten briefly

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
            #include "Assets/Resources/Regions/RhSun.hlsl"

            Varyings Vert(Attributes v)
            {
                Varyings o = (Varyings)0;
                float age = _RhFxNow - v.a.z;
                float t = saturate(age / max(v.a.w, 0.001));
                float e = 1.0 - (1.0 - t) * (1.0 - t);
                float scale = lerp(v.b.x, v.b.y, e);
                float3 p = v.positionOS + float3(v.a.xy * scale, 0);
                o.positionCS = TransformObjectToHClip(p);
                o.uv = v.uv; o.color = v.color; o.sun = v.sun;
                o.world = TransformObjectToWorld(p).xy;
                o.info = float4(age, v.a.w, v.b.z, v.b.w);
                o.lightingUV = half2(ComputeScreenPos(o.positionCS / o.positionCS.w).xy);
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                float age = i.info.x, life = i.info.y, fadeS = max(i.info.w, 0.001);
                clip(age); clip(life - age);
                float fadeIn = saturate(age / 0.1);
                float tail = 1.0 - smoothstep(0.0, 1.0, saturate((age - (life - fadeS)) / fadeS));
                float fade = fadeIn * tail;
                half4 tex = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv);
                float h0 = tex.r, mask = tex.a;
                int style = (int)(i.info.z + 0.5);
                float3 col = i.color.rgb; float alpha = i.color.a * mask * fade;
                if (style >= 1 && style <= 3)
                {
                    float2 L = normalize(i.sun + float2(1e-4, 1e-4)) * 0.075;
                    float g = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv - L).r - SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv + L).r;
                    float shadow = saturate(g * 3.0), lit = saturate(-g * 3.0);
                    if (style == 1) col = col * (0.8 + 0.3 * h0) * (1.0 + 0.7 * lit - 0.5 * shadow);
                    else if (style == 2)
                    {
                        col = lerp(col, float3(0.95, 0.97, 1.0), lit * 0.8);
                        col = lerp(col, float3(0.16, 0.24, 0.45), shadow * 0.7);
                        alpha = saturate(i.color.a * (mask * 0.85 + lit * 0.5) * fade);
                    }
                    else
                    {
                        float gl = lit * (1.0 - saturate(age / 1.4)) * _RhFxGlisten;
                        col += gl * float3(0.32, 0.36, 0.4);
                    }
                }
                clip(alpha - 0.004);
                float sunStr; float3 shMul;
                float3 sunMul = RhSunMul(i.world, 0.55, sunStr, shMul);
                col *= (style == 5) ? lerp(float3(1, 1, 1), sunMul, 0.3) : sunMul;
                SurfaceData2D surfaceData;
                InputData2D inputData;
                InitializeSurfaceData(col, alpha, half4(1, 1, 1, 1), half3(0, 0, 1), surfaceData);
                InitializeInputData(i.uv, i.lightingUV, inputData);
                return CombinedShapeLightShared(surfaceData, inputData);
            }
            ENDHLSL
        }
    }
}
