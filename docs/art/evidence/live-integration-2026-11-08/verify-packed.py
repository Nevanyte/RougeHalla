from pathlib import Path
from PIL import Image
import hashlib,json,math
root=Path('/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject')
r=json.loads((root/'Assets/Art/Derived/ShowcaseLive/receipt.json').read_text())
frames=0;changed=0;dropped=0;maxpivot=0
for a in r['appearances']:
    packed=Image.open(root/a['atlasPath']).convert('RGBA')
    assert hashlib.sha256((root/a['atlasPath']).read_bytes()).hexdigest()==a['atlasSha256']
    cached={}
    for f in a['frames']:
        p=f['sourcePath']
        if p not in cached: cached[p]=Image.open(root/p).convert('RGBA')
        im=cached[p];x,y,w,h=f['sourceRect'];tx,ty=f['trimOffset'];tw,th=f['trimSize'];ax,ay,aw,ah=f['atlasRect']
        assert (aw,ah)==(tw,th)
        original=im.crop((x,im.height-y-h,x+w,im.height-y))
        trim=original.crop((tx,h-ty-th,tx+tw,h-ty))
        dest=packed.crop((ax,packed.height-ay-ah,ax+aw,packed.height-ay))
        if trim.tobytes()!=dest.tobytes():changed+=1
        before=sum(v!=0 for v in original.getchannel('A').getdata());after=sum(v!=0 for v in trim.getchannel('A').getdata())
        dropped+=before-after
        np=f['newPivotNormalized'];sp=f['sourcePivotPixels']
        maxpivot=max(maxpivot,abs(np[0]*tw+tx-sp[0]),abs(np[1]*th+ty-sp[1]))
        frames+=1
    cached.clear()
assert changed==dropped==0
source=sum(a['sourceUniqueTextureRgbaArea'] for a in r['appearances']);packed=sum(a['packedAtlasArea'] for a in r['appearances'])
full=json.loads((root/'Assets/Art/Derived/FlareFullBase/receipt.json').read_text())
recovered=sum(a['oldCellClippedUniqueSites'] for a in full['appearances'])
report={'frames':frames,'changedPackedFrames':changed,'droppedOpaqueInputPixels':dropped,'maxPivotErrorPixels':maxpivot,'sourceTexturePixels':source,'packedTexturePixels':packed,'areaReductionPercent':100*(1-packed/source),'restoredUniqueSourceSitesAcrossFrames':recovered,'fullRawImporterRequiredClearancePixels':full['clearance'],'scope':'Independent raw PNG to packed PNG comparison; no claim of GPU memory, draw-call or FPS measurement.'}
out=Path('/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/live-integration-2026-11-08/evidence/full-packed-pixel-comparison.json');out.write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
