// Spec YAML. The domain draft is rendered here for `spec emit --chart`.
import { existsSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SpecWriter } from '../../application/ports.js';
import type { SpecDraft } from '../../domain/spec-model.js';
import { scalarFromValue, type Patch, type Predicate, type Value } from '../../domain/valuation.js';

function quote(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

function renderScalar(value: boolean | number | string | null): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return quote(value);
}

function renderValue(value: Value): string {
  return renderScalar(scalarFromValue(value));
}

function renderPatch(patch: Patch): string {
  const parts: string[] = [];
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) continue;
    parts.push(`${key}: ${renderValue(value)}`);
  }
  return `{ ${parts.join(', ')} }`;
}

function renderPredicate(predicate: Predicate): string {
  if (predicate.op === 'true') return '{ op: true }';
  if (predicate.op === 'eq' || predicate.op === 'neq') {
    return `{ op: ${predicate.op}, var: ${predicate.var}, value: ${renderValue(predicate.value)} }`;
  }
  if (predicate.op === 'not') return `{ op: not, of: ${renderPredicate(predicate.of)} }`;
  const of: string[] = [];
  for (const child of predicate.of) of.push(renderPredicate(child));
  return `{ op: ${predicate.op}, of: [${of.join(', ')}] }`;
}

export function renderSpecYaml(draft: SpecDraft): string {
  const lines: string[] = [
    'kind: clew.spec.v1',
    `id: ${draft.id}`,
    'vars:',
  ];
  for (const decl of draft.vars) {
    lines.push(`  - { id: ${decl.id}, type: ${decl.type} }`);
  }
  lines.push(`initial: ${renderPatch(draft.initial)}`);
  lines.push('actions:');
  if (draft.actions.length === 0) lines.push('  []');
  for (const action of draft.actions) {
    lines.push(`  - event: ${action.event}`);
    lines.push(`    actor: ${quote(action.actor)}`);
    lines.push(`    when: ${renderPredicate(action.when)}`);
    lines.push(`    assign: ${renderPatch(action.assign)}`);
  }
  if (draft.labels.length > 0) {
    lines.push('labels:');
    for (const label of draft.labels) {
      const final = label.final === true ? ', final: true' : '';
      const id = label.id === undefined ? '' : `id: ${label.id}, `;
      lines.push(`  - { ${id}match: ${renderPatch(label.match)}, text: ${quote(label.text)}${final} }`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export const yamlSpecWriter: SpecWriter = {
  render: renderSpecYaml,
  write(file, yaml) {
    if (file.trim() === '' || file === '-') return { ok: false, message: 'emit writes a file; Clew never writes the chart to stdout' };
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
