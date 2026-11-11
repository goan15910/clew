#!/usr/bin/env node
// clew (-V|--version)
// clew help [command...]
// clew upgrade [--check] [--channel release|head] [--version v] [--checksum sha256] [--verify-provenance] [--force] [--json]
// clew chart check <chart.yaml> [--json]
// clew chart analyze <chart.yaml> [--json]
// clew chart view <chart.yaml> [--workflows <set.yaml>] [--open] [--json]
// clew workflows check <set.yaml> [--json]
// clew workflows view <set.yaml> [--chart <chart.yaml>] [--open] [--json]
// clew verify <chart.yaml> <set.yaml> [--flow W1] [--select file] [--highlight W2] [--heatmap] [--replay] [--out dir] [--json]
// clew compare <verify.json>... [--out dir] [--json]
// clew spec init <spec.md> [--session id] [--json]
// clew spec tag [--session id] [--sentence s1] [--json]
// clew spec spans merge --lexicon file.json [--force-auto] [--session id] [--json]
// clew spec spans merge --id sp:... --id sp:... [--tags Noun] [--entity concept:id|--link none] [--session id] [--json]
// clew spec spans check --lexicon file.json [--session id] [--json]
// clew spec concepts list [--session id] [--json]
// clew spec concepts group --span sp:... (--into concept:id | --none) [--depends-on sp:...] --reason text [--by] [--finding] [--comment] [--session id] [--json]
// clew spec frames list [--sentence s1] [--session id] [--json]
// clew spec frames set --frame fr:... --role actor|event|object|result|when (--value ref... | --unknown) [--depends-on sp:...] --reason text [--session id] [--json]
// clew spec frames not-transition --frame fr:... --reason text [--clear] [--session id] [--json]
// clew spec impact <sentence> [--session id] [--json]
// clew spec graph build [--session id] [--json]
// clew spec graph split --id W1 --at fr:s1.t2 [--session id] [--json]
// clew spec graph group --id W1 --id W2 [--title text] [--session id] [--json]
// clew spec emit (--dry-run | --out file) [--chart file] [--force] [--session id] [--json]
// clew spec tla scaffold (--dry-run | --out file.tla) [--force] [--session id] [--json]
// clew spec tla check <file.tla> [--session id] [--json]
// clew spec trace <id> [--session id] [--json]
// clew spec status [--session id] [--json]
// clew spec show sentences|tagged|tokens|spans|concepts|frames [--session id] [--json]
// clew spec view <session-id> [--open] [--json]
// clew spec session list [--json]
// clew spec session remove <id> [--json]
//
// Composition root: parse arguments, wire adapters into use cases, map results to output and exit codes.
import { Command, CommanderError } from '@commander-js/extra-typings';
import { z } from 'zod';
import { githubReleases } from './adapters/upgrade/github-releases.js';
import { locateInstall } from './adapters/upgrade/install-location.js';
import { localFiles } from './adapters/upgrade/local-files.js';
import { ghProvenance, npmGlobal } from './adapters/upgrade/npm-global.js';
import { jsonSelectionLoader } from './adapters/json/selection-loader.js';
import { packageVersion } from './adapters/package/package-version.js';
import { compromiseTagger } from './adapters/pos/compromise-tagger.js';
import { loadGroupPatch, loadSplitPatch } from './adapters/spec-store/flow-patch.js';
import { jsonSpecStore } from './adapters/spec-store/json-file-store.js';
import { loadSpanLexicon } from './adapters/spec-store/lexicon-loader.js';
import { specTextSink, specTextSource } from './adapters/spec-store/read-spec.js';
import {
  jsonSpecSessionViewer,
  openViewerUrl,
  serveSessionViewer,
  waitForInterrupt,
} from './adapters/spec-store/session-viewer.js';
import { jsonVerifyResultLoader } from './adapters/json/verify-result-loader.js';
import { graphvizDiagramRenderer } from './adapters/diagram/graphviz-renderer.js';
import {
  installDiagramViewer,
  openDiagramViewerUrl,
  serveDiagramViewer,
  waitForDiagramInterrupt,
} from './adapters/diagram/interactive/diagram-viewer.js';
import { fileReportWriter } from './adapters/report/file-report-writer.js';
import { humanSummary } from './adapters/text/summary.js';
import { xstateTraversalEngine } from './adapters/xstate/traversal-engine.js';
import { locatedErrors } from './adapters/yaml/issue-lines.js';
import { yamlModelLoader } from './adapters/yaml/model-loader.js';
import { yamlSpecLoader } from './adapters/yaml/spec-loader.js';
import { yamlWorkflowLoader } from './adapters/yaml/workflow-loader.js';
import { yamlSpecWriter } from './adapters/yaml/spec-writer.js';
import { yamlWorkflowWriter } from './adapters/yaml/workflow-writer.js';
import { analyzeChart } from './application/analyze-chart.js';
import { buildSpecGraph } from './application/build-graph.js';
import { checkChart } from './application/check-chart.js';
import { checkSpans } from './application/check-spans.js';
import { checkWorkflows } from './application/check-workflows.js';
import { compareResults } from './application/compare-results.js';
import { editGraph } from './application/edit-graph.js';
import { editSentence } from './application/edit-sentences.js';
import { checkTla } from './application/check-tla.js';
import { emitSpec } from './application/emit-spec.js';
import { scaffoldTla } from './application/scaffold-tla.js';
import { tlaTextFiles } from './adapters/tla/text-files.js';
import { exportSpec } from './application/export-spec.js';
import { initSpec } from './application/init-spec.js';
import { listConcepts } from './application/list-concepts.js';
import { groupConcept } from './application/group-concepts.js';
import { listFrames } from './application/list-frames.js';
import { markNotTransition, setFrameRole } from './application/refine-frames.js';
import { readSpecImpact } from './application/spec-impact.js';
import { listSpecSessions } from './application/list-spec-sessions.js';
import { mergeSpans } from './application/merge-spans.js';
import { SPEC_SHOW_LAYERS, formatIssues, type CommandDocument, type DiagramViewDocument, type Outcome, type OutputIssue, type SpecShowLayer } from './application/documents.js';
import type { ComparePorts, UpgradePorts, VerifyPorts } from './application/ports.js';
import { readSpecStatus } from './application/spec-status.js';
import { showSpec } from './application/show-spec.js';
import { removeSpecSession } from './application/remove-spec-session.js';
import { tagSpec } from './application/tag-spec.js';
import { traceSpec } from './application/trace-spec.js';
import { verifyFlows } from './application/verify-flows.js';
import { upgradeClew } from './application/upgrade-clew.js';
import { viewChart, viewWorkflows } from './application/view-diagram.js';
import { viewSpecSession } from './application/view-spec.js';
import { assertManuals, findCommand, fullHelp, jsonNote, listCommands, sessionNote, setManual, specExits } from './cli/help.js';
import { SPEC_CONCEPT_ID_MESSAGE, SPEC_CONCEPT_ID_PATTERN, SPEC_FRAME_ID_MESSAGE, SPEC_FRAME_ID_PATTERN, SPEC_SENTENCE_ID_MESSAGE, SPEC_SENTENCE_ID_PATTERN, SPEC_SESSION_ID_MESSAGE, SPEC_SESSION_ID_PATTERN } from './domain/spec.js';
import { ROLE_NAMES } from './domain/spec-frames.js';
import { WORKFLOW_ID_MESSAGE, WORKFLOW_ID_PATTERN } from './domain/workflow.js';

const EXIT_PASS = 0;
const EXIT_FAILED = 1;
const EXIT_INVALID = 2;

const verifyPorts: VerifyPorts = {
  specs: yamlSpecLoader,
  models: yamlModelLoader,
  workflows: yamlWorkflowLoader,
  selections: jsonSelectionLoader,
  reports: fileReportWriter,
  diagrams: graphvizDiagramRenderer,
};

const comparePorts: ComparePorts = {
  results: jsonVerifyResultLoader,
  reports: fileReportWriter,
};

const upgradePorts: UpgradePorts = {
  install: { locate: locateInstall },
  releases: githubReleases,
  files: localFiles,
  npm: npmGlobal,
  provenance: ghProvenance,
};

const UpgradeFlags = z.object({
  json: z.boolean().optional(),
  check: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  channel: z.enum(['release', 'head']).optional(),
  version: z.string().regex(/^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/, 'version looks like 0.1.0 or v0.1.0-alpha.3').optional(),
  checksum: z.string().regex(/^[0-9a-fA-F]{64}$/, 'checksum is a 64-character SHA-256 hex digest').optional(),
  verifyProvenance: z.boolean().optional(),
  force: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.version !== undefined && value.channel === 'head') {
    context.addIssue({ code: 'custom', message: '--version names a release; it cannot combine with --channel head', path: ['version'] });
  }
  if (value.checksum !== undefined && value.channel === 'head') {
    context.addIssue({ code: 'custom', message: '--checksum pins a release tarball; the head channel moves', path: ['checksum'] });
  }
});

