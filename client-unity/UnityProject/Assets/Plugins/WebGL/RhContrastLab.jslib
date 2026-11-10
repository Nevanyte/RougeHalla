// Contrast lab page hook (?contrastlab=1 only). window.__rhContrastLab is what Tools/contrast-gate.cjs drives:
//   ready      true once the frozen frame of the current zone/page/mode has been rendered for a few frames
//   state      the last state Unity published (zone, page, pageCount, mode, quality, screenW/H, notes, cells[])
//   cells      the stamped cells of the current page, each with its screen rectangle in CSS px (rect) and backbuffer px (x,y,w,h)
//   zones / zonePageCounts / totalPages
//   setZone(name, page), setPage(n), setMode('normal' | 'no-actors' | 'mask')   each clears ready until Unity answers
mergeInto(LibraryManager.library, {
  RhContrastLab_Init: function () {
    if (window.__rhContrastLab) return;
    var L = window.__rhContrastLab = { version: 1, ready: false, state: null, cells: [], zones: [], zonePageCounts: [], pageCount: 0, totalPages: 0, cmdSeq: 0, zone: null, page: 0, mode: 'normal' };
    function send(zone, page, mode) {
      L.cmdSeq++; L.ready = false; L.zone = zone; L.page = page; L.mode = mode;
      window.unityInstance.SendMessage('ContrastLab', 'JsCommand', JSON.stringify({ zone: zone, page: page, mode: mode, seq: L.cmdSeq }));
    }
    L.setZone = function (name, page) { send(name, page | 0, 'normal'); };
    L.setPage = function (n) { send(L.zone, n | 0, 'normal'); };
    L.setMode = function (m) { send(L.zone, L.page, m); };
  },
  RhContrastLab_Publish: function (json) {
    var L = window.__rhContrastLab; if (!L) return;
    var s; try { s = JSON.parse(UTF8ToString(json)); } catch (e) { return; }
    var canvas = document.querySelector('#unity-canvas') || document.querySelector('canvas');
    var cssW = canvas ? canvas.clientWidth : window.innerWidth, k = s.screenW > 0 ? cssW / s.screenW : 1;
    for (var i = 0; i < s.cells.length; i++) {
      var c = s.cells[i];
      c.rect = { x: c.x * k, y: c.y * k, w: c.w * k, h: c.h * k };
    }
    L.state = s; L.cells = s.cells; L.zones = s.zones; L.zonePageCounts = s.zonePageCounts; L.pageCount = s.pageCount; L.totalPages = s.totalPages;
    if (L.zone === null) { L.zone = s.zone; L.page = s.page; }
    L.mode = s.mode; L.cssScale = k;
    L.ready = !!s.ready && s.ack === L.cmdSeq;
  }
});
