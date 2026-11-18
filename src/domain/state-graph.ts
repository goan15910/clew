// The reachable state graph of a TLA+ model, as TLC dumps it (`-dump dot,actionlabels`), and what Clew computes on
// it: a projection onto some variables, how strongly variables go together, and Graphviz text for a picture.
// Engine-agnostic from the graph down: nothing below `readTlcDot` knows about TLC. See docs/projection.md.

export interface GraphState {
  id: string;
  /** Variable name → value as TLC prints it. A function value also has one entry per key: `l2_status[l21]`. */
  values: Record<string, string>;
  initial: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** The action name, without arguments. */
  action: string;
  /** The action as TLC labels the step, arguments included. */
  label: string;
}

export interface StateGraph {
  /** Declared variables, in the order TLC prints them. */
  variables: string[];
  /** The parts of function-valued variables: `l2_status[l21]`. */
  parts: string[];
  states: GraphState[];
  edges: GraphEdge[];
}

function unescape(label: string): string {
  return label.replace(/\\\\/g, '\u0000').replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\u0000/g, '\\');
}

/** Split `a |-> x, b |-> y` at the commas that stand outside every bracket and string. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (char === '"') {
      index += 1;
      while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1;
    } else if (char === '[' || char === '(' || char === '{' || text.startsWith('<<', index)) depth += 1;
    else if (char === ']' || char === ')' || char === '}' || text.startsWith('>>', index)) depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/** A TLC value without the quotes of a plain string. */
export function plainValue(value: string): string {
  return /^"[^"]*"$/.test(value) ? value.slice(1, -1) : value;
}

/** The keys of a function value: `[a |-> 1, b |-> 2]` or `(a :> 1 @@ b :> 2)`. Undefined when it is not one. */
export function functionParts(value: string): [string, string][] | undefined {
  const record = /^\[(.*)\]$/s.exec(value);
  if (record !== null && record[1] !== undefined && record[1].includes('|->')) {
    const out: [string, string][] = [];
    for (const part of splitTop(record[1])) {
      const at = part.indexOf('|->');
      if (at < 0) return undefined;
      out.push([part.slice(0, at).trim(), part.slice(at + 3).trim()]);
    }
    return out;
  }
  const paired = /^\((.*)\)$/s.exec(value);
  if (paired !== null && paired[1] !== undefined && paired[1].includes(':>')) {
    const out: [string, string][] = [];
    for (const part of paired[1].split('@@')) {
      const at = part.indexOf(':>');
      if (at < 0) return undefined;
      out.push([plainValue(part.slice(0, at).trim()), part.slice(at + 2).trim()]);
    }
    return out;
  }
  return undefined;
}

function stateValues(label: string): { values: Record<string, string>; variables: string[]; parts: string[] } {
  const values: Record<string, string> = {};
  const variables: string[] = [];
  const parts: string[] = [];
  // One conjunct per variable; a value may run over several lines.
  const chunks = label.split(/(?:^|\n)\/\\ /).filter((chunk) => chunk.trim() !== '');
  for (const chunk of chunks.length === 0 ? [label] : chunks) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*) = ([\s\S]*)$/.exec(chunk.trim());
    if (match === null || match[1] === undefined || match[2] === undefined) continue;
    const value = match[2].replace(/\s*\n\s*/g, ' ').trim();
    values[match[1]] = value;
    variables.push(match[1]);
    for (const [key, part] of functionParts(value) ?? []) {
      values[`${match[1]}[${key}]`] = part;
      parts.push(`${match[1]}[${key}]`);
    }
  }
  return { values, variables, parts };
}

const LABEL = '"((?:[^"\\\\]|\\\\.)*)"';
const NODE = new RegExp(`^(-?\\d+) \\[label=${LABEL}(.*)$`);
const EDGE = new RegExp(`^(-?\\d+) -> (-?\\d+)(?: \\[label=${LABEL})?`);

