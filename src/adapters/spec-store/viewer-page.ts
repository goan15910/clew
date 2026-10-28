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
.lineage-body { margin-top: 0.45rem; display: grid; gap: 0.35rem; }
.line {
  font-size: 0.86rem;
  padding: 0.35rem 0.45rem;
  background: #fafaf9;
  border-radius: 0.3rem;
  border: 1px solid #e7e5e4;
}
.line .layer { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); margin-right: 0.4rem; }
.token {
  display: inline-block;
  font-family: var(--mono);
  font-size: 0.78rem;
  margin: 0.15rem 0.2rem 0 0;
  padding: 0.15rem 0.35rem;
  border-radius: 0.25rem;
  background: #ecfeff;
  border: 1px solid #a5f3fc;
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

  function lineageBlock(rows) {
    if (rows.length === 0) {
      return '<details class="lineage"><summary>Lineage</summary><div class="lineage-body"><div class="line">No lineage links.</div></div></details>';
    }
    const body = rows.map(function (row) {
      return '<div class="line"><span class="layer">' + esc(row.layer) + "</span>" + esc(row.text) + "</div>";
    }).join("");
    return '<details class="lineage"><summary>Lineage (' + rows.length + ")</summary><div class="lineage-body">' + body + "</div></details>";
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
      rows.push({ layer: "entity", text: field + " → " + id + " (" + label + ")" });
      if (entity) {
        for (const source of entity.sources || []) {
          const hit = tokens.get(source);
          if (hit) {
            rows.push({ layer: "token", text: source + " “" + hit.token.text + "” [" + (hit.token.tags || []).join("|") + "]" });
            const sentence = sentenceById(hit.sentenceId);
            if (sentence) rows.push({ layer: "sentence", text: sentence.id + " “" + sentence.text + "”" });
          } else {
            rows.push({ layer: "source", text: source });
          }
        }
      }
    }
    for (const source of fact.sources || []) {
      if (/^s[1-9][0-9]*$/.test(source)) {
        const sentence = sentenceById(source);
        rows.push({ layer: "sentence", text: source + (sentence ? " “" + sentence.text + "”" : "") });
      } else if (/^s[1-9][0-9]*\\.t[1-9][0-9]*$/.test(source)) {
        const hit = tokens.get(source);
        rows.push({ layer: "token", text: source + (hit ? " “" + hit.token.text + "”" : "") });
        if (hit) {
          const sentence = sentenceById(hit.sentenceId);
          if (sentence) rows.push({ layer: "sentence", text: sentence.id + " “" + sentence.text + "”" });
        }
      } else {
        rows.push({ layer: "source", text: source });
      }
    }
    if (state.graph) {
      for (const transition of state.graph.transitions || []) {
        if (transition.fact === fact.id || (transition.facts || []).indexOf(fact.id) >= 0) {
          rows.push({ layer: "transition", text: transition.id + " " + transition.from + " -" + transition.event + "→ " + transition.to });
        }
      }
      for (const graphState of state.graph.states || []) {
        if ((graphState.facts || []).indexOf(fact.id) >= 0) {
          rows.push({ layer: "state", text: graphState.id + " (" + graphState.object + ")" });
        }
      }
      for (const flow of state.graph.flows || []) {
        if (flow.forbidden === fact.id) rows.push({ layer: "flow", text: flow.id + " forbidden " + fact.id });
      }
    }
    return lineageBlock(rows);
  }

  function entityLineage(entity) {
    const tokens = indexTokens();
    const rows = [];
    for (const source of entity.sources || []) {
      const hit = tokens.get(source);
      if (hit) {
        rows.push({ layer: "token", text: source + " “" + hit.token.text + "” [" + (hit.token.tags || []).join("|") + "]" });
        const sentence = sentenceById(hit.sentenceId);
        if (sentence) rows.push({ layer: "sentence", text: sentence.id + " [" + sentence.section + "] “" + sentence.text + "”" });
      } else {
        rows.push({ layer: "source", text: source });
      }
    }
    for (const fact of state.facts) {
      const refs = [fact.actor, fact.action, fact.object, fact.condition];
      if (refs.indexOf(entity.id) >= 0) {
        rows.push({ layer: "fact", text: fact.id + " " + fact.type });
      }
    }
    return lineageBlock(rows);
  }

  function sentenceLineage(sentence, tagged) {
    const rows = [];
    const tokens = (tagged && tagged.tokens) || [];
    for (const token of tokens) {
      rows.push({ layer: "token", text: token.id + " “" + token.text + "” [" + (token.tags || []).join("|") + "]" });
    }
    for (const entity of state.entities) {
      for (const source of entity.sources || []) {
        if (source === sentence.id || source.indexOf(sentence.id + ".") === 0) {
          rows.push({ layer: "entity", text: entity.id + " via " + source });
          break;
        }
      }
    }
    for (const fact of state.facts) {
      for (const source of fact.sources || []) {
        if (source === sentence.id || source.indexOf(sentence.id + ".") === 0) {
          rows.push({ layer: "fact", text: fact.id + " " + fact.type + " via " + source });
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
          esc(token.id) + " " + esc(token.text) + "</span>";
      }).join("");
      return (
        '<article class="card">' +
        "<h2><span class=\\"id\\">" + esc(sentence.id) + "</span>" +
        pill(sentence.section) + pill(sentence.status, statusTone(sentence.status)) + "</h2>" +
        '<p class="blurb">' + esc(sentence.text) + "</p>" +
        (tokens ? '<div style="margin-top:0.45rem">' + tokens + "</div>" : "") +
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
