// Rank verification documents. A winner passes every selected flow. Ties keep argument order.

export interface RankedCandidate {
  name: string;
  chartId: string;
  ok: boolean;
  passed: number;
  total: number;
  failures: readonly { id: string; reason: string }[];
}

export interface Comparison {
  winner: string | null;
  candidates: {
    name: string;
    chartId: string;
    ok: boolean;
    passed: number;
    total: number;
    failures: { id: string; reason: string }[];
  }[];
}

/** Higher pass counts first. A tie keeps the original order. The first candidate that passed every flow wins. */
export function rankCandidates(runs: readonly RankedCandidate[]): Comparison {
  const ranked = [...runs].sort((left, right) => right.passed - left.passed);
  const top = ranked[0];
  const winner = top !== undefined && top.ok && top.passed === top.total && top.total > 0 ? top.name : null;
  const candidates: Comparison['candidates'] = [];
  for (const run of ranked) {
    const failures: { id: string; reason: string }[] = [];
    for (const failure of run.failures) failures.push({ id: failure.id, reason: failure.reason });
    candidates.push({
      name: run.name,
      chartId: run.chartId,
      ok: run.ok,
      passed: run.passed,
      total: run.total,
      failures,
    });
  }
  return { winner, candidates };
}
