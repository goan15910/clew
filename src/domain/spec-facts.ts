// Fact proposals from entities and tokens, plus agent edits.
// Confidence is advisory. Agent-owned facts are not overwritten.
import { WORKFLOW_WORD_PATTERN } from './workflow.js';
import {
  clauseSpans,
  hasTag,
  isAuxiliary,
  isConditionMarker,
  normalizeWord,
  pastParticiple,
  verbLemma,
  type ClauseSpan,
} from './spec-entities.js';
import type { Entity, Fact, FactType, Finding, Sentence, TaggedSentence, Token } from './spec.js';

const NEGATION = new Set(['not', 'cannot', "can't", 'never', "won't", 'wont']);

export interface FactDraft {
  type?: FactType;
  actor?: string;
  action?: string;
  object?: string;
  from?: string | null;
  to?: string;
  condition?: string;
  state?: string;
  sources?: string[];
  note?: string;
  confidence?: number;
}

export interface ProposedFacts {
  facts: Fact[];
  findings: Finding[];
}

interface Frame {
  actor?: { id: string; token: Token };
  action?: { id: string; token: Token; lemma: string; passive: boolean };
  object?: { id: string; token: Token };
  negated: boolean;
  sentence: Sentence;
}

export function proposeFacts(
  sentences: readonly Sentence[],
  tagged: readonly TaggedSentence[],
  entities: readonly Entity[],
  existing: readonly Fact[],
  onlySentence: string | undefined,
): ProposedFacts {
  const usable = usableEntities(entities);
  const drafts = collectDrafts(sentences, tagged, usable, onlySentence);
  return applyDrafts(drafts, existing, tagged, onlySentence, entities);
}

export function factSignature(fact: Pick<Fact, 'type' | 'actor' | 'action' | 'object' | 'condition' | 'state'>): string {
  if (fact.type === 'performs') return `performs|${fact.actor ?? ''}|${fact.action ?? ''}`;
  if (fact.type === 'transition') return `transition|${fact.object ?? ''}|${fact.action ?? ''}`;
  if (fact.type === 'guard') return `guard|${fact.action ?? ''}|${fact.condition ?? ''}`;
  if (fact.type === 'initial') return `initial|${fact.object ?? ''}`;
  if (fact.type === 'final') return `final|${fact.object ?? ''}|${fact.state ?? ''}`;
  return `forbidden|${fact.actor ?? ''}|${fact.action ?? ''}|${fact.object ?? ''}`;
}

export function validateFactDraft(draft: FactDraft, entities: readonly Entity[]): { findings: Finding[] } {
  const findings: Finding[] = [];
  if (draft.type === undefined) {
    findings.push(blocking('missing-type', 'a fact needs a type', []));
    return { findings };
  }
  const type = draft.type;
  require(draft, type, findings);
  checkRef(draft.actor, 'actor', entities, findings);
  checkRef(draft.action, 'action', entities, findings);
  checkRef(draft.object, 'object', entities, findings);
  checkRef(draft.condition, 'condition', entities, findings);
  checkState(draft.from, 'from', findings);
  checkState(draft.to, 'to', findings);
  checkState(draft.state, 'state', findings);
  if (draft.confidence !== undefined && (draft.confidence < 0 || draft.confidence > 1)) {
    findings.push(blocking('type-mismatch', 'confidence must be between 0 and 1', []));
  }
  return { findings };
}

export function buildFact(id: string, draft: FactDraft): Fact {
  const fact: Fact = {
    id,
    type: draft.type ?? 'performs',
    origin: 'agent',
    confidence: draft.confidence ?? 1,
    sources: draft.sources === undefined ? [] : draft.sources.slice(),
    status: 'current',
  };
  assignFact(fact, draft);
  return fact;
}

