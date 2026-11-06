// Read-only provenance and coverage over a spec session.
import type { Concept, Finding, Frame, GraphTransition, LiveSpan, Sentence, SpecFlow, SpecSnapshot, TaggedSentence, Token } from './spec.js';
import { initFindings, liveSentences, sentenceFindings as reinitFindings, sentenceState, tagFindings } from './spec.js';
import { compileFrames } from './spec-compile.js';
import { findConcept } from './spec-concepts.js';
import { ROLE_NAMES } from './spec-frames.js';
import { graphLayerFindings } from './spec-graph.js';
import { clauseFindings, clauseReach, type ClauseReach } from './spec-kernel.js';
import { refinementFindings } from './spec-refine.js';

export interface TraceLink {
  layer: 'state' | 'transition' | 'flow' | 'frame' | 'concept' | 'token' | 'sentence';
  id: string;
  type?: string;
  kind?: string;
  name?: string;
  text?: string;
  status?: string;
  origin?: string;
  tags?: string[];
  span?: [number, number];
  section?: string;
  refs?: string[];
}

export interface TraceResult {
  links: TraceLink[];
  findings: Finding[];
}

export interface StatusCoverage {
  sentences: { mapped: string[]; pending: string[]; deleted: string[] };
  concepts: number;
  frames: { transition: number; notTransition: number; incomplete: number };
}

export interface StatusResult {
  coverage: StatusCoverage;
  layers: { tokens: boolean; concepts: boolean; frames: boolean; graph: boolean };
  findingsByLayer: { sentences: Finding[]; tokens: Finding[]; concepts: Finding[]; frames: Finding[]; graph: Finding[] };
  findings: Finding[];
  clauses: ClauseReach[];
}

export function traceItem(snapshot: SpecSnapshot, id: string): TraceResult | undefined {
  const concept = findConcept(snapshot.concepts ?? [], id);
  if (concept !== undefined) return finish(traceConcept(snapshot, concept));
  const transition = findTransition(snapshot, id);
  if (transition !== undefined) {
    const links: TraceLink[] = [transitionLink(transition)];
    for (const frame of framesById(snapshot, transition.frames)) {
      for (const link of traceFrame(snapshot, frame)) links.push(link);
    }
    return finish(links);
  }
  const frame = findFrame(snapshot.frames ?? [], id);
  if (frame !== undefined) return finish(traceFrame(snapshot, frame));
  const token = findToken(snapshot, id);
  if (token !== undefined) return finish([tokenLink(token.token), sentenceLink(token.sentence)]);
  const sentence = findSentence(snapshot.sentences, id);
  if (sentence !== undefined) return finish(traceSentence(snapshot, sentence));
  const flow = findFlow(snapshot, id);
  if (flow !== undefined) return finish(traceFlow(snapshot, flow));
  const stateFrames = framesForState(snapshot, id);
  if (stateFrames.length > 0) {
    const links: TraceLink[] = [{ layer: 'state', id, refs: stateFrames.map((item) => item.id) }];
    for (const item of stateFrames) {
      for (const link of traceFrame(snapshot, item)) links.push(link);
    }
    return finish(links);
  }
  return undefined;
}

export function specStatus(snapshot: SpecSnapshot): StatusResult {
  const compiled = compileFrames(snapshot.frames ?? [], snapshot.concepts ?? []);
  const sentences = sentenceFindings(snapshot);
  const tokens = tokenFindings(snapshot);
  const concepts = snapshot.concepts === undefined ? [absentOne('concepts')] : [];
  const clauses = snapshot.frames === undefined ? [] : clauseReach(compiled.compiled);
  const frames = snapshot.frames === undefined
    ? [absentOne('frames')]
    : [...compiled.findings, ...refinementFindings(snapshot.frames, snapshot.groups ?? []), ...clauseFindings(clauses, snapshot.frames)];
  const graph = graphLayerFindings(compiled.compiled, snapshot.graph);
  return {
    coverage: coverageOf(snapshot, new Set([...compiled.compiled.items.map((item) => item.id), ...Object.keys(compiled.restated)])),
    layers: {
      tokens: hasTokens(snapshot),
      concepts: snapshot.concepts !== undefined,
      frames: snapshot.frames !== undefined,
      graph: snapshot.graph !== undefined,
    },
    findingsByLayer: { sentences, tokens, concepts, frames, graph },
    findings: [...sentences, ...tokens, ...concepts, ...frames, ...graph],
    clauses,
  };
}

