// Reads the little of a TLA+ model that Clew needs: its name, the frames module it instantiates as
// `Frames`, and the names it defines. This is a pattern scan, not a parser. Whether the model
// parses, and whether it refines the frames, is for the TLA+ tools to say.
import { TLA_FRAMES_INSTANCE } from './spec-tla.js';

export interface TlaModel {
  name?: string;
  /** The module after `Frames == INSTANCE`. */
  framesModule?: string;
  /** Names with a definition or a variable declaration in this file. */
  defined: string[];
}

const DEFINITION = /^\s*(?:LOCAL\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*==/;
const DECLARATION = /^\s*(?:VARIABLES?|CONSTANTS?)\b(.*)$/;
const STRING = /"(?:[^"\\]|\\.)*"/g;

export function parseTlaModel(text: string): TlaModel {
  const model: TlaModel = { defined: [] };
  const code: string[] = [];
  let depth = 0;
  let declaring = false;
  for (const raw of text.split(/\r?\n/)) {
    const split = stripComments(raw, depth);
    depth = split.depth;
    const line = split.code.replace(STRING, '""');
    code.push(line);
    const header = /^\s*-{4,}\s*MODULE\s+([A-Za-z0-9_]+)/.exec(line);
    if (header !== null) {
      if (model.name === undefined && header[1] !== undefined) model.name = header[1];
      continue;
    }
    const defined = DEFINITION.exec(line);
    if (defined !== null && defined[1] !== undefined) {
      declaring = false;
      if (!model.defined.includes(defined[1])) model.defined.push(defined[1]);
      continue;
    }
    const declared = DECLARATION.exec(line);
    if (declared !== null) declaring = true;
    else if (line.trim() === '' || /^\s*(?:-{4,}|={4,})/.test(line)) declaring = line.trim() === '' && declaring;
    if (!declaring) continue;
    for (const match of (declared === null ? line : declared[1] ?? '').matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      if (!model.defined.includes(match[0])) model.defined.push(match[0]);
    }
  }
  const instance = new RegExp(`\\b${TLA_FRAMES_INSTANCE}\\s*==\\s*INSTANCE\\s+([A-Za-z_][A-Za-z0-9_]*)`).exec(code.join('\n'));
  if (instance !== null && instance[1] !== undefined) model.framesModule = instance[1];
  return model;
}

/** One line without its comments. `depth` is the open `(* *)` nesting carried between lines. */
function stripComments(line: string, depth: number): { code: string; depth: number } {
  let code = '';
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
    if (two === '\\*') break;
    if (two === '(*') {
      level += 1;
      index += 1;
      continue;
    }
    code += char;
  }
  return { code, depth: level };
}
