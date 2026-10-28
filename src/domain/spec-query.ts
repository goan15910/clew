// Read-only provenance and coverage over a spec session.
import type { Entity, Fact, Finding, GraphTransition, Sentence, SpecFlow, SpecSnapshot, TaggedSentence, Token } from './spec.js';
import { currentSentences, initFindings, staleFindings, tagFindings } from './spec.js';
import { entityFindings } from './spec-entities.js';
import { contradictionFindings, visibleFacts } from './spec-facts.js';
import { graphLayerFindings } from './spec-graph.js';

export interface TraceLink {
  layer: 'state' | 'transition' | 'flow' | 'fact' | 'entity' | 'token' | 'sentence';
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
  sentences: { mapped: string[]; pending: string[]; stale: string[] };
  entities: { candidate: number; confirmed: number; rejected: number; stale: number };
  facts: { current: number; stale: number; implied: number; removed: number };
}

export interface StatusResult {
  coverage: StatusCoverage;
  layers: { tokens: boolean; entities: boolean; facts: boolean; graph: boolean };
  findingsByLayer: { sentences: Finding[]; tokens: Finding[]; entities: Finding[]; facts: Finding[]; graph: Finding[] };
  findings: Finding[];
}

export function traceItem(snapshot: SpecSnapshot, id: string): TraceResult | undefined {
  const entity = findEntity(snapshot.entities ?? [], id);
  if (entity !== undefined) return finish(traceEntity(snapshot, entity));
  const fact = findFact(snapshot.facts ?? [], id);
  if (fact !== undefined) return finish(traceFact(snapshot, fact));
  const token = findToken(snapshot, id);
  if (token !== undefined) return finish([tokenLink(token.token), sentenceLink(token.sentence)]);
  const sentence = findSentence(snapshot.sentences, id);
  if (sentence !== undefined) return finish([sentenceLink(sentence)]);
  const transition = findTransition(snapshot, id);
  if (transition !== undefined) {
    const links: TraceLink[] = [transitionLink(transition)];
    for (const fact of factsById(snapshot, transition.facts)) {
      for (const link of traceFact(snapshot, fact)) links.push(link);
    }
    return finish(links);
  }
  const flow = findFlow(snapshot, id);
  if (flow !== undefined) return finish(traceFlow(snapshot, flow));
  const stateFacts = factsForState(snapshot.facts ?? [], id);
  if (stateFacts.length > 0) {
    const links: TraceLink[] = [{ layer: 'state', id, refs: stateFacts.map((fact) => fact.id) }];
    for (const fact of stateFacts) {
      for (const link of traceFact(snapshot, fact)) links.push(link);
    }
    return finish(links);
  }
  return undefined;
}

export function specStatus(snapshot: SpecSnapshot): StatusResult {
  const sentences = sentenceFindings(snapshot);
  const tokens = tokenFindings(snapshot);
  const entities = snapshot.entities === undefined ? absent('entities') : entityLayerFindings(snapshot);
  const facts = snapshot.facts === undefined ? absent('facts') : factLayerFindings(snapshot);
  const graph = graphLayerFindings(snapshot);
  const findings = [...sentences, ...tokens, ...entities, ...facts, ...graph];
  return {
    coverage: coverageOf(snapshot),
    layers: {
      tokens: hasTokens(snapshot),
      entities: snapshot.entities !== undefined,
      facts: snapshot.facts !== undefined,
      graph: snapshot.graph !== undefined,
    },
    findingsByLayer: { sentences, tokens, entities, facts, graph },
    findings,
  };
}

function traceFact(snapshot: SpecSnapshot, fact: Fact): TraceLink[] {
  const links: TraceLink[] = [factLink(fact)];
  for (const ref of [fact.actor, fact.action, fact.object, fact.condition]) {
    if (ref === undefined) continue;
    const entity = findEntity(snapshot.entities ?? [], ref);
    if (entity !== undefined) links.push(entityLink(entity));
  }
  const seenTokens = new Set<string>();
  const seenSentences = new Set<string>();
  for (const source of fact.sources) {
    const token = findToken(snapshot, source);
    if (token !== undefined && !seenTokens.has(token.token.id)) {
      seenTokens.add(token.token.id);
      links.push(tokenLink(token.token));
    }
    const sentence = findSentence(snapshot.sentences, source) ?? token?.sentence;
    if (sentence !== undefined && !seenSentences.has(sentence.id)) {
      seenSentences.add(sentence.id);
      links.push(sentenceLink(sentence));
    }
  }
  for (const ref of [fact.actor, fact.action, fact.object, fact.condition]) {
    if (ref === undefined) continue;
    const entity = findEntity(snapshot.entities ?? [], ref);
    if (entity === undefined) continue;
    for (const source of entity.sources) {
      const token = findToken(snapshot, source);
      if (token === undefined || seenTokens.has(token.token.id)) continue;
      seenTokens.add(token.token.id);
      links.push(tokenLink(token.token));
      if (!seenSentences.has(token.sentence.id)) {
        seenSentences.add(token.sentence.id);
        links.push(sentenceLink(token.sentence));
      }
    }
  }
  return links;
}

