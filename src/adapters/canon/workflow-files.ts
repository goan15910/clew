// workflows.json beside a session's sentences and canon.json. Zod stays at this boundary.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { WorkflowState, WorkflowStore } from '../../application/canon-workflows.js';
import { CANON_WORKFLOW_ID_PATTERN, CANON_WORKFLOW_SENTENCE_ID_PATTERN } from '../../domain/canon-workflow.js';
import { specSessionDir } from '../spec-store/data-dir.js';

export const WORKFLOWS_FILE = 'workflows.json';

const TextSchema = z.strictObject({
  text: z.string(),
  span: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  hash: z.string(),
  section: z.string(),
});

const note = {
  at: z.string(),
  who: z.string(),
  reason: z.string(),
  finding: z.string().optional(),
  comment: z.string().optional(),
};

const SentenceSchema = z.strictObject({
  id: z.string().regex(CANON_WORKFLOW_SENTENCE_ID_PATTERN, 'workflow sentence ids look like w1.s1'),
  original: TextSchema.nullable(),
  latest: TextSchema.nullable(),
  history: z.array(z.strictObject({ ...note, value: TextSchema.nullable() })),
});

const Expect = z.enum(['possible', 'refused']);
const Mode = z.enum(['loose', 'exact']);

const WorkflowSchema = z.strictObject({
  id: z.string().regex(CANON_WORKFLOW_ID_PATTERN, 'workflow ids look like w1'),
  title: z.string(),
  expect: Expect,
  mode: Mode,
  source: z.strictObject({ path: z.string(), hash: z.string() }).optional(),
  deleted: z.literal(true).optional(),
  sentences: z.array(SentenceSchema),
  history: z.array(z.strictObject({ ...note, value: z.strictObject({ title: z.string(), expect: Expect, mode: Mode, deleted: z.boolean() }) })),
});

const StateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workflows: z.array(WorkflowSchema),
});

function issueText(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

/** Drop the keys zod reads as present-but-undefined, so the state matches exactOptionalPropertyTypes. */
function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Reads a workflows.json file. Exported so a milestone or a diff can read a frozen copy. */
export function readWorkflowState(file: string): { ok: true; state: WorkflowState | undefined } | { ok: false; message: string } {
  if (!existsSync(file)) return { ok: true, state: undefined };
  try {
    const parsed = StateSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) return { ok: false, message: `${file}: ${issueText(parsed.error)}` };
    return { ok: true, state: clean(parsed.data) as WorkflowState };
  } catch (error) {
    return { ok: false, message: `${file}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function workflowFileStore(env: NodeJS.ProcessEnv = process.env): WorkflowStore {
  const fileOf = (session: string): string => join(specSessionDir(session, env), WORKFLOWS_FILE);
  return {
    read(session) {
      return readWorkflowState(fileOf(session));
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
