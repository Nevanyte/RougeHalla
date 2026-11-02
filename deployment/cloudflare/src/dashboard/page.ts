// PLACEHOLDER (docs/TELEMETRY.md 11): part C replaces this file with the real dashboard. It keeps the three exports
// the Worker serves, and the same CSP rules: no inline script or style, so the shell only links /stats/app.*.
export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RougeHalla stats</title>
<link rel="stylesheet" href="/stats/app.css">
<script src="/stats/app.js" defer></script>
</head>
<body>
<h1>RougeHalla balance dashboard</h1>
<form id="login" method="post" action="/stats/login" hidden>
<label>Dashboard token <input name="token" type="password" autocomplete="current-password" required></label>
<button type="submit">Sign in</button>
</form>
<pre id="out">Loading...</pre>
</body>
</html>
`;
}

export function dashboardScript(): string {
  return String.raw`(function () {
  var out = document.getElementById("out");
  fetch("/api/stats/overview", { credentials: "same-origin" }).then(function (r) {
    if (r.status === 401) { document.getElementById("login").hidden = false; out.textContent = ""; return null; }
    return r.json();
  }).then(function (data) { if (data) out.textContent = JSON.stringify(data, null, 2); })
    .catch(function () { out.textContent = "The stats service is unavailable."; });
})();
`;
}

export function dashboardStyles(): string {
  return `body { background: #111318; color: #e8e6e3; font: 14px system-ui, sans-serif; margin: 16px; }
pre { white-space: pre-wrap; font-variant-numeric: tabular-nums; }
`;
}
