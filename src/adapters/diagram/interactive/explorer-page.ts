// One self-contained HTML page for the state explorer: the vendored Cytoscape builds, the client, and the payload
// are inlined, so the file can be opened from disk or sent to someone as it is. No CDN, no server.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExplorerPageWriter } from '../../../application/projection.js';
import type { ExplorerPayload } from '../../../domain/state-graph.js';
import { INTERACTIVE_GRAPH_VENDOR_FILES } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
export const STATE_EXPLORER_CLIENT_FILE = 'clew-state-explorer.js';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A script body must not hold `</script`, and JSON in a script must not either. */
function inlineScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script');
}

export function explorerHtml(payload: ExplorerPayload, version: string): string {
  const scripts = [...INTERACTIVE_GRAPH_VENDOR_FILES.map((file) => join(here, 'vendor', file)), join(here, 'client', STATE_EXPLORER_CLIENT_FILE)]
    .map((file) => `<script>\n${inlineScript(readFileSync(file, 'utf8'))}\n</script>`)
    .join('\n');
  const hides = payload.fullStates > payload.states.length;
  const summary = `${payload.states.length} states, ${payload.edges.length} steps${hides ? `, projected from ${payload.fullStates} states and ${payload.fullEdges} steps; ${Math.round(payload.exactness * 100)}% of the steps are certain` : ''}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(payload.title)}</title>
<style>
:root { --ink: #111827; --muted: #5b6472; --line: #d6d9df; --panel: #ffffff; --bg: #f3f4f6; --walk: #c2410c; --next: #0f766e; }
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; font: 14px/1.45 Helvetica, Arial, sans-serif; color: var(--ink); background: var(--bg); display: flex; flex-direction: column; }
header { padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: baseline; }
header h1 { margin: 0; font-size: 16px; }
header .summary { color: var(--muted); font-size: 12px; }
header .tools { margin-left: auto; display: flex; gap: 8px; }
header input { font: inherit; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; width: 190px; }
.legend { padding: 6px 16px; font-size: 12px; color: var(--muted); background: var(--panel); border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 4px 18px; }
.legend b { color: var(--ink); font-weight: 600; }
.swatch { display: inline-block; width: 22px; height: 0; border-top: 2px solid var(--muted); vertical-align: middle; margin-right: 5px; }
.swatch.dashed { border-top-style: dashed; }
.swatch.walk { border-top: 3px solid var(--walk); }
.swatch.next { border-top: 3px solid var(--next); }
main { flex: 1; min-height: 0; display: flex; }
[data-explorer-canvas] { flex: 1; min-width: 0; background: #ffffff; }
[data-explorer-panel] { width: 360px; max-width: 45vw; overflow-y: auto; padding: 4px 14px 20px; background: var(--panel); border-left: 1px solid var(--line); }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 16px 0 6px; }
table.values { border-collapse: collapse; width: 100%; }
table.values th { text-align: left; font-weight: 500; color: var(--muted); padding: 2px 10px 2px 0; vertical-align: top; }
table.values td { padding: 2px 0; font-weight: 600; }
.facts, .empty { color: var(--muted); font-size: 12px; margin: 6px 0 0; }
button { font: inherit; cursor: pointer; }
button.action { display: block; width: 100%; text-align: left; margin: 0 0 6px; padding: 7px 9px; background: #f7f8fa; border: 1px solid var(--line); border-left: 4px solid var(--next); border-radius: 6px; }
button.action.possible { border-left-style: dashed; }
button.action:hover { background: #ecfdf5; }
.action-name { font-weight: 600; }
.action-target { color: var(--muted); margin-left: 6px; }
.action-note, .action-text { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; }
.action-text { color: #374151; }
.controls { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
button.control { padding: 4px 9px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; }
button.control:disabled { opacity: 0.45; cursor: default; }
ol.walk { margin: 0; padding-left: 22px; }
ol.walk li { cursor: pointer; padding: 1px 0; }
.walk-start { color: var(--muted); margin: 0 0 2px; }
footer { padding: 4px 16px; font-size: 11px; color: var(--muted); background: var(--panel); border-top: 1px solid var(--line); }
@media (max-width: 760px) { main { flex-direction: column; } [data-explorer-panel] { width: auto; max-width: none; border-left: 0; border-top: 1px solid var(--line); max-height: 50vh; } }
</style>
</head>
<body>
<div id="explorer" style="display: contents">
<header>
  <h1>${escapeHtml(payload.title)}</h1>
  <span class="summary">${escapeHtml(summary)}</span>
  <span class="tools"><input type="search" placeholder="Find a state" aria-label="Find a state" data-explorer-search><button type="button" class="control" data-explorer-fit>Fit</button></span>
</header>
<div class="legend">
  <span><b>Click</b> a next action, or a state, to walk the model.</span>
  <span><span class="swatch"></span>certain step</span>
  <span><span class="swatch dashed"></span>possible step: waits on a hidden variable</span>
  <span><span class="swatch walk"></span>the walk so far</span>
  <span><span class="swatch next"></span>possible next</span>
  <span>double border: no step leaves</span>
</div>
<main>
  <div data-explorer-canvas></div>
  <aside data-explorer-panel></aside>
</main>
<footer>Clew ${escapeHtml(version)} state explorer. The graph is TLC's state dump, projected onto ${escapeHtml(payload.variables.join(', '))}.</footer>
</div>
${scripts}
<script type="application/json" id="explorer-data">${inlineScript(JSON.stringify(payload))}</script>
<script>
window.clewExplorer = window.ClewStateExplorer.mount(JSON.parse(document.getElementById('explorer-data').textContent), document.getElementById('explorer'));
</script>
</body>
</html>
`;
}

export function explorerPageWriter(version: () => string): ExplorerPageWriter {
  return {
    write(file, payload) {
      if (!existsSync(dirname(resolve(file)))) return { ok: false, message: `cannot write ${file}: directory does not exist` };
      try {
        writeFileSync(file, explorerHtml(payload, version()));
        return { ok: true };
      } catch (error) {
        return { ok: false, message: `cannot write ${file}: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  };
}
