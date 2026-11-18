// Projection analysis of a TLA+ model: which variables each action reads and writes, which variables depend on which,
// and the variable sets worth viewing on their own. The analysis recommends; an agent decides. A projected view is a
// TLA+ module of its own, and TLC checks that the model implements it (`View == INSTANCE ...`, `Spec => View!Spec`).
// See docs/projection.md.
import { mentions, scanTlaModule, splitJunction, type JunctionItem, type TlaDefinition, type TlaModule } from './tla-scan.js';

export const PROJECTION_MODULE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface ActionAccess {
  /** The definition name, or `Definition#2` for an unnamed disjunct of it. */
  name: string;
  definition: string;
  /** The sentence the action was compiled from, when its name carries one (`ShipOrder_s4` → `s4`). */
  sentence?: string;
  /** Variables its guards read. */
  guards: string[];
  /** Variables it writes. */
  writes: string[];
  /** Variables it reads to compute what it writes, beside the variable written itself. */
  sources: string[];
  /** The quantifier in front of the action where Next names it: `\E order \in Order`. */
  quantifier?: string;
  /** The arguments Next passes it: `(order)`. */
  args?: string;
}

export interface VariableAccess {
  name: string;
  writers: string[];
  readers: string[];
  /** Variables a writer of this one reads: a guard of the step, or a source of the value. */
  dependsOn: string[];
  /** Everything this variable depends on, directly or through other variables, itself included. */
  cone: string[];
}

export interface Coupling {
  a: string;
  b: string;
  /** Actions that write both. */
  together: number;
  /** Actions that write `b` and read `a`. */
  aGuardsB: number;
  /** Actions that write `a` and read `b`. */
  bGuardsA: number;
}

export interface KeepEvaluation {
  keep: string[];
  hidden: string[];
  /** No kept variable depends on a hidden one: the projection is exact, and slicing the model gives it. */
  closed: boolean;
  /** Actions that write a kept variable. */
  actions: string[];
  /** Of those, the ones that read a hidden variable. In a view they are possible steps, not certain ones. */
  weakened: { action: string; hidden: string[] }[];
  /** Actions that write no kept variable: they vanish from the view. */
  invisible: number;
}

export interface ProjectionCandidate {
  id: string;
  kind: 'component' | 'cone' | 'focus' | 'lifecycle';
  keep: string[];
  exact: boolean;
  why: string;
  evaluation: KeepEvaluation;
}

export interface ProjectionAnalysis {
  module: string;
  variables: VariableAccess[];
  actions: ActionAccess[];
  couplings: Coupling[];
  /** Variable groups no action couples: the model is their product. Observers are in none of them. */
  components: string[][];
  /**
   * Variables some action writes and none reads, such as who took the last step. They record the step taken and
   * guard nothing, so writing one together with another variable does not couple that variable to anything.
   */
  observers: string[];
  candidates: ProjectionCandidate[];
  notes: string[];
}

interface Leaf {
  access: ActionAccess;
  definition: TlaDefinition;
  /** The disjunct of the definition this leaf is, when it is not the whole body. */
  item?: JunctionItem;
}

interface Walk {
  module: TlaModule;
  byName: Map<string, TlaDefinition>;
  variables: Set<string>;
  leaves: Leaf[];
  /** Definitions that only name other actions (Next, Actions). */
  composers: Set<string>;
  notes: string[];
}

function sentenceOf(name: string): string | undefined {
  return /_(s[1-9][0-9]*)(?:_[0-9]+)?$/.exec(name)?.[1];
}

function stripParens(text: string): string {
  let current = text.trim();
  for (;;) {
    if (!current.startsWith('(') || !current.endsWith(')')) return current;
    let depth = 0;
    let wraps = true;
    for (let index = 0; index < current.length; index += 1) {
      if (current[index] === '(') depth += 1;
      else if (current[index] === ')') depth -= 1;
      if (depth === 0 && index < current.length - 1) {
        wraps = false;
        break;
      }
    }
    if (!wraps) return current;
    current = current.slice(1, -1).trim();
  }
}