/** Flows that cite each sentence through their transitions' frames or their forbidden frame. */
export function sentenceWorkflows(snapshot: SpecSnapshot): Map<string, SpecFlow[]> {
  const frames = new Map<string, Frame>();
  for (const frame of snapshot.frames ?? []) frames.set(frame.id, frame);
  const transitions = new Map<string, GraphTransition>();
  for (const transition of snapshot.graph?.transitions ?? []) transitions.set(transition.id, transition);
  const bySentence = new Map<string, SpecFlow[]>();
  for (const flow of snapshot.graph?.flows ?? []) {
    const frameIds: string[] = [];
    for (const id of flow.transitions) {
      const transition = transitions.get(id);
      if (transition !== undefined) frameIds.push(transition.frame, ...transition.frames);
    }
    if (flow.forbidden !== undefined) frameIds.push(flow.forbidden);
    const sentences = new Set<string>();
    for (const frameId of frameIds) {
      const sentence = frames.get(frameId)?.sentence;
      if (sentence !== undefined) sentences.add(sentence);
    }
    for (const sentence of sentences) {
      const list = bySentence.get(sentence) ?? [];
      list.push(flow);
      bySentence.set(sentence, list);
    }
  }
  return bySentence;
}

function traceFrame(snapshot: SpecSnapshot, frame: Frame): TraceLink[] {
  const links: TraceLink[] = [frameLink(frame)];
  const seenConcepts = new Set<string>();
  for (const name of ['actor', 'object', 'result'] as const) {
    const value = frame.roles[name].latest.value;
    if (value === 'unknown') continue;
    for (const ref of value.refs) {
      const concept = findConcept(snapshot.concepts ?? [], ref);
      if (concept === undefined || seenConcepts.has(concept.id)) continue;
      seenConcepts.add(concept.id);
      links.push(conceptLink(concept));
    }
  }
  const seenTokens = new Set<string>();
  const seenSentences = new Set<string>();
  for (const spanId of frameSpans(frame)) {
    const token = findToken(snapshot, spanId);
    if (token === undefined || seenTokens.has(token.token.id)) continue;
    seenTokens.add(token.token.id);
    links.push(tokenLink(token.token));
  }
  const own = findSentence(snapshot.sentences, frame.sentence);
  if (own !== undefined) {
    seenSentences.add(own.id);
    links.push(sentenceLink(own));
  }
  for (const spanId of frameSpans(frame)) {
    const token = findToken(snapshot, spanId);
    if (token === undefined || seenSentences.has(token.sentence.id)) continue;
    seenSentences.add(token.sentence.id);
    links.push(sentenceLink(token.sentence));
  }
  return links;
}

function traceConcept(snapshot: SpecSnapshot, concept: Concept): TraceLink[] {
  const links: TraceLink[] = [conceptLink(concept)];
  const seen = new Set<string>();
  for (const member of concept.members) {
    const token = findToken(snapshot, member);
    if (token === undefined) continue;
    links.push(tokenLink(token.token));
    if (seen.has(token.sentence.id)) continue;
    seen.add(token.sentence.id);
    links.push(sentenceLink(token.sentence));
  }
  return links;
}

/** Sentence → its frames → the transitions and flows built from them. */
function traceSentence(snapshot: SpecSnapshot, sentence: Sentence): TraceLink[] {
  const links: TraceLink[] = [sentenceLink(sentence)];
  const frameIds = new Set<string>();
  for (const frame of snapshot.frames ?? []) {
    if (frame.sentence !== sentence.id) continue;
    frameIds.add(frame.id);
    links.push(frameLink(frame));
  }
  const transitionIds = new Set<string>();
  for (const transition of snapshot.graph?.transitions ?? []) {
    if (!transition.frames.some((id) => frameIds.has(id))) continue;
    transitionIds.add(transition.id);
    links.push(transitionLink(transition));
  }
  for (const flow of snapshot.graph?.flows ?? []) {
    const cites = flow.transitions.some((id) => transitionIds.has(id)) || (flow.forbidden !== undefined && frameIds.has(flow.forbidden));
    if (cites) links.push(flowLink(flow));
  }
  return links;
}

function finish(links: TraceLink[]): TraceResult {
  const findings: Finding[] = [];
  if (!links.some((link) => link.layer === 'sentence')) {
    const id = links[0]?.id ?? 'item';
    findings.push({
      id: `orphan:${id}`,
      kind: 'coverage',
      code: 'orphan',
      severity: 'warning',
      message: `${id} has no sentence source`,
      refs: [id],
    });
  }
  return { links, findings };
}

