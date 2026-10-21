#!/usr/bin/env -S npx tsx
// clew chart check <chart.yaml> [--json]
// clew chart analyze <chart.yaml> [--json]
// clew workflows check <set.yaml> [--json]
// clew verify <chart.yaml> <set.yaml> <mapping.yaml> [--flow W1] [--select file] [--out dir] [--highlight W2] [--json]
// clew compare <verify.json>... [--out dir] [--json]
//
// Composition root: parse arguments, wire adapters into use cases, map results to output and exit codes.
import { Command, CommanderError } from '@commander-js/extra-typings';
import { z } from 'zod';
import { jsonSelectionLoader } from './adapters/json/selection-loader.js';
import { jsonVerifyResultLoader } from './adapters/json/verify-result-loader.js';
import { graphvizDiagramRenderer } from './adapters/diagram/graphviz-renderer.js';
import { fileReportWriter } from './adapters/report/file-report-writer.js';
import { humanSummary } from './adapters/text/summary.js';
import { xstateTraversalEngine } from './adapters/xstate/traversal-engine.js';
import { locatedErrors } from './adapters/yaml/issue-lines.js';
import { yamlMappingLoader } from './adapters/yaml/mapping-loader.js';
import { yamlModelLoader } from './adapters/yaml/model-loader.js';
import { yamlWorkflowLoader } from './adapters/yaml/workflow-loader.js';
import { analyzeChart } from './application/analyze-chart.js';
import { checkChart } from './application/check-chart.js';
import { checkWorkflows } from './application/check-workflows.js';
import { compareResults } from './application/compare-results.js';
import { formatIssues, type CommandDocument, type Outcome, type OutputIssue } from './application/documents.js';
import type { ComparePorts, VerifyPorts } from './application/ports.js';
import { verifyFlows } from './application/verify-flows.js';
import { WORKFLOW_ID_MESSAGE, WORKFLOW_ID_PATTERN } from './domain/workflow.js';

const EXIT_PASS = 0;
const EXIT_FAILED = 1;
const EXIT_INVALID = 2;

const verifyPorts: VerifyPorts = {
  models: yamlModelLoader,
  workflows: yamlWorkflowLoader,
  mappings: yamlMappingLoader,
  selections: jsonSelectionLoader,
  engine: xstateTraversalEngine,
  reports: fileReportWriter,
  diagrams: graphvizDiagramRenderer,
};

const comparePorts: ComparePorts = {
  results: jsonVerifyResultLoader,
  reports: fileReportWriter,
};

const JsonFlag = z.object({ json: z.boolean().optional() });
const OutFlag = z.object({
  json: z.boolean().optional(),
  out: z.string().min(1, 'output directory must not be empty').optional(),
});
const VerifyFlags = z.object({
  json: z.boolean().optional(),
  out: z.string().min(1, 'output directory must not be empty').optional(),
  highlight: z.string().regex(WORKFLOW_ID_PATTERN, WORKFLOW_ID_MESSAGE).optional(),
  select: z.string().min(1, 'selection file must not be empty').optional(),
  flow: z.array(z.string().regex(WORKFLOW_ID_PATTERN, WORKFLOW_ID_MESSAGE)).optional(),
});

function askedJson(opts: unknown): boolean {
  return typeof opts === 'object' && opts !== null && 'json' in opts && opts.json === true;
}

function usage(command: string, opts: unknown, error: z.ZodError): never {
  const issues: OutputIssue[] = [];
  for (const item of locatedErrors(error.issues)) issues.push({ kind: 'input', path: item.path, message: item.message });
  console.error(formatIssues(issues).join('\n'));
  if (askedJson(opts)) console.log(JSON.stringify({ command, ok: false, fault: 'usage', issues }, null, 2));
  process.exit(EXIT_INVALID);
}

function emit(outcome: Outcome<CommandDocument>, json: boolean): never {
  if (outcome.exit === 'invalid' && outcome.document.issues.length > 0) {
    console.error(formatIssues(outcome.document.issues).join('\n'));
  }
  if (json) console.log(JSON.stringify(outcome.document, null, 2));
  else if (outcome.exit !== 'invalid') console.log(humanSummary(outcome.document));
  process.exit(outcome.exit === 'pass' ? EXIT_PASS : outcome.exit === 'fail' ? EXIT_FAILED : EXIT_INVALID);
}

