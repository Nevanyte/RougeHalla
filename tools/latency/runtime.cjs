'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');

function loadPlaywright(repoRoot, explicitModule = process.env.RH_PLAYWRIGHT_MODULE) {
  const fromRepo = createRequire(path.resolve(repoRoot, 'package.json'));
  try {
    // Normal Node resolution supports the repository install and NODE_PATH; an explicit override never falls back.
    return fromRepo(explicitModule || 'playwright');
  } catch (error) {
    throw new Error('Cannot load Playwright. Follow CONTRIBUTING.md: npm i --no-save playwright@1.63.0 && npx playwright install chromium; or set RH_PLAYWRIGHT_MODULE to your installed module.', { cause: error });
  }
}

async function finalizeRun({ browser, proxy, report, saveReport }) {
  const attempt = async (stage, action) => {
    try { await action(); }
    catch (error) { report.errors.push(`${stage}: ${String(error?.stack || error)}`); }
  };
  if (browser) await attempt('browser close', () => browser.close());
  if (proxy) {
    await attempt('proxy report', () => { report.proxyRun = proxy.report(); });
    await attempt('proxy close', () => proxy.close());
  }
  await saveReport();
}

module.exports = { loadPlaywright, finalizeRun };
