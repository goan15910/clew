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
header h1 {
  margin: 0;
  font: 600 1.35rem/1.2 var(--sans);
  letter-spacing: -0.02em;
}
header p {
  margin: 0.35rem 0 0;
  color: var(--muted);
  font-size: 0.92rem;
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
.tabs { display: flex; gap: 0.35rem; flex-wrap: wrap; }
.tabs button, .filters button, details summary {
  font: inherit;
  cursor: pointer;
}
.tabs button {
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--ink);
  padding: 0.4rem 0.75rem;
  border-radius: 0.35rem;
}
.tabs button[aria-selected="true"] {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.filters {
  display: flex;
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
.filters button {
  border: 1px solid var(--line);
  background: var(--panel);
  padding: 0.4rem 0.7rem;
  border-radius: 0.35rem;
  align-self: end;
}
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
.line-note { color: var(--muted); font-size: 0.78rem; }
.tokens { margin-top: 0.45rem; display: flex; flex-wrap: wrap; gap: 0.35rem; }
.token {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  margin: 0;
  padding: 0.18rem 0.4rem;
  border-radius: 0.25rem;
  background: #ecfeff;
  border: 1px solid #a5f3fc;
}
.token-id {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--accent);
  background: #fff;
  border: 1px solid #99f6e4;
  border-radius: 0.2rem;
  padding: 0.02rem 0.28rem;
}
.token-text {
  font-family: var(--sans);
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--ink);
}
.empty { color: var(--muted); padding: 1.5rem 0; }
</style>
</head>
<body>
<header>
  <h1>Clew session <span class="meta" id="session-id">…</span></h1>
  <p id="session-meta">Loading session JSON…</p>
</header>
<div class="toolbar">
  <div class="tabs" role="tablist" aria-label="Views">
    <button type="button" role="tab" id="tab-facts" aria-selected="true" data-tab="facts">Facts</button>
    <button type="button" role="tab" id="tab-entities" aria-selected="false" data-tab="entities">Entities</button>
    <button type="button" role="tab" id="tab-sentences" aria-selected="false" data-tab="sentences">Sentences</button>
  </div>
  <div class="filters">
    <label>Search<input type="search" id="filter-text" placeholder="id or surface form"></label>
    <label>Entity kind<select id="filter-kind"><option value="">any</option></select></label>
    <label>Fact type<select id="filter-type"><option value="">any</option></select></label>
    <label>Fact status<select id="filter-status"><option value="">any</option><option>current</option><option>stale</option></select></label>
    <button type="button" id="filter-clear">Clear filters</button>
  </div>
</div>
<main>
  <p class="status" id="banner">Fetching session files…</p>
  <section class="panel active" id="panel-facts" role="tabpanel" aria-labelledby="tab-facts"></section>
  <section class="panel" id="panel-entities" role="tabpanel" aria-labelledby="tab-entities" hidden></section>
  <section class="panel" id="panel-sentences" role="tabpanel" aria-labelledby="tab-sentences" hidden></section>
