// UI lab page hook (?uilab=1 only). window.__rhUiLab is what Tools/ui-gallery.cjs drives:
//   ready      true once the frozen frame of the current page has been rendered for a few frames
//   state      the last state Unity published (page, pages[], cells[] with their screen rectangles, freeze time, quality)
//   setPage(n, t)   show page n (t >= 0 overrides every effect age with t seconds; -2 restores the catalog ages); clears ready until Unity answers
mergeInto(LibraryManager.library, {
  RhUiLab_Init: function () {
    if (window.__rhUiLab) return;
    var L = window.__rhUiLab = { version: 1, ready: false, state: null, cells: [], pages: [], pageCount: 0, totalPages: 0, cmdSeq: 0, page: 0 };
    L.setPage = function (n, t) {
      L.cmdSeq++; L.ready = false; L.page = n | 0;
      window.unityInstance.SendMessage('UiLab', 'JsCommand', JSON.stringify({ page: n | 0, t: (t === undefined || t === null) ? -1 : t, seq: L.cmdSeq }));
    };
  },
  RhUiLab_Publish: function (json) {
    var L = window.__rhUiLab; if (!L) return;
    var s; try { s = JSON.parse(UTF8ToString(json)); } catch (e) { return; }
    L.state = s; L.cells = s.cells; L.pages = s.pages; L.pageCount = s.pageCount; L.totalPages = s.totalPages;
    L.ready = !!s.ready && s.ack === L.cmdSeq;
  }
});
