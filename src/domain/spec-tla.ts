// Frames → TLA+ modules for the TLA+ tools, which the user runs; Clew never does.
// The frames module is the frames' own behavior. The model is the agent's: it starts as a copy and
// maps its own variables onto the frames module's. The check module extends the model and states
// what TLC should check: that the model refines the frames, and which frame actions it ever takes.
// Clew owns the frames module, the check module, and the two configs; it rewrites them on export.
import { conditionVar, type FrameCompilation } from './spec-compile.js';
import type { CompiledAction, CompiledForbidden, CompiledItem } from './spec-actions.js';
import { conjunctTexts, effectTexts, valueText } from './spec-expr.js';
import type { Frame } from './spec.js';
import type { Predicate, VarDecl } from './valuation.js';

export const TLA_MODULE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
export const TLA_MODULE_NAME_MESSAGE = 'a TLA+ module name starts with a letter and then uses letters, digits, or underscores';

/** The name a model gives its instance of the frames module. The check module reads the frames through it. */
export const TLA_FRAMES_INSTANCE = 'Frames';

/** What a model must define for the check module to parse. */
export const TLA_MODEL_NAMES: readonly string[] = [TLA_FRAMES_INSTANCE, 'Init', 'Next', 'Spec', 'vars'];

/** One action of the frames module, and the frames it stands for. */
export interface TlaFrameAction {
  /** The frame that compiles to the action. */
  frame: string;
  /** Frames that restate it. */
  restatedBy: string[];
  sentence: string;
  clause: string;
  event: string;
  /** The action's name in the frames module, for example `Approve_s1_t7`. */
  action: string;
}

export interface TlaModuleInput {
  module: string;
  session: string;
  frames: readonly Frame[];
  compilation: FrameCompilation;
}

export interface TlaFramesModule {
  module: string;
  tla: string;
  actions: TlaFrameAction[];
  /** Safety properties, one per forbidden frame. */
  properties: { frame: string; name: string }[];
  /** True when the module has a `ConditionsChange` step. */
  conditionsChange: boolean;
  /** Transition frames with a missing role. They are listed as comments and are not in the module. */
  todo: string[];
}

export interface TlaCheckModule {
  module: string;
  tla: string;
  /** Config for the refinement run. */
  cfg: string;
  /** Config for the coverage run, with `-coverage 1`. */
  coverageCfg: string;
  /** Frame action → the `Cover_` line TLC prints for it. */
  cover: { action: string; name: string }[];
}

/** Names the modules define themselves. An action that would collide gets a `Step` suffix. */
const RESERVED: ReadonlySet<string> = new Set(['Init', 'Next', 'Spec', 'TypeOK', 'Null', 'vars', TLA_FRAMES_INSTANCE, 'ConditionsChange']);

/** The frames' own behavior. Regenerated from the session on every export; nobody edits it. */
export function tlaFramesModule(input: TlaModuleInput): TlaFramesModule {
  return build(input, undefined);
}

/** A starter model: the frames module's actions under an identity mapping, for the agent to rewrite. */
export function tlaModelStarter(input: TlaModuleInput, framesModule: string): string {
  return build(input, framesModule).tla;
}

