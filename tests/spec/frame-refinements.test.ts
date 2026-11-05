import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compromiseTagger } from '../../src/adapters/pos/compromise-tagger.js';
import { specSessionDir } from '../../src/adapters/spec-store/data-dir.js';
import { jsonSpecStore } from '../../src/adapters/spec-store/json-file-store.js';
import { specTextSource } from '../../src/adapters/spec-store/read-spec.js';
import type { Outcome, SpecFrameRefineDocument, SpecImpactDocument, SpecStatusDocument } from '../../src/application/documents.js';
import { editSentence } from '../../src/application/edit-sentences.js';
import { groupConcept } from '../../src/application/group-concepts.js';
import { initSpec } from '../../src/application/init-spec.js';
import { listConcepts } from '../../src/application/list-concepts.js';
import { listFrames } from '../../src/application/list-frames.js';
import { markNotTransition, setFrameRole, type SetRoleCommand } from '../../src/application/refine-frames.js';
import { readSpecImpact } from '../../src/application/spec-impact.js';
import { readSpecStatus } from '../../src/application/spec-status.js';
import { tagSpec } from '../../src/application/tag-spec.js';
import type { Frame, Role, SpecSnapshot } from '../../src/domain/spec.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const SPEC = [
  'When the customer submits an order, the manager approves the order if the total is under 500 dollars.',
  'A clerk must not cancel a shipped package.',
  'The clerk packs the package.',
].join('\n');

const MANAGER = 'sp:s1.t8..s1.t8';
const APPROVES = 'sp:s1.t9..s1.t9';
const ORDER = 'sp:s1.t11..s1.t11';
const CLERK_S2 = 'sp:s2.t2..s2.t2';
const CLERK_S3 = 'sp:s3.t2..s3.t2';
const PACKS = 'sp:s3.t3..s3.t3';

