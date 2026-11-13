// Reads a TLA+ module's `@frame` comments and lines the model up against the frames.
// The link is the comment, and the digest on it says which version of the frame the definition
// was written against. The match is textual: the frame's guard and effect, rewritten through the
// module's `@name` comments, must appear among the conjuncts of a definition that cites the frame.
import type { CompiledItem } from './spec-actions.js';
import type { FrameCompilation } from './spec-compile.js';
import { conjunctTexts, effectTexts } from './spec-expr.js';
import type { Finding, Frame } from './spec.js';
import { frameObligation, type TlaExpectation, type TlaObligationKind } from './spec-tla.js';

export interface TlaDefinition {
  name: string;
  /** 1-based line of the definition or declaration. */
  line: number;
  kind: 'definition' | 'variable';
  /** The definition as written, comments included. */
  text: string;
  /** The same lines without comments, columns kept. */
  code: string;
}

/** `\* @name order_status -> order`: what a frame-side name is called in this model. */
export interface TlaName {
  from: string;
  to: string;
  line: number;
}

export interface TlaAnnotation {
  frame: string;
  line: number;
  digest?: string;
  /** Set when the model leaves the frame out on purpose. */
  skip?: string;
  /** Set when the definition is meant to say something else than the frame compiles to. */
  differs?: string;
  /** Name of the definition or variable the comment sits on. */
  target?: string;
}

export interface TlaModule {
  name?: string;
  annotations: TlaAnnotation[];
  names: TlaName[];
  definitions: TlaDefinition[];
  /** Definition name → the other definitions its body names. */
  uses: Record<string, string[]>;
}

export type TlaAlignmentStatus = 'modelled' | 'skipped' | 'changed' | 'missing';

/**
 * `exact`: a cited definition says what the frame compiles to and leaves the rest unchanged.
 * `extended`: it says that and more. `differs`: part of the guard or effect is not there.
 */
export type TlaMatch = 'exact' | 'extended' | 'differs';

export interface TlaAlignmentRow {
  frame: string;
  sentence: string;
  clause: string;
  kind: TlaObligationKind;
  status: TlaAlignmentStatus;
  /** The frame's digest now. An `@frame` comment that carries another one is `changed`. */
  digest: string;
  expects: TlaExpectation;
  definitions: TlaDefinition[];
  skip?: string;
  /** Set for action and forbidden frames that a definition cites. */
  match?: TlaMatch;
  /** The frame's conjuncts, in the model's names, that no cited definition states. */
  absent?: string[];
  /** The reason after `differs:`, when the model departs from the frame on purpose. */
  accepted?: string;
}

export interface TlaAlignment {
  rows: TlaAlignmentRow[];
  findings: Finding[];
}