function coverageOf(snapshot: SpecSnapshot, compiled: ReadonlySet<string>): StatusCoverage {
  const mappedSentences = new Set<string>();
  const frames = { transition: 0, notTransition: 0, incomplete: 0 };
  for (const frame of snapshot.frames ?? []) {
    if (compiled.has(frame.id)) mappedSentences.add(frame.sentence);
    if (frame.notTransition !== undefined) {
      frames.notTransition += 1;
      continue;
    }
    frames.transition += 1;
    if (!compiled.has(frame.id)) frames.incomplete += 1;
  }
  const mapped: string[] = [];
  const pending: string[] = [];
  const deleted: string[] = [];
  for (const sentence of snapshot.sentences) {
    if (sentence.latest === null) deleted.push(sentence.id);
    else if (mappedSentences.has(sentence.id)) mapped.push(sentence.id);
    else pending.push(sentence.id);
  }
  return { sentences: { mapped, pending, deleted }, concepts: snapshot.concepts?.length ?? 0, frames };
}

function sentenceFindings(snapshot: SpecSnapshot): Finding[] {
  return [...initFindings(snapshot.sentences, []), ...reinitFindings(snapshot.sentences)];
}

function tokenFindings(snapshot: SpecSnapshot): Finding[] {
  const findings: Finding[] = [];
  if (!hasTokens(snapshot)) {
    findings.push(absentOne('tokens'));
    return findings;
  }
  const text = new Map<string, string>();
  for (const sentence of liveSentences(snapshot.sentences)) text.set(sentence.id, sentence.text);
  for (const item of snapshot.tagged) {
    if (item.status !== 'current') continue;
    const sentence = text.get(item.id);
    if (sentence === undefined) continue;
    for (const finding of tagFindings(item.id, sentence, item.tokens, item.clauses)) findings.push(finding);
  }
  return findings;
}

function absentOne(layer: string): Finding {
  return {
    id: `${layer}-absent`,
    kind: 'coverage',
    code: `${layer}-absent`,
    severity: 'info',
    message: `the ${layer} layer has not been built`,
    refs: [],
  };
}

function hasTokens(snapshot: SpecSnapshot): boolean {
  for (const item of snapshot.tagged) {
    if (item.status === 'current' && item.tokens.length > 0) return true;
  }
  return false;
}