const JsonFlag = z.object({ json: z.boolean().optional() });
const OutFlag = z.object({
  json: z.boolean().optional(),
  out: z.string().min(1, 'output directory must not be empty').optional(),
});
const SpecInitFlags = z.object({
  json: z.boolean().optional(),
  session: z.string().regex(SPEC_SESSION_ID_PATTERN, SPEC_SESSION_ID_MESSAGE).optional(),
});
const SpecTagFlags = z.object({
  json: z.boolean().optional(),
  session: z.string().regex(SPEC_SESSION_ID_PATTERN, SPEC_SESSION_ID_MESSAGE).optional(),
  sentence: z.string().regex(SPEC_SENTENCE_ID_PATTERN, SPEC_SENTENCE_ID_MESSAGE).optional(),
});
const RevisionFlags = {
  json: z.boolean().optional(),
  session: z.string().regex(SPEC_SESSION_ID_PATTERN, SPEC_SESSION_ID_MESSAGE).optional(),
  reason: z.string({ error: '--reason is required' }).trim().min(1, '--reason must not be empty'),
  finding: z.string().min(1).optional(),
  comment: z.string().min(1).optional(),
  by: z.string().min(1).optional(),
};
const SentenceIdOption = z.string({ error: '--id is required' }).regex(SPEC_SENTENCE_ID_PATTERN, SPEC_SENTENCE_ID_MESSAGE);
const SpecSentenceAddFlags = z.object({
  ...RevisionFlags,
  text: z.string({ error: '--text is required' }).min(1),
  after: z.string().regex(SPEC_SENTENCE_ID_PATTERN, SPEC_SENTENCE_ID_MESSAGE).optional(),
});
const SpecSentenceEditFlags = z.object({ ...RevisionFlags, id: SentenceIdOption, text: z.string({ error: '--text is required' }).min(1) });
const SpecSentenceDeleteFlags = z.object({ ...RevisionFlags, id: SentenceIdOption });
const SpecExportFlags = z.object({
  json: z.boolean().optional(),
  session: z.string().regex(SPEC_SESSION_ID_PATTERN, SPEC_SESSION_ID_MESSAGE).optional(),
  version: z.enum(['original', 'latest']).default('latest'),
  out: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
}).refine((flags) => (flags.out !== undefined) !== (flags.dryRun === true), { message: 'pass exactly one of --out and --dry-run' });
const SPAN_ID = /^sp:s[1-9][0-9]*\.t[1-9][0-9]*\.\.s[1-9][0-9]*\.t[1-9][0-9]*$/;
const SpecSpansMergeFlags = z.object({
  json: z.boolean().optional(),
  session: z.string().regex(SPEC_SESSION_ID_PATTERN, SPEC_SESSION_ID_MESSAGE).optional(),
  lexicon: z.string().min(1).optional(),
  forceAuto: z.boolean().optional(),
  id: z.array(z.string().regex(SPAN_ID, 'span ids look like sp:s1.t1..s1.t2')).optional(),
  tags: z.array(z.string().min(1)).optional(),
  entity: z.string().regex(SPEC_CONCEPT_ID_PATTERN, SPEC_CONCEPT_ID_MESSAGE).optional(),
  link: z.literal('none').optional(),
}).superRefine((value, context) => {
  const hasLexicon = value.lexicon !== undefined;
  const ids = value.id ?? [];
  const tags = value.tags ?? [];
  const hasIds = ids.length > 0;
  if (hasLexicon === hasIds) {
    context.addIssue({ code: 'custom', message: 'pass --lexicon for auto-merge, or repeat --id for interactive merge', path: ['lexicon'] });
  }
  if (value.entity !== undefined && value.link !== undefined) {
    context.addIssue({ code: 'custom', message: 'pass --entity or --link none, not both', path: ['entity'] });
  }
  if (hasLexicon && (tags.length > 0 || value.entity !== undefined || value.link !== undefined || hasIds)) {
    context.addIssue({ code: 'custom', message: 'lexicon merge does not take --id, --tags, --entity, or --link', path: ['lexicon'] });
  }
});
const SpecSpansCheckFlags = z.object({
  json: z.boolean().optional(),
  session: z.string().regex(SPEC_SESSION_ID_PATTERN, SPEC_SESSION_ID_MESSAGE).optional(),
  lexicon: z.string().min(1, 'lexicon path is required'),
});
const SessionOption = z.string().regex(SPEC_SESSION_ID_PATTERN, SPEC_SESSION_ID_MESSAGE).optional();
const SpecFramesListFlags = z.object({
  json: z.boolean().optional(),
  session: SessionOption,
  sentence: z.string().regex(SPEC_SENTENCE_ID_PATTERN, SPEC_SENTENCE_ID_MESSAGE).optional(),
});
const SpanIdOption = z.string().regex(SPAN_ID, 'span ids look like sp:s1.t1..s1.t2');
const FrameIdOption = z.string({ error: '--frame is required' }).regex(SPEC_FRAME_ID_PATTERN, SPEC_FRAME_ID_MESSAGE);
const SpecConceptsGroupFlags = z.object({
  ...RevisionFlags,
  span: z.string({ error: '--span is required' }).regex(SPAN_ID, 'span ids look like sp:s1.t1..s1.t2'),
  into: z.string().regex(SPEC_CONCEPT_ID_PATTERN, SPEC_CONCEPT_ID_MESSAGE).optional(),
  none: z.boolean().optional(),
  dependsOn: z.array(SpanIdOption).optional(),
}).refine((flags) => (flags.into !== undefined) !== (flags.none === true), { message: 'pass exactly one of --into and --none', path: ['into'] });
const SpecFramesSetFlags = z.object({
  ...RevisionFlags,
  frame: FrameIdOption,
  role: z.enum(ROLE_NAMES, { error: '--role is one of actor, event, object, result, when' }),
  value: z.array(z.string().min(1)).optional(),
  unknown: z.boolean().optional(),
  dependsOn: z.array(SpanIdOption).optional(),
}).refine((flags) => ((flags.value ?? []).length > 0) !== (flags.unknown === true), { message: 'pass --value (repeatable) or --unknown, not both', path: ['value'] });
const SpecFramesNotTransitionFlags = z.object({ ...RevisionFlags, frame: FrameIdOption, clear: z.boolean().optional() });
const FlowIdOption = z.string().regex(WORKFLOW_ID_PATTERN, WORKFLOW_ID_MESSAGE);
const SpecGraphSplitFlags = z.object({
  json: z.boolean().optional(),
  session: SessionOption,
  from: z.string().min(1).optional(),
  id: FlowIdOption.optional(),
  at: z.string().min(1).optional(),
}).superRefine((value, context) => {
  if (value.from === '-') context.addIssue({ code: 'custom', message: 'Clew never reads stdin', path: ['from'] });
  const flagged = value.id !== undefined || value.at !== undefined;
  if (value.from !== undefined && flagged) context.addIssue({ code: 'custom', message: 'pass flags or --from, not both', path: ['from'] });
  if (value.from === undefined && (value.id === undefined || value.at === undefined)) {
    context.addIssue({ code: 'custom', message: 'split needs --id and --at, or --from', path: ['id'] });
  }
});
const SpecGraphGroupFlags = z.object({
  json: z.boolean().optional(),
  session: SessionOption,
  from: z.string().min(1).optional(),
  id: z.array(FlowIdOption).optional(),
  transition: z.array(z.string().regex(SPEC_FRAME_ID_PATTERN, SPEC_FRAME_ID_MESSAGE)).optional(),
  title: z.string().min(1).optional(),
  into: FlowIdOption.optional(),
}).superRefine((value, context) => {
  if (value.from === '-') context.addIssue({ code: 'custom', message: 'Clew never reads stdin', path: ['from'] });
  const flowCount = value.id?.length ?? 0;
  const transitionCount = value.transition?.length ?? 0;
  const flagged = flowCount > 0 || transitionCount > 0 || value.title !== undefined || value.into !== undefined;
  if (value.from !== undefined && flagged) context.addIssue({ code: 'custom', message: 'pass flags or --from, not both', path: ['from'] });
  if (value.from !== undefined) return;
  if (flowCount > 0 && transitionCount > 0) context.addIssue({ code: 'custom', message: 'pass --id or --transition, not both', path: ['id'] });
  if (flowCount === 0 && transitionCount === 0) context.addIssue({ code: 'custom', message: 'group needs at least two --id or two --transition, or --from', path: ['id'] });
  if ((flowCount > 0 && flowCount < 2) || (transitionCount > 0 && transitionCount < 2)) {
    context.addIssue({ code: 'custom', message: 'group needs at least two paths', path: ['id'] });
  }
});
const SpecEmitFlags = z.object({
  json: z.boolean().optional(),
  session: SessionOption,
  dryRun: z.boolean().optional(),
  out: z.string().min(1).optional(),
  chart: z.string().min(1).optional(),
  force: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.out === '-') context.addIssue({ code: 'custom', message: 'emit writes a file; Clew never writes the workflow set to stdout', path: ['out'] });
  if (value.chart === '-') context.addIssue({ code: 'custom', message: 'emit writes a file; Clew never writes the chart to stdout', path: ['chart'] });
  if (value.dryRun === true && value.out !== undefined) context.addIssue({ code: 'custom', message: 'pass --dry-run or --out, not both', path: ['out'] });
  if (value.dryRun !== true && (value.out === undefined || value.out === '')) context.addIssue({ code: 'custom', message: 'emit needs --dry-run or --out', path: ['out'] });
});
const SpecTlaScaffoldFlags = z.object({
  json: z.boolean().optional(),
  session: SessionOption,
  dryRun: z.boolean().optional(),
  out: z.string().min(1).optional(),
  force: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.out === '-') context.addIssue({ code: 'custom', message: 'scaffold writes a file; Clew never writes the module to stdout', path: ['out'] });
  if (value.dryRun === true && value.out !== undefined) context.addIssue({ code: 'custom', message: 'pass --dry-run or --out, not both', path: ['out'] });
  if (value.dryRun !== true && value.out === undefined) context.addIssue({ code: 'custom', message: 'scaffold needs --dry-run or --out', path: ['out'] });
});
const SpecSessionFlags = z.object({
  json: z.boolean().optional(),
  session: SessionOption,
});
const HelpPath = z.array(z.string()).superRefine((values, context) => {
  for (const value of values) {
    if (!/^[a-z][a-z0-9-]*$/.test(value)) {
      context.addIssue({ code: 'custom', message: 'command names use letters, digits, and hyphens', path: ['command'] });
    }
  }
});
const VerifyFlags = z.object({
  json: z.boolean().optional(),
  out: z.string().min(1, 'output directory must not be empty').optional(),
  highlight: z.string().regex(WORKFLOW_ID_PATTERN, WORKFLOW_ID_MESSAGE).optional(),
  select: z.string().min(1, 'selection file must not be empty').optional(),
  flow: z.array(z.string().regex(WORKFLOW_ID_PATTERN, WORKFLOW_ID_MESSAGE)).optional(),
  heatmap: z.boolean().optional(),
  replay: z.boolean().optional(),
}).superRefine((value, context) => {
  if ((value.heatmap === true || value.replay === true) && value.out === undefined) {
    context.addIssue({ code: 'custom', message: '--heatmap and --replay need --out', path: ['out'] });
  }
});

