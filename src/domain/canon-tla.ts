// The compiled behaviour model as TLA+ text. Clew owns the blocks module and its config and rewrites them on
// every export. The model starter is the agent's: it begins as a copy that instantiates the blocks module, and
// the check module tells TLC to check that the agent's model refines the blocks, one Cover_ line per action.
import { NULL, type ActionModel, type CanonModel, type NounModel, type Param } from './canon-compile.js';

export interface CanonTlaFiles {
  blocks: { module: string; tla: string; cfg: string };
  model: { module: string; tla: string };
  check: { module: string; tla: string; cfg: string; coverageCfg: string };
}

export interface CanonTlaInput {
  /** Base name: `Order` writes OrderBlocks, Order, OrderCheck. */
  name: string;
  session: string;
  model: CanonModel;
}

export const CANON_MODULE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

function comment(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\(\*/g, '( *').replace(/\*\)/g, '* )').trim();
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function setText(values: readonly string[]): string {
  return `{${values.map(quote).join(', ')}}`;
}

function header(lines: string[], module: string): void {
  const title = ` MODULE ${module} `;
  const side = Math.max(4, Math.floor((76 - title.length) / 2));
  lines.push(`${'-'.repeat(side)}${title}${'-'.repeat(side)}`);
}

function footer(lines: string[]): void {
  lines.push('='.repeat(77));
}

function statesName(noun: NounModel): string {
  return noun.statesSet ?? 'STRING';
}

/** A guard as one conjunct: a disjunction or a quantifier is wrapped, so it cannot reach past its line. */
function conjunct(text: string): string {
  if (/^\\[AE] /.test(text) || /^~\(/.test(text)) return `(${text})`;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (depth === 0 && text.startsWith('\\/', index)) return `(${text})`;
  }
  return text;
}

function allVars(model: CanonModel): string[] {
  const vars: string[] = [];
  for (const noun of model.nouns) if (noun.statusVar !== undefined) vars.push(noun.statusVar);
  for (const link of model.links) vars.push(link.var);
  for (const condition of model.conditions) vars.push(condition.var);
  vars.push(model.actor.var);
  return vars;
}

function unchanged(vars: readonly string[]): string {
  if (vars.length === 0) return 'TRUE';
  return vars.length === 1 ? `UNCHANGED ${vars[0]}` : `UNCHANGED <<${vars.join(', ')}>>`;
}

function call(action: ActionModel): string {
  return action.params.length === 0 ? action.name : `${action.name}(${action.params.map((param) => param.name).join(', ')})`;
}

function quantified(params: readonly Param[], body: string): string {
  if (params.length === 0) return body;
  return `\\E ${params.map((param) => `${param.name} \\in ${param.set}`).join(', ')} : ${body}`;
}