export function applyFactPatch(fact: Fact, draft: FactDraft): Fact {
  const next = copyFact(fact);
  next.origin = 'agent';
  next.confidence = draft.confidence ?? 1;
  next.status = 'current';
  next.removed = false;
  if (draft.type !== undefined) next.type = draft.type;
  if (draft.sources !== undefined) next.sources = draft.sources.slice();
  assignFact(next, draft);
  if (draft.note === undefined && fact.note !== undefined && next.note === undefined) next.note = fact.note;
  return next;
}

export function contradictionFindings(facts: readonly Fact[]): Finding[] {
  const live = liveFacts(facts);
  const findings: Finding[] = [];
  const initials = new Map<string, Fact[]>();
  const finals = new Map<string, Fact[]>();
  const transitions = new Map<string, Fact[]>();
  const forbidden = new Set<string>();
  for (const fact of live) {
    if (fact.type === 'initial' && fact.object !== undefined) pushMap(initials, fact.object, fact);
    if (fact.type === 'final' && fact.object !== undefined) pushMap(finals, fact.object, fact);
    if (fact.type === 'transition' && fact.object !== undefined && fact.action !== undefined) {
      pushMap(transitions, `${fact.object}|${fact.action}`, fact);
    }
    if (fact.type === 'forbidden' && fact.action !== undefined) {
      forbidden.add(`${fact.object ?? ''}|${fact.action}`);
    }
  }
  disagree(initials, findings, 'initial');
  disagree(finals, findings, 'final');
  for (const [key, group] of transitions) {
    if (forbidden.has(key)) {
      const first = group[0];
      findings.push({
        id: `contradicting:${key}`,
        kind: 'conflict',
        code: 'contradicting-facts',
        severity: 'warning',
        message: `${key} has both a transition and a forbidden fact`,
        refs: refsOf(group),
      });
      if (first === undefined) continue;
    }
    if (group.length < 2) continue;
    let differ = false;
    const head = group[0];
    for (const fact of group) {
      if (head !== undefined && (fact.to !== head.to || fact.from !== head.from)) differ = true;
    }
    if (!differ) continue;
    findings.push({
      id: `contradicting:transition:${key}`,
      kind: 'conflict',
      code: 'contradicting-facts',
      severity: 'warning',
      message: `${key} has disagreeing transitions`,
      refs: refsOf(group),
    });
  }
  return findings;
}

export function reconcileFacts(
  sentences: readonly Sentence[],
  tagged: readonly TaggedSentence[],
  entities: readonly Entity[],
  facts: readonly Fact[],
): Fact[] {
  const currentTokens = new Set<string>();
  const staleSentences = new Set<string>();
  for (const sentence of sentences) {
    if (sentence.status === 'stale') staleSentences.add(sentence.id);
  }
  for (const item of tagged) {
    if (item.status === 'stale') {
      staleSentences.add(item.id);
      continue;
    }
    for (const token of item.tokens) {
      if (token.status === 'current') currentTokens.add(token.id);
    }
  }
  const staleEntities = new Set<string>();
  for (const entity of entities) {
    if (entity.status === 'stale' || entity.status === 'rejected') staleEntities.add(entity.id);
  }
  const next: Fact[] = [];
  for (const fact of facts) {
    const copy = copyFact(fact);
    if (copy.removed === true) {
      copy.status = 'stale';
      next.push(copy);
      continue;
    }
    const sourced = copy.sources.length > 0;
    let liveSource = !sourced;
    for (const source of copy.sources) {
      if (!staleSentences.has(source) && (currentTokens.has(source) || findSentence(sentences, source)?.status === 'current')) liveSource = true;
    }
    const refs = factRefs(copy);
    let liveRef = true;
    for (const ref of refs) {
      if (staleEntities.has(ref)) liveRef = false;
    }
    copy.status = liveSource && liveRef ? 'current' : 'stale';
    next.push(copy);
  }
  return next;
}

export function sameFacts(left: readonly Fact[] | undefined, right: readonly Fact[] | undefined): boolean {
  if (left === undefined && right === undefined) return true;
  if (left === undefined || right === undefined || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) return false;
    if (!sameFact(a, b)) return false;
  }
  return true;
}

