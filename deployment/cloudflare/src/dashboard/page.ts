// The balance dashboard's page (docs/TELEMETRY.md 8.1 and 11 C): one HTML shell, one script, one stylesheet, served by
// the Worker at /stats, /stats/app.js and /stats/app.css under a CSP that allows no inline script or style. The page
// fetches /api/stats/* (same origin, cookie) and draws every chart as inline SVG or a canvas: no libraries, fonts or
// CDNs. The script is plain ES2020 inside String.raw, so it holds no backtick and no dollar-brace (a test checks).
// It builds DOM with createElement and textContent only, so no record value is ever parsed as markup.

export function dashboardHtml(): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="referrer" content="same-origin">
<title>RougeHalla balance</title>
<link rel="stylesheet" href="/stats/app.css">
<script src="/stats/app.js" defer></script>
</head>
<body>
<header class="top">
  <div class="brand"><span class="mark" aria-hidden="true"></span><h1>RougeHalla <span>balance</span></h1></div>
  <p id="status" class="status" aria-live="polite">Loading…</p>
  <div class="top-actions">
    <button type="button" id="theme" class="btn ghost" title="Switch theme">Theme: auto</button>
    <button type="button" id="refresh" class="btn ghost">Refresh</button>
    <form method="post" action="/stats/logout" id="logout-form" hidden><button type="submit" class="btn ghost">Log out</button></form>
  </div>
</header>

<section id="login" class="login" hidden aria-labelledby="login-title">
  <form method="post" action="/stats/login" class="login-card">
    <h2 id="login-title">Dashboard sign-in</h2>
    <p class="muted">Paste the dashboard token. The session cookie lasts 7 days.</p>
    <label for="token">Token</label>
    <input id="token" name="token" type="password" autocomplete="current-password" required minlength="32" spellcheck="false">
    <input id="login-next" name="next" type="hidden" value="">
    <p id="login-error" class="error" hidden>That token was not accepted. Try again.</p>
    <button type="submit" class="btn primary">Sign in</button>
  </form>
</section>

<form id="filters" class="filters" hidden>
  <label>Build <select id="f-build" name="build"><option value="">Newest</option></select></label>
  <label>From <input id="f-from" name="from" type="date"></label>
  <label>To <input id="f-to" name="to" type="date"></label>
  <label>Pool <select id="f-pool" name="pool">
    <option value="humans">Humans</option>
    <option value="bots">Bots only</option>
    <option value="all">All (humans and bots mixed)</option>
  </select></label>
  <label>Source <select id="f-source" name="source">
    <option value="live">Live</option><option value="dev">Dev</option><option value="tournament">Tournament</option>
    <option value="bench">Bench</option><option value="test">Test</option><option value="any">Any</option>
  </select></label>
  <label>Faction <select id="f-faction" name="faction"><option value="">All</option></select></label>
  <label>Weapon <select id="f-weapon" name="weapon"><option value="">All</option></select></label>
  <button type="button" id="f-reset" class="btn ghost">Reset</button>
</form>

<p id="pool-banner" class="banner" hidden></p>

<main id="views" hidden>
  <section class="panel wide" id="v-overview"><h2>Overview</h2><div class="body"></div></section>
  <section class="panel" id="v-factions"><h2>Factions: run win rate and pick rate</h2><div class="body"></div></section>
  <section class="panel" id="v-weapons"><h2>Weapons: run win rate and time held</h2><div class="body"></div></section>
  <section class="panel" id="v-dfac"><h2>Duels: faction vs faction</h2><div class="tools"></div><div class="body"></div></section>
  <section class="panel" id="v-dwep"><h2>Duels: weapon vs weapon</h2><div class="tools"></div><div class="body"></div></section>
  <section class="panel wide" id="v-dsum"><h2>Duel outcomes</h2><div class="body"></div></section>
  <section class="panel wide" id="v-offers"><h2>Chest offers: pick rate and win rate</h2><div class="tools"></div><div class="body"></div></section>
  <section class="panel" id="v-farming"><h2>Farming and time to power</h2><div class="body"></div></section>
  <section class="panel" id="v-deaths"><h2>Deaths by cause</h2><div class="body"></div></section>
  <section class="panel wide" id="v-camps"><h2>Camps: clear times and deaths</h2><div class="tools"></div><div class="body"></div></section>
  <section class="panel" id="v-firstblood"><h2>First blood</h2><div class="body"></div></section>
  <section class="panel" id="v-perf"><h2>Client and network</h2><div class="body"></div></section>
  <section class="panel wide" id="v-heatmap"><h2>Heatmap</h2><div class="tools"></div><div class="body"></div></section>
  <section class="panel wide" id="v-runs"><h2>Recent runs</h2><div class="body"></div></section>
</main>
<footer class="foot"><p>Rates show the sample n and a Wilson 95% interval (whiskers). Cells with n under 5 are greyed. Humans and bots are never mixed unless the pool says so.</p></footer>
<div id="tip" class="tip" role="tooltip" hidden></div>
</body>
</html>
`;
}

export function dashboardStyles(): string {
  return String.raw`:root {
  color-scheme: dark;
  /* the game client's tokens (packages/client/src/style.css) */
  --bg: #1b1f24;
  --panel-solid: #14181e;
  --card: #161b21;
  --card-hover: #1b2128;
  --field: #11151a;
  --sunken: #0f1317;
  --line: #2b323c;
  --line-strong: #3a434f;
  --line-hi: #4a5563;
  --text: #e6e9ed;
  --text-soft: #cfd5dc;
  --muted: #aeb7c2;
  --dim: #8d99a6;
  --faint: #6f7b88;
  --accent: #ffe082;
  --accent-dim: #bfa955;
  --accent-line: #6b5a1e;
  --accent-bg: #1c1a12;
  --ok: #66bb6a;
  --danger: #ef5350;
  --danger-text: #ef9a9a;
  --warn: #ffcc80;
  --btn: #2b323c;
  --btn-hover: #343c48;
  --primary: #2e7d32;
  --primary-hover: #388e3c;
  --radius-sm: 4px;
  --radius: 6px;
  --radius-lg: 8px;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --focus: var(--accent);
  /* charts: the validated categorical order (dark steps), diverging blue/red around a grey midpoint, one blue ramp */
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
  --pos: #3987e5; --neg: #e66767; --mid: #383835;
  --seq0: #16202c; --seq1: #184f95; --seq2: #2a78d6; --seq3: #6da7ec; --seq4: #cde2fb;
  --grid: #2c2c2a; --axis: #4a5563; --chart-ink: #f0efec; --chart-ink2: #c3c2b7;
  --ref: #8d99a6;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    color-scheme: light;
    --bg: #f3f4f6; --panel-solid: #ffffff; --card: #ffffff; --card-hover: #f6f7f9; --field: #ffffff; --sunken: #eef0f3;
    --line: #dde1e6; --line-strong: #c9ced6; --line-hi: #aab2bd;
    --text: #15191e; --text-soft: #2b3138; --muted: #4f5964; --dim: #65707c; --faint: #7d8793;
    --accent: #8d6e0f; --accent-dim: #8d6e0f; --accent-line: #d9c27a; --accent-bg: #fbf5e2;
    --ok: #2e7d32; --danger: #c62828; --danger-text: #b71c1c; --warn: #9a6400;
    --btn: #e6e9ed; --btn-hover: #dadee4; --primary: #2e7d32; --primary-hover: #276a2b;
    --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4; --s6: #008300; --s7: #6250d6; --s8: #e34948;
    --pos: #2a78d6; --neg: #e34948; --mid: #f0efec;
    --seq0: #eef3fa; --seq1: #b7d3f6; --seq2: #6da7ec; --seq3: #2a78d6; --seq4: #104281;
    --grid: #e1e0d9; --axis: #c3c2b7; --chart-ink: #0b0b0b; --chart-ink2: #52514e; --ref: #898781;
  }
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #f3f4f6; --panel-solid: #ffffff; --card: #ffffff; --card-hover: #f6f7f9; --field: #ffffff; --sunken: #eef0f3;
  --line: #dde1e6; --line-strong: #c9ced6; --line-hi: #aab2bd;
  --text: #15191e; --text-soft: #2b3138; --muted: #4f5964; --dim: #65707c; --faint: #7d8793;
  --accent: #8d6e0f; --accent-dim: #8d6e0f; --accent-line: #d9c27a; --accent-bg: #fbf5e2;
  --ok: #2e7d32; --danger: #c62828; --danger-text: #b71c1c; --warn: #9a6400;
  --btn: #e6e9ed; --btn-hover: #dadee4; --primary: #2e7d32; --primary-hover: #276a2b;
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4; --s6: #008300; --s7: #6250d6; --s8: #e34948;
  --pos: #2a78d6; --neg: #e34948; --mid: #f0efec;
  --seq0: #eef3fa; --seq1: #b7d3f6; --seq2: #6da7ec; --seq3: #2a78d6; --seq4: #104281;
  --grid: #e1e0d9; --axis: #c3c2b7; --chart-ink: #0b0b0b; --chart-ink2: #52514e; --ref: #898781;
}

* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; line-height: 1.4;
  -webkit-text-size-adjust: 100%;
}
[hidden] { display: none !important; }
h1, h2, h3 { margin: 0; font-weight: 600; }
button, input, select { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.muted { color: var(--muted); }
.num, td.n, .tile .v, table { font-variant-numeric: tabular-nums; }

.top {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 12px 16px;
  border-bottom: 1px solid var(--line); background: var(--panel-solid); position: sticky; top: 0; z-index: 5;
}
.brand { display: flex; align-items: center; gap: 10px; }
.mark { width: 14px; height: 14px; border-radius: 3px; background: var(--accent); transform: rotate(45deg); }
.top h1 { font-size: 16px; }
.top h1 span { color: var(--muted); font-weight: 500; }
.status { margin: 0; color: var(--dim); font-size: 12px; flex: 1 1 200px; overflow-wrap: anywhere; }
.status.err { color: var(--danger-text); }
.top-actions { display: flex; gap: 6px; align-items: center; }
.top-actions form { margin: 0; }

.btn {
  border: 1px solid var(--line-strong); background: var(--btn); border-radius: var(--radius); padding: 6px 12px;
  cursor: pointer; min-height: 32px;
}
.btn:hover { background: var(--btn-hover); }
.btn.ghost { background: transparent; }
.btn.ghost:hover { background: var(--card-hover); }
.btn.primary { background: var(--primary); border-color: var(--primary); color: #fff; }
.btn.primary:hover { background: var(--primary-hover); }

.seg { display: inline-flex; border: 1px solid var(--line-strong); border-radius: var(--radius); overflow: hidden; }
.seg button { border: 0; background: transparent; padding: 4px 10px; cursor: pointer; min-height: 28px; color: var(--muted); }
.seg button + button { border-left: 1px solid var(--line-strong); }
.seg button[aria-pressed="true"] { background: var(--accent-bg); color: var(--accent); }

.login { display: flex; justify-content: center; padding: 48px 16px; }
.login-card {
  width: 100%; max-width: 380px; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius-lg);
  padding: 24px; display: flex; flex-direction: column; gap: 10px;
}
.login-card h2 { font-size: 18px; }
.login-card p { margin: 0; }
.login-card input {
  background: var(--field); border: 1px solid var(--line-strong); border-radius: var(--radius); padding: 8px 10px; min-height: 36px;
}
.error { color: var(--danger-text); }

.filters {
  display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-end; padding: 12px 16px; border-bottom: 1px solid var(--line);
}
.filters label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--dim); }
.filters select, .filters input {
  background: var(--field); border: 1px solid var(--line-strong); border-radius: var(--radius); padding: 5px 8px; min-height: 32px;
  color: var(--text); font-size: 13px; min-width: 0;
}
.banner { margin: 12px 16px 0; padding: 8px 12px; border-radius: var(--radius); border: 1px solid var(--accent-line); background: var(--accent-bg); color: var(--accent); }

main {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 460px), 1fr)); gap: 16px; padding: 16px;
  max-width: 1500px; margin: 0 auto;
}
.panel { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 14px 16px; min-width: 0; }
.panel.wide { grid-column: 1 / -1; }
.panel h2 { font-size: 14px; margin-bottom: 10px; color: var(--text-soft); }
.panel .tools { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; align-items: center; }
.panel .tools .lbl { font-size: 12px; color: var(--dim); }
.panel .note { font-size: 12px; color: var(--dim); margin: 8px 0 0; }
.panel .empty { color: var(--dim); padding: 16px 0; }
.panel .perr { color: var(--danger-text); }
.scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }

.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
.tile { background: var(--sunken); border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 12px; }
.tile .k { font-size: 12px; color: var(--dim); }
.tile .v { font-size: 22px; font-weight: 600; margin-top: 2px; }
.tile .s { font-size: 12px; color: var(--muted); margin-top: 2px; }
.tile.small .v, .tile.small .s { opacity: 0.45; }

table.t { width: 100%; border-collapse: collapse; font-size: 13px; }
table.t th, table.t td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: middle; white-space: nowrap; }
table.t th { font-weight: 500; color: var(--dim); font-size: 12px; }
table.t th.sortable { cursor: pointer; user-select: none; }
table.t th.sortable:hover { color: var(--text); }
table.t th[aria-sort="ascending"]::after { content: " \25B2"; }
table.t th[aria-sort="descending"]::after { content: " \25BC"; }
table.t td.n, table.t th.n { text-align: right; }
table.t td.chart { width: 34%; min-width: 120px; }
table.t tr.small td { color: var(--faint); }
table.t tr.small td.chart svg { opacity: 0.4; }
table.t tbody tr:hover td { background: var(--card-hover); }
table.t tr.click { cursor: pointer; }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.ci { color: var(--dim); font-size: 12px; }

svg.chart { display: block; width: 100%; overflow: visible; }
svg.chart.inline { display: inline-block; width: 64px; vertical-align: middle; }
svg text { fill: var(--chart-ink2); font-size: 11px; font-family: var(--font); }
svg text.ink { fill: var(--chart-ink); }
svg .grid { stroke: var(--grid); stroke-width: 1; }
svg .axis { stroke: var(--axis); stroke-width: 1; }
svg .refl { stroke: var(--ref); stroke-width: 1; stroke-dasharray: 3 3; }
svg .track { stroke: var(--grid); stroke-width: 6; stroke-linecap: round; }
svg .whisk { stroke: var(--chart-ink2); stroke-width: 1.5; }
svg .dot { stroke: var(--card); stroke-width: 2; }
svg .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
svg .bar { stroke: var(--card); stroke-width: 2; }
svg .hit { fill: transparent; }
svg .small { opacity: 0.35; }
.c1 { fill: var(--s1); stroke: var(--s1); } .c2 { fill: var(--s2); stroke: var(--s2); } .c3 { fill: var(--s3); stroke: var(--s3); }
.c4 { fill: var(--s4); stroke: var(--s4); } .c5 { fill: var(--s5); stroke: var(--s5); } .c6 { fill: var(--s6); stroke: var(--s6); }
.c7 { fill: var(--s7); stroke: var(--s7); } .c8 { fill: var(--s8); stroke: var(--s8); } .cg { fill: var(--ref); stroke: var(--ref); }
svg .dot.c1, svg .dot.c2, svg .dot.c3, svg .dot.c4, svg .dot.c5, svg .dot.cg, svg .bar.c1, svg .bar.c2, svg .bar.c3, svg .bar.c4,
svg .bar.c5, svg .bar.c6, svg .bar.c7, svg .bar.c8, svg .bar.cg { stroke: var(--card); }
span.c1 { background: var(--s1); } span.c2 { background: var(--s2); } span.c3 { background: var(--s3); } span.c4 { background: var(--s4); }
span.c5 { background: var(--s5); } span.c6 { background: var(--s6); } span.c7 { background: var(--s7); } span.c8 { background: var(--s8); }
span.cg { background: var(--ref); }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--muted); margin: 6px 0; }

.matrix { border-collapse: separate; border-spacing: 2px; font-size: 12px; margin: 0 auto; }
.matrix th { font-weight: 500; color: var(--dim); padding: 4px 6px; white-space: nowrap; }
.matrix th.rowh { text-align: right; }
.matrix td { min-width: 54px; height: 44px; text-align: center; border-radius: var(--radius-sm); padding: 2px 4px; cursor: default; }
.matrix td .r { font-weight: 600; font-size: 13px; display: block; }
.matrix td .nn { font-size: 10px; opacity: 0.85; display: block; }
.matrix td.small { opacity: 0.4; }
.matrix td.none { background: var(--sunken); color: var(--faint); }
.scale { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--dim); margin-top: 8px; justify-content: center; }
.scale canvas { width: 160px; height: 10px; border-radius: 2px; }

