// A remote control for one persistent headed Chromium, for Web rounds (docs/unity/WEB_ROUND.md).
//   RH_PLAYWRIGHT_MODULE=<dir of the playwright node module> node client-unity/UnityProject/Tools/web-drive.cjs 1920 1080 &
// Then POST JSON {"cmd": ...} to http://127.0.0.1:9777 (port: RH_DRIVE_PORT). Commands:
//   goto {url}  move {x,y,steps}  click {x,y,button}  down {key}  up {key}  press {key}  wait {ms}  shot {path}  errs  quit
//   Landmarks (page opened with scenario.probe=1; logic in web-drive-lib.cjs): eval {js}  anchors  where  goto {x,y,within,timeoutMs}
//   (goto with x and y walks the player; with url it navigates). RH_DRIVE_HEADLESS=1 launches Chromium headless.
// Playwright comes from RH_PLAYWRIGHT_MODULE, else the `playwright` package resolvable from here (as smoke-web.cjs does).
'use strict';
const http = require('http');
const lib = require('./web-drive-lib.cjs');
const pwPath = process.env.RH_PLAYWRIGHT_MODULE;
const { chromium } = require(pwPath || 'playwright');
const W = +process.argv[2] || 1920, H = +process.argv[3] || 1080;
const PORT = +process.env.RH_DRIVE_PORT || 9777;

(async () => {
  const browser = await chromium.launch({ headless: process.env.RH_DRIVE_HEADLESS === '1', args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message.slice(0, 200)));
  http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', async () => {
      let r = 'ok';
      try {
        const c = JSON.parse(b || '{}');
        const mine = await lib.run(c, page, { sleep: (ms) => page.waitForTimeout(ms), now: Date.now });
        if (mine !== null) { res.end(mine); return; }
        switch (c.cmd) {
          case 'goto': await page.goto(c.url, { waitUntil: 'load' }); break;
          case 'move': await page.mouse.move(c.x, c.y, { steps: c.steps || 1 }); break;
          case 'click': await page.mouse.click(c.x, c.y, { button: c.button || 'left', delay: 40 }); break;
          case 'down': await page.keyboard.down(c.key); break;
          case 'up': await page.keyboard.up(c.key); break;
          case 'press': await page.keyboard.press(c.key); break;
          case 'wait': await page.waitForTimeout(c.ms); break;
          case 'shot': await page.screenshot({ path: c.path }); break;
          case 'errs': r = JSON.stringify(errs); break;
          case 'quit': await browser.close(); r = 'bye'; setTimeout(() => process.exit(0), 100); break;
          default: r = 'ERR unknown command ' + c.cmd;
        }
      } catch (e) { r = 'ERR ' + e.message; }
      res.end(r);
    });
  }).listen(PORT, '127.0.0.1');
})();