function framesForState(snapshot: SpecSnapshot, state: string): Frame[] {
  const ids: string[] = [];
  for (const item of snapshot.graph?.states ?? []) {
    if (item.id !== state) continue;
    for (const id of item.frames) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return framesById(snapshot, ids);
}

function frameSpans(frame: Frame): string[] {
  const ids: string[] = [];
  for (const name of ROLE_NAMES) {
    for (const id of frame.roles[name].latest.dependsOn) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function traceFlow(snapshot: SpecSnapshot, flow: SpecFlow): TraceLink[] {
  const links: TraceLink[] = [flowLink(flow)];
  for (const id of flow.transitions) {
    const transition = findTransition(snapshot, id);
    if (transition === undefined) continue;
    links.push(transitionLink(transition));
    for (const frame of framesById(snapshot, transition.frames)) {
      for (const link of traceFrame(snapshot, frame)) links.push(link);
    }
  }
  if (flow.forbidden !== undefined) {
    const frame = findFrame(snapshot.frames ?? [], flow.forbidden);
    if (frame !== undefined) {
      for (const link of traceFrame(snapshot, frame)) links.push(link);
    }
  }
  return links;
}

function flowLink(flow: SpecFlow): TraceLink {
  const link: TraceLink = {
    layer: 'flow',
    id: flow.id,
    type: flow.expect,
    name: flow.title,
    origin: flow.origin,
    refs: flow.transitions.slice(),
  };
  if (flow.forbidden !== undefined) link.refs = [...(link.refs ?? []), flow.forbidden];
  return link;
}

function transitionLink(transition: GraphTransition): TraceLink {
  return {
    layer: 'transition',
    id: transition.id,
    type: transition.event,
    name: transition.actor,
    text: `${transition.from} → ${transition.to}`,
    refs: transition.frames.slice(),
  };
}

function framesById(snapshot: SpecSnapshot, ids: readonly string[]): Frame[] {
  const frames: Frame[] = [];
  for (const id of ids) {
    const frame = findFrame(snapshot.frames ?? [], id);
    if (frame !== undefined) frames.push(frame);
  }
  return frames;
}

function findTransition(snapshot: SpecSnapshot, id: string): GraphTransition | undefined {
  for (const transition of snapshot.graph?.transitions ?? []) {
    if (transition.id === id) return transition;
  }
  return undefined;
}

function findFlow(snapshot: SpecSnapshot, id: string): SpecFlow | undefined {
  for (const flow of snapshot.graph?.flows ?? []) {
    if (flow.id === id) return flow;
  }
  return undefined;
}

function frameLink(frame: Frame): TraceLink {
  const type = frame.notTransition !== undefined ? 'not-transition' : frame.negated === true ? 'forbidden' : 'transition';
  const link: TraceLink = { layer: 'frame', id: frame.id, type, text: frame.clause.text, refs: frameSpans(frame) };
  const event = frame.roles.event.latest.value;
  if (event !== 'unknown') link.name = event.text;
  if (frame.marker !== undefined) link.kind = frame.marker;
  if (frame.notTransition !== undefined) link.status = frame.notTransition.reason;
  return link;
}

function conceptLink(concept: Concept): TraceLink {
  return { layer: 'concept', id: concept.id, name: concept.canonical, refs: concept.members.slice() };
}

function tokenLink(token: Token): TraceLink {
  return {
    layer: 'token',
    id: token.id,
    text: token.text,
    tags: token.tags.slice(),
    span: [token.span[0], token.span[1]],
    origin: token.origin,
    status: token.status,
  };
}

function sentenceLink(sentence: Sentence): TraceLink {
  const shown = sentence.latest ?? sentence.original;
  const link: TraceLink = { layer: 'sentence', id: sentence.id, status: sentenceState(sentence) };
  if (shown !== null) {
    link.text = shown.text;
    link.span = [shown.span[0], shown.span[1]];
    link.section = shown.section;
  }
  return link;
}

function findFrame(frames: readonly Frame[], id: string): Frame | undefined {
  for (const frame of frames) {
    if (frame.id === id) return frame;
  }
  return undefined;
}

function findSentence(sentences: readonly Sentence[], id: string): Sentence | undefined {
  for (const sentence of sentences) {
    if (sentence.id === id) return sentence;
  }
  return undefined;
}

export interface UniqueToken {
  text: string;
  count: number;
  forms: string[];
  readings: { tags: string[]; tokens: string[] }[];
}

function readingKey(tags: readonly string[]): string {
  return tags.slice().sort().join('\0');
}

export function uniqueTokens(sentences: readonly Sentence[], tagged: readonly TaggedSentence[]): UniqueToken[] {
  const byId = new Map<string, TaggedSentence>();
  for (const item of tagged) byId.set(item.id, item);
  const groups = new Map<string, { forms: string[]; seenForms: Set<string>; readings: Map<string, { tags: string[]; tokens: string[] }> }>();
  const order: string[] = [];
  for (const sentence of liveSentences(sentences)) {
    const item = byId.get(sentence.id);
    if (item === undefined || item.status !== 'current') continue;
    for (const token of item.tokens) {
      if (token.status !== 'current') continue;
      const key = token.text.toLowerCase();
      let group = groups.get(key);
      if (group === undefined) {
        group = { forms: [], seenForms: new Set(), readings: new Map() };
        groups.set(key, group);
        order.push(key);
      }
      if (!group.seenForms.has(token.text)) {
        group.seenForms.add(token.text);
        group.forms.push(token.text);
      }
      const keyForReading = readingKey(token.tags);
      let reading = group.readings.get(keyForReading);
      if (reading === undefined) {
        const tags: string[] = [];
        for (const tag of token.tags) tags.push(tag);
        reading = { tags, tokens: [] };
        group.readings.set(keyForReading, reading);
      }
      reading.tokens.push(token.id);
    }
  }
  const tokens: UniqueToken[] = [];
  for (const key of order) {
    const group = groups.get(key);
    if (group === undefined) continue;
    const forms: string[] = [];
    for (const form of group.forms) forms.push(form);
    const readings: UniqueToken['readings'] = [];
    let count = 0;
    for (const reading of group.readings.values()) {
      const tags: string[] = [];
      for (const tag of reading.tags) tags.push(tag);
      const ids: string[] = [];
      for (const id of reading.tokens) ids.push(id);
      readings.push({ tags, tokens: ids });
      count += ids.length;
    }
    tokens.push({ text: key, count, forms, readings });
  }
  return tokens;
}

function findToken(snapshot: SpecSnapshot, id: string): { token: Token; sentence: Sentence } | undefined {
  // Span sources resolve through the auto-promoted cover (first token of the live span).
  const span = findSpan(snapshot, id);
  const tokenId = span?.firstTokenId ?? id;
  for (const item of snapshot.tagged) {
    for (const token of item.tokens) {
      if (token.id !== tokenId) continue;
      const sentence = findSentence(snapshot.sentences, item.id);
      if (sentence === undefined) return undefined;
      return { token, sentence };
    }
  }
  return undefined;
}

function findSpan(snapshot: SpecSnapshot, id: string): LiveSpan | undefined {
  for (const span of snapshot.spans ?? []) {
    if (span.id === id) return span;
  }
  return undefined;
}