function revisionFields(data: { reason: string; finding?: string; comment?: string; by?: string }): { reason: string; finding?: string; comment?: string; by?: string } {
  const fields: { reason: string; finding?: string; comment?: string; by?: string } = { reason: data.reason };
  if (data.finding !== undefined) fields.finding = data.finding;
  if (data.comment !== undefined) fields.comment = data.comment;
  if (data.by !== undefined) fields.by = data.by;
  return fields;
}

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

async function emitDiagramView(
  outcome: Outcome<DiagramViewDocument>,
  json: boolean,
  open: boolean,
): Promise<never> {
  if (outcome.exit !== 'pass' || !outcome.document.ok) {
    emit(outcome, json);
  }
  const installed = installDiagramViewer(outcome.document);
  if (!installed.ok) {
    emit({
      exit: 'invalid',
      document: {
        ...outcome.document,
        ok: false,
        fault: 'unreadable',
        issues: [{ kind: 'input', path: '', message: installed.message }],
      },
    }, json);
  }
  outcome.document.htmlPath = installed.htmlPath;
  outcome.document.viewDir = installed.viewDir;
  if (open) {
    let server;
    try {
      server = await serveDiagramViewer(installed.viewDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({
        exit: 'invalid',
        document: {
          ...outcome.document,
          ok: false,
          fault: 'unreadable',
          issues: [{ kind: 'input', path: '', message }],
        },
      }, json);
    }
    outcome.document.url = server.url;
    const opened = openDiagramViewerUrl(server.url);
    if (!opened.ok) {
      await server.close();
      emit({
        exit: 'invalid',
        document: {
          ...outcome.document,
          ok: false,
          fault: 'unreadable',
          issues: [{ kind: 'input', path: '', message: opened.message }],
        },
      }, json);
    }
    if (json) console.log(JSON.stringify(outcome.document, null, 2));
    else console.log(humanSummary(outcome.document));
    await waitForDiagramInterrupt();
    await server.close();
    process.exit(EXIT_PASS);
  }
  emit(outcome, json);
}

function collectFlow(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const installed = packageVersion();
if (!installed.ok) {
  console.error(installed.error);
  process.exit(EXIT_INVALID);
}

const program = new Command();
program
  .name('clew')
  .description('Check state charts and workflow sets, and prove each named flow.')
  .version(installed.version, '-V, --version', 'print the installed version')
  .enablePositionalOptions()
  .exitOverride();

// Group commands turn Commander's implicit help subcommand off. Long help is `clew help`.
const chart = program.command('chart').description('Check, analyze, or view one state chart.').helpCommand(false);

const DiagramViewFlags = z.object({
  json: z.boolean().optional(),
  open: z.boolean().optional(),
});
const ChartViewFlags = DiagramViewFlags.extend({
  workflows: z.string().min(1, 'workflow set path must not be empty').optional(),
});
const WorkflowsViewFlags = DiagramViewFlags.extend({
  chart: z.string().min(1, 'chart path must not be empty').optional(),
});

setManual(chart
  .command('check')
  .description('Check a state chart\'s schema and graph.')
  .argument('<chart>', 'YAML state chart')
  .option('--json', 'print the result document as JSON on stdout')
  .action((file, opts) => {
    const parsed = JsonFlag.safeParse(opts);
    if (!parsed.success) usage('chart.check', opts, parsed.error);
    emit(checkChart(file, yamlSpecLoader), parsed.data.json === true);
  }), {
  examples: ['clew chart check examples/todo/b-full.yaml --json'],
  exitCodes: [
    { code: 0, meaning: 'the chart schema and graph are valid' },
    { code: 1, meaning: 'the schema or the graph is invalid' },
    { code: 2, meaning: 'the file is unreadable or the arguments are wrong' },
  ],
  notes: [jsonNote],
});

setManual(chart
  .command('analyze')
  .description('Report reachability, dead ends, and shortest paths.')
  .argument('<chart>', 'YAML state chart')
  .option('--json', 'print the result document as JSON on stdout')
  .action((file, opts) => {
    const parsed = JsonFlag.safeParse(opts);
    if (!parsed.success) usage('chart.analyze', opts, parsed.error);
    emit(analyzeChart(file, yamlModelLoader, xstateTraversalEngine), parsed.data.json === true);
  }), {
  examples: ['clew chart analyze examples/todo/b-full.yaml --json'],
  exitCodes: [
    { code: 0, meaning: 'every state is reachable and no state is a dead end' },
    { code: 1, meaning: 'a state is unreachable or a non-final state has no outgoing transition' },
    { code: 2, meaning: 'the file is unreadable, the arguments are wrong, or the chart is too invalid to analyze' },
  ],
  notes: [jsonNote],
});

setManual(chart
  .command('view')
  .description('Render a state chart in the interactive viewer (no spec session).')
  .argument('<chart>', 'YAML state chart')
  .option('--workflows <file>', 'also render this workflow set beside the chart')
  .option('--open', 'serve the viewer on localhost and open it in a browser')
  .option('--json', 'print the result document as JSON on stdout')
  .action(async (file, opts) => {
    const parsed = ChartViewFlags.safeParse(opts);
    if (!parsed.success) usage('chart.view', opts, parsed.error);
    const flags = parsed.data;
    const outcome = viewChart(
      { chartFile: file, workflowsFile: flags.workflows },
      yamlModelLoader,
      yamlWorkflowLoader,
    );
    await emitDiagramView(outcome, flags.json === true, flags.open === true);
  }), {
  examples: [
    'clew chart view examples/todo/b-full.yaml --json',
    'clew chart view examples/todo/b-full.yaml --open',
    'clew chart view examples/todo/b-full.yaml --workflows examples/todo/workflows.yaml --open',
  ],
  exitCodes: [
    { code: 0, meaning: 'the viewer was written, and with --open the local server ran until interrupt' },
    { code: 1, meaning: 'the chart or workflow set schema/graph is invalid' },
    { code: 2, meaning: 'a file is unreadable, the viewer could not be written, or the arguments are wrong' },
  ],
  notes: [
    jsonNote,
    'chart view writes a standalone HTML page that mounts the same Cytoscape renderer as the spec Graph tab.',
    'No spec session is required. Browsers block fetch() from file://, so --open serves the page on 127.0.0.1.',
    'Pass --workflows to show the chart and the workflow set together.',
  ],
});

const workflows = program.command('workflows').description('Check or view a workflow set.').helpCommand(false);

setManual(workflows
  .command('check')
  .description('Check a workflow set\'s schema and linked-list graph.')
  .argument('<workflows>', 'YAML workflow set')
  .option('--json', 'print the result document as JSON on stdout')
  .action((file, opts) => {
    const parsed = JsonFlag.safeParse(opts);
    if (!parsed.success) usage('workflows.check', opts, parsed.error);
    emit(checkWorkflows(file, yamlWorkflowLoader), parsed.data.json === true);
  }), {
  examples: ['clew workflows check examples/todo/workflows.yaml --json'],
  exitCodes: [
    { code: 0, meaning: 'the workflow set schema and graph are valid' },
    { code: 1, meaning: 'the schema or the graph is invalid' },
    { code: 2, meaning: 'the file is unreadable or the arguments are wrong' },
  ],
  notes: [jsonNote],
});

setManual(workflows
  .command('view')
  .description('Render a workflow set in the interactive viewer (no spec session).')
  .argument('<workflows>', 'YAML workflow set')
  .option('--chart <file>', 'also render this state chart (and use it for state labels)')
  .option('--open', 'serve the viewer on localhost and open it in a browser')
  .option('--json', 'print the result document as JSON on stdout')
  .action(async (file, opts) => {
    const parsed = WorkflowsViewFlags.safeParse(opts);
    if (!parsed.success) usage('workflows.view', opts, parsed.error);
    const flags = parsed.data;
    const outcome = viewWorkflows(
      { workflowsFile: file, chartFile: flags.chart },
      yamlModelLoader,
      yamlWorkflowLoader,
    );
    await emitDiagramView(outcome, flags.json === true, flags.open === true);
  }), {
  examples: [
    'clew workflows view examples/todo/workflows.yaml --json',
    'clew workflows view examples/todo/workflows.yaml --open',
    'clew workflows view examples/todo/workflows.yaml --chart examples/todo/b-full.yaml --open',
  ],
  exitCodes: [
    { code: 0, meaning: 'the viewer was written, and with --open the local server ran until interrupt' },
    { code: 1, meaning: 'the workflow set or chart schema/graph is invalid' },
    { code: 2, meaning: 'a file is unreadable, the viewer could not be written, or the arguments are wrong' },
  ],
  notes: [
    jsonNote,
    'workflows view writes a standalone HTML page that mounts the same Cytoscape renderer as the spec Graph tab.',
    'No spec session is required. Browsers block fetch() from file://, so --open serves the page on 127.0.0.1.',
    'Pass --chart to show the chart beside the workflows and to label states from the chart.',
  ],
});

setManual(program
  .command('verify')
  .description('Prove each selected flow against a spec by next-state replay.')
  .argument('<chart>', 'YAML state chart')
  .argument('<workflows>', 'YAML workflow set')
  .option('--flow <id>', 'named sub-graph to verify (repeatable)', collectFlow, [] as string[])
  .option('--select <file>', 'JSON selection: { "flows": ["W1"] } or a workflows.check document')
  .option('--highlight <workflowId>', 'highlight this workflow on the state chart')
  .option('--heatmap', 'write a transition coverage heatmap into --out')
  .option('--replay', 'write a replay GIF for each selected workflow into --out')
  .option('--out <dir>', 'write reports, charts, and proof views to this directory')
  .option('--json', 'print the result document as JSON on stdout')
  .action((chartFile, workflowsFile, opts) => {
    const parsed = VerifyFlags.safeParse(opts);
    if (!parsed.success) usage('verify', opts, parsed.error);
    const flags = parsed.data;
    emit(verifyFlows({
      chartFile,
      workflowsFile,
      flowIds: flags.flow ?? [],
      selectFile: flags.select,
      highlight: flags.highlight,
      outDir: flags.out,
      heatmap: flags.heatmap,
      replay: flags.replay,
    }, verifyPorts), flags.json === true);
  }), {
  examples: [
    'clew verify examples/todo/b-full.yaml examples/todo/workflows.yaml --json',
    'clew verify examples/todo/a-basic.yaml examples/todo/workflows.yaml --flow W8 --json',
    'clew verify examples/todo/b-full.yaml examples/todo/workflows.yaml --heatmap --replay --out out --json',
  ],
  exitCodes: [
    { code: 0, meaning: 'every selected flow passed' },
    { code: 1, meaning: 'a selected flow failed' },
    { code: 2, meaning: 'the input is unreadable, the arguments are wrong, a node assign is not a total valuation, or the selection names a missing flow' },
  ],
  notes: [
    jsonNote,
    '--heatmap and --replay need --out. A node assign that is not a total valuation of the spec vars exits 2. An event the spec never enables fails only that flow. An accepted flow must start at a valuation reachable from initial.',
  ],
});

setManual(program
  .command('upgrade')
  .description('Move this global install to the newest build on its channel.')
  .option('--check', 'say what would change and exit without installing')
  .option('--dry-run', 'same as --check')
  .option('--channel <channel>', 'switch channel on purpose: release or head')
  .option('--version <version>', 'install exactly this release, even if it is a downgrade')
  .option('--checksum <sha256>', 'also require the tarball to match this SHA-256')
  .option('--verify-provenance', 'also run gh attestation verify on the tarball')
  .option('--force', 'reinstall the same build, or replace a local build')
  .option('--json', 'print the result document as JSON on stdout')
  .action(async (opts) => {
    const parsed = UpgradeFlags.safeParse(opts);
    if (!parsed.success) usage('upgrade', opts, parsed.error);
    const flags = parsed.data;
    const outcome = await upgradeClew({
      channel: flags.channel,
      version: flags.version,
      check: flags.check === true || flags.dryRun === true,
      force: flags.force === true,
      checksum: flags.checksum,
      verifyProvenance: flags.verifyProvenance === true,
    }, upgradePorts);
    if (outcome.exit !== 'pass') {
      console.error(formatIssues(outcome.document.issues).join('\n'));
      if (outcome.document.retry !== undefined) console.error(`run: ${outcome.document.retry}`);
      if (flags.json === true) console.log(JSON.stringify(outcome.document, null, 2));
      process.exit(outcome.exit === 'fail' ? EXIT_FAILED : EXIT_INVALID);
    }
    emit(outcome, flags.json === true);
  }), {
  examples: [
    'clew upgrade',
    'clew upgrade --check --json',
    'clew upgrade --version 0.1.0-alpha.3',
    'clew upgrade --channel head',
  ],
  exitCodes: [
    { code: 0, meaning: 'the install is current, or the upgrade finished, or --check reported' },
    { code: 1, meaning: 'the lookup, download, checksum, or install failed and nothing changed' },
    { code: 2, meaning: 'this install is not one clew made, or the arguments are wrong' },
  ],
  notes: [
    jsonNote,
    'Release channel: GitHub releases, newest SemVer. A prerelease install may move to prereleases. Head channel: the rolling edge prerelease, compared by commit.',
    'Plain upgrade stays on the installed channel. The tarball must match SHA256SUMS, or nothing is installed. Spec sessions are never touched.',
    'Local builds (scripts/install-clew.sh --from local) are refused without --force. An unwritable prefix prints the npm command to run. Clew never runs sudo.',
    'GITHUB_TOKEN raises the API rate limit. --version needs no API call.',
  ],
});

setManual(program
  .command('compare')
  .description('Rank verify JSON documents. Does not replay flows.')
  .argument('<results...>', 'JSON documents from clew verify --json')
  .option('--out <dir>', 'write the comparison to this directory')
  .option('--json', 'print the result document as JSON on stdout')
  .action((resultFiles, opts) => {
    const parsed = OutFlag.safeParse(opts);
    if (!parsed.success) usage('compare', opts, parsed.error);
    emit(compareResults({ resultFiles, outDir: parsed.data.out }, comparePorts), parsed.data.json === true);
  }), {
  examples: ['clew compare b-full.json a-basic.json --json'],
  exitCodes: [
    { code: 0, meaning: 'compare has a winner' },
    { code: 1, meaning: 'compare has no winner' },
    { code: 2, meaning: 'a result file is unreadable or the arguments are wrong' },
  ],
  notes: [jsonNote],
});

const spec = program.command('spec').description('Turn a plain-English spec into a workflow set, one layer at a time.').helpCommand(false);

setManual(spec
  .command('init')
  .description('Split a Markdown spec into sentences and open a session.')
  .argument('<spec>', 'Markdown or plain-text spec')
  .option('--session <id>', 'session to create or reuse')
  .option('--json', 'print the result document as JSON on stdout')
  .action((file, opts) => {
    const parsed = SpecInitFlags.safeParse(opts);
    if (!parsed.success) usage('spec.init', opts, parsed.error);
    emit(initSpec({ file, sessionId: parsed.data.session }, specTextSource, jsonSpecStore), parsed.data.json === true);
  }), {
  examples: ['clew spec init examples/spec/order.md --json'],
  exitCodes: specExits,
  notes: [jsonNote, sessionNote],
});

setManual(spec
  .command('tag')
  .description('Tag sentences with parts of speech.')
  .option('--session <id>', 'session to tag; defaults to the only open session')
  .option('--sentence <id>', 'tag only this sentence, for example s1')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecTagFlags.safeParse(opts);
    if (!parsed.success) usage('spec.tag', opts, parsed.error);
    emit(tagSpec({ sessionId: parsed.data.session, sentenceId: parsed.data.sentence }, jsonSpecStore, compromiseTagger), parsed.data.json === true);
  }), {
  examples: ['clew spec tag --json'],
  exitCodes: specExits,
  notes: [jsonNote, sessionNote],
});

