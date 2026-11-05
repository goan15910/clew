// Stable HTML shell for one spec session. Fetches sibling JSON over HTTP; no domain data baked in.
export const VIEWER_FILE = 'viewer.html';

export const VIEWER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clew spec session</title>
<style>
:root {
  --bg: #f6f4ef;
  --ink: #1c1917;
  --muted: #57534e;
  --line: #d6d3d1;
  --panel: #ffffff;
  --accent: #0f766e;
  --accent-soft: #ccfbf1;
  --warn: #b45309;
  --bad: #b91c1c;
  --ok: #15803d;
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
  padding: 1.25rem 1.5rem 0.75rem;
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
header .session-line { margin-top: 0.35rem; display: grid; gap: 0.15rem; }
header h1 {
  margin: 0;
  font: 600 1rem/1.3 var(--sans);
}
header p {
  margin: 0;
  color: var(--muted);
  font-size: 0.88rem;
}
.meta { font-family: var(--mono); font-size: 0.82rem; }
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem 1rem;
  align-items: end;
  padding: 0.85rem 1.5rem;
  border-bottom: 1px solid var(--line);
}
.tabset { margin-top: 0.25rem; }
.tabs {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
  position: relative;
  z-index: 1;
  margin-bottom: -1px;
}
.tabs button, .filters button, details summary {
  font: inherit;
  cursor: pointer;
}
.tabs button {
  border: 1px solid var(--line);
  background: #ebe7e0;
  color: var(--muted);
  padding: 0.5rem 1.1rem;
  border-radius: 0.5rem 0.5rem 0 0;
}
.tabs button:hover { color: var(--ink); }
.tabs button[aria-selected="true"] {
  background: var(--panel);
  border-bottom-color: var(--panel);
  border-top: 3px solid var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.tab-body {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 0 0.5rem 0.5rem 0.5rem;
  padding: 0.9rem;
}
.tab-body .card { background: #fcfbf9; }
.tab-body .card:last-child { margin-bottom: 0; }
.tab-body .span-group {
  margin: 0.85rem 0 0.45rem;
  font: 600 0.82rem/1.2 var(--sans);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}
.tab-body .span-group:first-child { margin-top: 0.15rem; }
.tab-body .card.skipped { opacity: 0.7; }
.filters {
  display: flex;
  max-width: 1100px;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  align-items: end;
  flex: 1;
}
.filters label {
  display: grid;
  gap: 0.2rem;
  font-size: 0.78rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.filters input, .filters select {
  font: 0.92rem var(--sans);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 0.35rem;
  padding: 0.35rem 0.5rem;
  background: var(--panel);
  min-width: 8rem;
}
.filters #filter-span { width: 15rem; }
.filters button {
  border: 1px solid var(--line);
  background: var(--panel);
  padding: 0.4rem 0.7rem;
  border-radius: 0.35rem;
  align-self: end;
}
.pager {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0.25rem 0 0.75rem;
  color: var(--muted);
  font-size: 0.85rem;
}
.pager button {
  border: 1px solid var(--line);
  background: var(--panel);
  padding: 0.25rem 0.6rem;
  border-radius: 0.35rem;
}
.pager button:disabled { opacity: 0.4; cursor: default; }
main { padding: 1rem 1.5rem 2.5rem; max-width: 1100px; }
.panel { display: none; }
.panel.active { display: block; }
.status {
  margin: 0 0 1rem;
  padding: 0.65rem 0.8rem;
  border-radius: 0.4rem;
  background: var(--accent-soft);
  color: #115e59;
  font-size: 0.9rem;
}
.status.error { background: #fee2e2; color: var(--bad); }
.status-row { display: flex; gap: 0.5rem; align-items: stretch; margin: 0 0 1rem; }
.status-row .status { margin: 0; flex: 1; }
#refresh {
  font-size: 1.1rem;
  border: 1px solid var(--line);
  background: var(--panel);
  border-radius: 0.4rem;
  padding: 0 0.7rem;
  cursor: pointer;
}
#refresh:disabled { cursor: progress; opacity: 0.6; }
#session-id {
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 0.3rem;
  padding: 0.1rem 0.3rem;
  background: var(--panel);
}
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 0.45rem;
  margin: 0 0 0.65rem;
  padding: 0.7rem 0.85rem;
}
.card h2 {
  margin: 0;
  font: 600 0.98rem/1.3 var(--sans);
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.6rem;
  align-items: baseline;
}
.card .id { font-family: var(--mono); font-size: 0.84rem; color: var(--accent); }
.card .blurb { margin: 0.35rem 0 0; color: var(--muted); }
.card .span-clause,
.card .span-lemma {
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.88rem;
  line-height: 1.35;
}
.card .span-lemma {
  font-family: var(--mono);
  font-size: 0.8rem;
}
.card .span-lemma::before { content: "lemma "; color: var(--line); font-family: var(--sans); }
.roles {
  margin: 0.45rem 0 0;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.2rem 0.75rem;
  font-size: 0.88rem;
}
.roles dt { font: 600 0.72rem/1.6 var(--mono); color: var(--accent); text-transform: uppercase; letter-spacing: 0.04em; }
.roles dd { margin: 0; display: flex; flex-wrap: wrap; gap: 0.25rem 0.45rem; align-items: baseline; }
.role-value { font-weight: 600; }
.role-value.unknown { font-weight: 400; font-style: italic; color: var(--muted); }
.role-dep, .member-span { font: 0.75rem var(--mono); color: #1d4ed8; background: #dbeafe; padding: 0.05rem 0.3rem; border-radius: 0.2rem; }
.frame-graph, .members { margin: 0.45rem 0 0; display: flex; flex-wrap: wrap; gap: 0.3rem 0.5rem; align-items: baseline; font-size: 0.86rem; }
.frame-graph .k { font: 600 0.72rem var(--mono); color: var(--accent); text-transform: uppercase; letter-spacing: 0.04em; }
.member { display: inline-flex; gap: 0.3rem; align-items: baseline; }
.member-sentence { font: 0.75rem var(--mono); color: var(--muted); }
.card .span-clause::before { content: "clause "; color: var(--line); }
.pill {
  display: inline-block;
  font: 0.72rem/1 var(--mono);
  padding: 0.22rem 0.4rem;
  border-radius: 0.25rem;
  background: #f5f5f4;
  color: var(--muted);
  border: 1px solid var(--line);
}
.pill.ok { color: var(--ok); background: #dcfce7; border-color: #86efac; }
.pill.warn { color: var(--warn); background: #ffedd5; border-color: #fdba74; }
.pill.bad { color: var(--bad); background: #fee2e2; border-color: #fca5a5; }
details.lineage {
  margin-top: 0.55rem;
  border-top: 1px dashed var(--line);
  padding-top: 0.4rem;
}
details.lineage > summary {
  list-style: none;
  color: var(--accent);
  font-size: 0.88rem;
  user-select: none;
}
details.lineage > summary::-webkit-details-marker { display: none; }
details.lineage > summary::before { content: "▸ "; }
details.lineage[open] > summary::before { content: "▾ "; }
.lineage-body { margin-top: 0.45rem; display: grid; gap: 0.45rem; }
.lineage-tabs { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.lineage-tabs button {
  font: 0.75rem/1.2 var(--mono);
  border: 1px solid var(--line);
  background: #fafaf9;
  color: var(--ink);
  padding: 0.28rem 0.5rem;
  border-radius: 0.3rem;
  cursor: pointer;
}
.lineage-tabs button[aria-selected="true"] {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.lineage-pane { display: grid; gap: 0.35rem; }
.lineage-pane[hidden] { display: none; }
.line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.45rem;
  font-size: 0.86rem;
  padding: 0.4rem 0.5rem;
  background: #fafaf9;
  border-radius: 0.3rem;
  border: 1px solid #e7e5e4;
}
.line .layer {
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}
.line code {
  font-family: var(--mono);
  font-size: 0.78rem;
  padding: 0.05rem 0.32rem;
  border-radius: 0.2rem;
}
.line-id { color: var(--accent); background: var(--accent-soft); }
.line-ref, .line-up { color: #1d4ed8; background: #dbeafe; }
.line-down { color: #6d28d9; background: #ede9fe; }
.line-content { font-weight: 600; color: var(--ink); }
.line-content.quoted::before,
.line-content.quoted::after { color: var(--muted); font-weight: 400; }
.line-content.quoted::before { content: "“"; }
.line-content.quoted::after { content: "”"; }
.source-mark {
  text-decoration-line: underline;
  text-decoration-color: #c2410c;
  text-decoration-thickness: 3px;
  text-underline-offset: 0.16em;
  color: #9a3412;
}
.line-type {
  font: 0.72rem/1.2 var(--mono);
  color: var(--warn);
  background: #ffedd5;
  border: 1px solid #fdba74;
  border-radius: 999px;
  padding: 0.08rem 0.42rem;
}
.line-break { flex-basis: 100%; height: 0; }
.line-note { color: var(--muted); font-size: 0.78rem; }
.gloss {
  margin: 0.55rem 0 0;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  row-gap: 0.6rem;
}
.gloss-gap {
  white-space: pre;
  font-size: 1.05rem;
  line-height: 1.5;
  padding-bottom: 0.25rem;
  color: var(--ink);
}
.gloss-span {
  --pos: #78716c;
  --pos-soft: #f5f5f4;
  position: relative;
  display: inline-flex;
  cursor: default;
}
.gloss-word {
  font-size: 1.05rem;
  line-height: 1.5;
  color: var(--ink);
  padding: 0 0.08rem 0.1rem;
  border-bottom: 3px solid var(--pos);
}
.gloss-pos {
  display: none;
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 0.2rem;
  z-index: 2;
  white-space: nowrap;
  font: 600 0.72rem/1.2 var(--mono);
  color: var(--pos);
  background: var(--pos-soft);
  border: 1px solid var(--pos);
  border-radius: 0.25rem;
  padding: 0.15rem 0.4rem;
}
.gloss-span:hover .gloss-pos,
.gloss-span.hit .gloss-pos { display: block; }
.gloss-span:hover .gloss-word,
.gloss-span.hit .gloss-word { background: var(--pos-soft); }
.gloss-span.hit .gloss-word { outline: 2px solid var(--pos); border-radius: 0.2rem; }
.line-span { cursor: default; }
.pos-verb { --pos: #b91c1c; --pos-soft: #fee2e2; }
.pos-noun { --pos: #1d4ed8; --pos-soft: #dbeafe; }
.pos-pronoun { --pos: #4338ca; --pos-soft: #e0e7ff; }
.pos-adjective { --pos: #a16207; --pos-soft: #fef9c3; }
.pos-adverb { --pos: #c2410c; --pos-soft: #ffedd5; }
.pos-determiner { --pos: #6b7280; --pos-soft: #f3f4f6; }
.pos-preposition { --pos: #0f766e; --pos-soft: #ccfbf1; }
.pos-conjunction { --pos: #7e22ce; --pos-soft: #f3e8ff; }
.pos-value { --pos: #15803d; --pos-soft: #dcfce7; }
.pos-negative { --pos: #be123c; --pos-soft: #ffe4e6; }
.gloss-span.match .gloss-word { background: var(--pos-soft); }
.gloss-span.skipped {
  opacity: 0.45;
}
.gloss-span.skipped .gloss-word {
  color: var(--muted);
  border-bottom-width: 1px;
  border-bottom-style: dotted;
}
.gloss-span.skipped:hover,
.gloss-span.skipped.hit,
.gloss-span.skipped.match { opacity: 0.85; }
.line-span.skipped { opacity: 0.55; color: var(--muted); }
.empty { color: var(--muted); padding: 1.5rem 0; }
.original { color: var(--muted); margin: 0 0 0.5rem; font-style: italic; }
.graph-image { display: block; max-width: 100%; height: auto; margin: 0.5rem 0 0; border: 1px solid var(--line); }
#panel-graph h2 { font-size: 1.05rem; margin: 0.2rem 0 0.6rem; }
.graph-skipped { color: var(--muted); margin: 0.5rem 0 0; padding-left: 1.2rem; }
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
  background:
    linear-gradient(180deg, #fbfaf7 0%, #f3f1ec 100%);
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
.graph-fallback details { margin-top: 0.45rem; }
.graph-fallback summary { color: var(--muted); font-size: 0.82rem; }
</style>
</head>
<body>
<header>
  <div class="brand">Clew<span class="version">v__CLEW_VERSION__</span></div>
  <div class="session-line">
    <h1>Session <select class="meta" id="session-id" aria-label="Session"><option>…</option></select></h1>
    <p id="session-meta">Loading session JSON…</p>
  </div>
</header>
<div class="toolbar">
  <div class="filters">
    <label>Search<input type="search" id="filter-text" placeholder="id or surface form"></label>
    <label>Frame<select id="filter-frame"><option value="">any</option></select></label>
    <label>Concept<select id="filter-concept"><option value="">any</option></select></label>
    <label>Span<select id="filter-span"><option value="">any</option></select></label>
    <label><input type="checkbox" id="filter-insignificant">Show insignificant spans</label>
    <label><input type="checkbox" id="filter-multi-token">Multi-token spans only</label>
    <button type="button" id="filter-clear">Clear filters</button>
  </div>
</div>
<main>
  <div class="status-row">
    <button type="button" id="refresh" title="Reload session" aria-label="Reload session">🔄</button>
    <p class="status" id="banner">Fetching session files…</p>
  </div>
  <div class="tabset">
    <div class="tabs" role="tablist" aria-label="Views">
      <button type="button" role="tab" id="tab-frames" aria-selected="true" data-tab="frames">Frames</button>
      <button type="button" role="tab" id="tab-concepts" aria-selected="false" data-tab="concepts">Concepts</button>
      <button type="button" role="tab" id="tab-sentences" aria-selected="false" data-tab="sentences">Sentences</button>
      <button type="button" role="tab" id="tab-spans" aria-selected="false" data-tab="spans">Span</button>
      <button type="button" role="tab" id="tab-graph" aria-selected="false" data-tab="graph">Graph</button>
    </div>
    <div class="tab-body">
      <section class="panel active" id="panel-frames" role="tabpanel" aria-labelledby="tab-frames"></section>
      <section class="panel" id="panel-concepts" role="tabpanel" aria-labelledby="tab-concepts" hidden></section>
      <section class="panel" id="panel-sentences" role="tabpanel" aria-labelledby="tab-sentences" hidden></section>
      <section class="panel" id="panel-spans" role="tabpanel" aria-labelledby="tab-spans" hidden></section>
      <section class="panel" id="panel-graph" role="tabpanel" aria-labelledby="tab-graph" hidden></section>
    </div>
  </div>
</main>
<script src="cytoscape.min.js"></script>
<script src="cytoscape-dagre.min.js"></script>
<script src="clew-interactive-graph.js"></script>
<script>
(function () {
  const FRAME_FILTERS = [
    ["transition", "transition"],
    ["not-transition", "not a transition"],
    ["negated", "negated"],
    ["incomplete", "incomplete"],
  ];
  const ROLES = ["actor", "event", "object", "result", "when"];
  const state = {
    session: null,
    sentences: [],
    tagged: [],
    spans: [],
    concepts: [],
    frames: [],
    graph: null,
    graphView: null,
    graphStatus: "loading",
    tab: "frames",
    page: { frames: 0, concepts: 0, sentences: 0, spans: 0 },
    graphMounts: [],
  };
  const PAGE_SIZE = 30;

  const els = {
    sessionId: document.getElementById("session-id"),
    meta: document.getElementById("session-meta"),
    banner: document.getElementById("banner"),
    refresh: document.getElementById("refresh"),
    text: document.getElementById("filter-text"),
    frame: document.getElementById("filter-frame"),
    concept: document.getElementById("filter-concept"),
    span: document.getElementById("filter-span"),
    insignificant: document.getElementById("filter-insignificant"),
    multiToken: document.getElementById("filter-multi-token"),
    clear: document.getElementById("filter-clear"),
    frames: document.getElementById("panel-frames"),
    concepts: document.getElementById("panel-concepts"),
    sentences: document.getElementById("panel-sentences"),
    spans: document.getElementById("panel-spans"),
    graph: document.getElementById("panel-graph"),
  };

  for (const [value, label] of FRAME_FILTERS) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    els.frame.appendChild(opt);
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pill(text, tone) {
    return '<span class="pill' + (tone ? " " + tone : "") + '">' + esc(text) + "</span>";
  }

  function statusTone(status) {
    if (status === "current" || status === "confirmed" || status === "original") return "ok";
    if (status === "stale" || status === "candidate" || status === "edited" || status === "added") return "warn";
    if (status === "rejected" || status === "deleted") return "bad";
    return "";
  }

  function sentenceView(record) {
    const shown = record.latest || record.original || { text: "", span: null, section: "" };
    const revised = (record.history || []).some(function (entry) { return entry.who !== "clew"; });
    const state = record.latest === null ? "deleted"
      : record.original === null ? "added"
      : revised && record.latest.hash !== record.original.hash ? "edited"
      : "original";
    return {
      id: record.id,
      text: shown.text,
      span: shown.span,
      section: shown.section,
      state: state,
      original: state === "edited" ? record.original.text : null,
    };
  }

  let selected = new URLSearchParams(location.search).get("session");

  function sessionBase() {
    return selected ? "./sessions/" + encodeURIComponent(selected) + "/" : "./";
  }

  async function loadJson(name) {
    const response = await fetch(sessionBase() + name, { cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(name + " HTTP " + response.status);
    return response.json();
  }

  function indexTagged() {
    const map = new Map();
    for (const row of state.tagged) map.set(row.id, row);
    return map;
  }

  function indexConcepts() {
    const map = new Map();
    for (const concept of state.concepts) map.set(concept.id, concept);
    return map;
  }

  function indexFrames() {
    const map = new Map();
    for (const frame of state.frames) map.set(frame.id, frame);
    return map;
  }

  function indexSentences() {
    const map = new Map();
    for (const sentence of state.sentences) map.set(sentence.id, sentence);
    return map;
  }

  function indexTokens() {
    const map = new Map();
    for (const row of state.tagged) {
      for (const token of row.tokens || []) map.set(token.id, { token: token, sentenceId: row.id });
    }
    return map;
  }

  function indexSpans() {
    const map = new Map();
    for (const span of state.spans) map.set(span.id, span);
    return map;
  }

  function tokenOrder() {
    const order = new Map();
    let index = 0;
    for (const row of state.tagged) {
      for (const token of row.tokens || []) {
        order.set(token.id, index);
        index += 1;
      }
    }
    return order;
  }

  function sentenceIdOfToken(tokenId) {
    const dot = tokenId.indexOf(".");
    return dot > 0 ? tokenId.slice(0, dot) : "";
  }

  function spanCoversToken(span, tokenId, order) {
    const first = order.get(span.firstTokenId);
    const last = order.get(span.lastTokenId);
    const at = order.get(tokenId);
    return first !== undefined && last !== undefined && at !== undefined && at >= first && at <= last;
  }

  function spanForToken(tokenId) {
    const order = tokenOrder();
    for (const span of state.spans) {
      if (spanCoversToken(span, tokenId, order)) return span;
    }
    return null;
  }

  function spanCharRange(span) {
    const tokens = indexTokens();
    const first = tokens.get(span.firstTokenId);
    const last = tokens.get(span.lastTokenId);
    if (!first || !last || !first.token.span || !last.token.span) return null;
    return [first.token.span[0], last.token.span[1]];
  }

  function sentenceById(id) {
    for (const sentence of state.sentences) {
      if (sentence.id === id) return sentence;
    }
    return null;
  }

  function matchesText(haystacks) {
    const q = els.text.value.trim().toLowerCase();
    if (q === "") return true;
    for (const item of haystacks) {
      if (item !== undefined && item !== null && String(item).toLowerCase().includes(q)) return true;
    }
    return false;
  }

  const LINEAGE_ORDER = ["span", "sentence", "concept", "frame", "source", "transition", "state", "flow"];
  const LINEAGE_LABELS = {
    span: "Spans",
    sentence: "Sentences",
    concept: "Concepts",
    frame: "Frames",
    source: "Sources",
    transition: "Transitions",
    state: "States",
    flow: "Flows",
  };

  function lineageLabel(layer) {
    if (LINEAGE_LABELS[layer]) return LINEAGE_LABELS[layer];
    return layer.charAt(0).toUpperCase() + layer.slice(1);
  }

  function lineageBlock(rows) {
    if (rows.length === 0) {
      return '<details class="lineage"><summary>Lineage</summary><div class="lineage-body"><div class="line">No lineage links.</div></div></details>';
    }
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.layer)) groups.set(row.layer, []);
      groups.get(row.layer).push(row);
    }
    const layers = Array.from(groups.keys()).sort(function (a, b) {
      const left = LINEAGE_ORDER.indexOf(a);
      const right = LINEAGE_ORDER.indexOf(b);
      if (left === -1 && right === -1) return a < b ? -1 : a > b ? 1 : 0;
      if (left === -1) return 1;
      if (right === -1) return -1;
      return left - right;
    });
    const tabs = layers.map(function (layer, index) {
      const count = groups.get(layer).length;
      return '<button type="button" class="lineage-tab" role="tab" data-layer="' + esc(layer) +
        '" aria-selected="' + (index === 0 ? "true" : "false") + '">' +
        esc(lineageLabel(layer)) + " (" + count + ")</button>";
    }).join("");
    const panes = layers.map(function (layer, index) {
      const body = groups.get(layer).map(renderLine).join("");
      return '<div class="lineage-pane" role="tabpanel" data-layer="' + esc(layer) + '"' +
        (index === 0 ? "" : " hidden") + ">" + body + "</div>";
    }).join("");
    return '<details class="lineage"><summary>Lineage (' + rows.length + ')</summary><div class="lineage-body">' +
      '<div class="lineage-tabs" role="tablist">' + tabs + "</div>" + panes + "</div></details>";
  }

  function part(kind, value, quoted) {
    return quoted ? { kind: kind, value: value, quoted: true } : { kind: kind, value: value };
  }

  function renderPart(piece) {
    const value = esc(piece.value);
    if (piece.kind === "id") return '<code class="line-id">' + value + "</code>";
    if (piece.kind === "break") return '<span class="line-break"></span>';
    if (piece.kind === "span") {
      const skipped = piece.skipped ? " skipped" : "";
      return '<code class="line-ref line-span' + skipped + '" data-span="' + esc(piece.span) + '" title="' + esc(piece.span) + '">' +
        value + "</code>";
    }
    if (piece.kind === "ref") return '<code class="line-ref">' + value + "</code>";
    if (piece.kind === "up") return '<code class="line-up">' + value + "</code>";
    if (piece.kind === "down") return '<code class="line-down">' + value + "</code>";
    if (piece.kind === "type") return '<span class="line-type">' + value + "</span>";
    if (piece.kind === "content") {
      const inner = piece.raw ? piece.html : value;
      return '<span class="line-content' + (piece.quoted ? " quoted" : "") + '">' + inner + "</span>";
    }
    return '<span class="line-note">' + value + "</span>";
  }

  function renderLine(row) {
    const bits = (row.bits || []).map(renderPart).join("");
    return '<div class="line" data-text="' + esc(row.text) + '"><span class="layer">' + esc(row.layer) + "</span>" +
      (bits || esc(row.text)) + "</div>";
  }

  function spanRow(span, withTags) {
    const tags = (span && span.tags) || [];
    const surface = span ? span.surface : "";
    const id = span ? span.id : "";
    const text = id + (span ? " “" + surface + "”" + (withTags ? " [" + tags.join("|") + "]" : "") : "");
    const bits = [part("id", id)];
    if (span) {
      bits.push(part("content", surface, true));
      if (withTags && tags.length) bits.push(part("type", tags.join(" · ")));
    }
    return { layer: "span", text: text, bits: bits };
  }

  function consecutiveSpans(prev, next, order) {
    const left = order.get(prev.lastTokenId);
    const right = order.get(next.firstTokenId);
    return left !== undefined && right === left + 1;
  }

  function markedSentenceHtml(sentence, markSpans) {
    const text = sentence.text || "";
    const base = sentence.span && sentence.span.length === 2 ? sentence.span[0] : null;
    if (base === null || !markSpans.length) return esc(text);
    const ranges = [];
    for (const span of markSpans) {
      const range = spanCharRange(span);
      if (!range) continue;
      const start = range[0] - base;
      const end = range[1] - base;
      if (start < 0 || end > text.length || end <= start) continue;
      ranges.push([start, end]);
    }
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    const merged = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
      else merged.push([range[0], range[1]]);
    }
    if (!merged.length) return esc(text);
    let html = "";
    let cursor = 0;
    for (const range of merged) {
      html += esc(text.slice(cursor, range[0]));
      html += '<span class="source-mark">' + esc(text.slice(range[0], range[1])) + "</span>";
      cursor = range[1];
    }
    html += esc(text.slice(cursor));
    return html;
  }

  function sentenceRow(sentence) {
    return {
      layer: "sentence",
      text: sentence.id + " “" + sentence.text + "”",
      bits: [part("id", sentence.id), part("content", sentence.text, true)],
    };
  }

  function spanRangeLabel(marks) {
    const first = marks[0].id;
    return marks.length > 1 ? first + "–" + marks[marks.length - 1].id : first;
  }

  function spanSentenceRow(sentence, marks) {
    const ids = spanRangeLabel(marks);
    return {
      layer: "span",
      text: ids + " [" + sentence.section + "] “" + sentence.text + "”",
      bits: [
        part("id", ids),
        part("type", sentence.section),
        { kind: "break" },
        { kind: "content", quoted: true, raw: true, html: markedSentenceHtml(sentence, marks) },
      ],
    };
  }

  function appendSpanSources(rows, sources) {
    const order = tokenOrder();
    let run = [];
    function flush() {
      if (!run.length) return;
      const sentence = sentenceById(run[0].sentenceId);
      if (sentence) rows.push(spanSentenceRow(sentence, run.map(function (hit) { return hit.span; })));
      else {
        for (const hit of run) rows.push(spanRow(hit.span, true));
      }
      run = [];
    }
    for (const source of sources || []) {
      let span = null;
      let sentenceId = "";
      if (/^sp:/.test(source)) {
        span = indexSpans().get(source) || null;
        if (span) sentenceId = sentenceIdOfToken(span.firstTokenId);
      } else if (/^s[1-9][0-9]*\.t[1-9][0-9]*$/.test(source)) {
        span = spanForToken(source);
        sentenceId = sentenceIdOfToken(source);
      }
      if (!span) {
        flush();
        rows.push({ layer: "source", text: source, bits: [part("id", source)] });
        continue;
      }
      const hit = { span: span, sentenceId: sentenceId };
      const prev = run[run.length - 1];
      if (prev && (prev.sentenceId !== hit.sentenceId || !consecutiveSpans(prev.span, hit.span, order))) flush();
      // Deduplicate repeated sources that resolve to the same span.
      if (prev && prev.span.id === hit.span.id) continue;
      run.push(hit);
    }
    flush();
  }

  function roleLatest(frame, role) {
    const field = frame.roles && frame.roles[role];
    return field ? field.latest : { value: "unknown", dependsOn: [] };
  }

  function roleKnown(frame, role) {
    return roleLatest(frame, role).value !== "unknown";
  }

  function roleText(frame, role) {
    const value = roleLatest(frame, role).value;
    return value === "unknown" ? "unknown" : value.text;
  }

  function roleRefs(frame, role) {
    const value = roleLatest(frame, role).value;
    return value === "unknown" ? [] : value.refs || [];
  }

  function roleConcepts(frame, role) {
    const spans = indexSpans();
    return roleRefs(frame, role).map(function (ref) {
      if (ref.indexOf("concept:") === 0) return ref;
      const span = spans.get(ref);
      return span && span.entityId ? span.entityId : "";
    }).filter(function (id) { return id !== ""; });
  }

  function conceptRoles(frame, conceptId) {
    return ["actor", "event", "object", "result"].filter(function (role) {
      return roleConcepts(frame, role).indexOf(conceptId) >= 0;
    });
  }

  function frameIncomplete(frame) {
    if (frame.notTransition) return false;
    return !roleKnown(frame, "event") || !roleKnown(frame, "object") || !roleKnown(frame, "result");
  }

  function frameKind(frame) {
    if (frame.notTransition) return "not a transition";
    if (frame.negated === true) return "negated";
    if (frameIncomplete(frame)) return "incomplete";
    return "transition";
  }

  function frameFilterMatches(frame, value) {
    if (value === "transition") return !frame.notTransition;
    if (value === "not-transition") return Boolean(frame.notTransition);
    if (value === "negated") return frame.negated === true;
    if (value === "incomplete") return frameIncomplete(frame);
    return true;
  }

  function sortedSpanIds(ids) {
    const spans = indexSpans();
    const order = tokenOrder();
    function at(id) {
      const span = spans.get(id);
      const index = span ? order.get(span.firstTokenId) : undefined;
      return index === undefined ? Number.MAX_SAFE_INTEGER : index;
    }
    return ids.slice().sort(function (left, right) { return at(left) - at(right); });
  }

  function frameDependsOn(frame) {
    const ids = [];
    for (const role of ROLES) {
      for (const id of roleLatest(frame, role).dependsOn || []) {
        if (ids.indexOf(id) < 0) ids.push(id);
      }
    }
    return sortedSpanIds(ids);
  }

  function clauseText(frame) {
    return frame.clause && frame.clause.text ? frame.clause.text : "";
  }

  function frameTransitions(frameId) {
    if (!state.graph) return [];
    return (state.graph.transitions || []).filter(function (transition) {
      return transition.frame === frameId || (transition.frames || []).indexOf(frameId) >= 0;
    });
  }

  function forbiddenFlows(frameId) {
    if (!state.graph) return [];
    return (state.graph.flows || []).filter(function (flow) { return flow.forbidden === frameId; });
  }

  function transitionRow(transition) {
    return {
      layer: "transition",
      text: transition.id + " " + transition.from + " -" + transition.event + "→ " + transition.to,
      bits: [
        part("id", transition.id),
        part("up", transition.from),
        part("type", transition.event),
        part("note", "→"),
        part("down", transition.to),
      ],
    };
  }

  function frameRow(frame, label) {
    return {
      layer: "frame",
      text: frame.id + " " + label + " “" + clauseText(frame) + "”",
      bits: [part("id", frame.id), part("type", label), part("content", clauseText(frame), true)],
    };
  }

  function frameLineage(frame) {
    const rows = [];
    appendSpanSources(rows, frameDependsOn(frame));
    const sentence = sentenceById(frame.sentence);
    rows.push(sentence ? sentenceRow(sentence) : { layer: "sentence", text: frame.sentence, bits: [part("id", frame.sentence)] });
    const concepts = indexConcepts();
    for (const role of ["actor", "event", "object", "result"]) {
      for (const id of roleConcepts(frame, role)) {
        const concept = concepts.get(id);
        const label = concept ? concept.canonical : id;
        rows.push({
          layer: "concept",
          text: role + " → " + id + " (" + label + ")",
          bits: [part("type", role), part("note", "→"), part("id", id), part("content", label)],
        });
      }
    }
    const frames = indexFrames();
    for (const id of roleRefs(frame, "when")) {
      const cited = frames.get(id);
      rows.push(cited ? frameRow(cited, "when →") : { layer: "frame", text: "when → " + id, bits: [part("type", "when →"), part("id", id)] });
    }
    for (const other of state.frames) {
      if (roleRefs(other, "when").indexOf(frame.id) >= 0) rows.push(frameRow(other, "when of →"));
    }
    const transitions = frameTransitions(frame.id);
    for (const transition of transitions) rows.push(transitionRow(transition));
    if (state.graph) {
      for (const graphState of state.graph.states || []) {
        if ((graphState.frames || []).indexOf(frame.id) >= 0) {
          rows.push({
            layer: "state",
            text: graphState.id + " (" + graphState.object + ")",
            bits: [part("id", graphState.id), part("content", graphState.object)],
          });
        }
      }
      for (const flow of state.graph.flows || []) {
        for (const transition of transitions) {
          if ((flow.transitions || []).indexOf(transition.id) >= 0) {
            rows.push({
              layer: "flow",
              text: flow.id + " transition " + transition.id,
              bits: [part("id", flow.id), part("type", "transition"), part("ref", transition.id)],
            });
          }
        }
      }
      for (const flow of forbiddenFlows(frame.id)) {
        rows.push({
          layer: "flow",
          text: flow.id + " forbidden " + frame.id,
          bits: [part("id", flow.id), part("type", "forbidden"), part("ref", frame.id)],
        });
      }
    }
    return lineageBlock(rows);
  }

  function conceptLineage(concept) {
    const rows = [];
    appendSpanSources(rows, sortedSpanIds(concept.members || []));
    for (const frame of state.frames) {
      const roles = conceptRoles(frame, concept.id);
      if (roles.length) rows.push(frameRow(frame, roles.join(" · ")));
    }
    return lineageBlock(rows);
  }

  function viaPart(source) {
    if (/^sp:/.test(source)) {
      const span = indexSpans().get(source);
      return span
        ? { kind: "span", value: span.surface, span: span.id, skipped: span.insignificant === true }
        : part("ref", source);
    }
    if (/^s[1-9][0-9]*\.t[1-9][0-9]*$/.test(source)) {
      const span = spanForToken(source);
      return span
        ? { kind: "span", value: span.surface, span: span.id, skipped: span.insignificant === true }
        : part("ref", source);
    }
    return part("ref", source);
  }

  function spanInSentence(spanId, sentenceId) {
    const span = indexSpans().get(spanId);
    return Boolean(span) && sentenceIdOfToken(span.firstTokenId) === sentenceId;
  }

  function sentenceLineage(sentence) {
    const rows = [];
    for (const concept of state.concepts) {
      const member = sortedSpanIds(concept.members || []).find(function (id) { return spanInSentence(id, sentence.id); });
      if (member) {
        rows.push({
          layer: "concept",
          text: concept.id + " via " + member,
          bits: [part("id", concept.id), part("note", "via"), viaPart(member)],
        });
      }
    }
    const frames = state.frames.filter(function (frame) { return frame.sentence === sentence.id; });
    for (const frame of frames) rows.push(frameRow(frame, frameKind(frame)));
    for (const frame of frames) {
      for (const transition of frameTransitions(frame.id)) rows.push(transitionRow(transition));
    }
    return lineageBlock(rows);
  }

  function rolesHtml(frame) {
    return '<dl class="roles">' + ROLES.map(function (role) {
      const known = roleKnown(frame, role);
      const deps = roleLatest(frame, role).dependsOn || [];
      return "<dt>" + role + '</dt><dd data-role="' + role + '"><span class="role-value' + (known ? "" : " unknown") + '">' +
        esc(roleText(frame, role)) + "</span>" +
        deps.map(function (id) { return '<code class="role-dep">' + esc(id) + "</code>"; }).join("") + "</dd>";
    }).join("") + "</dl>";
  }

  function frameGraphHtml(frame) {
    let html = "";
    for (const transition of frameTransitions(frame.id)) {
      html += '<p class="frame-graph" data-graph="transition"><span class="k">transition</span>' +
        '<span class="line-type">' + esc(transition.event) + "</span>" +
        '<code class="line-up">' + esc(transition.from) + "</code>→" +
        '<code class="line-down">' + esc(transition.to) + "</code></p>";
    }
    for (const flow of forbiddenFlows(frame.id)) {
      html += '<p class="frame-graph" data-graph="forbidden"><span class="k">forbidden</span>' +
        '<code class="line-id">' + esc(flow.id) + "</code>" +
        '<span class="line-type">' + esc(roleText(frame, "event")) + "</span>" +
        "<span>" + esc(flow.title || "") + "</span></p>";
    }
    return html;
  }

  function frameHaystacks(frame) {
    const items = [frame.id, frame.sentence, clauseText(frame), frame.marker, frameKind(frame)];
    for (const role of ROLES) {
      items.push(roleText(frame, role), ...roleRefs(frame, role), ...(roleLatest(frame, role).dependsOn || []));
    }
    return items;
  }

  function sentenceFrameMatches(sentence) {
    const value = els.frame.value;
    if (!value) return true;
    return state.frames.some(function (frame) { return frame.sentence === sentence.id && frameFilterMatches(frame, value); });
  }

  function renderFrames() {
    const frameFilter = els.frame.value;
    const conceptFilter = els.concept.value;
    const visible = state.frames.filter(function (frame) {
      if (frameFilter && !frameFilterMatches(frame, frameFilter)) return false;
      if (conceptFilter && conceptRoles(frame, conceptFilter).length === 0) return false;
      return matchesText(frameHaystacks(frame));
    });
    if (visible.length === 0) {
      els.frames.innerHTML = '<p class="empty">No frames match these filters.</p>';
      return;
    }
    renderPage("frames", els.frames, visible, function (frame) {
      let pills = pill(frame.sentence);
      if (frame.marker) pills += pill(frame.marker);
      if (frame.negated === true) pills += pill("negated", "bad");
      if (frame.notTransition) pills += pill("not a transition", "warn") + pill(frame.notTransition.reason);
      if (frameIncomplete(frame)) pills += pill("incomplete", "warn");
      return (
        '<article class="card">' +
        '<h2><span class="id">' + esc(frame.id) + "</span>" + pills + "</h2>" +
        '<p class="blurb">' + esc(clauseText(frame)) + "</p>" +
        rolesHtml(frame) +
        frameGraphHtml(frame) +
        frameLineage(frame) +
        "</article>"
      );
    });
  }

  function pagerHtml(name, page, pages, total) {
    const start = page * PAGE_SIZE;
    return '<nav class="pager" data-tab="' + name + '" aria-label="Pages">' +
      '<button type="button" data-page="prev"' + (page === 0 ? " disabled" : "") + ">Prev</button>" +
      "<span>" + (start + 1) + "–" + Math.min(start + PAGE_SIZE, total) + " of " + total +
      " · page " + (page + 1) + " of " + pages + "</span>" +
      '<button type="button" data-page="next"' + (page === pages - 1 ? " disabled" : "") + ">Next</button>" +
      "</nav>";
  }

  function renderPage(name, panel, visible, card) {
    const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    const page = Math.min(state.page[name], pages - 1);
    state.page[name] = page;
    const body = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(card).join("");
    const pager = pages > 1 ? pagerHtml(name, page, pages, visible.length) : "";
    panel.innerHTML = pager + body + pager;
  }

  function conceptMembers(concept) {
    const spans = indexSpans();
    return (concept.members || []).map(function (id) {
      const span = spans.get(id);
      return { span: id, surface: span ? span.surface : id, sentence: span ? sentenceIdOfToken(span.firstTokenId) : "" };
    });
  }

  function renderConcepts() {
    const conceptFilter = els.concept.value;
    const visible = state.concepts.filter(function (concept) {
      if (conceptFilter && concept.id !== conceptFilter) return false;
      const members = conceptMembers(concept);
      return matchesText([concept.id, concept.canonical].concat(
        members.map(function (member) { return member.span; }),
        members.map(function (member) { return member.surface; }),
      ));
    });
    if (visible.length === 0) {
      els.concepts.innerHTML = '<p class="empty">No concepts match these filters.</p>';
      return;
    }
    renderPage("concepts", els.concepts, visible, function (concept) {
      const members = conceptMembers(concept);
      return (
        '<article class="card">' +
        '<h2><span class="id">' + esc(concept.id) + "</span>" +
        pill(members.length === 1 ? "1 member" : members.length + " members") + "</h2>" +
        '<p class="blurb">' + esc(concept.canonical) + "</p>" +
        '<p class="members">' + members.map(function (member) {
          return '<span class="member" data-span="' + esc(member.span) + '"><code class="member-span" title="' + esc(member.span) + '">' +
            esc(member.surface) + '</code><span class="member-sentence">' + esc(member.sentence) + "</span></span>";
        }).join("") + "</p>" +
        conceptLineage(concept) +
        "</article>"
      );
    });
  }

  function fillConceptFilter() {
    const current = els.concept.value;
    let html = '<option value="">any</option>';
    for (const concept of state.concepts) {
      html += '<option value="' + esc(concept.id) + '">' + esc(concept.canonical) + " (" + (concept.members || []).length + ")</option>";
    }
    els.concept.innerHTML = html;
    els.concept.value = state.concepts.some(function (concept) { return concept.id === current; }) ? current : "";
  }

  const POS_ORDER = [
    "Verb", "Noun", "Pronoun", "Adjective", "Adverb", "Determiner",
    "Preposition", "Conjunction", "Value", "Negative",
  ];

  function coarsePos(tags) {
    for (const pos of POS_ORDER) {
      if (tags.indexOf(pos) >= 0) return pos;
    }
    return tags[0] || "";
  }

  const TAG_SKIP = ["Connector", "TextValue", "NumericValue"];

  function posLabel(tags) {
    const pos = coarsePos(tags);
    return (pos ? [pos] : []).concat(otherTags(tags).sort()).join(" · ");
  }

  function otherTags(tags) {
    const pos = coarsePos(tags);
    return tags.filter(function (tag) { return tag !== pos && TAG_SKIP.indexOf(tag) < 0; });
  }

  function spanFilterActive() {
    return els.span.value !== "";
  }

  function spanMatches(span) {
    const tags = span.tags || [];
    const value = els.span.value;
    if (value.indexOf("pos:") === 0) return coarsePos(tags) === value.slice(4);
    return posLabel(tags) === value;
  }

  function fillSpanFilter() {
    const groups = new Map();
    for (const span of state.spans) {
      const tags = span.tags || [];
      const pos = coarsePos(tags);
      if (!pos) continue;
      if (!groups.has(pos)) groups.set(pos, { total: 0, labels: new Map() });
      const group = groups.get(pos);
      const label = posLabel(tags);
      group.total += 1;
      group.labels.set(label, (group.labels.get(label) || 0) + 1);
    }
    const order = POS_ORDER.filter(function (pos) { return groups.has(pos); })
      .concat(Array.from(groups.keys()).filter(function (pos) { return POS_ORDER.indexOf(pos) < 0; }).sort());
    let html = '<option value="">any</option>';
    for (const pos of order) {
      const group = groups.get(pos);
      const labels = Array.from(group.labels.entries()).sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); });
      html += '<optgroup label="' + esc(pos) + '">' +
        '<option value="pos:' + esc(pos) + '">' + esc(pos) + " · all (" + group.total + ")</option>";
      for (const [label, count] of labels) {
        if (label === pos && labels.length === 1) continue;
        html += '<option value="' + esc(label) + '">' + esc(label) + " (" + count + ")</option>";
      }
      html += "</optgroup>";
    }
    els.span.innerHTML = html;
  }

  function glossSpan(span) {
    const tags = span.tags || [];
    const pos = coarsePos(tags);
    const label = posLabel(tags);
    const match = spanFilterActive() && spanMatches(span) ? " match" : "";
    const skipped = span.insignificant === true ? " skipped" : "";
    const titleBits = [span.id];
    if (tags.length) titleBits.push(tags.join(", "));
    if (span.insignificant === true) titleBits.push("skipped");
    return '<span class="gloss-span pos-' + esc(pos.toLowerCase() || "none") + match + skipped + '" data-span="' + esc(span.id) +
      (span.insignificant === true ? '" data-skipped="true' : "") +
      '" title="' + esc(titleBits.join(" · ")) + '">' +
      '<span class="gloss-word">' + esc(span.surface) + "</span>" +
      (label ? '<span class="gloss-pos">' + esc(label) + "</span>" : "") + "</span>";
  }

  function spansForSentence(sentenceId) {
    const order = tokenOrder();
    return state.spans.filter(function (span) {
      return sentenceIdOfToken(span.firstTokenId) === sentenceId;
    }).sort(function (left, right) {
      return (order.get(left.firstTokenId) || 0) - (order.get(right.firstTokenId) || 0);
    });
  }

  function glossHtml(sentence, spans) {
    const text = sentence.text || "";
    const base = sentence.span && sentence.span.length === 2 ? sentence.span[0] : null;
    if (base === null || !spans.length) return '<p class="blurb">' + esc(text) + "</p>";
    let html = "";
    let cursor = 0;
    for (const span of spans) {
      const range = spanCharRange(span);
      const start = range ? range[0] - base : -1;
      const end = range ? range[1] - base : -1;
      const slice = start >= 0 ? text.slice(start, end) : "";
      if (start < cursor || end > text.length || slice !== span.surface && slice.replace(/\s+/g, " ") !== span.surface) {
        // Surface may use a lexicon joiner that differs from raw substring; still place by range when possible.
        if (start < cursor || end > text.length || start < 0) {
          return '<p class="blurb">' + esc(text) + "</p>" +
            '<div class="gloss">' + spans.map(glossSpan).join("") + "</div>";
        }
      }
      if (start > cursor) html += '<span class="gloss-gap">' + esc(text.slice(cursor, start)) + "</span>";
      html += glossSpan(span);
      cursor = end;
    }
    if (cursor < text.length) html += '<span class="gloss-gap">' + esc(text.slice(cursor)) + "</span>";
    return '<p class="gloss" aria-label="' + esc(text) + '">' + html + "</p>";
  }

  function renderSentences() {
    const visible = state.sentences.filter(function (sentence) {
      const spans = spansForSentence(sentence.id);
      const surfaces = spans.map(function (span) { return span.surface; });
      const ids = spans.map(function (span) { return span.id; });
      if (spanFilterActive() && !spans.some(spanMatches)) return false;
      if (els.concept.value && !spans.some(function (span) { return span.entityId === els.concept.value; })) return false;
      if (!sentenceFrameMatches(sentence)) return false;
      return matchesText([sentence.id, sentence.text, sentence.original, sentence.section, sentence.state, ...surfaces, ...ids]);
    });
    if (visible.length === 0) {
      els.sentences.innerHTML = '<p class="empty">No sentences match these filters.</p>';
      return;
    }
    renderPage("sentences", els.sentences, visible, function (sentence) {
      return (
        '<article class="card">' +
        "<h2><span class=\\"id\\">" + esc(sentence.id) + "</span>" +
        pill(sentence.section) + pill(sentence.state, statusTone(sentence.state)) + "</h2>" +
        (sentence.original ? '<p class="original">was: ' + esc(sentence.original) + "</p>" : "") +
        glossHtml(sentence, spansForSentence(sentence.id)) +
        sentenceLineage(sentence) +
        "</article>"
      );
    });
  }

  function spanEntryKey(span) {
    return span.surface + "\\0" + (span.tags || []).join("|");
  }

  function isMultiTokenSpan(span) {
    return span.firstTokenId !== span.lastTokenId;
  }

  function uniqueSpanEntries(spans, multiTokenOnly) {
    const map = new Map();
    for (const span of spans) {
      if (multiTokenOnly && !isMultiTokenSpan(span)) continue;
      const key = spanEntryKey(span);
      let entry = map.get(key);
      if (!entry) {
        entry = {
          key: key,
          surface: span.surface,
          tags: (span.tags || []).slice(),
          insignificant: span.insignificant === true,
          spans: [],
        };
        map.set(key, entry);
      }
      entry.spans.push(span);
      if (span.insignificant !== true) entry.insignificant = false;
    }
    return Array.from(map.values());
  }

  function compareSpanEntries(left, right) {
    const leftPos = coarsePos(left.tags);
    const rightPos = coarsePos(right.tags);
    const leftIndex = POS_ORDER.indexOf(leftPos);
    const rightIndex = POS_ORDER.indexOf(rightPos);
    const leftOrder = leftIndex === -1 ? POS_ORDER.length : leftIndex;
    const rightOrder = rightIndex === -1 ? POS_ORDER.length : rightIndex;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    if (leftPos !== rightPos) return leftPos < rightPos ? -1 : 1;
    if (left.surface !== right.surface) return left.surface < right.surface ? -1 : 1;
    const leftLabel = posLabel(left.tags);
    const rightLabel = posLabel(right.tags);
    if (leftLabel !== rightLabel) return leftLabel < rightLabel ? -1 : 1;
    return 0;
  }

  function spanEntryLineage(entry) {
    const rows = [];
    for (const span of entry.spans) {
      const sentenceId = sentenceIdOfToken(span.firstTokenId);
      const sentence = indexSentences().get(sentenceId);
      rows.push({
        layer: "span",
        text: span.id + " “" + span.surface + "”" + (sentence ? " in " + sentenceId : ""),
        bits: [
          part("id", span.id),
          part("content", span.surface),
          ...(sentence ? [part("note", "in"), part("id", sentenceId)] : []),
        ],
      });
    }
    return lineageBlock(rows);
  }

  function spanEntryMeta(entry) {
    const clauses = [];
    const lemmas = [];
    for (const span of entry.spans) {
      const clause = span.clause && span.clause.text ? String(span.clause.text) : "";
      if (clause && clauses.indexOf(clause) < 0) clauses.push(clause);
      const lemma = span.lemma ? String(span.lemma) : "";
      if (lemma && lemmas.indexOf(lemma) < 0) lemmas.push(lemma);
    }
    let html = "";
    for (const clause of clauses) html += '<p class="span-clause">' + esc(clause) + "</p>";
    for (const lemma of lemmas) html += '<p class="span-lemma">' + esc(lemma) + "</p>";
    return html;
  }

  function spanEntryCard(entry) {
    const pos = coarsePos(entry.tags);
    const others = otherTags(entry.tags);
    const count = entry.spans.length;
    const skippedClass = entry.insignificant ? " skipped" : "";
    let pills = pill(pos || "Untagged");
    for (const tag of others) pills += pill(tag);
    if (entry.insignificant) pills += pill("skipped", "warn");
    const entryKey = entry.surface + "|" + (entry.tags || []).join("|");
    return (
      '<article class="card' + skippedClass + '" data-entry-key="' + esc(entryKey) + '">' +
      "<h2><span class=\\"id\\">" + esc(entry.surface) + "</span>" + pills + "</h2>" +
      '<p class="blurb">' + esc(count === 1 ? "1 occurrence" : count + " occurrences") + "</p>" +
      spanEntryMeta(entry) +
      spanEntryLineage(entry) +
      "</article>"
    );
  }

  function renderSpans() {
    const showInsignificant = els.insignificant.checked;
    const multiTokenOnly = els.multiToken.checked;
    const entries = uniqueSpanEntries(state.spans, multiTokenOnly).filter(function (entry) {
      if (!showInsignificant && entry.insignificant) return false;
      if (spanFilterActive() && !spanMatches({ tags: entry.tags })) return false;
      const ids = entry.spans.map(function (span) { return span.id; });
      return matchesText([entry.surface, posLabel(entry.tags), ...(entry.tags || []), ...ids]);
    }).sort(compareSpanEntries);
    if (entries.length === 0) {
      const listed = multiTokenOnly ? state.spans.filter(isMultiTokenSpan) : state.spans;
      let message = "No spans match these filters.";
      if (state.spans.length === 0) {
        message = "No live spans in this session.";
      } else if (listed.length === 0) {
        message = state.spans.length + " live spans, all single-token; uncheck Multi-token spans only to list them, " +
          "or merge spans with clew spec spans merge --lexicon <file> (or --id … --tags …), then refresh.";
      } else if (!showInsignificant && listed.every(function (span) { return span.insignificant === true; })) {
        message = "Every listed span is insignificant; check Show insignificant spans to list them.";
      }
      els.spans.innerHTML = '<p class="empty">' + esc(message) + "</p>";
      return;
    }
    const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    const page = Math.min(state.page.spans, pages - 1);
    state.page.spans = page;
    const slice = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    let html = pages > 1 ? pagerHtml("spans", page, pages, entries.length) : "";
    let lastPos = null;
    for (const entry of slice) {
      const pos = coarsePos(entry.tags) || "Untagged";
      if (pos !== lastPos) {
        html += '<h2 class="span-group">' + esc(pos) + "</h2>";
        lastPos = pos;
      }
      html += spanEntryCard(entry);
    }
    if (pages > 1) html += pagerHtml("spans", page, pages, entries.length);
    els.spans.innerHTML = html;
  }

  let graphTicket = 0;

  function loadGraphView() {
    const ticket = ++graphTicket;
    state.graphStatus = "loading";
    state.graphView = null;
    if (state.tab === "graph") renderGraph();
    return loadJson("draft-graph.json").then(function (doc) {
      if (ticket !== graphTicket) return;
      state.graphView = doc;
      state.graphStatus = "ready";
      if (state.tab === "graph") renderGraph();
    }).catch(function (error) {
      if (ticket !== graphTicket) return;
      state.graphView = {
        charts: [],
        workflows: [],
        findings: [],
        error: error && error.message ? error.message : String(error),
      };
      state.graphStatus = "ready";
      if (state.tab === "graph") renderGraph();
    });
  }

  function destroyGraphMounts() {
    for (const mount of state.graphMounts) {
      try { if (mount && mount.destroy) mount.destroy(); } catch (_) { /* ignore */ }
    }
    state.graphMounts = [];
  }

  function graphFallbackHtml(svg, alt) {
    if (!svg) return "";
    return '<div class="graph-fallback"><details><summary>Graphviz SVG</summary>' +
      '<img class="graph-image" alt="' + esc(alt) +
      '" src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '">' +
      "</details></div>";
  }

  function renderGraph() {
    destroyGraphMounts();
    if (state.graphStatus !== "ready") {
      els.graph.innerHTML = '<p class="empty">Drawing the graph…</p>';
      return;
    }
    const doc = state.graphView;
    if (!doc || doc.message) {
      const message = doc && doc.message ? doc.message : "no graph; run clew spec graph build";
      els.graph.innerHTML = '<p class="empty">' + esc(message) + "</p>";
      return;
    }
    let html = "";
    if (doc.error) html += '<p class="empty">' + esc(doc.error) + "</p>";
    html += "<h2>State chart</h2>";
    const charts = doc.charts || [];
    if (charts.length === 0) html += '<p class="empty">No state charts.</p>';
    charts.forEach(function (chart, index) {
      const alt = "State chart of " + chart.object;
      html += '<article class="graph-block" data-graph-kind="chart" data-graph-object="' + esc(chart.object) + '">';
      html += '<div class="graph-block-head"><h3>' + esc(chart.object) + "</h3></div>";
      html += '<div class="graph-stage">';
      html += '<div class="graph-canvas-wrap" data-graph-mount="chart-' + index + '" aria-label="' + esc(alt) + '"></div>';
      html += '<aside class="graph-detail" data-graph-detail="chart-' + index +
        '" hidden><p class="graph-detail-placeholder">Hover a node or edge for details.</p></aside>';
      html += "</div>";
      html += graphFallbackHtml(chart.svg, alt);
      html += "</article>";
    });
    html += "<h2>Workflows</h2>";
    const workflows = doc.workflows || [];
    if (workflows.length === 0) html += '<p class="empty">No workflows.</p>';
    workflows.forEach(function (flow, index) {
      const alt = flow.id + ": " + flow.title;
      html += '<article class="graph-block" data-graph-kind="workflow" data-graph-id="' + esc(flow.id) + '">';
      html += '<div class="graph-block-head"><h3>' + esc(flow.id) + ": " + esc(flow.title) + "</h3>";
      html += '<span class="expect">' + esc(flow.expect || "") + "</span></div>";
      html += '<div class="graph-stage">';
      html += '<div class="graph-canvas-wrap" data-graph-mount="workflow-' + index + '" aria-label="' + esc(alt) + '"></div>';
      html += '<aside class="graph-detail" data-graph-detail="workflow-' + index +
        '" hidden><p class="graph-detail-placeholder">Hover a node or edge for details.</p></aside>';
      html += "</div>";
      html += graphFallbackHtml(flow.svg, alt);
      html += "</article>";
    });
    const findings = doc.findings || [];
    if (findings.length > 0) {
      html += '<ul class="graph-skipped">';
      for (const finding of findings) html += "<li>" + esc(finding.message) + "</li>";
      html += "</ul>";
    }
    els.graph.innerHTML = html;
    if (!window.ClewInteractiveGraph || typeof window.ClewInteractiveGraph.mount !== "function") {
      const note = document.createElement("p");
      note.className = "empty";
      note.textContent = "Interactive graph assets failed to load. Open this page through clew spec view --open.";
      els.graph.prepend(note);
      return;
    }
    charts.forEach(function (chart, index) {
      const mountEl = els.graph.querySelector('[data-graph-mount="chart-' + index + '"]');
      const detailEl = els.graph.querySelector('[data-graph-detail="chart-' + index + '"]');
      if (!mountEl || !chart.interactive) return;
      try {
        state.graphMounts.push(window.ClewInteractiveGraph.mount(mountEl, chart.interactive, { detailPanel: detailEl }));
      } catch (error) {
        mountEl.innerHTML = '<p class="empty">' + esc(error && error.message ? error.message : String(error)) + "</p>";
      }
    });
    workflows.forEach(function (flow, index) {
      const mountEl = els.graph.querySelector('[data-graph-mount="workflow-' + index + '"]');
      const detailEl = els.graph.querySelector('[data-graph-detail="workflow-' + index + '"]');
      if (!mountEl || !flow.interactive) return;
      try {
        state.graphMounts.push(window.ClewInteractiveGraph.mount(mountEl, flow.interactive, { detailPanel: detailEl }));
      } catch (error) {
        mountEl.innerHTML = '<p class="empty">' + esc(error && error.message ? error.message : String(error)) + "</p>";
      }
    });
  }

  function render() {
    if (state.tab === "frames") renderFrames();
    else if (state.tab === "concepts") renderConcepts();
    else if (state.tab === "sentences") renderSentences();
    else if (state.tab === "spans") renderSpans();
    else if (state.tab === "graph") renderGraph();
  }

  function selectTab(name) {
    state.tab = name;
    for (const button of document.querySelectorAll(".tabs button")) {
      const selected = button.getAttribute("data-tab") === name;
      button.setAttribute("aria-selected", selected ? "true" : "false");
    }
    for (const panel of [["frames", els.frames], ["concepts", els.concepts], ["sentences", els.sentences], ["spans", els.spans], ["graph", els.graph]]) {
      const active = panel[0] === name;
      panel[1].classList.toggle("active", active);
      panel[1].hidden = !active;
    }
    render();
  }

  for (const button of document.querySelectorAll(".tabs button")) {
    button.addEventListener("click", function () {
      selectTab(button.getAttribute("data-tab"));
    });
  }
  function markSpan(event, on) {
    const ref = event.target instanceof Element ? event.target.closest(".line-span") : null;
    if (!ref) return;
    const card = ref.closest("article.card");
    if (!card) return;
    for (const word of card.querySelectorAll('.gloss-span[data-span="' + ref.getAttribute("data-span") + '"]')) {
      word.classList.toggle("hit", on);
    }
  }
  document.addEventListener("mouseover", function (event) { markSpan(event, true); });
  document.addEventListener("mouseout", function (event) { markSpan(event, false); });

  document.addEventListener("click", function (event) {
    const target = event.target;
    if (!target || !target.closest) return;
    const button = target.closest("button.lineage-tab");
    if (!button) return;
    const body = button.closest(".lineage-body");
    if (!body) return;
    const layer = button.getAttribute("data-layer");
    for (const tab of body.querySelectorAll("button.lineage-tab")) {
      tab.setAttribute("aria-selected", tab === button ? "true" : "false");
    }
    for (const pane of body.querySelectorAll(".lineage-pane")) {
      pane.hidden = pane.getAttribute("data-layer") !== layer;
    }
  });
  document.addEventListener("click", function (event) {
    const target = event.target;
    if (!target || !target.closest) return;
    const button = target.closest("nav.pager button");
    if (!button || button.disabled) return;
    const name = button.closest("nav.pager").getAttribute("data-tab");
    state.page[name] += button.getAttribute("data-page") === "next" ? 1 : -1;
    render();
    document.getElementById("panel-" + name).scrollIntoView({ block: "start" });
  });

  function resetPages() {
    state.page = { frames: 0, concepts: 0, sentences: 0, spans: 0 };
  }

  function filtersChanged() {
    resetPages();
    render();
  }

  for (const input of [els.text, els.frame, els.concept, els.span, els.insignificant, els.multiToken]) {
    input.addEventListener("input", filtersChanged);
    input.addEventListener("change", filtersChanged);
  }
  els.clear.addEventListener("click", function () {
    resetPages();
    els.text.value = "";
    els.frame.value = "";
    els.concept.value = "";
    els.span.value = "";
    els.insignificant.checked = false;
    els.multiToken.checked = false;
    render();
  });

  function localTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function setSessionOptions(ids, current) {
    const list = ids.indexOf(current) === -1 ? ids.concat([current]).sort() : ids;
    els.sessionId.replaceChildren.apply(els.sessionId, list.map(function (id) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      return opt;
    }));
    els.sessionId.value = current;
  }

  async function refreshSessionList() {
    try {
      const response = await fetch("./sessions.json", { cache: "no-store" });
      if (!response.ok) return;
      const doc = await response.json();
      const current = els.sessionId.value && els.sessionId.value !== "…" ? els.sessionId.value : doc.current;
      setSessionOptions(doc.sessions || [], current);
    } catch (error) {
      // file:// pages cannot list the store; the select keeps the loaded session.
    }
  }

  for (const name of ["pointerenter", "pointerdown", "focus"]) {
    els.sessionId.addEventListener(name, refreshSessionList);
  }
  els.sessionId.addEventListener("change", function () {
    selected = els.sessionId.value;
    const url = new URL(location.href);
    url.searchParams.set("session", selected);
    history.replaceState(null, "", url);
    load();
  });
  els.refresh.addEventListener("click", load);

  async function load() {
    els.refresh.disabled = true;
    try {
      await loadSession();
    } finally {
      els.refresh.disabled = false;
    }
  }

  async function loadSession() {
    try {
      const session = await loadJson("session.json");
      if (!session) throw new Error("session.json is missing");
      state.session = session;
      const sentencesFile = await loadJson("sentences.json");
      state.sentences = ((sentencesFile && sentencesFile.sentences) || []).map(sentenceView);
      const tokensFile = await loadJson("tokens.json");
      state.tagged = (tokensFile && tokensFile.sentences) || [];
      const spansFile = await loadJson("spans.json");
      state.spans = (spansFile && spansFile.spans) || [];
      const conceptsFile = await loadJson("concepts.json");
      state.concepts = (conceptsFile && conceptsFile.concepts) || [];
      const framesFile = await loadJson("frames.json");
      state.frames = (framesFile && framesFile.frames) || [];
      state.graph = await loadJson("graph.json");
      const graphReady = loadGraphView();
      setSessionOptions(Array.from(els.sessionId.options, function (opt) { return opt.value; })
        .filter(function (id) { return id !== "…"; }), session.id);
      els.meta.textContent = state.sentences.length + " sentences · " +
        state.spans.length + " spans · " +
        state.concepts.length + " concepts · " +
        state.frames.length + " frames";
      document.title = "Clew · " + session.id;
      fillSpanFilter();
      fillConceptFilter();
      els.banner.textContent = "Session updated " + localTime(session.updated) + " · loaded " + localTime(new Date());
      els.banner.classList.remove("error");
      render();
      await graphReady;
    } catch (error) {
      els.banner.textContent = "Could not load session JSON. Open this page through clew spec view --open (localhost), not as a file:// URL. " +
        (error && error.message ? error.message : String(error));
      els.banner.classList.add("error");
    }
  }

  load();
})();
</script>
</body>
</html>
`;

export function viewerHtml(version: string): string {
  return VIEWER_HTML.replace('__CLEW_VERSION__', version);
}