export function copyFact(fact: Fact): Fact {
  const copy: Fact = {
    id: fact.id,
    type: fact.type,
    origin: fact.origin,
    confidence: fact.confidence,
    sources: fact.sources.slice(),
    status: fact.status,
  };
  if (fact.actor !== undefined) copy.actor = fact.actor;
  if (fact.action !== undefined) copy.action = fact.action;
  if (fact.object !== undefined) copy.object = fact.object;
  if (fact.from !== undefined) copy.from = fact.from;
  if (fact.to !== undefined) copy.to = fact.to;
  if (fact.condition !== undefined) copy.condition = fact.condition;
  if (fact.state !== undefined) copy.state = fact.state;
  if (fact.note !== undefined) copy.note = fact.note;
  if (fact.removed === true) copy.removed = true;
  return copy;
}

export function visibleFacts(facts: readonly Fact[]): Fact[] {
  const visible: Fact[] = [];
  for (const fact of facts) {
    if (fact.removed === true) continue;
    visible.push(fact);
  }
  return visible;
}

function collectDrafts(
  sentences: readonly Sentence[],
  tagged: readonly TaggedSentence[],
  entities: readonly Entity[],
  onlySentence: string | undefined,
): { drafts: Fact[]; findings: Finding[] } {
  const tokenEntity = indexTokens(entities);
  const drafts: Fact[] = [];
  const findings: Finding[] = [];
  for (const sentence of sentences) {
    if (sentence.status !== 'current') continue;
    if (onlySentence !== undefined && sentence.id !== onlySentence) continue;
    const item = findTagged(tagged, sentence.id);
    if (item === undefined || item.status !== 'current') continue;
    const parsed = parseSentence(sentence, item, tokenEntity);
    for (const finding of parsed.findings) findings.push(finding);
    const ordered = orderFrames(parsed.frames, parsed.tokens);
    const performs: Fact[] = [];
    const transitionsForSentence: Fact[] = [];
    const forbidden: Fact[] = [];
    const transitions = new Map<string, Fact[]>();
    for (const frame of ordered) {
      if (frame.action === undefined) continue;
      if (frame.actor !== undefined) {
        performs.push(factDraft({
          type: 'performs',
          actor: frame.actor.id,
          action: frame.action.id,
          origin: 'rule',
          confidence: 0.9,
          sources: [sentence.id],
          sentence,
        }));
      }
      if (frame.object === undefined) continue;
      const toWord = normalizeWord(pastParticiple(frame.action.lemma, frame.action.token.text));
      if (toWord.word === undefined) {
        findings.push({
          id: `vocabulary:${frame.action.id}`,
          kind: 'vocabulary',
          code: 'vocabulary',
          severity: 'warning',
          message: `${frame.action.token.text} has no workflow-vocabulary state name`,
          refs: [sentence.id, frame.action.token.id],
        });
        continue;
      }
      if (frame.negated) {
        forbidden.push(factDraft({
          type: 'forbidden',
          actor: frame.actor?.id,
          action: frame.action.id,
          object: frame.object.id,
          origin: 'rule',
          confidence: 0.7,
          sources: [sentence.id],
          sentence,
        }));
        continue;
      }
      const transition = factDraft({
        type: 'transition',
        object: frame.object.id,
        action: frame.action.id,
        from: null,
        to: toWord.word,
        origin: 'rule',
        confidence: 0.5,
        sources: [frame.action.token.id, frame.object.token.id],
        sentence,
      });
      transitionsForSentence.push(transition);
      const list = transitions.get(frame.object.id) ?? [];
      list.push(transition);
      transitions.set(frame.object.id, list);
    }
    const sequencing = sequencingWord(parsed.tokens);
    for (const list of transitions.values()) {
      for (let index = 1; index < list.length; index += 1) {
        const previous = list[index - 1];
        const current = list[index];
        if (previous === undefined || current === undefined || previous.to === undefined) continue;
        current.from = previous.to;
        current.confidence = sequencing === 'when' ? 0.6 : 0.5;
        current.note = sequencing === 'when'
          ? 'from inferred from the When-clause order'
          : sequencing !== undefined
            ? `from inferred from the ${sequencing}-clause order`
            : 'from inferred from clause order';
      }
    }
    for (const fact of performs) drafts.push(fact);
    for (const fact of transitionsForSentence) drafts.push(fact);
    for (const fact of forbidden) drafts.push(fact);
    for (const guard of parsed.guards) {
      drafts.push(factDraft({
        type: 'guard',
        action: guard.action,
        condition: guard.condition,
        origin: 'rule',
        confidence: 0.8,
        sources: [guard.token.id],
        sentence: guard.sentence,
      }));
    }
  }
  return { drafts, findings };
}

