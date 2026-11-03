// Workflow-set YAML. The domain draft is rendered here.
import { existsSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WorkflowSetWriter } from '../../application/ports.js';
import { jsonScalar } from '../../domain/spec-model.js';
import type { Patch } from '../../domain/valuation.js';
import type { WorkflowSetDraft } from '../../domain/workflow.js';

function quote(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

function renderScalar(value: boolean | number | string | null): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return quote(value);
}

function renderAssign(assign: Patch): string {
  const parts: string[] = [];
  for (const key of Object.keys(assign)) {
    const value = assign[key];
    if (value === undefined) continue;
    parts.push(`${key}: ${renderScalar(jsonScalar(value))}`);
  }
  return `{ ${parts.join(', ')} }`;
}

export function renderWorkflowYaml(draft: WorkflowSetDraft): string {
  const lines: string[] = [`id: ${draft.id}`, 'workflows:'];
  for (const workflow of draft.workflows) {
    lines.push(`  - id: ${workflow.id}`);
    lines.push(`    title: ${quote(workflow.title)}`);
    lines.push(`    expect: ${workflow.expect}`);
    if (workflow.rejectAt !== undefined) lines.push(`    rejectAt: ${workflow.rejectAt}`);
    lines.push(`    start: ${workflow.start}`);
    lines.push('    nodes:');
    for (const node of workflow.nodes) {
      lines.push(`      - { id: ${quote(node.id)}, assign: ${renderAssign(node.assign)} }`);
    }
    lines.push('    edges:');
    for (const edge of workflow.edges) {
      lines.push(`      - { from: ${quote(edge.from)}, event: ${quote(edge.event)}, to: ${quote(edge.to)}, text: ${quote(edge.text)} }`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export const yamlWorkflowWriter: WorkflowSetWriter = {
  render: renderWorkflowYaml,
  write(file, yaml) {
    if (file.trim() === '' || file === '-') return { ok: false, message: 'emit writes a file; Clew never writes the workflow set to stdout' };
    const directory = dirname(file);
    if (directory !== '' && !existsSync(directory)) return { ok: false, message: `cannot write ${file}: directory does not exist` };
    try {
      writeFileSync(file, yaml);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `cannot write ${file}: ${message}` };
    }
  },
};
