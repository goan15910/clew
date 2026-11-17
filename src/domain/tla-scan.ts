// A light reader of a TLA+ module's text: its variables, its top-level definitions, the items of a bulleted
// conjunction or disjunction, and which names a piece of text mentions, primed or not. It is not a TLA+ parser. It
// reads the shape Clew exports and the edits an agent usually makes to it, and it never judges whether a module is
// correct: TLC does that. See docs/projection.md, decision D57.

export interface TlaDefinition {
  name: string;
  params: string[];
  /** First line of the definition, from 1. */
  line: number;
  /** Comment lines directly above the definition, without the comment marks. */
  comment: string[];
  /** The whole definition as written, header and body, comments included. */
  text: string;
  /** The body with comments blanked and the header replaced by spaces, so every token keeps its line and column. */
  body: string;
  /** `Name == INSTANCE Module ...`: the module it instances. */
  instanceOf?: string;
}

export interface TlaModule {
  name: string;
  extends: string[];
  variables: string[];
  constants: string[];
  definitions: TlaDefinition[];
  /** Everything above the first VARIABLE(S) line, after the EXTENDS line: constants and their definitions, as written. */
  preamble: string;
}

/** Blank out comments, keeping line breaks and columns, and leaving strings alone. */
export function blankComments(text: string): string {
  let out = '';
  let index = 0;
  let depth = 0;
  while (index < text.length) {
    const two = text.slice(index, index + 2);
    if (depth > 0) {
      if (two === '(*') {
        depth += 1;
        out += '  ';
        index += 2;
      } else if (two === '*)') {
        depth -= 1;
        out += '  ';
        index += 2;
      } else {
        out += text[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }
    if (two === '(*') {
      depth = 1;
      out += '  ';
      index += 2;
      continue;
    }
    if (two === '\\*') {
      while (index < text.length && text[index] !== '\n') {
        out += ' ';
        index += 1;
      }
      continue;
    }
    if (text[index] === '"') {
      let end = index + 1;
      while (end < text.length && text[end] !== '"' && text[end] !== '\n') end += text[end] === '\\' ? 2 : 1;
      out += text.slice(index, Math.min(end + 1, text.length));
      index = Math.min(end + 1, text.length);
      continue;
    }
    out += text[index] ?? '';
    index += 1;
  }
  return out;
}

const HEADER = /^(?:LOCAL\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*==/;
const UNIT_START = /^(?:VARIABLES?|CONSTANTS?|EXTENDS|ASSUME|ASSUMPTION|AXIOM|THEOREM|LEMMA|COROLLARY|PROPOSITION|INSTANCE|LOCAL\s+INSTANCE|RECURSIVE|USE|HIDE|={4,}|-{4,})\b/;

function nameList(text: string): string[] {
  const names: string[] = [];
  for (const part of text.split(',')) {
    const name = /[A-Za-z_][A-Za-z0-9_]*/.exec(part)?.[0];
    if (name !== undefined) names.push(name);
  }
  return names;
}

export function scanTlaModule(text: string): { ok: true; module: TlaModule } | { ok: false; message: string } {
  const raw = text.split(/\r?\n/);
  const clean = blankComments(raw.join('\n')).split('\n');
  const head = clean.findIndex((line) => /^-{4,}\s*MODULE\s+\w+/.test(line));
  if (head < 0) return { ok: false, message: 'no "---- MODULE Name ----" line' };
  const name = /MODULE\s+(\w+)/.exec(clean[head] ?? '')?.[1] ?? '';
  const module: TlaModule = { name, extends: [], variables: [], constants: [], definitions: [], preamble: '' };
  let firstVariables = -1;
  let afterExtends = head + 1;
  let index = head + 1;
  while (index < clean.length) {
    const line = clean[index] ?? '';
    if (/^={4,}/.test(line)) break;
    const header = HEADER.exec(line);
    const unit = UNIT_START.exec(line);
    if (header === null && unit === null) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < clean.length && HEADER.exec(clean[end] ?? '') === null && UNIT_START.exec(clean[end] ?? '') === null) end += 1;
    const block = clean.slice(index, end).join('\n');
    if (header !== null) {
      // Trailing blank and comment-only lines belong to what follows, not to this definition.
      let last = end;
      while (last > index + 1 && (clean[last - 1] ?? '').trim() === '') last -= 1;
      const comment: string[] = [];
      let above = index - 1;
      while (above > head && /^\s*\\\*/.test(raw[above] ?? '')) {
        comment.unshift((raw[above] ?? '').replace(/^\s*\\\*\s?/, ''));
        above -= 1;
      }
      const headerText = header[0];
      const bodyLines = clean.slice(index, last);
      bodyLines[0] = ' '.repeat(headerText.length) + (bodyLines[0] ?? '').slice(headerText.length);
      const definition: TlaDefinition = {
        name: header[1] ?? '',
        params: header[2] === undefined ? [] : nameList(header[2]),
        line: index + 1,
        comment,
        text: raw.slice(index, last).join('\n'),
        body: bodyLines.join('\n'),
      };
      const instance = /^\s*INSTANCE\s+(\w+)/.exec(definition.body);
      if (instance !== null && instance[1] !== undefined) definition.instanceOf = instance[1];
      module.definitions.push(definition);
    } else {
      const keyword = (unit?.[0] ?? '').replace(/\s+/g, ' ');
      const rest = block.slice((unit?.[0] ?? '').length);
      if (keyword === 'EXTENDS') {
        module.extends.push(...nameList(rest));
        afterExtends = end;
      } else if (keyword === 'VARIABLE' || keyword === 'VARIABLES') {
        module.variables.push(...nameList(rest));
        if (firstVariables < 0) firstVariables = index;
      } else if (keyword === 'CONSTANT' || keyword === 'CONSTANTS') {
        module.constants.push(...nameList(rest));
      }
    }
    index = end;
  }
  if (firstVariables >= 0) module.preamble = raw.slice(afterExtends, firstVariables).join('\n').trim();
  return { ok: true, module };
}

export interface JunctionItem {
  /** The item without its bullet, comments blanked. */
  text: string;
  /** Offsets of the item in the text it was split from, bullet included. */
  start: number;
  end: number;
}

export interface Junction {
  /** `and` and `or` are bulleted or inline lists; `single` is one expression. */
  op: 'and' | 'or' | 'single';
  bulleted: boolean;
  items: JunctionItem[];
}

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

/** Offsets where `symbol` stands outside every bracket and string. */
function topLevel(text: string, symbol: string): number[] {
  const found: number[] = [];
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (char === '"') {
      index += 1;
      while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1;
      continue;
    }
    if (text.startsWith('<<', index)) {
      depth += 1;
      index += 1;
      continue;
    }
    if (text.startsWith('>>', index)) {
      depth -= 1;
      index += 1;
      continue;
    }
    if (OPEN.has(char)) depth += 1;
    else if (CLOSE.has(char)) depth -= 1;
    else if (depth === 0 && text.startsWith(symbol, index)) {
      found.push(index);
      index += symbol.length - 1;
    }
  }
  return found;
}

function columnOf(text: string, offset: number): number {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  return offset - lineStart;
}

/** Words that open a scope an inline `/\` or `\/` may belong to, so an inline split would cut it in two. */
const SCOPED = /\\E|\\A|\bIF\b|\bLET\b|\bCASE\b|\bCHOOSE\b|=>|<=>|~/;

/**
 * Split an expression into the items of its outermost list. A bulleted list is read by the column of its bullets, as
 * TLA+ does. An expression with no bullets is split inline at `\/`, then at `/\`, when nothing in it opens a scope.
 */
export function splitJunction(text: string): Junction {
  const first = /\S/.exec(text);
  if (first === null) return { op: 'single', bulleted: false, items: [] };
  const lead = text.slice(first.index, first.index + 2);
  if (lead === '/\\' || lead === '\\/') {
    const column = columnOf(text, first.index);
    const starts = topLevelBullets(text, lead, column);
    const items: JunctionItem[] = [];
    for (let at = 0; at < starts.length; at += 1) {
      const start = starts[at] ?? 0;
      const end = starts[at + 1] ?? text.length;
      // Blank the bullet rather than cut it, so a nested list keeps its columns.
      items.push({ text: `${' '.repeat(column + 2)}${text.slice(start + 2, end)}`.replace(/\s+$/, ''), start, end });
    }
    return { op: lead === '/\\' ? 'and' : 'or', bulleted: true, items };
  }
  for (const [symbol, op] of [['\\/', 'or'], ['/\\', 'and']] as const) {
    const cuts = topLevel(text, symbol);
    if (cuts.length === 0) continue;
    if (SCOPED.test(maskBrackets(text))) break;
    if (op === 'and' && topLevel(text, '\\/').length > 0) break;
    const items: JunctionItem[] = [];
    let start = 0;
    for (const cut of [...cuts, text.length]) {
      items.push({ text: text.slice(start, cut).trim(), start, end: cut });
      start = cut + symbol.length;
    }
    return { op, bulleted: false, items };
  }
  return { op: 'single', bulleted: false, items: [{ text: text.trim(), start: 0, end: text.length }] };
}

/** The text with everything inside brackets replaced by spaces: what stands at the top level. */
function maskBrackets(text: string): string {
  let out = '';
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (text.startsWith('<<', index)) {
      depth += 1;
      out += '  ';
      index += 1;
      continue;
    }
    if (text.startsWith('>>', index)) {
      depth -= 1;
      out += '  ';
      index += 1;
      continue;
    }
    if (OPEN.has(char)) {
      depth += 1;
      out += ' ';
    } else if (CLOSE.has(char)) {
      depth -= 1;
      out += ' ';
    } else out += depth > 0 ? ' ' : char;
  }
  return out;
}

