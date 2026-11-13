// Reads a TLA+ module's `@frame` comments and lines the model up against the frames.
// Clew does not parse TLA+ semantics: the link is the comment, and the digest on it says
// which version of the frame the definition was written against.
import type { FrameCompilation } from './spec-compile.js';
import type { Finding, Frame } from './spec.js';
import { frameObligation, type TlaExpectation, type TlaObligationKind } from './spec-tla.js';

export interface TlaDefinition {
  name: string;
  /** 1-based line of the definition or declaration. */
  line: number;
  kind: 'definition' | 'variable';
  /** The definition as written, comments included. */
  text: string;
}

export interface TlaAnnotation {
  frame: string;
  line: number;
  digest?: string;
  /** Set when the model leaves the frame out on purpose. */
  skip?: string;
  /** Name of the definition or variable the comment sits on. */
  target?: string;
}

export interface TlaModule {
  name?: string;
  annotations: TlaAnnotation[];
  definitions: TlaDefinition[];
  /** Modules the model instantiates, in order. */
  instances: string[];
  /** Definition name → the other definitions its body names. */
  uses: Record<string, string[]>;
}

export type TlaAlignmentStatus = 'modelled' | 'skipped' | 'changed' | 'missing';

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
}

export interface TlaAlignment {
  rows: TlaAlignmentRow[];
  findings: Finding[];
}

const ANNOTATION = /@frame\s+(fr:[^\s,;)]+)(?:\s+([0-9a-f]{8})(?![0-9A-Za-z]))?(?:\s+skip:\s*(.*))?/g;
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
  const module: TlaModule = { annotations: [], definitions: [], instances: [], uses: {} };
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
      if (match[3] !== undefined) annotation.skip = match[3].replace(/\*\)\s*$/, '').trim();
      found.push(annotation);
      module.annotations.push(annotation);
    }
    const code = split.code;
    for (const match of code.matchAll(/\bINSTANCE\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (match[1] !== undefined && !module.instances.includes(match[1])) module.instances.push(match[1]);
    }
    const blank = code.trim() === '';
    const defined = DEFINITION.exec(code);
    if (defined !== null && defined[1] !== undefined) {
      close();
      declaring = false;
      open = { definition: { name: defined[1], line: index + 1, kind: 'definition', text: '' }, lines: [raw.trimEnd()], code: [code] };
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
        const variable: TlaDefinition = { name, line: index + 1, kind: 'variable', text: code.trim().replace(/,$/, '') };
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
    for (const match of body.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
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
      if (char === '\\') index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      code += ' ';
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
