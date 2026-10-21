// Mapping files. Zod accepts the file shape here; duplicate workflow names are a domain invariant.
import { z } from 'zod';
import type { FileLoad } from '../../application/ports.js';
import { assembleMapping, mappingIssues, type Mapping } from '../../domain/mapping.js';
import {
  EVENT_MESSAGE,
  EVENT_PATTERN,
  NAME_MESSAGE,
  NAME_PATTERN,
} from '../../domain/model.js';
import {
  WORKFLOW_ID_MESSAGE,
  WORKFLOW_ID_PATTERN,
  WORKFLOW_WORD_MESSAGE,
  WORKFLOW_WORD_PATTERN,
} from '../../domain/workflow.js';
import { locatedErrors, locatedFromIssues } from './issue-lines.js';
import { readYaml } from './read-yaml.js';

const ChartName = z.string().regex(NAME_PATTERN, NAME_MESSAGE);
const ChartEvent = z.string().regex(EVENT_PATTERN, EVENT_MESSAGE);
const WorkflowName = z.string().regex(WORKFLOW_WORD_PATTERN, WORKFLOW_WORD_MESSAGE);
const SetId = z.string().regex(WORKFLOW_ID_PATTERN, WORKFLOW_ID_MESSAGE);

const MappingFileSchema = z.strictObject({
  chart: ChartName,
  workflowSet: SetId,
  states: z.array(z.strictObject({
    chart: ChartName,
    workflow: WorkflowName,
  })).min(1),
  events: z.array(z.strictObject({
    chart: ChartEvent,
    workflow: WorkflowName,
  })).min(1),
});

function toMapping(file: z.infer<typeof MappingFileSchema>): Mapping {
  const states: { chart: string; workflow: string }[] = [];
  for (const entry of file.states) states.push({ chart: entry.chart, workflow: entry.workflow });
  const events: { chart: string; workflow: string }[] = [];
  for (const entry of file.events) events.push({ chart: entry.chart, workflow: entry.workflow });
  return { chart: file.chart, workflowSet: file.workflowSet, states, events };
}

export function loadMapping(input: unknown): FileLoad<Mapping> {
  const parsed = MappingFileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fault: 'schema', errors: locatedErrors(parsed.error.issues) };
  const mapping = toMapping(parsed.data);
  const issues = mappingIssues(mapping);
  if (issues.length > 0) return { ok: false, fault: 'graph', errors: locatedFromIssues(issues) };
  return { ok: true, value: assembleMapping(mapping) };
}

export const yamlMappingLoader: { load(file: string): FileLoad<Mapping> } = {
  load(file) {
    const read = readYaml(file);
    if (!read.ok) return { ok: false, fault: 'unreadable', errors: [{ path: '', message: read.error }] };
    return loadMapping(read.value);
  },
};