const sentences = spec.command('sentences').description('Add, edit, or delete spec sentences. Every write needs a reason.').helpCommand(false);

const revisionNote = 'Every write records --by (default agent), --reason, and optional --finding and --comment in the sentence history.';

setManual(sentences
  .command('add')
  .description('Add a sentence that the spec file does not have.')
  .option('--text <sentence>', 'one sentence of plain English')
  .option('--after <id>', 'place it after this sentence; defaults to the end')
  .option('--reason <text>', 'why the sentence is added')
  .option('--finding <id>', 'finding this write answers')
  .option('--comment <text>', 'free-text note kept in history')
  .option('--by <name>', 'who writes it; defaults to agent')
  .option('--session <id>', 'session to edit; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecSentenceAddFlags.safeParse(opts);
    if (!parsed.success) usage('spec.sentences.add', opts, parsed.error);
    emit(editSentence({ action: 'add', sessionId: parsed.data.session, ...revisionFields(parsed.data), text: parsed.data.text, after: parsed.data.after }, jsonSpecStore, compromiseTagger, specTextSource), parsed.data.json === true);
  }), {
  examples: ['clew spec sentences add --text "The clerk files the form." --after s2 --reason "missing step" --json'],
  exitCodes: specExits,
  notes: [revisionNote, jsonNote, sessionNote],
});

