// Ports the use cases need. Adapters implement these; the use cases do not import adapters.
import type { CanonLexicon, ParseOutput } from '../domain/canon-ast.js';
import type { Model } from '../domain/model.js';
import type { Spec, SpecDraft } from '../domain/spec-model.js';
import type { BuildInfo } from '../domain/upgrade.js';
import type { PosTagging, SpecHistoryEntry, SpecSnapshot } from '../domain/spec.js';
import type { Milestone } from '../domain/spec-versions.js';
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

export interface SpecLoader {
  load(file: string): FileLoad<Spec>;
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

/** Draws one draft chart or one draft workflow chain as SVG. Failures throw. */
export interface GraphImageRenderer {
  chartSvg(model: Model, title: string): string;
  chainSvg(model: Model, title: string, result: WorkflowResult): string;
}

export interface DiagramRenderer {
  render(model: Model, name: string, results: readonly WorkflowResult[], passed: number, outDir: string, highlight: string | undefined): void;
  writeHeatmap(model: Model, candidate: string, workflowCount: number, coverage: readonly TransitionCoverage[], outDir: string): string;
  writeReplays(model: Model, results: readonly WorkflowResult[], outDir: string): ReplayFile[];
}

export interface VerifyPorts {
  specs: SpecLoader;
  models: ModelLoader;
  workflows: WorkflowSetLoader;
  selections: SelectionLoader;
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

export interface SpecTextSink {
  write(file: string, text: string): { ok: true } | { ok: false; message: string };
}

export interface SessionRef {
  id: string;
}

/** Live sentences, transition frames, and flows. Deleted sentences are omitted. */
export interface SpecSessionCounts {
  sentences: number;
  frames: number;
  flows: number;
}

export interface SpecSessionSummary extends SessionRef {
  updated: string;
  summary: SpecSessionCounts;
}

export interface SpecMutation {
  snapshot: SpecSnapshot;
  history?: SpecHistoryEntry | SpecHistoryEntry[];
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

export interface WorkflowSetWriter {
  render(draft: WorkflowSetDraft): string;
  write(file: string, yaml: string): { ok: true } | { ok: false; message: string };
}

export interface SpecWriter {
  render(draft: SpecDraft): string;
  write(file: string, yaml: string): { ok: true } | { ok: false; message: string };
}

/** Reads and writes a TLA+ module (or its TLC config) as text. Clew never runs TLC. */
export interface TextFiles {
  exists(file: string): boolean;
  read(file: string): { ok: true; text: string } | { ok: false; message: string };
  write(file: string, text: string): { ok: true } | { ok: false; message: string };
}

export type Fetched<T> = { ok: true; value: T } | { ok: false; message: string };

export interface ReleaseAsset {
  name: string;
  url: string;
  sha256?: string;
}

export interface Release {
  tag: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
}

export interface EdgeRelease {
  commit: string;
  release: Release;
}

export type InstallLocation =
  | { kind: 'global'; build: BuildInfo; prefix: string; writable: boolean }
  | { kind: 'other'; build: BuildInfo; reason: string };

export interface UpgradePorts {
  install: { locate(): InstallLocation };
  releases: {
    list(): Promise<Fetched<Release[]>>;
    edge(): Promise<Fetched<EdgeRelease>>;
    direct(tag: string): Release;
  };
  files: {
    makeTempDir(): string;
    removeDir(dir: string): void;
    fetchText(url: string): Promise<Fetched<string>>;
    download(url: string, file: string): Promise<Fetched<void>>;
    sha256(file: string): Promise<string>;
    inspect(tarball: string): Fetched<BuildInfo>;
  };
  npm: {
    install(tarball: string, prefix: string): Promise<Fetched<void>>;
    installedVersion(prefix: string): Fetched<string>;
  };
  provenance: { verify(tarball: string): Promise<Fetched<void>> };
}

/** Reads one sentence against the canonical grammar. Rules above the grammar are the domain's. */
export interface CanonParser {
  parse(text: string): ParseOutput;
}

/** Builds a parser for one lexicon: declared actors, terms, states, and verbs are tokens of their own. */
export interface CanonParserFactory {
  readonly name: string;
  forLexicon(lexicon: CanonLexicon): CanonParser;
}

/** What the canonical pipeline keeps in a session, beside the sentences. */
export interface CanonState {
  schemaVersion: 1;
  lexicon: CanonLexicon;
  /** Every lexicon write and every accepted draft, with who and why. */
  history: CanonHistoryEntry[];
}

export interface CanonHistoryEntry {
  at: string;
  who: string;
  reason: string;
  action: 'lexicon' | 'accept' | 'merge';
  sentence?: string;
  from?: string;
  to?: string;
  notes?: string[];
  dropped?: string[];
  descriptive?: string;
  merged?: string[];
}

export interface CanonStore {
  read(session: string): { ok: true; state: CanonState | undefined } | { ok: false; message: string };
  write(session: string, state: CanonState): { ok: true } | { ok: false; message: string };
}

/** A session as a milestone froze it: the sentence layers and, when the session had one, the canonical lexicon. */
export interface FrozenVersion {
  snapshot: SpecSnapshot;
  canon: CanonState | undefined;
}

/** The session at the moment a milestone is closed, read under the session lock. */
export interface SessionNow extends FrozenVersion {
  history: SpecHistoryEntry[];
  milestones: Milestone[];
}

export type MilestoneFault = 'missing' | 'locked' | 'schema' | 'unreadable';
export type MilestoneRead<T> = ({ ok: true } & T) | { ok: false; fault: MilestoneFault; message: string };

/** Milestones over a session's history, each with a frozen copy of the session files it closed on. */
export interface MilestoneStore {
  list(session: string): MilestoneRead<{ milestones: Milestone[] }>;
  read(session: string, id: string): MilestoneRead<{ frozen: FrozenVersion }>;
  /** The session's history.jsonl, oldest line first. */
  log(session: string): MilestoneRead<{ history: SpecHistoryEntry[] }>;
  /**
   * Hold the session lock, read the session, and let `build` write the record. When `build` returns a milestone, its
   * record is appended to the list and the session files are frozen beside it; a refusal writes nothing.
   */
  close(
    session: string,
    build: (now: SessionNow) => { ok: true; milestone: Milestone } | { ok: false; message: string },
  ): MilestoneRead<{ milestone: Milestone }> | { ok: false; fault: 'refused'; message: string };
}
