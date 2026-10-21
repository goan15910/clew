// JSON and Markdown reports on the file system.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { ComparisonRun, ReportWriter } from '../../application/ports.js';
import type { InvalidModelReport, VerificationReport } from '../../application/report-document.js';
import type { Comparison } from '../../domain/comparison.js';
import type { Model } from '../../domain/model.js';
import type { Structure, WorkflowResult } from '../../domain/verification.js';

function reportMarkdown(name: string, modelFile: string, model: Model, structure: Structure, unused: readonly string[], results: readonly WorkflowResult[], passed: number): string {
  const lines = [
    `# Verification report: ${name}`,
    '',
    `Model: \`${modelFile}\`  `,
    `Schema: valid. Result: **${passed}/${results.length} workflows pass**.`,
    '',
    `- Reachable states: ${structure.reachable.length}/${model.states().length}` + (structure.unreachable.length ? ` (unreachable: ${structure.unreachable.join(', ')})` : ''),
    `- Dead ends (non-final, no way out): ${structure.deadEnds.length ? structure.deadEnds.join(', ') : 'none'}`,
    `- Final states: ${model.states().filter((state) => state.final).map((state) => state.label).join(', ') || 'none'}`,
    `- Transitions not exercised by any workflow: ${unused.length ? unused.join('; ') : 'none'}`,
    '',
    '| Workflow | Expect | Result | Path / reason |',
    '|---|---|---|---|',
  ];
  for (const result of results) {
    const path = [result.trace[0]?.from, ...result.trace.map((step) => (step.accepted ? `${step.event}→${step.to}` : `${step.event}✗`))].join(' ');
    lines.push(`| ${result.id} ${result.title} | ${result.expect} | ${result.pass ? 'PASS' : '**FAIL**'} | \`${path}\`<br>${result.reason} |`);
  }
  return lines.join('\n') + '\n';
}

function comparisonMarkdown(comparison: Comparison, runs: readonly ComparisonRun[]): string {
  const lines = ['# Candidate comparison', '', '| Candidate | Passed | Failed workflows |', '|---|---|---|'];
  for (const run of runs) {
    const failed = !run.schemaValid ? 'invalid model' : (run.failures.map((failure) => failure.id).join(', ') || 'none');
    lines.push(`| ${run.name} | ${run.passed}/${run.total} | ${failed} |`);
  }
  lines.push('', comparison.winner ? `**Winner: ${comparison.winner}** (passes every workflow).` : '**No candidate passes every workflow.**');
  return lines.join('\n') + '\n';
}

export const fileReportWriter: ReportWriter = {
  writeVerification(report: VerificationReport, model: Model, outDir: string) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
    writeFileSync(`${outDir}/model.json`, JSON.stringify(report.model, null, 2));
    writeFileSync(`${outDir}/report.md`, reportMarkdown(report.candidate, report.modelFile, model, report.structure, report.unusedTransitions, report.workflows, report.summary.passed));
  },
  writeInvalidModel(report: InvalidModelReport, outDir: string) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  },
  writeComparison(comparison: Comparison, runs: readonly ComparisonRun[], outDir: string) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/comparison.md`, comparisonMarkdown(comparison, runs));
    writeFileSync(`${outDir}/comparison.json`, JSON.stringify(comparison, null, 2));
  },
};
