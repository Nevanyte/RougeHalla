// Authored Flare artwork is composed with its original frame anchors, not guessed atlas cells.
// Derived artwork retains CC BY-SA 3.0; see Assets/Art/ThirdParty/Flare/Raw/LICENSE.txt.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;
using Roguehalla.Client;

namespace Roguehalla.Editor
{
    public static class FlareCatalogImporter
    {
        const string Source = "Assets/Art/ThirdParty/Flare/Raw/";
        const string Output = "Assets/Art/Derived/Flare/";
        const int Cell = 224, Cols = 16, PixelsPerUnit = 128;
        sealed class Frame { public int Index, Direction, X,Y,W,H,Px,Py; }
        sealed class Layer { public Texture2D Texture; public Color32[] Pixels; public Dictionary<string,List<Frame>> Clips = new Dictionary<string,List<Frame>>(); }
        [MenuItem("Roguehalla/Art/Import Flare Catalog")]
        public static void Import()
        {
            Directory.CreateDirectory(Output); Directory.CreateDirectory("Assets/Resources/Showcase");
            var appearances = new List<ShowcaseCatalog.Appearance>();
            foreach(string name in new[]{"knight","goblin","skeleton"})
            {
                string type = name == "knight" ? "npcs" : "enemies";
                appearances.Add(Compose(name, new[]{ Read("animations/"+type+"/"+name+".txt") }));
            }
            foreach(string gender in new[]{"male","female"})
            {
                string head = gender == "male" ? "head_short" : "head_long";
                var layers = new[]{"plate_boots","plate_greaves","plate_cuirass","plate_gauntlets",head,"plate_helm"}
                    .Select(part=>Read("animations/avatar/"+gender+"/"+part+".txt")).ToArray();
                appearances.Add(Compose(gender == "male" ? "hero" : "hero-female", layers));
            }
            var catalog = AssetDatabase.LoadAssetAtPath<ShowcaseCatalog>("Assets/Resources/Showcase/Catalog.asset");
            if(catalog == null) { catalog = ScriptableObject.CreateInstance<ShowcaseCatalog>(); AssetDatabase.CreateAsset(catalog,"Assets/Resources/Showcase/Catalog.asset"); }
            catalog.Actors = appearances.ToArray(); ImportProps(catalog); EditorUtility.SetDirty(catalog); AssetDatabase.SaveAssets();
            Debug.Log("Imported five authored Flare appearances with exact eight-direction anchors");
        }
        static void ImportProps(ShowcaseCatalog catalog)
        {
            string sourcePath = Source+"images/tilesets/tileset_dungeon.png";
            var sourceImporter=(TextureImporter)AssetImporter.GetAtPath(sourcePath);
            sourceImporter.isReadable=true; sourceImporter.npotScale=TextureImporterNPOTScale.None; sourceImporter.maxTextureSize=8192;
            sourceImporter.textureCompression=TextureImporterCompression.Uncompressed; sourceImporter.SaveAndReimport();
            var source=AssetDatabase.LoadAssetAtPath<Texture2D>(sourcePath); var input=source.GetPixels32();
            var atlas=new Texture2D(Cell*3,Cell,TextureFormat.RGBA32,false); var output=new Color32[atlas.width*atlas.height];
            int[] ids={145,162,130}; string[] names={"chest","barrel","statue"};
            for(int i=0;i<ids.Length;i++)
            {
                string row=File.ReadLines(Source+"tilesetdefs/tileset_dungeon.txt").First(l=>l.StartsWith("tile="+ids[i]+","));
                int[] f=row.Substring(5).Split(',').Select(int.Parse).ToArray();
                for(int y=0;y<f[4];y++) for(int x=0;x<f[3];x++)
                {
                    int dx=i*Cell+Cell/2+x-f[5],dy=32+y-f[4]+f[6];
                    if(dx<i*Cell||dx>=(i+1)*Cell||dy<0||dy>=Cell) continue;
                    output[dy*atlas.width+dx]=input[(source.height-f[2]-f[4]+y)*source.width+f[1]+x];
                }
            }
            atlas.SetPixels32(output);atlas.Apply();string path=Output+"props.png";File.WriteAllBytes(path,atlas.EncodeToPNG());UnityEngine.Object.DestroyImmediate(atlas);
            AssetDatabase.ImportAsset(path,ImportAssetOptions.ForceSynchronousImport);
            var importer=(TextureImporter)AssetImporter.GetAtPath(path); importer.textureType=TextureImporterType.Sprite;importer.spriteImportMode=SpriteImportMode.Multiple;
            importer.spritePixelsPerUnit=PixelsPerUnit;importer.alphaIsTransparency=true;importer.mipmapEnabled=false;importer.npotScale=TextureImporterNPOTScale.None;
            importer.spritesheet=names.Select((name,i)=>new SpriteMetaData{name=name,rect=new Rect(i*Cell,0,Cell,Cell),alignment=(int)SpriteAlignment.Custom,pivot=new Vector2(.5f,32f/Cell)}).ToArray();
            importer.SaveAndReimport();var sprites=AssetDatabase.LoadAllAssetsAtPath(path).OfType<Sprite>().ToDictionary(s=>s.name);
            catalog.Chest=sprites["chest"];catalog.Barrel=sprites["barrel"];catalog.Statue=sprites["statue"];
        }
        static Layer Read(string definition)
        {
            var layer = new Layer(); string clip = null, image = null;
            foreach(var raw in File.ReadAllLines(Source+definition))
            {
                string line = raw.Trim(); if(line.Length==0 || line.StartsWith("#")) continue;
                if(line.StartsWith("image=")) image = line.Substring(6);
                if(line.StartsWith("[")) { clip = line.Trim('[',']'); if(!layer.Clips.ContainsKey(clip)) layer.Clips.Add(clip,new List<Frame>()); }
                if(line.StartsWith("frame=") && clip != null)
                {
                    int[] f = line.Substring(6).Split(',').Select(int.Parse).ToArray();
                    if(f.Length != 8) throw new InvalidDataException(definition+": invalid frame");
                    layer.Clips[clip].Add(new Frame{Index=f[0],Direction=f[1],X=f[2],Y=f[3],W=f[4],H=f[5],Px=f[6],Py=f[7]});
                }
            }
            var path = Source+image;
            var importer = (TextureImporter)AssetImporter.GetAtPath(path);
            importer.isReadable = true; importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.maxTextureSize = 8192; importer.mipmapEnabled = false; importer.SaveAndReimport();
            layer.Texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path); layer.Pixels = layer.Texture.GetPixels32();
            return layer;
        }
        static ShowcaseCatalog.Appearance Compose(string key, Layer[] layers)
        {
            var clips = new[]{"stance","run","swing"};
            var slots = new List<Tuple<string,int,int>>();
            foreach(string clip in clips)
            {
                int count = layers[0].Clips.TryGetValue(clip,out var f) ? f.Max(v=>v.Index)+1 : 0;
                for(int d=0;d<8;d++) for(int i=0;i<count;i++) slots.Add(Tuple.Create(clip,d,i));
            }
            int rows = (slots.Count+Cols-1)/Cols;
            var atlas = new Texture2D(Cell*Cols,Cell*rows,TextureFormat.RGBA32,false);
            var pixels = new Color32[atlas.width*atlas.height];
            for(int slot=0;slot<slots.Count;slot++)
            {
                var item = slots[slot];
                foreach(var layer in layers)
                {
                    if(!layer.Clips.TryGetValue(item.Item1,out var frames)) continue;
                    var f = frames.Find(v=>v.Direction==item.Item2 && v.Index==item.Item3); if(f==null) continue;
                    for(int y=0;y<f.H;y++) for(int x=0;x<f.W;x++)
                    {
                        var src = layer.Pixels[(layer.Texture.height-f.Y-f.H+y)*layer.Texture.width+f.X+x]; if(src.a==0) continue;
                        int dx=slot%Cols*Cell+Cell/2+x-f.Px, dy=slot/Cols*Cell+32+y-f.H+f.Py;
                        if(dx<slot%Cols*Cell || dx>=(slot%Cols+1)*Cell || dy<slot/Cols*Cell || dy>=(slot/Cols+1)*Cell) continue;
                        int at=dy*atlas.width+dx; var dst=pixels[at]; float a=src.a/255f, da=dst.a/255f, oa=a+da*(1-a);
                        pixels[at]=new Color32((byte)((src.r*a+dst.r*da*(1-a))/oa),(byte)((src.g*a+dst.g*da*(1-a))/oa),(byte)((src.b*a+dst.b*da*(1-a))/oa),(byte)(oa*255));
                    }
                }
            }
            atlas.SetPixels32(pixels); atlas.Apply(); string path=Output+key+".png"; File.WriteAllBytes(path,atlas.EncodeToPNG()); UnityEngine.Object.DestroyImmediate(atlas);
            AssetDatabase.ImportAsset(path,ImportAssetOptions.ForceSynchronousImport);
            var importer=(TextureImporter)AssetImporter.GetAtPath(path); importer.textureType=TextureImporterType.Sprite;
            importer.spriteImportMode=SpriteImportMode.Multiple; importer.spritePixelsPerUnit=PixelsPerUnit;
            importer.alphaIsTransparency=true; importer.mipmapEnabled=false; importer.filterMode=FilterMode.Bilinear;
            importer.maxTextureSize=4096; importer.textureCompression=TextureImporterCompression.CompressedHQ;
            importer.spritesheet=slots.Select((item,index)=>new SpriteMetaData{name=item.Item1+"_"+item.Item2+"_"+item.Item3,
                rect=new Rect(index%Cols*Cell,index/Cols*Cell,Cell,Cell), alignment=(int)SpriteAlignment.Custom,pivot=new Vector2(.5f,32f/Cell)}).ToArray();
            importer.SaveAndReimport();
            var sprites=AssetDatabase.LoadAllAssetsAtPath(path).OfType<Sprite>().ToDictionary(v=>v.name);
            Func<string,Sprite[]> get = clip=>slots.Where(v=>v.Item1==clip).Select(v=>sprites[v.Item1+"_"+v.Item2+"_"+v.Item3]).ToArray();
            return new ShowcaseCatalog.Appearance{Key=key,Idle=get("stance"),Walk=get("run"),Attack=get("swing"),FramesPerSecond=10,WorldHeight=1.15f,GroundPivot=new Vector2(.5f,32f/Cell)};
        }
    }
}
