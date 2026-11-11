// Frames → a TLA+ module scaffold. The scaffold is a starting point an agent rewrites, not a strict
// mapping: every definition that models a frame carries an `@frame <id> <digest>` comment, and
// spec-tla-check reads those comments back to line the model up against the frames.
import { conditionVar, type FrameCompilation } from './spec-compile.js';
import type { CompiledAction, CompiledForbidden, CompiledItem } from './spec-actions.js';
import { conjunctTexts, effectText, effectTexts, predicateText, valueText } from './spec-expr.js';
import type { Frame, Role } from './spec.js';
import type { Predicate, VarDecl } from './valuation.js';

export const TLA_MODULE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
export const TLA_MODULE_NAME_MESSAGE = 'a TLA+ module name starts with a letter and then uses letters, digits, or underscores';

export type TlaObligationKind = 'action' | 'forbidden' | 'restatement' | 'condition' | 'incomplete' | 'note';

/** What a frame says the model must honor, in TLA+ ASCII. */
export interface TlaExpectation {
  event?: string;
  actor?: string;
  /** Guard, `TRUE` when the action is always enabled. */
  when?: string;
  /** Primed assignments. */
  effect?: string;
  /** The boolean a condition frame stands for. */
  variable?: string;
  /** The earlier frame a restatement repeats. */
  restates?: string;
  /** Roles a transition frame still lacks. */
  missing?: string[];
}

/** One frame a model has to account for. `note` frames are optional and never listed as obligations. */
export interface TlaObligation {
  frame: string;
  sentence: string;
  clause: string;
  kind: TlaObligationKind;
  /** Changes when the frame's roles or what it compiles to change. */
  digest: string;
  expects: TlaExpectation;
}

export interface TlaScaffold {
  module: string;
  tla: string;
  cfg: string;
  /** Frame id → the definition or variable that models it. */
  placed: { frame: string; name: string }[];
  /** Transition frames with a missing role. The scaffold lists them as TODO comments. */
  todo: string[];
}

/** Names the scaffold defines itself. An action that would collide gets a `Step` suffix. */
const RESERVED: ReadonlySet<string> = new Set(['Init', 'Next', 'Spec', 'TypeOK', 'Null', 'vars']);

/** One entry per frame the model must account for, in frame order. */
export function tlaObligations(frames: readonly Frame[], compilation: FrameCompilation): TlaObligation[] {
  const obligations: TlaObligation[] = [];
  for (const frame of frames) {
    const obligation = frameObligation(frame, compilation);
    if (obligation.kind !== 'note') obligations.push(obligation);
  }
  return obligations;
}

/** The obligation of one frame. A frame the model need not account for is a `note`. */
export function frameObligation(frame: Frame, compilation: FrameCompilation): TlaObligation {
  const items = compilation.compiled.items;
  const restates = compilation.restated[frame.id];
  const item = itemOf(items, restates ?? frame.id);
  let kind: TlaObligationKind = 'note';
  const expects: TlaExpectation = {};
  if (item !== undefined && (item.kind === 'action' || item.kind === 'forbidden')) {
    kind = restates !== undefined ? 'restatement' : item.kind;
    if (item.event !== undefined) expects.event = item.event;
    const actor = item.kind === 'action' ? item.overlay?.actor : item.actor;
    if (actor !== undefined) expects.actor = actor;
    if (item.when !== undefined) expects.when = predicateText(item.when, 'tla');
    if (item.assign !== undefined) expects.effect = effectText(item.assign, 'tla');
    if (restates !== undefined) expects.restates = restates;
  } else if (frame.notTransition === undefined) {
    kind = 'incomplete';
    const missing: string[] = [];
    for (const role of ['event', 'object', 'result'] as const) {
      if (frame.roles[role].latest.value === 'unknown') missing.push(role);
    }
    expects.missing = missing;
  } else if (compilation.compiled.draft.vars.some((decl) => decl.id === conditionVar(frame.id))) {
    kind = 'condition';
    expects.variable = conditionVar(frame.id);
  }
  return {
    frame: frame.id,
    sentence: frame.sentence,
    clause: oneLine(frame.clause.text),
    kind,
    digest: frameDigest(frame, expects),
    expects,
  };
}

