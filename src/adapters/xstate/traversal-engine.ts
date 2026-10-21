// Flat XState machine plus @xstate/graph. Nested and parallel states are out of scope.
import { getPathsFromEvents, getShortestPaths } from '@xstate/graph';
import { createMachine, transition, type AnyStateMachine } from 'xstate';
import type { TraversalEngine } from '../../application/ports.js';
import type { Model } from '../../domain/model.js';
import type { EventPath, Traversal } from '../../domain/traversal.js';

function buildMachine(model: Model): AnyStateMachine {
  const configStates: Record<string, { type: 'final' } | { on: Record<string, { target: string }> }> = {};
  for (const state of model.states()) {
    if (state.final) {
      configStates[state.id] = { type: 'final' };
      continue;
    }
    const on: Record<string, { target: string }> = {};
    for (const edge of model.transitions()) {
      if (edge.from === state.id) on[edge.event] = { target: edge.to };
    }
    configStates[state.id] = { on };
  }
  // The state map is built key by key above. createMachine's generics cannot name that map.
  return createMachine({ id: model.id, initial: model.initial, states: configStates } as Parameters<typeof createMachine>[0]);
}

function eventList(model: Model): { type: string }[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const edge of model.transitions()) {
    if (seen.has(edge.event)) continue;
    seen.add(edge.event);
    names.push(edge.event);
  }
  return names.map((type) => ({ type }));
}

function eventsOf(steps: readonly { event: { type: string } }[]): string[] {
  const events: string[] = [];
  for (const step of steps) {
    if (step.event.type !== 'xstate.init') events.push(step.event.type);
  }
  return events;
}

function createTraversal(model: Model): Traversal {
  const machine = buildMachine(model);
  const ids = new Set(model.states().map((state) => state.id));
  const events = eventList(model);

  // AnyStateMachine's resolveState requires context in its public type. Flat models have none.
  const snapshot = (state: string) => machine.resolveState({ value: state, context: {} });

  return {
    can(state, event) {
      if (!ids.has(state)) return false;
      return snapshot(state).can({ type: event });
    },
    step(state, event) {
      if (!ids.has(state) || !snapshot(state).can({ type: event })) return null;
      const [next] = transition(machine, snapshot(state), { type: event });
      if (typeof next.value !== 'string') throw new Error('nested and parallel states are out of scope');
      return next.value;
    },
    shortestPaths() {
      const paths = getShortestPaths(machine, { events });
      const shortest: Record<string, readonly string[]> = {};
      for (const path of paths) {
        if (typeof path.state.value !== 'string') throw new Error('nested and parallel states are out of scope');
        shortest[path.state.value] = eventsOf(path.steps);
      }
      return shortest;
    },
    pathsFromEvents(sequence) {
      const paths = getPathsFromEvents(machine, sequence.map((type) => ({ type })));
      const found: EventPath[] = [];
      for (const path of paths) {
        if (typeof path.state.value !== 'string') throw new Error('nested and parallel states are out of scope');
        found.push({ state: path.state.value, events: eventsOf(path.steps) });
      }
      return found;
    },
  };
}

export const xstateTraversalEngine: TraversalEngine = {
  open(model) {
    return createTraversal(model);
  },
};
