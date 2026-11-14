// Pure command logic of the Web driver (Tools/web-drive.cjs), split out so the gate tests it without a browser.
// STUB (P-UNITY-WEB-DRIVE-2): the implementer replaces this body. Contract: docs/backlog/packets/P-UNITY-WEB-DRIVE-2.md.
'use strict';

/**
 * Handles `eval`, `anchors`, `where` and `goto {x,y}`. Returns the driver's answer string, or null when the command is not one of
 * these (including `goto` with a `url`, which the driver itself handles as navigation).
 * @param {object} c the parsed command; @param {object} page needs evaluate(string) and keyboard.down/up/press;
 * @param {{sleep:(ms:number)=>Promise<void>, now:()=>number}} env
 */
async function run(c, page, env) {
  void c; void page; void env;
  return 'ERR not implemented';
}

module.exports = { run };
