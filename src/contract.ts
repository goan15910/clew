// Turns an XState machine into a flat, schema-checked contract (states + transitions).
import { z } from 'zod';
import type { AnyStateMachine } from 'xstate';

export const StateSchema = z.strictObject({
  id: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  label: z.string().min(1),
  workflowState: z.string().min(1),
  data: z.string().min(1),
  final: z.boolean(),
});
export const TransitionSchema = z.strictObject({
  from: z.string(),
  event: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'events are UPPER_SNAKE_CASE'),
  to: z.string(),
  actor: z.string().min(1),
  guard: z.string().optional(),
  effect: z.string().min(1),
});
export const ContractSchema = z
  .strictObject({
    id: z.string(),
    initial: z.string(),
    states: z.array(StateSchema).min(1),
    transitions: z.array(TransitionSchema),
  })
  .superRefine((c, ctx) => {
    const ids = new Set(c.states.map((s) => s.id));
    if (!ids.has(c.initial)) ctx.addIssue({ code: 'custom', message: `initial state "${c.initial}" is not defined` });
    for (const t of c.transitions) {
      if (!ids.has(t.to)) ctx.addIssue({ code: 'custom', message: `${t.from} --${t.event}--> unknown state "${t.to}"` });
      const st = c.states.find((s) => s.id === t.from);
      if (st?.final) ctx.addIssue({ code: 'custom', message: `final state "${t.from}" must not have outgoing transitions` });
    }
  });
export type Contract = z.infer<typeof ContractSchema>;
export type Transition = z.infer<typeof TransitionSchema>;

/** Read the machine's own definition (states, meta, transitions) into a plain object. */
export function extractContract(machine: AnyStateMachine): unknown {
  const root = machine.root;
  if (root.type !== 'compound') throw new Error('prototype supports one flat compound machine (no nested/parallel yet)');
  const states: unknown[] = [];
  const transitions: unknown[] = [];
  for (const node of Object.values(root.states) as any[]) {
    if (node.type === 'compound' || node.type === 'parallel') throw new Error(`nested state "${node.key}" not supported in prototype`);
    const meta = node.meta ?? {};
    states.push({ id: node.key, label: meta.label, workflowState: meta.workflowState, data: meta.data, final: node.type === 'final' });
    for (const [event, defs] of node.transitions as Map<string, any[]>) {
      for (const d of defs) {
        const tm = d.meta ?? {};
        const t: Record<string, unknown> = { from: node.key, event, to: d.target?.[0]?.key, actor: tm.actor, effect: tm.effect };
        if (tm.guard !== undefined) t.guard = tm.guard;
        transitions.push(t);
      }
    }
  }
  return { id: machine.id, initial: (root.initial as any)?.target?.[0]?.key, states, transitions };
}