setManual(sentences
  .command('edit')
  .description('Replace the latest text of a sentence and rebuild what was derived from it.')
  .option('--id <id>', 'sentence to edit')
  .option('--text <sentence>', 'one sentence of plain English')
  .option('--reason <text>', 'why the text changes')
  .option('--finding <id>', 'finding this write answers')
  .option('--comment <text>', 'free-text note kept in history')
  .option('--by <name>', 'who writes it; defaults to agent')
  .option('--session <id>', 'session to edit; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecSentenceEditFlags.safeParse(opts);
    if (!parsed.success) usage('spec.sentences.edit', opts, parsed.error);
    emit(editSentence({ action: 'edit', sessionId: parsed.data.session, ...revisionFields(parsed.data), id: parsed.data.id, text: parsed.data.text }, jsonSpecStore, compromiseTagger, specTextSource), parsed.data.json === true);
  }), {
  examples: ['clew spec sentences edit --id s3 --text "The clerk files the form." --reason "the verb was wrong" --json'],
  exitCodes: specExits,
  notes: [revisionNote, jsonNote, sessionNote],
});

setManual(sentences
  .command('delete')
  .description('Delete a sentence. It stays as a tombstone and its id is never reused.')
  .option('--id <id>', 'sentence to delete')
  .option('--reason <text>', 'why the sentence goes')
  .option('--finding <id>', 'finding this write answers')
  .option('--comment <text>', 'free-text note kept in history')
  .option('--by <name>', 'who writes it; defaults to agent')
  .option('--session <id>', 'session to edit; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecSentenceDeleteFlags.safeParse(opts);
    if (!parsed.success) usage('spec.sentences.delete', opts, parsed.error);
    emit(editSentence({ action: 'delete', sessionId: parsed.data.session, ...revisionFields(parsed.data), id: parsed.data.id }, jsonSpecStore, compromiseTagger, specTextSource), parsed.data.json === true);
  }), {
  examples: ['clew spec sentences delete --id s4 --reason "duplicate of s2" --json'],
  exitCodes: specExits,
  notes: [revisionNote, jsonNote, sessionNote],
});

setManual(spec
  .command('export')
  .description('Write the original or the latest sentences as Markdown.')
  .option('--version <version>', 'original or latest; defaults to latest')
  .option('--out <file>', 'Markdown file to write')
  .option('--dry-run', 'print the Markdown in the JSON document and write nothing')
  .option('--session <id>', 'session to read; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecExportFlags.safeParse(opts);
    if (!parsed.success) usage('spec.export', opts, parsed.error);
    emit(exportSpec({ sessionId: parsed.data.session, version: parsed.data.version, out: parsed.data.out }, jsonSpecStore, specTextSink), parsed.data.json === true);
  }), {
  examples: ['clew spec export --version latest --out spec.md --json'],
  exitCodes: specExits,
  notes: ['Each sentence is its own paragraph under its section headings, so clew spec init reads the export back as the same sentences.', jsonNote, sessionNote],
});

const spans = spec.command('spans').description('Live span partition: lexicon merge and conflict check.').helpCommand(false);

setManual(spans
  .command('merge')
  .description('Merge live spans from a lexicon, or interactively with operator tags/concept link.')
  .option('--lexicon <file>', 'JSON lexicon for deterministic multi-word merges')
  .option('--force-auto', 'allow lexicon merge to absorb explicitlySet spans')
  .option('--id <spanId>', 'live span to merge (repeatable, interactive)', collectFlow, [] as string[])
  .option('--tags <tag>', 'operator tags for interactive merge (repeatable)', collectFlow, [] as string[])
  .option('--entity <id>', 'explicit concept link for interactive merge, for example concept:order')
  .option('--link <none>', 'explicit no-concept link for interactive merge (pass none)')
  .option('--session <id>', 'session to edit; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecSpansMergeFlags.safeParse(opts);
    if (!parsed.success) usage('spec.spans.merge', opts, parsed.error);
    if (parsed.data.lexicon !== undefined) {
      const lexicon = loadSpanLexicon(parsed.data.lexicon);
      if (!lexicon.ok) {
        emit({
          exit: 'invalid',
          document: {
            command: 'spec.spans.merge',
            ok: false,
            fault: 'unreadable',
            findings: [],
            issues: [{ kind: 'input', path: '', message: lexicon.message, file: parsed.data.lexicon }],
          },
        }, parsed.data.json === true);
        return;
      }
      emit(mergeSpans({
        mode: 'lexicon',
        sessionId: parsed.data.session,
        lexiconPath: parsed.data.lexicon,
        lexicon: lexicon.entries,
        forceAuto: parsed.data.forceAuto === true,
      }, jsonSpecStore), parsed.data.json === true);
      return;
    }
    const tags = parsed.data.tags !== undefined && parsed.data.tags.length > 0 ? parsed.data.tags : undefined;
    emit(mergeSpans({
      mode: 'interactive',
      sessionId: parsed.data.session,
      spanIds: parsed.data.id ?? [],
      tags,
      entityId: parsed.data.link === 'none' ? null : parsed.data.entity,
    }, jsonSpecStore), parsed.data.json === true);
  }), {
  examples: [
    'clew spec spans merge --lexicon tests/fixtures/specs/span-lexicon.json --json',
    'clew spec spans merge --id sp:s1.t2..s1.t2 --id sp:s1.t3..s1.t3 --tags Noun --json',
  ],
  exitCodes: specExits,
  notes: [jsonNote, sessionNote],
});

