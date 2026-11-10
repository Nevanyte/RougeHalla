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
            UvMapId = Shader.PropertyToID("_UvMap"), Src2TexId = Shader.PropertyToID("_Src2Tex"), Src2RectId = Shader.PropertyToID("_Src2Rect"), Src2TexelId = Shader.PropertyToID("_Src2Texel"),
            ToSrc2Id = Shader.PropertyToID("_ToSrc2"), Src2ModeId = Shader.PropertyToID("_Src2Mode"),
            SrcTexel = Shader.PropertyToID("_SrcTexel"), ToneId = Shader.PropertyToID("_Tone"), Prior = Shader.PropertyToID("_Prior"), GrabFlag = Shader.PropertyToID("_RhOutlineGrab"), RimFlag = Shader.PropertyToID("_RhRim");

        /// <summary>
        /// Owner decision 2026-11-10: NO line outline on characters by default (contrast risk accepted). <c>?fx.outline=1</c> brings the opt-in 1 px variant back (figures, weapon cue, foot marker, plates).
        /// No quality preset ever touches it.
        /// </summary>
        public static bool Enabled = false;
        /// <summary>Opt-in <c>?fx.rim=1</c>: the sprite's own outermost opaque pixels are lightened/darkened (RegionActorLit). It also needs the ground polarity, so it shares the grab.</summary>
        public static bool Rim = false;
        /// <summary>True when the camera sorting layer texture decides the polarity; false uses the CPU prior. The grab itself is only taken while an opt-in variant is on (<see cref="WantGrab"/>).</summary>
        public static bool UseGrab = false;
        /// <summary>The grab is wanted only when an opt-in variant reads it.</summary>
        public static bool WantGrab { get { return Enabled || Rim; } }

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
                if (url.Contains("fx.rim=1")) Rim = true;
                if (url.Contains("fx.rim=0")) Rim = false;
                ApplyGrab(!url.Contains("fx.outlinegrab=0"));
                WidthScale = QueryFloat(url, "ol.width", 1f); LightHdr = QueryFloat(url, "ol.light", LightHdr); DarkLinear = QueryFloat(url, "ol.dark", DarkLinear);
                Cross = QueryFloat(url, "ol.cross", Cross); GainScale = QueryFloat(url, "ol.gain", GainScale); ToneScale = QueryFloat(url, "ol.tone", 1f); RadiusScale = QueryFloat(url, "ol.r", 1f); Flip = QueryFloat(url, "ol.flip", 0f); DebugView = QueryFloat(url, "ol.debug", 0f);
                int down = (int)QueryFloat(url, "ol.down", -1); if (down >= 0) SetGrabDownsampling(down); Dead = QueryFloat(url, "ol.dead", Dead);
            }
            else ApplyGrab(true);
            PublishGlobals();
        }

        /// <summary>The camera sorting layer grab (a full-frame HDR copy) is OFF unless an opt-in variant reads it; when it is on, it is taken at half resolution (only the ground polarity is needed).</summary>
        public static void ApplyGrab(bool allowed)
        {
            bool on = allowed && WantGrab;
            SetGrabPass(on);
            if (on) SetGrabDownsampling(1);
        }

        /// <summary>Tuning for measurement pages only (<c>?ol.width=1.2</c> scales the strokes; <c>ol.light</c>, <c>ol.dark</c>, <c>ol.cross</c>, <c>ol.dead</c> set the shader constants).</summary>
        public static float WidthScale = 1f, LightHdr = ActorOutlineModel.LightLinear, DarkLinear = ActorOutlineModel.DarkLinear, Cross = -1f, Dead = ActorOutlineModel.DeadZone;
        static readonly int Tune = Shader.PropertyToID("_RhOutlineTune"), RadiusId = Shader.PropertyToID("_RhOutlineRadius"), FlipId = Shader.PropertyToID("_RhOutlineFlip"), DebugId = Shader.PropertyToID("_RhOutlineDebug"), ToneVec = Shader.PropertyToID("_RhOutlineTone");

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

        /// <summary>Measurement: sets the grab's downsampling at run time (0 none, 1 2x bilinear, 2 4x box, 3 4x bilinear); the renderer re-reads it every frame.</summary>
        public static void SetGrabDownsampling(int method)
        {
            try
            {
                var asset = UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline;
                var list = asset == null ? null : asset.GetType().GetField("m_RendererDataList", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)?.GetValue(asset) as System.Array;
                if (list == null) return;
                foreach (var data in list)
                    data?.GetType().GetField("m_CameraSortingLayerDownsamplingMethod", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)?.SetValue(data, method);
            }
            catch (System.Exception e) { Debug.LogWarning("Outline grab downsampling switch unavailable: " + e.Message); }
        }
        public static float RadiusScale = 1f, Flip = 0f, DebugView = 0f, ToneScale = 1f;

        public static void PublishGlobals()
        {
            Shader.SetGlobalFloat(GrabFlag, UseGrab ? 1f : 0f); Shader.SetGlobalFloat(RimFlag, Rim ? 1f : 0f);
            float cross = Cross > 0f ? Cross : ActorOutlineModel.Threshold;
            Shader.SetGlobalVector(Tune, new Vector4(ActorOutlineModel.LightFloor, ActorOutlineModel.DarkLuma, cross, Dead)); Shader.SetGlobalVector(ToneVec, new Vector4(0, 0, 0, ActorOutlineModel.DarkCeil)); Shader.SetGlobalFloat(RadiusId, RadiusScale); Shader.SetGlobalFloat(FlipId, Flip); Shader.SetGlobalFloat(DebugId, DebugView);
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
        readonly float _width, _ratio;
        Sprite _sprite; Vector3 _scale; float _prior = -1f; bool _dirty;
        SpriteRenderer _comp; bool _compUnion, _compWas;

        /// <param name="source">the sprite renderer to outline; the stroke is a child of it</param>
        /// <param name="name">name of the stroke object (the contrast lab classifies it by name: " outline" suffix, or the body's "Character contrast rim")</param>
        /// <param name="width">stroke width in world units</param>
        public SpriteOutline(SpriteRenderer source, string name, float width, float ratio = ActorOutlineModel.TargetRatio)
        {
            _source = source; _width = width; _ratio = ratio;
            Quad = ShowcaseSprites.Create(source.transform, name, "bar", 0, Color.white, Vector2.one, Vector3.zero, false);
            Quad.sharedMaterial = SharedMaterial != null ? SharedMaterial : ShowcaseSprites.Unlit;
            if (StrokeLayer.Exists) Quad.sortingLayerID = StrokeLayer.Id;   // above the props, walls and figures that stand in front
            Quad.enabled = false; _t = Quad.transform;
        }

        /// <summary>
        /// A second sprite of the same figure that this stroke must account for: with <paramref name="union"/> the stroke is one line around both sprites (the body and its held weapon: a pixel
        /// is stroked once and never over the other part); otherwise it is cut wherever the companion is drawn (the footprint's stroke never crosses the body standing on it).
        /// </summary>
        public void SetCompanion(SpriteRenderer other, bool union) { _comp = other; _compUnion = union; }

        static Matrix4x4 Norm(Sprite sp)
        {
            var r = sp.textureRect; var pv = sp.pivot; float ppu = sp.pixelsPerUnit;
            return Matrix4x4.TRS(new Vector3(pv.x / r.width, pv.y / r.height, 0f), Quaternion.identity, new Vector3(ppu / r.width, ppu / r.height, 1f));
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
            bool comp = _comp != null && _comp.enabled && _comp.sprite != null && _comp.color.a > 0f;
            // With a companion the geometry follows the other sprite's pose too: rebuilt every frame from the current frame only (no history).
            if (!ReferenceEquals(sprite, _sprite) || scale != _scale || prior != _prior || comp || _compWas)
            {
                _sprite = sprite; _scale = scale; _prior = prior; _compWas = comp;
                Rebuild(sprite, scale, prior, comp ? _comp : null);
            }
        }

        /// <summary>Sync with the source's own sort order (plates whose owner rewrites the order every frame).</summary>
        public void SyncFollow(float alpha, bool dark) { Sync(_source.sortingOrder, alpha, dark); }

        void Rebuild(Sprite sprite, Vector3 lossy, float prior, SpriteRenderer comp)
        {
            var tex = sprite.texture; var r = sprite.textureRect;
            float ppu = sprite.pixelsPerUnit;
            float sx = r.width / ppu, sy = r.height / ppu;                       // sprite size in the source's local units
            float worldX = Mathf.Max(1e-4f, sx * Mathf.Abs(lossy.x)), worldY = Mathf.Max(1e-4f, sy * Mathf.Abs(lossy.y));
            float w = _width * WidthScale, wx = w / worldX, wy = w / worldY;                    // stroke width as a fraction of the sprite size
            float padX = wx + .02f, padY = wy + .02f;
            var pivot = sprite.pivot;                                            // pixels from the rect's lower left
            // The quad covers the source (and, for a union, the companion) plus the stroke margin, in the source's local units.
            float minX = -pivot.x / ppu, minY = -pivot.y / ppu, maxX = minX + sx, maxY = minY + sy;
            Matrix4x4 toComp = Matrix4x4.identity; bool union = comp != null && _compUnion;
            if (comp != null)
            {
                var c2 = comp.sprite; var rc = c2.textureRect; float ppu2 = c2.pixelsPerUnit; var pv2 = c2.pivot;
                var w1 = _source.transform.localToWorldMatrix; var w2 = comp.transform.localToWorldMatrix;
                toComp = Norm(c2) * w2.inverse * w1 * Norm(sprite).inverse;
                if (union)
                {
                    float cminX = -pv2.x / ppu2, cminY = -pv2.y / ppu2, cmaxX = cminX + rc.width / ppu2, cmaxY = cminY + rc.height / ppu2;
                    var toMain = w1.inverse * w2;
                    for (int k = 0; k < 4; k++)
                    {
                        var p = toMain.MultiplyPoint3x4(new Vector3((k & 1) == 0 ? cminX : cmaxX, (k & 2) == 0 ? cminY : cmaxY, 0f));
                        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
                    }
                }
            }
            float mx = padX * sx, my = padY * sy;
            minX -= mx; maxX += mx; minY -= my; maxY += my;
            float bw = maxX - minX, bh = maxY - minY, cx = .5f * (minX + maxX), cy = .5f * (minY + maxY);
            float mainMinX = -pivot.x / ppu, mainMinY = -pivot.y / ppu;
            _t.localPosition = new Vector3(cx, cy, 0f);
            _t.localScale = new Vector3(bw, bh, 1f);
            _t.localRotation = Quaternion.identity;
            Block.Clear();
            Block.SetTexture(SrcTex, tex);
            Block.SetVector(SrcRect, new Vector4(r.x / tex.width, r.y / tex.height, r.width / tex.width, r.height / tex.height));
            Block.SetVector(Outline, new Vector4(padX, padY, wx, wy));
            Block.SetVector(UvMapId, new Vector4(bw / sx, bh / sy, (cx - mainMinX) / sx, (cy - mainMinY) / sy));
            if (comp != null)
            {
                var c2 = comp.sprite; var rc = c2.textureRect; var t2 = c2.texture;
                Block.SetTexture(Src2TexId, t2);
                Block.SetVector(Src2RectId, new Vector4(rc.x / t2.width, rc.y / t2.height, rc.width / t2.width, rc.height / t2.height));
                Block.SetVector(Src2TexelId, new Vector4(1f / rc.width, 1f / rc.height, 0, 0));
                Block.SetMatrix(ToSrc2Id, toComp);
                Block.SetFloat(Src2ModeId, union ? 1f : 2f);
            }
            else Block.SetFloat(Src2ModeId, 0f);
            Block.SetVector(ToneId, new Vector4(_ratio * ToneScale, 0, 0, 0));
            Block.SetVector(SrcTexel, new Vector4(1f / r.width, 1f / r.height, 0, 0));
            Block.SetFloat(Prior, prior);
            Quad.SetPropertyBlock(Block);
        }
    }
}
