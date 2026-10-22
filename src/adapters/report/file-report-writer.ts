// JSON and Markdown reports on the file system. Written only when a command is given --out.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { ReportWriter } from '../../application/ports.js';
import type { CompareDocument, VerifyDocument } from '../../application/documents.js';
import { modelDocument, type Model } from '../../domain/model.js';

function reportMarkdown(document: VerifyDocument, model: Model): string {
  const summary = document.summary;
  const flows = document.flows ?? [];
  const lines = [
    `# Verification report: ${document.candidate ?? document.chartId ?? model.id}`,
    '',
    `Chart: \`${document.chartId ?? model.id}\`  `,
    `Workflow set: \`${document.workflowSetId ?? ''}\`  `,
    `Result: **${summary?.passed ?? 0}/${summary?.total ?? flows.length} workflows pass**.`,
    '',
    `- Final states: ${model.states().filter((state) => state.final).map((state) => state.label).join(', ') || 'none'}`,
    `- Transitions not exercised by the selected workflows: ${(document.unusedTransitions ?? []).join('; ') || 'none'}`,
    ...(document.views?.heatmap !== undefined ? [`- Heatmap: \`${document.views.heatmap}\``] : []),
    ...(document.views?.replays !== undefined && document.views.replays.length > 0
      ? [`- Replay: ${document.views.replays.map((replay) => `\`${replay.file}\` (${replay.frames} frames)`).join(', ')}`]
      : []),
    '',
    '| Workflow | Expect | Result | Path / reason |',
    '|---|---|---|---|',
  ];
  for (const flow of flows) {
    const path = [flow.trace[0]?.chart.from, ...flow.trace.map((step) => (step.accepted ? `${step.chart.event}→${step.chart.to}` : `${step.chart.event}✗`))].join(' ');
    lines.push(`| ${flow.id} ${flow.title} | ${flow.expect} | ${flow.pass ? 'PASS' : '**FAIL**'} | \`${path}\`<br>${flow.reason} |`);
  }
  return lines.join('\n') + '\n';
}

function comparisonMarkdown(document: CompareDocument): string {
  const lines = ['# Candidate comparison', '', '| Candidate | Chart | Passed | Failed workflows |', '|---|---|---|---|'];
  for (const run of document.candidates ?? []) {
    const failed = run.failures.map((failure) => failure.id).join(', ') || 'none';
    lines.push(`| ${run.name} | ${run.chartId} | ${run.passed}/${run.total} | ${failed} |`);
  }
  lines.push('', document.winner ? `**Winner: ${document.winner}** (passes every selected flow).` : '**No candidate passes every selected flow.**');
  return lines.join('\n') + '\n';
}

export const fileReportWriter: ReportWriter = {
  writeVerification(document, model, outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/report.json`, JSON.stringify(document, null, 2));
    writeFileSync(`${outDir}/model.json`, JSON.stringify(modelDocument(model), null, 2));
    writeFileSync(`${outDir}/report.md`, reportMarkdown(document, model));
  },
  writeComparison(document, outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/comparison.json`, JSON.stringify(document, null, 2));
    writeFileSync(`${outDir}/comparison.md`, comparisonMarkdown(document));
  },
};