setManual(spans
  .command('check')
  .description('List unresolved tag-conflict and multi-entity span windows (read-only).')
  .option('--lexicon <file>', 'JSON lexicon used to find candidate windows')
  .option('--session <id>', 'session to read; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecSpansCheckFlags.safeParse(opts);
    if (!parsed.success) usage('spec.spans.check', opts, parsed.error);
    const lexicon = loadSpanLexicon(parsed.data.lexicon);
    if (!lexicon.ok) {
      emit({
        exit: 'invalid',
        document: {
          command: 'spec.spans.check',
          ok: false,
          fault: 'unreadable',
          findings: [],
          issues: [{ kind: 'input', path: '', message: lexicon.message, file: parsed.data.lexicon }],
        },
      }, parsed.data.json === true);
      return;
    }
    emit(checkSpans({
      sessionId: parsed.data.session,
      lexicon: lexicon.entries,
      lexiconPath: parsed.data.lexicon,
    }, jsonSpecStore), parsed.data.json === true);
  }), {
  examples: ['clew spec spans check --lexicon tests/fixtures/specs/span-lexicon.json --json'],
  exitCodes: specExits,
  notes: [jsonNote, sessionNote],
});

const concepts = spec.command('concepts').description('Group spans that name the same thing.').helpCommand(false);

setManual(concepts
  .command('list')
  .description('Derive concepts from the live spans, link each span to its concept, and list them.')
  .option('--session <id>', 'session to edit; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecSessionFlags.safeParse(opts);
    if (!parsed.success) usage('spec.concepts.list', opts, parsed.error);
    emit(listConcepts({ sessionId: parsed.data.session }, jsonSpecStore), parsed.data.json === true);
  }), {
  examples: ['clew spec concepts list --json'],
  exitCodes: specExits,
  notes: ['A run with no change writes nothing and adds no history line.', jsonNote, sessionNote],
});

const refineNote = 'Every write records --by (default agent), --reason, and optional --finding and --comment in the record history. A write that changes nothing is exit 2.';
const dropNote = 'A later spec sentences add, edit, or delete that changes a sentence cited by --depends-on drops the write: latest falls back to the derived value and status reports refinement-dropped.';

setManual(concepts
  .command('group')
  .description('Move one span into another concept, a new concept, or none. Frames are re-derived after.')
  .option('--span <id>', 'live significant span, for example sp:s1.t2..s1.t2')
  .option('--into <concept>', 'existing concept id, or concept:<word> to start a new one')
  .option('--none', 'link the span to no concept')
  .option('--depends-on <span>', 'span that evidences the grouping (repeatable); defaults to --span', collectFlow, [] as string[])
  .option('--reason <text>', 'why the span moves')
  .option('--finding <id>', 'finding this write answers')
  .option('--comment <text>', 'free-text note kept in history')
  .option('--by <name>', 'who writes it; defaults to agent')
  .option('--session <id>', 'session to edit; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecConceptsGroupFlags.safeParse(opts);
    if (!parsed.success) usage('spec.concepts.group', opts, parsed.error);
    const flags = parsed.data;
    emit(groupConcept({
      sessionId: flags.session,
      ...revisionFields(flags),
      span: flags.span,
      into: flags.none === true ? null : flags.into ?? null,
      dependsOn: flags.dependsOn !== undefined && flags.dependsOn.length > 0 ? flags.dependsOn : undefined,
    }, jsonSpecStore), flags.json === true);
  }), {
  examples: [
    'clew spec concepts group --span sp:s2.t2..s2.t2 --into concept:clerk --reason "same role as the clerk" --json',
    'clew spec concepts group --span sp:s1.t5..s1.t5 --none --reason "not a domain word" --json',
  ],
  exitCodes: specExits,
  notes: [refineNote, dropNote, jsonNote, sessionNote],
});

const frames = spec.command('frames').description('Read one clause frame per clause.').helpCommand(false);

setManual(frames
  .command('list')
  .description('Derive concepts when missing, then one frame per clause, and list them with what they compile to.')
  .option('--sentence <id>', 'only show frames of this sentence')
  .option('--session <id>', 'session to edit; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecFramesListFlags.safeParse(opts);
    if (!parsed.success) usage('spec.frames.list', opts, parsed.error);
    emit(listFrames({ sessionId: parsed.data.session, sentenceId: parsed.data.sentence }, jsonSpecStore), parsed.data.json === true);
  }), {
  examples: ['clew spec frames list --json', 'clew spec frames list --sentence s2 --json'],
  exitCodes: specExits,
  notes: ['--sentence filters the document only; every frame is still derived and stored.', 'Findings frame-missing-event, frame-missing-object, frame-missing-result, and value-never-assigned are warnings.', jsonNote, sessionNote],
});

setManual(frames
  .command('set')
  .description('Set one role of one frame from live concepts, spans, or frames.')
  .option('--frame <id>', 'frame to refine, for example fr:s1.t7')
  .option('--role <role>', 'actor, event, object, result, or when')
  .option('--value <ref>', 'concept id (actor, object, result), content-verb span id (event), or frame id (when, repeatable)', collectFlow, [] as string[])
  .option('--unknown', 'set the role to unknown')
  .option('--depends-on <span>', 'live span that evidences the value (repeatable; may be in another sentence)', collectFlow, [] as string[])
  .option('--reason <text>', 'why the role changes')
  .option('--finding <id>', 'finding this write answers')
  .option('--comment <text>', 'free-text note kept in history')
  .option('--by <name>', 'who writes it; defaults to agent')
  .option('--session <id>', 'session to edit; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecFramesSetFlags.safeParse(opts);
    if (!parsed.success) usage('spec.frames.set', opts, parsed.error);
    const flags = parsed.data;
    emit(setFrameRole({
      sessionId: flags.session,
      ...revisionFields(flags),
      frame: flags.frame,
      role: flags.role,
      value: flags.unknown === true ? 'unknown' : flags.value ?? [],
      dependsOn: flags.dependsOn !== undefined && flags.dependsOn.length > 0 ? flags.dependsOn : undefined,
    }, jsonSpecStore), flags.json === true);
  }), {
  examples: [
    'clew spec frames set --frame fr:s1.t7 --role actor --value concept:clerk --reason "the clerk approves" --json',
    'clew spec frames set --frame fr:s2.t1 --role when --value fr:s1.t1 --depends-on sp:s1.t4..s1.t4 --reason "waits on the submit" --json',
  ],
  exitCodes: specExits,
  notes: [
    'The text is read from the refs: the concept canonical, the span lemma, or the cited clauses joined with " and ".',
    '--depends-on defaults to the evidence of the value: the concept members in this sentence (else all members), the event span, or each cited frame\'s event or lead span.',
    refineNote,
    dropNote,
    jsonNote,
    sessionNote,
  ],
});

setManual(frames
  .command('not-transition')
  .description('Mark a frame as not a transition with a reason, or clear that mark.')
  .option('--frame <id>', 'frame to mark, for example fr:s1.t12')
  .option('--clear', 'drop the mark; the frame falls back to its derived value')
  .option('--reason <text>', 'why the frame is not a transition, or why the mark goes')
  .option('--finding <id>', 'finding this write answers')
  .option('--comment <text>', 'free-text note kept in history')
  .option('--by <name>', 'who writes it; defaults to agent')
  .option('--session <id>', 'session to edit; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecFramesNotTransitionFlags.safeParse(opts);
    if (!parsed.success) usage('spec.frames.not-transition', opts, parsed.error);
    const flags = parsed.data;
    emit(markNotTransition({ sessionId: flags.session, ...revisionFields(flags), frame: flags.frame, clear: flags.clear === true }, jsonSpecStore), flags.json === true);
  }), {
  examples: [
    'clew spec frames not-transition --frame fr:s1.t7 --reason "describes a policy, not a step" --json',
    'clew spec frames not-transition --frame fr:s1.t7 --clear --reason "it is a step after all" --json',
  ],
  exitCodes: specExits,
  notes: ['A cleared frame falls back to its derived value: a verbless clause stays no verb.', 'An edit of the frame\'s sentence drops the mark.', refineNote, jsonNote, sessionNote],
});

const graph = spec.command('graph').description('Assemble a draft graph and choose named paths.').helpCommand(false);

setManual(graph
  .command('build')
  .description('Assemble states and transitions from the compiled frames, and propose one path per transition.')
  .option('--session <id>', 'session to read; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecSessionFlags.safeParse(opts);
    if (!parsed.success) usage('spec.graph.build', opts, parsed.error);
    emit(buildSpecGraph({ sessionId: parsed.data.session }, jsonSpecStore), parsed.data.json === true);
  }), {
  examples: ['clew spec graph build --json'],
  exitCodes: specExits,
  notes: [jsonNote, sessionNote],
});