function applyDrafts(
  collected: { drafts: Fact[]; findings: Finding[] },
  existing: readonly Fact[],
  tagged: readonly TaggedSentence[],
  onlySentence: string | undefined,
  entities: readonly Entity[],
): ProposedFacts {
  const findings = collected.findings.slice();
  const liveBySignature = new Map<string, Fact>();
  const removedSignatures = new Set<string>();
  for (const fact of existing) {
    const signature = factSignature(fact);
    if (fact.removed === true) removedSignatures.add(signature);
    else liveBySignature.set(signature, fact);
  }
  const produced = new Map<string, Fact>();
  for (const draft of collected.drafts) produced.set(factSignature(draft), draft);
  const used = new Set<string>();
  for (const fact of existing) used.add(fact.id);
  const consumed = new Set<string>();
  const next: Fact[] = [];
  for (const fact of existing) {
    const signature = factSignature(fact);
    if (fact.removed === true) {
      next.push(copyFact(fact));
      continue;
    }
    const draft = produced.get(signature);
    if (draft !== undefined && fact.origin === 'agent') {
      if (differs(fact, draft)) findings.push(agentFactConflict(fact.id));
      next.push(copyFact(fact));
      consumed.add(signature);
      continue;
    }
    if (draft !== undefined) {
      const created = copyFact(draft);
      created.id = fact.id;
      if (fact.note !== undefined && created.note === undefined) created.note = fact.note;
      next.push(created);
      consumed.add(signature);
      continue;
    }
    if (fact.origin === 'agent' || (onlySentence !== undefined && !factTouches(fact, onlySentence, tagged))) {
      next.push(copyFact(fact));
      continue;
    }
    const stale = copyFact(fact);
    stale.status = 'stale';
    next.push(stale);
  }
  for (const [signature, draft] of produced) {
    if (consumed.has(signature) || removedSignatures.has(signature)) continue;
    const created = copyFact(draft);
    created.id = freshFactId(used);
    next.push(created);
  }
  for (const fact of visibleFacts(next)) {
    if (fact.status !== 'current' || fact.type !== 'transition') continue;
    if (fact.from !== null && fact.from !== undefined) continue;
    findings.push({
      id: `transition-without-from:${fact.id}`,
      kind: 'gap',
      code: 'transition-without-from',
      severity: 'warning',
      message: `${fact.id} has no source state`,
      refs: [fact.id, ...fact.sources],
    });
  }
  for (const finding of unusedEntityFindings(entities, visibleFacts(next))) findings.push(finding);
  for (const finding of contradictionFindings(next)) findings.push(finding);
  return { facts: next, findings };
}

function unusedEntityFindings(entities: readonly Entity[], facts: readonly Fact[]): Finding[] {
  const used = new Set<string>();
  for (const fact of facts) {
    if (fact.status !== 'current') continue;
    for (const ref of factRefs(fact)) used.add(ref);
  }
  const findings: Finding[] = [];
  for (const entity of entities) {
    if (entity.status === 'rejected' || entity.status === 'stale') continue;
    if (used.has(entity.id)) continue;
    findings.push({
      id: `unused-entity:${entity.id}`,
      kind: 'coverage',
      code: 'unused-entity',
      severity: 'warning',
      message: `${entity.id} is not used by a fact`,
      refs: [entity.id],
    });
  }
  return findings;
}