const REFERENCE = /^(?:(\\E\s+[^:]+?)\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*(\([^()]*\))?$/;

/** Variables a text reads and writes, following the definitions it names. */
function access(walk: Walk, text: string, seen: Set<string> = new Set(), stop?: (name: string) => boolean): { reads: Set<string>; writes: Set<string> } {
  const found = mentions(text);
  const reads = new Set<string>();
  const writes = new Set<string>();
  for (const name of found.primed) if (walk.variables.has(name)) writes.add(name);
  for (const name of found.plain) {
    if (walk.variables.has(name)) reads.add(name);
    const definition = walk.byName.get(name);
    if (definition === undefined || definition.instanceOf !== undefined || seen.has(name) || stop?.(name) === true) continue;
    seen.add(name);
    const inner = access(walk, definition.body, seen, stop);
    for (const read of inner.reads) reads.add(read);
    for (const write of inner.writes) writes.add(write);
  }
  return { reads, writes };
}

function conjuncts(text: string): string[] {
  const junction = splitJunction(stripParens(text));
  if (junction.op !== 'and') return [text];
  const out: string[] = [];
  for (const item of junction.items) out.push(...conjuncts(item.text));
  return out;
}

function leafAccess(walk: Walk, name: string, definition: TlaDefinition, body: string, quantifier: string | undefined): ActionAccess {
  const guards = new Set<string>();
  const writes = new Set<string>();
  const sources = new Set<string>();
  for (const conjunct of conjuncts(body)) {
    const found = access(walk, conjunct);
    if (found.writes.size === 0) {
      for (const read of found.reads) guards.add(read);
      continue;
    }
    for (const write of found.writes) writes.add(write);
    for (const read of found.reads) if (!found.writes.has(read)) sources.add(read);
  }
  const result: ActionAccess = { name, definition: definition.name, guards: [...guards].sort(), writes: [...writes].sort(), sources: [...sources].sort() };
  const sentence = sentenceOf(definition.name);
  if (sentence !== undefined) result.sentence = sentence;
  if (quantifier !== undefined) result.quantifier = quantifier;
  return result;
}

function walkDefinition(walk: Walk, definition: TlaDefinition, quantifier: string | undefined, args: string | undefined, visited: Set<string>): void {
  if (visited.has(definition.name)) return;
  visited.add(definition.name);
  const junction = splitJunction(definition.body);
  const single = junction.op !== 'or' && REFERENCE.exec(stripParens(definition.body));
  if (junction.op !== 'or' && (single === null || single === false || !walk.byName.has(single[2] ?? ''))) {
    const leaf = leafAccess(walk, definition.name, definition, definition.body, quantifier);
    if (args !== undefined) leaf.args = args;
    walk.leaves.push({ access: leaf, definition });
    return;
  }
  walk.composers.add(definition.name);
  junction.items.forEach((item, index) => {
    const reference = REFERENCE.exec(stripParens(item.text));
    const target = reference === null ? undefined : walk.byName.get(reference[2] ?? '');
    if (reference !== null && target !== undefined && target.instanceOf === undefined) {
      walkDefinition(walk, target, reference[1]?.trim() ?? quantifier, reference[3] ?? args, visited);
      return;
    }
    const name = `${definition.name}#${index + 1}`;
    walk.leaves.push({ access: leafAccess(walk, name, definition, item.text, quantifier), definition, item });
  });
}

function walkModule(module: TlaModule, next: string): { ok: true; walk: Walk } | { ok: false; message: string } {
  const byName = new Map(module.definitions.map((definition) => [definition.name, definition]));
  const start = byName.get(next);
  if (start === undefined) return { ok: false, message: `module ${module.name} has no definition named ${next}; pass --next <name>` };
  if (module.variables.length === 0) return { ok: false, message: `module ${module.name} declares no variables` };
  const walk: Walk = { module, byName, variables: new Set(module.variables), leaves: [], composers: new Set(), notes: [] };
  walkDefinition(walk, start, undefined, undefined, new Set());
  return { ok: true, walk };
}

function sorted(values: Iterable<string>, order: readonly string[]): string[] {
  const rank = new Map(order.map((name, index) => [name, index]));
  return [...new Set(values)].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
}

/** What keeping `keep` and hiding the rest does to the model's actions. */
export function evaluateKeep(analysis: Pick<ProjectionAnalysis, 'variables' | 'actions'>, keep: readonly string[]): KeepEvaluation {
  const order = analysis.variables.map((variable) => variable.name);
  const kept = new Set(keep);
  const hidden = order.filter((name) => !kept.has(name));
  const actions: string[] = [];
  const weakened: KeepEvaluation['weakened'] = [];
  let invisible = 0;
  for (const action of analysis.actions) {
    if (!action.writes.some((name) => kept.has(name))) {
      invisible += 1;
      continue;
    }
    actions.push(action.name);
    const reads = [...action.guards, ...action.sources].filter((name) => !kept.has(name));
    if (reads.length > 0) weakened.push({ action: action.name, hidden: sorted(reads, order) });
  }
  return { keep: sorted(keep, order), hidden, closed: weakened.length === 0, actions, weakened, invisible };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function analyzeProjection(text: string, options: { next?: string } = {}): { ok: true; analysis: ProjectionAnalysis } | { ok: false; message: string } {
  const scanned = scanTlaModule(text);
  if (!scanned.ok) return scanned;
  const walked = walkModule(scanned.module, options.next ?? 'Next');
  if (!walked.ok) return walked;
  const { walk } = walked;
  const order = scanned.module.variables;
  const actions = walk.leaves.map((leaf) => leaf.access);
  const dependsOn = new Map<string, Set<string>>(order.map((name) => [name, new Set()]));
  const writers = new Map<string, string[]>(order.map((name) => [name, []]));
  const readers = new Map<string, string[]>(order.map((name) => [name, []]));
  const pairs = new Map<string, Coupling>();
  const pair = (a: string, b: string): Coupling => {
    const [first, second] = order.indexOf(a) <= order.indexOf(b) ? [a, b] : [b, a];
    const key = `${first}|${second}`;
    let coupling = pairs.get(key);
    if (coupling === undefined) {
      coupling = { a: first, b: second, together: 0, aGuardsB: 0, bGuardsA: 0 };
      pairs.set(key, coupling);
    }
    return coupling;
  };
  for (const action of actions) {
    const reads = new Set([...action.guards, ...action.sources]);
    for (const write of action.writes) {
      writers.get(write)?.push(action.name);
      for (const read of reads) {
        if (read === write) continue;
        dependsOn.get(write)?.add(read);
        const coupling = pair(read, write);
        if (coupling.a === read) coupling.aGuardsB += 1;
        else coupling.bGuardsA += 1;
      }
    }
    for (const read of reads) readers.get(read)?.push(action.name);
    action.writes.forEach((first, index) => {
      for (const second of action.writes.slice(index + 1)) pair(first, second).together += 1;
    });
  }
  const cone = (name: string): string[] => {
    const seen = new Set([name]);
    const queue = [name];
    for (let index = 0; index < queue.length; index += 1) {
      for (const dependency of dependsOn.get(queue[index] ?? '') ?? []) {
        if (!seen.has(dependency)) {
          seen.add(dependency);
          queue.push(dependency);
        }
      }
    }
    return sorted(seen, order);
  };
  const variables: VariableAccess[] = order.map((name) => ({
    name,
    writers: writers.get(name) ?? [],
    readers: readers.get(name) ?? [],
    dependsOn: sorted(dependsOn.get(name) ?? [], order),
    cone: cone(name),
  }));
  // An observer is written and never read: it follows the steps and decides none of them.
  const observers = order.filter((name) => (writers.get(name)?.length ?? 0) > 0 && (readers.get(name)?.length ?? 0) === 0 && order.length > 1);
  const observed = new Set(observers);
  // Components: variables no action couples, by a read or by writing both.
  const parent = new Map(order.map((name) => [name, name]));
  const find = (name: string): string => {
    let root = name;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    return root;
  };
  for (const coupling of pairs.values()) {
    if (observed.has(coupling.a) || observed.has(coupling.b)) continue;
    parent.set(find(coupling.a), find(coupling.b));
  }
  const groups = new Map<string, string[]>();
  for (const name of order) {
    if (observed.has(name)) continue;
    const root = find(name);
    groups.set(root, [...(groups.get(root) ?? []), name]);
  }
  const components = [...groups.values()].sort((a, b) => b.length - a.length);
  const base = { variables, actions };
  const candidates: ProjectionCandidate[] = [];
  const seenKeeps = new Set<string>();
  const add = (kind: ProjectionCandidate['kind'], keep: string[], why: (evaluation: KeepEvaluation) => string): void => {
    const key = keep.join(',');
    if (seenKeeps.has(key) || keep.length === order.length) return;
    seenKeeps.add(key);
    const evaluation = evaluateKeep(base, keep);
    candidates.push({ id: `c${candidates.length + 1}`, kind, keep, exact: evaluation.closed, why: why(evaluation), evaluation });
  };
  const lossy = (evaluation: KeepEvaluation): string => evaluation.weakened.length === 0
    ? `None of its ${plural(evaluation.actions.length, 'action', 'actions')} reads a hidden variable.`
    : `${evaluation.weakened.length} of its ${plural(evaluation.actions.length, 'action', 'actions')} read hidden variables (${sorted(evaluation.weakened.flatMap((entry) => entry.hidden), order).join(', ')}), so those steps show as possible, not certain.`;
  if (components.length > 1) {
    for (const component of components) {
      add('component', component, (evaluation) => `No action reads or writes these together with any other variable, so the model is this part times the rest. ${plural(evaluation.actions.length, 'action', 'actions')} move it.`);
    }
  }
  const cones = variables.filter((variable) => !observed.has(variable.name)).map((variable) => variable.cone).sort((a, b) => a.length - b.length);
  for (const keep of cones) {
    const component = components.find((group) => group.includes(keep[0] ?? '')) ?? [];
    if (keep.length >= component.length) continue;
    const heads = variables.filter((variable) => variable.cone.join(',') === keep.join(',')).map((variable) => variable.name);
    add('cone', keep, () => `Everything ${heads.join(', ')} ${heads.length === 1 ? 'depends' : 'depend'} on, and nothing else: no step of this view waits on a hidden variable.`);
  }
  for (const variable of variables) {
    if (variable.cone.length === 1 || variable.writers.length === 0 || observed.has(variable.name)) continue;
    // A focus view keeps the variables that depend on each other and hides what they only read.
    const knot = variables.filter((other) => other.cone.includes(variable.name) && variable.cone.includes(other.name)).map((other) => other.name);
    add('focus', knot, (evaluation) => `${knot.length === 1 ? 'The lifecycle of this variable alone' : 'These variables depend on each other, kept without what they only read'}. ${lossy(evaluation)}`);
  }
  for (const variable of variables) {
    if (variable.writers.length === 0) continue;
    add('lifecycle', [variable.name], (evaluation) => `The lifecycle of ${variable.name} alone. ${lossy(evaluation)}`);
  }
  const notes = [...walk.notes];
  if (observers.length > 0) notes.push(`no action reads ${observers.join(', ')}: ${observers.length === 1 ? 'it records' : 'they record'} the step taken and ${observers.length === 1 ? 'couples' : 'couple'} no variables, so ${observers.length === 1 ? 'it is' : 'they are'} left out of the independent parts`);
  const unwritten = variables.filter((variable) => variable.writers.length === 0).map((variable) => variable.name);
  if (unwritten.length > 0) notes.push(`no action writes ${unwritten.join(', ')}: ${unwritten.length === 1 ? 'it keeps its' : 'they keep their'} first value`);
  return {
    ok: true,
    analysis: {
      module: scanned.module.name,
      variables,
      actions,
      couplings: [...pairs.values()].sort((a, b) => b.together + b.aGuardsB + b.bGuardsA - (a.together + a.aGuardsB + a.bGuardsA)),
      components,
      observers,
      candidates,
      notes,
    },
  };
}

export interface ViewDraft {
  module: string;
  tla: string;
  cfg: string;
  keep: string[];
  hidden: string[];
  /** Actions kept as written. */
  kept: string[];
  /** Actions kept without a guard on a hidden variable: the view allows more than the model there. */
  weakened: { action: string; dropped: string[] }[];
  /** Actions that write no kept variable. */
  removed: string[];
  /** Definitions left out because they read a hidden variable. */
  omitted: string[];
  /** Places the draft could not slice and an author must finish. */
  needsInput: string[];
}

function unchangedOnly(text: string, kept: ReadonlySet<string>, variables: ReadonlySet<string>): string {
  return text.replace(/UNCHANGED\s*<<([^>]*)>>/g, (_whole, list: string) => {
    const names = list.split(',').map((name) => name.trim()).filter((name) => name !== '');
    const remaining = names.filter((name) => kept.has(name) || !variables.has(name));
    if (remaining.length === 0) return 'TRUE';
    return remaining.length === 1 ? `UNCHANGED ${remaining[0]}` : `UNCHANGED <<${remaining.join(', ')}>>`;
  });
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? '';
}

/**
 * A starter view: the model with the hidden variables cut out. A guard on a hidden variable is dropped, which makes
 * the view allow more, never less, so the model still implements it. An effect that needs a hidden value cannot be
 * sliced and is left for the author.
 */
export function draftView(text: string, options: { name: string; keep: readonly string[]; next?: string }): { ok: true; draft: ViewDraft } | { ok: false; message: string } {
  const scanned = scanTlaModule(text);
  if (!scanned.ok) return scanned;
  const { module } = scanned;
  const unknown = options.keep.filter((name) => !module.variables.includes(name));
  if (unknown.length > 0) return { ok: false, message: `${module.name} has no variable ${unknown.join(', ')}; it has ${module.variables.join(', ')}` };
  if (options.keep.length === 0) return { ok: false, message: 'a view keeps at least one variable' };
  const walked = walkModule(module, options.next ?? 'Next');
  if (!walked.ok) return walked;
  const { walk } = walked;
  const variables = new Set(module.variables);
  const kept = new Set(options.keep);
  const keep = module.variables.filter((name) => kept.has(name));
  const hidden = module.variables.filter((name) => !kept.has(name));
  const hiddenSet = new Set(hidden);
  const draft: ViewDraft = { module: options.name, tla: '', cfg: '', keep, hidden, kept: [], weakened: [], removed: [], omitted: [], needsInput: [] };
  const readsHidden = (source: string): string[] => {
    const found = access(walk, source);
    return [...found.reads, ...found.writes].filter((name) => hiddenSet.has(name));
  };
  // Slice each leaf: undefined when the view has no such step.
  const leafText = new Map<Leaf, string | undefined>();
  for (const leaf of walk.leaves) {
    const { name } = leaf.access;
    if (!leaf.access.writes.some((write) => kept.has(write))) {
      draft.removed.push(name);
      leafText.set(leaf, undefined);
      continue;
    }
    if (leaf.item !== undefined) {
      // An unnamed disjunct is kept whole or handed to the author.
      const raw = leaf.definition.text.slice(leaf.item.start + 2, leaf.item.end).trim();
      if (readsHidden(leaf.item.text).length > 0) draft.needsInput.push(`${name}: reads or writes hidden ${readsHidden(leaf.item.text).join(', ')} in one expression`);
      else draft.kept.push(name);
      leafText.set(leaf, unchangedOnly(raw, kept, variables));
      continue;
    }
    const junction = splitJunction(leaf.definition.body);
    const header = leaf.definition.text.slice(0, leaf.definition.text.indexOf('==') + 2);
    if (junction.op !== 'and' || !junction.bulleted) {
      if (readsHidden(leaf.definition.body).length > 0) draft.needsInput.push(`${name}: not a bulleted list of conjuncts, and it names hidden ${readsHidden(leaf.definition.body).join(', ')}`);
      else draft.kept.push(name);
      leafText.set(leaf, unchangedOnly(leaf.definition.text, kept, variables));
      continue;
    }
    const lines: string[] = [header];
    const dropped: string[] = [];
    for (const item of junction.items) {
      const raw = leaf.definition.text.slice(item.start, item.end).replace(/\s+$/, '');
      const found = access(walk, item.text);
      const hiddenWrites = [...found.writes].filter((write) => hiddenSet.has(write));
      const keptWrites = [...found.writes].filter((write) => kept.has(write));
      const hiddenReads = [...found.reads].filter((read) => hiddenSet.has(read));
      if (found.writes.size === 0 && found.reads.size === 0 && /UNCHANGED/.test(item.text)) {
        const frame = unchangedOnly(raw, kept, variables);
        if (!/\/\\\s*TRUE\s*$/.test(frame)) lines.push(`  ${frame.trim()}`);
        continue;
      }
      if (found.writes.size === 0) {
        if (hiddenReads.length === 0) lines.push(`  ${raw.trim()}`);
        else {
          dropped.push(firstLine(item.text));
          lines.push(`  \\* hidden (${hiddenReads.join(', ')}): ${firstLine(item.text)}`);
        }
        continue;
      }
      if (keptWrites.length === 0) continue;
      if (hiddenWrites.length > 0 || hiddenReads.length > 0) {
        draft.needsInput.push(`${name}: "${firstLine(item.text)}" needs hidden ${[...hiddenWrites, ...hiddenReads].join(', ')}; write what the view should allow`);
        lines.push(`  \\* TODO needs hidden ${[...hiddenWrites, ...hiddenReads].join(', ')}: ${firstLine(item.text)}`);
        continue;
      }
      lines.push(`  ${raw.trim()}`);
    }
    if (dropped.length > 0) draft.weakened.push({ action: name, dropped });
    else draft.kept.push(name);
    leafText.set(leaf, lines.join('\n'));
  }
  // Which definitions survive: a leaf with a step left, a composer with an item left, or a helper that reads nothing hidden.
  const leavesOf = new Map<string, Leaf[]>();
  for (const leaf of walk.leaves) leavesOf.set(leaf.definition.name, [...(leavesOf.get(leaf.definition.name) ?? []), leaf]);
  const rendered = new Map<string, string | undefined>();
  const render = (definition: TlaDefinition): string | undefined => {
    if (rendered.has(definition.name)) return rendered.get(definition.name);
    rendered.set(definition.name, undefined);
    let result: string | undefined;
    if (walk.composers.has(definition.name)) {
      const junction = splitJunction(definition.body);
      const header = definition.text.slice(0, definition.text.indexOf('==') + 2);
      const items: string[] = [];
      junction.items.forEach((item, index) => {
        const inline = (leavesOf.get(definition.name) ?? []).find((leaf) => leaf.access.name === `${definition.name}#${index + 1}`);
        if (inline !== undefined) {
          const sliced = leafText.get(inline);
          if (sliced !== undefined) items.push(sliced);
          return;
        }
        const reference = REFERENCE.exec(stripParens(item.text));
        const target = walk.byName.get(reference?.[2] ?? '');
        if (target !== undefined && render(target) === undefined) return;
        items.push(junction.bulleted ? definition.text.slice(item.start + 2, item.end).trim() : item.text);
      });
      if (items.length > 0) result = junction.bulleted ? [header, ...items.map((item) => `  \\/ ${item}`)].join('\n') : `${header} ${items.join(' \\/ ')}`;
    } else if ((leavesOf.get(definition.name) ?? []).length > 0) {
      const leaf = (leavesOf.get(definition.name) ?? [])[0];
      result = leaf === undefined ? undefined : leafText.get(leaf);
    }
    rendered.set(definition.name, result);
    return result;
  };
  const tuple = module.definitions.find((definition) => {
    const body = definition.body.replace(/\s+/g, '');
    return body === `<<${module.variables.join(',')}>>`;
  });
  const out: string[] = [];
  const rule = Math.max(4, Math.floor((76 - options.name.length - 8) / 2));
  out.push(`${'-'.repeat(rule)} MODULE ${options.name} ${'-'.repeat(rule)}`);
  out.push('(*');
  out.push(`  A projected view of ${module.name}. Yours to edit.`);
  out.push('');
  out.push(`  It keeps ${keep.join(', ')}`);
  out.push(`  and hides ${hidden.length === 0 ? 'nothing' : hidden.join(', ')}.`);
  out.push('  It started as the model with the hidden variables cut out: a guard on a hidden variable is gone,');
  out.push('  so the view allows that step whenever the kept variables do. clew spec projection check asks TLC');
  out.push(`  whether every behaviour of ${module.name} is a behaviour of this view.`);
  out.push('*)');
  if (module.extends.length > 0) out.push(`EXTENDS ${module.extends.join(', ')}`);
  out.push('');
  if (module.preamble !== '') out.push(module.preamble, '');
  out.push(`VARIABLES ${keep.join(', ')}`);
  for (const definition of module.definitions) {
    if (module.preamble.includes(definition.text)) continue;
    if (definition.instanceOf !== undefined) continue;
    let textOut: string | undefined;
    if (definition === tuple) textOut = `${definition.name} == <<${keep.join(', ')}>>`;
    else if (walk.composers.has(definition.name) || leavesOf.has(definition.name)) textOut = render(definition);
    else {
      const junction = splitJunction(definition.body);
      const perVariable = definition.name === 'Init' || definition.name === 'TypeOK';
      if (perVariable && junction.op === 'and' && junction.bulleted) {
        const header = definition.text.slice(0, definition.text.indexOf('==') + 2);
        const lines = [header];
        for (const item of junction.items) if (readsHidden(item.text).length === 0) lines.push(`  ${definition.text.slice(item.start, item.end).trim()}`);
        textOut = lines.length > 1 ? lines.join('\n') : `${header} TRUE`;
      } else {
        // A helper that names an action reads what the sliced action reads, which is nothing hidden.
        const found = access(walk, definition.body, new Set(), (name) => walk.composers.has(name) || leavesOf.has(name) || name === 'Init' || name === 'TypeOK' || name === tuple?.name);
        const names = mentions(definition.body).plain;
        const gone = [...names].some((name) => {
          const target = walk.byName.get(name);
          return target !== undefined && (walk.composers.has(name) || leavesOf.has(name)) && render(target) === undefined;
        });
        if ([...found.reads, ...found.writes].some((name) => hiddenSet.has(name)) || gone) draft.omitted.push(definition.name);
        else textOut = unchangedOnly(definition.text, kept, variables);
      }
    }
    if (textOut === undefined) continue;
    out.push('');
    for (const line of definition.comment) out.push(`\\* ${line}`);
    out.push(textOut);
  }
  out.push('');
  out.push('='.repeat(77));
  draft.tla = `${out.join('\n')}\n`;
  const cfg = [`\\* TLC config of the view ${options.name}. Yours to edit, with the view.`, 'SPECIFICATION Spec'];
  if (module.definitions.some((definition) => definition.name === 'TypeOK')) cfg.push('INVARIANT TypeOK');
  cfg.push('CHECK_DEADLOCK FALSE');
  draft.cfg = `${cfg.join('\n')}\n`;
  return { ok: true, draft };
}

export interface ViewAction {
  name: string;
  /** The expression that takes the step through the instance: `\E order \in Order : View!ShipOrder_s4(order)`. */
  call: string;
}

export interface ViewCheck {
  module: string;
  tla: string;
  cfg: string;
  coverCfg: string;
  actions: ViewAction[];
  /** The view variables and what each reads in the model. */
  mapping: { variable: string; expression: string }[];
}

/**
 * The check module: the model, the view as an instance of it, and the property that every behaviour of the model is a
 * behaviour of the view. With the coverage config, TLC also counts how often the model takes each step of the view.
 */
export function viewCheckModule(input: { base: string; view: string; baseName?: string; spec?: string; next?: string; map?: Readonly<Record<string, string>> }): { ok: true; check: ViewCheck } | { ok: false; message: string } {
  const base = scanTlaModule(input.base);
  if (!base.ok) return { ok: false, message: `the model: ${base.message}` };
  const view = scanTlaModule(input.view);
  if (!view.ok) return { ok: false, message: `the view: ${view.message}` };
  const baseModule = base.module;
  const viewModule = view.module;
  if (baseModule.name === viewModule.name) return { ok: false, message: `the view and the model are both named ${viewModule.name}` };
  const specName = input.spec ?? 'Spec';
  const nextName = input.next ?? 'Next';
  for (const [module, label] of [[baseModule, 'the model'], [viewModule, 'the view']] as const) {
    for (const name of [specName, nextName, 'Init']) {
      if (!module.definitions.some((definition) => definition.name === name)) return { ok: false, message: `${label} ${module.name} has no definition named ${name}` };
    }
  }
  const map = input.map ?? {};
  const strangers = Object.keys(map).filter((name) => !viewModule.variables.includes(name));
  if (strangers.length > 0) return { ok: false, message: `--map names ${strangers.join(', ')}, which ${viewModule.name} does not declare; its variables are ${viewModule.variables.join(', ')}` };
  const mapping: ViewCheck['mapping'] = [];
  const unmapped: string[] = [];
  for (const variable of viewModule.variables) {
    const expression = map[variable] ?? (baseModule.variables.includes(variable) ? variable : undefined);
    if (expression === undefined) unmapped.push(variable);
    else mapping.push({ variable, expression });
  }
  if (unmapped.length > 0) return { ok: false, message: `${viewModule.name} declares ${unmapped.join(', ')}, which ${baseModule.name} does not have: say what each one is in the model with --map "${unmapped[0] ?? 'v'} <- expression"` };
  const taken = new Set(baseModule.definitions.map((definition) => definition.name));
  const instance = taken.has('View') ? 'ClewView' : 'View';
  const walked = walkModule(viewModule, nextName);
  if (!walked.ok) return walked;
  const actions: ViewAction[] = [];
  const seen = new Set<string>();
  for (const leaf of walked.walk.leaves) {
    if (leaf.item !== undefined || seen.has(leaf.definition.name)) continue;
    seen.add(leaf.definition.name);
    const callText = `${leaf.definition.name}${leaf.access.args ?? ''}`;
    const quantifier = leaf.access.quantifier;
    if (leaf.definition.params.length > 0 && leaf.access.args === undefined) continue;
    actions.push({ name: leaf.definition.name, call: `${quantifier === undefined ? '' : `${quantifier} : `}${instance}!${callText}` });
  }
  const name = `${viewModule.name}Refines`;
  const lines: string[] = [];
  const rule = Math.max(4, Math.floor((76 - name.length - 8) / 2));
  lines.push(`${'-'.repeat(rule)} MODULE ${name} ${'-'.repeat(rule)}`);
  lines.push('(*');
  lines.push('  Written by clew spec projection check. Do not edit: check again instead.');
  lines.push('');
  lines.push(`  ${viewModule.name} is a projected view of ${baseModule.name}. With ${name}.cfg, TLC checks that every`);
  lines.push(`  behaviour of ${baseModule.name} is a behaviour of the view once the hidden variables are dropped.`);
  lines.push(`  With ${name}Cover.cfg and -coverage 1, TLC prints one line per Cover_ action: a line that ends`);
  lines.push('  in :0 is a step the view allows and the model never takes.');
  lines.push('*)');
  lines.push(`EXTENDS ${baseModule.name}`);
  lines.push('');
  lines.push(`${instance} == INSTANCE ${viewModule.name} WITH ${mapping.map((entry) => `${entry.variable} <- ${entry.expression}`).join(', ')}`);
  lines.push('');
  lines.push(`ImplementsView == ${instance}!${specName}`);
  lines.push('');
  for (const action of actions) lines.push(`Cover_${action.name} == ${nextName} /\\ ${action.call}`);
  lines.push('\\* Steps of the model that are no named step of the view: they change hidden variables only.');
  lines.push(`Cover_Hidden == ${nextName}${actions.map((action) => ` /\\ ~(${action.call})`).join('')}`);
  lines.push('');
  lines.push('CoverNext ==');
  for (const action of actions) lines.push(`  \\/ Cover_${action.name}`);
  lines.push('  \\/ Cover_Hidden');
  lines.push('');
  const tuple = baseModule.definitions.find((definition) => definition.body.replace(/\s+/g, '') === `<<${baseModule.variables.join(',')}>>`);
  lines.push(`CoverSpec == Init /\\ [][CoverNext]_${tuple?.name ?? `<<${baseModule.variables.join(', ')}>>`}`);
  lines.push('');
  lines.push('='.repeat(77));
  const cfg = [
    `\\* ${baseModule.name} implements the view ${viewModule.name}. Written by clew spec projection check; do not edit.`,
    `SPECIFICATION ${specName}`,
    'PROPERTY ImplementsView',
    'CHECK_DEADLOCK FALSE',
  ];
  const coverCfg = [
    `\\* Which steps of the view ${viewModule.name} the model takes. Written by clew spec projection check; do not edit.`,
    'SPECIFICATION CoverSpec',
    'PROPERTY ImplementsView',
    'CHECK_DEADLOCK FALSE',
  ];
  return { ok: true, check: { module: name, tla: `${lines.join('\n')}\n`, cfg: `${cfg.join('\n')}\n`, coverCfg: `${coverCfg.join('\n')}\n`, actions, mapping } };
}

/**
 * Graphviz text of the dependency map: one box per variable, grouped by independent part. An arrow from `a` to `b`
 * says an action that writes `b` reads `a`, with the number of such actions; a dotted line says one action writes both.
 */
export function dependencyDot(analysis: ProjectionAnalysis, keep: readonly string[] = []): string {
  const kept = new Set(keep);
  const lines = ['digraph dependencies {', '  rankdir=LR; bgcolor="white"; nodesep=0.3; ranksep=0.7; compound=true;'];
  lines.push(`  label="${analysis.module}: which variable depends on which"; labelloc="t"; fontname="Helvetica"; fontsize=13;`);
  lines.push('  node [shape=box, style="rounded,filled", fillcolor="#f7f8fa", color="#5b6472", fontname="Helvetica", fontsize=11, margin="0.12,0.07"];');
  lines.push('  edge [color="#5b6472", fontname="Helvetica", fontsize=9, arrowsize=0.7];');
  analysis.components.forEach((component, index) => {
    lines.push(`  subgraph cluster_${index + 1} { label="part ${index + 1}"; fontname="Helvetica"; fontsize=10; color="#c5cad3"; style="rounded";`);
    for (const name of component) {
      const variable = analysis.variables.find((entry) => entry.name === name);
      const writers = variable?.writers.length ?? 0;
      const attributes = [`label="${name}\\n${writers} ${writers === 1 ? 'writer' : 'writers'}"`];
      if (kept.has(name)) attributes.push('color="#c2410c"', 'penwidth=2', 'fillcolor="#fff3e8"');
      lines.push(`    "${name}" [${attributes.join(', ')}];`);
    }
    lines.push('  }');
  });
  const observed = new Set(analysis.observers);
  for (const coupling of analysis.couplings) {
    // An observer follows every step: its arrows would cover the map and say nothing.
    if (observed.has(coupling.a) || observed.has(coupling.b)) continue;
    if (coupling.aGuardsB > 0) lines.push(`  "${coupling.a}" -> "${coupling.b}" [label="${coupling.aGuardsB}"];`);
    if (coupling.bGuardsA > 0) lines.push(`  "${coupling.b}" -> "${coupling.a}" [label="${coupling.bGuardsA}"];`);
    if (coupling.aGuardsB === 0 && coupling.bGuardsA === 0 && coupling.together > 0) lines.push(`  "${coupling.a}" -> "${coupling.b}" [dir=none, style=dotted, label="${coupling.together}"];`);
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}