const ANNOTATION = /@frame\s+(fr:[^\s,;)]+)(?:\s+([0-9a-f]{8})(?![0-9A-Za-z]))?(?:\s+(skip|differs):\s*(.*))?/g;
const NAME = /@name\s+(\S+)\s*->\s*(.+)/;
const STRING = /"(?:[^"\\]|\\.)*"/g;
const TOKEN = /"(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_]*/g;
const DEFINITION = /^\s*(?:LOCAL\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*==/;
const DECLARATION = /^\s*(?:VARIABLES?|CONSTANTS?)\b/;
const UNIT_START = /^\s*(?:VARIABLES?|CONSTANTS?|ASSUME|ASSUMPTION|AXIOM|THEOREM|LEMMA|EXTENDS|INSTANCE|RECURSIVE)\b/;
const RULE = /^\s*(?:-{4,}|={4,})/;
const KEYWORDS: ReadonlySet<string> = new Set(['VARIABLE', 'VARIABLES', 'CONSTANT', 'CONSTANTS']);

interface OpenDefinition {
  definition: TlaDefinition;
  lines: string[];
  code: string[];
}

export function parseTlaModule(text: string): TlaModule {
  const module: TlaModule = { annotations: [], names: [], definitions: [], uses: {} };
  const bodies = new Map<string, string>();
  let depth = 0;
  let open: OpenDefinition | undefined;
  let declaring = false;
  let pending: TlaAnnotation[] = [];
  const close = (): void => {
    if (open === undefined) return;
    const kept = open.lines.slice();
    while (kept.length > 1 && open.code[kept.length - 1]?.trim() === '') kept.pop();
    open.definition.text = kept.join('\n');
    open.definition.code = open.code.slice(0, kept.length).join('\n');
    bodies.set(open.definition.name, `${bodies.get(open.definition.name) ?? ''} ${open.code.join(' ')}`);
    open = undefined;
  };
  const rawLines = text.split(/\r?\n/);
  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index] ?? '';
    const split = splitLine(raw, depth);
    depth = split.depth;
    const header = /^\s*-{4,}\s*MODULE\s+([A-Za-z0-9_]+)/.exec(split.code);
    if (header !== null) {
      if (module.name === undefined && header[1] !== undefined) module.name = header[1];
      continue;
    }
    const found: TlaAnnotation[] = [];
    for (const match of split.comment.matchAll(ANNOTATION)) {
      const annotation: TlaAnnotation = { frame: match[1] ?? '', line: index + 1 };
      if (match[2] !== undefined) annotation.digest = match[2];
      const reason = match[4]?.replace(/\*\)\s*$/, '').trim();
      if (match[3] === 'skip') annotation.skip = reason ?? '';
      if (match[3] === 'differs') annotation.differs = reason ?? '';
      found.push(annotation);
      module.annotations.push(annotation);
    }
    const named = NAME.exec(split.comment);
    if (named !== null && named[1] !== undefined && named[2] !== undefined) {
      module.names.push({ from: named[1], to: named[2].replace(/\*\)\s*$/, '').trim(), line: index + 1 });
    }
    const code = split.code;
    const blank = code.trim() === '';
    const defined = DEFINITION.exec(code);
    if (defined !== null && defined[1] !== undefined) {
      close();
      declaring = false;
      open = { definition: { name: defined[1], line: index + 1, kind: 'definition', text: '', code: '' }, lines: [raw.trimEnd()], code: [code] };
      module.definitions.push(open.definition);
      for (const annotation of [...pending, ...found]) {
        if (annotation.skip === undefined) annotation.target = open.definition.name;
      }
      pending = [];
      continue;
    }
    if (RULE.test(code) || UNIT_START.test(code)) {
      close();
      declaring = DECLARATION.test(code);
    } else if (blank && found.length > 0 && open !== undefined) {
      // A comment line that cites a frame starts the next definition's header.
      close();
    }
    if (declaring && !blank) {
      const name = declaredName(code);
      const waiting = [...pending, ...found].filter((annotation) => annotation.skip === undefined);
      if (name !== undefined && waiting.length > 0) {
        const variable: TlaDefinition = { name, line: index + 1, kind: 'variable', text: code.trim().replace(/,$/, ''), code: code.trim().replace(/,$/, '') };
        module.definitions.push(variable);
        for (const annotation of waiting) annotation.target = name;
        pending = [];
        continue;
      }
    }
    if (open !== undefined) {
      open.lines.push(raw.trimEnd());
      open.code.push(code);
      if (!blank) {
        for (const annotation of found) {
          if (annotation.skip === undefined) annotation.target = open.definition.name;
        }
        continue;
      }
    }
    for (const annotation of found) {
      if (annotation.skip === undefined && annotation.target === undefined) pending.push(annotation);
    }
  }
  close();
  const names = new Set<string>();
  for (const definition of module.definitions) {
    if (definition.kind === 'definition') names.add(definition.name);
  }
  for (const [name, body] of bodies) {
    const uses: string[] = [];
    for (const match of body.replace(STRING, ' ').matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      const word = match[0];
      if (word !== name && names.has(word) && !uses.includes(word)) uses.push(word);
    }
    module.uses[name] = uses;
  }
  return module;
}

