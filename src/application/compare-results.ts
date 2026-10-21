// Use case: rank verify documents. It does not load charts or replay flows.
import { rankCandidates, type RankedCandidate } from '../domain/comparison.js';
import { tagIssues, type CompareDocument, type Outcome, type OutputIssue } from './documents.js';
import type { ComparePorts } from './ports.js';

export interface CompareResultsCommand {
  resultFiles: readonly string[];
  outDir?: string;
}

export function compareResults(command: CompareResultsCommand, ports: ComparePorts): Outcome<CompareDocument> {
  const issues: OutputIssue[] = [];
  const runs: RankedCandidate[] = [];
  const names = new Set<string>();
  for (const file of command.resultFiles) {
    const loaded = ports.results.load(file);
    if (!loaded.ok) {
      issues.push(...tagIssues(file, 'input', loaded.errors));
      continue;
    }
    const name = loaded.result.name;
    if (names.has(name)) {
      issues.push({ kind: 'input', file, path: 'candidate', message: `duplicate candidate name "${name}"` });
      continue;
    }
    names.add(name);
    runs.push(loaded.result);
  }
  if (issues.length > 0 || runs.length === 0) {
    return {
      exit: 'invalid',
      document: { command: 'compare', ok: false, winner: null, fault: 'invalid-result', issues },
    };
  }
  const comparison = rankCandidates(runs);
  const document: CompareDocument = {
    command: 'compare',
    ok: comparison.winner !== null,
    winner: comparison.winner,
    candidates: comparison.candidates,
    issues: [],
  };
  if (command.outDir !== undefined) ports.reports.writeComparison(document, command.outDir);
  return { exit: comparison.winner !== null ? 'pass' : 'fail', document };
}