describe('frame refinements', { concurrency: false }, () => {
  test('set validates each role and derives the text from the refs', () => {
    withSession(() => {
      const actor = set({ frame: 'fr:s1.t7', role: 'actor', value: ['concept:clerk'] });
      assert.equal(actor.exit, 'pass', issues(actor));
      assert.deepEqual(actor.document.frame?.roles.actor.latest.value, { text: 'clerk', refs: ['concept:clerk'] });
      assert.equal(actor.document.frame?.roles.actor.original.value !== 'unknown' && actor.document.frame.roles.actor.original.value.text, 'manager');
      assert.equal(actor.document.frame?.compiled?.actor, 'clerk');

      const event = set({ frame: 'fr:s1.t7', role: 'event', value: [PACKS] });
      assert.equal(event.exit, 'pass', issues(event));
      assert.deepEqual(event.document.frame?.roles.event.latest, { value: { text: 'pack', refs: [PACKS] }, dependsOn: [PACKS] });

      const when = set({ frame: 'fr:s3.t1', role: 'when', value: ['fr:s1.t1', 'fr:s1.t12'] });
      assert.equal(when.exit, 'pass', issues(when));
      assert.equal(text(when.document.frame?.roles.when.latest.value), 'When the customer submits an order and if the total is under 500 dollars');
      assert.deepEqual(when.document.frame?.roles.when.latest.dependsOn, ['sp:s1.t4..s1.t4', 'sp:s1.t14..s1.t14']);

      const result = set({ frame: 'fr:s3.t1', role: 'result', value: ['concept:ship'] });
      assert.equal(result.exit, 'pass', issues(result));
      assert.equal(text(result.document.frame?.roles.result.latest.value), 'ship');

      const unknown = set({ frame: 'fr:s3.t1', role: 'object', value: 'unknown' });
      assert.equal(unknown.exit, 'pass', issues(unknown));
      assert.deepEqual(unknown.document.frame?.roles.object.latest, { value: 'unknown', dependsOn: [] });
      assert.equal(unknown.document.findings.some((finding) => finding.id === 'frame-missing-object:fr:s3.t1'), true);

      const rejected: [Omit<SetRoleCommand, 'reason'>, RegExp][] = [
        [{ frame: 'fr:s1.t7', role: 'actor', value: ['concept:clerk', 'concept:manager'] }, /--role actor takes exactly one concept id/],
        [{ frame: 'fr:s1.t7', role: 'object', value: ['concept:nothing'] }, /unknown concept "concept:nothing"/],
        [{ frame: 'fr:s1.t7', role: 'event', value: [ORDER] }, /sp:s1\.t11\.\.s1\.t11 is not a content verb/],
        [{ frame: 'fr:s1.t7', role: 'event', value: ['sp:s9.t1..s9.t1'] }, /unknown span "sp:s9\.t1\.\.s9\.t1"/],
        [{ frame: 'fr:s1.t7', role: 'when', value: ['fr:s1.t7'] }, /fr:s1\.t7 cannot wait on itself/],
        [{ frame: 'fr:s1.t7', role: 'when', value: ['fr:s9.t1'] }, /unknown frame "fr:s9\.t1"/],
        [{ frame: 'fr:s1.t7', role: 'actor', value: ['concept:clerk'], dependsOn: ['sp:s9.t1..s9.t1'] }, /unknown span "sp:s9\.t1\.\.s9\.t1"/],
        [{ frame: 'fr:s9.t1', role: 'actor', value: ['concept:clerk'] }, /unknown frame "fr:s9\.t1"/],
        [{ frame: 'fr:s1.t7', role: 'actor', value: ['concept:clerk'] }, /fr:s1\.t7 actor already reads that value/],
      ];
      for (const [command, message] of rejected) {
        const outcome = set(command);
        assert.equal(outcome.exit, 'invalid', JSON.stringify(command));
        assert.match(issues(outcome), message);
      }
    });
  });

  test('dependsOn defaults to the evidence of the value, and an explicit one is kept', () => {
    withSession(() => {
      const local = set({ frame: 'fr:s3.t1', role: 'actor', value: ['concept:package'] });
      assert.equal(local.exit, 'pass', issues(local));
      assert.deepEqual(local.document.frame?.roles.actor.latest.dependsOn, ['sp:s3.t5..s3.t5']);
      const elsewhere = set({ frame: 'fr:s1.t7', role: 'actor', value: ['concept:clerk'] });
      assert.deepEqual(elsewhere.document.frame?.roles.actor.latest.dependsOn, [CLERK_S2, CLERK_S3]);
      const explicit = set({ frame: 'fr:s1.t7', role: 'object', value: ['concept:order'], dependsOn: [ORDER, CLERK_S3] });
      assert.equal(explicit.exit, 'pass', issues(explicit));
      assert.deepEqual(explicit.document.frame?.roles.object.latest.dependsOn, [ORDER, CLERK_S3]);
      const history = explicit.document.frame?.roles.object.history ?? [];
      assert.deepEqual(history.map((revision) => [revision.who, revision.reason]), [['agent', 'test write']]);
    });
  });

  test('not-transition sets and clears an agent mark; a cleared verbless clause stays no verb', () => {
    withSession(() => {
      const marked = markNotTransition({ frame: 'fr:s1.t7', clear: false, reason: 'a policy, not a step', by: 'reviewer' }, jsonSpecStore);
      assert.equal(marked.exit, 'pass', issues(marked));
      assert.deepEqual(marked.document.frame?.notTransition, { reason: 'a policy, not a step', who: 'reviewer' });
      assert.equal(marked.document.frame?.compiled, undefined);
      assert.deepEqual(marked.document.frame?.history.map((revision) => revision.value), [{ notTransition: { reason: 'a policy, not a step' } }]);
      const again = markNotTransition({ frame: 'fr:s1.t7', clear: false, reason: 'a policy, not a step' }, jsonSpecStore);
      assert.equal(again.exit, 'invalid');
      assert.match(issues(again), /already reads that value/);
      assert.deepEqual(frame(listed(), 'fr:s1.t7').notTransition, { reason: 'a policy, not a step', who: 'reviewer' });

      const cleared = markNotTransition({ frame: 'fr:s1.t7', clear: true, reason: 'it is a step' }, jsonSpecStore);
      assert.equal(cleared.exit, 'pass', issues(cleared));
      assert.equal(cleared.document.frame?.notTransition, undefined);
      assert.equal(cleared.document.frame?.compiled?.event, 'APPROVE');
      assert.equal(cleared.document.frame?.history.length, 2);

      const verbless = markNotTransition({ frame: 'fr:s1.t12', clear: false, reason: 'a guard' }, jsonSpecStore);
      assert.deepEqual(verbless.document.frame?.notTransition, { reason: 'a guard', who: 'agent' });
      const back = markNotTransition({ frame: 'fr:s1.t12', clear: true, reason: 'derived is fine' }, jsonSpecStore);
      assert.deepEqual(back.document.frame?.notTransition, { reason: 'no verb' });
      const nothing = markNotTransition({ frame: 'fr:s1.t12', clear: true, reason: 'again' }, jsonSpecStore);
      assert.equal(nothing.exit, 'invalid');
      assert.match(issues(nothing), /fr:s1\.t12 notTransition already reads that value/);
    });
  });

  test('re-deriving keeps a refinement and recomputes original', () => {
    withSession(() => {
      set({ frame: 'fr:s1.t7', role: 'actor', value: ['concept:clerk'] });
      markNotTransition({ frame: 'fr:s2.t1', clear: false, reason: 'policy' }, jsonSpecStore);
      const before = historyLines().length;
      assert.equal(listFrames({}, jsonSpecStore).exit, 'pass');
      assert.equal(historyLines().length, before, 'a re-derive with no change writes nothing');
      assert.equal(listConcepts({}, jsonSpecStore).exit, 'pass');
      assert.equal(tagSpec({}, jsonSpecStore, compromiseTagger).exit, 'pass');
      const frames = listed();
      const approve = frame(frames, 'fr:s1.t7');
      assert.equal(text(approve.roles.actor.latest.value), 'clerk');
      assert.equal(text(approve.roles.actor.original.value), 'manager');
      assert.equal(approve.roles.actor.history.length, 1);
      assert.deepEqual(frame(frames, 'fr:s2.t1').notTransition, { reason: 'policy', who: 'agent' });
    });
  });

  test('editing the cited sentence drops the refinement, raises refinement-dropped, and keeps the old value in history', () => {
    withSession(() => {
      set({ frame: 'fr:s1.t7', role: 'object', value: ['concept:package'], dependsOn: [ORDER] });
      markNotTransition({ frame: 'fr:s1.t7', clear: false, reason: 'policy' }, jsonSpecStore);
      const edited = editSentence(
        { action: 'edit', id: 's1', text: 'When the customer submits an order, the manager approves the order if the total is under 600 dollars.', reason: 'new limit' },
        jsonSpecStore,
        compromiseTagger,
        specTextSource,
      );
      assert.equal(edited.exit, 'pass', issues(edited));
      const ids = edited.document.findings.map((finding) => finding.id);
      assert.deepEqual(ids, ['refinement-dropped:fr:s1.t7:object', 'refinement-dropped:fr:s1.t7:notTransition']);
      const approve = frame(listed(), 'fr:s1.t7');
      assert.equal(text(approve.roles.object.latest.value), 'order');
      assert.deepEqual(approve.roles.object.latest, approve.roles.object.original);
      const last = approve.roles.object.history[approve.roles.object.history.length - 1];
      assert.equal(last?.who, 'clew');
      assert.equal(last?.reason, 's1 changed');
      assert.equal(last?.finding, 'refinement-dropped:fr:s1.t7:object');
      assert.deepEqual(last?.value, { value: { text: 'package', refs: ['concept:package'] }, dependsOn: [ORDER] });
      assert.equal(approve.notTransition, undefined);

      const status = readSpecStatus({}, jsonSpecStore).document as SpecStatusDocument;
      const dropped = status.findingsByLayer?.frames.filter((finding) => finding.code === 'refinement-dropped') ?? [];
      assert.deepEqual(dropped.map((finding) => [finding.id, finding.kind, finding.severity]), [
        ['refinement-dropped:fr:s1.t7:object', 'stale', 'warning'],
        ['refinement-dropped:fr:s1.t7:notTransition', 'stale', 'warning'],
      ]);
      assert.deepEqual(dropped[0]?.refs, ['fr:s1.t7', 's1']);
      assert.match(dropped[0]?.message ?? '', /it read "package"/);
      const lines = historyLines().filter((line) => line.args.finding === 'refinement-dropped:fr:s1.t7:object');
      assert.equal(lines.length, 1);
      assert.equal(lines[0]?.command, 'spec.sentences.edit');

      const rewritten = set({ frame: 'fr:s1.t7', role: 'object', value: ['concept:package'] });
      assert.equal(rewritten.exit, 'pass', issues(rewritten));
      const after = readSpecStatus({}, jsonSpecStore).document as SpecStatusDocument;
      assert.deepEqual(after.findings.filter((finding) => finding.code === 'refinement-dropped').map((finding) => finding.id), ['refinement-dropped:fr:s1.t7:notTransition']);
    });
  });

  test('editing an unrelated sentence keeps the refinement', () => {
    withSession(() => {
      set({ frame: 'fr:s1.t7', role: 'object', value: ['concept:package'], dependsOn: [ORDER] });
      const edited = editSentence({ action: 'edit', id: 's3', text: 'The clerk packs the box.', reason: 'box' }, jsonSpecStore, compromiseTagger, specTextSource);
      assert.equal(edited.exit, 'pass', issues(edited));
      assert.deepEqual(edited.document.findings, []);
      const approve = frame(listed(), 'fr:s1.t7');
      assert.equal(text(approve.roles.object.latest.value), 'package');
      assert.equal(approve.roles.object.history.length, 1);
    });
  });

  test('a cross-sentence dependsOn drops when the other sentence changes', () => {
    withSession(() => {
      set({ frame: 'fr:s1.t7', role: 'actor', value: ['concept:clerk'], dependsOn: [CLERK_S3] });
      const deleted = editSentence({ action: 'delete', id: 's3', reason: 'merged into s2' }, jsonSpecStore, compromiseTagger, specTextSource);
      assert.equal(deleted.exit, 'pass', issues(deleted));
      assert.deepEqual(deleted.document.findings.map((finding) => finding.id), ['refinement-dropped:fr:s1.t7:actor']);
      const approve = frame(listed(), 'fr:s1.t7');
      assert.equal(text(approve.roles.actor.latest.value), 'manager');
      assert.equal(approve.roles.actor.history[approve.roles.actor.history.length - 1]?.reason, 's3 changed');
    });
  });

  test('a refined frame that no longer derives is reported with its old value', () => {
    withSession(() => {
      set({ frame: 'fr:s1.t12', role: 'object', value: ['concept:total'], dependsOn: [CLERK_S2] });
      const edited = editSentence({ action: 'edit', id: 's1', text: 'The manager approves the order.', reason: 'drop the condition' }, jsonSpecStore, compromiseTagger, specTextSource);
      assert.equal(edited.exit, 'pass', issues(edited));
      const finding = edited.document.findings.find((item) => item.id === 'refinement-dropped:fr:s1.t12:object');
      assert.match(finding?.message ?? '', /fr:s1\.t12 no longer derives; its refined object read "total"/);
      assert.equal(listed().some((item) => item.id === 'fr:s1.t12'), false);
      const line = historyLines().find((item) => item.args.finding === 'refinement-dropped:fr:s1.t12:object');
      assert.deepEqual(line?.after, []);
    });
  });

  test('concepts group moves a span into an existing concept, a new one, or none, and frames follow', () => {
    withSession(() => {
      const into = groupConcept({ span: MANAGER, into: 'concept:clerk', reason: 'the manager is a clerk' }, jsonSpecStore);
      assert.equal(into.exit, 'pass', issues(into));
      assert.deepEqual(into.document.grouping, {
        span: MANAGER,
        original: 'concept:manager',
        latest: 'concept:clerk',
        dependsOn: [MANAGER],
        history: [into.document.grouping?.history[0]],
      });
      assert.equal(into.document.concepts?.find((concept) => concept.id === 'concept:clerk')?.members.some((member) => member.span === MANAGER), true);
      assert.equal(into.document.concepts?.some((concept) => concept.id === 'concept:manager'), false);
      const span = snapshot().spans?.find((item) => item.id === MANAGER);
      assert.equal(span?.entityId, 'concept:clerk');
      assert.equal(span?.entityLinkExplicitlySet, true);
      const approve = frame(listed(), 'fr:s1.t7');
      assert.equal(text(approve.roles.actor.latest.value), 'clerk');
      assert.equal(approve.roles.actor.history.length, 0);

      const fresh = groupConcept({ span: MANAGER, into: 'concept:approver', reason: 'its own role' }, jsonSpecStore);
      assert.equal(fresh.exit, 'pass', issues(fresh));
      assert.deepEqual(fresh.document.concepts?.find((concept) => concept.id === 'concept:approver'), {
        id: 'concept:approver',
        canonical: 'approver',
        members: [{ span: MANAGER, surface: 'manager', sentence: 's1' }],
      });

      const none = groupConcept({ span: MANAGER, into: null, reason: 'not a domain word' }, jsonSpecStore);
      assert.equal(none.exit, 'pass', issues(none));
      assert.equal(snapshot().spans?.find((item) => item.id === MANAGER)?.entityId, undefined);
      assert.equal(none.document.grouping?.history.length, 3);
      assert.equal(listConcepts({}, jsonSpecStore).document.concepts?.some((concept) => concept.members.some((member) => member.span === MANAGER)), false);

      const same = groupConcept({ span: MANAGER, into: null, reason: 'again' }, jsonSpecStore);
      assert.equal(same.exit, 'invalid');
      assert.match(issues(same), /already reads that value/);
      assert.match(issues(groupConcept({ span: 'sp:s1.t2..s1.t2', into: 'concept:clerk', reason: 'x' }, jsonSpecStore)), /not a significant span/);
      assert.match(issues(groupConcept({ span: 'sp:s9.t1..s9.t1', into: 'concept:clerk', reason: 'x' }, jsonSpecStore)), /unknown span/);

      const edited = editSentence({ action: 'edit', id: 's1', text: 'When the customer submits an order, the manager approves the order if the total is under 600 dollars.', reason: 'new limit' }, jsonSpecStore, compromiseTagger, specTextSource);
      assert.deepEqual(edited.document.findings.map((finding) => finding.id), [`refinement-dropped:${MANAGER}:concept`]);
      assert.equal(snapshot().spans?.find((item) => item.id === MANAGER)?.entityId, 'concept:manager');
    });
  });

  test('impact lists the fields and groupings that cite a sentence, and its frames', () => {
    withSession(() => {
      set({ frame: 'fr:s1.t7', role: 'actor', value: ['concept:clerk'], dependsOn: [CLERK_S3] });
      groupConcept({ span: CLERK_S3, into: 'concept:packer', reason: 'packs things' }, jsonSpecStore);
      const before = historyLines().length;
      const impact = readSpecImpact({ sentenceId: 's3' }, jsonSpecStore).document as SpecImpactDocument;
      assert.equal(historyLines().length, before);
      assert.equal(impact.command, 'spec.impact');
      assert.deepEqual(impact.frames, ['fr:s3.t1']);
      const refined = (impact.impact ?? []).filter((entry) => entry.refined);
      assert.deepEqual(refined, [
        { kind: 'field', frame: 'fr:s1.t7', role: 'actor', value: { text: 'clerk', refs: ['concept:clerk'] }, dependsOn: [CLERK_S3], refined: true },
        { kind: 'grouping', span: CLERK_S3, value: 'concept:packer', dependsOn: [CLERK_S3], refined: true },
      ]);
      assert.equal((impact.impact ?? []).some((entry) => entry.frame === 'fr:s3.t1' && entry.role === 'event' && !entry.refined), true);
      const unknown = readSpecImpact({ sentenceId: 's9' }, jsonSpecStore);
      assert.equal(unknown.exit, 'invalid');

      const cli = clew(['spec', 'impact', 's3']);
      assert.equal(cli.status, 0, cli.stderr);
      assert.match(cli.stdout, /s3 cited by \d+ fields or groupings \(2 refined\), 1 frame/);
      assert.match(cli.stdout, /refined fr:s1\.t7 actor = clerk/);
      const json = JSON.parse(clew(['spec', 'impact', 's3', '--json']).stdout) as SpecImpactDocument;
      assert.equal(json.impact?.length, impact.impact?.length);
    });
  });

  test('every refine command needs --reason and is exit 2 without it', () => {
    withSession(() => {
      const commands = [
        ['spec', 'frames', 'set', '--frame', 'fr:s1.t7', '--role', 'actor', '--value', 'concept:clerk'],
        ['spec', 'frames', 'not-transition', '--frame', 'fr:s1.t7'],
        ['spec', 'concepts', 'group', '--span', MANAGER, '--into', 'concept:clerk'],
      ];
      for (const args of commands) {
        const result = clew([...args, '--json']);
        assert.equal(result.status, 2, args.join(' '));
        assert.match(result.stderr, /--reason is required/);
        assert.equal((JSON.parse(result.stdout) as { fault: string }).fault, 'usage');
      }
      const both = clew(['spec', 'frames', 'set', '--frame', 'fr:s1.t7', '--role', 'actor', '--value', 'concept:clerk', '--unknown', '--reason', 'x']);
      assert.equal(both.status, 2);
      const set = clew(['spec', 'frames', 'set', '--frame', 'fr:s1.t7', '--role', 'actor', '--value', 'concept:clerk', '--reason', 'the clerk approves', '--by', 'reviewer', '--finding', 'f1', '--comment', 'checked', '--json']);
      assert.equal(set.status, 0, set.stderr);
      const written = (JSON.parse(set.stdout) as SpecFrameRefineDocument).frame?.roles.actor.history[0];
      assert.deepEqual([written?.who, written?.reason, written?.finding, written?.comment], ['reviewer', 'the clerk approves', 'f1', 'checked']);
      const noop = clew(['spec', 'frames', 'set', '--frame', 'fr:s1.t7', '--role', 'actor', '--value', 'concept:clerk', '--reason', 'again']);
      assert.equal(noop.status, 2);
      assert.match(noop.stderr, /already reads that value/);
    });
  });
});

