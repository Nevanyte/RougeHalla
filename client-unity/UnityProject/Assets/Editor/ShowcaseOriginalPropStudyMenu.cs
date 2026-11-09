using TMPro;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using Roguehalla.Client;

namespace Roguehalla.Editor
{
    /// <summary>Opt-in, no-network asset review. Nothing in this study defines a map or gameplay fact.</summary>
    [InitializeOnLoad]
    public static class ShowcaseOriginalPropStudyMenu
    {
        const string Pending = "Roguehalla.OriginalPropReview";
        static ShowcaseOriginalPropStudyMenu() { EditorApplication.playModeStateChanged += Entered; }

        [MenuItem("Roguehalla/Art/Play Original Prop Study")]
        public static void Play()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) return;
            SessionState.SetBool(Pending,true);
            SessionState.SetString("Roguehalla.ArtPreviewQuery","?preview=1");
            EditorApplication.isPlaying=true;
        }

        static void Entered(PlayModeStateChange state)
        {
            if(state!=PlayModeStateChange.EnteredPlayMode || !SessionState.GetBool(Pending,false))return;
            SessionState.EraseBool(Pending);
            foreach(string name in new[]{"Presentation study","Presentation study arena"})
            { var old=GameObject.Find(name);if(old!=null)Object.DestroyImmediate(old); }
            var camera=Camera.main;
            if(camera==null){Debug.LogError("Prop study requires the preview camera.");return;}
            camera.transform.SetPositionAndRotation(new Vector3(0,0,-30),Quaternion.identity);
            camera.orthographicSize=5.1f;
            camera.backgroundColor=new Color32(14,19,27,255);
            var root=new GameObject("Original prop asset review / no network");
            var light=new GameObject("Prop review ambient");light.transform.SetParent(root.transform,false);
            var global=light.AddComponent<Light2D>();global.lightType=Light2D.LightType.Global;global.intensity=.95f;
            Label(root.transform,"ORIGINAL GAP-PROP ART  /  UNITY RENDER  /  STAGED ONLY",0,4.65f,17,ShowcasePalette.Gold);
            int i=0;
            foreach(var key in ShowcaseOriginalPropArt.Keys)
            {
                ShowcaseOriginalPropArt.TryGetInfo(key,out var info);
                float x=(i%3-1)*4.7f,y=2.1f-(i/3)*2.8f;
                var ground=ShowcaseSprites.Create(root.transform,"Neutral review ground", "bar",-30,Color.white,
                    new Vector2(3.8f,1.2f),new Vector3(x,y+.1f),true);
                ground.sprite=ShowcaseBiomeArt.Floor(ShowcaseBiome.Neutral,i%3);
                var go=new GameObject(info.DisplayName);go.transform.SetParent(root.transform,false);
                go.transform.localPosition=new Vector3(x,y,-.01f);
                var art=go.AddComponent<SpriteRenderer>();art.sprite=ShowcaseOriginalPropArt.Get(key);
                art.sharedMaterial=ShowcaseSprites.Lit;art.sortingOrder=100;
                Label(root.transform,info.DisplayName.ToUpperInvariant(),x,y-.7f,4.4f,ShowcasePalette.Text);
                i++;
            }
            Label(root.transform,"Original procedural sprites · painted faces + ground contact · no live placements or collision",0,-4.65f,17,ShowcasePalette.MutedText);
        }

        static void Label(Transform parent,string value,float x,float y,float width,Color color)
        {
            var go=new GameObject("Review label");go.transform.SetParent(parent,false);go.transform.localPosition=new Vector3(x,y,-1);
            var text=go.AddComponent<TextMeshPro>();text.font=TMP_Settings.defaultFontAsset;text.text=value;
            text.fontSize=2.7f;text.color=color;text.alignment=TextAlignmentOptions.Center;text.enableWordWrapping=false;
            text.rectTransform.sizeDelta=new Vector2(width,.45f);text.GetComponent<MeshRenderer>().sortingOrder=200;
        }
    }
}
