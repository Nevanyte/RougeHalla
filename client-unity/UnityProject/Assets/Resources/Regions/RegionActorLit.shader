// Character sprites lit by the same analytic local lights as the ground, walls and props, so a lantern or lava glow that reaches the floor
// reaches the people standing in it (render pass, switch fx.actorlights). A pseudo normal from the sprite's own alpha and luma gives a soft
// diffuse response and a thin rim on the side facing a light, both only INSIDE the silhouette (never the outermost 3 px). It is additive on top of the regular global light, never darkens, takes no wall
// shadow and no cookie, and the outline and the silhouette contrast gate belong to the contrast pass and are untouched.
// With the actor-light switch off, the shader behaves exactly like the stock lit sprite (mask 1: the Light2D twins light it).
Shader "Roguehalla/ActorLit"
{
    Properties
    {
        [PerRendererData] _MainTex("Sprite Texture", 2D) = "white" {}
        [PerRendererData] _MaskTex("Mask", 2D) = "white" {}
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

            struct Attributes { float3 positionOS : POSITION; float4 color : COLOR; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionCS : SV_POSITION; half4 color : COLOR; float2 uv : TEXCOORD0; half2 lightingUV : TEXCOORD1; float2 world : TEXCOORD2; };

            #include "Packages/com.unity.render-pipelines.universal/Shaders/2D/Include/LightingUtility.hlsl"

            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
            TEXTURE2D(_MaskTex); SAMPLER(sampler_MaskTex);

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
            #include "RhLocalLights.hlsl"

            Varyings Vert(Attributes v)
            {
                Varyings o = (Varyings)0;
                o.positionCS = TransformObjectToHClip(v.positionOS);
                o.uv = v.uv; o.color = v.color * unity_SpriteColor;   // as the stock lit sprite: SpriteRenderer.color reaches the body through unity_SpriteColor (vision fades and tints; UI lab finding)
                o.world = TransformObjectToWorld(v.positionOS).xy;
                o.lightingUV = half2(ComputeScreenPos(o.positionCS / o.positionCS.w).xy);
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                half4 main = i.color * SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv);
                half4 mask = SAMPLE_TEXTURE2D(_MaskTex, sampler_MaskTex, i.uv);
                clip(main.a - 0.004);
                bool analytic = _RhLG.y > 0.5 && _RhLI.x > 0.5;      // actors are lit by the field (and the Light2D twins are masked off)
                // Pseudo normal taps are computed here, outside any branch, so the derivatives are well defined.
                float2 px = abs(float2(ddx(i.uv.x), ddy(i.uv.y))) + 1e-5;
                float2 oa = px * 6.0, ol = px * 1.2, oi = px * 3.0;
                float aR = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv + float2(oa.x, 0)).a, aL = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv - float2(oa.x, 0)).a;
                float aU = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv + float2(0, oa.y)).a, aD = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv - float2(0, oa.y)).a;
                // Interior mask: the outermost 3 px of the drawn silhouette are never touched by this shader (the character outline and its contrast belong to
                // the contrast pass); light and rim only act on pixels at least 3 px inside, fading in over 2 more.
                float iR = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv + float2(oi.x, 0)).a, iL = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv - float2(oi.x, 0)).a;
                float iU = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv + float2(0, oi.y)).a, iD = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv - float2(0, oi.y)).a;
                float inner = smoothstep(0.6, 0.98, min(min(iR, iL), min(iU, iD)));
                float3 lw = float3(0.2126, 0.7152, 0.0722);
                float lR = dot(SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv + float2(ol.x, 0)).rgb, lw), lL = dot(SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv - float2(ol.x, 0)).rgb, lw);
                float lU = dot(SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv + float2(0, ol.y)).rgb, lw), lD = dot(SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv - float2(0, ol.y)).rgb, lw);
                SurfaceData2D surfaceData;
                InputData2D inputData;
                InitializeSurfaceData(main.rgb, main.a, analytic ? half4(0, 0, 0, 0) : mask, half3(0, 0, 1), surfaceData);
                InitializeInputData(i.uv, i.lightingUV, inputData);
                half4 lit = CombinedShapeLightShared(surfaceData, inputData);
                [branch] if (analytic)
                {
                    float2 pt = float2(i.world.x, -i.world.y / _RhMapInfo.z);
                    [branch] if (RhAnyLight(pt))
                    {
                        float2 tilt = float2(-(aR - aL) * 1.1 - (lR - lL) * 0.9, (aU - aD) * 1.1 + (lU - lD) * 0.9);   // tile space: y is down
                        float3 n = normalize(float3(tilt, 1.0));
                        float3 dif, spc;
                        RhLocalLights(pt, n, 0.0, 12.0, 0.0, 0.0, 0.30, dif, spc);
                        float hr = RhHeadroom(lit.rgb);
                        lit.rgb += (main.rgb * dif * 0.8 * hr + spc * saturate(hr + 0.05)) * main.a * inner;
                    }
                }
                return lit;
            }
            ENDHLSL
        }
    }
}
