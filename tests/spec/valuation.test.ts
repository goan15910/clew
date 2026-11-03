import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  apply,
  eventName,
  explore,
  holds,
  makeValuation,
  sameValuation,
  valuationId,
  varId,
  valueOf,
  witness,
  type Predicate,
  type Valuation,
  type VarDecl,
} from '../../src/domain/valuation.js';

const vars: VarDecl[] = [
  { id: varId('phase'), type: 'atom' },
  { id: varId('listed'), type: 'boolean' },
];

function valuation(phase: string, listed: boolean): Valuation {
  const entries = new Map([
    [varId('phase'), valueOf('atom', phase)],
    [varId('listed'), valueOf('boolean', listed)],
  ]);
  return makeValuation(vars, entries);
}

describe('valuation identity', () => {
  test('same pairs share one id regardless of insertion order', () => {
    const a = valuation('draft', false);
    const flipped = new Map([
      [varId('listed'), valueOf('boolean', false)],
      [varId('phase'), valueOf('atom', 'draft')],
    ]);
    const b = makeValuation(vars, flipped);
    assert.equal(a.id, b.id);
    assert.equal(sameValuation(a, b), true);
    assert.equal(
      valuationId([
        [varId('listed'), valueOf('boolean', false)],
        [varId('phase'), valueOf('atom', 'draft')],
      ]),
      a.id,
    );
  });

  test('different assignments are different states', () => {
    const a = valuation('draft', false);
    const b = valuation('todo', true);
    assert.notEqual(a.id, b.id);
  });
});

describe('apply', () => {
  test('updates named vars and leaves the rest unchanged', () => {
    const before = valuation('draft', false);
    const after = apply(before, { phase: valueOf('atom', 'todo') });
    assert.equal(after.get(varId('phase')).t, 'atom');
    assert.deepEqual(after.get(varId('phase')), valueOf('atom', 'todo'));
    assert.deepEqual(after.get(varId('listed')), valueOf('boolean', false));
    assert.notEqual(before.id, after.id);
  });

  test('empty patch yields the same identity', () => {
    const before = valuation('draft', false);
    const after = apply(before, {});
    assert.equal(after.id, before.id);
  });

  test('rejects unknown patch keys', () => {
    const before = valuation('draft', false);
    assert.throws(() => apply(before, { title: valueOf('atom', 'x') }), /unknown variable/);
  });
});

describe('holds', () => {
  test('eq and and', () => {
    const state = valuation('draft', false);
    const predicate: Predicate = {
      op: 'and',
      of: [
        { op: 'eq', var: varId('phase'), value: valueOf('atom', 'draft') },
        { op: 'eq', var: varId('listed'), value: valueOf('boolean', false) },
      ],
    };
    assert.equal(holds(predicate, state), true);
    assert.equal(holds({ op: 'neq', var: varId('phase'), value: valueOf('atom', 'draft') }, state), false);
  });
});

describe('explore and witness', () => {
  test('three-variable toy graph', () => {
    const draft = valuation('draft', false);
    const todo = valuation('todo', true);
    const done = valuation('done', true);
    const submit = eventName('SUBMIT');
    const complete = eventName('COMPLETE');

    const graph = explore(
      [draft],
      (state) => {
        if (state.id === draft.id) return [{ event: submit, to: apply(state, { phase: valueOf('atom', 'todo'), listed: valueOf('boolean', true) }) }];
        if (state.id === todo.id) return [{ event: complete, to: apply(state, { phase: valueOf('atom', 'done') }) }];
        return [];
      },
      100,
    );

    assert.equal(graph.truncated, false);
    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.edges.length, 2);
    assert.ok(graph.nodes.some((node) => node.id === done.id));

    const path = witness(
      [draft],
      (state) => {
        if (state.id === draft.id) return [{ event: submit, to: todo }];
        if (state.id === todo.id) return [{ event: complete, to: done }];
        return [];
      },
      (state) => state.id === done.id,
      100,
    );
    assert.ok(path);
    assert.deepEqual(path.events, [submit, complete]);
  });

  test('truncates at bound', () => {
    const start = valuation('draft', false);
    const graph = explore(
      [start],
      (state) => {
        const listed = state.get(varId('listed'));
        const nextListed = listed.t === 'bool' ? !listed.v : true;
        return [
          {
            event: eventName('FLIP'),
            to: apply(state, { listed: valueOf('boolean', nextListed) }),
          },
        ];
      },
      1,
    );
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.truncated, true);
  });
});

describe('makeValuation', () => {
  test('requires every declared var', () => {
    const entries = new Map([[varId('phase'), valueOf('atom', 'draft')]]);
    assert.throws(() => makeValuation(vars, entries), /missing variable/);
  });
});
