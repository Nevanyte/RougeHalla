// Fog of war on the minimap and the Tab map (uGUI RawImage). Same texture as the world layer (alpha = fog amount). Seen ground gets a
// faint cool lift ("brighter ground: vision", as the legacy minimap), unseen ground a dark veil, with the soft edge between them.
// Presentation only; it reveals nothing the server did not deliver.
Shader "Roguehalla/VisionFogUi"
{
    Properties
    {
        [PerRendererData] _MainTex("Fog (alpha = amount)", 2D) = "white" {}
        _Color("Tint", Color) = (1,1,1,1)
        _Seen("Seen lift (rgb, a)", Color) = (0.80, 0.90, 1.00, 0.10)
        _Unseen("Unseen veil (rgb, a)", Color) = (0.03, 0.05, 0.09, 0.60)
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "IgnoreProjector"="True" "RenderType"="Transparent" "PreviewType"="Plane" "CanUseSpriteAtlas"="False" }
        Cull Off
        Lighting Off
        ZWrite Off
        ZTest [unity_GUIZTestMode]
        Blend SrcAlpha OneMinusSrcAlpha
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            sampler2D _MainTex;
            fixed4 _Color, _Seen, _Unseen;
            struct appdata { float4 vertex : POSITION; float4 color : COLOR; float2 uv : TEXCOORD0; };
            struct v2f { float4 pos : SV_POSITION; fixed4 color : COLOR; float2 uv : TEXCOORD0; };
            v2f vert(appdata v) { v2f o; o.pos = UnityObjectToClipPos(v.vertex); o.uv = v.uv; o.color = v.color * _Color; return o; }
            fixed4 frag(v2f i) : SV_Target
            {
                fixed amount = tex2D(_MainTex, i.uv).a;
                fixed4 c = lerp(_Seen, _Unseen, amount);
                c.a *= i.color.a;
                return c;
            }
            ENDCG
        }
    }
}