interface ParsedSentence {
  frames: Frame[];
  guards: { action: string; condition: string; token: Token; sentence: Sentence }[];
  findings: Finding[];
  tokens: Token[];
}

function parseSentence(
  sentence: Sentence,
  tagged: TaggedSentence,
  tokenEntity: ReadonlyMap<string, Entity>,
): ParsedSentence {
  const tokens: Token[] = [];
  for (const token of tagged.tokens) {
    if (token.status === 'current') tokens.push(token);
  }
  const spans = clauseSpans(sentence, tagged.clauses);
  const placed = tokens.map((token) => ({ token, sentence, ordinal: 0 }));
  const markers: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token !== undefined && isConditionMarker(token, index, placed, sentence, spans)) markers.push(index);
  }
  const excluded = conditionTokenIndexes(tokens, sentence, spans, markers);
  const frames = swoFrames(tokens, sentence, tokenEntity, excluded);
  const findings: Finding[] = [];
  const actions: { id: string; index: number }[] = [];
  for (const frame of frames) {
    if (frame.action === undefined) continue;
    actions.push({ id: frame.action.id, index: tokens.indexOf(frame.action.token) });
    if (frame.actor === undefined) {
      findings.push({
        id: `action-without-actor:${frame.action.token.id}`,
        kind: 'gap',
        code: 'action-without-actor',
        severity: 'warning',
        message: `${frame.action.id} has no actor`,
        refs: [sentence.id, frame.action.token.id],
      });
    }
    if (frame.object === undefined) {
      findings.push({
        id: `action-without-object:${frame.action.token.id}`,
        kind: 'gap',
        code: 'action-without-object',
        severity: 'warning',
        message: `${frame.action.id} has no object`,
        refs: [sentence.id, frame.action.token.id],
      });
    }
  }
  const guards: ParsedSentence['guards'] = [];
  for (const index of markers) {
    const token = tokens[index];
    const entity = token === undefined ? undefined : tokenEntity.get(token.id);
    if (token === undefined || entity === undefined || entity.kind !== 'condition') continue;
    const action = nearestAction(actions, index);
    if (action === undefined) {
      findings.push({
        id: `guard-without-action:${token.id}`,
        kind: 'gap',
        code: 'guard-without-action',
        severity: 'warning',
        message: `${entity.id} does not attach to an action`,
        refs: [sentence.id, token.id],
      });
      continue;
    }
    guards.push({ action, condition: entity.id, token, sentence });
  }
  return { frames, guards, findings, tokens };
}

function swoFrames(
  tokens: readonly Token[],
  sentence: Sentence,
  tokenEntity: ReadonlyMap<string, Entity>,
  excluded: ReadonlySet<number>,
): Frame[] {
  const frames: Frame[] = [];
  let current: Frame = { negated: false, sentence };
  let pending: { id: string; token: Token } | undefined;
  const flush = (): void => {
    if (current.action === undefined && current.actor === undefined) {
      current = { negated: false, sentence };
      return;
    }
    frames.push(current);
    current = { negated: false, sentence };
  };
  for (let index = 0; index < tokens.length; index += 1) {
    if (excluded.has(index)) continue;
    const token = tokens[index];
    if (token === undefined) continue;
    if (isNegation(token)) current.negated = true;
    if (hasTag(token.tags, 'Verb') && isAuxiliary(token.tags)) continue;
    if (isAdjectival(tokens, index)) continue;
    const entity = tokenEntity.get(token.id);
    if (entity === undefined) continue;
    if (entity.kind === 'actor') {
      if (current.action?.passive === true && current.actor === undefined) {
        current.actor = { id: entity.id, token };
        continue;
      }
      if (current.action !== undefined && current.object !== undefined) flush();
      current.actor = { id: entity.id, token };
      continue;
    }
    if (entity.kind === 'action') {
      if (current.action !== undefined && (current.object !== undefined || current.action.passive)) flush();
      const passive = hasTag(token.tags, 'Passive');
      current.action = { id: entity.id, token, lemma: verbLemma(token.text), passive };
      if (passive && pending !== undefined && current.object === undefined) current.object = pending;
      continue;
    }
    if (entity.kind === 'object') {
      if (current.action !== undefined && current.object === undefined && current.action.passive !== true) {
        current.object = { id: entity.id, token };
      } else if (current.action === undefined) {
        pending = { id: entity.id, token };
      }
    }
  }
  flush();
  return frames;
}

