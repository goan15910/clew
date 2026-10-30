// Render DOT and Mermaid, then draw the charts with Graphviz (`dot`, `gvpack`, `neato`).
// The coverage heatmap is SVG. Replay frames are positioned DOT, drawn by `neato`, and packed into a GIF.
import { execFileSync } from 'node:child_process';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import type { DiagramRenderer, GraphImageRenderer, ReplayFile } from '../../application/ports.js';
import type { Model } from '../../domain/model.js';
import type { TransitionCoverage, WorkflowResult } from '../../domain/verification.js';
import { chainMermaid, chartMermaid, chainsDot, chartDot, proofColumnDots } from './diagrams.js';
import { decodePng, encodeAnimatedGif } from './gif.js';
import { coverageHeatmapSvg } from './heatmap.js';
import { replayFrameDot } from './replay-frames.js';

function graphvizMessage(bin: string, error: unknown, hint: string): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Graphviz \`${bin}\` is not runnable (${detail}). ${hint}`;
}

function requireGraphviz(bin: string, args: readonly string[]): void {
  try {
    execFileSync(bin, [...args], { stdio: 'ignore' });
  } catch (error) {
    throw new Error(graphvizMessage(bin, error, 'Install Graphviz 16.1.0, or omit --out.'));
  }
}

function dotSvg(source: string): string {
  try {
    return execFileSync('dot', ['-Tsvg'], { input: source, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    const missing = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
    if (missing) throw new Error(graphvizMessage('dot', error, 'Install Graphviz 16.1.0.'));
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Graphviz \`dot\` failed (${detail}).`);
  }
}

export const graphvizGraphImages: GraphImageRenderer = {
  chartSvg(model, title) {
    return dotSvg(chartDot(model, title));
  },
  chainSvg(model, title, result) {
    return dotSvg(chainsDot(model, title, [result], '', 'expect'));
  },
};

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

const HEATMAP_FILE = 'coverage-heatmap.svg';

function writeHeatmap(model: Model, candidate: string, workflowCount: number, coverage: readonly TransitionCoverage[], outDir: string): string {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/${HEATMAP_FILE}`, coverageHeatmapSvg(model, candidate, workflowCount, coverage));
  return HEATMAP_FILE;
}

function writeReplays(model: Model, results: readonly WorkflowResult[], outDir: string): ReplayFile[] {
  requireGraphviz('neato', ['-V']);
  mkdirSync(`${outDir}/replays`, { recursive: true });
  const written: ReplayFile[] = [];
  for (const result of results) {
    const frameCount = result.trace.length + 1;
    const pngs: Buffer[] = [];
    for (let frame = 0; frame < frameCount; frame += 1) {
      const dot = replayFrameDot(model, result, frame);
      pngs.push(execFileSync('neato', ['-n', '-Tpng', '-Gdpi=120'], { input: dot, maxBuffer: 8 * 1024 * 1024 }));
    }
    const gif = encodeAnimatedGif(pngs.map((png) => decodePng(png)), { delayCs: 90, lastDelayCs: 200 });
    const file = `replays/${result.id}.gif`;
    writeFileSync(`${outDir}/${file}`, gif);
    written.push({ id: result.id, file, frames: frameCount });
  }
  return written;
}

export const graphvizDiagramRenderer: DiagramRenderer = {
  render(model, name, results, passed, outDir, highlight) {
    requireGraphviz('dot', ['-V']);
    requireGraphviz('neato', ['-V']);
    // Graphviz 14 rejects `gvpack -V`, and Graphviz 16 dropped it. `-?` exits 0 on 2.42, 14, and 16.
    requireGraphviz('gvpack', ['-?']);
    writeCharts(model, name, results, passed, outDir, highlight);
  },
  writeHeatmap,
  writeReplays,
};
