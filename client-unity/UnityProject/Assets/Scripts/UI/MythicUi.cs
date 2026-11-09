using TMPro;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    public enum MythicGlyph { Sword, Shield, Axe, Bow, Wand, Potion, Wish, Health, Armor, Speed, Cards, Map }

    /// <summary>Reusable, asset-free controls for the mythic runtime interface.</summary>
    public static class MythicUi
    {
        public enum ButtonStyle { Primary, Secondary, Quiet }
        const float BackdropOpacity = 200f / 255f;

        // UI backing only: shared world-art colors and child text/icons keep their own opacity.
        public static Color Backdrop(Color color) { color.a = Mathf.Min(color.a, BackdropOpacity); return color; }

        public static void Border(Transform parent, Color color, float width = 1)
        {
            // Outline duplicates the filled quad beneath translucent panels. Edge-only geometry leaves the center clear.
            BorderEdge(parent, "FrameTop", new Vector2(0, 1), Vector2.one, new Vector2(0, -width), Vector2.zero, color);
            BorderEdge(parent, "FrameBottom", Vector2.zero, new Vector2(1, 0), Vector2.zero, new Vector2(0, width), color);
            BorderEdge(parent, "FrameLeft", Vector2.zero, new Vector2(0, 1), Vector2.zero, new Vector2(width, 0), color);
            BorderEdge(parent, "FrameRight", new Vector2(1, 0), Vector2.one, new Vector2(-width, 0), Vector2.zero, color);
        }
        static void BorderEdge(Transform parent, string name, Vector2 min, Vector2 max, Vector2 insetMin, Vector2 insetMax, Color color)
        {
            var edge = Rect(parent, name, min, max, insetMin, insetMax).gameObject.AddComponent<Image>();
            edge.color = color; edge.raycastTarget = false;
        }

        static TMP_FontAsset _font, _headingFont;
        static readonly Sprite[] GlyphSprites = new Sprite[12];

        public static RectTransform Rect(Transform parent, string name, Vector2 anchorMin, Vector2 anchorMax,
            Vector2? offsetMin = null, Vector2? offsetMax = null)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var rect = (RectTransform)go.transform;
            rect.anchorMin = anchorMin; rect.anchorMax = anchorMax;
            rect.offsetMin = offsetMin ?? Vector2.zero; rect.offsetMax = offsetMax ?? Vector2.zero;
            return rect;
        }

        public static RectTransform Panel(Transform parent, string name, Vector2 anchorMin, Vector2 anchorMax,
            Color? fill = null, bool raycast = true)
        {
            var rect = Rect(parent, name, anchorMin, anchorMax);
            var image = rect.gameObject.AddComponent<Image>();
            image.color = Backdrop(fill ?? ShowcasePalette.Panel);
            image.raycastTarget = raycast;
            return rect;
        }

        public static TMP_Text Text(Transform parent, string name, string value, Vector2 anchorMin, Vector2 anchorMax,
            float fontSize, Color? color = null, TextAlignmentOptions alignment = TextAlignmentOptions.MidlineLeft, bool heading = false)
        {
            var rect = Rect(parent, name, anchorMin, anchorMax, new Vector2(6, 3), new Vector2(-6, -3));
            var text = rect.gameObject.AddComponent<TextMeshProUGUI>();
            text.font = heading ? HeadingFont : Font;
            text.text = value ?? "";
            text.fontSize = fontSize; text.fontSizeMin = Mathf.Max(9, fontSize * .72f); text.fontSizeMax = fontSize;
            text.enableAutoSizing = true; text.color = color ?? ShowcasePalette.Text;
            text.alignment = alignment; text.enableWordWrapping = true;
            text.raycastTarget = false;
            var scale = text.gameObject.AddComponent<MythicTextScale>(); scale.BaseSize = fontSize * 1.5f;
            scale.Apply(ShowcaseSettings.Current != null ? ShowcaseSettings.Current.TextScale : 1f);
            return text;
        }

        public static void ApplyTextScale(Transform root, float scale)
        {
            foreach (var style in root.GetComponentsInChildren<MythicTextScale>(true)) style.Apply(scale);
        }

        public static TMP_Text ScrollText(Transform parent, string name, string value, Vector2 min, Vector2 max, float size)
        {
            var frame = Rect(parent, name, min, max);
            var scroll = frame.gameObject.AddComponent<UnityEngine.UI.ScrollRect>();
            scroll.horizontal = false; scroll.movementType = ScrollRect.MovementType.Clamped; scroll.scrollSensitivity = 36;
            var viewport = Rect(frame, "Viewport", Vector2.zero, Vector2.one);
            var image = viewport.gameObject.AddComponent<UnityEngine.UI.Image>(); image.color = Color.clear; image.raycastTarget = true;
            viewport.gameObject.AddComponent<UnityEngine.UI.RectMask2D>();
            var label = Text(viewport, "Content", value, new Vector2(0, 1), Vector2.one, size);
            label.rectTransform.pivot = new Vector2(.5f, 1); label.enableAutoSizing = false;
            label.gameObject.AddComponent<UnityEngine.UI.ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.viewport = viewport; scroll.content = label.rectTransform;
            return label;
        }

        public static Button Button(Transform parent, string name, string label, Vector2 anchorMin, Vector2 anchorMax,
            UnityAction onClick, ButtonStyle style = ButtonStyle.Secondary, float fontSize = 16)
        {
            var rect = Rect(parent, name, anchorMin, anchorMax);
            var image = rect.gameObject.AddComponent<Image>();
            image.color = style == ButtonStyle.Primary ? ShowcasePalette.GoldDim :
                style == ButtonStyle.Quiet ? ShowcasePalette.Panel : ShowcasePalette.PanelRaised;
            image.raycastTarget = true;
            var button = rect.gameObject.AddComponent<Button>(); button.targetGraphic = image;
            var minimum = rect.gameObject.AddComponent<LayoutElement>(); minimum.minWidth = 44; minimum.minHeight = 44;
            if (Mathf.Approximately(anchorMin.x, anchorMax.x) && Mathf.Approximately(rect.sizeDelta.x, 0)) rect.SetSizeWithCurrentAnchors(RectTransform.Axis.Horizontal, 44);
            if (Mathf.Approximately(anchorMin.y, anchorMax.y) && Mathf.Approximately(rect.sizeDelta.y, 0)) rect.SetSizeWithCurrentAnchors(RectTransform.Axis.Vertical, 44);
            Border(rect, ShowcasePalette.GoldDim, 2);
            image.color = Backdrop(Color.white);
            var colors = button.colors;
            colors.normalColor = ShowcasePalette.PanelRaised;
            colors.highlightedColor = ShowcasePalette.PanelStroke;
            colors.pressedColor = new Color32(96, 69, 31, 255);
            colors.selectedColor = ShowcasePalette.PanelStroke;
            colors.disabledColor = new Color32(37, 43, 51, 255); colors.fadeDuration = .08f;
            button.colors = colors;
            button.onClick.AddListener(onClick);
            Text(rect, "Label", label, Vector2.zero, Vector2.one, fontSize,
                ShowcasePalette.Text,
                TextAlignmentOptions.Center);
            return button;
        }

        public static ScrollRect ScrollView(Transform parent, string name, Vector2 anchorMin, Vector2 anchorMax,
            out RectTransform content)
        {
            var root = Rect(parent, name, anchorMin, anchorMax);
            var scroll = root.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false; scroll.vertical = true; scroll.movementType = ScrollRect.MovementType.Clamped;
            var viewport = Rect(root, "Viewport", Vector2.zero, Vector2.one);
            var maskImage = viewport.gameObject.AddComponent<Image>(); maskImage.color = Color.white; maskImage.raycastTarget = true;
            viewport.gameObject.AddComponent<Mask>().showMaskGraphic = false;
            content = Rect(viewport, "Content", new Vector2(0, 1), new Vector2(1, 1), Vector2.zero, Vector2.zero);
            var grid = content.gameObject.AddComponent<GridLayoutGroup>();
            grid.startCorner = GridLayoutGroup.Corner.UpperLeft;
            grid.startAxis = GridLayoutGroup.Axis.Horizontal;
            grid.childAlignment = TextAnchor.UpperCenter;
            grid.constraint = GridLayoutGroup.Constraint.FixedColumnCount; grid.constraintCount = 2;
            grid.cellSize = new Vector2(208, 164); grid.spacing = new Vector2(12, 12);
            grid.padding = new RectOffset(8, 8, 8, 8);
            content.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.viewport = viewport; scroll.content = content; scroll.inertia = true; scroll.scrollSensitivity = 36;
            return scroll;
        }

        public static Image Icon(Transform parent, string name, MythicGlyph glyph, Vector2 anchorMin, Vector2 anchorMax)
        {
            var rect = Rect(parent, name, anchorMin, anchorMax);
            var image = rect.gameObject.AddComponent<Image>();
            image.sprite = GlyphSprite(glyph); image.color = ShowcasePalette.Gold;
            image.preserveAspect = true; image.raycastTarget = false;
            return image;
        }

        public static Image Icon(Transform parent, string name, MythicGlyph glyph, float size)
        {
            var rect = Rect(parent, name, new Vector2(.5f, .5f), new Vector2(.5f, .5f));
            rect.sizeDelta = new Vector2(size, size);
            var image = rect.gameObject.AddComponent<Image>();
            image.sprite = GlyphSprite(glyph); image.color = ShowcasePalette.Gold;
            image.preserveAspect = true; image.raycastTarget = false;
            return image;
        }

        static TMP_FontAsset Font
        {
            get
            {
                if (_font == null) _font = Resources.Load<TMP_FontAsset>("Fonts & Materials/LiberationSans SDF") ?? TMP_Settings.defaultFontAsset;
                return _font;
            }
        }

        static TMP_FontAsset HeadingFont
        {
            get
            {
                if (_headingFont == null) _headingFont = Resources.Load<TMP_FontAsset>("Showcase/CinzelDecorative") ?? Font;
                return _headingFont;
            }
        }

        public static Sprite GlyphSprite(MythicGlyph glyph)
        {
            int index = Mathf.Clamp((int)glyph, 0, GlyphSprites.Length - 1);
            if (GlyphSprites[index] != null) return GlyphSprites[index];
            const int size = 48;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false) { filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
            var pixels = new Color32[size * size];
            for (int i = 0; i < pixels.Length; i++) pixels[i] = new Color32(255, 255, 255, 0);
            DrawGlyph(pixels, size, glyph);
            texture.SetPixels32(pixels); texture.Apply(false, true);
            GlyphSprites[index] = Sprite.Create(texture, new Rect(0, 0, size, size), new Vector2(.5f, .5f), size, 0, SpriteMeshType.FullRect);
            GlyphSprites[index].name = "Mythic " + glyph;
            return GlyphSprites[index];
        }

        static void DrawGlyph(Color32[] pixels, int size, MythicGlyph glyph)
        {
            Color32 ink = ShowcasePalette.Gold;
            switch (glyph)
            {
                case MythicGlyph.Sword: Line(pixels,size,13,8,35,38,ink,4); Line(pixels,size,12,8,18,12,ink,4); Line(pixels,size,16,15,25,7,ink,4); break;
                case MythicGlyph.Shield: Poly(pixels,size,new[]{new Vector2(24,42),new Vector2(38,35),new Vector2(36,18),new Vector2(24,7),new Vector2(12,18),new Vector2(10,35)},ink); Line(pixels,size,24,38,24,12,ShowcasePalette.Background,2); break;
                case MythicGlyph.Axe: Line(pixels,size,16,8,31,39,ink,4); Poly(pixels,size,new[]{new Vector2(27,32),new Vector2(35,40),new Vector2(41,31),new Vector2(37,20),new Vector2(27,21)},ink); break;
                case MythicGlyph.Bow: Line(pixels,size,31,7,31,41,ink,3); Line(pixels,size,31,7,14,24,ink,2); Line(pixels,size,14,24,31,41,ink,2); Line(pixels,size,10,24,39,24,ink,2); break;
                case MythicGlyph.Wand: Line(pixels,size,14,9,30,30,ink,4); Circle(pixels,size,34,35,7,ink); Circle(pixels,size,34,35,3,ShowcasePalette.Panel); break;
                case MythicGlyph.Potion: Poly(pixels,size,new[]{new Vector2(19,39),new Vector2(29,39),new Vector2(29,33),new Vector2(36,25),new Vector2(33,11),new Vector2(15,11),new Vector2(12,25),new Vector2(19,33)},ink); Line(pixels,size,17,26,31,26,ShowcasePalette.Panel,3); break;
                case MythicGlyph.Wish: Star(pixels,size,24,24,19,7,5,ink); break;
                case MythicGlyph.Health: Circle(pixels,size,24,24,17,ink); Line(pixels,size,24,14,24,34,ShowcasePalette.Panel,4); Line(pixels,size,14,24,34,24,ShowcasePalette.Panel,4); break;
                case MythicGlyph.Armor: Poly(pixels,size,new[]{new Vector2(9,36),new Vector2(14,13),new Vector2(24,8),new Vector2(34,13),new Vector2(39,36),new Vector2(30,40),new Vector2(24,32),new Vector2(18,40)},ink); break;
                case MythicGlyph.Speed: Poly(pixels,size,new[]{new Vector2(7,27),new Vector2(24,42),new Vector2(41,27),new Vector2(34,27),new Vector2(24,36),new Vector2(14,27)},ink); Line(pixels,size,10,19,29,19,ink,3); Line(pixels,size,15,12,34,12,ink,3); break;
                case MythicGlyph.Cards: Poly(pixels,size,new[]{new Vector2(10,10),new Vector2(33,10),new Vector2(33,37),new Vector2(10,37)},ink); Line(pixels,size,16,17,27,17,ShowcasePalette.Panel,2); Line(pixels,size,16,24,27,24,ShowcasePalette.Panel,2); Line(pixels,size,16,31,24,31,ShowcasePalette.Panel,2); Line(pixels,size,18,7,39,7,ink,3); break;
                default: Circle(pixels,size,24,24,18,ink); Circle(pixels,size,24,24,12,ShowcasePalette.Panel); Line(pixels,size,8,24,40,24,ink,2); Line(pixels,size,24,8,24,40,ink,2); Circle(pixels,size,24,24,4,ink); break;
            }
        }

        static void Pixel(Color32[] p,int s,int x,int y,Color32 c)
        { if(x>=0&&x<s&&y>=0&&y<s) p[y*s+x]=c; }
        static void Line(Color32[] p,int s,int x0,int y0,int x1,int y1,Color32 c,int width)
        {
            int dx=Mathf.Abs(x1-x0),sx=x0<x1?1:-1,dy=-Mathf.Abs(y1-y0),sy=y0<y1?1:-1,err=dx+dy;
            while(true){ for(int ox=-width/2;ox<=width/2;ox++) for(int oy=-width/2;oy<=width/2;oy++) Pixel(p,s,x0+ox,y0+oy,c); if(x0==x1&&y0==y1)break; int e2=2*err; if(e2>=dy){err+=dy;x0+=sx;} if(e2<=dx){err+=dx;y0+=sy;} }
        }
        static void Circle(Color32[] p,int s,int cx,int cy,int r,Color32 c)
        { int x=r,y=0,e=1-r; while(x>=y){for(int i=-1;i<=1;i+=2){Pixel(p,s,cx+x,cy+i*y,c);Pixel(p,s,cx+y,cy+i*x,c);Pixel(p,s,cx-x,cy+i*y,c);Pixel(p,s,cx-y,cy+i*x,c);} y++; if(e<0)e+=2*y+1; else{x--;e+=2*(y-x)+1;} } }
        static void Poly(Color32[] p,int s,Vector2[] pts,Color32 c)
        { for(int i=0;i<pts.Length;i++){var a=pts[i];var b=pts[(i+1)%pts.Length];Line(p,s,(int)a.x,(int)a.y,(int)b.x,(int)b.y,c,3);} }
        static void Star(Color32[] p,int s,int cx,int cy,int outer,int inner,int points,Color32 c)
        { Vector2 prev=Vector2.zero; for(int i=0;i<points*2;i++){float a=-Mathf.PI/2+i*Mathf.PI/points;float r=(i%2==0)?outer:inner;var v=new Vector2(cx+Mathf.Cos(a)*r,cy+Mathf.Sin(a)*r);if(i>0)Line(p,s,(int)prev.x,(int)prev.y,(int)v.x,(int)v.y,c,2);prev=v;} Line(p,s,(int)prev.x,(int)prev.y,(int)(cx+0),(int)(cy-outer),c,2); }
    }

}
