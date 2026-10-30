import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DIAGRAM_JSON_FILE, DIAGRAM_VIEWER_FILE } from '../../src/adapters/diagram/interactive/diagram-page.js';
import { installDiagramViewer } from '../../src/adapters/diagram/interactive/diagram-viewer.js';
import { INTERACTIVE_GRAPH_ASSET_FILES } from '../../src/adapters/diagram/interactive/types.js';
import type { DiagramViewDocument } from '../../src/application/documents.js';
import { viewChart, viewWorkflows } from '../../src/application/view-diagram.js';
import { yamlModelLoader } from '../../src/adapters/yaml/model-loader.js';
import { yamlWorkflowLoader } from '../../src/adapters/yaml/workflow-loader.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const chartFile = join(root, 'examples/todo/b-full.yaml');
const workflowsFile = join(root, 'examples/todo/workflows.yaml');

const createdDirs: string[] = [];

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

describe('chart view / workflows view', () => {
  test('viewChart builds interactive chart elements without a session', () => {
    const outcome = viewChart({ chartFile }, yamlModelLoader, yamlWorkflowLoader);
    assert.equal(outcome.exit, 'pass');
    assert.equal(outcome.document.command, 'chart.view');
    assert.equal(outcome.document.ok, true);
    assert.equal(outcome.document.charts.length, 1);
    assert.equal(outcome.document.workflows.length, 0);
    const chart = outcome.document.charts[0]!;
    assert.ok(chart.interactive.elements.some((el) => el.group === 'nodes'));
    assert.ok(chart.interactive.elements.some((el) => el.group === 'edges'));
    assert.ok(Object.keys(chart.interactive.details).length > 0);
  });

  test('viewChart --workflows combines chart and workflow panels', () => {
    const outcome = viewChart(
      { chartFile, workflowsFile },
      yamlModelLoader,
      yamlWorkflowLoader,
    );
    assert.equal(outcome.exit, 'pass');
    assert.equal(outcome.document.charts.length, 1);
    assert.ok(outcome.document.workflows.length >= 1);
    const flow = outcome.document.workflows[0]!;
    assert.ok(flow.interactive.elements.some((el) => el.group === 'nodes'));
    assert.ok(Object.values(flow.interactive.details).some((detail) => detail.kind === 'step'));
  });

  test('viewWorkflows alone uses workflow node states as labels', () => {
    const outcome = viewWorkflows({ workflowsFile }, yamlModelLoader, yamlWorkflowLoader);
    assert.equal(outcome.exit, 'pass');
    assert.equal(outcome.document.command, 'workflows.view');
    assert.equal(outcome.document.charts.length, 0);
    assert.ok(outcome.document.workflows.length >= 1);
    assert.ok(outcome.document.workflows.every((flow) => flow.interactive.kind === 'workflow'));
  });

  test('viewWorkflows --chart includes the chart panel', () => {
    const outcome = viewWorkflows(
      { workflowsFile, chartFile },
      yamlModelLoader,
      yamlWorkflowLoader,
    );
    assert.equal(outcome.exit, 'pass');
    assert.equal(outcome.document.charts.length, 1);
    assert.ok(outcome.document.workflows.length >= 1);
  });

  test('installDiagramViewer writes HTML, diagram.json, and Cytoscape assets', () => {
    const outcome = viewChart({ chartFile }, yamlModelLoader, yamlWorkflowLoader);
    assert.equal(outcome.exit, 'pass');
    const installed = installDiagramViewer(outcome.document);
    assert.equal(installed.ok, true);
    if (!installed.ok) return;
    createdDirs.push(installed.viewDir);
    assert.equal(existsSync(installed.htmlPath), true);
    assert.equal(existsSync(join(installed.viewDir, DIAGRAM_JSON_FILE)), true);
    for (const name of INTERACTIVE_GRAPH_ASSET_FILES) {
      assert.equal(existsSync(join(installed.viewDir, name)), true, name);
    }
    const html = readFileSync(installed.htmlPath, 'utf8');
    assert.match(html, /ClewInteractiveGraph/);
    assert.match(html, /diagram\.json/);
    assert.match(html, /cytoscape\.min\.js/);
    const payload = JSON.parse(readFileSync(join(installed.viewDir, DIAGRAM_JSON_FILE), 'utf8')) as {
      charts: unknown[];
      workflows: unknown[];
    };
    assert.equal(payload.charts.length, 1);
  });

  test('CLI chart view and workflows view write the viewer and print help', () => {
    const chartView = clew(['chart', 'view', chartFile, '--json']);
    assert.equal(chartView.status, 0, chartView.stderr);
    const chartDoc = JSON.parse(chartView.stdout) as DiagramViewDocument;
    assert.equal(chartDoc.command, 'chart.view');
    assert.equal(chartDoc.ok, true);
    assert.equal(chartDoc.mode, 'standalone');
    assert.ok(chartDoc.htmlPath?.endsWith(DIAGRAM_VIEWER_FILE));
    assert.ok(chartDoc.viewDir);
    if (chartDoc.viewDir) createdDirs.push(chartDoc.viewDir);
    assert.equal(existsSync(chartDoc.htmlPath ?? ''), true);
    assert.equal(chartDoc.charts.length, 1);
    assert.equal(chartDoc.url, undefined);

    const combined = clew([
      'chart', 'view', chartFile,
      '--workflows', workflowsFile,
      '--json',
    ]);
    assert.equal(combined.status, 0, combined.stderr);
    const combinedDoc = JSON.parse(combined.stdout) as DiagramViewDocument;
    assert.ok(combinedDoc.workflows.length >= 1);
    if (combinedDoc.viewDir) createdDirs.push(combinedDoc.viewDir);

    const workflowsView = clew(['workflows', 'view', workflowsFile, '--json']);
    assert.equal(workflowsView.status, 0, workflowsView.stderr);
    const workflowsDoc = JSON.parse(workflowsView.stdout) as DiagramViewDocument;
    assert.equal(workflowsDoc.command, 'workflows.view');
    assert.ok(workflowsDoc.workflows.length >= 1);
    if (workflowsDoc.viewDir) createdDirs.push(workflowsDoc.viewDir);

    const withChart = clew([
      'workflows', 'view', workflowsFile,
      '--chart', chartFile,
      '--json',
    ]);
    assert.equal(withChart.status, 0, withChart.stderr);
    const withChartDoc = JSON.parse(withChart.stdout) as DiagramViewDocument;
    assert.equal(withChartDoc.charts.length, 1);
    if (withChartDoc.viewDir) createdDirs.push(withChartDoc.viewDir);

    const missing = clew(['chart', 'view', join(root, 'nope.yaml'), '--json']);
    assert.equal(missing.status, 2);
    const missingDoc = JSON.parse(missing.stdout) as DiagramViewDocument;
    assert.equal(missingDoc.ok, false);
    assert.equal(missingDoc.fault, 'unreadable');

    const helpChart = clew(['help', 'chart', 'view']);
    assert.equal(helpChart.status, 0);
    assert.match(helpChart.stdout, /clew chart view examples\/todo\/b-full\.yaml --open/);
    assert.match(helpChart.stdout, /--workflows/);

    const helpWorkflows = clew(['help', 'workflows', 'view']);
    assert.equal(helpWorkflows.status, 0);
    assert.match(helpWorkflows.stdout, /clew workflows view examples\/todo\/workflows\.yaml --open/);
    assert.match(helpWorkflows.stdout, /--chart/);
  });
});

function clew(args: string[]) {
  return spawnSync(tsx, ['src/cli.ts', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CLEW_OPEN_BROWSER: '0' },
  });
}
