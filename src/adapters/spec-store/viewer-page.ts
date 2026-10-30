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
    <label>Entity kind<select id="filter-kind"><option value="">any</option></select></label>
    <label>Fact type<select id="filter-type"><option value="">any</option></select></label>
    <label>Fact status<select id="filter-status"><option value="">any</option><option>current</option><option>stale</option></select></label>
    <label>Span<select id="filter-span"><option value="">any</option></select></label>
    <label><input type="checkbox" id="filter-rejected">Show rejected entities</label>
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
      <button type="button" role="tab" id="tab-facts" aria-selected="true" data-tab="facts">Facts</button>
      <button type="button" role="tab" id="tab-entities" aria-selected="false" data-tab="entities">Entities</button>
      <button type="button" role="tab" id="tab-sentences" aria-selected="false" data-tab="sentences">Sentences</button>
    </div>
    <div class="tab-body">
      <section class="panel active" id="panel-facts" role="tabpanel" aria-labelledby="tab-facts"></section>
      <section class="panel" id="panel-entities" role="tabpanel" aria-labelledby="tab-entities" hidden></section>
      <section class="panel" id="panel-sentences" role="tabpanel" aria-labelledby="tab-sentences" hidden></section>
    </div>
  </div>
</main>
<script>
(function () {
  const KINDS = ["actor", "object", "action", "condition"];
  const TYPES = ["performs", "transition", "guard", "initial", "final", "forbidden"];
  const state = {
    session: null,
    sentences: [],
    tagged: [],
    spans: [],
    entities: [],
    facts: [],
    graph: null,
    tab: "facts",
    page: { facts: 0, entities: 0, sentences: 0 },
  };
  const PAGE_SIZE = 30;

  const els = {
    sessionId: document.getElementById("session-id"),
    meta: document.getElementById("session-meta"),
    banner: document.getElementById("banner"),
    refresh: document.getElementById("refresh"),
    text: document.getElementById("filter-text"),
    kind: document.getElementById("filter-kind"),
    type: document.getElementById("filter-type"),
    status: document.getElementById("filter-status"),
    span: document.getElementById("filter-span"),
    rejected: document.getElementById("filter-rejected"),
    clear: document.getElementById("filter-clear"),
    facts: document.getElementById("panel-facts"),
    entities: document.getElementById("panel-entities"),
    sentences: document.getElementById("panel-sentences"),
  };

  for (const kind of KINDS) {
    const opt = document.createElement("option");
    opt.value = kind;
    opt.textContent = kind;
    els.kind.appendChild(opt);
  }
  for (const type of TYPES) {
    const opt = document.createElement("option");
    opt.value = type;
    opt.textContent = type;
    els.type.appendChild(opt);
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
    if (status === "current" || status === "confirmed") return "ok";
    if (status === "stale" || status === "candidate") return "warn";
    if (status === "rejected") return "bad";
    return "";
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

  function entityShown(entity) {
    return els.rejected.checked || entity.status !== "rejected";
  }

  function indexEntities() {
    const map = new Map();
    for (const entity of state.entities) map.set(entity.id, entity);
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

  const LINEAGE_ORDER = ["span", "sentence", "entity", "fact", "source", "transition", "state", "flow"];
  const LINEAGE_LABELS = {
    span: "Spans",
    sentence: "Sentences",
    entity: "Entities",
    fact: "Facts",
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
      } else if (/^s[1-9][0-9]*\\.t[1-9][0-9]*$/.test(source)) {
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

  function factLineage(fact) {
    const entities = indexEntities();
    const rows = [];
    const entityFields = ["actor", "action", "object", "condition"];
    for (const field of entityFields) {
      const id = fact[field];
      if (!id) continue;
      const entity = entities.get(id);
      if (entity && !entityShown(entity)) continue;
      const label = entity ? (entity.name || entity.text || id) : id;
      rows.push({
        layer: "entity",
        text: field + " → " + id + " (" + label + ")",
        bits: [part("type", field), part("note", "→"), part("id", id), part("content", label)],
      });
      if (entity) appendSpanSources(rows, entity.sources);
    }
    for (const source of fact.sources || []) {
      if (/^s[1-9][0-9]*$/.test(source)) {
        const sentence = sentenceById(source);
        rows.push(sentence
          ? sentenceRow(sentence)
          : { layer: "sentence", text: source, bits: [part("id", source)] });
      } else if (/^s[1-9][0-9]*\\.t[1-9][0-9]*$/.test(source) || /^sp:/.test(source)) {
        const span = /^sp:/.test(source) ? indexSpans().get(source) : spanForToken(source);
        const sentence = span ? sentenceById(sentenceIdOfToken(span.firstTokenId)) : null;
        if (sentence && span) rows.push(spanSentenceRow(sentence, [span]));
        else if (span) rows.push(spanRow(span, false));
        else rows.push({ layer: "source", text: source, bits: [part("id", source)] });
      } else {
        rows.push({ layer: "source", text: source, bits: [part("id", source)] });
      }
    }
    if (state.graph) {
      for (const transition of state.graph.transitions || []) {
        if (transition.fact === fact.id || (transition.facts || []).indexOf(fact.id) >= 0) {
          rows.push({
            layer: "transition",
            text: transition.id + " " + transition.from + " -" + transition.event + "→ " + transition.to,
            bits: [
              part("id", transition.id),
              part("up", transition.from),
              part("type", transition.event),
              part("note", "→"),
              part("down", transition.to),
            ],
          });
        }
      }
      for (const graphState of state.graph.states || []) {
        if ((graphState.facts || []).indexOf(fact.id) >= 0) {
          rows.push({
            layer: "state",
            text: graphState.id + " (" + graphState.object + ")",
            bits: [part("id", graphState.id), part("content", graphState.object)],
          });
        }
      }
      for (const flow of state.graph.flows || []) {
        if (flow.forbidden === fact.id) {
          rows.push({
            layer: "flow",
            text: flow.id + " forbidden " + fact.id,
            bits: [part("id", flow.id), part("type", "forbidden"), part("ref", fact.id)],
          });
        }
      }
    }
    return lineageBlock(rows);
  }

  function entityLineage(entity) {
    const rows = [];
    appendSpanSources(rows, entity.sources);
    for (const fact of state.facts) {
      const refs = [fact.actor, fact.action, fact.object, fact.condition];
      if (refs.indexOf(entity.id) >= 0) {
        rows.push({
          layer: "fact",
          text: fact.id + " " + fact.type,
          bits: [part("id", fact.id), part("type", fact.type)],
        });
      }
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
    if (/^s[1-9][0-9]*\\.t[1-9][0-9]*$/.test(source)) {
      const span = spanForToken(source);
      return span
        ? { kind: "span", value: span.surface, span: span.id, skipped: span.insignificant === true }
        : part("ref", source);
    }
    return part("ref", source);
  }

  function sentenceLineage(sentence) {
    const rows = [];
    for (const entity of state.entities.filter(entityShown)) {
      for (const source of entity.sources || []) {
        if (source === sentence.id || source.indexOf(sentence.id + ".") === 0) {
          rows.push({
            layer: "entity",
            text: entity.id + " via " + source,
            bits: [part("id", entity.id), part("note", "via"), viaPart(source)],
          });
          break;
        }
      }
    }
    for (const fact of state.facts) {
      for (const source of fact.sources || []) {
        if (source === sentence.id || source.indexOf(sentence.id + ".") === 0) {
          rows.push({
            layer: "fact",
            text: fact.id + " " + fact.type + " via " + source,
            bits: [part("id", fact.id), part("type", fact.type), part("note", "via"), viaPart(source)],
          });
          break;
        }
      }
    }
    return lineageBlock(rows);
  }

  function renderFacts() {
    const kind = els.kind.value;
    const type = els.type.value;
    const status = els.status.value;
    const entities = indexEntities();
    const visible = state.facts.filter(function (fact) {
      if (fact.removed === true) return false;
      if (type && fact.type !== type) return false;
      if (status && fact.status !== status) return false;
      if (kind) {
        const ids = [fact.actor, fact.action, fact.object, fact.condition];
        let hit = false;
        for (const id of ids) {
          const entity = id ? entities.get(id) : null;
          if (entity && entity.kind === kind) hit = true;
        }
        if (!hit) return false;
      }
      return matchesText([
        fact.id, fact.type, fact.actor, fact.action, fact.object, fact.condition, fact.state, fact.from, fact.to, fact.note,
        ...(fact.sources || []),
      ]);
    });
    if (visible.length === 0) {
      els.facts.innerHTML = '<p class="empty">No facts match these filters.</p>';
      return;
    }
    renderPage("facts", els.facts, visible, function (fact) {
      const bits = [];
      if (fact.actor) bits.push("actor " + fact.actor);
      if (fact.action) bits.push("action " + fact.action);
      if (fact.object) bits.push("object " + fact.object);
      if (fact.from !== undefined) bits.push("from " + String(fact.from));
      if (fact.to) bits.push("to " + fact.to);
      if (fact.condition) bits.push("when " + fact.condition);
      if (fact.state) bits.push("state " + fact.state);
      return (
        '<article class="card">' +
        "<h2><span class=\\"id\\">" + esc(fact.id) + "</span>" +
        pill(fact.type) + pill(fact.status, statusTone(fact.status)) +
        pill(fact.origin) +
        "<span class=\\"pill\\">" + esc(String(fact.confidence)) + "</span></h2>" +
        '<p class="blurb">' + esc(bits.join(" · ") || "no roles") + "</p>" +
        factLineage(fact) +
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

  function renderEntities() {
    const kind = els.kind.value;
    const visible = state.entities.filter(function (entity) {
      if (!entityShown(entity)) return false;
      if (kind && entity.kind !== kind) return false;
      return matchesText([entity.id, entity.kind, entity.name, entity.text, entity.note, ...(entity.sources || [])]);
    });
    if (visible.length === 0) {
      els.entities.innerHTML = '<p class="empty">No entities match these filters.</p>';
      return;
    }
    renderPage("entities", els.entities, visible, function (entity) {
      const label = entity.name || entity.text || "";
      return (
        '<article class="card">' +
        "<h2><span class=\\"id\\">" + esc(entity.id) + "</span>" +
        pill(entity.kind) + pill(entity.status, statusTone(entity.status)) +
        pill(entity.origin) + "</h2>" +
        (label ? '<p class="blurb">' + esc(label) + "</p>" : "") +
        entityLineage(entity) +
        "</article>"
      );
    });
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
      return matchesText([sentence.id, sentence.text, sentence.section, sentence.status, ...surfaces, ...ids]);
    });
    if (visible.length === 0) {
      els.sentences.innerHTML = '<p class="empty">No sentences match these filters.</p>';
      return;
    }
    renderPage("sentences", els.sentences, visible, function (sentence) {
      return (
        '<article class="card">' +
        "<h2><span class=\\"id\\">" + esc(sentence.id) + "</span>" +
        pill(sentence.section) + pill(sentence.status, statusTone(sentence.status)) + "</h2>" +
        glossHtml(sentence, spansForSentence(sentence.id)) +
        sentenceLineage(sentence) +
        "</article>"
      );
    });
  }

  function render() {
    if (state.tab === "facts") renderFacts();
    else if (state.tab === "entities") renderEntities();
    else renderSentences();
  }

  function selectTab(name) {
    state.tab = name;
    for (const button of document.querySelectorAll(".tabs button")) {
      const selected = button.getAttribute("data-tab") === name;
      button.setAttribute("aria-selected", selected ? "true" : "false");
    }
    for (const panel of [["facts", els.facts], ["entities", els.entities], ["sentences", els.sentences]]) {
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
    state.page = { facts: 0, entities: 0, sentences: 0 };
  }

  function filtersChanged() {
    resetPages();
    render();
  }

  for (const input of [els.text, els.kind, els.type, els.status, els.span, els.rejected]) {
    input.addEventListener("input", filtersChanged);
    input.addEventListener("change", filtersChanged);
  }
  els.clear.addEventListener("click", function () {
    resetPages();
    els.text.value = "";
    els.kind.value = "";
    els.type.value = "";
    els.status.value = "";
    els.span.value = "";
    els.rejected.checked = false;
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
      state.sentences = (sentencesFile && sentencesFile.sentences) || [];
      const tokensFile = await loadJson("tokens.json");
      state.tagged = (tokensFile && tokensFile.sentences) || [];
      const spansFile = await loadJson("spans.json");
      state.spans = (spansFile && spansFile.spans) || [];
      const entitiesFile = await loadJson("entities.json");
      state.entities = (entitiesFile && entitiesFile.entities) || [];
      const factsFile = await loadJson("facts.json");
      state.facts = (factsFile && factsFile.facts) || [];
      state.graph = await loadJson("graph.json");
      setSessionOptions(Array.from(els.sessionId.options, function (opt) { return opt.value; })
        .filter(function (id) { return id !== "…"; }), session.id);
      els.meta.textContent = state.sentences.length + " sentences · " +
        state.spans.length + " spans · " +
        state.entities.length + " entities · " +
        state.facts.filter(function (fact) { return fact.removed !== true; }).length + " facts";
      document.title = "Clew · " + session.id;
      fillSpanFilter();
      els.banner.textContent = "Session updated " + localTime(session.updated) + " · loaded " + localTime(new Date());
      els.banner.classList.remove("error");
      render();
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