/** Eight hex digits over the frame's roles and what it compiles to. Not a security hash. */
export function frameDigest(frame: Frame, expects: TlaExpectation): string {
  const parts: string[] = [frame.clause.text, frame.negated === true ? 'negated' : '', frame.marker ?? '', frame.notTransition?.reason ?? ''];
  for (const name of ['actor', 'event', 'object', 'result', 'when'] as const) parts.push(roleKey(frame.roles[name].latest.value));
  parts.push(expects.event ?? '', expects.actor ?? '', expects.when ?? '', expects.effect ?? '', expects.variable ?? '', expects.restates ?? '');
  let hash = 0x811c9dc5;
  const text = parts.join('\u0001');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** `order` → `Order`, `SIGN_UP` → `SignUp`, `order_status` → `OrderStatus`. */
export function pascalName(raw: string): string {
  let name = '';
  for (const part of raw.split(/[^A-Za-z0-9]+/)) {
    if (part === '') continue;
    name += part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }
  if (name === '') return 'Model';
  return /^[A-Za-z]/.test(name) ? name : `M${name}`;
}

export function tlaScaffold(input: { module: string; session: string; frames: readonly Frame[]; compilation: FrameCompilation }): TlaScaffold {
  const draft = input.compilation.compiled.draft;
  const items = input.compilation.compiled.items;
  const obligations = new Map<string, TlaObligation>();
  for (const frame of input.frames) obligations.set(frame.id, frameObligation(frame, input.compilation));
  const frames = new Map<string, Frame>();
  for (const frame of input.frames) frames.set(frame.id, frame);
  const restaters = new Map<string, string[]>();
  for (const frame of input.frames) {
    const target = input.compilation.restated[frame.id];
    if (target === undefined) continue;
    const list = restaters.get(target) ?? [];
    list.push(frame.id);
    restaters.set(target, list);
  }
  const actions: CompiledAction[] = [];
  const forbidden: CompiledForbidden[] = [];
  for (const item of items) {
    if (item.kind === 'action') actions.push(item);
    else if (item.kind === 'forbidden' && item.when !== undefined && item.assign !== undefined) forbidden.push(item);
  }
  const assigned = new Set<string>();
  for (const action of actions) {
    for (const key of Object.keys(action.assign)) assigned.add(key);
  }
  const used = new Set<string>(RESERVED);
  for (const decl of draft.vars) used.add(decl.id);
  const claim = (wanted: string): string => {
    let name = RESERVED.has(wanted) ? `${wanted}Step` : wanted;
    for (let suffix = 2; used.has(name); suffix += 1) name = `${wanted}${suffix}`;
    used.add(name);
    return name;
  };
  const placed: { frame: string; name: string }[] = [];
  const cite = (lines: string[], frameId: string, indent: string): void => {
    const obligation = obligations.get(frameId);
    const frame = frames.get(frameId);
    if (obligation === undefined || frame === undefined) return;
    lines.push(`${indent}\\* @frame ${frameId} ${obligation.digest}`);
    lines.push(`${indent}\\*   ${frame.sentence} "${commentSafe(obligation.clause)}"`);
    const notes: string[] = [];
    if (obligation.expects.actor !== undefined) notes.push(`actor ${obligation.expects.actor}`);
    const when = frame.roles.when.latest.value;
    if (when !== 'unknown') notes.push(`when "${commentSafe(oneLine(when.text))}"`);
    if (notes.length > 0) lines.push(`${indent}\\*   ${notes.join('; ')}`);
  };
  const citeAll = (lines: string[], frameId: string, name: string): void => {
    for (const id of [frameId, ...(restaters.get(frameId) ?? [])]) {
      cite(lines, id, '');
      placed.push({ frame: id, name });
    }
  };

  const lines: string[] = [];
  const title = ` MODULE ${input.module} `;
  const rule = '-'.repeat(Math.max(4, Math.floor((72 - title.length) / 2)));
  lines.push(`${rule}${title}${rule}`);
  lines.push('(*');
  lines.push(`  Scaffold from the frames of Clew session "${commentSafe(input.session)}" (clew spec tla scaffold).`);
  lines.push('');
  lines.push('  This is a starting point, not a strict mapping. Rename, merge, split, and');
  lines.push('  strengthen the definitions until the module says what the spec means. Keep');
  lines.push('  the "@frame" comment above every definition that models a frame: a merged');
  lines.push('  definition keeps one line per frame, and a frame the model leaves out on');
  lines.push('  purpose gets its "@frame" line with "skip:" and a reason.');
  lines.push('');
  lines.push(`  clew spec tla check ${input.module}.tla lines each frame up against its definition,`);
  lines.push('  and reports frames with no definition and frames that changed since.');
  lines.push('*)');
  lines.push('');

  const conditions = new Map<string, string>();
  for (const frame of input.frames) {
    const obligation = obligations.get(frame.id);
    if (obligation?.kind === 'condition' && obligation.expects.variable !== undefined) conditions.set(obligation.expects.variable, frame.id);
  }
  lines.push('\\* An object that is in no state yet.');
  lines.push('Null == "null"');
  lines.push('');
  if (draft.vars.length > 0) {
    lines.push('VARIABLES');
    draft.vars.forEach((decl, index) => {
      const comma = index === draft.vars.length - 1 ? '' : ',';
      const frameId = conditions.get(decl.id);
      if (frameId === undefined) {
        lines.push(`  ${decl.id}${comma}`);
        return;
      }
      cite(lines, frameId, '  ');
      if (!assigned.has(decl.id)) lines.push('  \\*   TODO: the spec never says what sets this. Name it, or model the data behind it.');
      lines.push(`  ${decl.id}${comma}`);
      placed.push({ frame: frameId, name: decl.id });
    });
    lines.push('');
    lines.push(`vars == <<${draft.vars.map((decl) => decl.id).join(', ')}>>`);
    lines.push('');
  }

  const sets = new Map<string, string>();
  for (const decl of draft.vars) {
    if (decl.type === 'boolean') continue;
    const name = claim(pascalName(decl.id));
    sets.set(decl.id, name);
    const values = valuesOf(decl, items);
    lines.push(`${name} == {${values.map((value) => JSON.stringify(value)).join(', ')}}`);
  }
  if (sets.size > 0) lines.push('');

  lines.push('TypeOK ==');
  if (draft.vars.length === 0) lines.push('  TRUE');
  for (const decl of draft.vars) {
    const set = sets.get(decl.id);
    lines.push(set === undefined ? `  /\\ ${decl.id} \\in BOOLEAN` : `  /\\ ${decl.id} \\in ${set} \\cup {Null}`);
  }
  lines.push('');
  lines.push('Init ==');
  if (draft.vars.length === 0) lines.push('  TRUE');
  for (const decl of draft.vars) {
    const initial = draft.initial[decl.id];
    if (decl.type === 'boolean' && !assigned.has(decl.id)) lines.push(`  /\\ ${decl.id} \\in BOOLEAN`);
    else if (initial === undefined || initial.t === 'null') lines.push(`  /\\ ${decl.id} = ${decl.type === 'boolean' ? 'FALSE' : 'Null'}`);
    else lines.push(`  /\\ ${decl.id} = ${valueText(initial, 'tla')}`);
  }
  lines.push('');

  const events: string[] = [];
  const byEvent = new Map<string, CompiledAction[]>();
  for (const action of actions) {
    const list = byEvent.get(action.event);
    if (list === undefined) {
      events.push(action.event);
      byEvent.set(action.event, [action]);
    } else {
      list.push(action);
    }
  }
  const high = new Map<string, string>();
  for (const event of events) high.set(event, claim(pascalName(event)));

  if (actions.length > 0) {
    lines.push(separator());
    lines.push('\\* Clause actions: one per transition frame. Each reads the state the frame');
    lines.push('\\* waits on and primes the state it leaves the object in. An event with one');
    lines.push('\\* clause is its own high-level action.');
    lines.push('');
  }
  const groups: { name: string; members: string[] }[] = [];
  for (const event of events) {
    const group = byEvent.get(event) ?? [];
    const name = high.get(event) ?? pascalName(event);
    const members: string[] = [];
    for (const action of group) {
      const own = group.length === 1 ? name : claim(`${name}_${frameSuffix(action.id)}`);
      members.push(own);
      citeAll(lines, action.id, own);
      lines.push(`${own} ==`);
      for (const part of conjunctTexts(action.when, 'tla')) lines.push(`  /\\ ${part}`);
      for (const part of effectTexts(action.assign, 'tla')) lines.push(`  /\\ ${part}`);
      const rest = unchanged(draft.vars, action.assign);
      if (rest !== undefined) lines.push(`  /\\ ${rest}`);
      lines.push('');
    }
    if (group.length > 1) groups.push({ name, members });
  }

  lines.push(separator());
  lines.push('\\* The high-level view: one action per event, whatever clause enables it.');
  lines.push('\\* Next speaks only in these.');
  lines.push('');
  for (const group of groups) {
    lines.push(`${group.name} ==`);
    for (const member of group.members) lines.push(`  \\/ ${member}`);
    lines.push('');
  }
  lines.push('Next ==');
  if (events.length === 0) lines.push('  FALSE');
  for (const event of events) lines.push(`  \\/ ${high.get(event) ?? pascalName(event)}`);
  lines.push('');
  lines.push(draft.vars.length === 0 ? 'Spec == Init /\\ [][Next]_<<>>' : 'Spec == Init /\\ [][Next]_vars');
  lines.push('');

  const properties: string[] = [];
  if (forbidden.length > 0) {
    lines.push(separator());
    lines.push('\\* Forbidden steps: one safety property per negated frame.');
    lines.push('');
    const counts = new Map<string, number>();
    for (const item of forbidden) counts.set(item.event ?? '', (counts.get(item.event ?? '') ?? 0) + 1);
    for (const item of forbidden) {
      const base = `Never${pascalName(item.event ?? 'step')}`;
      const name = claim((counts.get(item.event ?? '') ?? 0) > 1 ? `${base}_${frameSuffix(item.id)}` : base);
      properties.push(name);
      citeAll(lines, item.id, name);
      const parts = [...conjunctTexts(item.when ?? { op: 'true' }, 'tla'), ...effectTexts(item.assign ?? {}, 'tla')];
      lines.push(`${name} ==`);
      parts.forEach((part, index) => {
        const open = index === 0 ? '  [][~(' : '       ';
        const close = index === parts.length - 1 ? `)]_${draft.vars.length === 0 ? '<<>>' : 'vars'}` : '';
        lines.push(`${open}/\\ ${part}${close}`);
      });
      lines.push('');
    }
  }

  const todo: string[] = [];
  for (const frame of input.frames) {
    const obligation = obligations.get(frame.id);
    if (obligation === undefined || obligation.kind === 'note') continue;
    if (placed.some((entry) => entry.frame === frame.id)) continue;
    todo.push(frame.id);
  }
  if (todo.length > 0) {
    lines.push(separator());
    lines.push('\\* Frames the scaffold could not place. Model each one above and move its line');
    lines.push('\\* there as an "@frame" comment, or keep the line here with "skip:" and a reason.');
    lines.push('');
    for (const id of todo) {
      const obligation = obligations.get(id);
      if (obligation === undefined) continue;
      const missing = obligation.expects.missing ?? [];
      const why = missing.length === 0 ? 'does not compile' : `no ${missing.join(', no ')}`;
      lines.push(`\\* TODO frame ${id} ${obligation.digest}: ${obligation.sentence} "${commentSafe(obligation.clause)}" (${why})`);
    }
    lines.push('');
  }
  lines.push('='.repeat(Math.max(4, rule.length * 2 + title.length)));

  const cfg: string[] = [
    `\\* TLC model for ${input.module}.tla. Written once by clew spec tla scaffold; yours to edit.`,
    'SPECIFICATION Spec',
    'INVARIANT TypeOK',
  ];
  for (const name of properties) cfg.push(`PROPERTY ${name}`);
  cfg.push('\\* A finished object has no next step; that is not a deadlock worth reporting.');
  cfg.push('CHECK_DEADLOCK FALSE');
  return { module: input.module, tla: `${lines.join('\n')}\n`, cfg: `${cfg.join('\n')}\n`, placed, todo };
}

function itemOf(items: readonly CompiledItem[], id: string): CompiledItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
  }
  return undefined;
}

