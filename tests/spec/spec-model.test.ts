import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assembleSpec, can, enabled, specInvariantIssues, step, type Action, type SpecDraft } from '../../src/domain/spec-model.js';
import { eventName, makeValuation, valueOf, varId, type Valuation } from '../../src/domain/valuation.js';

const phase = varId('phase');
const listed = varId('listed');
const title = varId('title');

const submit: Action = {
  event: eventName('SUBMIT'),
  actor: 'user',
  when: {
    op: 'and',
    of: [
      { op: 'eq', var: phase, value: valueOf('atom', 'draft') },
      { op: 'neq', var: title, value: valueOf('atom', '') },
    ],
  },
  assign: { phase: valueOf('atom', 'todo'), listed: valueOf('boolean', true) },
};

function draftOf(actions: readonly Action[], initialTitle = ''): SpecDraft {
  return {
    id: 'todoTask',
    vars: [
      { id: phase, type: 'atom' },
      { id: listed, type: 'boolean' },
      { id: title, type: 'atom' },
    ],
    initial: {
      phase: valueOf('atom', 'draft'),
      listed: valueOf('boolean', false),
      title: valueOf('atom', initialTitle),
    },
    actions,
    labels: [{ id: 'draft', match: { phase: valueOf('atom', 'draft') }, text: 'Draft' }],
  };
}

function titledDraft(): Valuation {
  const vars = draftOf([]).vars;
  return makeValuation(
    vars,
    new Map([
      [phase, valueOf('atom', 'draft')],
      [listed, valueOf('boolean', false)],
      [title, valueOf('atom', 'buy milk')],
    ]),
  );
}

describe('spec invariants', () => {
  test('rejects a missing initial variable', () => {
    const draft = draftOf([submit]);
    const broken: SpecDraft = {
      id: draft.id,
      vars: draft.vars,
      initial: { phase: valueOf('atom', 'draft'), listed: valueOf('boolean', false) },
      actions: draft.actions,
      labels: draft.labels,
    };
    const issues = specInvariantIssues(broken);
    assert.equal(issues.some((issue) => issue.message.includes('missing variable "title"')), true);
  });

  test('rejects an assign key that is not a var', () => {
    const draft = draftOf([{
      event: eventName('SUBMIT'),
      actor: 'user',
      when: { op: 'true' },
      assign: { priority: valueOf('atom', 'high') },
    }]);
    const issues = specInvariantIssues(draft);
    assert.equal(issues.some((issue) => issue.message.includes('unknown variable "priority"')), true);
  });

  test('assembleSpec builds a total initial valuation', () => {
    const spec = assembleSpec(draftOf([submit]));
    assert.equal(spec.initial.get(phase).t, 'atom');
    assert.deepEqual(spec.initial.get(listed), valueOf('boolean', false));
    assert.deepEqual(spec.initial.get(title), valueOf('atom', ''));
  });
});

describe('enabled / can / step', () => {
  test('SUBMIT is disabled on an empty-title draft and enabled after a title', () => {
    const spec = assembleSpec(draftOf([submit]));
    assert.equal(can(spec, spec.initial, eventName('SUBMIT')), false);
    assert.equal(enabled(spec, spec.initial).length, 0);
    assert.equal(step(spec, spec.initial, eventName('SUBMIT')), null);

    const ready = titledDraft();
    assert.equal(can(spec, ready, eventName('SUBMIT')), true);
    const next = step(spec, ready, eventName('SUBMIT'));
    assert.ok(next);
    assert.deepEqual(next.get(phase), valueOf('atom', 'todo'));
    assert.deepEqual(next.get(listed), valueOf('boolean', true));
    assert.deepEqual(next.get(title), valueOf('atom', 'buy milk'));
  });

  test('step leaves unmentioned vars unchanged', () => {
    const spec = assembleSpec(draftOf([{
      event: eventName('LIST'),
      actor: 'user',
      when: { op: 'true' },
      assign: { listed: valueOf('boolean', true) },
    }]));
    const next = step(spec, spec.initial, eventName('LIST'));
    assert.ok(next);
    assert.deepEqual(next.get(phase), valueOf('atom', 'draft'));
    assert.deepEqual(next.get(title), valueOf('atom', ''));
  });
});