/** Read `tlc -dump dot,actionlabels`. Without `actionlabels` every step is named `step`. */
export function readTlcDot(text: string): { ok: true; graph: StateGraph } | { ok: false; message: string } {
  const states = new Map<string, GraphState>();
  const edges: GraphEdge[] = [];
  let variables: string[] = [];
  let parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    if (line.startsWith('subgraph cluster_legend')) break;
    const edge = EDGE.exec(line);
    if (edge !== null && edge[1] !== undefined && edge[2] !== undefined) {
      const label = edge[3] === undefined ? 'step' : unescape(edge[3]);
      edges.push({ from: edge[1], to: edge[2], action: /^[A-Za-z_][A-Za-z0-9_]*/.exec(label)?.[0] ?? label, label });
      continue;
    }
    const node = NODE.exec(line);
    if (node === null || node[1] === undefined || node[2] === undefined || states.has(node[1])) continue;
    const read = stateValues(unescape(node[2]));
    if (states.size === 0) {
      variables = read.variables;
      parts = read.parts;
    }
    states.set(node[1], { id: node[1], values: read.values, initial: /style\s*=\s*filled/.test(node[3] ?? '') });
  }
  if (states.size === 0) return { ok: false, message: 'no states found: expected the output of tlc -dump dot,actionlabels <file>' };
  return { ok: true, graph: { variables, parts, states: [...states.values()], edges } };
}

export interface ViewState {
  id: string;
  values: Record<string, string>;
  initial: boolean;
  /** States of the full graph behind this one. */
  members: number;
  /** No step leaves it for another state. */
  terminal: boolean;
}

export interface ViewEdge {
  from: string;
  to: string;
  action: string;
  /** Members of the source state the step is possible from. */
  sources: number;
  /** Possible from every state behind its source: it never waits on a hidden variable. */
  certain: boolean;
}

export interface GraphView {
  variables: string[];
  states: ViewState[];
  edges: ViewEdge[];
  /** Share of the edges that are certain. 1 for a graph that hides nothing. */
  exactness: number;
  fullStates: number;
  fullEdges: number;
}

/**
 * Keep some variables: states that agree on them become one state, and a step that changes none of them disappears.
 * An edge is certain when every state behind its source can take it, and possible otherwise.
 */
export function projectGraph(graph: StateGraph, keep: readonly string[]): { ok: true; view: GraphView } | { ok: false; message: string } {
  const known = new Set([...graph.variables, ...graph.parts]);
  const unknown = keep.filter((name) => !known.has(name));
  if (unknown.length > 0) return { ok: false, message: `the graph has no variable ${unknown.join(', ')}; it has ${[...graph.variables, ...graph.parts].join(', ')}` };
  const variables = keep.length === 0 ? graph.variables : [...keep];
  const hidesNothing = graph.variables.every((name) => variables.includes(name));
  const keyOf = new Map<string, string>();
  const groups = new Map<string, ViewState>();
  for (const state of graph.states) {
    const key = variables.map((name) => state.values[name] ?? '').join(' | ');
    keyOf.set(state.id, key);
    const group = groups.get(key);
    if (group === undefined) {
      const values: Record<string, string> = {};
      for (const name of variables) values[name] = state.values[name] ?? '';
      groups.set(key, { id: `n${groups.size + 1}`, values, initial: state.initial, members: 1, terminal: true });
    } else {
      group.members += 1;
      if (state.initial) group.initial = true;
    }
  }
  const edges = new Map<string, ViewEdge & { seen: Set<string> }>();
  for (const edge of graph.edges) {
    const from = groups.get(keyOf.get(edge.from) ?? '');
    const to = groups.get(keyOf.get(edge.to) ?? '');
    if (from === undefined || to === undefined) continue;
    // A step inside one view state is a hidden step, unless the graph hides nothing and it is a real self-loop.
    if (from === to && !hidesNothing) continue;
    if (from !== to) from.terminal = false;
    const id = `${from.id}|${edge.action}|${to.id}`;
    let entry = edges.get(id);
    if (entry === undefined) {
      entry = { from: from.id, to: to.id, action: edge.action, sources: 0, certain: false, seen: new Set() };
      edges.set(id, entry);
    }
    entry.seen.add(edge.from);
  }
  const membersOf = new Map([...groups.values()].map((state) => [state.id, state.members]));
  const list: ViewEdge[] = [];
  let certain = 0;
  for (const entry of edges.values()) {
    const sources = entry.seen.size;
    const isCertain = sources === (membersOf.get(entry.from) ?? 0);
    if (isCertain) certain += 1;
    list.push({ from: entry.from, to: entry.to, action: entry.action, sources, certain: isCertain });
  }
  return { ok: true, view: { variables, states: [...groups.values()], edges: list, exactness: list.length === 0 ? 1 : certain / list.length, fullStates: graph.states.length, fullEdges: graph.edges.length } };
}