function topLevelBullets(text: string, bullet: string, column: number): number[] {
  const starts: number[] = [];
  for (const offset of topLevel(text, bullet)) {
    if (columnOf(text, offset) !== column) continue;
    // A bullet is the first thing on its line, or the first thing of the whole expression.
    const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
    if (text.slice(lineStart, offset).trim() === '' || starts.length === 0) starts.push(offset);
  }
  return starts;
}

export interface Mentions {
  /** Names that stand unprimed, outside UNCHANGED. */
  plain: Set<string>;
  /** Names followed by a prime, outside UNCHANGED. */
  primed: Set<string>;
  /** Names inside UNCHANGED. */
  unchanged: Set<string>;
}

/** Every identifier of the text, sorted into unprimed, primed, and left unchanged. Strings and field names are skipped. */
export function mentions(text: string): Mentions {
  const found: Mentions = { plain: new Set(), primed: new Set(), unchanged: new Set() };
  const unchangedSpans: [number, number][] = [];
  const pattern = /\bUNCHANGED\b\s*/g;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const from = match.index + match[0].length;
    let to = from;
    if (text.startsWith('<<', from)) {
      const close = text.indexOf('>>', from);
      to = close < 0 ? text.length : close + 2;
    } else {
      to = from + (/^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(from))?.[0].length ?? 0);
    }
    unchangedSpans.push([from, to]);
  }
  const words = /"(?:[^"\\\n]|\\.)*"|[A-Za-z_][A-Za-z0-9_]*/g;
  for (let match = words.exec(text); match !== null; match = words.exec(text)) {
    const word = match[0];
    if (word.startsWith('"')) continue;
    const at = match.index;
    // A record field (`r.field`) or an instance's operator (`M!Op`) is not a name of this module.
    const before = text[at - 1];
    if (before === '.' || before === '!') continue;
    if (unchangedSpans.some(([from, to]) => at >= from && at < to)) {
      found.unchanged.add(word);
      continue;
    }
    if (text[at + word.length] === "'") found.primed.add(word);
    else found.plain.add(word);
  }
  return found;
}
