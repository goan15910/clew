// Ports the use cases need. Adapters implement these; the use cases do not import adapters.
import type { Mapping } from '../domain/mapping.js';
import type { Model } from '../domain/model.js';
import type { PosTagging, SpecHistoryEntry, SpecSnapshot } from '../domain/spec.js';
import type { Traversal } from '../domain/traversal.js';
import type { WorkflowResult } from '../domain/verification.js';
import type { WorkflowSet } from '../domain/workflow.js';
import type { CompareDocument, LocatedError, ParsedVerifyResult, VerifyDocument } from './documents.js';

export type FileLoad<T> =
  | { ok: true; value: T }
  | { ok: false; fault: 'unreadable' | 'schema' | 'graph'; errors: LocatedError[] };

export interface ModelLoader {
  load(file: string): FileLoad<Model>;
}

export interface WorkflowSetLoader {
  load(file: string): FileLoad<WorkflowSet>;
}

export interface MappingLoader {
  load(file: string): FileLoad<Mapping>;
}

export interface SelectionLoader {
  load(file: string): { ok: true; flows: readonly string[] } | { ok: false; errors: LocatedError[] };
}

export interface VerifyResultLoader {
  load(file: string): { ok: true; result: ParsedVerifyResult } | { ok: false; errors: LocatedError[] };
}

export interface TraversalEngine {
  open(model: Model): Traversal;
}

export interface ReportWriter {
  writeVerification(document: VerifyDocument, model: Model, outDir: string): void;
  writeComparison(document: CompareDocument, outDir: string): void;
}

export interface DiagramRenderer {
  render(model: Model, name: string, results: readonly WorkflowResult[], passed: number, outDir: string, highlight: string | undefined): void;
}

export interface VerifyPorts {
  models: ModelLoader;
  workflows: WorkflowSetLoader;
  mappings: MappingLoader;
  selections: SelectionLoader;
  engine: TraversalEngine;
  reports: ReportWriter;
  diagrams: DiagramRenderer;
}

export interface ComparePorts {
  results: VerifyResultLoader;
  reports: ReportWriter;
}

export interface SpecText {
  text: string;
  path: string;
  hash: string;
}

export interface SpecTextSource {
  read(file: string): { ok: true; spec: SpecText } | { ok: false; message: string };
  hash(text: string): string;
}

export interface SessionRef {
  id: string;
  specPath: string;
}

export interface SpecMutation {
  snapshot: SpecSnapshot;
  history?: SpecHistoryEntry;
}

export type SpecStoreResult =
  | { ok: true; snapshot: SpecSnapshot }
  | { ok: false; fault: 'missing' | 'schema' | 'locked' | 'unreadable'; message: string };

export interface SpecStore {
  listSessions(): SessionRef[];
  update(
    id: string,
    options: { create: boolean },
    mutate: (current: SpecSnapshot | undefined) => SpecMutation | undefined,
  ): SpecStoreResult;
}

export interface PosTaggerPort {
  readonly name: string;
  readonly version: string;
  tag(text: string): PosTagging;
}