export interface VariableStats {
  name: string;
  /** Each value and the number of reachable states that have it. */
  values: { value: string; states: number }[];
  /** Steps that change it. */
  changes: number;
}

export interface PairStats {
  a: string;
  b: string;
  /** Normalised mutual information over the reachable states: 0 independent, 1 one determines the other. */
  correlation: number;
  /** Of the steps that change either, the share that change both. */
  changeTogether: number;
  /** `a determines b`: every value of `a` goes with one value of `b`. */
  determines?: 'a' | 'b' | 'both';
  /** Value pairs that never occur together although each value occurs, at most five. */
  never: { a: string; b: string }[];
  neverCount: number;
}

export interface GraphStats {
  states: number;
  edges: number;
  variables: VariableStats[];
  pairs: PairStats[];
}

function entropy(counts: Iterable<number>, total: number): number {
  let sum = 0;
  for (const count of counts) if (count > 0) sum -= (count / total) * Math.log2(count / total);
  return sum;
}

/** How the variables go together over the reachable states and steps. `names` may hold parts such as `l2_status[l21]`. */
export function graphStats(graph: StateGraph, names: readonly string[] = graph.variables): GraphStats {
  const total = graph.states.length;
  const byId = new Map(graph.states.map((state) => [state.id, state]));
  const counts = new Map<string, Map<string, number>>(names.map((name) => [name, new Map()]));
  for (const state of graph.states) {
    for (const name of names) {
      const value = state.values[name] ?? '';
      const of = counts.get(name);
      of?.set(value, (of.get(value) ?? 0) + 1);
    }
  }
  const changes = new Map<string, number>(names.map((name) => [name, 0]));
  const both = new Map<string, number>();
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const changed = names.filter((name) => from.values[name] !== to.values[name]);
    for (const name of changed) changes.set(name, (changes.get(name) ?? 0) + 1);
    for (let first = 0; first < changed.length; first += 1) {
      for (let second = first + 1; second < changed.length; second += 1) {
        const key = `${changed[first] ?? ''}|${changed[second] ?? ''}`;
        both.set(key, (both.get(key) ?? 0) + 1);
      }
    }
  }
  const variables: VariableStats[] = names.map((name) => ({
    name,
    values: [...(counts.get(name) ?? [])].map(([value, states]) => ({ value: plainValue(value), states })).sort((a, b) => b.states - a.states),
    changes: changes.get(name) ?? 0,
  }));
  const pairs: PairStats[] = [];
  for (let first = 0; first < names.length; first += 1) {
    for (let second = first + 1; second < names.length; second += 1) {
      const a = names[first] ?? '';
      const b = names[second] ?? '';
      const countsA = counts.get(a) ?? new Map<string, number>();
      const countsB = counts.get(b) ?? new Map<string, number>();
      if (countsA.size < 2 || countsB.size < 2) continue;
      const joint = new Map<string, number>();
      for (const state of graph.states) {
        const key = `${state.values[a] ?? ''}\u0000${state.values[b] ?? ''}`;
        joint.set(key, (joint.get(key) ?? 0) + 1);
      }
      const ha = entropy(countsA.values(), total);
      const hb = entropy(countsB.values(), total);
      const hab = entropy(joint.values(), total);
      const floor = Math.min(ha, hb);
      const correlation = floor === 0 ? 0 : Math.max(0, Math.min(1, (ha + hb - hab) / floor));
      const changedBoth = both.get(`${a}|${b}`) ?? 0;
      const changedEither = (changes.get(a) ?? 0) + (changes.get(b) ?? 0) - changedBoth;
      const never: PairStats['never'] = [];
      let neverCount = 0;
      for (const valueA of countsA.keys()) {
        for (const valueB of countsB.keys()) {
          if (joint.has(`${valueA}\u0000${valueB}`)) continue;
          neverCount += 1;
          if (never.length < 5) never.push({ a: plainValue(valueA), b: plainValue(valueB) });
        }
      }
      const pair: PairStats = { a, b, correlation, changeTogether: changedEither === 0 ? 0 : changedBoth / changedEither, never, neverCount };
      const aDetermines = Math.abs(hab - ha) < 1e-9;
      const bDetermines = Math.abs(hab - hb) < 1e-9;
      if (aDetermines && bDetermines) pair.determines = 'both';
      else if (aDetermines) pair.determines = 'a';
      else if (bDetermines) pair.determines = 'b';
      pairs.push(pair);
    }
  }
  pairs.sort((x, y) => y.correlation + y.changeTogether - (x.correlation + x.changeTogether));
  return { states: total, edges: graph.edges.length, variables, pairs };
}

