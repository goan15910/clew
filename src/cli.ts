#!/usr/bin/env -S npx tsx
// clew verify  <model.yaml> <workflows.yaml> [--out dir] [--highlight W2] [--json]
// clew compare <workflows.yaml> <model.yaml>... [--out dir] [--highlight W2] [--json]
//
// Composition root: parse arguments, wire adapters into use cases, map results to output and exit codes.
import { Command, CommanderError } from '@commander-js/extra-typings';
import { z } from 'zod';
import { graphvizDiagramRenderer } from './adapters/diagram/graphviz-renderer.js';
import { fileReportWriter } from './adapters/report/file-report-writer.js';
import { xstateTraversalEngine } from './adapters/xstate/traversal-engine.js';
import { issueLines } from './adapters/yaml/issue-lines.js';
import { yamlModelLoader } from './adapters/yaml/model-loader.js';
import { yamlWorkflowLoader } from './adapters/yaml/workflow-loader.js';
import { compareModels } from './application/compare-models.js';
import type { Ports } from './application/ports.js';
import type { CandidateRun } from './application/verify-candidate.js';
import { verifyModel } from './application/verify-model.js';

const EXIT_PASS = 0;
const EXIT_FAILED = 1;
const EXIT_INVALID = 2;

const CommandOptionsSchema = z.strictObject({
  out: z.string().min(1, 'output directory must not be empty'),
  highlight: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a workflow id').optional(),
  json: z.boolean().optional(),
});
type CommandOptions = z.infer<typeof CommandOptionsSchema>;

const ports: Ports = {
  models: yamlModelLoader,
  workflows: yamlWorkflowLoader,
  engine: xstateTraversalEngine,
  reports: fileReportWriter,
  diagrams: graphvizDiagramRenderer,
};

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

function printCandidate(run: CandidateRun, json: boolean): void {
  if (!run.schemaValid) {
    console.error(`[${run.name}] invalid model:\n  ${run.report.schemaErrors.join('\n  ')}`);
    return;
  }
  if (json) return;
  const detail = run.failures.map((failure) => `\n  FAIL ${failure.id}: ${failure.reason}`).join('');
  console.log(`[${run.name}] ${run.passed}/${run.total} pass${detail}`);
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
    const options = parseCommandOptions(opts);
    const result = verifyModel({
      modelFile,
      workflowsFile,
      outDir: options.out,
      highlight: options.highlight,
    }, ports);
    if (result.status === 'invalid-input') emitInvalid(result.errors, options.json === true);
    printCandidate(result.run, options.json === true);
    if (options.json === true) console.log(JSON.stringify(result.run.report, null, 2));
    if (!result.run.schemaValid) process.exit(EXIT_INVALID);
    process.exit(result.run.passed === result.run.total && result.run.total > 0 ? EXIT_PASS : EXIT_FAILED);
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
    const options = parseCommandOptions(opts);
    const result = compareModels({
      workflowsFile,
      modelFiles,
      outDir: options.out,
      highlight: options.highlight,
    }, ports);
    if (result.status === 'invalid-input') emitInvalid(result.errors, options.json === true);
    const json = options.json === true;
    for (const run of result.runs) printCandidate(run, json);
    if (json) console.log(JSON.stringify(result.comparison, null, 2));
    else console.log(result.comparison.winner ? `Winner: ${result.comparison.winner}` : 'No candidate passes every workflow');
    if (result.runs.some((run) => !run.schemaValid)) process.exit(EXIT_INVALID);
    process.exit(result.comparison.winner ? EXIT_PASS : EXIT_FAILED);
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