setManual(graph
  .command('split')
  .description('Split one accepted path into two. --at is the first edge of the second path.')
  .option('--id <id>', 'flow to split, for example W1')
  .option('--at <edge>', '1-based edge number or frame id, for example 2 or fr:s2.t1')
  .option('--from <file>', 'JSON { "id": "W1", "at": "fr:s2.t1" }')
  .option('--session <id>', 'session to edit; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecGraphSplitFlags.safeParse(opts);
    if (!parsed.success) usage('spec.graph.split', opts, parsed.error);
    const flags = parsed.data;
    if (flags.from !== undefined) {
      const loaded = loadSplitPatch(flags.from);
      if (!loaded.ok) usage('spec.graph.split', opts, new z.ZodError([{ code: 'custom', message: loaded.message, path: ['from'] }]));
      emit(editGraph({ action: 'split', sessionId: flags.session, id: loaded.id, at: loaded.at }, jsonSpecStore), flags.json === true);
    }
    if (flags.id === undefined || flags.at === undefined) usage('spec.graph.split', opts, new z.ZodError([{ code: 'custom', message: 'split needs --id and --at', path: ['id'] }]));
    emit(editGraph({ action: 'split', sessionId: flags.session, id: flags.id, at: flags.at }, jsonSpecStore), flags.json === true);
  }), {
  examples: ['clew spec graph split --id W1 --at fr:s2.t1 --json'],
  exitCodes: specExits,
  notes: [jsonNote, sessionNote],
});

setManual(graph
  .command('group')
  .description('Join accepted paths into one linear workflow.')
  .option('--id <id>', 'flow to join, in walk order (repeatable)', collectFlow, [] as string[])
  .option('--transition <id>', 'transition to join, in walk order (repeatable)', collectFlow, [] as string[])
  .option('--title <text>', 'title of the grouped path')
  .option('--into <id>', 'flow id to keep')
  .option('--from <file>', 'JSON { "ids": ["W1", "W2"], "title": "..." } or { "transitions": ["fr:s1.t1", "fr:s2.t1"] }')
  .option('--session <id>', 'session to edit; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecGraphGroupFlags.safeParse(opts);
    if (!parsed.success) usage('spec.graph.group', opts, parsed.error);
    const flags = parsed.data;
    if (flags.from !== undefined) {
      const loaded = loadGroupPatch(flags.from);
      if (!loaded.ok) usage('spec.graph.group', opts, new z.ZodError([{ code: 'custom', message: loaded.message, path: ['from'] }]));
      emit(editGraph({ action: 'group', sessionId: flags.session, ...loaded.request }, jsonSpecStore), flags.json === true);
    }
    emit(editGraph({
      action: 'group',
      sessionId: flags.session,
      flowIds: flags.id,
      transitionIds: flags.transition,
      title: flags.title,
      into: flags.into,
    }, jsonSpecStore), flags.json === true);
  }), {
  examples: ['clew spec graph group --id W1 --id W2 --title "Submit and approve an order" --json'],
  exitCodes: specExits,
  notes: [jsonNote, sessionNote],
});

setManual(spec
  .command('emit')
  .description('Write the chosen paths as a workflow set, and optionally the unfolded spec.')
  .option('--dry-run', 'print the YAML and check it without writing a file')
  .option('--out <file>', 'write the workflow set to this file')
  .option('--chart <file>', 'write the unfolded spec as clew.spec.v1 YAML')
  .option('--force', 'write even when blocking findings remain, and list them')
  .option('--session <id>', 'session to read; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecEmitFlags.safeParse(opts);
    if (!parsed.success) usage('spec.emit', opts, parsed.error);
    const flags = parsed.data;
    emit(emitSpec({
      sessionId: flags.session,
      dryRun: flags.dryRun === true,
      out: flags.out,
      chart: flags.chart,
      force: flags.force === true,
    }, jsonSpecStore, yamlWorkflowWriter, yamlSpecWriter), flags.json === true);
  }), {
  examples: [
    'clew spec emit --dry-run --json',
    'clew spec emit --out flows.yaml --chart spec.yaml --json',
  ],
  exitCodes: specExits,
  notes: [jsonNote, sessionNote, '--force writes the file while blocking findings remain and lists them. --chart writes the same Spec that verify replays.'],
});

const tla = spec.command('tla').description('Draft a TLA+ model from the frames, and check a model against them.').helpCommand(false);

setManual(tla
  .command('scaffold')
  .description('Draft a TLA+ module from the frames: one action per transition frame, grouped under one action per event.')
  .option('--dry-run', 'print the module in the document without writing a file')
  .option('--out <file>', 'write the module to this .tla file, and a TLC config beside it')
  .option('--force', 'replace an existing module and config')
  .option('--session <id>', 'session to read; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecTlaScaffoldFlags.safeParse(opts);
    if (!parsed.success) usage('spec.tla.scaffold', opts, parsed.error);
    const flags = parsed.data;
    emit(scaffoldTla({ sessionId: flags.session, dryRun: flags.dryRun === true, out: flags.out, force: flags.force === true }, jsonSpecStore, tlaTextFiles), flags.json === true);
  }), {
  examples: [
    'clew spec tla scaffold --dry-run --json',
    'clew spec tla scaffold --out Order.tla --json',
  ],
  exitCodes: [
    { code: 0, meaning: 'the scaffold was drafted, and written when --out was given' },
    { code: 2, meaning: 'the file exists, the name is not a TLA+ module name, no frame compiles, or there is no spec session' },
  ],
  notes: [
    'The scaffold is a starting point, not a strict mapping. Edit the module freely; keep the @frame comment on every definition that models a frame.',
    'The module is named after the file. An existing module is never replaced without --force, and an existing .cfg is kept.',
    'Clew does not run TLC. Check the model with the TLA+ tools, and its link to the frames with clew spec tla check.',
    jsonNote,
    sessionNote,
  ],
});

setManual(tla
  .command('check')
  .description('Line a TLA+ module up against the frames through its @frame comments.')
  .argument('<module>', 'TLA+ module file')
  .option('--session <id>', 'session to read; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((file, opts) => {
    const parsed = SpecSessionFlags.safeParse(opts);
    if (!parsed.success) usage('spec.tla.check', opts, parsed.error);
    if (file.trim() === '' || file === '-') usage('spec.tla.check', opts, new z.ZodError([{ code: 'custom', message: 'check reads a .tla file; Clew never reads stdin', path: ['module'] }]));
    emit(checkTla({ sessionId: parsed.data.session, file }, jsonSpecStore, tlaTextFiles), parsed.data.json === true);
  }), {
  examples: ['clew spec tla check Order.tla --json'],
  exitCodes: specExits,
  notes: [
    'A comment `\\* @frame fr:s1.t7 5d1c0f3a` above a definition says the definition models that frame as it was at that digest. Several comments may sit on one definition, and one frame may be cited by several definitions.',
    '`\\* @frame fr:s3.t7 5d1c0f3a skip: <reason>` leaves a frame out on purpose.',
    'Each row puts what the frame compiles to beside the text of the definitions that cite it. Clew does not prove they agree; it reports frames with no definition, frames that changed since, and comments that cite no frame.',
    'check reads the session and the file. It writes neither.',
    jsonNote,
    sessionNote,
  ],
});

setManual(spec
  .command('trace')
  .description('Follow an id back to frames, concepts, tokens, and the sentence.')
  .argument('<id>', 'concept, frame, transition, token, sentence, flow, or state id')
  .option('--session <id>', 'session to read; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((id, opts) => {
    const parsed = SpecSessionFlags.safeParse(opts);
    if (!parsed.success) usage('spec.trace', opts, parsed.error);
    if (id.trim() === '') usage('spec.trace', opts, new z.ZodError([{ code: 'custom', message: 'trace needs an id', path: ['id'] }]));
    emit(traceSpec({ sessionId: parsed.data.session, id }, jsonSpecStore), parsed.data.json === true);
  }), {
  examples: ['clew spec trace concept:customer --json'],
  exitCodes: specExits,
  notes: [jsonNote, sessionNote],
});

setManual(spec
  .command('impact')
  .description('List the fields and groupings that an edit of one sentence would drop, and its frames (read-only).')
  .argument('<sentence>', 'sentence id, for example s1')
  .option('--session <id>', 'session to read; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((sentence, opts) => {
    const parsed = SpecSessionFlags.safeParse(opts);
    if (!parsed.success) usage('spec.impact', opts, parsed.error);
    const id = z.string().regex(SPEC_SENTENCE_ID_PATTERN, SPEC_SENTENCE_ID_MESSAGE).safeParse(sentence);
    if (!id.success) usage('spec.impact', opts, id.error);
    emit(readSpecImpact({ sessionId: parsed.data.session, sentenceId: id.data }, jsonSpecStore), parsed.data.json === true);
  }), {
  examples: ['clew spec impact s1 --json'],
  exitCodes: specExits,
  notes: ['Each entry is a field or a grouping whose latest dependsOn cites a span of the sentence; refined is true when an agent or human wrote it last.', 'impact reads the session and does not write the store or history.jsonl.', jsonNote, sessionNote],
});

