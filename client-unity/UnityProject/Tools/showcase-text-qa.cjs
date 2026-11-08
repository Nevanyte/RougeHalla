// Capture the real maximum-text UI for visual review; no simulation state is injected.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(os.homedir(), '.codex/tools/rougehalla-stage2/browser/node_modules/playwright'));
const out = process.env.RH_SHOWCASE_TEXT_OUT || path.join(os.homedir(), '.codex/tools/rougehalla-unity-art/evidence/text-final');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--use-angle=metal', '--window-size=2560,1440'] });
  const report = { status: 'INCOMPLETE', pageErrors: [], screenshots: [], visualReview: 'pending' };
  try {
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => report.pageErrors.push(String(error)));
    await page.goto('http://127.0.0.1:18897/?server=ws://127.0.0.1:18797/ws&profile=artui&faction=4&auto=1');
    await page.locator('#unity-loading-bar').waitFor({ state: 'hidden', timeout: 120000 });
    await page.waitForTimeout(8000);
    const box = await page.locator('#unity-canvas').boundingBox();
    const point = (x,y) => ({x:box.x+x*box.width,y:box.y+(1-y)*box.height});
    const click = async (x,y) => {const p=point(x,y);await page.mouse.click(p.x,p.y,{delay:60});await page.waitForTimeout(250);};
    const capture = async name => {const file=path.join(out,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);};
    await capture('text-default-hud');
    await click(.75,.96);
    await capture('text-default-settings');
    // Actual Text size slider, local Settings panel anchors (.22,.20)-(.78,.82).
    const slider = localX => point(.22+localX*.56,.20+.515*.62);
    const start=slider(.56), end=slider(.8);
    await page.mouse.move(start.x,start.y);await page.mouse.down();
    await page.mouse.move(end.x,end.y,{steps:8});await page.mouse.up();
    await page.waitForFunction(() => Math.abs((window.__rhShowcaseSettings?.textScale || 0)-1.5)<.005);
    report.settings = await page.evaluate(() => window.__rhShowcaseSettings);
    await capture('text-150-settings');
    await click(.75,.96);
    await page.waitForTimeout(300);
    await capture('text-150-hud');
    report.canvas = await page.evaluate(() => {
      const c=document.getElementById('unity-canvas'),g=c.getContext('webgl2');
      return {width:g.drawingBufferWidth,height:g.drawingBufferHeight};
    });
    report.status = report.pageErrors.length ? 'FAIL' : 'CAPTURED';
  } catch(error) {report.status='FAIL';report.error=String(error);}
  finally {await browser.close();}
  fs.writeFileSync(path.join(out,'text-qa.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  process.exitCode=report.status==='CAPTURED'?0:1;
})().catch(error=>{console.error(error);process.exitCode=1;});