.heatwrap { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
@media (min-width: 900px) { .heatwrap.two { grid-template-columns: 1fr 1fr; } }
.heat { position: relative; width: 100%; max-width: 560px; margin: 0 auto; }
.heat > canvas { width: 100%; height: auto; aspect-ratio: 1 / 1; display: block; border-radius: var(--radius); border: 1px solid var(--line); background: var(--seq0); }
.heat h3 { font-size: 13px; color: var(--text-soft); margin-bottom: 6px; font-weight: 500; }

.tip {
  position: fixed; z-index: 20; pointer-events: none; background: var(--panel-solid); border: 1px solid var(--line-hi);
  border-radius: var(--radius); padding: 6px 9px; font-size: 12px; max-width: 280px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  white-space: pre-line; font-variant-numeric: tabular-nums;
}
.foot { padding: 0 16px 24px; color: var(--faint); font-size: 12px; max-width: 1500px; margin: 0 auto; }

@media (max-width: 640px) {
  .top { padding: 10px 16px; position: static; }
  .status { order: 3; flex-basis: 100%; }
  .filters { display: grid; grid-template-columns: 1fr 1fr; padding: 10px 16px; }
  .filters label { min-width: 0; }
  .filters #f-reset { grid-column: span 2; }
  main { padding: 12px 16px; gap: 12px; }
  .panel { padding: 12px; }
  table.t .hide-sm, table.t td.n .ci { display: none; }
  table.t td.chart { min-width: 96px; width: auto; }
  .matrix td { min-width: 40px; height: 38px; }
  .matrix td .r { font-size: 12px; }
  .tile .v { font-size: 19px; }
}
`;
}

export function dashboardScript(): string {
  return String.raw`(function () {
"use strict";

var FACTIONS = ["fire", "sentenced", "plague", "frost", "holy"];
var FACTION_LABEL = { fire: "Fire", sentenced: "Sentenced", plague: "Plague", frost: "Frost", holy: "Demon Blood" };
var WEAPONS = ["sword", "bow", "wand", "shield", "axe", "fists"];
var WEAPON_LABEL = { sword: "Sword", bow: "Bow", wand: "Wand", shield: "Shield", axe: "Axe", fists: "Fists" };
var OUTCOMES = ["kill", "disengage", "thirdParty", "trade", "hazard", "quit", "teleport", "runEnd"];
var OUTCOME_LABEL = { kill: "Kill", disengage: "Disengage", thirdParty: "Third party", trade: "Trade", hazard: "Hazard",
  quit: "Quit", teleport: "Teleport", runEnd: "Run end" };
var DEATH_KINDS = ["player", "mob", "zombie", "terrain", "suddenDeath", "quit", "unknown"];
var DEATH_LABEL = { player: "Player", mob: "Mob", zombie: "Zombie", terrain: "Terrain", suddenDeath: "Sudden death",
  quit: "Quit (MIA)", unknown: "Unknown" };
var SNAP_MINUTES = [1, 3, 5, 10];
var SMALL_N = 5;
var REFRESH_MS = 60000;
var FILTER_KEYS = ["build", "from", "to", "pool", "source", "faction", "weapon"];
var DEFAULTS = { build: "", from: "", to: "", pool: "humans", source: "live", faction: "", weapon: "" };
var API = {
  meta: "/api/stats/meta", overview: "/api/stats/overview", factions: "/api/stats/factions", weapons: "/api/stats/weapons",
  dfac: "/api/stats/duels/factions", dwep: "/api/stats/duels/weapons", dsum: "/api/stats/duels/summary",
  offers: "/api/stats/offers", farming: "/api/stats/farming", camps: "/api/stats/camps", deaths: "/api/stats/deaths",
  firstblood: "/api/stats/firstblood", heatmap: "/api/stats/heatmap", perf: "/api/stats/perf", runs: "/api/stats/runs",
  run: "/api/stats/run/"
};

var state = readUrl();
var cache = {};
var metaLoaded = false;
var timer = 0;
var loading = false;
var selectedRun = "";

// ---- small DOM helpers (textContent only; never parse data as HTML) -------------------------------------------
function $(id) { return document.getElementById(id); }
function el(tag, attrs, kids) {
  var e = document.createElement(tag);
  setAttrs(e, attrs);
  append(e, kids);
  return e;
}
var SVGNS = "http://www.w3.org/2000/svg";
function sv(tag, attrs, kids) {
  var e = document.createElementNS(SVGNS, tag);
  setAttrs(e, attrs);
  append(e, kids);
  return e;
}
function setAttrs(e, attrs) {
  if (!attrs) return;
  for (var k in attrs) {
    if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
    var v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === "text") e.textContent = String(v);
    else if (k === "cls") e.setAttribute("class", v);
    else e.setAttribute(k, String(v));
  }
}
function append(e, kids) {
  if (kids === null || kids === undefined) return;
  if (!Array.isArray(kids)) kids = [kids];
  for (var i = 0; i < kids.length; i++) {
    var c = kids[i];
    if (c === null || c === undefined || c === false) continue;
    e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}
function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); }
function body(id) { return $(id).querySelector(".body"); }
function tools(id) { return $(id).querySelector(".tools"); }

// ---- formatting --------------------------------------------------------------------------------------------------
function pct(x, d) { return (x * 100).toFixed(d === undefined ? 1 : d) + "%"; }
function fixed(x, d) { return x === null || x === undefined || !isFinite(x) ? "–" : Number(x).toFixed(d); }
function mmss(s) {
  if (s === null || s === undefined || !isFinite(s)) return "–";
  var m = Math.floor(s / 60), r = Math.round(s - m * 60);
  if (r === 60) { m += 1; r = 0; }
  return m + ":" + (r < 10 ? "0" : "") + r;
}
function ciText(c) { return pct(c.rate) + " [" + pct(c.lo) + " – " + pct(c.hi) + "], n = " + c.n + (c.n < SMALL_N ? " (small)" : ""); }
function fLabel(f) { return FACTION_LABEL[f] || f || "–"; }
function wLabel(w) { return WEAPON_LABEL[w] || w || "–"; }
function camel(s) { return String(s).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, function (c) { return c.toUpperCase(); }); }
function optionLabel(kind, o) {
  if (kind === "stat") return camel(String(o).replace(/^boost:/, ""));
  if (kind === "trophy") return "Trophy: " + camel(String(o).replace(/^kill:/, "").split(":")[0]);
  return camel(o);
}
function fClass(f) { var i = FACTIONS.indexOf(f); return i < 0 ? "cg" : "c" + (i + 1); }
function shortLabel(s) {
  if (window.innerWidth >= 640 || s.length <= 6) return s;
  return s.split(" ")[0].slice(0, 5);
}
function swatch(cls) { return el("span", { cls: "sw " + cls, "aria-hidden": "true" }); }

// ---- URL state ------------------------------------------------------------------------------------------------------
function readUrl() {
  var q = new URLSearchParams(location.search);
  var s = {};
  for (var i = 0; i < FILTER_KEYS.length; i++) { var k = FILTER_KEYS[i]; s[k] = q.get(k) || DEFAULTS[k]; }
  s.clean = q.get("clean") === "0" ? "0" : "1";
  s.outcomes = q.get("outcomes") === "kill,thirdParty" ? "kill,thirdParty" : "kill";
  s.kind = ["augment", "stat", "trophy"].indexOf(q.get("kind") || "") >= 0 ? q.get("kind") : "augment";
  s.by = q.get("by") === "weapon" ? "weapon" : "faction";
  return s;
}
function writeUrl() {
  var q = new URLSearchParams();
  for (var i = 0; i < FILTER_KEYS.length; i++) { var k = FILTER_KEYS[i]; if (state[k] && state[k] !== DEFAULTS[k]) q.set(k, state[k]); }
  if (state.clean !== "1") q.set("clean", state.clean);
  if (state.outcomes !== "kill") q.set("outcomes", state.outcomes);
  if (state.kind !== "augment") q.set("kind", state.kind);
  if (state.by !== "faction") q.set("by", state.by);
  var s = q.toString();
  history.replaceState(null, "", location.pathname + (s ? "?" + s : ""));
}
function filterQuery(extra) {
  var q = new URLSearchParams();
  for (var i = 0; i < FILTER_KEYS.length; i++) { var k = FILTER_KEYS[i]; if (state[k]) q.set(k, state[k]); }
  if (extra) for (var e in extra) if (Object.prototype.hasOwnProperty.call(extra, e)) q.set(e, extra[e]);
  return q.toString();
}

// ---- fetching -------------------------------------------------------------------------------------------------------
function Unauthorized() { this.name = "Unauthorized"; }
function api(path, extra, raw) {
  var url = path + (raw ? "" : "?" + filterQuery(extra));
  return fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } }).then(function (res) {
    if (res.status === 401) throw new Unauthorized();
    if (!res.ok) {
      return res.text().then(function (t) {
        var msg = "HTTP " + res.status;
        try { var j = JSON.parse(t); if (j && j.error) msg += ": " + j.error; } catch (e) { /* not JSON */ }
        throw new Error(msg);
      });
    }
    return res.json();
  });
}

function showLogin() {
  $("login").hidden = false;
  $("filters").hidden = true;
  $("views").hidden = true;
  $("logout-form").hidden = true;
  $("pool-banner").hidden = true;
  setStatus("Sign in to see the dashboard.");
  var sp = new URLSearchParams(location.search);
  if (sp.get("login") === "failed") $("login-error").hidden = false;
  sp.delete("login");
  // The filters in the address bar survive the sign-in's redirect.
  $("login-next").value = sp.toString();
  var t = $("token");
  if (t) t.focus();
}
function showApp() {
  $("login").hidden = true;
  $("filters").hidden = false;
  $("views").hidden = false;
  $("logout-form").hidden = false;
}
function setStatus(text, err) {
  var s = $("status");
  s.textContent = text;
  s.className = "status" + (err ? " err" : "");
}

// ---- panels: fetch and render ----------------------------------------------------------------------------------------
var PANELS = [
  { id: "v-overview", key: "overview", path: API.overview, render: renderOverview },
  { id: "v-factions", key: "factions", path: API.factions, render: renderFactions },
  { id: "v-weapons", key: "weapons", path: API.weapons, render: renderWeapons },
  { id: "v-dfac", key: "dfac", path: API.dfac, extra: duelExtra, render: function (d) { renderMatrix("v-dfac", d, FACTIONS, fLabel); } },
  { id: "v-dwep", key: "dwep", path: API.dwep, extra: duelExtra, render: function (d) { renderMatrix("v-dwep", d, WEAPONS, wLabel); } },
  { id: "v-dsum", key: "dsum", path: API.dsum, render: renderDuelSummary },
  { id: "v-offers", key: "offers", path: API.offers, extra: function () { return { kind: state.kind }; }, render: renderOffers },
  { id: "v-farming", key: "farming", path: API.farming, render: renderFarming },
  { id: "v-camps", key: "camps", path: API.camps, extra: function () { return { by: state.by }; }, render: renderCamps },
  { id: "v-deaths", key: "deaths", path: API.deaths, render: renderDeaths },
  { id: "v-firstblood", key: "firstblood", path: API.firstblood, render: renderFirstBlood },
  { id: "v-perf", key: "perf", path: API.perf, render: renderPerf },
  { id: "v-heatmap", key: "heatmap", path: API.heatmap, render: renderHeatmap },
  { id: "v-runs", key: "runs", path: API.runs, extra: function () { return { limit: "25" }; }, render: renderRuns }
];
function duelExtra() { return { clean: state.clean, outcomes: state.outcomes }; }
function panelOf(key) { for (var i = 0; i < PANELS.length; i++) if (PANELS[i].key === key) return PANELS[i]; return null; }

function loadPanel(p) {
  return api(p.path, p.extra ? p.extra() : null).then(function (data) {
    cache[p.key] = data;
    safeRender(p);
    return data;
  }, function (err) {
    if (err instanceof Unauthorized) throw err;
    var b = body(p.id);
    clear(b);
    b.appendChild(el("p", { cls: "perr", text: "Could not load: " + (err && err.message ? err.message : String(err)) }));
    return null;
  });
}
function safeRender(p) {
  var b = body(p.id);
  try {
    clear(b);
    p.render(cache[p.key]);
  } catch (e) {
    clear(b);
    b.appendChild(el("p", { cls: "perr", text: "Could not draw this view: " + (e && e.message ? e.message : String(e)) }));
  }
}
function rerenderAll() { for (var i = 0; i < PANELS.length; i++) if (cache[PANELS[i].key]) safeRender(PANELS[i]); }