function orderFrames(frames: readonly Frame[], tokens: readonly Token[]): Frame[] {
  const ordered = frames.slice();
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const left = ordered[index];
    const right = ordered[index + 1];
    if (left?.object === undefined || right?.object === undefined || left.object.id !== right.object.id) continue;
    if (left.action === undefined || right.action === undefined) continue;
    if (connectorBetween(tokens, left.action.token, right.action.token, 'after')) {
      ordered[index] = right;
      ordered[index + 1] = left;
    }
  }
  return ordered;
}

function connectorBetween(tokens: readonly Token[], left: Token, right: Token, word: string): boolean {
  let start = -1;
  let end = -1;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === left) start = index;
    if (tokens[index] === right) end = index;
  }
  if (start < 0 || end < 0 || start > end) return false;
  for (let index = start + 1; index < end; index += 1) {
    if (tokens[index]?.text.toLowerCase() === word) return true;
  }
  return false;
}

function sequencingWord(tokens: readonly Token[]): string | undefined {
  const first = tokens[0];
  if (first === undefined) return undefined;
  const word = first.text.toLowerCase();
  if (word === 'when' || word === 'after' || word === 'before' || word === 'once') return word;
  return undefined;
}

function conditionTokenIndexes(
  tokens: readonly Token[],
  sentence: Sentence,
  spans: readonly ClauseSpan[],
  markers: readonly number[],
): Set<number> {
  const excluded = new Set<number>();
  for (const marker of markers) {
    const token = tokens[marker];
    if (token === undefined) continue;
    const relative = token.span[0] - sentence.span[0];
    const clause = spanCovering(spans, relative);
    const end = clause === undefined ? sentence.span[1] : sentence.span[0] + clause.end;
    for (let index = marker; index < tokens.length; index += 1) {
      const candidate = tokens[index];
      if (candidate === undefined) continue;
      if (candidate.span[0] >= end) break;
      excluded.add(index);
    }
  }
  return excluded;
}

function nearestAction(actions: readonly { id: string; index: number }[], marker: number): string | undefined {
  let before: { id: string; index: number } | undefined;
  let after: { id: string; index: number } | undefined;
  for (const action of actions) {
    if (action.index < marker) before = action;
    if (action.index > marker && after === undefined) after = action;
  }
  return (before ?? after)?.id;
}

function indexTokens(entities: readonly Entity[]): Map<string, Entity> {
  const map = new Map<string, Entity>();
  for (const entity of entities) {
    if (entity.kind === 'condition') continue;
    for (const source of entity.sources) {
      if (!map.has(source)) map.set(source, entity);
    }
  }
  for (const entity of entities) {
    if (entity.kind !== 'condition') continue;
    const marker = entity.sources[0];
    if (marker !== undefined && !map.has(marker)) map.set(marker, entity);
  }
  return map;
}

function usableEntities(entities: readonly Entity[]): Entity[] {
  const usable: Entity[] = [];
  for (const entity of entities) {
    if (entity.status === 'rejected' || entity.status === 'stale') continue;
    usable.push(entity);
  }
  return usable;
}

function isNegation(token: Token): boolean {
  if (NEGATION.has(token.text.toLowerCase())) return true;
  return hasTag(token.tags, 'Negative');
}

