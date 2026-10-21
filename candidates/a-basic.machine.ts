// Candidate A ("basic"), written by the agent in stage 2. EXAMPLE DATA.
// Deliberately weaker: no trash (delete is permanent), a task must be started
// before it can be completed, and archive is allowed from In Progress.
import { createMachine } from 'xstate';

export default createMachine({
  id: 'todoTask',
  initial: 'draft',
  states: {
    draft: {
      meta: { label: 'Draft', workflowState: 'editing', data: 'title set, not in list' },
      on: {
        SUBMIT: { target: 'todo', meta: { actor: 'user', guard: 'title not empty', effect: 'listed = true' } },
        DELETE: { target: 'deleted', meta: { actor: 'user', effect: 'row removed' } },
      },
    },
    todo: {
      meta: { label: 'Todo', workflowState: 'open', data: 'listed, started_at = null' },
      on: {
        START: { target: 'inProgress', meta: { actor: 'user', effect: 'started_at = now' } },
        SNOOZE: { target: 'snoozed', meta: { actor: 'user', effect: 'wake_at = chosen time' } },
        DELETE: { target: 'deleted', meta: { actor: 'user', effect: 'row removed' } },
      },
    },
    inProgress: {
      meta: { label: 'In Progress', workflowState: 'active', data: 'started_at set' },
      on: {
        SNOOZE: { target: 'snoozed', meta: { actor: 'user', effect: 'wake_at = chosen time' } },
        COMPLETE: { target: 'done', meta: { actor: 'user', effect: 'completed_at = now' } },
        ARCHIVE: { target: 'archived', meta: { actor: 'user', effect: 'listed = false' } },
      },
    },
    snoozed: {
      meta: { label: 'Snoozed', workflowState: 'paused', data: 'wake_at set, hidden' },
      on: {
        RESUME: { target: 'inProgress', meta: { actor: 'user or timer', effect: 'wake_at = null' } },
      },
    },
    done: {
      meta: { label: 'Done', workflowState: 'closed', data: 'completed_at set' },
      on: {
        REOPEN: { target: 'todo', meta: { actor: 'user', effect: 'completed_at = null' } },
        ARCHIVE: { target: 'archived', meta: { actor: 'user', effect: 'listed = false' } },
      },
    },
    archived: {
      type: 'final',
      meta: { label: 'Archived', workflowState: 'kept', data: 'listed = false, read-only' },
    },
    deleted: {
      type: 'final',
      meta: { label: 'Deleted', workflowState: 'gone', data: 'row removed' },
    },
  },
});