/** The body of the module from the constants down to Spec, shared by the blocks module and the model starter. */
function body(input: CanonTlaInput, lines: string[]): string[] {
  const { model } = input;
  const vars = allVars(model);
  const actor = model.actor;
  const anyone = `${actor.set} \\cup {${NULL}}`;
  lines.push('EXTENDS Naturals, FiniteSets');
  lines.push('');
  lines.push('\\* An object that is in no state yet, and a link that points nowhere.');
  lines.push(`${NULL} == "null"`);
  lines.push('');
  lines.push(`\\* Who can act. ${actor.var} holds who took the last step; it is ${NULL} at the start and after an environment step.`);
  lines.push(`${actor.set} == ${setText(actor.actors)}`);
  lines.push('');
  for (const noun of model.nouns) {
    if (noun.instanceSet !== undefined) lines.push(`${noun.instanceSet} == ${setText(noun.instances)}`);
    if (noun.statusVar !== undefined) lines.push(`${statesName(noun)} == ${setText(noun.states)}`);
  }
  for (const owned of model.ownership) {
    const cases = Object.entries(owned.map).map(([from, to]) => `i = ${quote(from)} -> ${quote(to)}`);
    lines.push(`\\* Which ${owned.owner} each ${owned.object} belongs to. No sentence links them, so the model fixes it.`);
    lines.push(`${owned.name} == [i \\in ${model.nouns.find((noun) => noun.noun === owned.object)?.instanceSet ?? 'BOOLEAN'} |-> CASE ${cases.join(' [] ')}]`);
  }
  lines.push('');
  if (vars.length > 0) {
    lines.push(`VARIABLES ${vars.join(', ')}`);
    lines.push(`vars == <<${vars.join(', ')}>>`);
  } else {
    lines.push('vars == <<>>');
  }
  lines.push('');
  const typeLines: string[] = [];
  const initLines: string[] = [];
  for (const noun of model.nouns) {
    if (noun.statusVar === undefined) continue;
    const states = statesName(noun);
    const values = noun.abstract ? states : `${states} \\cup {${NULL}}`;
    typeLines.push(noun.instanceSet === undefined ? `${noun.statusVar} \\in ${values}` : `${noun.statusVar} \\in [${noun.instanceSet} -> ${values}]`);
    let start: string;
    if (noun.abstract) start = noun.instanceSet === undefined ? `${noun.statusVar} \\in ${states}` : `${noun.statusVar} \\in [${noun.instanceSet} -> ${states}]`;
    else if (noun.initial.length > 1) start = noun.instanceSet === undefined ? `${noun.statusVar} \\in ${setText(noun.initial)}` : `${noun.statusVar} \\in [${noun.instanceSet} -> ${setText(noun.initial)}]`;
    else {
      const value = noun.initial[0] === undefined ? NULL : quote(noun.initial[0]);
      start = noun.instanceSet === undefined ? `${noun.statusVar} = ${value}` : `${noun.statusVar} = [i \\in ${noun.instanceSet} |-> ${value}]`;
    }
    initLines.push(`${start}${noun.abstract ? (noun.fixed ? '   \\* abstract and fixed: picked once' : '   \\* abstract: no sentence changes it') : noun.initial.length > 0 ? '   \\* starts as marked' : ''}`);
  }
  for (const link of model.links) {
    const object = model.nouns.find((noun) => noun.noun === link.object);
    const target = model.nouns.find((noun) => noun.noun === link.target);
    const values = `${target?.instanceSet ?? 'BOOLEAN'} \\cup {${NULL}}`;
    typeLines.push(object?.instanceSet === undefined ? `${link.var} \\in ${values}` : `${link.var} \\in [${object.instanceSet} -> ${values}]`);
    initLines.push(object?.instanceSet === undefined ? `${link.var} = ${NULL}` : `${link.var} = [i \\in ${object.instanceSet} |-> ${NULL}]`);
  }
  for (const condition of model.conditions) {
    typeLines.push(`${condition.var} \\in BOOLEAN`);
    initLines.push(`${condition.var} \\in BOOLEAN   \\* ${condition.kind} ${condition.noun}: the environment sets it`);
  }
  typeLines.push(`${actor.var} \\in ${anyone}`);
  initLines.push(`${actor.var} = ${NULL}   \\* nobody has acted yet`);
  lines.push('TypeOK ==');
  if (typeLines.length === 0) lines.push('  TRUE');
  for (const line of typeLines) lines.push(`  /\\ ${line}`);
  lines.push('');
  lines.push('Init ==');
  if (initLines.length === 0) lines.push('  TRUE');
  for (const line of initLines) lines.push(`  /\\ ${line}`);
  lines.push('');
  for (const action of model.actions) {
    lines.push(`\\* ${action.sentence}${action.branch > 1 || model.actions.some((other) => other !== action && other.sentence === action.sentence) ? ` branch ${action.branch}` : ''}: "${comment(action.text)}"`);
    lines.push(`\\*   actor ${action.actor || 'unknown'}${action.notes.map((note) => `; ${note.tla}`).join('')}`);
    lines.push(`${call(action)} ==`);
    for (const guard of action.guards) lines.push(`  /\\ ${conjunct(guard.tla)}   \\* ${guard.from}: "${comment(guard.words)}"`);
    if (action.actor === '') lines.push(`  /\\ ${actor.var}' \\in ${anyone}   \\* no actor is stated: anyone may take this step`);
    const changed = Object.keys(action.updates);
    for (const variable of changed) lines.push(`  /\\ ${variable}' = ${action.updates[variable] ?? variable}`);
    const kept = vars.filter((variable) => !changed.includes(variable) && variable !== actor.var);
    if (kept.length > 0) lines.push(`  /\\ ${unchanged(kept)}`);
    if (action.guards.length === 0 && changed.length === 0 && kept.length === 0) lines.push('  TRUE');
    lines.push('');
  }
  lines.push('\\* Every step the sentences state.');
  lines.push('Actions ==');
  if (model.actions.length === 0) lines.push('  FALSE');
  for (const action of model.actions) lines.push(`  \\/ ${quantified(action.params, call(action))}`);
  lines.push('');
  const environment: string[] = [];
  for (const noun of model.nouns) {
    if (!noun.abstract || noun.fixed || noun.statusVar === undefined) continue;
    const others = vars.filter((variable) => variable !== noun.statusVar && variable !== actor.var);
    const change = noun.instanceSet === undefined
      ? `${noun.statusVar}' \\in ${statesName(noun)}`
      : `\\E i \\in ${noun.instanceSet}, s \\in ${statesName(noun)} : ${noun.statusVar}' = [${noun.statusVar} EXCEPT ![i] = s]`;
    environment.push(`(${change} /\\ ${actor.var}' = ${NULL} /\\ ${unchanged(others)})`);
  }
  for (const condition of model.conditions) {
    const others = vars.filter((variable) => variable !== condition.var && variable !== actor.var);
    environment.push(`(${condition.var}' = ~${condition.var} /\\ ${actor.var}' = ${NULL} /\\ ${unchanged(others)})`);
  }
  if (environment.length > 0) {
    lines.push('\\* Conditions no sentence sets: the environment changes them, one at a time. Nobody acts in such a step.');
    lines.push('Environment ==');
    for (const line of environment) lines.push(`  \\/ ${line}`);
    lines.push('');
  }
  lines.push(`Next == Actions${environment.length > 0 ? ' \\/ Environment' : ''}`);
  lines.push('');
  lines.push(vars.length === 0 ? 'Spec == Init /\\ [][Next]_<<>>' : 'Spec == Init /\\ [][Next]_vars');
  lines.push('');
  return vars;
}