</main>
<script>
(function () {
  const KINDS = ["actor", "object", "action", "condition"];
  const TYPES = ["performs", "transition", "guard", "initial", "final", "forbidden"];
  const state = {
    session: null,
    sentences: [],
    tagged: [],
    entities: [],
    facts: [],
    graph: null,
    tab: "facts",
  };

  const els = {
    sessionId: document.getElementById("session-id"),
    meta: document.getElementById("session-meta"),
    banner: document.getElementById("banner"),
    text: document.getElementById("filter-text"),
    kind: document.getElementById("filter-kind"),
    type: document.getElementById("filter-type"),
    status: document.getElementById("filter-status"),
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

  async function loadJson(name) {
    const response = await fetch("./" + name, { cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(name + " HTTP " + response.status);
    return response.json();
  }

  function indexTagged() {
    const map = new Map();
    for (const row of state.tagged) map.set(row.id, row);
    return map;
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

  const LINEAGE_ORDER = ["token", "sentence", "entity", "fact", "source", "transition", "state", "flow"];
  const LINEAGE_LABELS = {
    token: "Tokens",
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

  function tokenRow(id, token, withTags) {
    const tags = (token && token.tags) || [];
    const text = id + (token ? " “" + token.text + "”" + (withTags ? " [" + tags.join("|") + "]" : "") : "");
    const bits = [part("id", id)];
    if (token) {
      bits.push(part("content", token.text, true));
      if (withTags && tags.length) bits.push(part("type", tags.join(" · ")));
    }
    return { layer: "token", text: text, bits: bits };
  }

  function tokenIndex(id) {
    const match = /^s[1-9][0-9]*\.t([1-9][0-9]*)$/.exec(id);
    return match ? Number(match[1]) : null;
  }

  function consecutiveTokens(prev, next) {
    const left = tokenIndex(prev.id);
    const right = tokenIndex(next.id);
    return left !== null && right === left + 1;
  }

  function markedSentenceHtml(sentence, markTokens) {
    const text = sentence.text || "";
    const base = sentence.span && sentence.span.length === 2 ? sentence.span[0] : null;
    if (base === null || !markTokens.length) return esc(text);
    const ranges = [];
    for (const token of markTokens) {
      if (!token.span || token.span.length !== 2) continue;
      const start = token.span[0] - base;
      const end = token.span[1] - base;
      if (start < 0 || end > text.length || end <= start) continue;
      if (text.slice(start, end) !== token.text) continue;
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

  function sentenceRow(sentence, withSection, markTokens) {
    const text = withSection
      ? sentence.id + " [" + sentence.section + "] “" + sentence.text + "”"
      : sentence.id + " “" + sentence.text + "”";
    const bits = [part("id", sentence.id)];
    if (withSection) bits.push(part("type", sentence.section));
    const marks = markTokens || [];
    if (marks.length) {
      bits.push({ kind: "content", quoted: true, raw: true, html: markedSentenceHtml(sentence, marks) });
    } else {
      bits.push(part("content", sentence.text, true));
    }
    return { layer: "sentence", text: text, bits: bits };
  }

  function appendTokenSources(rows, sources, withSection) {
    const tokens = indexTokens();
    let run = [];
    function flush() {
      if (!run.length) return;
      const marks = run.map(function (hit) { return hit.token; });
      const sentence = sentenceById(run[0].sentenceId);
      if (sentence) rows.push(sentenceRow(sentence, withSection, marks));
      else {
        for (const hit of run) rows.push(tokenRow(hit.token.id, hit.token, true));
      }
      run = [];
    }
    for (const source of sources || []) {
      const hit = tokens.get(source);
      if (!hit) {
        flush();
        rows.push({ layer: "source", text: source, bits: [part("id", source)] });
        continue;
      }
      const prev = run[run.length - 1];
      if (prev && (prev.sentenceId !== hit.sentenceId || !consecutiveTokens(prev.token, hit.token))) flush();
      run.push(hit);
    }
    flush();
  }

  function factLineage(fact) {
    const entities = indexEntities();
    const tokens = indexTokens();
    const rows = [];
    const entityFields = ["actor", "action", "object", "condition"];
    for (const field of entityFields) {
      const id = fact[field];
      if (!id) continue;
      const entity = entities.get(id);
      const label = entity ? (entity.name || entity.text || id) : id;
      rows.push({
        layer: "entity",
        text: field + " → " + id + " (" + label + ")",
        bits: [part("type", field), part("note", "→"), part("id", id), part("content", label)],
      });
      if (entity) appendTokenSources(rows, entity.sources, false);
    }
    for (const source of fact.sources || []) {
      if (/^s[1-9][0-9]*$/.test(source)) {
        const sentence = sentenceById(source);
        rows.push(sentence
          ? sentenceRow(sentence, false)
          : { layer: "sentence", text: source, bits: [part("id", source)] });
      } else if (/^s[1-9][0-9]*\\.t[1-9][0-9]*$/.test(source)) {
        const hit = tokens.get(source);
        const sentence = hit ? sentenceById(hit.sentenceId) : null;
        if (sentence) rows.push(sentenceRow(sentence, false, [hit.token]));
        else rows.push(tokenRow(source, hit ? hit.token : null, false));
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
    appendTokenSources(rows, entity.sources, true);
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

  function sentenceLineage(sentence, tagged) {
    const rows = [];
    const tokens = (tagged && tagged.tokens) || [];
    for (const token of tokens) {
      rows.push(tokenRow(token.id, token, true));
    }
    for (const entity of state.entities) {
      for (const source of entity.sources || []) {
        if (source === sentence.id || source.indexOf(sentence.id + ".") === 0) {
          rows.push({
            layer: "entity",
            text: entity.id + " via " + source,
            bits: [part("id", entity.id), part("note", "via"), part("ref", source)],
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
            bits: [part("id", fact.id), part("type", fact.type), part("note", "via"), part("ref", source)],
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
    els.facts.innerHTML = visible.map(function (fact) {
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
    }).join("");
  }

  function renderEntities() {
    const kind = els.kind.value;
    const visible = state.entities.filter(function (entity) {
      if (kind && entity.kind !== kind) return false;
      return matchesText([entity.id, entity.kind, entity.name, entity.text, entity.note, ...(entity.sources || [])]);
    });
    if (visible.length === 0) {
      els.entities.innerHTML = '<p class="empty">No entities match these filters.</p>';
      return;
    }
    els.entities.innerHTML = visible.map(function (entity) {
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
    }).join("");
  }

  function renderSentences() {
    const tagged = indexTagged();
    const visible = state.sentences.filter(function (sentence) {
      const row = tagged.get(sentence.id);
      const tokenText = ((row && row.tokens) || []).map(function (token) { return token.text; });
      const tokenIds = ((row && row.tokens) || []).map(function (token) { return token.id; });
      return matchesText([sentence.id, sentence.text, sentence.section, sentence.status, ...tokenText, ...tokenIds]);
    });
    if (visible.length === 0) {
      els.sentences.innerHTML = '<p class="empty">No sentences match these filters.</p>';
      return;
    }
    els.sentences.innerHTML = visible.map(function (sentence) {
      const row = tagged.get(sentence.id);
      const tokens = ((row && row.tokens) || []).map(function (token) {
        return '<span class="token" title="' + esc((token.tags || []).join(", ")) + '">' +
          '<code class="token-id">' + esc(token.id) + "</code>" +
          '<span class="token-text">' + esc(token.text) + "</span></span>";
      }).join("");
      return (
        '<article class="card">' +
        "<h2><span class=\\"id\\">" + esc(sentence.id) + "</span>" +
        pill(sentence.section) + pill(sentence.status, statusTone(sentence.status)) + "</h2>" +
        '<p class="blurb">' + esc(sentence.text) + "</p>" +
        (tokens ? '<div class="tokens">' + tokens + "</div>" : "") +
        sentenceLineage(sentence, row) +
        "</article>"
      );
    }).join("");
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
  for (const input of [els.text, els.kind, els.type, els.status]) {
    input.addEventListener("input", render);
    input.addEventListener("change", render);
  }
  els.clear.addEventListener("click", function () {
    els.text.value = "";
    els.kind.value = "";
    els.type.value = "";
    els.status.value = "";
    render();
  });

  async function boot() {
    try {
      const session = await loadJson("session.json");
      if (!session) throw new Error("session.json is missing");
      state.session = session;
      const sentencesFile = await loadJson("sentences.json");
      state.sentences = (sentencesFile && sentencesFile.sentences) || [];
      const tokensFile = await loadJson("tokens.json");
      state.tagged = (tokensFile && tokensFile.sentences) || [];
      const entitiesFile = await loadJson("entities.json");
      state.entities = (entitiesFile && entitiesFile.entities) || [];
      const factsFile = await loadJson("facts.json");
      state.facts = (factsFile && factsFile.facts) || [];
      state.graph = await loadJson("graph.json");
      els.sessionId.textContent = session.id;
      els.meta.textContent = session.specPath + " · updated " + session.updated +
        " · " + state.sentences.length + " sentences, " +
        state.entities.length + " entities, " +
        state.facts.filter(function (fact) { return fact.removed !== true; }).length + " facts";
      document.title = "Clew · " + session.id;
      els.banner.textContent = "Loaded from session folder. Reload this page to pick up the latest JSON.";
      els.banner.classList.remove("error");
      render();
    } catch (error) {
      els.banner.textContent = "Could not load session JSON. Open this page through clew spec view --open (localhost), not as a file:// URL. " +
        (error && error.message ? error.message : String(error));
      els.banner.classList.add("error");
    }
  }

  boot();
})();
</script>
</body>
</html>
`;
