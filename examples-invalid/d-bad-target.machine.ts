// Broken copy of candidate B (schema-check demo): bad target state.
// Adds a trash (Deleted can be restored), lets a Todo task be completed
// directly, allows un-archiving, and only allows archive from Done.
import { createMachine } from 'xstate';

export default createMachine({
  id: 'todoTask',
  initial: 'draft',
  states: {
    draft: {
      meta: { label: 'Draft', workflowState: 'editing', data: 'title set, not in list' },
      on: {
        SUBMIT: { target: 'todo', meta: { actor: 'user', guard: 'title not empty', effect: 'listed = true' } },
        DELETE: { target: 'deleted', meta: { actor: 'user', effect: 'deleted_at = now' } },
      },
    },
    todo: {
      meta: { label: 'Todo', workflowState: 'open', data: 'listed, started_at = null' },
      on: {
        START: { target: 'inProgress', meta: { actor: 'user', effect: 'started_at = now' } },
        COMPLETE: { target: 'done', meta: { actor: 'user', effect: 'completed_at = now' } },
        SNOOZE: { target: 'snoozed', meta: { actor: 'user', effect: 'wake_at = chosen time' } },
        DELETE: { target: 'deleted', meta: { actor: 'user', effect: 'deleted_at = now' } },
      },
    },
    inProgress: {
      meta: { label: 'In Progress', workflowState: 'active', data: 'started_at set' },
      on: {
        SNOOZE: { target: 'snoozed', meta: { actor: 'user', effect: 'wake_at = chosen time' } },
        COMPLETE: { target: 'done', meta: { actor: 'user', effect: 'completed_at = now' } },
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
        ARCHIVE: { target: 'archive', meta: { actor: 'user', guard: 'completed_at set', effect: 'listed = false' } },
      },
    },
    archived: {
      meta: { label: 'Archived', workflowState: 'kept', data: 'listed = false, read-only' },
      on: {
        UNARCHIVE: { target: 'done', meta: { actor: 'user', effect: 'listed = true' } },
      },
    },
    deleted: {
      meta: { label: 'Deleted', workflowState: 'in trash', data: 'deleted_at set, hidden' },
      on: {
        RESTORE: { target: 'todo', meta: { actor: 'user', effect: 'deleted_at = null' } },
      },
    },
  },
});
