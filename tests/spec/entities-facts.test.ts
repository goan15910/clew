import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { specSessionDir } from '../../src/adapters/spec-store/data-dir.js';
import type { SpecEntitiesDocument, SpecFactsDocument, SpecStatusDocument, SpecTagDocument, SpecTraceDocument } from '../../src/application/documents.js';
import { contradictionFindings } from '../../src/domain/spec-facts.js';
import { entityFindings, pastParticiple } from '../../src/domain/spec-entities.js';
import type { Entity, Fact, FactType } from '../../src/domain/spec.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const sample = join(root, 'tests', 'fixtures', 'specs', 'order-sentence.md');
const SAMPLE = 'When the customer submits an order, the manager approves the order if the total is under 500 dollars.';

describe('spec entities and facts', { concurrency: false }, () => {
  test('near-duplicate names are a warning', () => {
    const findings = entityFindings([
      entity('object:order', 'object', 'order'),
      entity('object:older', 'object', 'older'),
    ]);
    assert.equal(findings.some((finding) => finding.code === 'near-duplicate' && finding.severity === 'warning'), true);
  });

  test('the design sample lists entities and proposes facts', () => {
    withData((dir) => {
      prepare(dir, sample);
      const listed = run(dir, ['spec', 'entities', 'list', '--json']);
      assert.equal(listed.status, 0);
      assert.equal(listed.stderr, '');
      const entities = json<SpecEntitiesDocument>(listed);
      assert.equal(entities.command, 'spec.entities.list');
      assert.equal(entities.ok, true);
      assert.equal(entities.session, 'order-sentence');
      assert.deepEqual(entities.issues, []);
      assert.deepEqual(entities.entities?.map((item) => item.id), [
        'actor:customer',
        'actor:manager',
        'object:order',
        'object:total',
        'action:submit',
        'action:approve',
        'condition:c1',
      ]);
      const order = byId(entities.entities ?? [], 'object:order');
      assert.equal(order.origin, 'rule');
      assert.deepEqual(order.sources, ['s1.t6', 's1.t11']);
      const condition = byId(entities.entities ?? [], 'condition:c1');
      assert.equal(condition.text, 'the total is under 500 dollars');
      assert.deepEqual(condition.sources, ['s1.t12', 's1.t13', 's1.t14', 's1.t15', 's1.t16', 's1.t17', 's1.t18']);
      assert.equal(entities.entities?.some((item) => item.id.includes('dollar') || item.name === 'be'), false);
      assert.deepEqual(codes(entities.findings), [
        'unreviewed', 'unreviewed', 'unreviewed', 'unreviewed', 'unreviewed', 'unreviewed', 'unreviewed',
      ]);
      const actors = run(dir, ['spec', 'entities', 'list', '--kind', 'actor', '--status', 'candidate', '--json']);
      assert.deepEqual(json<SpecEntitiesDocument>(actors).entities?.map((item) => item.id), ['actor:customer', 'actor:manager']);
      const proposed = run(dir, ['spec', 'facts', 'propose', '--json']);
      assert.equal(proposed.status, 0);
      assert.equal(proposed.stderr, '');
      const facts = json<SpecFactsDocument>(proposed);
      assert.equal(facts.command, 'spec.facts.propose');
      assert.equal(facts.ok, true);
      assert.equal(facts.facts?.length, 5);
      assert.deepEqual(facts.facts?.[0], {
        id: 'f1', type: 'performs', actor: 'actor:customer', action: 'action:submit',
        origin: 'rule', confidence: 0.9, sources: ['s1'], status: 'current',
      });
      assert.equal(facts.facts?.[1]?.id, 'f2');
      assert.equal(facts.facts?.[1]?.actor, 'actor:manager');
      const submit = byId(facts.facts ?? [], 'f3');
      assert.equal(submit.type, 'transition');
      assert.equal(submit.from, null);
      assert.equal(submit.to, 'submitted');
      assert.equal(submit.confidence, 0.5);
      assert.deepEqual(submit.sources, ['s1.t4', 's1.t6']);
      const approve = byId(facts.facts ?? [], 'f4');
      assert.equal(approve.from, 'submitted');
      assert.equal(approve.to, 'approved');
      assert.equal(approve.confidence, 0.6);
      assert.equal(approve.note, 'from inferred from the When-clause order');
      const guard = byId(facts.facts ?? [], 'f5');
      assert.equal(guard.type, 'guard');
      assert.equal(guard.condition, 'condition:c1');
      assert.equal(guard.confidence, 0.8);
      assert.deepEqual(guard.sources, ['s1.t12']);
      assert.deepEqual(codes(facts.findings), ['transition-without-from', 'unused-entity']);
      assert.equal(historyCount(dir, 'order-sentence'), 4);
      const proposedHistory = historyEntries(dir, 'order-sentence').filter((entry) => entry.command === 'spec.facts.propose');
      assert.deepEqual(proposedHistory[0]?.before, []);
      assert.deepEqual(proposedHistory[0]?.after, ['f1', 'f2', 'f3', 'f4', 'f5']);
      run(dir, ['spec', 'entities', 'list', '--json']);
      run(dir, ['spec', 'facts', 'propose', '--json']);
      assert.equal(historyCount(dir, 'order-sentence'), 4);
      const one = run(dir, ['spec', 'facts', 'propose', '--sentence', 's1', '--json']);
      assert.equal(one.status, 0);
      assert.equal(json<SpecFactsDocument>(one).facts?.length, 5);
    });
  });

  test('a short verb doubles its final consonant, including after a consonant cluster', () => {
    assert.equal(pastParticiple('ship'), 'shipped');
    assert.equal(pastParticiple('ship', 'ships'), 'shipped');
    assert.equal(pastParticiple('stop'), 'stopped');
    assert.equal(pastParticiple('plan'), 'planned');
    assert.equal(pastParticiple('submit'), 'submitted');
    assert.equal(pastParticiple('cancel'), 'cancelled');
    assert.equal(pastParticiple('cancel', 'cancelled'), 'cancelled');
    assert.equal(pastParticiple('approve'), 'approved');
  });

  test('a forbidden fact next to a transition is not a second warning', () => {
    const transition = liveFact('f1', 'transition', { object: 'object:order', action: 'action:approve', from: 'submitted', to: 'approved' });
    const forbidden = liveFact('f2', 'forbidden', { object: 'object:order', action: 'action:approve' });
    assert.deepEqual(contradictionFindings([transition, forbidden]), []);
    const other = liveFact('f3', 'transition', { object: 'object:order', action: 'action:approve', from: 'submitted', to: 'rejected' });
    const warnings = contradictionFindings([transition, other]);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.code, 'contradicting-facts');
    assert.match(warnings[0]?.message ?? '', /disagreeing transitions/);
  });

  test('ships becomes shipped, and a noun that is not tagged Actor stays an object', () => {
    withData((dir) => {
      const file = writeSpec(dir, 'ship.md', 'The warehouse ships the order.\n');
      prepare(dir, file);
      run(dir, ['spec', 'entities', 'list', '--json']);
      const proposed = run(dir, ['spec', 'facts', 'propose', '--json']);
      assert.equal(proposed.status, 0, proposed.stderr);
      const transition = json<SpecFactsDocument>(proposed).facts?.find((fact) => fact.type === 'transition');
      assert.equal(transition?.to, 'shipped');
    });
    withData((dir) => {
      const file = writeSpec(dir, 'shipper.md', 'The shipper picks up the parcel.\n');
      prepare(dir, file);
      const tagged = run(dir, ['spec', 'tag', '--json']);
      assert.equal(json<SpecTagDocument>(tagged).findings.some((finding) => finding.code === 'no-actor'), true);
      const listed = run(dir, ['spec', 'entities', 'list', '--json']);
      const entities = json<SpecEntitiesDocument>(listed).entities ?? [];
      assert.equal(entities.some((item) => item.kind === 'actor'), false);
      assert.equal(entities.some((item) => item.id === 'object:shipper'), true);
    });
  });

  test('agent edits win, and a removed fact is not recreated', () => {
    withData((dir) => {
      prepare(dir, sample);
      run(dir, ['spec', 'entities', 'list', '--json']);
      run(dir, ['spec', 'facts', 'propose', '--json']);
      const rejected = run(dir, ['spec', 'entities', 'reject', '--id', 'object:total', '--reason', 'a data field, not a thing with states', '--json']);
      assert.equal(rejected.status, 0);
      assert.equal(rejected.stderr, '');
      const total = byId(json<SpecEntitiesDocument>(rejected).entities ?? [], 'object:total');
      assert.equal(total.status, 'rejected');
      assert.equal(total.origin, 'tagger');
      assert.equal(total.note, 'agent: a data field, not a thing with states');
      const edited = run(dir, ['spec', 'facts', 'edit', '--id', 'f3', '--from-state', 'draft', '--note', 'agent supplied draft', '--json']);
      assert.equal(edited.status, 0);
      const f3 = byId(json<SpecFactsDocument>(edited).facts ?? [], 'f3');
      assert.equal(f3.from, 'draft');
      assert.equal(f3.origin, 'agent');
      assert.equal(f3.confidence, 1);
      assert.equal(f3.to, 'submitted');
      const again = run(dir, ['spec', 'facts', 'propose', '--json']);
      assert.equal(again.status, 0);
      const codesAgain = codes(json<SpecFactsDocument>(again).findings);
      assert.equal(codesAgain.includes('agent-fact'), true);
      assert.equal(codesAgain.includes('transition-without-from'), false);
      assert.equal(codesAgain.includes('unused-entity'), false);
      assert.equal(byId(json<SpecFactsDocument>(again).facts ?? [], 'f3').from, 'draft');
      const added = run(dir, ['spec', 'facts', 'add', '--type', 'initial', '--object', 'object:order', '--state', 'draft', '--json']);
      assert.equal(added.status, 0);
      const f6 = byId(json<SpecFactsDocument>(added).facts ?? [], 'f6');
      assert.equal(f6.type, 'initial');
      assert.equal(f6.state, 'draft');
      assert.equal(f6.origin, 'agent');
      assert.equal(f6.confidence, 1);
      assert.deepEqual(f6.sources, []);
      const traced = run(dir, ['spec', 'trace', 'f6', '--json']);
      assert.equal(traced.status, 0);
      assert.equal(traced.stderr, '');
      const trace = json<SpecTraceDocument>(traced);
      assert.equal(trace.command, 'spec.trace');
      assert.equal(trace.chain?.[0]?.layer, 'fact');
      assert.equal(trace.chain?.some((link) => link.layer === 'entity' && link.id === 'object:order'), true);
      assert.equal(trace.chain?.some((link) => link.layer === 'sentence' && link.id === 's1'), true);
      assert.deepEqual(codes(trace.findings), ['orphan']);
      const state = run(dir, ['spec', 'trace', 'submitted', '--json']);
      const stateDoc = json<SpecTraceDocument>(state);
      assert.equal(stateDoc.chain?.[0]?.layer, 'state');
      assert.equal(stateDoc.chain?.some((link) => link.id === 'f3'), true);
      assert.equal(stateDoc.chain?.some((link) => link.id === 'f4'), true);
      const duplicate = run(dir, ['spec', 'facts', 'add', '--type', 'performs', '--actor', 'actor:customer', '--action', 'action:submit', '--json']);
      assert.equal(duplicate.status, 1);
      assert.equal(duplicate.stderr, '');
      assert.equal(json<SpecFactsDocument>(duplicate).findings[0]?.code, 'contradicting-facts');
      const beforeRemove = historyCount(dir, 'order-sentence');
      const removed = run(dir, ['spec', 'facts', 'remove', '--id', 'f5', '--json']);
      assert.equal(removed.status, 0);
      assert.equal(json<SpecFactsDocument>(removed).facts?.some((fact) => fact.type === 'guard'), false);
      assert.deepEqual(json<SpecFactsDocument>(removed).removed, ['f5']);
      const kept = run(dir, ['spec', 'facts', 'propose', '--json']);
      assert.equal(json<SpecFactsDocument>(kept).facts?.some((fact) => fact.type === 'guard'), false);
      const patch = join(dir, 'guard.json');
      writeFileSync(patch, `${JSON.stringify({ type: 'guard', action: 'action:approve', condition: 'condition:c1', sources: ['s1.t12'] })}\n`);
      const revived = run(dir, ['spec', 'facts', 'add', '--from', patch, '--json']);
      assert.equal(revived.status, 0, revived.stderr);
      const guard = byId(json<SpecFactsDocument>(revived).facts ?? [], 'f5');
      assert.equal(guard.type, 'guard');
      assert.equal(guard.status, 'current');
      assert.equal(historyCount(dir, 'order-sentence') > beforeRemove, true);
      const beforeStatus = historyCount(dir, 'order-sentence');
      const status = run(dir, ['spec', 'status', '--json']);
      assert.equal(status.status, 0);
      assert.equal(status.stderr, '');
      assert.equal(historyCount(dir, 'order-sentence'), beforeStatus);
      const coverage = json<SpecStatusDocument>(status);
      assert.equal(coverage.command, 'spec.status');
      assert.deepEqual(coverage.coverage?.sentences.mapped, ['s1']);
      assert.equal(coverage.coverage?.entities.rejected, 1);
      assert.equal(coverage.coverage?.facts.implied, 1);
      assert.equal(coverage.layers?.graph, false);
      assert.equal(coverage.layers?.facts, true);
      const human = run(dir, ['spec', 'status']);
      assert.match(human.stdout, /1 mapped, 0 pending, 0 stale/);
      assert.equal(historyCount(dir, 'order-sentence'), beforeStatus);
    });
  });

  test('merge, rename, reject, and promote follow the vocabulary rules', () => {
    withData((dir) => {
      prepare(dir, sample);
      run(dir, ['spec', 'entities', 'list', '--json']);
      run(dir, ['spec', 'facts', 'propose', '--json']);
      const across = run(dir, ['spec', 'entities', 'merge', '--into', 'actor:customer', '--id', 'object:order', '--json']);
      assert.equal(across.status, 1);
      assert.equal(across.stderr, '');
      const acrossDoc = json<SpecEntitiesDocument>(across);
      assert.equal(acrossDoc.ok, true);
      assert.equal(acrossDoc.findings[0]?.code, 'merge-across-kinds');
      assert.equal(acrossDoc.entities?.some((item) => item.id === 'object:order'), true);
      const badName = run(dir, ['spec', 'entities', 'rename', '--id', 'actor:manager', '--name', '!!!', '--json']);
      assert.equal(badName.status, 1);
      assert.equal(badName.stderr, '');
      assert.equal(json<SpecEntitiesDocument>(badName).findings[0]?.code, 'vocabulary');
      assert.equal(json<SpecEntitiesDocument>(badName).entities?.some((item) => item.id === 'actor:manager'), true);
      const renamed = run(dir, ['spec', 'entities', 'rename', '--id', 'actor:customer', '--name', 'Client', '--json']);
      assert.equal(renamed.status, 0);
      const renamedDoc = json<SpecEntitiesDocument>(renamed);
      assert.equal(renamedDoc.findings.some((finding) => finding.code === 'normalized-name'), true);
      assert.equal(renamedDoc.entities?.some((item) => item.id === 'actor:client'), true);
      assert.equal(renamedDoc.entities?.some((item) => item.id === 'actor:customer'), false);
      assert.equal(renamedDoc.affected?.includes('f1'), true);
      const condition = run(dir, ['spec', 'entities', 'rename', '--id', 'condition:c1', '--name', 'limit', '--json']);
      assert.equal(condition.status, 2);
      assert.match(condition.stderr, /--text/);
      assert.equal(json<SpecEntitiesDocument>(condition).issues[0]?.kind, 'input');
      const missing = run(dir, ['spec', 'entities', 'reject', '--id', 'actor:missing', '--json']);
      assert.equal(missing.status, 2);
      assert.match(missing.stderr, /unknown entity/);
      assert.equal(json<SpecEntitiesDocument>(missing).ok, false);
      assert.equal(json<SpecEntitiesDocument>(missing).issues[0]?.kind, 'input');
      const collision = run(dir, ['spec', 'entities', 'rename', '--id', 'object:total', '--name', 'order', '--json']);
      assert.equal(collision.status, 1);
      assert.equal(collision.stderr, '');
      assert.equal(json<SpecEntitiesDocument>(collision).findings[0]?.code, 'duplicate-entity');
      const kind = run(dir, ['spec', 'entities', 'promote', '--id', 'condition:c1', '--kind', 'actor', '--json']);
      assert.equal(kind.status, 1);
      assert.equal(kind.stderr, '');
      assert.equal(json<SpecEntitiesDocument>(kind).findings[0]?.code, 'merge-across-kinds');
    });
    withData((dir) => {
      const file = writeSpec(dir, 'files.md', 'The clerk files a receipt. The clerk files a bill.\n');
      prepare(dir, file);
      run(dir, ['spec', 'entities', 'list', '--json']);
      run(dir, ['spec', 'facts', 'propose', '--json']);
      const merged = run(dir, ['spec', 'entities', 'merge', '--into', 'object:receipt', '--id', 'object:bill', '--json']);
      assert.equal(merged.status, 0, merged.stderr + merged.stdout);
      const doc = json<SpecEntitiesDocument>(merged);
      assert.deepEqual(doc.removed, ['object:bill']);
      assert.equal(doc.changed?.[0], 'object:receipt');
      assert.equal(byId(doc.entities ?? [], 'object:receipt').origin, 'agent');
      const facts = run(dir, ['spec', 'facts', 'propose', '--json']);
      assert.equal(json<SpecFactsDocument>(facts).facts?.some((fact) => fact.object === 'object:bill'), false);
    });
    withData((dir) => {
      const file = writeSpec(dir, 'ship.md', 'The warehouse ships the order.\n');
      prepare(dir, file);
      run(dir, ['spec', 'entities', 'list', '--json']);
      const promoted = run(dir, ['spec', 'entities', 'promote', '--id', 'object:warehouse', '--kind', 'actor', '--json']);
      assert.equal(promoted.status, 0, promoted.stderr);
      const doc = json<SpecEntitiesDocument>(promoted);
      const warehouse = byId(doc.entities ?? [], 'actor:warehouse');
      assert.equal(warehouse.kind, 'actor');
      assert.equal(warehouse.status, 'confirmed');
      assert.equal(warehouse.origin, 'agent');
      assert.equal(doc.entities?.some((item) => item.id === 'object:warehouse'), false);
    });
  });

  test('passive voice names the by-actor, and negation is forbidden', () => {
    withData((dir) => {
      const file = writeSpec(dir, 'passive.md', 'The order is cancelled by the manager.\n');
      prepare(dir, file);
      const listed = run(dir, ['spec', 'entities', 'list', '--json']);
      assert.deepEqual(json<SpecEntitiesDocument>(listed).entities?.map((item) => item.id), [
        'actor:manager', 'object:order', 'action:cancel',
      ]);
      const proposed = run(dir, ['spec', 'facts', 'propose', '--json']);
      const facts = json<SpecFactsDocument>(proposed).facts ?? [];
      assert.equal(facts.some((fact) => fact.type === 'performs' && fact.actor === 'actor:manager' && fact.action === 'action:cancel'), true);
      const transition = facts.find((fact) => fact.type === 'transition');
      assert.equal(transition?.object, 'object:order');
      assert.equal(transition?.to, 'cancelled');
    });
    withData((dir) => {
      const file = writeSpec(dir, 'cannot.md', 'The customer cannot cancel a shipped order.\n');
      prepare(dir, file);
      const listed = run(dir, ['spec', 'entities', 'list', '--json']);
      const ids = json<SpecEntitiesDocument>(listed).entities?.map((item) => item.id) ?? [];
      assert.deepEqual(ids, ['actor:customer', 'object:order', 'action:cancel']);
      const proposed = run(dir, ['spec', 'facts', 'propose', '--json']);
      const facts = json<SpecFactsDocument>(proposed).facts ?? [];
      assert.equal(facts.some((fact) => fact.type === 'performs'), true);
      assert.equal(facts.some((fact) => fact.type === 'forbidden' && fact.confidence === 0.7), true);
      assert.equal(facts.some((fact) => fact.type === 'transition'), false);
    });
  });

  test('a changed spec marks entities stale and keeps the review', () => {
    withData((dir) => {
      const file = writeSpec(dir, 'flow.md', `${SAMPLE}\n`);
      prepare(dir, file);
      run(dir, ['spec', 'entities', 'list', '--json']);
      const promoted = run(dir, ['spec', 'entities', 'promote', '--id', 'action:submit', '--json']);
      assert.equal(promoted.status, 0, promoted.stderr);
      writeFileSync(file, 'The clerk files a receipt.\n');
      const again = run(dir, ['spec', 'init', file, '--json']);
      assert.equal(again.status, 0, again.stderr);
      const session = specSessionDir('flow', { CLEW_DATA_DIR: dir });
      const stored = JSON.parse(readFileSync(join(session, 'entities.json'), 'utf8')) as {
        entities: { id: string; status: string; review?: string }[];
      };
      const submit = stored.entities.find((item) => item.id === 'action:submit');
      assert.equal(submit?.status, 'stale');
      assert.equal(submit?.review, 'confirmed');
      const status = run(dir, ['spec', 'status', '--json']);
      assert.equal(status.status, 0, status.stderr);
      const doc = json<SpecStatusDocument>(status);
      assert.equal((doc.coverage?.entities.stale ?? 0) > 0, true);
      assert.equal(doc.findings.some((finding) => finding.code === 'stale-entity'), true);
      assert.equal(doc.layers?.facts, true);
      assert.equal(doc.coverage?.facts.current, 0);
    });
  });

  test('bad input is exit 2 and model problems stay in findings', () => {
    withData((dir) => {
      const file = writeSpec(dir, 'early.md', `${SAMPLE}\n`);
      assert.equal(run(dir, ['spec', 'init', file, '--json']).status, 0);
      const early = run(dir, ['spec', 'entities', 'list', '--json']);
      assert.equal(early.status, 2);
      assert.match(early.stderr, /spec tag/);
      assert.equal(json<SpecEntitiesDocument>(early).issues[0]?.kind, 'input');
      assert.equal(run(dir, ['spec', 'tag', '--json']).status, 0);
      const noEntities = run(dir, ['spec', 'facts', 'propose', '--json']);
      assert.equal(noEntities.status, 2);
      assert.match(noEntities.stderr, /entities/);
      run(dir, ['spec', 'entities', 'list', '--json']);
      const absent = run(dir, ['spec', 'status', '--json']);
      assert.equal(absent.status, 0, absent.stderr);
      assert.equal(json<SpecStatusDocument>(absent).findings.some((finding) => finding.code === 'facts-absent'), true);
      const stdin = run(dir, ['spec', 'facts', 'add', '--from', '-', '--json']);
      assert.equal(stdin.status, 2);
      assert.match(stdin.stderr, /stdin/);
      assert.equal(json<SpecFactsDocument>(stdin).fault, 'usage');
      const unknown = run(dir, ['spec', 'facts', 'add', '--type', 'performs', '--actor', 'actor:missing', '--action', 'action:submit', '--json']);
      assert.equal(unknown.status, 1);
      assert.equal(unknown.stderr, '');
      assert.equal(json<SpecFactsDocument>(unknown).ok, true);
      assert.equal(json<SpecFactsDocument>(unknown).findings[0]?.code, 'unknown-entity');
      const trace = run(dir, ['spec', 'trace', 'f9', '--json']);
      assert.equal(trace.status, 2);
      assert.match(trace.stderr, /unknown id/);
      assert.equal(json<SpecTraceDocument>(trace).issues[0]?.kind, 'input');
    });
  });

  test('help lists the entity and fact commands', () => {
    const help = clew(['help'], tmpdir());
    assert.equal(help.status, 0);
    assert.match(help.stdout, /spec entities/);
    assert.match(help.stdout, /spec facts/);
    assert.match(help.stdout, /spec trace/);
    assert.match(help.stdout, /spec status/);
  });
});