/** Each frame beside the definitions that cite it, and what does not line up. */
export function tlaAlignment(frames: readonly Frame[], compilation: FrameCompilation, module: TlaModule): TlaAlignment {
  const findings: Finding[] = [];
  const cited = new Map<string, TlaAnnotation[]>();
  for (const annotation of module.annotations) {
    const list = cited.get(annotation.frame) ?? [];
    list.push(annotation);
    cited.set(annotation.frame, list);
  }
  const definitions = new Map<string, TlaDefinition>();
  for (const definition of module.definitions) {
    if (!definitions.has(definition.name)) definitions.set(definition.name, definition);
  }
  const live = reachable(module, 'Next');
  const items = compilation.compiled.items;
  const renames = new Map<string, string>();
  const vocabulary = frameVocabulary(compilation);
  for (const name of module.names) {
    if (vocabulary.has(name.from)) {
      renames.set(name.from, name.to);
      continue;
    }
    findings.push({
      id: `unknown-name:${name.from}`,
      kind: 'vocabulary',
      code: 'unknown-name',
      severity: 'blocking',
      message: `line ${name.line} renames ${name.from}, which no frame compiles to; the frames use ${[...vocabulary].join(', ')}`,
      refs: [name.from],
    });
  }
  const branches = new Map<string, string[][]>();
  const rows: TlaAlignmentRow[] = [];
  const known = new Set<string>();
  for (const frame of frames) {
    known.add(frame.id);
    const obligation = frameObligation(frame, compilation);
    const annotations = cited.get(frame.id) ?? [];
    if (obligation.kind === 'note' && annotations.length === 0) continue;
    const refs = [frame.id, frame.sentence];
    const row: TlaAlignmentRow = {
      frame: frame.id,
      sentence: frame.sentence,
      clause: obligation.clause,
      kind: obligation.kind,
      status: 'modelled',
      digest: obligation.digest,
      expects: obligation.expects,
      definitions: [],
    };
    rows.push(row);
    let dangling = false;
    let unstamped = false;
    let stale: TlaAnnotation | undefined;
    for (const annotation of annotations) {
      if (annotation.digest === undefined) unstamped = true;
      else if (annotation.digest !== obligation.digest) stale ??= annotation;
      if (annotation.skip !== undefined) {
        row.skip ??= annotation.skip;
        continue;
      }
      const definition = annotation.target === undefined ? undefined : definitions.get(annotation.target);
      if (definition === undefined) dangling = true;
      else if (!row.definitions.includes(definition)) row.definitions.push(definition);
    }
    if (dangling) {
      findings.push({
        id: `annotation-without-definition:${frame.id}`,
        kind: 'coverage',
        code: 'annotation-without-definition',
        severity: 'blocking',
        message: `an @frame ${frame.id} comment is followed by no definition`,
        refs,
      });
    }
    if (row.skip !== undefined && row.skip === '') {
      findings.push({
        id: `skip-without-reason:${frame.id}`,
        kind: 'coverage',
        code: 'skip-without-reason',
        severity: 'blocking',
        message: `${frame.id} is skipped with no reason after "skip:"`,
        refs,
      });
    }
    if (row.definitions.length === 0 && row.skip === undefined) {
      row.status = 'missing';
      if (!dangling) {
        findings.push({
          id: `frame-not-modelled:${frame.id}`,
          kind: 'coverage',
          code: 'frame-not-modelled',
          severity: 'blocking',
          message: `${frame.id} "${obligation.clause}" has no @frame comment in the model`,
          refs,
        });
      }
      continue;
    }
    if (stale !== undefined) {
      row.status = 'changed';
      findings.push({
        id: `frame-changed:${frame.id}`,
        kind: 'stale',
        code: 'frame-changed',
        severity: 'blocking',
        message: `${frame.id} changed since line ${stale.line} was written (${stale.digest ?? ''} then, ${obligation.digest} now): review ${names(row.definitions) || 'the skip'} against the frame, then write ${obligation.digest}`,
        refs,
      });
    } else {
      row.status = row.definitions.length === 0 ? 'skipped' : 'modelled';
      if (unstamped) {
        findings.push({
          id: `frame-unstamped:${frame.id}`,
          kind: 'stale',
          code: 'frame-unstamped',
          severity: 'info',
          message: `the @frame ${frame.id} comment has no digest, so a later change to the frame will go unnoticed; write ${obligation.digest} after the id`,
          refs,
        });
      }
    }
    const steps = row.definitions.filter((definition) => definition.kind === 'definition');
    const item = items.find((entry) => entry.id === (obligation.expects.restates ?? frame.id));
    const expected = item === undefined ? [] : expectedConjuncts(item, renames);
    if (expected.length > 0 && steps.length > 0) {
      const found = matchConjuncts(expected, steps, definitions, branches);
      row.match = found.match;
      if (found.absent.length > 0) row.absent = found.absent;
      const reason = annotations.find((annotation) => annotation.differs !== undefined)?.differs;
      if (reason !== undefined) row.accepted = reason;
      if (reason === '') {
        findings.push({
          id: `differs-without-reason:${frame.id}`,
          kind: 'conflict',
          code: 'differs-without-reason',
          severity: 'blocking',
          message: `${frame.id} is marked "differs:" with no reason after it`,
          refs,
        });
      } else if (found.match === 'differs' && reason === undefined) {
        findings.push({
          id: `frame-differs:${frame.id}`,
          kind: 'conflict',
          code: 'frame-differs',
          severity: 'blocking',
          message: `${frame.id} expects ${found.absent.join(' and ')}, which ${names(steps)} does not state; fix the definition, add an @name comment for a renamed variable or value, or mark the @frame comment "differs: <reason>"`,
          refs,
        });
      }
    }
    if (live !== undefined && (obligation.kind === 'action' || obligation.kind === 'restatement') && steps.length > 0 && !steps.some((definition) => live.has(definition.name))) {
      if (compilation.compiled.items.some((item) => item.id === (obligation.expects.restates ?? frame.id) && item.kind === 'action')) {
        findings.push({
          id: `action-not-in-next:${frame.id}`,
          kind: 'gap',
          code: 'action-not-in-next',
          severity: 'warning',
          message: `${frame.id} is modelled by ${names(steps)}, which Next never reaches`,
          refs,
        });
      }
    }
  }
  for (const [frameId, annotations] of cited) {
    if (known.has(frameId)) continue;
    const first = annotations[0];
    findings.push({
      id: `unknown-frame:${frameId}`,
      kind: 'stale',
      code: 'unknown-frame',
      severity: 'blocking',
      message: `line ${first?.line ?? 0} cites ${frameId}, which is not a frame of this session`,
      refs: [frameId],
    });
  }
  return { rows, findings };
}

