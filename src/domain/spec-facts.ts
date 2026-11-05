// ActionFact and ConfigurationFact proposals from entities and tokens.
// rebuildFacts runs on every entity write. No performs/transition/guard join.
import {
  assembleSpec,
  type Action,
  type SpecDraft,
} from './spec-model.js';
import {
  clauseSpans,
  hasTag,
  isAuxiliary,
  isConditionMarker,
  verbLemma,
  type ClauseSpan,
} from './spec-entities.js';
import {
  UNSPECIFIED_ACTOR_ID,
  UNSPECIFIED_ACTOR_NAME,
  type ActionFact,
  type ConfigurationFact,
  type Entity,
  type Fact,
  type FactKind,
  type Finding,
  type Sentence,
  type TaggedSentence,
  type Token,
} from './spec.js';
import {
  eventName,
  patchFromScalars,
  scalarFromValue,
  scalarsFromPatch,
  sameValue,
  valueFromScalar,
  varId,
  type JsonScalar,
  type Patch,
  type Predicate,
  type Value,
  type ValueType,
  type VarDecl,
  type VarId,
} from './valuation.js';

const NEGATION = new Set(['not', 'cannot', "can't", 'never', "won't", 'wont']);
const EVENT_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const VAR_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
/** Overlay location for the default atom initial (`{ t: 'null' }`) when `when` is null. */
export const DEFAULT_INITIAL_ATOM = 'null';