function loadAll() {
  if (loading) return Promise.resolve();
  loading = true;
  setStatus("Loading…");
  var first = metaLoaded ? Promise.resolve(null) : api(API.meta, null, true).then(function (m) { fillMeta(m); metaLoaded = true; });
  return first.then(function () {
    showApp();
    return Promise.all(PANELS.map(loadPanel));
  }).then(function () {
    describeQuery();
  }, function (err) {
    if (err instanceof Unauthorized) { showLogin(); return; }
    setStatus("Could not load the dashboard: " + (err && err.message ? err.message : String(err)), true);
  }).then(function () { loading = false; });
}
function reloadPanel(key) {
  var p = panelOf(key);
  if (!p) return;
  loadPanel(p).catch(function (err) { if (err instanceof Unauthorized) showLogin(); });
}

function describeQuery() {
  var env = cache.overview;
  var q = env && env.query ? env.query : {};
  var parts = [];
  var b = q.build || state.build || "newest";
  parts.push("Build " + (b.length > 16 ? b.slice(0, 12) : b));
  parts.push(q.from || q.to ? (q.from || "start") + " to " + (q.to || "today") : "last 14 days");
  parts.push(q.pool === "all" ? "humans and bots mixed" : q.pool === "bots" ? "bots only" : "humans");
  parts.push("source " + (q.source || state.source));
  if (q.faction) parts.push(fLabel(q.faction));
  if (q.weapon) parts.push(wLabel(q.weapon));
  var t = new Date();
  var hh = (t.getHours() < 10 ? "0" : "") + t.getHours(), mm = (t.getMinutes() < 10 ? "0" : "") + t.getMinutes();
  setStatus(parts.join(" · ") + " · updated " + hh + ":" + mm + " (auto-refresh 60 s)");
  var notes = [];
  for (var i = 0; i < PANELS.length; i++) {
    var d = cache[PANELS[i].key];
    if (d && d.notes) for (var j = 0; j < d.notes.length; j++) if (notes.indexOf(d.notes[j]) < 0) notes.push(d.notes[j]);
  }
  var b = $("pool-banner");
  var msg = [];
  if (state.pool !== "humans") msg.push(state.pool === "bots" ? "Showing BOT players only." : "Showing humans AND bots mixed together.");
  if (notes.length) msg.push(notes.join(" "));
  b.textContent = msg.join(" ");
  b.hidden = msg.length === 0;
}

function fillMeta(m) {
  var sel = $("f-build");
  while (sel.options.length > 1) sel.remove(1);
  var builds = (m && m.builds) || [];
  for (var i = 0; i < builds.length; i++) {
    var b = builds[i];
    sel.appendChild(el("option", { value: b.build, text: (b.build.length > 16 ? b.build.slice(0, 12) : b.build) + (b.commit ? " (" + String(b.commit).slice(0, 7) + ")" : "") + " · " + b.runs + " runs · " + b.firstDay + " to " + b.lastDay }));
  }
  var fs = $("f-faction");
  if (fs.options.length === 1) for (var f = 0; f < FACTIONS.length; f++) fs.appendChild(el("option", { value: FACTIONS[f], text: fLabel(FACTIONS[f]) }));
  var ws = $("f-weapon");
  if (ws.options.length === 1) for (var w = 0; w < WEAPONS.length; w++) ws.appendChild(el("option", { value: WEAPONS[w], text: wLabel(WEAPONS[w]) }));
  syncFilters();
}
function syncFilters() {
  $("f-build").value = state.build;
  $("f-from").value = state.from;
  $("f-to").value = state.to;
  $("f-pool").value = state.pool;
  $("f-source").value = state.source;
  $("f-faction").value = state.faction;
  $("f-weapon").value = state.weapon;
}

// ---- tooltip ----------------------------------------------------------------------------------------------------------
var tip = null;
function tipShow(text, x, y) {
  tip.textContent = text;
  tip.hidden = false;
  var w = tip.offsetWidth, h = tip.offsetHeight;
  var left = Math.min(window.innerWidth - w - 8, x + 14);
  var top = y + 16 + h > window.innerHeight ? y - h - 12 : y + 16;
  tip.style.left = Math.max(8, left) + "px";
  tip.style.top = Math.max(8, top) + "px";
}
function tipHide() { tip.hidden = true; }
function tipTarget(e) {
  var t = e.target;
  while (t && t !== document) {
    if (t.getAttribute && t.getAttribute("data-tip")) return t;
    t = t.parentNode;
  }
  return null;
}
function initTips() {
  tip = $("tip");
  document.addEventListener("pointermove", function (e) {
    var t = tipTarget(e);
    if (t) tipShow(t.getAttribute("data-tip"), e.clientX, e.clientY); else if (e.pointerType === "mouse") tipHide();
  });
  document.addEventListener("pointerdown", function (e) {
    var t = tipTarget(e);
    if (t) tipShow(t.getAttribute("data-tip"), e.clientX, e.clientY); else tipHide();
  });
  document.addEventListener("scroll", tipHide, true);
}

