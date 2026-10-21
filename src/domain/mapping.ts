// Chart vocabulary and workflow vocabulary meet here. Neither document stores the other's names.
import type { Issue } from './issue.js';
import type { ChainStep } from './workflow.js';

export interface MappingEntry {
  chart: string;
  workflow: string;
}

export interface Mapping {
  chart: string;
  workflowSet: string;
  states: readonly MappingEntry[];
  events: readonly MappingEntry[];
}

/** One linked-list edge after both vocabularies have been resolved. */
export interface MappedStep {
  n: number;
  text: string;
  workflowFrom: string;
  workflowEvent: string;
  workflowTo: string;
  chartFrom: string;
  chartEvent: string;
  chartTo: string;
}

/** Build a mapping that already satisfied {@link mappingIssues}. */
export function assembleMapping(mapping: Mapping): Mapping {
  const issues = mappingIssues(mapping);
  if (issues.length > 0) {
    throw new Error(`mapping failed invariants after parsing: ${issues.map((issue) => issue.message).join('; ')}`);
  }
  const states: MappingEntry[] = [];
  for (const entry of mapping.states) states.push({ chart: entry.chart, workflow: entry.workflow });
  const events: MappingEntry[] = [];
  for (const entry of mapping.events) events.push({ chart: entry.chart, workflow: entry.workflow });
  return { chart: mapping.chart, workflowSet: mapping.workflowSet, states, events };
}

export function mappingIssues(mapping: Mapping): Issue[] {
  const issues: Issue[] = [];
  const states = new Set<string>();
  for (let index = 0; index < mapping.states.length; index += 1) {
    const entry = mapping.states[index]!;
    if (states.has(entry.workflow)) {
      issues.push({
        path: ['states', index, 'workflow'],
        message: `duplicate workflow state "${entry.workflow}"`,
      });
    }
    states.add(entry.workflow);
  }
  const events = new Set<string>();
  for (let index = 0; index < mapping.events.length; index += 1) {
    const entry = mapping.events[index]!;
    if (events.has(entry.workflow)) {
      issues.push({
        path: ['events', index, 'workflow'],
        message: `duplicate workflow event "${entry.workflow}"`,
      });
    }
    events.add(entry.workflow);
  }
  return issues;
}

function remember(gaps: string[], seen: Set<string>, gap: string): void {
  if (seen.has(gap)) return;
  seen.add(gap);
  gaps.push(gap);
}

/**
 * Translate one chain into chart states and events.
 * Rows the chain does not use are ignored, so a partial mapping can still prove one flow.
 * A mapped chart state must exist. A mapped event is replayed even when the chart
 * never declares it, so a poorer candidate fails that flow instead of the mapping.
 * Many workflow names may share one chart name. The workflow side is a function.
 */
export function mapChain(
  mapping: Mapping,
  chain: readonly ChainStep[],
  chartStates: ReadonlySet<string>,
): { ok: true; steps: MappedStep[] } | { ok: false; gaps: string[] } {
  const states = new Map<string, string>();
  for (const entry of mapping.states) states.set(entry.workflow, entry.chart);
  const events = new Map<string, string>();
  for (const entry of mapping.events) events.set(entry.workflow, entry.chart);

  const gaps: string[] = [];
  const seen = new Set<string>();
  const steps: MappedStep[] = [];
  for (const step of chain) {
    const chartFrom = states.get(step.stateFrom);
    const chartEvent = events.get(step.event);
    const chartTo = states.get(step.stateTo);
    let missing = false;
    if (chartFrom === undefined) {
      remember(gaps, seen, `workflow state "${step.stateFrom}" has no chart state`);
      missing = true;
    } else if (!chartStates.has(chartFrom)) {
      remember(gaps, seen, `mapped chart state "${chartFrom}" is not on the chart`);
      missing = true;
    }
    if (chartEvent === undefined) {
      remember(gaps, seen, `workflow event "${step.event}" has no chart event`);
      missing = true;
    }
    if (chartTo === undefined) {
      remember(gaps, seen, `workflow state "${step.stateTo}" has no chart state`);
      missing = true;
    } else if (!chartStates.has(chartTo)) {
      remember(gaps, seen, `mapped chart state "${chartTo}" is not on the chart`);
      missing = true;
    }
    if (missing || chartFrom === undefined || chartEvent === undefined || chartTo === undefined) continue;
    steps.push({
      n: step.n,
      text: step.text,
      workflowFrom: step.stateFrom,
      workflowEvent: step.event,
      workflowTo: step.stateTo,
      chartFrom,
      chartEvent,
      chartTo,
    });
  }
  if (gaps.length > 0) return { ok: false, gaps };
  return { ok: true, steps };
}
