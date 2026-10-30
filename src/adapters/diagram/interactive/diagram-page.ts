// Standalone HTML host for chart/workflows view. Mounts window.ClewInteractiveGraph (same path as the Graph tab).
import { interactiveGraphScriptTags } from './assets.js';

export const DIAGRAM_VIEWER_FILE = 'viewer.html';
export const DIAGRAM_JSON_FILE = 'diagram.json';

export function diagramViewerHtml(version: string): string {
  const scripts = interactiveGraphScriptTags();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clew diagram</title>
<style>
:root {
  --bg: #f6f4ef;
  --ink: #1c1917;
  --muted: #57534e;
  --line: #d6d3d1;
  --panel: #ffffff;
  --accent: #0f766e;
  --mono: "IBM Plex Mono", "ui-monospace", "Cascadia Code", monospace;
  --sans: "Source Sans 3", "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font: 15px/1.45 var(--sans);
  color: var(--ink);
  background:
    radial-gradient(1200px 500px at 10% -10%, #d8f3ef 0%, transparent 55%),
    linear-gradient(180deg, #efeae2 0%, var(--bg) 40%, #f3f1ec 100%);
  min-height: 100vh;
}
header {
  padding: 1.25rem 1.5rem 0.85rem;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 2;
}
header .brand {
  margin: 0;
  font: 700 1.35rem/1.2 var(--sans);
  letter-spacing: -0.02em;
}
header .brand .version { font: 500 0.8rem var(--mono); color: var(--muted); margin-left: 0.3rem; }
header h1 { margin: 0.35rem 0 0; font: 600 1rem/1.3 var(--sans); }
header p { margin: 0.2rem 0 0; color: var(--muted); font-size: 0.88rem; }
main { padding: 1.25rem 1.5rem 2rem; max-width: 1100px; }
main > h2 { margin: 1.25rem 0 0.65rem; font: 700 1.05rem/1.3 var(--sans); }
main > h2:first-child { margin-top: 0; }
.empty { color: var(--muted); margin: 0.5rem 0; }
.graph-block { margin: 0 0 1.25rem; }
.graph-block-head {
  display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: baseline;
  margin: 0 0 0.45rem;
}
.graph-block-head h3 { margin: 0; font: 600 0.95rem/1.3 var(--sans); }
.graph-block-head .expect { font: 500 0.78rem var(--mono); color: var(--muted); }
.graph-stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(12rem, 18rem);
  gap: 0.75rem;
  align-items: stretch;
}
@media (max-width: 900px) {
  .graph-stage { grid-template-columns: 1fr; }
}
.graph-canvas-wrap {
  border: 1px solid var(--line);
  border-radius: 0.4rem;
  background: linear-gradient(180deg, #fbfaf7 0%, #f3f1ec 100%);
  min-height: 280px;
  height: 360px;
  position: relative;
}
.graph-cy { width: 100%; height: 100%; }
.graph-detail {
  border: 1px solid var(--line);
  border-radius: 0.4rem;
  background: #fbfaf7;
  padding: 0.75rem 0.85rem;
  font-size: 0.88rem;
  overflow: auto;
  max-height: 360px;
}
.graph-detail[hidden] { display: none; }
.graph-detail-placeholder { color: var(--muted); margin: 0; }
.graph-detail-head { display: flex; flex-wrap: wrap; gap: 0.35rem 0.6rem; align-items: baseline; }
.graph-detail-kind { font: 500 0.75rem var(--mono); color: var(--muted); }
.graph-detail-summary { margin: 0.45rem 0 0; padding-left: 1.1rem; }
.graph-detail-condition, .graph-detail-sentence, .graph-detail-empty { margin: 0.5rem 0 0; }
.graph-detail .k { font: 600 0.72rem var(--mono); color: var(--accent); text-transform: uppercase; letter-spacing: 0.04em; margin-right: 0.35rem; }
.graph-detail-lineage { margin-top: 0.55rem; }
.graph-detail-lineage ul { margin: 0.25rem 0 0; padding-left: 1.1rem; }
</style>
</head>
<body>
<header>
  <p class="brand">Clew<span class="version" id="clew-version">${escapeHtml(version)}</span></p>
  <h1 id="page-title">Diagram</h1>
  <p id="page-sub">Pan and zoom. Hover a state or transition for details.</p>
</header>
<main id="diagram-root">
  <p class="empty">Loading diagram…</p>
</main>
${scripts}
<script>
(function () {
  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadJson(name) {
    return fetch(name, { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status + " for " + name);
      return response.json();
    });
  }

  function render(doc) {
    var root = document.getElementById("diagram-root");
    var title = document.getElementById("page-title");
    var charts = doc.charts || [];
    var workflows = doc.workflows || [];
    var bits = [];
    if (doc.chartFile) bits.push(doc.chartFile);
    if (doc.workflowsFile) bits.push(doc.workflowsFile);
    title.textContent = bits.length > 0 ? bits.join(" · ") : "Diagram";
    var html = "";
    if (charts.length > 0) {
      html += "<h2>State chart</h2>";
      charts.forEach(function (chart, index) {
        var alt = "State chart of " + chart.object;
        html += '<article class="graph-block" data-graph-kind="chart" data-graph-object="' + esc(chart.object) + '">';
        html += '<div class="graph-block-head"><h3>' + esc(chart.object) + "</h3></div>";
        html += '<div class="graph-stage">';
        html += '<div class="graph-canvas-wrap" data-graph-mount="chart-' + index + '" aria-label="' + esc(alt) + '"></div>';
        html += '<aside class="graph-detail" data-graph-detail="chart-' + index +
          '" hidden><p class="graph-detail-placeholder">Hover a node or edge for details.</p></aside>';
        html += "</div></article>";
      });
    }
    if (workflows.length > 0) {
      html += "<h2>Workflows</h2>";
      workflows.forEach(function (flow, index) {
        var alt = flow.id + ": " + flow.title;
        html += '<article class="graph-block" data-graph-kind="workflow" data-graph-id="' + esc(flow.id) + '">';
        html += '<div class="graph-block-head"><h3>' + esc(flow.id) + ": " + esc(flow.title) + "</h3>";
        html += '<span class="expect">' + esc(flow.expect || "") + "</span></div>";
        html += '<div class="graph-stage">';
        html += '<div class="graph-canvas-wrap" data-graph-mount="workflow-' + index + '" aria-label="' + esc(alt) + '"></div>';
        html += '<aside class="graph-detail" data-graph-detail="workflow-' + index +
          '" hidden><p class="graph-detail-placeholder">Hover a node or edge for details.</p></aside>';
        html += "</div></article>";
      });
    }
    if (charts.length === 0 && workflows.length === 0) {
      html = '<p class="empty">No charts or workflows to show.</p>';
    }
    root.innerHTML = html;
    if (!window.ClewInteractiveGraph || typeof window.ClewInteractiveGraph.mount !== "function") {
      var note = document.createElement("p");
      note.className = "empty";
      note.textContent = "Interactive graph assets failed to load. Open this page through clew chart view --open or clew workflows view --open.";
      root.prepend(note);
      return;
    }
    charts.forEach(function (chart, index) {
      var mountEl = root.querySelector('[data-graph-mount="chart-' + index + '"]');
      var detailEl = root.querySelector('[data-graph-detail="chart-' + index + '"]');
      if (!mountEl || !chart.interactive) return;
      try {
        window.ClewInteractiveGraph.mount(mountEl, chart.interactive, { detailPanel: detailEl });
      } catch (error) {
        mountEl.innerHTML = '<p class="empty">' + esc(error && error.message ? error.message : String(error)) + "</p>";
      }
    });
    workflows.forEach(function (flow, index) {
      var mountEl = root.querySelector('[data-graph-mount="workflow-' + index + '"]');
      var detailEl = root.querySelector('[data-graph-detail="workflow-' + index + '"]');
      if (!mountEl || !flow.interactive) return;
      try {
        window.ClewInteractiveGraph.mount(mountEl, flow.interactive, { detailPanel: detailEl });
      } catch (error) {
        mountEl.innerHTML = '<p class="empty">' + esc(error && error.message ? error.message : String(error)) + "</p>";
      }
    });
  }

  loadJson("${DIAGRAM_JSON_FILE}").then(render).catch(function (error) {
    var root = document.getElementById("diagram-root");
    root.innerHTML = '<p class="empty">Could not load diagram JSON. Open this page through clew chart view --open or clew workflows view --open (localhost), not as a file:// URL. ' +
      esc(error && error.message ? error.message : String(error)) + "</p>";
  });
})();
</script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