export interface DotOptions {
  title?: string;
  /** Edges to draw in the highlight colour, by `from|action|to`, in order. */
  path?: readonly string[];
  /** Left to right (default) or top to bottom. */
  direction?: 'LR' | 'TB';
}

function dotText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** A short form of a TLC value for a node label: `[l21 |-> "mapped", l22 |-> "null"]` → `l21: mapped, l22: null`. */
export function shortValue(value: string): string {
  const parts = functionParts(value);
  if (parts === undefined) return plainValue(value);
  return parts.map(([key, part]) => `${key}: ${shortValue(part)}`).join(', ');
}

export function stateLabel(view: Pick<GraphView, 'variables'>, state: ViewState): string[] {
  if (view.variables.length === 1) return [shortValue(state.values[view.variables[0] ?? ''] ?? '')];
  return view.variables.map((name) => `${name.replace(/_status(?=$|\[)/, '')} = ${shortValue(state.values[name] ?? '')}`);
}

/** Graphviz text of a view: solid edges are certain, dashed ones depend on hidden variables. */
export function viewDot(view: GraphView, options: DotOptions = {}): string {
  const lines: string[] = ['digraph view {'];
  lines.push(`  rankdir=${options.direction ?? 'LR'}; bgcolor="white"; nodesep=0.35; ranksep=0.6;`);
  if (options.title !== undefined) lines.push(`  label="${dotText(options.title)}"; labelloc="t"; fontname="Helvetica"; fontsize=13;`);
  lines.push('  node [shape=box, style="rounded,filled", fillcolor="#f7f8fa", color="#5b6472", fontname="Helvetica", fontsize=11, margin="0.12,0.07"];');
  lines.push('  edge [color="#5b6472", fontname="Helvetica", fontsize=9, arrowsize=0.7];');
  const onPath = new Set(options.path ?? []);
  const pathStates = new Set<string>();
  for (const key of onPath) {
    const [from, , to] = key.split('|');
    if (from !== undefined) pathStates.add(from);
    if (to !== undefined) pathStates.add(to);
  }
  let starts = 0;
  for (const state of view.states) {
    const label = stateLabel(view, state).map(dotText).join('\\n');
    const attributes = [`label="${label}"`];
    if (state.terminal) attributes.push('peripheries=2');
    if (pathStates.has(state.id)) attributes.push('color="#c2410c"', 'penwidth=2', 'fillcolor="#fff3e8"');
    if (view.fullStates > view.states.length) attributes.push(`tooltip="${state.members} of ${view.fullStates} states"`);
    lines.push(`  ${state.id} [${attributes.join(', ')}];`);
    if (state.initial) {
      starts += 1;
      lines.push(`  start${starts} [shape=point, width=0.12, style=filled, color="#111827", fillcolor="#111827", label=""];`);
      lines.push(`  start${starts} -> ${state.id};`);
    }
  }
  // One arrow per pair of states: the actions that take it are listed on it.
  const arrows = new Map<string, ViewEdge[]>();
  for (const edge of view.edges) {
    const key = `${edge.from}|${edge.to}|${edge.certain ? 'c' : 'p'}|${onPath.has(`${edge.from}|${edge.action}|${edge.to}`) ? 'h' : ''}`;
    arrows.set(key, [...(arrows.get(key) ?? []), edge]);
  }
  for (const group of arrows.values()) {
    const first = group[0];
    if (first === undefined) continue;
    const names = [...new Set(group.map((edge) => edge.action))];
    const shown = names.length > 6 ? [...names.slice(0, 5), `+${names.length - 5} more`] : names;
    const attributes = [`label="${shown.map(dotText).join('\\n')}"`];
    if (!first.certain) attributes.push('style=dashed', 'color="#8a93a3"', 'fontcolor="#6b7280"');
    if (onPath.has(`${first.from}|${first.action}|${first.to}`)) attributes.push('color="#c2410c"', 'fontcolor="#c2410c"', 'penwidth=2.2');
    lines.push(`  ${first.from} -> ${first.to} [${attributes.join(', ')}];`);
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** A shortest path of view edges from an initial state to a state that satisfies `goal`, as `from|action|to` keys. */
export function shortestPath(view: GraphView, goal: (state: ViewState) => boolean): string[] | undefined {
  const byId = new Map(view.states.map((state) => [state.id, state]));
  const out = new Map<string, ViewEdge[]>();
  for (const edge of view.edges) out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
  const cameBy = new Map<string, ViewEdge | undefined>();
  const queue: string[] = [];
  for (const state of view.states) {
    if (!state.initial) continue;
    cameBy.set(state.id, undefined);
    queue.push(state.id);
  }
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index] ?? '';
    const state = byId.get(id);
    if (state !== undefined && goal(state)) {
      const path: string[] = [];
      for (let edge = cameBy.get(id); edge !== undefined; edge = cameBy.get(edge.from)) path.unshift(`${edge.from}|${edge.action}|${edge.to}`);
      return path;
    }
    for (const edge of out.get(id) ?? []) {
      if (cameBy.has(edge.to)) continue;
      cameBy.set(edge.to, edge);
      queue.push(edge.to);
    }
  }
  return undefined;
}