/** Extends the model with the refinement property, the forbidden-step properties, and one `Cover_` action per frame action. */
export function tlaCheckModule(input: { module: string; model: string; frames: TlaFramesModule }): TlaCheckModule {
  const instance = TLA_FRAMES_INSTANCE;
  const lines: string[] = [];
  header(lines, input.module);
  lines.push('(*');
  lines.push('  Written by clew spec tla export. Do not edit: export again instead.');
  lines.push('');
  lines.push(`  What TLC checks about ${input.model}, through its ${instance} mapping onto ${input.frames.module}.`);
  lines.push(`  ${input.model} must define ${TLA_MODEL_NAMES.join(', ')}.`);
  lines.push('');
  lines.push(`  Refinement, with ${input.module}.cfg: every step of ${input.model} is a step the frames`);
  lines.push('  allow, or leaves the mapped variables alone.');
  lines.push(`  Coverage, with ${input.model}Coverage.cfg and -coverage 1: TLC prints one line per`);
  lines.push('  Cover_ action below, as new states : steps taken. A line that ends in :0');
  lines.push('  is a frame action the model never takes.');
  lines.push('*)');
  lines.push(`EXTENDS ${input.model}`);
  lines.push('');
  lines.push(`RefinesFrames == ${instance}!Spec`);
  const properties: string[] = [];
  for (const property of input.frames.properties) {
    properties.push(`Frames_${property.name}`);
    lines.push(`Frames_${property.name} == ${instance}!${property.name}`);
  }
  lines.push('');
  lines.push(separator());
  lines.push(`\\* The steps of ${input.model}, sorted by the frame action each one is.`);
  lines.push('');
  const cover: { action: string; name: string }[] = [];
  const names: string[] = [];
  for (const action of input.frames.actions) {
    const name = `Cover_${action.action}`;
    cover.push({ action: action.action, name });
    names.push(name);
    lines.push(`\\* ${[action.frame, ...action.restatedBy].join(', ')}`);
    lines.push(`${name} == Next /\\ ${instance}!${action.action}`);
  }
  if (input.frames.conditionsChange) {
    names.push('Cover_ConditionsChange');
    lines.push('\\* Steps that only change a condition the frames leave open.');
    lines.push(`Cover_ConditionsChange == Next /\\ ${instance}!ConditionsChange`);
  }
  names.push('Cover_NoFrame');
  lines.push('\\* Steps that are no frame action: they leave the mapped variables alone.');
  lines.push(`Cover_NoFrame == Next /\\ ~${instance}!Next`);
  lines.push('');
  lines.push('CoverNext ==');
  for (const name of names) lines.push(`  \\/ ${name}`);
  lines.push('');
  lines.push('CoverSpec == Init /\\ [][CoverNext]_vars');
  lines.push('');
  footer(lines, input.module);
  const cfg = [
    `\\* Refinement run for ${input.model}.tla. Written by clew spec tla export; do not edit.`,
    `\\*   java -cp tla2tools.jar tlc2.TLC -config ${input.module}.cfg ${input.module}.tla`,
    'SPECIFICATION Spec',
    'PROPERTY RefinesFrames',
  ];
  for (const name of properties) cfg.push(`PROPERTY ${name}`);
  cfg.push('\\* A finished object has no next step; that is not a deadlock worth reporting.');
  cfg.push('CHECK_DEADLOCK FALSE');
  const coverageCfg = [
    `\\* Coverage run for ${input.model}.tla. Written by clew spec tla export; do not edit.`,
    `\\*   java -cp tla2tools.jar tlc2.TLC -coverage 1 -config ${input.model}Coverage.cfg ${input.module}.tla`,
    'SPECIFICATION CoverSpec',
    'CHECK_DEADLOCK FALSE',
  ];
  return { module: input.module, tla: `${lines.join('\n')}\n`, cfg: `${cfg.join('\n')}\n`, coverageCfg: `${coverageCfg.join('\n')}\n`, cover };
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

/** `refines` is the frames module a starter model instantiates; undefined writes the frames module itself. */
function build(input: TlaModuleInput, refines: string | undefined): TlaFramesModule {
  const draft = input.compilation.compiled.draft;
  const items = input.compilation.compiled.items;
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
  const placed = new Set<string>();
  const cite = (lines: string[], frameId: string, indent: string): void => {
    const frame = frames.get(frameId);
    if (frame === undefined) return;
    placed.add(frameId);
    lines.push(`${indent}\\* ${frameId}  ${frame.sentence} "${commentSafe(oneLine(frame.clause.text))}"`);
    const notes: string[] = [];
    const actor = frame.roles.actor.latest.value;
    if (actor !== 'unknown') notes.push(`actor ${commentSafe(oneLine(actor.text))}`);
    const when = frame.roles.when.latest.value;
    if (when !== 'unknown') notes.push(`when "${commentSafe(oneLine(when.text))}"`);
    if (notes.length > 0) lines.push(`${indent}\\*   ${notes.join('; ')}`);
  };
  const citeAll = (lines: string[], frameId: string): void => {
    for (const id of [frameId, ...(restaters.get(frameId) ?? [])]) cite(lines, id, '');
  };

  const lines: string[] = [];
  header(lines, input.module);
  lines.push('(*');
  if (refines === undefined) {
    lines.push('  Written by clew spec tla export. Do not edit: export again instead.');
    lines.push('');
    lines.push(`  What the frames of Clew session "${commentSafe(input.session)}" say, and nothing more: one`);
    lines.push('  variable per object, one action per transition frame, one high-level');
    lines.push('  action per event. A model maps its own variables onto these, and TLC');
    lines.push('  checks that the model refines Spec.');
  } else {
    lines.push(`  A model of Clew session "${commentSafe(input.session)}". Yours to edit.`);
    lines.push('');
    lines.push(`  It starts as a copy of ${refines}, which Clew exports from the frames.`);
    lines.push('  Rename, merge, split, and add the data the spec talks about, until the');
    lines.push(`  module says what the spec means. Keep ${TLA_FRAMES_INSTANCE}, the mapping below, in step:`);
    lines.push(`  it gives every variable of ${refines} as an expression over this`);
    lines.push('  model\'s variables.');
    lines.push('');
    lines.push(`  ${input.module}Check.tla, which Clew also writes, extends this module and tells TLC`);
    lines.push(`  what to check. It needs ${TLA_MODEL_NAMES.join(', ')} to stay defined here.`);
  }
  lines.push('*)');
  lines.push('');

  const conditions = new Map<string, string>();
  for (const frame of input.frames) {
    const name = conditionVar(frame.id);
    if (frame.notTransition !== undefined && draft.vars.some((decl) => decl.id === name)) conditions.set(name, frame.id);
  }
  lines.push('\\* An object that is in no state yet.');
  lines.push('Null == "null"');
  lines.push('');
  if (draft.vars.length > 0) {
    lines.push('VARIABLES');
    draft.vars.forEach((decl, index) => {
      const comma = index === draft.vars.length - 1 ? '' : ',';
      const frameId = conditions.get(decl.id);
      if (frameId !== undefined) {
        cite(lines, frameId, '  ');
        if (!assigned.has(decl.id)) {
          lines.push(refines === undefined
            ? '  \\*   The spec never says what sets this, so it may change at any time.'
            : '  \\*   TODO: the spec never says what sets this. Model the data behind it, and map it below.');
        }
      }
      lines.push(`  ${decl.id}${comma}`);
    });
    lines.push('');
    lines.push(`vars == <<${draft.vars.map((decl) => decl.id).join(', ')}>>`);
    lines.push('');
    if (refines !== undefined) {
      lines.push(`\\* The name mapping: each variable of ${refines} as an expression over this model's`);
      lines.push('\\* variables. It starts as the identity.');
      lines.push(`${TLA_FRAMES_INSTANCE} == INSTANCE ${refines} WITH`);
      draft.vars.forEach((decl, index) => {
        lines.push(`  ${decl.id} <- ${decl.id}${index === draft.vars.length - 1 ? '' : ','}`);
      });
      lines.push('');
    }
  }

  const sets = new Map<string, string>();
  for (const decl of draft.vars) {
    if (decl.type === 'boolean') continue;
    const name = claim(pascalName(decl.id));
    sets.set(decl.id, name);
    lines.push(`${name} == {${valuesOf(decl, items).map((value) => JSON.stringify(value)).join(', ')}}`);
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
  const named: TlaFrameAction[] = [];
  const groups: { name: string; members: string[] }[] = [];
  for (const event of events) {
    const group = byEvent.get(event) ?? [];
    const name = high.get(event) ?? pascalName(event);
    const members: string[] = [];
    for (const action of group) {
      const own = group.length === 1 ? name : claim(`${name}_${frameSuffix(action.id)}`);
      members.push(own);
      const frame = frames.get(action.id);
      named.push({
        frame: action.id,
        restatedBy: (restaters.get(action.id) ?? []).slice(),
        sentence: frame?.sentence ?? '',
        clause: oneLine(frame?.clause.text ?? ''),
        event: action.event,
        action: own,
      });
      citeAll(lines, action.id);
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
  const free = draft.vars.filter((decl) => decl.type === 'boolean' && !assigned.has(decl.id));
  const conditionsChange = refines === undefined && free.length > 0;
  if (conditionsChange) {
    lines.push('\\* The frames say nothing about when a condition becomes true or false.');
    lines.push('ConditionsChange ==');
    for (const decl of free) lines.push(`  /\\ ${decl.id}' \\in BOOLEAN`);
    const kept = draft.vars.filter((decl) => !free.includes(decl)).map((decl) => decl.id);
    if (kept.length > 0) lines.push(`  /\\ UNCHANGED ${kept.length === 1 ? kept[0] : `<<${kept.join(', ')}>>`}`);
    lines.push('');
  }
  lines.push('Next ==');
  if (events.length === 0 && !conditionsChange) lines.push('  FALSE');
  for (const event of events) lines.push(`  \\/ ${high.get(event) ?? pascalName(event)}`);
  if (conditionsChange) lines.push('  \\/ ConditionsChange');
  lines.push('');
  lines.push(draft.vars.length === 0 ? 'Spec == Init /\\ [][Next]_<<>>' : 'Spec == Init /\\ [][Next]_vars');
  lines.push('');

  const properties: { frame: string; name: string }[] = [];
  if (forbidden.length > 0) {
    const counts = new Map<string, number>();
    for (const item of forbidden) counts.set(item.event ?? '', (counts.get(item.event ?? '') ?? 0) + 1);
    if (refines === undefined) {
      lines.push(separator());
      lines.push('\\* Forbidden steps: one safety property per negated frame.');
      lines.push('');
    }
    for (const item of forbidden) {
      const base = `Never${pascalName(item.event ?? 'step')}`;
      const name = claim((counts.get(item.event ?? '') ?? 0) > 1 ? `${base}_${frameSuffix(item.id)}` : base);
      properties.push({ frame: item.id, name });
      placed.add(item.id);
      for (const id of restaters.get(item.id) ?? []) placed.add(id);
      if (refines !== undefined) continue;
      citeAll(lines, item.id);
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
    if (frame.notTransition === undefined && !placed.has(frame.id)) todo.push(frame.id);
  }
  if (todo.length > 0) {
    lines.push(separator());
    lines.push(refines === undefined
      ? '\\* Frames that do not compile yet. They are not part of this module.'
      : '\\* Frames that do not compile yet. Fix them in the session, then export again.');
    lines.push('');
    for (const id of todo) {
      const frame = frames.get(id);
      if (frame === undefined) continue;
      const missing: string[] = [];
      for (const role of ['event', 'object', 'result'] as const) {
        if (frame.roles[role].latest.value === 'unknown') missing.push(role);
      }
      const why = missing.length === 0 ? 'does not compile' : `no ${missing.join(', no ')}`;
      lines.push(`\\* ${id}  ${frame.sentence} "${commentSafe(oneLine(frame.clause.text))}" (${why})`);
    }
    lines.push('');
  }
  footer(lines, input.module);
  return { module: input.module, tla: `${lines.join('\n')}\n`, actions: named, properties, conditionsChange, todo };
}

function header(lines: string[], module: string): void {
  const title = ` MODULE ${module} `;
  const rule = '-'.repeat(Math.max(4, Math.floor((72 - title.length) / 2)));
  lines.push(`${rule}${title}${rule}`);
}

function footer(lines: string[], module: string): void {
  const title = ` MODULE ${module} `;
  const rule = Math.max(4, Math.floor((72 - title.length) / 2));
  lines.push('='.repeat(Math.max(4, rule * 2 + title.length)));
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

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Spec words inside a TLA+ comment must not open or close a block comment. */
function commentSafe(text: string): string {
  return text.replace(/\(\*/g, '( *').replace(/\*\)/g, '* )');
}
