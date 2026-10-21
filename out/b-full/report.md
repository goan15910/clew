# Verification report: b-full

Machine: `candidates/b-full.machine.ts`  
Schema: valid. Result: **8/8 workflows pass**.

- Reachable states: 7/7
- Dead ends (non-final, no way out): none
- Final states: none
- Transitions not exercised by any workflow: todo --SNOOZE--> snoozed; archived --UNARCHIVE--> done

| Workflow | Expect | Result | Path / reason |
|---|---|---|---|
| W1 Create and complete a task | accepted | PASS | `draft SUBMIT→todo START→inProgress COMPLETE→done`<br>path found by @xstate/graph getPathsFromEvents, ends in Done |
| W2 Snooze and resume | accepted | PASS | `draft SUBMIT→todo START→inProgress SNOOZE→snoozed RESUME→inProgress COMPLETE→done`<br>path found by @xstate/graph getPathsFromEvents, ends in Done |
| W3 Reopen a done task | accepted | PASS | `draft SUBMIT→todo START→inProgress COMPLETE→done REOPEN→todo`<br>path found by @xstate/graph getPathsFromEvents, ends in Todo |
| W4 Archive a done task | accepted | PASS | `draft SUBMIT→todo START→inProgress COMPLETE→done ARCHIVE→archived`<br>path found by @xstate/graph getPathsFromEvents, ends in Archived |
| W5 Delete a draft | accepted | PASS | `draft DELETE→deleted`<br>path found by @xstate/graph getPathsFromEvents, ends in Deleted |
| W6 Restore a deleted task | accepted | PASS | `draft SUBMIT→todo DELETE→deleted RESTORE→todo`<br>path found by @xstate/graph getPathsFromEvents, ends in Todo |
| W7 Complete without starting | accepted | PASS | `draft SUBMIT→todo COMPLETE→done`<br>path found by @xstate/graph getPathsFromEvents, ends in Done |
| W8 Rule: unfinished task cannot be archived | rejected | PASS | `draft SUBMIT→todo START→inProgress ARCHIVE✗`<br>correctly refused: step 3 "Try to archive it before it is done": In Progress does not accept ARCHIVE (it accepts SNOOZE, COMPLETE) |
