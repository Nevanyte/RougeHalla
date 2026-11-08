using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace Roguehalla.Client
{
    /// <summary>Original 2D material artwork. Created once, shared by all presentations; no simulation state.</summary>
    public static class ShowcaseSprites
    {
        static readonly Dictionary<string, Sprite> Sprites = new Dictionary<string, Sprite>();
        static readonly List<Object> Owned = new List<Object>();
        public static Material Lit { get; private set; }
        public static Material Unlit { get; private set; }

        public static void Initialize()
        {
            if (Lit != null) return;
            Lit = new Material(Shader.Find("Universal Render Pipeline/2D/Sprite-Lit-Default")) { name = "Roguehalla / lit artwork" };
            Unlit = new Material(Shader.Find("Universal Render Pipeline/2D/Sprite-Unlit-Default")) { name = "Roguehalla / essential indicators" };
            Owned.Add(Lit); Owned.Add(Unlit);
        }

        public static Sprite Get(string key)
        {
            Initialize();
            if (Sprites.TryGetValue(key, out var cached)) return cached;
            const int n = 128;
            var texture = new Texture2D(n, n, TextureFormat.RGBA32, false) { name = "Original / " + key, filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
            var pixels = new Color[n * n];
            for (int y = 0; y < n; y++) for (int x = 0; x < n; x++)
            {
                float u = (x + .5f) / n * 2 - 1, v = (y + .5f) / n * 2 - 1;
                float r = Mathf.Sqrt(u * u + v * v), a = 1;
                float grain = Noise(x, y) * .08f;
                Color c = Color.white;
                switch (key)
                {
                    case "glow": a = Mathf.Pow(Mathf.Max(0, 1 - r), 2.5f); break;
                    case "shadow": a = Mathf.Pow(Mathf.Max(0, 1 - r), 1.4f) * .55f; c = new Color(.015f, .02f, .035f); break;
                    case "ring": a = Mathf.Clamp01((.055f - Mathf.Abs(r - .86f)) * 100); break;
                    case "rune":
                        a = Mathf.Clamp01((.035f - Mathf.Abs(Mathf.Abs(u) + Mathf.Abs(v) - .66f)) * 100);
                        if (Mathf.Abs(u) < .024f && Mathf.Abs(v) < .8f) a = 1;
                        break;
                    case "spark": a = Mathf.Clamp01((1 - Mathf.Abs(u) * 1.5f - Mathf.Abs(v)) * 8); break;
                    case "stone":
                        float edge = Mathf.Min(1 - Mathf.Abs(u), 1 - Mathf.Abs(v));
                        float light = .55f + grain + Mathf.Clamp(edge * 5, 0, .2f) + v * .08f;
                        if (Mathf.Abs(v - .1f + Mathf.Sin(u * 8) * .02f) < .012f && u < .5f) light *= .75f;
                        c = new Color(light * .81f, light * .88f, light);
                        a = Mathf.Clamp01(edge * 70);
                        break;
                    case "floor":
                        float mortar = (x % 32 < 2 || (y + (x / 32 % 2) * 16) % 32 < 2) ? .73f : 1;
                        c = new Color((.43f + grain) * mortar, (.48f + grain) * mortar, (.54f + grain) * mortar);
                        break;
                    case "bar": break;
                    case "chest":
                        a = Mathf.Abs(u) < .88f && Mathf.Abs(v) < .62f ? 1 : 0;
                        bool trim = Mathf.Abs(u) > .62f || Mathf.Abs(v) > .45f || Mathf.Abs(u) < .08f;
                        c = trim ? new Color(.88f, .68f, .3f) : new Color(.26f + grain, .15f + grain, .11f + grain);
                        break;
                    default:
                        if (key.StartsWith("sigil"))
                        {
                            int kind = key[key.Length - 1] - '0';
                            float d = 2;
                            if (kind == 0) d = Mathf.Min(Segment(u,v,-.55f,-.55f,0,.7f), Mathf.Min(Segment(u,v,0,.7f,.55f,-.55f),Segment(u,v,-.55f,-.55f,.55f,-.55f)));
                            else if (kind == 1) d = Mathf.Min(Mathf.Abs(u), Mathf.Abs(v) + Mathf.Abs(u) * .15f);
                            else if (kind == 2) d = Mathf.Min(Mathf.Abs(new Vector2(u,v-.35f).magnitude-.28f), Mathf.Min(Mathf.Abs(new Vector2(u-.31f,v+.22f).magnitude-.28f),Mathf.Abs(new Vector2(u+.31f,v+.22f).magnitude-.28f)));
                            else if (kind == 3) d = Mathf.Min(Mathf.Abs(u),Mathf.Min(Mathf.Abs(v-u*.58f),Mathf.Abs(v+u*.58f)));
                            else d = Mathf.Min(Mathf.Abs(r-.65f), Mathf.Min(Segment(u,v,0,-.75f,0,.4f),Segment(u,v,-.3f,-.1f,.3f,-.1f)));
                            a = Mathf.Clamp01((.055f-d)*65) * Mathf.Clamp01((.9f-r)*30);
                        }
                        else if (key.StartsWith("weapon"))
                        {
                            int weapon = key[key.Length-1]-'0'; bool inside;
                            if(weapon==0) inside = Mathf.Abs(u)<.1f && v>-.55f && v<.75f-Mathf.Abs(u) || Mathf.Abs(u)<.4f && Mathf.Abs(v+.25f)<.065f;
                            else if(weapon==1) inside = Mathf.Abs(new Vector2(u+.3f,v).magnitude-.7f)<.075f && u>-.25f || Mathf.Abs(u+.25f)<.025f && Mathf.Abs(v)<.7f;
                            else if(weapon==2) inside = Mathf.Abs(u)<.055f && v>-.8f && v<.55f || Mathf.Abs(u)+Mathf.Abs(v-.5f)<.3f;
                            else if(weapon==3) inside = Mathf.Abs(u)<.6f && v<.55f && v>-.8f+Mathf.Abs(u)*.7f;
                            else if(weapon==4) inside = Mathf.Abs(u)<.07f && v>-.8f && v<.7f || v>.25f && v<.65f && u>-.5f && u<.45f;
                            else inside = new Vector2(u-.25f,v).magnitude<.28f || new Vector2(u+.25f,v).magnitude<.28f;
                            a = inside ? 1 : 0; float l = .75f + u*.18f + v*.1f;
                            c = new Color(l*.92f,l*.95f,l);
                            if(weapon==2 && v>.3f) c = new Color(.6f,.4f,1);
                        }
                        else a = Mathf.Clamp01((1 - r) * 100);
                        break;
                }
                c.a = a; pixels[y * n + x] = c;
            }
            texture.SetPixels(pixels); texture.Apply(false, true);
            SecondarySpriteTexture[] secondary = null;
            if (key == "stone" || key == "floor")
            {
                var normals = new Texture2D(n, n, TextureFormat.RGBA32, false, true) { name = key + " / relief normals", filterMode = FilterMode.Bilinear };
                var data = new Color[n * n];
                for (int y = 0; y < n; y++) for (int x = 0; x < n; x++)
                {
                    float dx = key == "stone" ? (x < 10 ? -.5f : x > n - 11 ? .5f : 0) : (x % 32 < 3 ? -.3f : x % 32 > 28 ? .3f : 0);
                    float dy = key == "stone" ? (y < 10 ? -.5f : y > n - 11 ? .5f : 0) : (y % 32 < 3 ? -.3f : y % 32 > 28 ? .3f : 0);
                    var normal = new Vector3(dx, dy, 1).normalized;
                    data[y * n + x] = new Color(normal.x * .5f + .5f, normal.y * .5f + .5f, normal.z * .5f + .5f, 1);
                }
                normals.SetPixels(data); normals.Apply(false, true); Owned.Add(normals);
                secondary = new[] { new SecondarySpriteTexture { name = "_NormalMap", texture = normals } };
            }
            var sprite = Sprite.Create(texture, new Rect(0, 0, n, n), new Vector2(.5f, .5f), n, 0, SpriteMeshType.FullRect, Vector4.zero, false, secondary);
            sprite.name = key; Sprites.Add(key, sprite); Owned.Add(texture); Owned.Add(sprite);
            return sprite;
        }

        static float Noise(int x, int y) { unchecked { uint k = (uint)(x * 374761393 + y * 668265263); k = (k ^ (k >> 13)) * 1274126177; return (k & 65535) / 65535f; } }
        static float Segment(float x,float y,float ax,float ay,float bx,float by)
        {
            var p = new Vector2(x-ax,y-ay); var d = new Vector2(bx-ax,by-ay);
            return (p-d*Mathf.Clamp01(Vector2.Dot(p,d)/d.sqrMagnitude)).magnitude;
        }

        public static SpriteRenderer Create(Transform parent, string name, string sprite, int order, Color color, Vector2 size, Vector3 position, bool lit = true)
        {
            Initialize();
            var go = new GameObject(name); go.transform.SetParent(parent, false); go.transform.localPosition = position;
            go.transform.localScale = new Vector3(size.x, size.y, 1);
            var renderer = go.AddComponent<SpriteRenderer>(); renderer.sprite = Get(sprite);
            renderer.sharedMaterial = lit ? Lit : Unlit; renderer.sortingOrder = order; renderer.color = color;
            return renderer;
        }

        public static Light2D CreateLight(Transform parent, string name, Vector3 position)
        {
            var template = Resources.Load<GameObject>("Showcase/Torch");
            var go = template != null ? Object.Instantiate(template, parent) : new GameObject(name);
            go.name = name; go.transform.SetParent(parent, false); go.transform.localPosition = position;
            return go.GetComponent<Light2D>() ?? go.AddComponent<Light2D>();
        }
    }
}