function isAdjectival(tokens: readonly Token[], index: number): boolean {
  const token = tokens[index];
  if (token === undefined || !hasTag(token.tags, 'Verb') || isAuxiliary(token.tags)) return false;
  const previous = tokens[index - 1];
  const next = tokens[index + 1];
  if (previous === undefined || next === undefined) return false;
  return hasTag(previous.tags, 'Determiner') && hasTag(next.tags, 'Noun');
}

function spanCovering(spans: readonly ClauseSpan[], relative: number): ClauseSpan | undefined {
  for (const span of spans) {
    if (relative >= span.start && relative < span.end) return span;
  }
  return undefined;
}

interface DraftInput {
  type: FactType;
  actor?: string;
  action?: string;
  object?: string;
  from?: string | null;
  to?: string;
  condition?: string;
  origin: Fact['origin'];
  confidence: number;
  sources: string[];
  sentence: Sentence;
  note?: string;
}

function factDraft(input: DraftInput): Fact {
  const fact: Fact = {
    id: 'f0',
    type: input.type,
    origin: input.origin,
    confidence: input.confidence,
    sources: input.sources.slice(),
    status: 'current',
  };
  if (input.actor !== undefined) fact.actor = input.actor;
  if (input.action !== undefined) fact.action = input.action;
  if (input.object !== undefined) fact.object = input.object;
  if (input.from !== undefined) fact.from = input.from;
  if (input.to !== undefined) fact.to = input.to;
  if (input.condition !== undefined) fact.condition = input.condition;
  if (input.note !== undefined) fact.note = input.note;
  return fact;
}

function differs(agent: Fact, draft: Fact): boolean {
  return agent.actor !== draft.actor
    || agent.action !== draft.action
    || agent.object !== draft.object
    || agent.from !== draft.from
    || agent.to !== draft.to
    || agent.condition !== draft.condition
    || agent.state !== draft.state;
}

function agentFactConflict(id: string): Finding {
  return {
    id: `conflict:${id}`,
    kind: 'conflict',
    code: 'agent-fact',
    severity: 'warning',
    message: `${id} is agent-owned; propose did not overwrite it`,
    refs: [id],
  };
}

function factTouches(fact: Fact, sentenceId: string, tagged: readonly TaggedSentence[]): boolean {
  if (fact.sources.includes(sentenceId)) return true;
  const item = findTagged(tagged, sentenceId);
  if (item === undefined) return false;
  for (const token of item.tokens) {
    if (fact.sources.includes(token.id)) return true;
  }
  return false;
}

function freshFactId(used: Set<string>): string {
  let number = 1;
  while (used.has(`f${number}`)) number += 1;
  const id = `f${number}`;
  used.add(id);
  return id;
}

function require(draft: FactDraft, type: FactType, findings: Finding[]): void {
  const missing: string[] = [];
  if ((type === 'performs' || type === 'transition' || type === 'guard' || type === 'forbidden') && draft.action === undefined) missing.push('action');
  if (type === 'performs' && draft.actor === undefined) missing.push('actor');
  if ((type === 'transition' || type === 'initial' || type === 'final') && draft.object === undefined) missing.push('object');
  if (type === 'transition' && draft.to === undefined) missing.push('to');
  if (type === 'guard' && draft.condition === undefined) missing.push('condition');
  if ((type === 'initial' || type === 'final') && draft.state === undefined) missing.push('state');
  if (missing.length === 0) return;
  findings.push(blocking('type-mismatch', `${type} fact needs ${missing.join(', ')}`, []));
}

function checkRef(id: string | undefined, kind: Entity['kind'], entities: readonly Entity[], findings: Finding[]): void {
  if (id === undefined) return;
  const entity = findEntity(entities, id);
  if (entity === undefined) {
    findings.push(blocking('unknown-entity', `unknown entity ${id}`, [id]));
    return;
  }
  if (entity.kind !== kind) {
    findings.push(blocking('type-mismatch', `${id} is ${entity.kind}, not ${kind}`, [id]));
    return;
  }
  if (entity.status === 'rejected' || entity.status === 'stale') {
    findings.push(blocking('rejected-entity', `${id} is ${entity.status}`, [id]));
  }
}