export interface ExplorerState {
  id: string;
  /** Lines of the node label. */
  label: string[];
  /** Variable → short value. */
  values: Record<string, string>;
  initial: boolean;
  terminal: boolean;
  members: number;
}

export interface ExplorerEdge {
  id: string;
  from: string;
  to: string;
  action: string;
  certain: boolean;
  /** Possible from `sources` of the `of` states behind its source. */
  sources: number;
  of: number;
}

/** Everything the interactive explorer needs, as plain data: the page holds it and nothing else. */
export interface ExplorerPayload {
  title: string;
  variables: string[];
  states: ExplorerState[];
  edges: ExplorerEdge[];
  /** What each action says: the comment above its definition, when a module was given. */
  actions: Record<string, string>;
  /** Edge ids of the path to show first. */
  path: string[];
  fullStates: number;
  fullEdges: number;
  exactness: number;
}

export function explorerPayload(view: GraphView, options: { title: string; path?: readonly string[]; actions?: Readonly<Record<string, string>> }): ExplorerPayload {
  const members = new Map(view.states.map((state) => [state.id, state.members]));
  const used = new Set(view.edges.map((edge) => edge.action));
  const actions: Record<string, string> = {};
  for (const [name, text] of Object.entries(options.actions ?? {})) if (used.has(name)) actions[name] = text;
  return {
    title: options.title,
    variables: view.variables,
    states: view.states.map((state) => {
      const values: Record<string, string> = {};
      for (const name of view.variables) values[name] = shortValue(state.values[name] ?? '');
      return { id: state.id, label: stateLabel(view, state), values, initial: state.initial, terminal: state.terminal, members: state.members };
    }),
    edges: view.edges.map((edge) => ({ id: `${edge.from}|${edge.action}|${edge.to}`, from: edge.from, to: edge.to, action: edge.action, certain: edge.certain, sources: edge.sources, of: members.get(edge.from) ?? 0 })),
    actions,
    path: [...(options.path ?? [])],
    fullStates: view.fullStates,
    fullEdges: view.fullEdges,
    exactness: view.exactness,
  };
}