function traceEntity(snapshot: SpecSnapshot, entity: Entity): TraceLink[] {
  const links: TraceLink[] = [entityLink(entity)];
  const seen = new Set<string>();
  for (const source of entity.sources) {
    const token = findToken(snapshot, source);
    if (token === undefined) continue;
    links.push(tokenLink(token.token));
    if (seen.has(token.sentence.id)) continue;
    seen.add(token.sentence.id);
    links.push(sentenceLink(token.sentence));
  }
  return links;
}

function finish(links: TraceLink[]): TraceResult {
  const findings: Finding[] = [];
  let sentence = false;
  for (const link of links) {
    if (link.layer === 'sentence') sentence = true;
  }
  const head = links[0];
  const impliedFact = head?.layer === 'fact' && (head.refs === undefined || head.refs.length === 0);
  if (impliedFact || !sentence) {
    const id = head?.id ?? 'item';
    findings.push({
      id: `orphan:${id}`,
      kind: 'coverage',
      code: 'orphan',
      severity: 'warning',
      message: `${id} has no sentence source`,
      refs: [id],
    });
  }
  const fact = links[0];
  if (fact?.layer === 'fact' && fact.status === 'removed') {
    findings.push({
      id: `removed:${fact.id}`,
      kind: 'stale',
      code: 'removed-fact',
      severity: 'info',
      message: `${fact.id} was removed`,
      refs: [fact.id],
    });
  }
  return { links, findings };
}

function coverageOf(snapshot: SpecSnapshot): StatusCoverage {
  const facts = visibleFacts(snapshot.facts ?? []).filter((fact) => fact.status === 'current');
  const mapped: string[] = [];
  const pending: string[] = [];
  const stale: string[] = [];
  for (const sentence of snapshot.sentences) {
    if (sentence.status === 'stale') {
      stale.push(sentence.id);
      continue;
    }
    if (sentenceIsMapped(sentence, snapshot.tagged, facts)) mapped.push(sentence.id);
    else pending.push(sentence.id);
  }
  const entities = { candidate: 0, confirmed: 0, rejected: 0, stale: 0 };
  for (const entity of snapshot.entities ?? []) entities[entity.status] += 1;
  let current = 0;
  let staleFacts = 0;
  let implied = 0;
  let removed = 0;
  for (const fact of snapshot.facts ?? []) {
    if (fact.removed === true) {
      removed += 1;
      continue;
    }
    if (fact.status === 'stale') staleFacts += 1;
    else current += 1;
    if (fact.status === 'current' && fact.sources.length === 0) implied += 1;
  }
  return { sentences: { mapped, pending, stale }, entities, facts: { current, stale: staleFacts, implied, removed } };
}

function sentenceIsMapped(sentence: Sentence, tagged: readonly TaggedSentence[], facts: readonly Fact[]): boolean {
  const tokens = new Set<string>();
  for (const item of tagged) {
    if (item.id !== sentence.id) continue;
    for (const token of item.tokens) tokens.add(token.id);
  }
  for (const fact of facts) {
    if (fact.sources.includes(sentence.id)) return true;
    for (const source of fact.sources) {
      if (tokens.has(source)) return true;
    }
  }
  return false;
}

function sentenceFindings(snapshot: SpecSnapshot): Finding[] {
  return [...initFindings(snapshot.sentences, []), ...staleFindings(snapshot.sentences)];
}

function tokenFindings(snapshot: SpecSnapshot): Finding[] {
  const findings: Finding[] = [];
  if (!hasTokens(snapshot)) {
    findings.push(absentOne('tokens'));
    return findings;
  }
  const text = new Map<string, string>();
  for (const sentence of snapshot.sentences) text.set(sentence.id, sentence.text);
  for (const item of snapshot.tagged) {
    if (item.status !== 'current') continue;
    const sentence = text.get(item.id);
    if (sentence === undefined) continue;
    for (const finding of tagFindings(item.id, sentence, item.tokens, item.clauses)) findings.push(finding);
  }
  return findings;
}

