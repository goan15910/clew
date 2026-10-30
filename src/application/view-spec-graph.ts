// Use case: draw the session draft graph for the inspector. Domain JSON stays read-only.
import { draftChains, draftCharts, draftLabelModel } from '../domain/spec-graph-view.js';
import { toWorkflowSetDraft } from '../domain/spec-graph.js';
import type { DraftGraphChartImage, DraftGraphImageDocument, DraftGraphWorkflowImage } from './documents.js';
import { chartInteractive, workflowInteractive } from './interactive-graph.js';
import type { GraphImageRenderer, SpecStore } from './ports.js';

export interface ViewSpecGraphCommand {
  id: string;
}

export const NO_GRAPH_MESSAGE = 'no graph; run clew spec graph build';

export function viewSpecGraph(
  command: ViewSpecGraphCommand,
  store: SpecStore,
  images: GraphImageRenderer,
): DraftGraphImageDocument {
  const result = store.update(command.id, { create: false }, () => undefined);
  if (!result.ok) {
    return { session: command.id, charts: [], workflows: [], findings: [], error: result.message };
  }
  const snapshot = result.snapshot;
  if (snapshot.graph === undefined) {
    return { session: snapshot.id, charts: [], workflows: [], findings: [], message: NO_GRAPH_MESSAGE };
  }
  const graph = snapshot.graph;
  const built = toWorkflowSetDraft(
    graph,
    snapshot.entities ?? [],
    snapshot.facts ?? [],
    snapshot.sentences,
    snapshot.tagged,
  );
  const charts: DraftGraphChartImage[] = [];
  const workflows: DraftGraphWorkflowImage[] = [];
  const svgErrors: string[] = [];
  for (const chart of draftCharts(graph)) {
    const interactive = chartInteractive(chart.model, chart.object, snapshot);
    let svg: string | undefined;
    try {
      svg = images.chartSvg(chart.model, chart.object);
    } catch (error) {
      svgErrors.push(error instanceof Error ? error.message : String(error));
    }
    charts.push({ object: chart.object, svg, interactive });
  }
  const labels = draftLabelModel(graph);
  for (const flow of built.draft === undefined ? [] : draftChains(built.draft)) {
    const interactive = workflowInteractive(labels, flow, snapshot);
    let svg: string | undefined;
    try {
      svg = images.chainSvg(labels, '', flow);
    } catch (error) {
      svgErrors.push(error instanceof Error ? error.message : String(error));
    }
    workflows.push({
      id: flow.id,
      title: flow.title,
      expect: flow.expect === 'rejected' ? 'rejected' : 'accepted',
      svg,
      interactive,
    });
  }
  const document: DraftGraphImageDocument = {
    session: snapshot.id,
    charts,
    workflows,
    findings: built.findings,
  };
  if (svgErrors.length > 0) document.error = svgErrors[0];
  return document;
}