export interface FactDraft {
  kind?: FactKind;
  event?: string;
  actor?: string;
  when?: Predicate;
  assign?: Patch;
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

export function isActionFact(fact: Fact): fact is ActionFact {
  return fact.kind === 'action';
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

export function rebuildFacts(
  sentences: readonly Sentence[],
  tagged: readonly TaggedSentence[],
  entities: readonly Entity[],
  existing: readonly Fact[],
): ProposedFacts {
  const proposed = proposeFacts(sentences, tagged, entities, existing, undefined);
  return {
    facts: reconcileFacts(sentences, tagged, entities, proposed.facts),
    findings: proposed.findings,
  };
}

export function factSignature(fact: Pick<Fact, 'kind' | 'actor'> & {
  event?: string;
  when?: Predicate;
  assign?: Patch;
}): string {
  const actor = fact.actor ?? '';
  const when = predicateKey(fact.when);
  const keys = assignKeys(fact.assign);
  if (fact.kind === 'action') return `action|${fact.event ?? ''}|${actor}|${when}|${keys}`;
  return `${fact.kind}|${actor}|${when}|${keys}`;
}

export function validateFactDraft(draft: FactDraft, entities: readonly Entity[]): { findings: Finding[] } {
  const findings: Finding[] = [];
  if (draft.kind === undefined) {
    findings.push(blocking('missing-type', 'a fact needs a kind', []));
    return { findings };
  }
  if (draft.kind === 'action') {
    if (draft.event === undefined) findings.push(blocking('type-mismatch', 'action fact needs event', []));
    else if (!EVENT_PATTERN.test(draft.event)) {
      findings.push(blocking('vocabulary', `event "${draft.event}" must be UPPER_SNAKE_CASE`, []));
    }
    if (draft.actor === undefined) findings.push(blocking('type-mismatch', 'action fact needs actor', []));
    if (draft.assign === undefined || Object.keys(draft.assign).length === 0) {
      findings.push(blocking('type-mismatch', 'action assign must be non-empty', []));
    }
  } else if (draft.when === undefined && (draft.assign === undefined || Object.keys(draft.assign).length === 0)) {
    findings.push(blocking('type-mismatch', `${draft.kind} fact needs when or assign`, []));
  }
  if (draft.actor !== undefined) checkRef(draft.actor, 'actor', entities, findings);
  if (draft.confidence !== undefined && (draft.confidence < 0 || draft.confidence > 1)) {
    findings.push(blocking('type-mismatch', 'confidence must be between 0 and 1', []));
  }
  return { findings };
}

export function buildFact(id: string, draft: FactDraft): Fact {
  const kind = draft.kind ?? 'action';
  if (kind === 'action') {
    const fact: ActionFact = {
      id,
      kind: 'action',
      event: draft.event ?? 'EVENT',
      actor: draft.actor ?? '',
      when: draft.when ?? { op: 'true' },
      assign: draft.assign ?? {},
      origin: 'agent',
      confidence: draft.confidence ?? 1,
      sources: draft.sources === undefined ? [] : draft.sources.slice(),
      status: 'current',
    };
    if (draft.note !== undefined) fact.note = draft.note;
    return fact;
  }
  const fact: ConfigurationFact = {
    id,
    kind,
    origin: 'agent',
    confidence: draft.confidence ?? 1,
    sources: draft.sources === undefined ? [] : draft.sources.slice(),
    status: 'current',
  };
  if (draft.actor !== undefined) fact.actor = draft.actor;
  if (draft.when !== undefined) fact.when = draft.when;
  if (draft.assign !== undefined) fact.assign = draft.assign;
  if (draft.note !== undefined) fact.note = draft.note;
  return fact;
}

export function applyFactPatch(fact: Fact, draft: FactDraft): Fact {
  const merged = mergeDraft(draftFrom(fact), draft);
  const next = buildFact(fact.id, merged);
  const patched = copyFact(next);
  patched.origin = 'agent';
  patched.confidence = draft.confidence ?? 1;
  patched.status = 'current';
  delete patched.removed;
  if (draft.note === undefined && fact.note !== undefined && patched.note === undefined) patched.note = fact.note;
  return patched;
}

export function contradictionFindings(facts: readonly Fact[]): Finding[] {
  const live = liveFacts(facts);
  const findings: Finding[] = [];
  const actions = new Map<string, Fact[]>();
  const inits = new Map<string, Fact[]>();
  const terminals = new Map<string, Fact[]>();
  for (const fact of live) {
    if (fact.kind === 'action') pushMap(actions, `${fact.event}|${assignKeys(fact.assign)}`, fact);
    if (fact.kind === 'init') pushMap(inits, assignKeys(fact.assign), fact);
    if (fact.kind === 'terminal') pushMap(terminals, predicateKey(fact.when), fact);
  }
  disagreeAssign(actions, findings, 'action');
  disagreeAssign(inits, findings, 'init');
  disagreeAssign(terminals, findings, 'terminal');
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
  if (fact.kind === 'action') {
    const copy: ActionFact = {
      id: fact.id,
      kind: 'action',
      event: fact.event,
      actor: fact.actor,
      when: copyPredicate(fact.when),
      assign: copyPatch(fact.assign),
      origin: fact.origin,
      confidence: fact.confidence,
      sources: fact.sources.slice(),
      status: fact.status,
    };
    if (fact.note !== undefined) copy.note = fact.note;
    if (fact.removed === true) copy.removed = true;
    return copy;
  }
  const copy: ConfigurationFact = {
    id: fact.id,
    kind: fact.kind,
    origin: fact.origin,
    confidence: fact.confidence,
    sources: fact.sources.slice(),
    status: fact.status,
  };
  if (fact.actor !== undefined) copy.actor = fact.actor;
  if (fact.when !== undefined) copy.when = copyPredicate(fact.when);
  if (fact.assign !== undefined) copy.assign = copyPatch(fact.assign);
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

export function factRefs(fact: Fact): string[] {
  const refs: string[] = [];
  if (fact.kind === 'action' || fact.actor !== undefined) {
    if (fact.actor !== undefined) refs.push(fact.actor);
  }
  return refs;
}

function frameObjectVar(
  frame: Frame,
  entities: readonly Entity[],
  lastObject: string | undefined,
  sentenceHasObject: boolean,
): { varName: string; sources: string[]; mentioned: boolean } | undefined {
  if (frame.action === undefined) return undefined;
  if (frame.object !== undefined) {
    const objectEntity = findEntity(entities, frame.object.id);
    const objectVar = objectEntity === undefined ? undefined : varNameForEntity(objectEntity);
    if (objectVar === undefined) return undefined;
    return { varName: objectVar, sources: [frame.action.token.id, frame.object.token.id], mentioned: true };
  }
  if (sentenceHasObject || lastObject === undefined) return undefined;
  if (hasTag(frame.action.token.tags, 'Infinitive')) return undefined;
  return { varName: lastObject, sources: [frame.action.token.id], mentioned: false };
}

export function varNameForEntity(entity: Entity): string | undefined {
  if (entity.kind === 'object') {
    if (entity.name === undefined) return undefined;
    const name = entity.name.replace(/-/g, '_');
    return VAR_ID_PATTERN.test(name) ? name : undefined;
  }
  if (entity.kind === 'condition') {
    const suffix = entity.id.startsWith('condition:') ? entity.id.slice('condition:'.length) : entity.id;
    const name = suffix.replace(/-/g, '_');
    return VAR_ID_PATTERN.test(name) ? name : undefined;
  }
  return undefined;
}

export function eventFromAction(entity: Entity): string | undefined {
  if (entity.kind !== 'action' || entity.name === undefined) return undefined;
  const event = entity.name.replace(/-/g, '_').toUpperCase();
  return EVENT_PATTERN.test(event) ? event : undefined;
}

export function retargetFactRefs(
  facts: readonly Fact[],
  fromIds: readonly string[],
  toId: string,
  fromVar: string | undefined,
  toVar: string | undefined,
): { facts: Fact[]; affected: string[] } {
  const affected: string[] = [];
  const next: Fact[] = [];
  for (const fact of facts) {
    const copy = copyFact(fact);
    let changed = false;
    if (copy.kind === 'action' && fromIds.includes(copy.actor)) {
      copy.actor = toId;
      changed = true;
    } else if (copy.kind !== 'action' && copy.actor !== undefined && fromIds.includes(copy.actor)) {
      copy.actor = toId;
      changed = true;
    }
    if (fromVar !== undefined && toVar !== undefined && fromVar !== toVar) {
      if (copy.kind === 'action') {
        const when = rewritePredicateVar(copy.when, fromVar, toVar);
        const assign = rewritePatchVar(copy.assign, fromVar, toVar);
        if (when.changed) {
          copy.when = when.predicate;
          changed = true;
        }
        if (assign.changed) {
          copy.assign = assign.patch;
          changed = true;
        }
      } else {
        if (copy.when !== undefined) {
          const when = rewritePredicateVar(copy.when, fromVar, toVar);
          if (when.changed) {
            copy.when = when.predicate;
            changed = true;
          }
        }
        if (copy.assign !== undefined) {
          const assign = rewritePatchVar(copy.assign, fromVar, toVar);
          if (assign.changed) {
            copy.assign = assign.patch;
            changed = true;
          }
        }
      }
    }
    if (changed) affected.push(copy.id);
    next.push(copy);
  }
  return { facts: next, affected };
}

export function specFromFacts(entities: readonly Entity[], facts: readonly Fact[]): SpecDraft {
  const liveEntities = usableEntities(entities);
  const live = liveFacts(facts);
  const vars: VarDecl[] = [];
  const seen = new Set<string>();
  for (const entity of liveEntities) {
    const name = varNameForEntity(entity);
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    const type: ValueType = entity.kind === 'condition' ? 'boolean' : 'atom';
    vars.push({ id: name as VarId, type });
  }
  for (const fact of live) {
    const patch = fact.assign;
    if (patch === undefined) continue;
    for (const key of Object.keys(patch)) {
      if (seen.has(key) || !VAR_ID_PATTERN.test(key)) continue;
      seen.add(key);
      vars.push({ id: key as VarId, type: typeOfValue(patch[key]) });
    }
  }
  const initial: Record<string, Value> = {};
  for (const decl of vars) {
    initial[decl.id] = decl.type === 'boolean' ? { t: 'bool', v: false } : { t: 'null' };
  }
  for (const fact of live) {
    if (fact.kind !== 'init' || fact.assign === undefined) continue;
    for (const key of Object.keys(fact.assign)) {
      const value = fact.assign[key];
      if (value !== undefined) initial[key] = value;
    }
  }
  const actions: Action[] = [];
  for (const fact of live) {
    if (!isActionFact(fact)) continue;
    let event: ReturnType<typeof eventName>;
    try {
      event = eventName(fact.event);
    } catch {
      continue;
    }
    const actor = actorName(fact.actor, liveEntities) ?? fact.actor;
    actions.push({
      event,
      actor,
      when: fact.when,
      assign: fact.assign,
    });
  }
  const first = liveEntities.find((entity) => entity.kind === 'object' && entity.name !== undefined);
  const id = first?.name === undefined ? 'spec' : camelId(first.name);
  return { id, vars, initial, actions, labels: [] };
}

export function assembleSpecFromFacts(entities: readonly Entity[], facts: readonly Fact[]): ReturnType<typeof assembleSpec> | undefined {
  const draft = specFromFacts(entities, facts);
  if (draft.vars.length === 0) return undefined;
  try {
    return assembleSpec(draft);
  } catch {
    return undefined;
  }
}

export function overlayOf(fact: ActionFact, entities: readonly Entity[], initial: Patch): {
  object: string;
  from: string | undefined;
  to: string;
  event: string;
  actor: string | undefined;
  guard: string | undefined;
} | undefined {
  const objectVar = primaryObjectVar(fact.assign, entities);
  if (objectVar === undefined) return undefined;
  const assigned = fact.assign[objectVar];
  if (assigned === undefined || assigned.t !== 'atom') return undefined;
  const objectEntity = objectEntityForVar(objectVar, entities);
  const objectName = objectEntity?.name ?? objectVar.replace(/_/g, '-');
  const fromValue = eqValue(fact.when, objectVar);
  return {
    object: objectName,
    from: fromAtom(fromValue, objectVar, initial),
    to: assigned.v,
    event: fact.event,
    actor: overlayActor(fact.actor, entities),
    guard: booleanGuard(fact.when, entities),
  };
}

function fromAtom(fromValue: Value | undefined, objectVar: string, initial: Patch): string | undefined {
  if (fromValue === undefined) return undefined;
  if (fromValue.t === 'atom') return fromValue.v;
  if (fromValue.t !== 'null') return undefined;
  const value = initial[objectVar];
  if (value?.t === 'atom') return value.v;
  return DEFAULT_INITIAL_ATOM;
}

function overlayActor(id: string, entities: readonly Entity[]): string | undefined {
  const entity = findEntity(entities, id);
  if (entity?.name !== undefined) return entity.name;
  if (id === UNSPECIFIED_ACTOR_ID) return UNSPECIFIED_ACTOR_NAME;
  return undefined;
}

export function draftFrom(fact: Fact): FactDraft {
  const draft: FactDraft = {
    kind: fact.kind,
    sources: fact.sources.slice(),
    confidence: fact.confidence,
  };
  if (fact.kind === 'action') {
    draft.event = fact.event;
    draft.actor = fact.actor;
    draft.when = copyPredicate(fact.when);
    draft.assign = copyPatch(fact.assign);
  } else {
    if (fact.actor !== undefined) draft.actor = fact.actor;
    if (fact.when !== undefined) draft.when = copyPredicate(fact.when);
    if (fact.assign !== undefined) draft.assign = copyPatch(fact.assign);
  }
  if (fact.note !== undefined) draft.note = fact.note;
  return draft;
}

export function mergeDraft(base: FactDraft, patch: FactDraft): FactDraft {
  const next: FactDraft = {};
  if (base.kind !== undefined) next.kind = base.kind;
  if (base.event !== undefined) next.event = base.event;
  if (base.actor !== undefined) next.actor = base.actor;
  if (base.when !== undefined) next.when = copyPredicate(base.when);
  if (base.assign !== undefined) next.assign = copyPatch(base.assign);
  if (base.sources !== undefined) next.sources = base.sources.slice();
  if (base.note !== undefined) next.note = base.note;
  if (base.confidence !== undefined) next.confidence = base.confidence;
  if (patch.kind !== undefined) next.kind = patch.kind;
  if (patch.event !== undefined) next.event = patch.event;
  if (patch.actor !== undefined) next.actor = patch.actor;
  if (patch.when !== undefined) next.when = copyPredicate(patch.when);
  if (patch.assign !== undefined) next.assign = copyPatch(patch.assign);
  if (patch.sources !== undefined) next.sources = patch.sources.slice();
  if (patch.note !== undefined) next.note = patch.note;
  if (patch.confidence !== undefined) next.confidence = patch.confidence;
  return next;
}

export function predicateFromScalars(raw: unknown): Predicate | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  if (!('op' in raw) || typeof raw.op !== 'string') return undefined;
  if (raw.op === 'true') return { op: 'true' };
  if ((raw.op === 'eq' || raw.op === 'neq') && 'var' in raw && typeof raw.var === 'string' && 'value' in raw && isScalar(raw.value)) {
    try {
      return { op: raw.op, var: varId(raw.var), value: valueFromScalar(raw.value) };
    } catch {
      return undefined;
    }
  }
  if (raw.op === 'not' && 'of' in raw) {
    const inner = predicateFromScalars(raw.of);
    if (inner === undefined) return undefined;
    return { op: 'not', of: inner };
  }
  if ((raw.op === 'and' || raw.op === 'or') && 'of' in raw && Array.isArray(raw.of)) {
    const of: Predicate[] = [];
    for (const child of raw.of) {
      const inner = predicateFromScalars(child);
      if (inner === undefined) return undefined;
      of.push(inner);
    }
    if (of.length === 0) return undefined;
    return { op: raw.op, of };
  }
  return undefined;
}

export function predicateScalars(predicate: Predicate): Record<string, unknown> {
  if (predicate.op === 'true') return { op: 'true' };
  if (predicate.op === 'eq' || predicate.op === 'neq') {
    return { op: predicate.op, var: predicate.var, value: scalarFromValue(predicate.value) };
  }
  if (predicate.op === 'not') return { op: 'not', of: predicateScalars(predicate.of) };
  const of: Record<string, unknown>[] = [];
  for (const child of predicate.of) of.push(predicateScalars(child));
  return { op: predicate.op, of };
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
  const lastValue = new Map<string, Value>();
  let lastObject: string | undefined;
  for (const sentence of sentences) {
    if (sentence.status !== 'current') continue;
    if (onlySentence !== undefined && sentence.id !== onlySentence) continue;
    const item = findTagged(tagged, sentence.id);
    if (item === undefined || item.status !== 'current') continue;
    const parsed = parseSentence(sentence, item, tokenEntity);
    for (const finding of parsed.findings) findings.push(finding);
    const ordered = orderFrames(parsed.frames, parsed.tokens);
    const sentenceHasObject = ordered.some((frame) => frame.object !== undefined);
    const guardsByAction = new Map<string, string[]>();
    for (const guard of parsed.guards) {
      const list = guardsByAction.get(guard.action) ?? [];
      list.push(guard.condition);
      guardsByAction.set(guard.action, list);
    }
    for (const frame of ordered) {
      if (frame.action === undefined) continue;
      const actionEntity = findEntity(entities, frame.action.id);
      const event = actionEntity === undefined ? undefined : eventFromAction(actionEntity);
      if (event === undefined) {
        findings.push({
          id: `vocabulary:${frame.action.id}`,
          kind: 'vocabulary',
          code: 'vocabulary',
          severity: 'warning',
          message: `${frame.action.token.text} has no event name`,
          refs: [sentence.id, frame.action.token.id],
        });
        continue;
      }
      const target = frameObjectVar(frame, entities, lastObject, sentenceHasObject);
      if (target === undefined) continue;
      if (target.mentioned) lastObject = target.varName;
      const assigned: Value = { t: 'atom', v: actionEntity?.name ?? frame.action.lemma };
      const previous = lastValue.get(target.varName);
      if (!frame.negated && previous !== undefined && sameValue(previous, assigned)) continue;
      const whenParts: Predicate[] = [];
      if (previous === undefined) whenParts.push({ op: 'eq', var: target.varName as VarId, value: { t: 'null' } });
      else whenParts.push({ op: 'eq', var: target.varName as VarId, value: previous });
      const attached = guardsByAction.get(frame.action.id) ?? [];
      for (const conditionId of attached) {
        const condition = findEntity(entities, conditionId);
        const condVar = condition === undefined ? undefined : varNameForEntity(condition);
        if (condVar === undefined) continue;
        whenParts.push({ op: 'eq', var: condVar as VarId, value: { t: 'bool', v: true } });
      }
      const assign: Record<string, Value> = {};
      assign[target.varName] = assigned;
      const sources: string[] = target.sources;
      if (frame.negated) {
        const forbidden: ConfigurationFact = {
          id: 'f0',
          kind: 'forbidden',
          actor: frame.actor?.id ?? UNSPECIFIED_ACTOR_ID,
          when: andAll(whenParts),
          assign,
          origin: 'rule',
          confidence: 0.7,
          sources: [sentence.id],
          status: 'current',
        };
        drafts.push(forbidden);
        continue;
      }
      const note = previous === undefined
        ? undefined
        : sequencingWord(parsed.tokens) === 'when'
          ? 'when inferred from the When-clause order'
          : sequencingWord(parsed.tokens) !== undefined
            ? `when inferred from the ${sequencingWord(parsed.tokens)}-clause order`
            : 'when inferred from clause order';
      const action: ActionFact = {
        id: 'f0',
        kind: 'action',
        event,
        actor: frame.actor?.id ?? UNSPECIFIED_ACTOR_ID,
        when: andAll(whenParts),
        assign,
        origin: 'rule',
        confidence: previous === undefined ? 0.5 : sequencingWord(parsed.tokens) === 'when' ? 0.6 : 0.5,
        sources,
        status: 'current',
      };
      if (note !== undefined) action.note = note;
      drafts.push(action);
      lastValue.set(target.varName, assigned);
    }
  }
  return { drafts: foldSingletonDrafts(drafts, entities), findings };
}

function foldSingletonDrafts(drafts: readonly Fact[], entities: readonly Entity[]): Fact[] {
  const counts = objectFactCounts(drafts);
  const folded: Fact[] = [];
  for (const draft of drafts) {
    if (!isActionFact(draft)) {
      folded.push(draft);
      continue;
    }
    const fromVar = primaryObjectVar(draft.assign, entities);
    if (fromVar === undefined || (counts.get(fromVar) ?? 0) !== 1) {
      folded.push(draft);
      continue;
    }
    const sentenceId = sourceSentenceId(draft.sources[0]);
    const toVar = sentenceId === undefined ? undefined : lifecycleVarInSentence(sentenceId, fromVar, entities, counts);
    if (toVar === undefined) {
      folded.push(draft);
      continue;
    }
    const when = rewritePredicateVar(draft.when, fromVar, toVar);
    const assign = rewritePatchVar(draft.assign, fromVar, toVar);
    if (!when.changed && !assign.changed) {
      folded.push(draft);
      continue;
    }
    const next = copyFact(draft);
    next.when = when.predicate;
    next.assign = assign.patch;
    folded.push(next);
  }
  return folded;
}

function objectFactCounts(drafts: readonly Fact[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const draft of drafts) {
    if (!isActionFact(draft)) continue;
    for (const name of Object.keys(draft.assign)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

function lifecycleVarInSentence(
  sentenceId: string,
  exclude: string,
  entities: readonly Entity[],
  counts: ReadonlyMap<string, number>,
): string | undefined {
  let best: { name: string; n: number } | undefined;
  for (const entity of entities) {
    if (entity.kind !== 'object' || entity.status === 'rejected' || entity.status === 'stale') continue;
    const name = varNameForEntity(entity);
    if (name === undefined || name === exclude) continue;
    const n = counts.get(name) ?? 0;
    if (n < 2) continue;
    if (!entityTouchesSentence(entity, sentenceId)) continue;
    if (best === undefined || n > best.n) best = { name, n };
  }
  return best?.name;
}

function entityTouchesSentence(entity: Entity, sentenceId: string): boolean {
  for (const source of entity.sources) {
    if (sourceSentenceId(source) === sentenceId) return true;
  }
  return false;
}

function sourceSentenceId(source: string | undefined): string | undefined {
  if (source === undefined) return undefined;
  const dot = source.indexOf('.');
  return dot === -1 ? source : source.slice(0, dot);
}

function applyDrafts(
  collected: { drafts: Fact[]; findings: Finding[] },
  existing: readonly Fact[],
  tagged: readonly TaggedSentence[],
  onlySentence: string | undefined,
  entities: readonly Entity[],
): ProposedFacts {
  const findings = collected.findings.slice();
  const produced = new Map<string, Fact>();
  for (const draft of collected.drafts) produced.set(factSignature(draft), draft);
  const removedSignatures = new Set<string>();
  for (const fact of existing) {
    if (fact.removed === true) removedSignatures.add(factSignature(fact));
  }
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
    const draft = matchingDraft(produced, fact);
    if (draft !== undefined && fact.origin === 'agent') {
      if (differs(fact, draft)) findings.push(agentFactConflict(fact.id));
      next.push(copyFact(fact));
      consumed.add(factSignature(draft));
      continue;
    }
    if (draft !== undefined) {
      const created = copyFact(draft);
      created.id = fact.id;
      if (fact.note !== undefined && created.note === undefined) created.note = fact.note;
      next.push(created);
      consumed.add(signature);
      consumed.add(factSignature(draft));
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
  for (const finding of unusedEntityFindings(entities, visibleFacts(next))) findings.push(finding);
  for (const finding of contradictionFindings(next)) findings.push(finding);
  return { facts: next, findings };
}

function unusedEntityFindings(entities: readonly Entity[], facts: readonly Fact[]): Finding[] {
  const used = new Set<string>();
  for (const fact of facts) {
    if (fact.status !== 'current') continue;
    for (const ref of factRefs(fact)) used.add(ref);
    for (const entity of entities) {
      if (entityUsesFact(entity, fact)) used.add(entity.id);
    }
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

export function entityUsesFact(entity: Entity, fact: Fact): boolean {
  if (entity.kind === 'actor') return fact.actor === entity.id;
  if (entity.kind === 'action') {
    const event = eventFromAction(entity);
    return isActionFact(fact) && event !== undefined && fact.event === event;
  }
  const name = varNameForEntity(entity);
  if (name === undefined) return false;
  if (isActionFact(fact)) return predicateUses(fact.when, name) || patchUses(fact.assign, name);
  return (fact.when !== undefined && predicateUses(fact.when, name))
    || (fact.assign !== undefined && patchUses(fact.assign, name));
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

function matchingDraft(produced: Map<string, Fact>, fact: Fact): Fact | undefined {
  const exact = produced.get(factSignature(fact));
  if (exact !== undefined) return exact;
  if (!isActionFact(fact)) return undefined;
  for (const draft of produced.values()) {
    if (isActionFact(draft) && draft.event === fact.event && draft.actor === fact.actor) return draft;
  }
  if (fact.actor !== UNSPECIFIED_ACTOR_ID) return undefined;
  for (const draft of produced.values()) {
    if (!isActionFact(draft) || draft.event !== fact.event) continue;
    if (!samePredicate(draft.when, fact.when) || !samePatch(draft.assign, fact.assign)) continue;
    return draft;
  }
  return undefined;
}

function differs(agent: Fact, draft: Fact): boolean {
  if (agent.kind !== draft.kind) return true;
  if (agent.actor !== draft.actor) return true;
  if (isActionFact(agent) && isActionFact(draft)) {
    return agent.event !== draft.event
      || !samePredicate(agent.when, draft.when)
      || !samePatch(agent.assign, draft.assign);
  }
  if (agent.kind === 'action' || draft.kind === 'action') return true;
  return !sameOptionalPredicate(agent.when, draft.when) || !sameOptionalPatch(agent.assign, draft.assign);
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

function checkRef(id: string, kind: Entity['kind'], entities: readonly Entity[], findings: Finding[]): void {
  if (kind === 'actor' && id === UNSPECIFIED_ACTOR_ID) return;
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

function disagreeAssign(map: ReadonlyMap<string, Fact[]>, findings: Finding[], label: string): void {
  for (const [key, group] of map) {
    if (group.length < 2) continue;
    const head = group[0];
    if (head === undefined) continue;
    let differ = false;
    for (const fact of group) {
      if (!sameOptionalPatch(head.assign, fact.assign)) differ = true;
    }
    if (!differ) continue;
    findings.push({
      id: `contradicting:${label}:${key}`,
      kind: 'conflict',
      code: 'contradicting-facts',
      severity: 'warning',
      message: `${key} has disagreeing ${label} assignments`,
      refs: refsOf(group),
    });
  }
}

function refsOf(facts: readonly Fact[]): string[] {
  const refs: string[] = [];
  for (const fact of facts) refs.push(fact.id);
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
  if (left.id !== right.id || left.kind !== right.kind || left.origin !== right.origin) return false;
  if (left.confidence !== right.confidence || left.status !== right.status || left.note !== right.note) return false;
  if (left.removed !== right.removed || !sameList(left.sources, right.sources)) return false;
  if (left.actor !== right.actor) return false;
  if (isActionFact(left) && isActionFact(right)) {
    return left.event === right.event && samePredicate(left.when, right.when) && samePatch(left.assign, right.assign);
  }
  if (left.kind === 'action' || right.kind === 'action') return false;
  return sameOptionalPredicate(left.when, right.when) && sameOptionalPatch(left.assign, right.assign);
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function copyPredicate(predicate: Predicate): Predicate {
  if (predicate.op === 'true') return { op: 'true' };
  if (predicate.op === 'eq' || predicate.op === 'neq') {
    return { op: predicate.op, var: predicate.var, value: predicate.value };
  }
  if (predicate.op === 'not') return { op: 'not', of: copyPredicate(predicate.of) };
  const of: Predicate[] = [];
  for (const child of predicate.of) of.push(copyPredicate(child));
  return { op: predicate.op, of };
}

function copyPatch(patch: Patch): Patch {
  const next: Record<string, Value> = {};
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) continue;
    next[key] = value;
  }
  return next;
}

function samePredicate(left: Predicate, right: Predicate): boolean {
  if (left.op !== right.op) return false;
  if (left.op === 'true') return true;
  if ((left.op === 'eq' || left.op === 'neq') && (right.op === 'eq' || right.op === 'neq')) {
    return left.var === right.var && sameValue(left.value, right.value);
  }
  if (left.op === 'not' && right.op === 'not') return samePredicate(left.of, right.of);
  if ((left.op === 'and' || left.op === 'or') && (right.op === 'and' || right.op === 'or')) {
    if (left.of.length !== right.of.length) return false;
    for (let index = 0; index < left.of.length; index += 1) {
      const a = left.of[index];
      const b = right.of[index];
      if (a === undefined || b === undefined || !samePredicate(a, b)) return false;
    }
    return true;
  }
  return false;
}

function samePatch(left: Patch, right: Patch): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    const a = left[key];
    const b = right[key];
    if (a === undefined || b === undefined || !sameValue(a, b)) return false;
  }
  return true;
}

function sameOptionalPredicate(left: Predicate | undefined, right: Predicate | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return samePredicate(left, right);
}

function sameOptionalPatch(left: Patch | undefined, right: Patch | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return samePatch(left, right);
}

function predicateKey(predicate: Predicate | undefined): string {
  if (predicate === undefined) return '';
  return JSON.stringify(predicateScalars(predicate));
}

function assignKeys(patch: Patch | undefined): string {
  if (patch === undefined) return '';
  return Object.keys(patch).sort().join(',');
}

function andAll(parts: readonly Predicate[]): Predicate {
  if (parts.length === 0) return { op: 'true' };
  const first = parts[0];
  if (parts.length === 1 && first !== undefined) return first;
  return { op: 'and', of: parts };
}

function rewritePredicateVar(predicate: Predicate, fromVar: string, toVar: string): { predicate: Predicate; changed: boolean } {
  if (predicate.op === 'true') return { predicate, changed: false };
  if (predicate.op === 'eq' || predicate.op === 'neq') {
    if (predicate.var !== fromVar) return { predicate, changed: false };
    return { predicate: { op: predicate.op, var: toVar as VarId, value: predicate.value }, changed: true };
  }
  if (predicate.op === 'not') {
    const inner = rewritePredicateVar(predicate.of, fromVar, toVar);
    if (!inner.changed) return { predicate, changed: false };
    return { predicate: { op: 'not', of: inner.predicate }, changed: true };
  }
  const of: Predicate[] = [];
  let changed = false;
  for (const child of predicate.of) {
    const next = rewritePredicateVar(child, fromVar, toVar);
    of.push(next.predicate);
    if (next.changed) changed = true;
  }
  if (!changed) return { predicate, changed: false };
  return { predicate: { op: predicate.op, of }, changed: true };
}

function rewritePatchVar(patch: Patch, fromVar: string, toVar: string): { patch: Patch; changed: boolean } {
  if (!Object.hasOwn(patch, fromVar)) return { patch, changed: false };
  const next: Record<string, Value> = {};
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) continue;
    next[key === fromVar ? toVar : key] = value;
  }
  return { patch: next, changed: true };
}

function predicateUses(predicate: Predicate, name: string): boolean {
  if (predicate.op === 'true') return false;
  if (predicate.op === 'eq' || predicate.op === 'neq') return predicate.var === name;
  if (predicate.op === 'not') return predicateUses(predicate.of, name);
  for (const child of predicate.of) {
    if (predicateUses(child, name)) return true;
  }
  return false;
}

function patchUses(patch: Patch, name: string): boolean {
  return Object.hasOwn(patch, name);
}

function primaryObjectVar(assign: Patch, entities: readonly Entity[]): string | undefined {
  for (const key of Object.keys(assign)) {
    if (objectEntityForVar(key, entities) !== undefined) return key;
  }
  return Object.keys(assign)[0];
}

function objectEntityForVar(name: string, entities: readonly Entity[]): Entity | undefined {
  for (const entity of entities) {
    if (entity.kind !== 'object') continue;
    if (varNameForEntity(entity) === name) return entity;
  }
  return undefined;
}

function eqValue(predicate: Predicate, name: string): Value | undefined {
  if (predicate.op === 'eq' && predicate.var === name) return predicate.value;
  if (predicate.op === 'and') {
    for (const child of predicate.of) {
      const value = eqValue(child, name);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function booleanGuard(predicate: Predicate, entities: readonly Entity[]): string | undefined {
  if (predicate.op === 'eq' && predicate.value.t === 'bool' && predicate.value.v === true) {
    for (const entity of entities) {
      if (entity.kind === 'condition' && varNameForEntity(entity) === predicate.var) return entity.id;
    }
  }
  if (predicate.op === 'and') {
    for (const child of predicate.of) {
      const guard = booleanGuard(child, entities);
      if (guard !== undefined) return guard;
    }
  }
  return undefined;
}

function actorName(id: string, entities: readonly Entity[]): string | undefined {
  if (id === UNSPECIFIED_ACTOR_ID) return UNSPECIFIED_ACTOR_NAME;
  return findEntity(entities, id)?.name;
}

function camelId(name: string): string {
  const parts = name.split('-');
  const first = parts[0] ?? 'spec';
  let id = first;
  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === undefined || part.length === 0) continue;
    id += part.charAt(0).toUpperCase() + part.slice(1);
  }
  return id;
}

function typeOfValue(value: Value | undefined): ValueType {
  if (value?.t === 'bool') return 'boolean';
  if (value?.t === 'num') return 'number';
  return 'atom';
}

function isScalar(value: unknown): value is JsonScalar {
  return value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}