function entityLayerFindings(snapshot: SpecSnapshot): Finding[] {
  const findings: Finding[] = [];
  for (const entity of snapshot.entities ?? []) {
    if (entity.status !== 'stale') continue;
    findings.push({
      id: `stale:${entity.id}`,
      kind: 'stale',
      code: 'stale-entity',
      severity: 'warning',
      message: `${entity.id} is stale`,
      refs: [entity.id],
    });
  }
  for (const finding of entityFindings(snapshot.entities ?? [])) findings.push(finding);
  return findings;
}

function factLayerFindings(snapshot: SpecSnapshot): Finding[] {
  const findings: Finding[] = [];
  for (const fact of visibleFacts(snapshot.facts ?? [])) {
    if (fact.status === 'stale') {
      findings.push({
        id: `stale:${fact.id}`,
        kind: 'stale',
        code: 'stale-fact',
        severity: 'warning',
        message: `${fact.id} is stale`,
        refs: [fact.id],
      });
    }
    if (fact.status === 'current' && fact.type === 'transition' && (fact.from === null || fact.from === undefined)) {
      findings.push({
        id: `transition-without-from:${fact.id}`,
        kind: 'gap',
        code: 'transition-without-from',
        severity: 'warning',
        message: `${fact.id} has no source state`,
        refs: [fact.id, ...fact.sources],
      });
    }
    if (fact.status === 'current' && fact.sources.length === 0) {
      findings.push({
        id: `orphan:${fact.id}`,
        kind: 'coverage',
        code: 'orphan',
        severity: 'warning',
        message: `${fact.id} has no sentence source`,
        refs: [fact.id],
      });
    }
  }
  for (const finding of contradictionFindings(snapshot.facts ?? [])) findings.push(finding);
  return findings;
}

function absent(layer: string): Finding[] {
  return [absentOne(layer)];
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

function factsForState(facts: readonly Fact[], state: string): Fact[] {
  const matched: Fact[] = [];
  for (const fact of facts) {
    if (fact.removed === true) continue;
    if (fact.from === state || fact.to === state || fact.state === state) matched.push(fact);
  }
  return matched;
}

function traceFlow(snapshot: SpecSnapshot, flow: SpecFlow): TraceLink[] {
  const links: TraceLink[] = [flowLink(flow)];
  for (const id of flow.transitions) {
    const transition = findTransition(snapshot, id);
    if (transition === undefined) continue;
    links.push(transitionLink(transition));
    for (const fact of factsById(snapshot, transition.facts)) {
      for (const link of traceFact(snapshot, fact)) links.push(link);
    }
  }
  if (flow.forbidden !== undefined) {
    const fact = findFact(snapshot.facts ?? [], flow.forbidden);
    if (fact !== undefined) {
      for (const link of traceFact(snapshot, fact)) links.push(link);
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
    refs: transition.facts.slice(),
  };
}

function factsById(snapshot: SpecSnapshot, ids: readonly string[]): Fact[] {
  const facts: Fact[] = [];
  for (const id of ids) {
    const fact = findFact(snapshot.facts ?? [], id);
    if (fact !== undefined) facts.push(fact);
  }
  return facts;
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

function factLink(fact: Fact): TraceLink {
  const link: TraceLink = {
    layer: 'fact',
    id: fact.id,
    type: fact.type,
    status: fact.removed === true ? 'removed' : fact.status,
    origin: fact.origin,
    refs: fact.sources.slice(),
  };
  if (fact.removed === true) link.text = 'removed';
  else if (fact.note !== undefined) link.text = fact.note;
  return link;
}

function entityLink(entity: Entity): TraceLink {
  const link: TraceLink = {
    layer: 'entity',
    id: entity.id,
    kind: entity.kind,
    status: entity.status,
    origin: entity.origin,
    refs: entity.sources.slice(),
  };
  if (entity.name !== undefined) link.name = entity.name;
  if (entity.text !== undefined) link.text = entity.text;
  return link;
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
  return {
    layer: 'sentence',
    id: sentence.id,
    text: sentence.text,
    span: [sentence.span[0], sentence.span[1]],
    section: sentence.section,
    status: sentence.status,
    origin: sentence.origin,
  };
}

function findEntity(entities: readonly Entity[], id: string): Entity | undefined {
  for (const entity of entities) {
    if (entity.id === id) return entity;
  }
  return undefined;
}

function findFact(facts: readonly Fact[], id: string): Fact | undefined {
  for (const fact of facts) {
    if (fact.id === id) return fact;
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
  for (const sentence of currentSentences(sentences)) {
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
  for (const item of snapshot.tagged) {
    for (const token of item.tokens) {
      if (token.id !== id) continue;
      const sentence = findSentence(snapshot.sentences, item.id);
      if (sentence === undefined) return undefined;
      return { token, sentence };
    }
  }
  return undefined;
}