// ---- chart primitives ---------------------------------------------------------------------------------------------------
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function hexRgb(h) {
  h = h.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  var n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rgbStr(c) { return "rgb(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + ")"; }
function lum(c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
function diverging(rate) {
  var mid = hexRgb(cssVar("--mid")), pos = hexRgb(cssVar("--pos")), neg = hexRgb(cssVar("--neg"));
  var t = Math.max(-1, Math.min(1, (rate - 0.5) / 0.35));
  return t >= 0 ? mix(mid, pos, t) : mix(mid, neg, -t);
}
function seqRamp() { return ["--seq0", "--seq1", "--seq2", "--seq3", "--seq4"].map(function (v) { return hexRgb(cssVar(v)); }); }
function seqColor(ramp, t) {
  t = Math.max(0, Math.min(1, t));
  var x = t * (ramp.length - 1), i = Math.min(ramp.length - 2, Math.floor(x));
  return mix(ramp[i], ramp[i + 1], x - i);
}
function widthOf(node, fallback) {
  var w = node.clientWidth || (node.parentNode && node.parentNode.clientWidth) || fallback;
  return Math.max(260, Math.floor(w));
}
function niceMax(x) {
  if (!(x > 0)) return 1;
  var steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  for (var i = 0; i < steps.length; i++) if (steps[i] >= x) return steps[i];
  var p = Math.pow(10, Math.ceil(Math.log10(x)));
  return x <= p / 2 ? p / 2 : p;
}

// A rate as a dot on its Wilson whiskers, on [0, max]. ref = a dashed reference line (e.g. the pool average).
function rateGlyph(cell, max, cls, ref) {
  var W = 200, H = 18, pad = 5;
  var x = function (v) { return pad + (W - 2 * pad) * Math.max(0, Math.min(1, v / max)); };
  var g = sv("svg", { viewBox: "0 0 " + W + " " + H, cls: "chart" + (cell.n < SMALL_N ? " small" : ""), height: H, "aria-hidden": "true", preserveAspectRatio: "xMinYMid meet" });
  g.appendChild(sv("line", { x1: x(0), x2: x(max), y1: H / 2, y2: H / 2, cls: "track" }));
  if (ref !== undefined && ref !== null) g.appendChild(sv("line", { x1: x(ref), x2: x(ref), y1: 1, y2: H - 1, cls: "refl" }));
  if (cell.n > 0) {
    g.appendChild(sv("line", { x1: x(cell.lo), x2: x(cell.hi), y1: H / 2, y2: H / 2, cls: "whisk" }));
    g.appendChild(sv("line", { x1: x(cell.lo), x2: x(cell.lo), y1: H / 2 - 4, y2: H / 2 + 4, cls: "whisk" }));
    g.appendChild(sv("line", { x1: x(cell.hi), x2: x(cell.hi), y1: H / 2 - 4, y2: H / 2 + 4, cls: "whisk" }));
    g.appendChild(sv("circle", { cx: x(cell.rate), cy: H / 2, r: 5, cls: "dot " + (cls || "c1") }));
  }
  return g;
}
function shareGlyph(share, max, cls) {
  var W = 64, H = 14;
  var g = sv("svg", { viewBox: "0 0 " + W + " " + H, cls: "chart inline", width: 64, height: H, "aria-hidden": "true", preserveAspectRatio: "xMinYMid meet" });
  g.appendChild(sv("rect", { x: 0, y: 3, width: W, height: 8, rx: 4, cls: "track", fill: "none" }));
  var w = Math.max(share > 0 ? 3 : 0, W * Math.min(1, share / (max || 1)));
  g.appendChild(sv("rect", { x: 0, y: 3, width: w, height: 8, rx: 4, cls: "bar " + (cls || "c1") }));
  return g;
}
function rateCellTd(c) {
  return el("td", { cls: "n", "data-tip": ciText(c) }, [pct(c.rate), el("span", { cls: "ci", text: " " + pct(c.lo, 0) + "–" + pct(c.hi, 0) })]);
}
function emptyNote(b, text) { b.appendChild(el("p", { cls: "empty", text: text || "No data for this filter yet." })); }
function legend(items) {
  var l = el("div", { cls: "legend" });
  for (var i = 0; i < items.length; i++) l.appendChild(el("span", null, [swatch(items[i][0]), items[i][1]]));
  return l;
}
function segmented(label, options, value, onPick) {
  var wrap = el("div", { cls: "seg", role: "group", "aria-label": label });
  options.forEach(function (o) {
    var b = el("button", { type: "button", "aria-pressed": o[0] === value ? "true" : "false", text: o[1] });
    b.addEventListener("click", function () { onPick(o[0]); });
    wrap.appendChild(b);
  });
  return el("span", null, [el("span", { cls: "lbl", text: label + " " }), wrap]);
}

// ---- views ------------------------------------------------------------------------------------------------------------
function tile(k, v, s, small) {
  return el("div", { cls: "tile" + (small ? " small" : "") }, [el("div", { cls: "k", text: k }), el("div", { cls: "v", text: v }), s ? el("div", { cls: "s", text: s }) : null]);
}

function renderOverview(env) {
  var b = body("v-overview");
  var r = env.rows[0];
  if (!r) { emptyNote(b); return; }
  b.appendChild(el("div", { cls: "tiles" }, [
    tile("Runs", String(r.runs), r.voided ? r.voided + " voided or abandoned" : "none voided"),
    tile("Players in pool", String(r.players), state.pool === "humans" ? "humans" : state.pool === "bots" ? "bots" : "humans and bots"),
    tile("Humans vs bots", r.humans + " / " + r.bots, "player records in these runs"),
    tile("Duels in pool", String(r.duels), null),
    tile("Median run", mmss(r.medianDurationS), "m:ss"),
    tile("Median first blood", mmss(r.medianFirstBloodS), "m:ss after the start")
  ]));
}

function poolAverage(rows) {
  var n = 0, k = 0;
  for (var i = 0; i < rows.length; i++) { n += rows[i].win.n; k += rows[i].win.k; }
  return n > 0 ? k / n : null;
}

function renderFactions(env) {
  var b = body("v-factions");
  var rows = env.rows.slice().sort(function (a, c) { return FACTIONS.indexOf(a.faction) - FACTIONS.indexOf(c.faction); });
  if (!rows.length) { emptyNote(b); return; }
  var max = niceMax(Math.max.apply(null, rows.map(function (r) { return r.win.hi; })));
  var avg = poolAverage(rows);
  var total = rows.reduce(function (s, r) { return s + r.win.n; }, 0);
  var maxShare = Math.max.apply(null, rows.map(function (r) { return r.win.n / total; }));
  var tb = el("tbody");
  rows.forEach(function (r) {
    var share = r.win.n / total;
    tb.appendChild(el("tr", { cls: r.win.n < SMALL_N ? "small" : null }, [
      el("td", null, [swatch(fClass(r.faction)), fLabel(r.faction)]),
      el("td", { cls: "chart", "data-tip": fLabel(r.faction) + " run win rate\n" + ciText(r.win) + (avg !== null ? "\npool average " + pct(avg) : "") }, rateGlyph(r.win, max, fClass(r.faction), avg)),
      rateCellTd(r.win),
      el("td", { cls: "n hide-sm", "data-tip": "Picked by " + r.win.n + " of " + total + " players (" + pct(share) + ")" }, [shareGlyph(share, maxShare, "cg"), " " + pct(share, 0)]),
      el("td", { cls: "n hide-sm", text: fixed(r.avgPlace, 2) }),
      el("td", { cls: "n hide-sm", text: fixed(r.avgKills, 2) }),
      el("td", { cls: "n hide-sm", text: fixed(r.avgMobKills, 1) }),
      el("td", { cls: "n hide-sm", text: mmss(r.avgAliveS) })
    ]));
  });
  b.appendChild(el("div", { cls: "scroll" }, el("table", { cls: "t" }, [
    el("thead", null, el("tr", null, [el("th", { text: "Faction" }), el("th", { text: "Run win rate (0 – " + pct(max, 0) + ")" }), el("th", { cls: "n", text: "Win" }),
      el("th", { cls: "n hide-sm", text: "Pick rate" }), el("th", { cls: "n hide-sm", text: "Avg place" }), el("th", { cls: "n hide-sm", text: "Kills" }),
      el("th", { cls: "n hide-sm", text: "Mobs" }), el("th", { cls: "n hide-sm", text: "Alive" })])),
    tb
  ])));
  b.appendChild(el("p", { cls: "note", text: "Won = the run's winner (a draw is not a win). Dashed line: the pool's average win rate. Pick rate = share of the pool's players on that faction." }));
}

function renderWeapons(env) {
  var b = body("v-weapons");
  var rows = env.rows.slice().sort(function (a, c) { return WEAPONS.indexOf(a.weapon) - WEAPONS.indexOf(c.weapon); });
  if (!rows.length) { emptyNote(b); return; }
  var max = niceMax(Math.max.apply(null, rows.map(function (r) { return r.win.hi; })));
  var avg = poolAverage(rows);
  var maxHeld = Math.max.apply(null, rows.map(function (r) { return r.heldShare; }));
  var tb = el("tbody");
  rows.forEach(function (r) {
    tb.appendChild(el("tr", { cls: r.win.n < SMALL_N ? "small" : null }, [
      el("td", { text: wLabel(r.weapon) }),
      el("td", { cls: "chart", "data-tip": wLabel(r.weapon) + " as main weapon\n" + ciText(r.win) }, rateGlyph(r.win, max, "c1", avg)),
      rateCellTd(r.win),
      el("td", { cls: "n", "data-tip": pct(r.heldShare) + " of all sampled seconds were held with it" }, [shareGlyph(r.heldShare, maxHeld, "cg"), " " + pct(r.heldShare, 0)])
    ]));
  });
  b.appendChild(el("div", { cls: "scroll" }, el("table", { cls: "t" }, [
    el("thead", null, el("tr", null, [el("th", { text: "Main weapon" }), el("th", { text: "Run win rate (0 – " + pct(max, 0) + ")" }), el("th", { cls: "n", text: "Win" }), el("th", { cls: "n", text: "Time held" })])),
    tb
  ])));
  b.appendChild(el("p", { cls: "note", text: "Main weapon = the weapon held longest in the run. Fists = an empty hand." }));
}

function renderMatrix(id, env, order, label) {
  var t = tools(id);
  clear(t);
  t.appendChild(segmented("Duels", [["1", "Clean only"], ["0", "All"]], state.clean, function (v) { state.clean = v; writeUrl(); reloadPanel("dfac"); reloadPanel("dwep"); }));
  t.appendChild(segmented("Outcomes", [["kill", "Kills"], ["kill,thirdParty", "Kills + third-party survivors"]], state.outcomes, function (v) { state.outcomes = v; writeUrl(); reloadPanel("dfac"); reloadPanel("dwep"); }));
  var b = body(id);
  var cells = {};
  var present = {};
  env.rows.forEach(function (c) { cells[c.row + "|" + c.col] = c; present[c.row] = 1; present[c.col] = 1; });
  var keys = order.filter(function (k) { return present[k]; });
  if (!keys.length) { emptyNote(b); return; }
  var head = el("tr", null, [el("th", { cls: "rowh", text: "row beats col" })]);
  keys.forEach(function (k) { head.appendChild(el("th", { scope: "col", text: shortLabel(label(k)), title: label(k) })); });
  var tb = el("tbody");
  var ink = hexRgb(cssVar("--chart-ink"));
  keys.forEach(function (r) {
    var tr = el("tr", null, [el("th", { scope: "row", cls: "rowh", text: shortLabel(label(r)), title: label(r) })]);
    keys.forEach(function (c) {
      var cell = cells[r + "|" + c];
      if (!cell) { tr.appendChild(el("td", { cls: "none", text: "–", "data-tip": label(r) + " vs " + label(c) + ": no duels" })); return; }
      var col = diverging(cell.win.rate);
      var td = el("td", {
        cls: cell.win.n < SMALL_N ? "small" : null,
        "data-tip": label(r) + " vs " + label(c) + "\n" + ciText(cell.win) + "\nmedian duel " + fixed(cell.medianDurationS, 1) + " s" + (r === c ? "\n(mirror: each duel counts once as 1 of 2)" : "")
      }, [el("span", { cls: "r", text: pct(cell.win.rate, 0) }), el("span", { cls: "nn", text: "n " + cell.win.n })]);
      td.style.background = rgbStr(col);
      td.style.color = lum(col) > 0.55 ? "#0b0b0b" : (lum(ink) > 0.5 ? rgbStr(ink) : "#ffffff");
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  b.appendChild(el("div", { cls: "scroll" }, el("table", { cls: "matrix" }, [el("thead", null, head), tb])));
  var sc = el("canvas", { width: 160, height: 10, "aria-hidden": "true" });
  var ctx = sc.getContext("2d");
  for (var i = 0; i < 160; i++) { ctx.fillStyle = rgbStr(diverging(0.15 + 0.7 * i / 159)); ctx.fillRect(i, 0, 1, 10); }
  b.appendChild(el("div", { cls: "scale" }, [el("span", { text: "row loses ≤15%" }), sc, el("span", { text: "≥85% row wins" })]));
  b.appendChild(el("p", { cls: "note", text: "From the row's side; each duel appears in both orientations. " + (state.clean === "1" ? "Clean = no other player, zombie or mob hurt either side." : "All duels, third parties included.") }));
}

function renderDuelSummary(env) {
  var b = body("v-dsum");
  var r = env.rows[0];
  if (!r || !r.n) { emptyNote(b); return; }
  var W = widthOf(b, 600), H = 34;
  var g = sv("svg", { cls: "chart", width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Duel outcome shares" });
  var x = 0;
  var items = [];
  OUTCOMES.forEach(function (o, i) {
    var n = r.outcomes[o] || 0;
    if (!n) return;
    var w = W * n / r.n;
    var cls = "c" + (i + 1);
    g.appendChild(sv("rect", { x: x, y: 4, width: Math.max(1, w - 2), height: 22, rx: 3, cls: "bar " + cls, "data-tip": OUTCOME_LABEL[o] + ": " + n + " of " + r.n + " (" + pct(n / r.n) + ")" }));
    if (w > 54) g.appendChild(sv("text", { x: x + 6, y: 19, cls: "ink", text: pct(n / r.n, 0) }));
    items.push([cls, OUTCOME_LABEL[o] + " " + n]);
    x += w;
  });
  b.appendChild(g);
  b.appendChild(legend(items));
  b.appendChild(el("div", { cls: "tiles" }, [
    rateTile("Clean", r.clean, "no third party hurt either side"),
    rateTile("Disengage", r.disengage, "8 s with no trade"),
    rateTile("Third party", r.thirdParty, "a third fighter took the kill"),
    rateTile("Comeback", r.comeback, "the lower-power side won"),
    rateTile("First striker wins", r.firstStrikerWins, "of duels with a winner"),
    tile("Median duel", fixed(r.medianDurationS, 1) + " s", r.n + " duels")
  ]));
}
function rateTile(k, c, s) {
  var t = tile(k, pct(c.rate), "n " + c.n + " · " + pct(c.lo, 0) + "–" + pct(c.hi, 0) + (s ? " · " + s : ""), c.n < SMALL_N);
  t.setAttribute("data-tip", k + "\n" + ciText(c));
  return t;
}

var offerSort = { key: "offered", dir: -1 };
function renderOffers(env) {
  var t = tools("v-offers");
  clear(t);
  t.appendChild(segmented("Kind", [["augment", "Augments"], ["stat", "Stat boosts"], ["trophy", "Trophies"]], state.kind, function (v) { state.kind = v; writeUrl(); reloadPanel("offers"); }));
  var b = body("v-offers");
  var rows = env.rows.slice();
  if (!rows.length) { emptyNote(b); return; }
  var kind = state.kind;
  var val = {
    option: function (r) { return optionLabel(kind, r.option).toLowerCase(); },
    offered: function (r) { return r.offered; },
    pick: function (r) { return r.pick.rate; },
    winPicked: function (r) { return r.winPicked.rate; },
    winNotPicked: function (r) { return r.winNotPicked.rate; },
    delta: function (r) { return r.winPicked.rate - r.winNotPicked.rate; },
    duelWin: function (r) { return r.duelWin ? r.duelWin.rate : -1; }
  };
  rows.sort(function (a, c) {
    var x = val[offerSort.key](a), y = val[offerSort.key](c);
    return (x < y ? -1 : x > y ? 1 : 0) * offerSort.dir;
  });
  var maxWin = niceMax(Math.max.apply(null, rows.map(function (r) { return Math.max(r.winPicked.hi, r.winNotPicked.hi); })));
  var cols = [["option", "Option"], ["offered", "Offered"], ["pick", "Pick rate"], ["winPicked", "Run win: picked vs not picked"], ["delta", "Δ win"]];
  if (kind === "augment") cols.push(["duelWin", "Clean duel win"]);
  var head = el("tr");
  cols.forEach(function (c) {
    var th = el("th", { cls: "sortable" + (c[0] === "option" || c[0] === "winPicked" ? "" : " n") + (c[0] === "duelWin" || c[0] === "delta" || c[0] === "offered" ? " hide-sm" : ""), text: c[1], tabindex: "0",
      "aria-sort": offerSort.key === c[0] ? (offerSort.dir > 0 ? "ascending" : "descending") : null });
    var go = function () { if (offerSort.key === c[0]) offerSort.dir = -offerSort.dir; else { offerSort.key = c[0]; offerSort.dir = c[0] === "option" ? 1 : -1; } safeRender(panelOf("offers")); };
    th.addEventListener("click", go);
    th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    head.appendChild(th);
  });
  var tb = el("tbody");
  rows.forEach(function (r) {
    var both = sv("svg", { viewBox: "0 0 200 30", cls: "chart", height: 30, "aria-hidden": "true", preserveAspectRatio: "xMinYMid meet" });
    var gp = rateGlyph(r.winPicked, maxWin, "c1"); gp.removeAttribute("class"); gp.setAttribute("y", "0"); gp.setAttribute("height", "15"); gp.setAttribute("width", "200");
    var gn = rateGlyph(r.winNotPicked, maxWin, "cg"); gn.removeAttribute("class"); gn.setAttribute("y", "15"); gn.setAttribute("height", "15"); gn.setAttribute("width", "200");
    both.appendChild(gp); both.appendChild(gn);
    var d = r.winPicked.rate - r.winNotPicked.rate;
    var small = r.pick.n < SMALL_N || r.winPicked.n < SMALL_N;
    var cells = [
      el("td", { text: optionLabel(kind, r.option), title: r.option }),
      el("td", { cls: "n hide-sm", text: String(r.offered) }),
      rateCellTd(r.pick),
      el("td", { cls: "chart", "data-tip": "Picked: " + ciText(r.winPicked) + "\nOffered, not picked: " + ciText(r.winNotPicked) }, both),
      el("td", { cls: "n hide-sm", text: (d >= 0 ? "+" : "") + (d * 100).toFixed(1) + " pt", "data-tip": "Run win rate of pickers minus that of those offered it who did not pick it" })
    ];
    if (kind === "augment") cells.push(r.duelWin ? rateCellTd(r.duelWin) : el("td", { cls: "n", text: "–" }));
    if (kind === "augment") cells[cells.length - 1].setAttribute("class", "n hide-sm");
    tb.appendChild(el("tr", { cls: small ? "small" : null }, cells));
  });
  b.appendChild(el("div", { cls: "scroll" }, el("table", { cls: "t" }, [el("thead", null, head), tb])));
  b.appendChild(legend([["c1", "picked"], ["cg", "offered, not picked"]]));
  b.appendChild(el("p", { cls: "note", text: "Offered = eligible player-offers that showed the option. Not picked = picked another option, skipped, or never chose." +
    (kind === "augment" ? " Clean duel win = clean kill duels won by a side holding the augment at the start." : "") +
    (kind === "stat" ? " A crate's stat chest has no contributors: its eligible list is whoever stood in range." : "") +
    (kind === "trophy" ? " Trophies are grouped by stat (their gain varies)." : "") }));
}

function renderFarming(env) {
  var b = body("v-farming");
  var rows = env.rows.slice().sort(function (a, c) { return FACTIONS.indexOf(a.faction) - FACTIONS.indexOf(c.faction); });
  if (!rows.length) { emptyNote(b); return; }
  b.appendChild(lineChart(b, rows, "powerAt", "Card power", 1));
  b.appendChild(lineChart(b, rows, "mobStatsAt", "Mob stat stacks", 1));
  b.appendChild(legend(rows.map(function (r) { return [fClass(r.faction), fLabel(r.faction)]; })));
  var tb = el("tbody");
  rows.forEach(function (r) {
    tb.appendChild(el("tr", { cls: r.players < SMALL_N ? "small" : null }, [
      el("td", null, [swatch(fClass(r.faction)), fLabel(r.faction)]), el("td", { cls: "n", text: String(r.players) }),
      el("td", { cls: "n", text: fixed(r.avgMobKills, 1) }), el("td", { cls: "n", text: fixed(r.avgEliteKills, 2) }), el("td", { cls: "n", text: mmss(r.avgFarmS) })
    ]));
  });
  b.appendChild(el("div", { cls: "scroll" }, el("table", { cls: "t" }, [
    el("thead", null, el("tr", null, [el("th", { text: "Faction" }), el("th", { cls: "n", text: "Players" }), el("th", { cls: "n", text: "Mobs / run" }), el("th", { cls: "n", text: "Elites" }), el("th", { cls: "n", text: "Farming" })])),
    tb
  ])));
  b.appendChild(el("p", { cls: "note", text: "Means over players standing at each minute (a player down by then has no point). Farming = seconds with mob contact in the last 3 s." }));
}
function lineChart(container, rows, key, title, digits) {
  var W = widthOf(container, 460), H = 190, L = 34, R = 84, T = 22, B = 24;
  var vals = [];
  rows.forEach(function (r) { r[key].forEach(function (v) { if (v !== null && v !== undefined) vals.push(v); }); });
  var max = niceMax(Math.max.apply(null, vals.concat([1])));
  // the minute axis ends at the last minute anyone reached, so short runs do not leave an empty right half
  var lastIdx = 1;
  rows.forEach(function (r) { r[key].forEach(function (v, i) { if (v !== null && v !== undefined && i > lastIdx) lastIdx = i; }); });
  var minutes = SNAP_MINUTES.slice(0, lastIdx + 1);
  var minM = minutes[0], maxM = minutes[minutes.length - 1];
  var x = function (m) { return L + (W - L - R) * (m - minM) / (maxM - minM); };
  var y = function (v) { return T + (H - T - B) * (1 - v / max); };
  var g = sv("svg", { cls: "chart", width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": title + " by minute and faction" });
  g.appendChild(sv("text", { x: 0, y: 12, cls: "ink", text: title }));
  for (var i = 0; i <= 4; i++) {
    var v = max * i / 4, yy = y(v);
    g.appendChild(sv("line", { x1: L, x2: W - R, y1: yy, y2: yy, cls: i === 0 ? "axis" : "grid" }));
    g.appendChild(sv("text", { x: L - 6, y: yy + 4, "text-anchor": "end", text: fixed(v, v % 1 === 0 ? 0 : 1) }));
  }
  minutes.forEach(function (m) { g.appendChild(sv("text", { x: x(m), y: H - 6, "text-anchor": "middle", text: m + " min" })); });
  var ends = [];
  rows.forEach(function (r) {
    var cls = fClass(r.faction);
    var pts = [];
    r[key].forEach(function (v, i) { if (v !== null && v !== undefined) pts.push([x(SNAP_MINUTES[i]), y(v), v, SNAP_MINUTES[i]]); });
    if (!pts.length) return;
    if (pts.length > 1) g.appendChild(sv("polyline", { points: pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "), cls: "line " + cls, fill: "none" }));
    pts.forEach(function (p) {
      g.appendChild(sv("circle", { cx: p[0], cy: p[1], r: 4, cls: "dot " + cls }));
      g.appendChild(sv("circle", { cx: p[0], cy: p[1], r: 11, cls: "hit", "data-tip": fLabel(r.faction) + " at " + p[3] + " min: " + fixed(p[2], digits) }));
    });
    var last = pts[pts.length - 1];
    ends.push({ y: last[1], x: last[0], label: fLabel(r.faction), cls: cls });
  });
  ends.sort(function (a, c) { return a.y - c.y; });
  for (var k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 12) ends[k].y = ends[k - 1].y + 12;
  ends.forEach(function (e) {
    g.appendChild(sv("text", { x: Math.min(W - R + 8, e.x + 8), y: e.y + 4, cls: "ink", text: e.label }));
  });
  return g;
}

function renderCamps(env) {
  var t = tools("v-camps");
  clear(t);
  t.appendChild(segmented("Killer", [["faction", "By faction"], ["weapon", "By weapon"]], state.by, function (v) { state.by = v; writeUrl(); reloadPanel("camps"); }));
  var b = body("v-camps");
  var rows = env.rows;
  if (!rows.length) { emptyNote(b); return; }
  // per camp type: clears, median clear (clear-weighted), deaths; then the split by killer
  var byType = {};
  rows.forEach(function (r) {
    var k = r.type + "|" + r.elite;
    var e = byType[k] || (byType[k] = { type: r.type, elite: r.elite, clears: 0, deaths: 0, med: 0, parts: [] });
    e.clears += r.clears; e.deaths += r.playerDeaths; e.med += r.medianClearS * r.clears; e.parts.push(r);
  });
  var types = Object.keys(byType).map(function (k) { var e = byType[k]; e.med = e.clears ? e.med / e.clears : 0; return e; });
  types.sort(function (a, c) { return c.clears - a.clears; });
  var maxMed = niceMax(Math.max.apply(null, types.map(function (e) { return e.med; })));
  var tb = el("tbody");
  types.slice(0, 40).forEach(function (e) {
    var W = 200, H = 14;
    var g = sv("svg", { viewBox: "0 0 " + W + " " + H, cls: "chart", height: H, "aria-hidden": "true", preserveAspectRatio: "xMinYMid meet" });
    g.appendChild(sv("rect", { x: 0, y: 3, width: W * Math.min(1, e.med / maxMed), height: 8, rx: 4, cls: "bar " + (e.elite ? "c2" : "c1") }));
    var split = e.parts.slice().sort(function (a, c) { return c.clears - a.clears; }).map(function (p) {
      return (state.by === "faction" ? fLabel(p.faction) : wLabel(p.weapon)) + " " + p.clears + " (" + fixed(p.medianClearS, 1) + " s)";
    });
    tb.appendChild(el("tr", { cls: e.clears < SMALL_N ? "small" : null }, [
      el("td", { text: camel(e.type) + (e.elite ? " + " + camel(e.elite) : "") }),
      el("td", { cls: "n", text: String(e.clears) }),
      el("td", { cls: "chart hide-sm", "data-tip": "Median clear " + fixed(e.med, 1) + " s (engaged to cleared)\n" + split.join("\n") }, g),
      el("td", { cls: "n", text: fixed(e.med, 1) + " s" }),
      el("td", { cls: "n", text: String(e.deaths) }),
      el("td", { cls: "hide-sm ci", text: split.slice(0, 3).join(" · ") + (split.length > 3 ? " …" : "") })
    ]));
  });
  b.appendChild(el("div", { cls: "scroll" }, el("table", { cls: "t" }, [
    el("thead", null, el("tr", null, [el("th", { text: "Camp type (+ elite)" }), el("th", { cls: "n", text: "Clears" }), el("th", { cls: "hide-sm", text: "Median clear (0 – " + maxMed + " s)" }),
      el("th", { cls: "n", text: "Clear" }), el("th", { cls: "n", text: "Player deaths" }), el("th", { cls: "hide-sm", text: "Top killers (" + state.by + ")" })])),
    tb
  ])));
  b.appendChild(legend([["c1", "normal camp"], ["c2", "elite camp"]]));
  if (types.length > 40) b.appendChild(el("p", { cls: "note", text: "Showing the 40 most cleared of " + types.length + " camp types." }));
}

function renderDeaths(env) {
  var b = body("v-deaths");
  var rows = env.rows;
  if (!rows.length) { emptyNote(b); return; }
  var per = {};
  var detail = {};
  rows.forEach(function (r) {
    var f = per[r.faction] || (per[r.faction] = { total: 0 });
    f[r.kind] = (f[r.kind] || 0) + r.n;
    f.total += r.n;
    if (r.detail) { var dk = r.kind + "|" + r.detail; detail[dk] = (detail[dk] || 0) + r.n; }
  });
  var facs = FACTIONS.filter(function (f) { return per[f]; });
  var W = widthOf(b, 460), rowH = 26, L = 96, H = facs.length * rowH + 6;
  var g = sv("svg", { cls: "chart", width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Deaths by cause per victim faction" });
  var used = {};
  facs.forEach(function (f, i) {
    var p = per[f], x = L, y = i * rowH + 3;
    g.appendChild(sv("text", { x: L - 8, y: y + 15, "text-anchor": "end", cls: "ink", text: fLabel(f) }));
    DEATH_KINDS.forEach(function (k, j) {
      var n = p[k] || 0;
      if (!n) return;
      var w = (W - L - 40) * n / p.total;
      used[k] = 1;
      g.appendChild(sv("rect", { x: x, y: y, width: Math.max(1, w - 2), height: 20, rx: 3, cls: "bar c" + (j + 1), "data-tip": fLabel(f) + " deaths: " + DEATH_LABEL[k] + " " + n + " of " + p.total + " (" + pct(n / p.total) + ")" }));
      if (w > 40) g.appendChild(sv("text", { x: x + 5, y: y + 14, cls: "ink", text: pct(n / p.total, 0) }));
      x += w;
    });
    g.appendChild(sv("text", { x: W - 34, y: y + 15, text: "n " + p.total }));
  });
  b.appendChild(g);
  b.appendChild(legend(DEATH_KINDS.filter(function (k) { return used[k]; }).map(function (k) { return ["c" + (DEATH_KINDS.indexOf(k) + 1), DEATH_LABEL[k]]; })));
  var top = Object.keys(detail).map(function (k) { var p = k.split("|"); return { kind: p[0], detail: p[1], n: detail[k] }; })
    .sort(function (a, c) { return c.n - a.n; }).slice(0, 8);
  if (top.length) {
    var tb = el("tbody");
    top.forEach(function (d) {
      tb.appendChild(el("tr", null, [el("td", { text: DEATH_LABEL[d.kind] || d.kind }), el("td", { text: d.kind === "mob" ? camel(d.detail) : fLabel(d.detail) }), el("td", { cls: "n", text: String(d.n) })]));
    });
    b.appendChild(el("div", { cls: "scroll" }, el("table", { cls: "t" }, [el("thead", null, el("tr", null, [el("th", { text: "Top killers" }), el("th", { text: "Mob type or killer faction" }), el("th", { cls: "n", text: "Deaths" })])), tb])));
  }
}

function renderFirstBlood(env) {
  var b = body("v-firstblood");
  var bins = env.rows;
  var total = bins.reduce(function (s, x) { return s + x.n; }, 0);
  if (!total) { emptyNote(b, "No first blood in this filter."); return; }
  var W = widthOf(b, 460), H = 170, L = 30, T = 10, B = 24;
  var max = niceMax(Math.max.apply(null, bins.map(function (x) { return x.n; })));
  var bw = (W - L) / bins.length;
  var g = sv("svg", { cls: "chart", width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "First blood time histogram" });
  for (var i = 0; i <= 4; i++) {
    var yy = T + (H - T - B) * (1 - i / 4);
    g.appendChild(sv("line", { x1: L, x2: W, y1: yy, y2: yy, cls: i === 0 ? "axis" : "grid" }));
    g.appendChild(sv("text", { x: L - 6, y: yy + 4, "text-anchor": "end", text: fixed(max * i / 4, 0) }));
  }
  bins.forEach(function (bin, i) {
    var h = (H - T - B) * bin.n / max;
    var x = L + i * bw;
    var last = i === bins.length - 1;
    if (bin.n) g.appendChild(sv("rect", { x: x + 1, y: H - B - h, width: Math.max(1, bw - 2), height: h, rx: 2, cls: "bar " + (last ? "cg" : "c1") }));
    g.appendChild(sv("rect", { x: x, y: T, width: bw, height: H - T - B, cls: "hit", "data-tip": (last ? "after " + mmss(bin.fromS) : mmss(bin.fromS) + " – " + mmss(bin.toS)) + ": " + bin.n + " runs (" + pct(bin.n / total) + ")" }));
    if (bin.fromS % 60 === 0 || last) g.appendChild(sv("text", { x: x + (last ? bw / 2 : 0), y: H - 6, "text-anchor": last ? "middle" : "start", text: last ? "5+" : (bin.fromS / 60) + "m" }));
  });
  b.appendChild(g);
  b.appendChild(el("p", { cls: "note", text: "Seconds from the run start to the first player down (15 s bins; the grey bar is everything after 5 minutes). " + total + " runs." }));
}

function renderPerf(env) {
  var b = body("v-perf");
  var r = env.rows[0];
  if (!r) { emptyNote(b); return; }
  b.appendChild(el("div", { cls: "tiles" }, [
    tile("Client samples", String(r.samples), "one per human run", r.samples < SMALL_N),
    tile("FPS p50", fixed(r.fpsP50, 0), "median over samples", r.samples < SMALL_N),
    tile("Frame p95", fixed(r.frameMsP95, 1) + " ms", null, r.samples < SMALL_N),
    tile("RTT p50 / p95", fixed(r.rttP50, 0) + " / " + fixed(r.rttP95, 0) + " ms", null, r.samples < SMALL_N),
    tile("Reconnects per run", fixed(r.reconnectsPerRun, 2), null),
    rateTile("AFK", r.afk, "30 s+ with no input"),
    rateTile("Quit", r.quit, "left mid-run (MIA)")
  ]));
}

// ---- heatmaps -----------------------------------------------------------------------------------------------------------
function drawHeat(canvas, w, h, grid, max, title, unit) {
  var cssW = canvas.clientWidth || 400;
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssW * dpr);
  var ctx = canvas.getContext("2d");
  var ramp = seqRamp();
  ctx.fillStyle = rgbStr(ramp[0]);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  var cw = canvas.width / w, ch = canvas.height / h;
  var lmax = Math.log1p(max || 1);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var v = grid[y * w + x];
    if (!v) continue;
    ctx.fillStyle = rgbStr(seqColor(ramp, 0.15 + 0.85 * Math.log1p(v) / lmax));
    ctx.fillRect(Math.floor(x * cw), Math.floor(y * ch), Math.ceil(cw), Math.ceil(ch));
  }
  canvas.addEventListener("pointermove", function (e) {
    var rect = canvas.getBoundingClientRect();
    var cx = Math.floor((e.clientX - rect.left) / rect.width * w), cy = Math.floor((e.clientY - rect.top) / rect.height * h);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return;
    canvas.setAttribute("data-tip", title + "\ncell " + cx + ", " + cy + ": " + (grid[cy * w + cx] || 0) + " " + unit);
  });
}
function heatScale(max, unit) {
  var sc = el("canvas", { width: 160, height: 10, "aria-hidden": "true" });
  var ctx = sc.getContext("2d");
  var ramp = seqRamp();
  for (var i = 0; i < 160; i++) { ctx.fillStyle = rgbStr(seqColor(ramp, i / 159)); ctx.fillRect(i, 0, 1, 10); }
  return el("div", { cls: "scale" }, [el("span", { text: "0" }), sc, el("span", { text: String(max) + " " + unit + " (log scale)" })]);
}
function renderHeatmap(env) {
  var t = tools("v-heatmap");
  clear(t);
  var runs = cache.runs && cache.runs.rows ? cache.runs.rows : [];
  var pick = el("select", { "aria-label": "Open one run's heatmap" });
  pick.appendChild(el("option", { value: "", text: "Cross-run heatmap only" }));
  runs.forEach(function (r) {
    pick.appendChild(el("option", { value: r.runId, text: new Date(r.endedAtEpoch).toISOString().slice(0, 16).replace("T", " ") + " · " + mmss(r.durationS) + " · " + r.humans + "h/" + r.bots + "b · " + r.runId.slice(0, 8) }));
  });
  pick.value = selectedRun;
  pick.addEventListener("change", function () { selectedRun = pick.value; safeRender(panelOf("heatmap")); });
  t.appendChild(el("label", { cls: "lbl" }, ["Run ", pick]));
  var b = body("v-heatmap");
  var wrap = el("div", { cls: "heatwrap" + (selectedRun ? " two" : "") });
  b.appendChild(wrap);
  var w = env.w, h = env.h;
  var grid = new Float64Array(w * h), max = 0;
  env.cells.forEach(function (c) { if (c[0] < w && c[1] < h) { grid[c[1] * w + c[0]] += c[2]; max = Math.max(max, grid[c[1] * w + c[0]]); } });
  var box = el("div", { cls: "heat" });
  box.appendChild(el("h3", { text: "All runs in the filter (" + env.runs + " runs, " + w + " x " + h + " cells)" }));
  var cv = el("canvas", { role: "img", "aria-label": "Cross-run position heatmap" });
  box.appendChild(cv);
  box.appendChild(heatScale(Math.round(max), "s"));
  wrap.appendChild(box);
  drawHeat(cv, w, h, grid, max, "All runs", "s standing");
  b.appendChild(el("p", { cls: "note", text: "Seconds standing per cell. Live maps use a fresh seed each run, so only the fixed coliseum (the centre) and the border line up across runs; elsewhere this is coarse. Pick a run for its exact map." }));
  if (selectedRun) {
    var rb = el("div", { cls: "heat" });
    rb.appendChild(el("h3", { text: "Run " + selectedRun.slice(0, 8) + " (136 x 136 tiles)" }));
    var rc = el("canvas", { role: "img", "aria-label": "One run's position heatmap" });
    rb.appendChild(rc);
    var info = el("p", { cls: "note", text: "Loading the run…" });
    rb.appendChild(info);
    wrap.appendChild(rb);
    var id = selectedRun;
    api(API.run + encodeURIComponent(id), null, true).then(function (rec) {
      if (selectedRun !== id) return;
      var N = 136, g2 = new Float64Array(N * N), m2 = 0;
      (rec.players || []).forEach(function (p) {
        var bytes = decodeTiles(p.tiles);
        if (!bytes) return;
        for (var i = 0; i + 1 < bytes.length; i += 2) {
          if (bytes[i] === 255 || bytes[i] >= N || bytes[i + 1] >= N) continue;
          var k = bytes[i + 1] * N + bytes[i];
          g2[k] += 1;
          if (g2[k] > m2) m2 = g2[k];
        }
      });
      drawHeat(rc, N, N, g2, m2, "Run " + id.slice(0, 8), "s standing");
      var winner = (rec.players || []).filter(function (p) { return p.slot === rec.winnerSlot; })[0];
      info.textContent = "Seed " + rec.seed + " attempt " + rec.attempt + " · " + mmss(rec.durationMs / 1000) + " · " + rec.end +
        (winner ? " · won by " + fLabel(winner.faction) + (winner.bot ? " (bot)" : "") : "") + " · " + (rec.duels || []).length + " duels";
      rb.appendChild(heatScale(Math.round(m2), "s"));
    }, function (err) {
      if (err instanceof Unauthorized) { showLogin(); return; }
      info.textContent = "Could not load the run: " + (err && err.message ? err.message : String(err));
    });
  }
}
function decodeTiles(s) {
  if (typeof s !== "string" || !s) return null;
  try {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) { return null; }
}

function renderRuns(env) {
  var b = body("v-runs");
  var rows = env.rows;
  if (!rows.length) { emptyNote(b); return; }
  var tb = el("tbody");
  rows.forEach(function (r) {
    var tr = el("tr", { cls: "click", tabindex: "0", title: "Open this run's heatmap" }, [
      el("td", { text: new Date(r.endedAtEpoch).toISOString().slice(0, 16).replace("T", " ") }),
      el("td", { cls: "n", text: mmss(r.durationS) }),
      el("td", { cls: "n", text: r.humans + " / " + r.bots }),
      el("td", { text: r.end }),
      el("td", null, r.winnerFaction ? [swatch(fClass(r.winnerFaction)), fLabel(r.winnerFaction)] : "–"),
      el("td", { cls: "hide-sm", text: r.source }),
      el("td", { cls: "hide-sm ci", text: r.build.length > 16 ? r.build.slice(0, 12) : r.build, "data-tip": r.build }),
      el("td", { cls: "hide-sm ci", text: r.runId.slice(0, 8) })
    ]);
    var open = function () { selectedRun = r.runId; safeRender(panelOf("heatmap")); $("v-heatmap").scrollIntoView({ behavior: "smooth", block: "start" }); };
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", function (e) { if (e.key === "Enter") open(); });
    tb.appendChild(tr);
  });
  b.appendChild(el("div", { cls: "scroll" }, el("table", { cls: "t" }, [
    el("thead", null, el("tr", null, [el("th", { text: "Ended (UTC)" }), el("th", { cls: "n", text: "Length" }), el("th", { cls: "n", text: "Humans / bots" }), el("th", { text: "End" }),
      el("th", { text: "Winner" }), el("th", { cls: "hide-sm", text: "Source" }), el("th", { cls: "hide-sm", text: "Build" }), el("th", { cls: "hide-sm", text: "Run" })])),
    tb
  ])));
  if (cache.heatmap) safeRender(panelOf("heatmap"));
}

// ---- wiring ---------------------------------------------------------------------------------------------------------------
var THEMES = ["auto", "light", "dark"];
function applyTheme(t) {
  if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
  $("theme").textContent = "Theme: " + t;
}
function initTheme() {
  var t = "auto";
  try { t = localStorage.getItem("rh-stats-theme") || "auto"; } catch (e) { /* storage blocked */ }
  if (THEMES.indexOf(t) < 0) t = "auto";
  applyTheme(t);
  $("theme").addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme") || "auto";
    var next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    applyTheme(next);
    try { localStorage.setItem("rh-stats-theme", next); } catch (e) { /* storage blocked */ }
    rerenderAll();
  });
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: light)");
    if (mq.addEventListener) mq.addEventListener("change", rerenderAll);
  }
}
function initFilters() {
  var map = { "f-build": "build", "f-from": "from", "f-to": "to", "f-pool": "pool", "f-source": "source", "f-faction": "faction", "f-weapon": "weapon" };
  Object.keys(map).forEach(function (id) {
    $(id).addEventListener("change", function () {
      state[map[id]] = $(id).value;
      writeUrl();
      cache = {};
      loadAll();
    });
  });
  $("filters").addEventListener("submit", function (e) { e.preventDefault(); });
  $("f-reset").addEventListener("click", function () {
    for (var i = 0; i < FILTER_KEYS.length; i++) state[FILTER_KEYS[i]] = DEFAULTS[FILTER_KEYS[i]];
    syncFilters();
    writeUrl();
    cache = {};
    loadAll();
  });
  $("refresh").addEventListener("click", function () { loadAll(); });
}
var resizeTimer = 0;
function init() {
  initTips();
  initTheme();
  initFilters();
  syncFilters();
  window.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(rerenderAll, 150); });
  loadAll();
  timer = setInterval(function () { if (!document.hidden && $("login").hidden) loadAll(); }, REFRESH_MS);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
`;
}
