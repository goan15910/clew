#!/usr/bin/env -S npx tsx
// clew verify  <model.yaml> <workflows.yaml> [--out dir] [--highlight W2] [--json]
// clew compare <workflows.yaml> <model.yaml>... [--out dir] [--highlight W2] [--json]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Command, CommanderError } from '@commander-js/extra-typings';
import { parse } from 'yaml';
import { z } from 'zod';
import { loadModel, type Model, type State, type Transition } from './model.js';
import { chainMermaid, chainsDot, chartDot, chartMermaid, proofColumnDots } from './render.js';
import { structuralChecks, verifyWorkflow, type Structure, type WorkflowResult } from './verify.js';
import { parseWorkflows, type Workflow } from './workflows.js';

const EXIT_PASS = 0;
const EXIT_FAILED = 1;
const EXIT_INVALID = 2;

const CommandOptionsSchema = z.strictObject({
  out: z.string().min(1, 'output directory must not be empty'),
  highlight: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a workflow id').optional(),
  json: z.boolean().optional(),
});
type CommandOptions = z.infer<typeof CommandOptionsSchema>;

interface Run {
  name: string;
  schemaValid: boolean;
  passed: number;
  total: number;
  failures: { id: string; reason: string }[];
  report: unknown;
}

function issueLines(issues: readonly { path: PropertyKey[]; message: string }[]): string[] {
  const lines: string[] = [];
  for (const issue of issues) {
    const path: string[] = [];
    for (const part of issue.path) {
      if (typeof part === 'string' || typeof part === 'number') path.push(String(part));
    }
    lines.push(path.length > 0 ? `${path.join('.')}: ${issue.message}` : issue.message);
  }
  return lines;
}

function readYaml(file: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `cannot read ${file}: ${message}` };
  }
  try {
    return { ok: true, value: parse(text) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `invalid YAML in ${file}: ${message}` };
  }
}

function candidateName(file: string): string {
  return basename(file).replace(/\.ya?ml$/, '');
}

function emitInvalid(errors: string[], json: boolean): never {
  console.error(errors.join('\n'));
  if (json) console.log(JSON.stringify({ schemaValid: false, schemaErrors: errors }, null, 2));
  process.exit(EXIT_INVALID);
}

function parseCommandOptions(opts: { out?: string; highlight?: string; json?: boolean }): CommandOptions {
  const input: { out: string; highlight?: string; json?: boolean } = { out: opts.out ?? '' };
  if (opts.highlight !== undefined) input.highlight = opts.highlight;
  if (opts.json !== undefined) input.json = opts.json;
  const parsed = CommandOptionsSchema.safeParse(input);
  if (!parsed.success) emitInvalid(issueLines(parsed.error.issues), input.json === true);
  return parsed.data;
}

