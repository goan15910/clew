// Use case: draw the session draft graph for the inspector. Domain JSON stays read-only.
import { draftChains, draftCharts, draftLabelModel } from '../domain/spec-graph-view.js';
import { toWorkflowSetDraft } from '../domain/spec-graph.js';
import type { DraftGraphImageDocument } from './documents.js';
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
  const charts: DraftGraphImageDocument['charts'] = [];
  const workflows: DraftGraphImageDocument['workflows'] = [];
  try {
    for (const chart of draftCharts(graph)) {
      charts.push({ object: chart.object, svg: images.chartSvg(chart.model, chart.object) });
    }
    const labels = draftLabelModel(graph);
    for (const flow of built.draft === undefined ? [] : draftChains(built.draft)) {
      workflows.push({
        id: flow.id,
        title: flow.title,
        expect: flow.expect === 'rejected' ? 'rejected' : 'accepted',
        svg: images.chainSvg(labels, '', flow),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { session: snapshot.id, charts, workflows, findings: built.findings, error: message };
  }
  return { session: snapshot.id, charts, workflows, findings: built.findings };
}
