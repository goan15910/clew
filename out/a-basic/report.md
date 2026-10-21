# Verification report: a-basic

Machine: `candidates/a-basic.machine.ts`  
Schema: valid. Result: **5/8 workflows pass**.

- Reachable states: 7/7
- Dead ends (non-final, no way out): none
- Final states: Archived, Deleted
- Transitions not exercised by any workflow: todo --SNOOZE--> snoozed

| Workflow | Expect | Result | Path / reason |
|---|---|---|---|
| W1 Create and complete a task | accepted | PASS | `draft SUBMIT→todo START→inProgress COMPLETE→done`<br>path found by @xstate/graph getPathsFromEvents, ends in Done |
| W2 Snooze and resume | accepted | PASS | `draft SUBMIT→todo START→inProgress SNOOZE→snoozed RESUME→inProgress COMPLETE→done`<br>path found by @xstate/graph getPathsFromEvents, ends in Done |
| W3 Reopen a done task | accepted | PASS | `draft SUBMIT→todo START→inProgress COMPLETE→done REOPEN→todo`<br>path found by @xstate/graph getPathsFromEvents, ends in Todo |
| W4 Archive a done task | accepted | PASS | `draft SUBMIT→todo START→inProgress COMPLETE→done ARCHIVE→archived`<br>path found by @xstate/graph getPathsFromEvents, ends in Archived |
| W5 Delete a draft | accepted | PASS | `draft DELETE→deleted`<br>path found by @xstate/graph getPathsFromEvents, ends in Deleted |
| W6 Restore a deleted task | accepted | **FAIL** | `draft SUBMIT→todo DELETE→deleted RESTORE✗`<br>step 3 "Restore it from the trash": Deleted does not accept RESTORE (it is a final state) |
| W7 Complete without starting | accepted | **FAIL** | `draft SUBMIT→todo COMPLETE✗`<br>step 2 "Tick it done straight away": Todo does not accept COMPLETE (it accepts START, SNOOZE, DELETE) |
| W8 Rule: unfinished task cannot be archived | rejected | **FAIL** | `draft SUBMIT→todo START→inProgress ARCHIVE→archived`<br>should have been refused at step 3 (ARCHIVE) but the model allows the whole sequence, ending in Archived |
