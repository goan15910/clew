// Zod and domain issue paths, printed the same way for every YAML file and for CLI options.
import type { Issue } from '../../domain/issue.js';
import type { LocatedError } from '../../application/documents.js';

export function locatedErrors(issues: readonly { path: PropertyKey[]; message: string }[]): LocatedError[] {
  const lines: LocatedError[] = [];
  for (const issue of issues) {
    const path: string[] = [];
    for (const part of issue.path) {
      if (typeof part === 'string' || typeof part === 'number') path.push(String(part));
    }
    lines.push({ path: path.join('.'), message: issue.message });
  }
  return lines;
}

export function locatedFromIssues(issues: readonly Issue[]): LocatedError[] {
  const lines: LocatedError[] = [];
  for (const issue of issues) lines.push({ path: issue.path.map(String).join('.'), message: issue.message });
  return lines;
}
