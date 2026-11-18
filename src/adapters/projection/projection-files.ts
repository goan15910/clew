// File-system and process adapters of projected views: the TLA+ text files, projections.json beside a session's
// sentences (zod stays at this boundary), and Graphviz for the pictures.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { GraphImageWriter, ProjectionFiles, ProjectionState, ProjectionStore } from '../../application/projection.js';
import { specSessionDir } from '../spec-store/data-dir.js';
import { sha256Prefixed } from '../spec-store/read-spec.js';
import { tlaTextFiles } from '../tla/text-files.js';

export const PROJECTIONS_FILE = 'projections.json';

/** A state graph of this size is still read in one piece. Larger dumps are refused with a way forward. */
const MAX_DUMP_BYTES = 400 * 1024 * 1024;

export const projectionFiles: ProjectionFiles = {
  ...tlaTextFiles,
  read(file) {
    if (file !== '-' && existsSync(file)) {
      try {
        const size = statSync(file).size;
        if (size > MAX_DUMP_BYTES) return { ok: false, message: `${file} is ${Math.round(size / (1024 * 1024))} MB, too large to read whole: draft a view of fewer variables and dump that instead` };
      } catch {
        // Fall through: the text reader reports the failure.
      }
    }
    return tlaTextFiles.read(file);
  },
  join: (dir, file) => join(dir, file),
  dirname: (file) => dirname(resolve(file)),
  temporary: (name) => join(mkdtempSync(join(tmpdir(), 'clew-projection-')), name),
  remove(file) {
    // The file sits alone in a directory `temporary` made.
    rmSync(dirname(file), { recursive: true, force: true });
  },
  hash: sha256Prefixed,
};

const CheckSchema = z.strictObject({
  at: z.string(),
  status: z.enum(['implements', 'violation', 'error', 'timeout']),
  view: z.string(),
  model: z.string(),
  viewHash: z.string(),
  modelHash: z.string(),
  states: z.number().int().min(0).optional(),
  neverTaken: z.array(z.string()).optional(),
});

const RecordSchema = z.strictObject({
  name: z.string().min(1),
  keep: z.array(z.string().min(1)).min(1),
  candidate: z.string().optional(),
  status: z.enum(['proposed', 'final', 'dropped']),
  check: CheckSchema.optional(),
  history: z.array(z.strictObject({
    at: z.string(),
    who: z.string(),
    reason: z.string(),
    action: z.enum(['propose', 'check', 'finalize', 'drop']),
    keep: z.array(z.string()).optional(),
    note: z.string().optional(),
  })),
});

const StateSchema = z.strictObject({ schemaVersion: z.literal(1), projections: z.array(RecordSchema) });

export function projectionFileStore(env: NodeJS.ProcessEnv = process.env): ProjectionStore {
  const fileOf = (session: string): string => join(specSessionDir(session, env), PROJECTIONS_FILE);
  return {
    read(session) {
      const file = fileOf(session);
      if (!existsSync(file)) return { ok: true, state: undefined };
      try {
        const parsed = StateSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
        if (!parsed.success) return { ok: false, message: `${file}: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')}` };
        // Round-trip through JSON drops the keys zod reads as present-but-undefined.
        return { ok: true, state: JSON.parse(JSON.stringify(parsed.data)) as ProjectionState };
      } catch (error) {
        return { ok: false, message: `${file}: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
    write(session, state) {
      const file = fileOf(session);
      if (!existsSync(dirname(file))) return { ok: false, message: `spec session "${session}" has no directory` };
      try {
        const temporary = `${file}.${process.pid}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
        renameSync(temporary, file);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: `cannot write ${file}: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  };
}

/** Graphviz `dot` for .svg and .png; a .dot file is written as it is. */
export const graphvizImageWriter: GraphImageWriter = {
  write(file, dot) {
    const directory = dirname(resolve(file));
    if (!existsSync(directory)) return { ok: false, message: `cannot write ${file}: directory does not exist` };
    try {
      if (/\.dot$/i.test(file)) {
        writeFileSync(file, dot);
        return { ok: true };
      }
      const png = /\.png$/i.test(file);
      const image = execFileSync('dot', png ? ['-Tpng', '-Gdpi=144'] : ['-Tsvg'], { input: dot, maxBuffer: 64 * 1024 * 1024 });
      writeFileSync(file, image);
      return { ok: true };
    } catch (error) {
      const missing = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
      if (missing) return { ok: false, message: 'Graphviz `dot` is not installed: install Graphviz (scripts/install-graphviz.sh), or write --out <file>.dot and draw it elsewhere' };
      return { ok: false, message: `Graphviz \`dot\` failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  },
};
