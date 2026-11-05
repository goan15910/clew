// History lines and findings for refinements that a rebuild dropped.
import type { RefinementDrop } from '../domain/spec-refine.js';
import type { Finding, SpecCommandName, SpecHistoryEntry } from '../domain/spec.js';

export function dropFindings(drops: readonly RefinementDrop[]): Finding[] {
  const findings: Finding[] = [];
  for (const drop of drops) findings.push(drop.finding);
  return findings;
}

/** One line per drop, so a refinement whose frame or span is gone stays traceable. */
export function dropHistory(command: SpecCommandName, session: string, at: string, drops: readonly RefinementDrop[]): SpecHistoryEntry[] {
  const entries: SpecHistoryEntry[] = [];
  for (const drop of drops) {
    entries.push({
      at,
      command,
      args: { session, id: drop.target, role: drop.role, reason: drop.reason, finding: drop.finding.id, text: drop.value },
      before: [drop.target],
      after: drop.vanished ? [] : [drop.target],
    });
  }
  return entries;
}