/** Every atom the compiled items assign to or test on `decl`, in first-seen order. */
function valuesOf(decl: VarDecl, items: readonly CompiledItem[]): string[] {
  const values: string[] = [];
  const add = (value: string): void => {
    if (!values.includes(value)) values.push(value);
  };
  for (const item of items) {
    if (item.kind !== 'action' && item.kind !== 'forbidden') continue;
    if (item.when !== undefined) atomsTested(item.when, decl.id, add);
    const assigned = item.assign?.[decl.id];
    if (assigned?.t === 'atom') add(assigned.v);
  }
  return values;
}

function atomsTested(predicate: Predicate, name: string, add: (value: string) => void): void {
  if (predicate.op === 'true') return;
  if (predicate.op === 'eq' || predicate.op === 'neq') {
    if (predicate.var === name && predicate.value.t === 'atom') add(predicate.value.v);
    return;
  }
  if (predicate.op === 'not') {
    atomsTested(predicate.of, name, add);
    return;
  }
  for (const child of predicate.of) atomsTested(child, name, add);
}

function unchanged(vars: readonly VarDecl[], assign: Readonly<Record<string, unknown>>): string | undefined {
  const rest: string[] = [];
  for (const decl of vars) {
    if (assign[decl.id] === undefined) rest.push(decl.id);
  }
  const only = rest[0];
  if (only === undefined) return undefined;
  return rest.length === 1 ? `UNCHANGED ${only}` : `UNCHANGED <<${rest.join(', ')}>>`;
}

/** `fr:s1.t7` → `s1_t7`. */
function frameSuffix(frameId: string): string {
  return frameId.replace(/^fr:/, '').replace(/[^A-Za-z0-9]+/g, '_');
}

function separator(): string {
  return '-'.repeat(72);
}

function roleKey(role: Role): string {
  return role === 'unknown' ? '?' : `${role.text}\u0002${role.refs.join(',')}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Spec words inside a TLA+ comment must not open or close a block comment. */
function commentSafe(text: string): string {
  return text.replace(/\(\*/g, '( *').replace(/\*\)/g, '* )');
}