function collectFlow(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const program = new Command();
program
  .name('clew')
  .description('Check state charts and workflow sets, and prove each named flow.')
  .exitOverride();

const chart = program.command('chart').description('Check or analyze one state chart.');

chart
  .command('check')
  .description('Check a state chart\'s schema and graph.')
  .argument('<chart>', 'YAML state chart')
  .option('--json', 'print the result document as JSON on stdout')
  .action((file, opts) => {
    const parsed = JsonFlag.safeParse(opts);
    if (!parsed.success) usage('chart.check', opts, parsed.error);
    emit(checkChart(file, yamlModelLoader), parsed.data.json === true);
  });

chart
  .command('analyze')
  .description('Report reachability, dead ends, and shortest paths.')
  .argument('<chart>', 'YAML state chart')
  .option('--json', 'print the result document as JSON on stdout')
  .action((file, opts) => {
    const parsed = JsonFlag.safeParse(opts);
    if (!parsed.success) usage('chart.analyze', opts, parsed.error);
    emit(analyzeChart(file, yamlModelLoader, xstateTraversalEngine), parsed.data.json === true);
  });

const workflows = program.command('workflows').description('Check a workflow set.');

workflows
  .command('check')
  .description('Check a workflow set\'s schema and linked-list graph.')
  .argument('<workflows>', 'YAML workflow set')
  .option('--json', 'print the result document as JSON on stdout')
  .action((file, opts) => {
    const parsed = JsonFlag.safeParse(opts);
    if (!parsed.success) usage('workflows.check', opts, parsed.error);
    emit(checkWorkflows(file, yamlWorkflowLoader), parsed.data.json === true);
  });

program
  .command('verify')
  .description('Prove each selected flow in a workflow set against a state chart.')
  .argument('<chart>', 'YAML state chart')
  .argument('<workflows>', 'YAML workflow set')
  .argument('<mapping>', 'YAML chart-to-workflow mapping')
  .option('--flow <id>', 'named sub-graph to verify (repeatable)', collectFlow, [] as string[])
  .option('--select <file>', 'JSON selection: { "flows": ["W1"] } or a workflows.check document')
  .option('--highlight <workflowId>', 'highlight this workflow on the state chart')
  .option('--out <dir>', 'write reports and charts to this directory')
  .option('--json', 'print the result document as JSON on stdout')
  .action((chartFile, workflowsFile, mappingFile, opts) => {
    const parsed = VerifyFlags.safeParse(opts);
    if (!parsed.success) usage('verify', opts, parsed.error);
    const flags = parsed.data;
    emit(verifyFlows({
      chartFile,
      workflowsFile,
      mappingFile,
      flowIds: flags.flow ?? [],
      selectFile: flags.select,
      highlight: flags.highlight,
      outDir: flags.out,
    }, verifyPorts), flags.json === true);
  });

program
  .command('compare')
  .description('Rank verify JSON documents. Does not replay flows.')
  .argument('<results...>', 'JSON documents from clew verify --json')
  .option('--out <dir>', 'write the comparison to this directory')
  .option('--json', 'print the result document as JSON on stdout')
  .action((resultFiles, opts) => {
    const parsed = OutFlag.safeParse(opts);
    if (!parsed.success) usage('compare', opts, parsed.error);
    emit(compareResults({ resultFiles, outDir: parsed.data.out }, comparePorts), parsed.data.json === true);
  });

program.addHelpText('afterAll', `
Exit codes:
  0  check passed, analysis is clean, every selected flow passed, or compare has a winner
  1  schema or graph invalid, analysis found unreachable states or dead ends, a flow failed, or compare has no winner
  2  unreadable input, bad arguments, or verify/analyze preconditions failed

--json writes one document to stdout. Errors go to stderr. Clew never prompts.

Examples:
  clew chart check examples/todo/b-full.yaml --json
  clew chart analyze examples/todo/b-full.yaml --json
  clew workflows check examples/todo/workflows.yaml --json
  clew verify examples/todo/b-full.yaml examples/todo/workflows.yaml examples/todo/mapping.yaml --json
  clew verify examples/todo/a-basic.yaml examples/todo/workflows.yaml examples/todo/mapping.yaml --flow W8 --json
  clew compare b-full.json a-basic.json --json
`);

try {
  program.parse();
} catch (error) {
  if (error instanceof CommanderError) process.exit(error.exitCode === 0 ? EXIT_PASS : EXIT_INVALID);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(EXIT_INVALID);
}
