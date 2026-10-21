// Render DOT and Mermaid, then draw the charts with Graphviz (`dot`, `gvpack`, `neato`).
import { execFileSync } from 'node:child_process';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import type { DiagramRenderer } from '../../application/ports.js';
import type { Model } from '../../domain/model.js';
import type { WorkflowResult } from '../../domain/verification.js';
import { chainMermaid, chartMermaid, chainsDot, chartDot, proofColumnDots } from './diagrams.js';

function requireGraphviz(bin: string): void {
  try {
    execFileSync(bin, ['-V'], { stdio: 'ignore' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Graphviz \`${bin}\` is not runnable (${detail}). Install Graphviz, or omit --out.`);
  }
}

function renderDot(dot: string, base: string) {
  writeFileSync(`${base}.dot`, dot);
  execFileSync('dot', ['-Tsvg', `${base}.dot`, '-o', `${base}.svg`]);
  execFileSync('dot', ['-Tpng', '-Gdpi=150', `${base}.dot`, '-o', `${base}.png`]);
}

function renderStacked(model: Model, title: string, results: readonly WorkflowResult[], base: string) {
  const laid: string[] = [];
  for (const dot of proofColumnDots(model, title, results)) {
    laid.push(execFileSync('dot', [], { input: dot, encoding: 'utf8' }));
  }
  const tmp = `${base}.parts.gv`;
  writeFileSync(tmp, laid.join('\n'));
  try {
    const packed = execFileSync('gvpack', ['-array_il1', '-m12', tmp], { encoding: 'utf8' });
    writeFileSync(`${base}.dot`, packed);
    execFileSync('neato', ['-n2', '-Tsvg', `${base}.dot`, '-o', `${base}.svg`]);
    execFileSync('neato', ['-n2', '-Tpng', '-Gdpi=130', `${base}.dot`, '-o', `${base}.png`]);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // The parts file is only an intermediate. A missing file is not a second failure.
    }
  }
}

function writeCharts(model: Model, name: string, results: readonly WorkflowResult[], passed: number, outDir: string, highlight: string | undefined) {
  mkdirSync(`${outDir}/chains`, { recursive: true });
  renderDot(chartDot(model, `State chart: candidate ${name}`), `${outDir}/state-chart`);
  writeFileSync(`${outDir}/state-chart.mmd`, chartMermaid(model));
  renderStacked(model, `Workflow proofs: candidate ${name} (${passed}/${results.length} pass)`, results, `${outDir}/workflow-chains`);
  for (const result of results) {
    renderDot(chainsDot(model, `${result.id}: ${result.title}`, [result]), `${outDir}/chains/${result.id}`);
    writeFileSync(`${outDir}/chains/${result.id}.mmd`, chainMermaid(model, result));
  }
  const highlighted = results.find((result) => result.id === highlight);
  if (highlighted) {
    renderDot(chartDot(model, `Overview: ${name}, path of ${highlighted.id} "${highlighted.title}" highlighted`, highlighted), `${outDir}/overview-${highlighted.id}`);
  }
}

export const graphvizDiagramRenderer: DiagramRenderer = {
  render(model, name, results, passed, outDir, highlight) {
    requireGraphviz('dot');
    requireGraphviz('gvpack');
    requireGraphviz('neato');
    writeCharts(model, name, results, passed, outDir, highlight);
  },
};