function entity(id: string, kind: Entity['kind'], name: string): Entity {
  return { id, kind, name, sources: ['s1.t1'], origin: 'tagger', status: 'candidate' };
}

function prepare(dir: string, file: string): void {
  const init = run(dir, ['spec', 'init', file, '--json']);
  assert.equal(init.status, 0, init.stderr);
  const tag = run(dir, ['spec', 'tag', '--json']);
  assert.equal(tag.status, 0, tag.stderr);
}

function writeSpec(dir: string, name: string, text: string): string {
  const file = join(dir, name);
  writeFileSync(file, text);
  return file;
}

function historyCount(dir: string, session: string): number {
  return historyEntries(dir, session).length;
}

function historyEntries(dir: string, session: string): { command: string; before: string[]; after: string[] }[] {
  const file = join(specSessionDir(session, { CLEW_DATA_DIR: dir }), 'history.jsonl');
  const text = readFileSync(file, 'utf8').trim();
  if (text === '') return [];
  const entries: { command: string; before: string[]; after: string[] }[] = [];
  for (const line of text.split('\n')) entries.push(JSON.parse(line) as { command: string; before: string[]; after: string[] });
  return entries;
}

function liveFact(id: string, type: FactType, fields: Partial<Fact>): Fact {
  return { id, type, origin: 'rule', confidence: 1, sources: [], status: 'current', ...fields };
}

function codes(findings: { code: string }[]): string[] {
  return findings.map((finding) => finding.code);
}

function byId<T extends { id: string }>(items: readonly T[], id: string): T {
  const found = items.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
}

function json<T>(result: { stdout: string }): T {
  return JSON.parse(result.stdout) as T;
}

function withData(runCase: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'clew-entities-'));
  try {
    runCase(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(dir: string, args: string[]): { status: number; stdout: string; stderr: string } {
  return clew(args, dir);
}

function clew(args: string[], dataDir: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(tsx, ['src/cli.ts', ...args], {
    cwd: root,
    env: { ...process.env, CLEW_DATA_DIR: dataDir },
    encoding: 'utf8',
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