function properties(input: CanonTlaInput, lines: string[]): { invariants: string[]; properties: string[] } {
  const { model } = input;
  const invariants = ['TypeOK'];
  const props: string[] = [];
  if (model.hasFinals) {
    const done: string[] = [];
    for (const noun of model.nouns) {
      if (noun.finals.length === 0 || noun.statusVar === undefined) continue;
      const finals = `${setText(noun.finals)} \\cup {${NULL}}`;
      done.push(noun.instanceSet === undefined ? `${noun.statusVar} \\in ${finals}` : `\\A i \\in ${noun.instanceSet} : ${noun.statusVar}[i] \\in ${finals}`);
    }
    lines.push('\\* Every object with a final state is in one, or was never created.');
    lines.push('Done ==');
    for (const line of done) lines.push(`  /\\ ${line}`);
    lines.push('');
    lines.push('\\* A state where no stated step can happen must be a finished one.');
    lines.push('NoStuck == (~ENABLED Actions) => Done');
    lines.push('');
    invariants.push('NoStuck');
  }
  for (const invariant of model.invariants) {
    lines.push(`\\* ${invariant.sentence}: "${comment(invariant.text)}"`);
    lines.push(`${invariant.name} == ${invariant.tla}`);
    lines.push('');
    invariants.push(invariant.name);
  }
  for (const refusal of model.refusals) {
    lines.push(`\\* ${refusal.sentence}: "${comment(refusal.text)}"`);
    const parts = refusal.over.map((item) => {
      const action = model.actions.find((candidate) => candidate.name === item.action);
      const head = action === undefined ? item.action : call(action);
      const inner = `${item.as === undefined ? head : `(${head} /\\ ${model.actor.var}' = ${quote(item.as)})`} => ~(${item.when})`;
      return item.params.length === 0 ? inner : `\\A ${item.params.map((param) => `${param.name} \\in ${param.set}`).join(', ')} : ${inner}`;
    });
    lines.push(`${refusal.name} == [][${parts.map((part) => `(${part})`).join(' /\\ ')}]_vars`);
    lines.push('');
    props.push(refusal.name);
  }
  return { invariants, properties: props };
}

export function canonTlaFiles(input: CanonTlaInput): CanonTlaFiles {
  const blocksName = `${input.name}Blocks`;
  const checkName = `${input.name}Check`;

  const blocks: string[] = [];
  header(blocks, blocksName);
  blocks.push('(*');
  blocks.push('  Written by clew spec canon export. Do not edit: export again instead.');
  blocks.push('');
  blocks.push(`  What the accepted sentences of Clew session "${comment(input.session)}" say, and nothing more.`);
  blocks.push('  One action per branch of each sentence: its clauses happen in one step.');
  blocks.push('  Each guard and effect names the sentence and the words it came from.');
  blocks.push(`  Each action names who takes it (${input.model.actor.var}' = ...): that guard is the authorization the sentence states.`);
  blocks.push('*)');
  body(input, blocks);
  const checked = properties(input, blocks);
  footer(blocks);
  const cfg = [
    `\\* Written by clew spec canon export; do not edit.`,
    `\\*   java -cp tla2tools.jar tlc2.TLC -deadlock -config ${blocksName}.cfg ${blocksName}.tla`,
    'SPECIFICATION Spec',
    ...checked.invariants.map((name) => `INVARIANT ${name}`),
    ...checked.properties.map((name) => `PROPERTY ${name}`),
    '\\* A finished object has no next step. NoStuck tells a dead end from a finished object instead.',
    'CHECK_DEADLOCK FALSE',
  ];

  const model: string[] = [];
  header(model, input.name);
  model.push('(*');
  model.push(`  A model of Clew session "${comment(input.session)}". Yours to edit.`);
  model.push('');
  model.push(`  It starts as a copy of ${blocksName}, which Clew exports from the accepted sentences.`);
  model.push('  Rename, merge, split, and add data until it says what the spec means. Keep');
  model.push(`  Blocks, the mapping below, in step: it gives every variable of ${blocksName} as an`);
  model.push(`  expression over this model's variables. ${checkName}.tla checks the mapping with TLC.`);
  model.push('*)');
  const vars = body(input, model);
  model.push(`Blocks == INSTANCE ${blocksName}${vars.length === 0 ? '' : ` WITH ${vars.map((variable) => `${variable} <- ${variable}`).join(', ')}`}`);
  model.push('');
  footer(model);

  const check: string[] = [];
  header(check, checkName);
  check.push('(*');
  check.push('  Written by clew spec canon export. Do not edit: export again instead.');
  check.push('');
  check.push(`  Refinement, with ${checkName}.cfg: every step of ${input.name} is a step of ${blocksName},`);
  check.push('  or leaves its variables alone, and no refused step happens.');
  check.push(`  Coverage, with ${input.name}Coverage.cfg and -coverage 1: TLC prints one line per Cover_`);
  check.push('  action. A line that ends in :0 is a stated step the model never takes.');
  check.push('*)');
  check.push(`EXTENDS ${input.name}`);
  check.push('');
  check.push('RefinesBlocks == Blocks!Spec');
  const lifted: string[] = [];
  for (const refusal of input.model.refusals) {
    lifted.push(`Blocks_${refusal.name}`);
    check.push(`Blocks_${refusal.name} == Blocks!${refusal.name}`);
  }
  check.push('');
  const covers: string[] = [];
  for (const action of input.model.actions) {
    const name = `Cover_${action.name}`;
    covers.push(name);
    check.push(`\\* ${action.sentence}: "${comment(action.text)}"`);
    check.push(`${name} == Next /\\ ${quantified(action.params, `Blocks!${call(action)}`)}`);
  }
  check.push('\\* Steps that are no stated action.');
  check.push('Cover_Other == Next /\\ ~Blocks!Actions');
  covers.push('Cover_Other');
  check.push('');
  check.push('CoverNext ==');
  for (const name of covers) check.push(`  \\/ ${name}`);
  check.push('');
  check.push('CoverSpec == Init /\\ [][CoverNext]_vars');
  check.push('');
  footer(check);
  const checkCfg = [
    `\\* Refinement run for ${input.name}.tla. Written by clew spec canon export; do not edit.`,
    `\\*   java -cp tla2tools.jar tlc2.TLC -config ${checkName}.cfg ${checkName}.tla`,
    'SPECIFICATION Spec',
    'PROPERTY RefinesBlocks',
    ...lifted.map((name) => `PROPERTY ${name}`),
    'CHECK_DEADLOCK FALSE',
  ];
  const coverageCfg = [
    `\\* Coverage run for ${input.name}.tla. Written by clew spec canon export; do not edit.`,
    `\\*   java -cp tla2tools.jar tlc2.TLC -coverage 1 -config ${input.name}Coverage.cfg ${checkName}.tla`,
    'SPECIFICATION CoverSpec',
    'CHECK_DEADLOCK FALSE',
  ];
  return {
    blocks: { module: blocksName, tla: `${blocks.join('\n')}\n`, cfg: `${cfg.join('\n')}\n` },
    model: { module: input.name, tla: `${model.join('\n')}\n` },
    check: { module: checkName, tla: `${check.join('\n')}\n`, cfg: `${checkCfg.join('\n')}\n`, coverageCfg: `${coverageCfg.join('\n')}\n` },
  };
}
