using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// The adaptive neutral outline of one sprite (an actor body, or one of its markers): a child quad under the source sprite whose
    /// shader (RhActorOutline) rebuilds the source silhouette from the source's own atlas, dilates it by a world-space width and
    /// colours it near black or near white against the ground behind it. Draws as part of the actor (child of the source, one sort
    /// step below it), is unlit and never emissive, and takes its opacity only from <see cref="Sync"/>'s alpha, so the vision fade
    /// (which multiplies every SpriteRenderer under the actor root), the hidden and the dead states act on it like on the figure.
    /// Allocation free after construction. Measurement switch: <c>?fx.outline=0</c> turns every outline off (never a preset).
    /// </summary>
    public sealed class SpriteOutline
    {
        public const string ShaderPath = "Shaders/RhActorOutline";
        static Material _material;
        static readonly MaterialPropertyBlock Block = new MaterialPropertyBlock();
        static readonly int SrcTex = Shader.PropertyToID("_SrcTex"), SrcRect = Shader.PropertyToID("_SrcRect"), Outline = Shader.PropertyToID("_Outline"),
            SrcTexel = Shader.PropertyToID("_SrcTexel"), Prior = Shader.PropertyToID("_Prior"), GrabFlag = Shader.PropertyToID("_RhOutlineGrab");

        /// <summary>Measurement switch (<c>?fx.outline=0|1</c>). The outline is readability: no quality preset ever turns it off.</summary>
        public static bool Enabled = true;
        /// <summary>True when the camera sorting layer texture decides the polarity; false uses the CPU prior (also forced by <c>?fx.outlinegrab=0</c>).</summary>
        public static bool UseGrab = true;

        /// <summary>The shared outline material (null when the shader is missing from the build).</summary>
        public static Material SharedMaterial
        {
            get
            {
                if (_material == null)
                {
                    var shader = Resources.Load<Shader>(ShaderPath);
                    if (shader == null) return null;
                    _material = new Material(shader) { name = "Roguehalla / adaptive actor outline" };
                }
                return _material;
            }
        }

        /// <summary>Reads the measurement switches from a page query (<c>fx.outline</c>, <c>fx.outlinegrab</c>) and publishes the grab flag.</summary>
        public static void ConfigureFromUrl(string url)
        {
            if (!string.IsNullOrEmpty(url))
            {
                if (url.Contains("fx.outline=0")) Enabled = false;
                if (url.Contains("fx.outline=1")) Enabled = true;
                if (url.Contains("fx.outlinegrab=0")) SetGrabPass(false);
                WidthScale = QueryFloat(url, "ol.width", 1f); LightHdr = QueryFloat(url, "ol.light", LightHdr); DarkLinear = QueryFloat(url, "ol.dark", DarkLinear);
                Cross = QueryFloat(url, "ol.cross", Cross); GainScale = QueryFloat(url, "ol.gain", GainScale); Dead = QueryFloat(url, "ol.dead", Dead);
            }
            PublishGlobals();
        }

        /// <summary>Tuning for measurement pages only (<c>?ol.width=1.2</c> scales the strokes; <c>ol.light</c>, <c>ol.dark</c>, <c>ol.cross</c>, <c>ol.dead</c> set the shader constants).</summary>
        public static float WidthScale = 1f, LightHdr = ActorOutlineModel.LightLinear, DarkLinear = ActorOutlineModel.DarkLinear, Cross = -1f, Dead = ActorOutlineModel.DeadZone;
        static readonly int Tune = Shader.PropertyToID("_RhOutlineTune");

        /// <summary>
        /// MEASUREMENT ONLY (<c>?fx.outlinegrab=0</c>, the perf harness): switches the 2D renderer's camera sorting layer grab off or on at run time (the renderer reads the
        /// flag every frame) and makes the outline use the CPU prior while it is off. Never called by a quality preset.
        /// </summary>
        public static void SetGrabPass(bool on)
        {
            UseGrab = on; PublishGlobals();
            try
            {
                var asset = UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline;
                var list = asset == null ? null : asset.GetType().GetField("m_RendererDataList", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)?.GetValue(asset) as System.Array;
                if (list == null) return;
                foreach (var data in list)
                    data?.GetType().GetField("m_UseCameraSortingLayersTexture", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)?.SetValue(data, on);
            }
            catch (System.Exception e) { Debug.LogWarning("Outline grab switch unavailable: " + e.Message); }
        }

        static readonly int GainId = Shader.PropertyToID("_RhOutlineGain");
        static int _gainFrame = -1;

        /// <summary>Once per frame: the grab is taken before the post-processing stack, so the shader scales it by the current post exposure to estimate the luminance the player sees.</summary>
        public static void PublishFrame()
        {
            if (_gainFrame == Time.frameCount) return;
            _gainFrame = Time.frameCount;
            float gain = 1f;
            var stack = UnityEngine.Rendering.VolumeManager.instance == null ? null : UnityEngine.Rendering.VolumeManager.instance.stack;
            var ca = stack == null ? null : stack.GetComponent<UnityEngine.Rendering.Universal.ColorAdjustments>();
            if (ca != null && ca.active) gain = Mathf.Pow(2f, ca.postExposure.value);
            Shader.SetGlobalFloat(GainId, gain * GainScale);
        }
        /// <summary>Extra gain for tuning pages (<c>?ol.gain=</c>).</summary>
        public static float GainScale = 1f;

        public static void PublishGlobals()
        {
            Shader.SetGlobalFloat(GrabFlag, UseGrab ? 1f : 0f);
            float cross = Cross > 0f ? Cross : ActorOutlineModel.Crossover();
            Shader.SetGlobalVector(Tune, new Vector4(LightHdr, DarkLinear, cross, Dead));
        }

        static float QueryFloat(string url, string key, float fallback)
        {
            int i = url.IndexOf(key + "=", System.StringComparison.Ordinal); if (i < 0) return fallback;
            i += key.Length + 1; int j = i; while (j < url.Length && url[j] != '&' && url[j] != '#') j++;
            return float.TryParse(url.Substring(i, j - i), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float v) ? v : fallback;
        }

        public readonly SpriteRenderer Quad;
        readonly SpriteRenderer _source;
        readonly Transform _t;
        readonly float _width;
        Sprite _sprite; Vector3 _scale; float _prior = -1f; bool _dirty;

        /// <param name="source">the sprite renderer to outline; the stroke is a child of it</param>
        /// <param name="name">name of the stroke object (the contrast lab classifies it by name: " outline" suffix, or the body's "Character contrast rim")</param>
        /// <param name="width">stroke width in world units</param>
        public SpriteOutline(SpriteRenderer source, string name, float width)
        {
            _source = source; _width = width;
            Quad = ShowcaseSprites.Create(source.transform, name, "bar", 0, Color.white, Vector2.one, Vector3.zero, false);
            Quad.sharedMaterial = SharedMaterial != null ? SharedMaterial : ShowcaseSprites.Unlit;
            Quad.enabled = false; _t = Quad.transform;
        }

        /// <summary>
        /// Call after the source's sprite, transform, enabled state and sort order are final for the frame. <paramref name="alpha"/> is the stroke's own
        /// opacity before any fade; <paramref name="prior"/> is 1 when the CPU estimate says the ground is dark (light stroke), else 0.
        /// </summary>
        public void Sync(int order, float alpha, bool dark)
        {
            PublishFrame();
            var sprite = _source.sprite;
            bool on = Enabled && _source.enabled && sprite != null && alpha > 0f && SharedMaterial != null;
            if (Quad.enabled != on) Quad.enabled = on;
            if (!on) return;
            Quad.sortingOrder = order;
            var c = Quad.color; if (c.a != alpha || c.r != 1f) { Quad.color = new Color(1f, 1f, 1f, alpha); }
            var scale = _source.transform.lossyScale;
            float prior = dark ? 1f : 0f;
            if (!ReferenceEquals(sprite, _sprite) || scale != _scale || prior != _prior)
            {
                _sprite = sprite; _scale = scale; _prior = prior;
                Rebuild(sprite, scale, prior);
            }
        }

        void Rebuild(Sprite sprite, Vector3 lossy, float prior)
        {
            var tex = sprite.texture; var r = sprite.textureRect;
            float ppu = sprite.pixelsPerUnit;
            float sx = r.width / ppu, sy = r.height / ppu;                       // sprite size in the source's local units
            float worldX = Mathf.Max(1e-4f, sx * Mathf.Abs(lossy.x)), worldY = Mathf.Max(1e-4f, sy * Mathf.Abs(lossy.y));
            float w = _width * WidthScale, wx = w / worldX, wy = w / worldY;                    // stroke width as a fraction of the sprite size
            float padX = wx + .02f, padY = wy + .02f;
            var pivot = sprite.pivot;                                            // pixels from the rect's lower left
            _t.localPosition = new Vector3((.5f - pivot.x / r.width) * sx, (.5f - pivot.y / r.height) * sy, 0f);
            _t.localScale = new Vector3(sx * (1f + 2f * padX), sy * (1f + 2f * padY), 1f);
            _t.localRotation = Quaternion.identity;
            Block.Clear();
            Block.SetTexture(SrcTex, tex);
            Block.SetVector(SrcRect, new Vector4(r.x / tex.width, r.y / tex.height, r.width / tex.width, r.height / tex.height));
            Block.SetVector(Outline, new Vector4(padX, padY, wx, wy));
            Block.SetVector(SrcTexel, new Vector4(1f / r.width, 1f / r.height, 0, 0));
            Block.SetFloat(Prior, prior);
            Quad.SetPropertyBlock(Block);
        }
    }
}