function checkState(value: string | null | undefined, field: string, findings: Finding[]): void {
  if (value === undefined || value === null) return;
  if (!WORKFLOW_WORD_PATTERN.test(value)) {
    findings.push(blocking('vocabulary', `${field} "${value}" is not workflow vocabulary`, []));
  }
}

function blocking(code: string, message: string, refs: string[]): Finding {
  const suffix = refs[0] ?? message;
  return {
    id: `${code}:${suffix}`,
    kind: code === 'vocabulary' ? 'vocabulary' : 'gap',
    code,
    severity: 'blocking',
    message,
    refs,
  };
}

function assignFact(fact: Fact, draft: FactDraft): void {
  if (draft.actor !== undefined) fact.actor = draft.actor;
  if (draft.action !== undefined) fact.action = draft.action;
  if (draft.object !== undefined) fact.object = draft.object;
  if (draft.from !== undefined) fact.from = draft.from;
  if (draft.to !== undefined) fact.to = draft.to;
  if (draft.condition !== undefined) fact.condition = draft.condition;
  if (draft.state !== undefined) fact.state = draft.state;
  if (draft.note !== undefined) fact.note = draft.note;
}

function liveFacts(facts: readonly Fact[]): Fact[] {
  const live: Fact[] = [];
  for (const fact of facts) {
    if (fact.status === 'current' && fact.removed !== true) live.push(fact);
  }
  return live;
}

function pushMap(map: Map<string, Fact[]>, key: string, fact: Fact): void {
  const list = map.get(key) ?? [];
  list.push(fact);
  map.set(key, list);
}

function disagree(map: ReadonlyMap<string, Fact[]>, findings: Finding[], label: string): void {
  for (const [key, group] of map) {
    if (group.length < 2) continue;
    const states = new Set<string>();
    for (const fact of group) {
      if (fact.state !== undefined) states.add(fact.state);
    }
    if (states.size < 2) continue;
    findings.push({
      id: `contradicting:${label}:${key}`,
      kind: 'conflict',
      code: 'contradicting-facts',
      severity: 'warning',
      message: `${key} has disagreeing ${label} states`,
      refs: refsOf(group),
    });
  }
}

function refsOf(facts: readonly Fact[]): string[] {
  const refs: string[] = [];
  for (const fact of facts) refs.push(fact.id);
  return refs;
}

function factRefs(fact: Fact): string[] {
  const refs: string[] = [];
  if (fact.actor !== undefined) refs.push(fact.actor);
  if (fact.action !== undefined) refs.push(fact.action);
  if (fact.object !== undefined) refs.push(fact.object);
  if (fact.condition !== undefined) refs.push(fact.condition);
  return refs;
}

function findEntity(entities: readonly Entity[], id: string): Entity | undefined {
  for (const entity of entities) {
    if (entity.id === id) return entity;
  }
  return undefined;
}

function findSentence(sentences: readonly Sentence[], id: string): Sentence | undefined {
  for (const sentence of sentences) {
    if (sentence.id === id) return sentence;
  }
  return undefined;
}

function findTagged(tagged: readonly TaggedSentence[], id: string): TaggedSentence | undefined {
  for (const item of tagged) {
    if (item.id === id) return item;
  }
  return undefined;
}

function sameFact(left: Fact, right: Fact): boolean {
  return left.id === right.id
    && left.type === right.type
    && left.actor === right.actor
    && left.action === right.action
    && left.object === right.object
    && left.from === right.from
    && left.to === right.to
    && left.condition === right.condition
    && left.state === right.state
    && left.origin === right.origin
    && left.confidence === right.confidence
    && left.status === right.status
    && left.note === right.note
    && left.removed === right.removed
    && sameList(left.sources, right.sources);
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
