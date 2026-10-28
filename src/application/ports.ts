// Ports the use cases need. Adapters implement these; the use cases do not import adapters.
import type { Model } from '../domain/model.js';
import type { PosTagging, SpecHistoryEntry, SpecSnapshot } from '../domain/spec.js';
import type { Traversal } from '../domain/traversal.js';
import type { TransitionCoverage, WorkflowResult } from '../domain/verification.js';
import type { WorkflowSet, WorkflowSetDraft } from '../domain/workflow.js';
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

export interface ReplayFile {
  id: string;
  file: string;
  frames: number;
}

export interface DiagramRenderer {
  render(model: Model, name: string, results: readonly WorkflowResult[], passed: number, outDir: string, highlight: string | undefined): void;
  writeHeatmap(model: Model, candidate: string, workflowCount: number, coverage: readonly TransitionCoverage[], outDir: string): string;
  writeReplays(model: Model, results: readonly WorkflowResult[], outDir: string): ReplayFile[];
}

export interface VerifyPorts {
  models: ModelLoader;
  workflows: WorkflowSetLoader;
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

/** Live sentences, facts, and flows. Stale sentences, stale facts, and removed facts are omitted. */
export interface SpecSessionCounts {
  sentences: number;
  facts: number;
  flows: number;
}

/** A `listSessions` row. `id` and `specPath` stay what that listing already returned. */
export interface SpecSessionSummary extends SessionRef {
  updated: string;
  summary: SpecSessionCounts;
}

export interface SpecMutation {
  snapshot: SpecSnapshot;
  history?: SpecHistoryEntry;
}

export type SpecStoreResult =
  | { ok: true; snapshot: SpecSnapshot }
  | { ok: false; fault: 'missing' | 'schema' | 'locked' | 'unreadable'; message: string };

export type SpecRemovalResult =
  | { ok: true }
  | { ok: false; fault: 'missing' | 'locked' | 'unreadable'; message: string };

export interface SpecStore {
  listSessions(): SpecSessionSummary[];
  removeSession(id: string): SpecRemovalResult;
  update(
    id: string,
    options: { create: boolean },
    mutate: (current: SpecSnapshot | undefined) => SpecMutation | undefined,
  ): SpecStoreResult;
}

/** Install the stable HTML inspector into a session folder. Does not change domain JSON. */
export type SpecViewerInstallResult =
  | { ok: true; session: string; htmlPath: string; sessionDir: string }
  | { ok: false; fault: 'missing' | 'unreadable'; message: string };

export interface SpecSessionViewer {
  install(id: string): SpecViewerInstallResult;
}

export interface PosTaggerPort {
  readonly name: string;
  readonly version: string;
  tag(text: string): PosTagging;
}

/** One compromise phrase/chunk/pattern hit. Pilot surface; not the production token layer. */
export interface PhraseUnit {
  text: string;
  kind: 'noun' | 'verb' | 'adjective' | 'person' | 'chunk' | 'pattern';
  words: number;
}

export interface PhraseExtraction {
  units: PhraseUnit[];
  clauses: string[];
}

/** Optional custom lexicon entries for compromise `nlp.plugin({ words })`. */
export type PhraseLexicon = Readonly<Record<string, string>>;

/**
 * Phrase-level view of a sentence. Optional pilot path beside PosTaggerPort.
 * Production `spec tag` still uses word tokens from PosTaggerPort.
 */
export interface PhraseExtractorPort {
  readonly name: string;
  readonly version: string;
  extract(text: string): PhraseExtraction;
}

export interface WorkflowSetWriter {
  render(draft: WorkflowSetDraft): string;
  write(file: string, yaml: string): { ok: true } | { ok: false; message: string };
}
