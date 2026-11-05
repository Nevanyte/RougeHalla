// Local skeleton smoke only: admission/map/snapshots and acknowledged movement.
// Serve Build/Web and run rh-server first; optional self-signed TLS is opt-in.
const { chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const out = process.env.RH_UNITY_SMOKE_OUTPUT || path.join(root,'docs/evidence/stage2-unity');
fs.mkdirSync(out,{recursive:true});
const url = process.env.RH_UNITY_SMOKE_URL || 'http://127.0.0.1:8087/?server=ws%3A%2F%2F127.0.0.1%3A7787%2Fws&profile=unitySmoke&token=smoke-local';
const displayedUrl = new URL(url);
if (displayedUrl.searchParams.has('token')) displayedUrl.searchParams.set('token', '[redacted]');
const label = new URL(url).protocol === 'https:' ? 'chromium-https-smoke' : 'chromium-http-smoke';
const html=fs.readFileSync(path.join(root,'crates/rh-server/web/probe.html'),'utf8');
const decoder=html.slice(html.search(/\/\/ ---- protocol v\d+/),html.indexOf('// ---- probe state'));
const {Tracker,decode}=new Function(decoder+';return {Tracker,decode}')();
(async()=>{
 const browser=await chromium.launch();
 const page=await browser.newPage({ignoreHTTPSErrors:process.env.RH_UNITY_SMOKE_ALLOW_SELF_SIGNED === "1",viewport:{width:1280,height:900}});
 const report={timestamp:new Date().toISOString(),browser:await browser.version(),url:displayedUrl.toString(),selfSignedCertificateAccepted:process.env.RH_UNITY_SMOKE_ALLOW_SELF_SIGNED === '1',checks:{},console:[],pageErrors:[],frames:{sent:0,received:0,snapshots:0},timeToAuthoritativeSelfSnapshotMs:null};
 const tracker=new Tracker(); let latest=null,welcome=null;
 page.on('console',m=>report.console.push({type:m.type(),text:m.text()}));
 page.on('pageerror',e=>report.pageErrors.push(String(e)));
 page.on('websocket',ws=>{
  ws.on('framesent',f=>{report.frames.sent++});
  ws.on('framereceived',f=>{report.frames.received++;try {const m=decode(Uint8Array.from(f.payload).buffer);if(m.t==='welcome')welcome={player:m.player,protocol:m.protocol,map:{width:m.map.w,height:m.map.h,hash:m.map.hash}};const s=tracker.apply(m);if(s?.t==='snapshot'){latest=s;report.frames.snapshots++}}catch(e){report.pageErrors.push('wire observer: '+String(e))}})
 });
 const start=Date.now();
 try {
  await page.goto(url);
  for(let i=0;i<1200&&!latest?.me;i++) await page.waitForTimeout(100);
  report.timeToAuthoritativeSelfSnapshotMs=Date.now()-start;
  report.checks.welcome=welcome; report.checks.snapshot=latest?{tick:latest.tick,phase:latest.phase,me:latest.me,actors:latest.actors.length}:null;
  if(!latest?.me)throw Error('No authoritative self snapshot');
  const before={x:latest.me.x,y:latest.me.y,seq:latest.me.moveSeq};
  await page.locator('#unity-canvas').click();
  await page.keyboard.down('d');await page.waitForTimeout(1500);await page.keyboard.up('d');await page.waitForTimeout(1000);
  const after={x:latest.me.x,y:latest.me.y,seq:latest.me.moveSeq};
  report.checks.move={before,after,acknowledged:after.seq!==before.seq,positionChanged:after.x!==before.x||after.y!==before.y};
  report.checks.canvas=await page.locator('#unity-canvas').evaluate(c=>({width:c.width,height:c.height}));
  await page.screenshot({path:path.join(out,label+'.png')});
 }catch(e){report.failure=String(e)}
 fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(report,null,2)+'\n');
 await browser.close();console.log(JSON.stringify({checks:report.checks,frames:report.frames,errors:report.pageErrors,failure:report.failure,timeToAuthoritativeSelfSnapshotMs:report.timeToAuthoritativeSelfSnapshotMs}));
 process.exitCode=report.failure||report.pageErrors.length||!report.checks.move?.acknowledged||!report.checks.move?.positionChanged?1:0;
})();
