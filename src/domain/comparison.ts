// Which candidate, if any, passes every workflow.

export interface RankedCandidate {
  name: string;
  schemaValid: boolean;
  passed: number;
  total: number;
}

export interface Comparison {
  winner: string | null;
  candidates: { name: string; passed: number; total: number; schemaValid: boolean }[];
}

/** Higher pass counts first. A tie keeps the original order. A winner must pass every workflow, and no candidate may be invalid. */
export function rankCandidates<T extends RankedCandidate>(runs: readonly T[]): { comparison: Comparison; ranked: T[] } {
  const ranked = [...runs].sort((left, right) => right.passed - left.passed);
  const anyInvalid = ranked.some((run) => !run.schemaValid);
  const top = ranked[0];
  const winner = !anyInvalid && top !== undefined && top.passed === top.total && top.total > 0 ? top.name : null;
  const candidates: Comparison['candidates'] = [];
  for (const run of ranked) {
    candidates.push({ name: run.name, passed: run.passed, total: run.total, schemaValid: run.schemaValid });
  }
  return { comparison: { winner, candidates }, ranked };
}