let current: string | undefined;

function withSession(body: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'clew-refine-'));
  const previous = process.env.CLEW_DATA_DIR;
  process.env.CLEW_DATA_DIR = dir;
  current = dir;
  try {
    const file = join(dir, 'flow.md');
    writeFileSync(file, `${SPEC}\n`);
    assert.equal(initSpec({ file }, specTextSource, jsonSpecStore).exit, 'pass');
    assert.equal(tagSpec({}, jsonSpecStore, compromiseTagger).exit, 'pass');
    assert.equal(listFrames({}, jsonSpecStore).exit, 'pass');
    body();
  } finally {
    if (previous === undefined) delete process.env.CLEW_DATA_DIR;
    else process.env.CLEW_DATA_DIR = previous;
    current = undefined;
    rmSync(dir, { recursive: true, force: true });
  }
}

function set(command: Omit<SetRoleCommand, 'reason'>): Outcome<SpecFrameRefineDocument> {
  return setFrameRole({ ...command, reason: 'test write' }, jsonSpecStore);
}

function snapshot(): SpecSnapshot {
  const loaded = jsonSpecStore.update('flow', { create: false }, () => undefined);
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.message);
  return loaded.snapshot;
}

function listed(): Frame[] {
  return snapshot().frames ?? [];
}

function frame(frames: readonly Frame[], id: string): Frame {
  const found = frames.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
}

function text(role: Role | undefined): string {
  return role === undefined || role === 'unknown' ? 'unknown' : role.text;
}

function issues(outcome: Outcome<{ issues: { message: string }[] }>): string {
  return outcome.document.issues.map((issue) => issue.message).join('; ');
}

function historyLines(): { command: string; args: { finding?: string }; after: string[] }[] {
  const file = join(specSessionDir('flow'), 'history.jsonl');
  return readFileSync(file, 'utf8').trim().split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as { command: string; args: { finding?: string }; after: string[] });
}

function clew(args: string[]): { status: number; stdout: string; stderr: string } {
  const env = Object.assign({}, process.env);
  if (current !== undefined) env.CLEW_DATA_DIR = current;
  const result = spawnSync(tsx, ['src/cli.ts', ...args], { cwd: root, env, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}
