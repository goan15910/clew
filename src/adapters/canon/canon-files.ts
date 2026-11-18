// File-system and process adapters of the canonical pipeline: canon.json beside a session's sentences, the
// lexicon file (zod stays at this boundary), and the TLC runner (java -cp tla2tools.jar tlc2.TLC).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { CanonLexiconSource, CanonState, CanonStore, TlcRunner } from '../../application/canon.js';
import type { CanonLexicon } from '../../domain/canon-ast.js';
import { tlaTextFiles } from '../tla/text-files.js';
import { specSessionDir } from '../spec-store/data-dir.js';

/** The TLA+ text files, with a path join for the export directory. */
export const canonTextFiles = { ...tlaTextFiles, join: (dir: string, file: string): string => join(dir, file) };

const words = z.array(z.string().trim().min(1)).default([]);

const LexiconSchema = z.strictObject({
  actors: words,
  terms: words,
  states: words,
  verbs: words,
  instances: z.record(z.string().min(1), z.number().int().min(1).max(8)).optional(),
  fixed: z.array(z.string().trim().min(1)).optional(),
});

const HistorySchema = z.strictObject({
  at: z.string(),
  who: z.string(),
  reason: z.string(),
  action: z.enum(['lexicon', 'accept', 'merge']),
  sentence: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  notes: z.array(z.string()).optional(),
  dropped: z.array(z.string()).optional(),
  descriptive: z.string().optional(),
  merged: z.array(z.string()).optional(),
});

const StateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  lexicon: LexiconSchema,
  history: z.array(HistorySchema),
});

function issueText(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

function toLexicon(data: z.infer<typeof LexiconSchema>): CanonLexicon {
  const lexicon: CanonLexicon = { actors: data.actors, terms: data.terms, states: data.states, verbs: data.verbs };
  if (data.instances !== undefined) lexicon.instances = data.instances;
  if (data.fixed !== undefined) lexicon.fixed = data.fixed;
  return lexicon;
}

export const canonLexiconFile: CanonLexiconSource = {
  load(file) {
    if (file === '-') return { ok: false, message: 'Clew does not read stdin; pass a lexicon .json file' };
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      return { ok: false, message: `${file}: ${error instanceof Error ? error.message : String(error)}` };
    }
    const parsed = LexiconSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, message: `${file}: ${issueText(parsed.error)}` };
    return { ok: true, lexicon: toLexicon(parsed.data) };
  },
};

/** Read one canon.json: the live one beside a session's sentences, or a copy a milestone froze. Absent is not an error. */
export function readCanonState(file: string): { ok: true; state: CanonState | undefined } | { ok: false; message: string } {
  if (!existsSync(file)) return { ok: true, state: undefined };
  try {
    const parsed = StateSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) return { ok: false, message: `${file}: ${issueText(parsed.error)}` };
    const state: CanonState = { schemaVersion: 1, lexicon: toLexicon(parsed.data.lexicon), history: [] };
    for (const entry of parsed.data.history) {
      const copy: CanonState['history'][number] = { at: entry.at, who: entry.who, reason: entry.reason, action: entry.action };
      if (entry.sentence !== undefined) copy.sentence = entry.sentence;
      if (entry.from !== undefined) copy.from = entry.from;
      if (entry.to !== undefined) copy.to = entry.to;
      if (entry.notes !== undefined) copy.notes = entry.notes;
      if (entry.dropped !== undefined) copy.dropped = entry.dropped;
      if (entry.descriptive !== undefined) copy.descriptive = entry.descriptive;
      if (entry.merged !== undefined) copy.merged = entry.merged;
      state.history.push(copy);
    }
    return { ok: true, state };
  } catch (error) {
    return { ok: false, message: `${file}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function canonFileStore(env: NodeJS.ProcessEnv = process.env): CanonStore {
  const fileOf = (session: string): string => join(specSessionDir(session, env), 'canon.json');
  return {
    read(session) {
      return readCanonState(fileOf(session));
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

/** TLC through java. The jar comes from --jar or TLA2TOOLS_JAR; Clew never downloads it. */
export function javaTlcRunner(env: NodeJS.ProcessEnv = process.env): TlcRunner {
  return {
    run(request) {
      const jar = request.jar ?? env.TLA2TOOLS_JAR;
      if (jar === undefined || jar === '') return { ok: false, message: 'no tla2tools.jar: pass --jar <path> or set TLA2TOOLS_JAR' };
      if (!existsSync(jar)) return { ok: false, message: `${jar}: no such file` };
      if (!existsSync(request.file)) return { ok: false, message: `${request.file}: no such file` };
      const java = env.JAVA === undefined || env.JAVA === '' ? 'java' : env.JAVA;
      // TLC runs in the module's directory so it finds the modules beside it; the config path is made absolute.
      const args = ['-XX:+UseParallelGC', '-cp', resolve(jar), 'tlc2.TLC', '-workers', String(request.workers), '-metadir', join(tmpdir(), `clew-tlc-${process.pid}-${Date.now()}`)];
      if (request.config !== undefined) args.push('-config', resolve(request.config));
      if (request.coverage) args.push('-coverage', '1');
      if (request.dump !== undefined) args.push('-dump', 'dot,actionlabels', resolve(request.dump));
      args.push(basename(request.file));
      const result = spawnSync(java, args, {
        cwd: dirname(resolve(request.file)),
        encoding: 'utf8',
        timeout: request.timeoutSeconds * 1000,
        maxBuffer: 64 * 1024 * 1024,
        killSignal: 'SIGKILL',
      });
      if (result.error !== undefined && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: false, message: `${java}: not found; TLC needs a Java runtime` };
      }
      const timedOut = result.error !== undefined && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
      return {
        ok: true,
        run: {
          exitCode: result.status,
          timedOut,
          output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
          command: `${java} ${args.join(' ')}`,
        },
      };
    },
  };
}