function modelDocument(model: Model) {
  const states: State[] = [];
  for (const state of model.states()) {
    const data: { name: string; type: State['data'][number]['type'] }[] = [];
    for (const field of state.data) data.push({ name: field.name, type: field.type });
    states.push({
      id: state.id,
      label: state.label,
      workflowState: state.workflowState,
      final: state.final,
      data,
    });
  }
  const transitions: Transition[] = [];
  for (const edge of model.transitions()) {
    const item: Transition = {
      from: edge.from,
      event: edge.event,
      to: edge.to,
      actor: edge.actor,
      effect: { name: edge.effect.name, sets: edge.effect.sets },
    };
    if (edge.guard) item.guard = { name: edge.guard.name, reads: edge.guard.reads };
    transitions.push(item);
  }
  return { id: model.id, initial: model.initial, states, transitions };
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

function reportMarkdown(name: string, modelFile: string, model: Model, structure: Structure, unused: string[], results: readonly WorkflowResult[], passed: number): string {
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

function invalidRun(name: string, errors: string[], outDir: string): Run {
  const report = { candidate: name, schemaValid: false, schemaErrors: errors };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  console.error(`[${name}] invalid model:\n  ${errors.join('\n  ')}`);
  return { name, schemaValid: false, passed: 0, total: 0, failures: [], report };
}

function verifyOne(modelFile: string, workflows: readonly Workflow[], outDir: string, highlight: string | undefined, json: boolean): Run {
  const name = candidateName(modelFile);
  const read = readYaml(modelFile);
  if (!read.ok) return invalidRun(name, [read.error], outDir);
  const loaded = loadModel(read.value);
  if (!loaded.ok) return invalidRun(name, loaded.errors, outDir);
  const model = loaded.model;

  const structure = structuralChecks(model);
  const results = workflows.map((workflow) => verifyWorkflow(model, workflow));
  const passed = results.filter((result) => result.pass).length;
  const usedEdges = new Set(results.flatMap((result) => result.trace.filter((step) => step.accepted).map((step) => `${step.from}|${step.event}`)));
  const unusedTransitions = model.transitions()
    .filter((edge) => !usedEdges.has(`${edge.from}|${edge.event}`))
    .map((edge) => `${edge.from} --${edge.event}--> ${edge.to}`);
  const document = modelDocument(model);
  const report = {
    candidate: name,
    modelFile,
    schemaValid: true,
    model: document,
    structure,
    unusedTransitions,
    summary: { passed, total: results.length },
    workflows: results,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${outDir}/model.json`, JSON.stringify(document, null, 2));
  writeFileSync(`${outDir}/report.md`, reportMarkdown(name, modelFile, model, structure, unusedTransitions, results, passed));
  writeCharts(model, name, results, passed, outDir, highlight);

  const failures = results.filter((result) => !result.pass).map((result) => ({ id: result.id, reason: result.reason }));
  if (!json) {
    const detail = failures.map((failure) => `\n  FAIL ${failure.id}: ${failure.reason}`).join('');
    console.log(`[${name}] ${passed}/${results.length} pass${detail}`);
  }
  return { name, schemaValid: true, passed, total: results.length, failures, report };
}

function failWorkflows(file: string, errors: string[], json: boolean): never {
  emitInvalid(errors.map((error) => `${file}: ${error}`), json);
}

function runVerify(modelFile: string, workflowsFile: string, options: CommandOptions): never {
  const read = readYaml(workflowsFile);
  if (!read.ok) emitInvalid([read.error], options.json === true);
  const workflows = parseWorkflows(read.value);
  if (!workflows.ok) failWorkflows(workflowsFile, workflows.errors, options.json === true);
  const run = verifyOne(modelFile, workflows.workflows, options.out, options.highlight, options.json === true);
  if (options.json === true) console.log(JSON.stringify(run.report, null, 2));
  if (!run.schemaValid) process.exit(EXIT_INVALID);
  process.exit(run.passed === run.total && run.total > 0 ? EXIT_PASS : EXIT_FAILED);
}

function runCompare(workflowsFile: string, modelFiles: readonly string[], options: CommandOptions): never {
  const read = readYaml(workflowsFile);
  if (!read.ok) emitInvalid([read.error], options.json === true);
  const workflows = parseWorkflows(read.value);
  if (!workflows.ok) failWorkflows(workflowsFile, workflows.errors, options.json === true);
  const runs: Run[] = [];
  for (const modelFile of modelFiles) {
    runs.push(verifyOne(modelFile, workflows.workflows, `${options.out}/${candidateName(modelFile)}`, options.highlight, options.json === true));
  }
  runs.sort((left, right) => right.passed - left.passed);
  const anyInvalid = runs.some((run) => !run.schemaValid);
  const winner = !anyInvalid && runs[0] !== undefined && runs[0].passed === runs[0].total && runs[0].total > 0 ? runs[0].name : null;
  const lines = ['# Candidate comparison', '', '| Candidate | Passed | Failed workflows |', '|---|---|---|'];
  for (const run of runs) {
    const failed = !run.schemaValid ? 'invalid model' : (run.failures.map((failure) => failure.id).join(', ') || 'none');
    lines.push(`| ${run.name} | ${run.passed}/${run.total} | ${failed} |`);
  }
  lines.push('', winner ? `**Winner: ${winner}** (passes every workflow).` : '**No candidate passes every workflow.**');
  mkdirSync(options.out, { recursive: true });
  writeFileSync(`${options.out}/comparison.md`, lines.join('\n') + '\n');
  const comparison = {
    winner,
    candidates: runs.map((run) => ({ name: run.name, passed: run.passed, total: run.total, schemaValid: run.schemaValid })),
  };
  writeFileSync(`${options.out}/comparison.json`, JSON.stringify(comparison, null, 2));
  if (options.json === true) console.log(JSON.stringify(comparison, null, 2));
  else console.log(winner ? `Winner: ${winner}` : 'No candidate passes every workflow');
  if (anyInvalid) process.exit(EXIT_INVALID);
  process.exit(winner ? EXIT_PASS : EXIT_FAILED);
}

const program = new Command();
program
  .name('clew')
  .description('Prove workflows against YAML state models.')
  .exitOverride();

program
  .command('verify')
  .description('Check one model against a workflow file.')
  .argument('<model>', 'YAML model file')
  .argument('<workflows>', 'YAML workflow file')
  .option('--out <dir>', 'directory for reports and charts', 'out')
  .option('--highlight <workflowId>', 'highlight this workflow on the state chart')
  .option('--json', 'print results as JSON on stdout')
  .action((modelFile, workflowsFile, opts) => {
    runVerify(modelFile, workflowsFile, parseCommandOptions(opts));
  });

program
  .command('compare')
  .description('Check several models against one workflow file.')
  .argument('<workflows>', 'YAML workflow file')
  .argument('<models...>', 'YAML model files')
  .option('--out <dir>', 'directory for reports and charts', 'out')
  .option('--highlight <workflowId>', 'highlight this workflow on the state chart')
  .option('--json', 'print results as JSON on stdout')
  .action((workflowsFile, modelFiles, opts) => {
    runCompare(workflowsFile, modelFiles, parseCommandOptions(opts));
  });

program.addHelpText('afterAll', `
Exit codes:
  0  every workflow passed
  1  a workflow failed
  2  invalid model or input

Examples:
  clew verify examples/todo/b-full.yaml examples/todo/workflows.yaml --out out --highlight W2
  clew compare examples/todo/workflows.yaml examples/todo/a-basic.yaml examples/todo/b-full.yaml --out out
`);

try {
  program.parse();
} catch (error) {
  if (error instanceof CommanderError) process.exit(error.exitCode === 0 ? EXIT_PASS : EXIT_INVALID);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(EXIT_INVALID);
}