setManual(spec
  .command('status')
  .description('Show sentence coverage and the findings still open on each layer.')
  .option('--session <id>', 'session to read; defaults to the only open session')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = SpecSessionFlags.safeParse(opts);
    if (!parsed.success) usage('spec.status', opts, parsed.error);
    emit(readSpecStatus({ sessionId: parsed.data.session }, jsonSpecStore), parsed.data.json === true);
  }), {
  examples: ['clew spec status --json'],
  exitCodes: specExits,
  notes: [jsonNote, sessionNote],
});

const showExits = [
  { code: 0 as const, meaning: 'the requested layer has been written, including an empty list' },
  { code: 2 as const, meaning: 'the layer has not been written, the session is missing or locked, or the arguments are wrong' },
];

const SHOW_HELP: Record<SpecShowLayer, { description: string; example: string }> = {
  sentences: {
    description: 'Print every sentence with its section and the workflows that cite it.',
    example: 'clew spec show sentences --json',
  },
  spans: {
    description: 'Print the live spans with their tags and sentence id.',
    example: 'clew spec show spans --json',
  },
  tagged: {
    description: 'Print the tagged sentences.',
    example: 'clew spec show tagged --json',
  },
  tokens: {
    description: 'Print unique tokens and their tag readings.',
    example: 'clew spec show tokens --json',
  },
  concepts: {
    description: 'Print stored concepts with their member spans.',
    example: 'clew spec show concepts --json',
  },
  frames: {
    description: 'Print stored clause frames with what they compile to.',
    example: 'clew spec show frames --json',
  },
};

const show = spec.command('show').description('Print one stored spec layer without writing the session.').helpCommand(false);

for (const layer of SPEC_SHOW_LAYERS) {
  const help = SHOW_HELP[layer];
  setManual(show
    .command(layer)
    .description(help.description)
    .option('--session <id>', 'session to read; defaults to the only open session')
    .option('--json', 'print the result document as JSON on stdout')
    .action((opts) => {
      const parsed = SpecSessionFlags.safeParse(opts);
      if (!parsed.success) usage(`spec.show.${layer}`, opts, parsed.error);
      emit(showSpec({ layer, sessionId: parsed.data.session }, jsonSpecStore), parsed.data.json === true);
    }), {
    examples: [help.example],
    exitCodes: showExits,
    notes: [jsonNote, sessionNote, 'spec show reads the session and does not write the store or history.jsonl.'],
  });
}

const SpecViewFlags = z.object({
  json: z.boolean().optional(),
  open: z.boolean().optional(),
});

setManual(spec
  .command('view')
  .description('Install the HTML inspector for one spec session.')
  .argument('<session-id>', 'session to inspect')
  .option('--open', 'serve the session folder on localhost and open it in a browser')
  .option('--json', 'print the result document as JSON on stdout')
  .action(async (sessionId, opts) => {
    const parsed = SpecViewFlags.safeParse(opts);
    if (!parsed.success) usage('spec.view', opts, parsed.error);
    const parsedId = z.string().regex(SPEC_SESSION_ID_PATTERN, SPEC_SESSION_ID_MESSAGE).safeParse(sessionId);
    if (!parsedId.success) usage('spec.view', opts, parsedId.error);
    const flags = parsed.data;
    const outcome = viewSpecSession({ id: parsedId.data }, jsonSpecStore, jsonSpecSessionViewer);
    if (outcome.exit !== 'pass' || !outcome.document.ok || outcome.document.sessionDir === undefined) {
      emit(outcome, flags.json === true);
    }
    if (flags.open === true) {
      let server;
      try {
        server = await serveSessionViewer(outcome.document.sessionDir);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({
          exit: 'invalid',
          document: {
            command: 'spec.view',
            ok: false,
            fault: 'unreadable',
            findings: [],
            issues: [{ kind: 'input', path: '', message }],
          },
        }, flags.json === true);
      }
      outcome.document.url = server.url;
      const opened = openViewerUrl(server.url);
      if (!opened.ok) {
        await server.close();
        emit({
          exit: 'invalid',
          document: {
            command: 'spec.view',
            ok: false,
            fault: 'unreadable',
            findings: [],
            issues: [{ kind: 'input', path: '', message: opened.message }],
          },
        }, flags.json === true);
      }
      if (flags.json === true) console.log(JSON.stringify(outcome.document, null, 2));
      else console.log(humanSummary(outcome.document));
      await waitForInterrupt();
      await server.close();
      process.exit(EXIT_PASS);
    }
    emit(outcome, flags.json === true);
  }), {
  examples: [
    'clew spec view order --json',
    'clew spec view order --open',
  ],
  exitCodes: [
    { code: 0, meaning: 'the viewer was written, and with --open the local server ran until interrupt' },
    { code: 2, meaning: 'the session is unknown or unsafe, the viewer could not be written, or the arguments are wrong' },
  ],
  notes: [
    jsonNote,
    'spec view writes viewer.html under the session folder and does not change domain JSON or history.jsonl.',
    'Browsers block fetch() of sibling JSON from a file:// page, so --open serves the session on 127.0.0.1 and reloads pick up the latest files.',
    'An unknown id or an unsafe id is exit 2.',
  ],
});

const session = spec.command('session').description('List or delete spec sessions.').helpCommand(false);

setManual(session
  .command('list')
  .description('List spec sessions.')
  .option('--json', 'print the result document as JSON on stdout')
  .action((opts) => {
    const parsed = JsonFlag.safeParse(opts);
    if (!parsed.success) usage('spec.session.list', opts, parsed.error);
    emit(listSpecSessions(jsonSpecStore), parsed.data.json === true);
  }), {
  examples: ['clew spec session list --json'],
  exitCodes: [
    { code: 0, meaning: 'the sessions were listed' },
    { code: 2, meaning: 'the arguments are wrong' },
  ],
  notes: [jsonNote, 'List reads every session and does not change the store. An empty list is exit 0.'],
});

setManual(session
  .command('remove')
  .description('Delete one spec session.')
  .argument('<id>', 'session to delete')
  .option('--json', 'print the result document as JSON on stdout')
  .action((id, opts) => {
    const parsed = JsonFlag.safeParse(opts);
    if (!parsed.success) usage('spec.session.remove', opts, parsed.error);
    const parsedId = z.string().regex(SPEC_SESSION_ID_PATTERN, SPEC_SESSION_ID_MESSAGE).safeParse(id);
    if (!parsedId.success) usage('spec.session.remove', opts, parsedId.error);
    emit(removeSpecSession({ id: parsedId.data }, jsonSpecStore), parsed.data.json === true);
  }), {
  examples: ['clew spec session remove order --json'],
  exitCodes: [
    { code: 0, meaning: 'the session was deleted' },
    { code: 2, meaning: 'the id is unknown or unsafe, a live lock is held, or the arguments are wrong' },
  ],
  notes: [jsonNote, 'An unknown id, an unsafe id, or a live lock is exit 2. A live lock leaves the session directory in place.'],
});

setManual(program
  .command('help')
  .description('Print the long help for a command.')
  .argument('[command...]', 'command and subcommand names')
  .action((parts: string[]) => {
    const parsed = HelpPath.safeParse(parts ?? []);
    if (!parsed.success) usage('help', {}, parsed.error);
    if (parsed.data.length === 0) {
      process.stdout.write(listCommands(program));
      process.exit(EXIT_PASS);
    }
    const command = findCommand(program, parsed.data);
    if (command === undefined) {
      console.error(`unknown command: ${parsed.data.join(' ')}`);
      process.exit(EXIT_INVALID);
    }
    process.stdout.write(fullHelp(command));
    process.exit(EXIT_PASS);
  }), {
  examples: [
    'clew help',
    'clew help spec frames list',
  ],
  exitCodes: [
    { code: 0, meaning: 'the help text was written' },
    { code: 2, meaning: 'the command is unknown or the arguments are wrong' },
  ],
  notes: [
    '-h and --help print usage, the description, arguments, options, and subcommands.',
    'With no command, this lists every command. With a command path, it adds examples, exit codes, and notes.',
  ],
});

async function main(): Promise<void> {
  assertManuals(program);
  const argv = process.argv.slice();
  if (argv[2] === 'self-update') argv[2] = 'upgrade';
  await program.parseAsync(argv);
}

main().catch((error: unknown) => {
  if (error instanceof CommanderError) process.exit(error.exitCode === 0 ? EXIT_PASS : EXIT_INVALID);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(EXIT_INVALID);
});