/** Definitions `root` names, directly or through other definitions. Undefined when `root` is not defined. */
function reachable(module: TlaModule, root: string): Set<string> | undefined {
  if (module.uses[root] === undefined) return undefined;
  const seen = new Set<string>([root]);
  const queue = [root];
  for (let head = 0; head < queue.length; head += 1) {
    for (const next of module.uses[queue[head] ?? ''] ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function names(definitions: readonly TlaDefinition[]): string {
  return definitions.map((definition) => definition.name).join(', ');
}

/** Every variable and value the frames compile to: what an `@name` comment may rename. */
function frameVocabulary(compilation: FrameCompilation): Set<string> {
  const words = new Set<string>(['Null']);
  for (const decl of compilation.compiled.draft.vars) words.add(decl.id);
  for (const item of compilation.compiled.items) {
    for (const text of expectedConjuncts(item, new Map())) {
      for (const token of text.matchAll(TOKEN)) words.add(token[0]);
    }
  }
  return words;
}

/** The frame's guard and effect conjuncts in TLA+ ASCII, rewritten into the model's names. */
function expectedConjuncts(item: CompiledItem, names: ReadonlyMap<string, string>): string[] {
  if (item.kind !== 'action' && item.kind !== 'forbidden') return [];
  if (item.when === undefined || item.assign === undefined) return [];
  const texts = [...conjunctTexts(item.when, 'tla'), ...effectTexts(item.assign, 'tla')];
  return texts.map((text) => text.replace(TOKEN, (token) => {
    const to = names.get(token);
    if (to === undefined) return token;
    return /^(?:[A-Za-z_][A-Za-z0-9_]*|"[^"]*"|[0-9]+)$/.test(to) ? to : `(${to})`;
  }));
}

function matchConjuncts(
  expected: readonly string[],
  steps: readonly TlaDefinition[],
  definitions: ReadonlyMap<string, TlaDefinition>,
  cache: Map<string, string[][]>,
): { match: TlaMatch; absent: string[] } {
  let best: { match: TlaMatch; absent: string[] } | undefined;
  for (const step of steps) {
    for (const branch of branchesOf(step.name, definitions, cache, 0)) {
      const stated = new Set<string>();
      for (const conjunct of branch) stated.add(squeeze(conjunct));
      const absent = expected.filter((text) => !stated.has(squeeze(text)));
      const wanted = new Set<string>();
      for (const text of expected) wanted.add(squeeze(text));
      const extra = branch.some((conjunct) => !wanted.has(squeeze(conjunct)) && !/^UNCHANGED\b/.test(conjunct.trim()));
      const match: TlaMatch = absent.length > 0 ? 'differs' : extra ? 'extended' : 'exact';
      if (best === undefined || absent.length < best.absent.length || (absent.length === 0 && match === 'exact')) best = { match, absent };
    }
  }
  return best ?? { match: 'differs', absent: expected.slice() };
}

/** A definition as disjuncts of conjuncts. A conjunct that is only another definition's name is opened up. */
function branchesOf(name: string, definitions: ReadonlyMap<string, TlaDefinition>, cache: Map<string, string[][]>, depth: number): string[][] {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const definition = definitions.get(name);
  if (definition === undefined || definition.kind !== 'definition') return [];
  const body = bodyLines(definition.code);
  const result: string[][] = [];
  for (const branch of parseList(body)) {
    const only = branch.length === 1 ? definitions.get(squeeze(branch[0] ?? '')) : undefined;
    if (only !== undefined && only.kind === 'definition' && only.name !== name && depth < 6) {
      for (const inner of branchesOf(only.name, definitions, cache, depth + 1)) result.push(inner);
      continue;
    }
    const conjuncts: string[] = [];
    for (const conjunct of branch) {
      const named = definitions.get(squeeze(conjunct));
      const inner = named !== undefined && named.kind === 'definition' && named.name !== name && depth < 6 ? branchesOf(named.name, definitions, cache, depth + 1) : [];
      const single = inner.length === 1 ? inner[0] : undefined;
      if (single === undefined) conjuncts.push(conjunct);
      else for (const part of single) conjuncts.push(part);
    }
    result.push(conjuncts);
  }
  if (depth === 0) cache.set(name, result);
  return result;
}

/** The lines after `==`, columns kept, with a `[][~( ... )]_vars` wrapper blanked out. */
function bodyLines(code: string): string[] {
  const at = code.indexOf('==');
  let body = at < 0 ? code : `${' '.repeat(at + 2)}${code.slice(at + 2)}`;
  const wrapper = /^(\s*)(\[\]\[\s*~\s*\()/.exec(body);
  const end = body.lastIndexOf(')]_');
  if (wrapper !== null && wrapper[2] !== undefined && end > 0) {
    body = `${wrapper[1] ?? ''}${' '.repeat(wrapper[2].length)}${body.slice(wrapper[0].length, end)}`;
  }
  return body.split('\n');
}

/** Reads a bulleted or inline junction list. Bullets at the first bullet's column are the list's items. */
function parseList(lines: readonly string[]): string[][] {
  const first = lines.find((line) => line.trim() !== '');
  if (first === undefined) return [];
  const column = first.length - first.trimStart().length;
  const bullet = first.slice(column, column + 2);
  if (bullet !== '/\\' && bullet !== '\\/') {
    const joined = lines.join(' ');
    const disjuncts = splitTop(joined, '\\/');
    return disjuncts.map((disjunct) => splitTop(disjunct, '/\\'));
  }
  const items: string[][] = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    if (line.slice(0, column).trim() === '' && line.slice(column, column + 2) === bullet) {
      items.push([`${line.slice(0, column)}  ${line.slice(column + 2)}`]);
    } else {
      items[items.length - 1]?.push(line);
    }
  }
  if (bullet === '\\/') {
    const branches: string[][] = [];
    for (const item of items) {
      for (const branch of parseList(item)) branches.push(branch);
    }
    return branches;
  }
  const conjuncts: string[] = [];
  for (const item of items) {
    const inner = parseList(item);
    const single = inner.length === 1 ? inner[0] : undefined;
    if (single === undefined) conjuncts.push(item.join(' ').trim());
    else for (const part of single) conjuncts.push(part);
  }
  return [conjuncts];
}

/** Splits at `operator` outside brackets and strings. */
function splitTop(text: string, operator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (inString) {
      if (char === '\\') index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (depth === 0 && text.startsWith(operator, index)) {
      parts.push(text.slice(start, index).trim());
      start = index + operator.length;
      index += operator.length - 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter((part) => part !== '');
}

/** Whitespace and grouping parentheses do not change what a conjunct says. */
function squeeze(text: string): string {
  return text.replace(/\s+/g, '').replace(/[()]/g, '');
}

function declaredName(code: string): string | undefined {
  for (const match of code.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    if (!KEYWORDS.has(match[0])) return match[0];
  }
  return undefined;
}

/** Splits one line into code and comment text. `depth` is the open `(* *)` nesting carried between lines. */
function splitLine(line: string, depth: number): { code: string; comment: string; depth: number } {
  let code = '';
  let comment = '';
  let inString = false;
  let level = depth;
  for (let index = 0; index < line.length; index += 1) {
    const two = line.slice(index, index + 2);
    if (level > 0) {
      if (two === '(*') {
        level += 1;
        index += 1;
      } else if (two === '*)') {
        level -= 1;
        index += 1;
        comment += ' ';
      } else {
        comment += line.charAt(index);
      }
      continue;
    }
    const char = line.charAt(index);
    if (inString) {
      code += char;
      if (char === '\\') {
        code += line.charAt(index + 1);
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      code += char;
      continue;
    }
    if (two === '\\*') {
      comment += line.slice(index + 2);
      break;
    }
    if (two === '(*') {
      level += 1;
      index += 1;
      continue;
    }
    code += char;
  }
  return { code, comment, depth: level };
}
