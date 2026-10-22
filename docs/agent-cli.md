# Agent CLI

Clew’s primary user is an agent. Each command does one thing, prints a JSON document on stdout when given `--json`, writes errors to stderr, and exits with a stable code. Commands do not prompt. An agent composes them: the output of one command is a file the next command can read, including a selection of named sub-graphs.

Nested and parallel states are out of scope. Zod runs only while reading a YAML or JSON file or the command line. Domain objects are built field by field.

## Decisions

**`compare` is kept, and it no longer replays.** It ranks JSON documents produced by `clew verify --json`. An agent verifies each candidate, then compares those documents. The candidate name is the chart file’s basename (`examples/todo/b-full.yaml` is `b-full`), carried on the verify document, because two charts can share one chart id.

**The chart-to-workflow mapping is its own file.** `chart check`, `chart analyze`, and `workflows check` do not take it. Only `verify` does. The chart does not store workflow names, and the workflow set does not store chart names.

**The first analyses are the chart-only checks already in Clew:** states reachable from the initial state, unreachable states, dead ends (non-final states with no outgoing transition), and the shortest event path to each reachable state. Transitions no selected flow exercises are reported by `verify`, because that check needs a workflow set. Further analyses are not in this command set.

**A workflow set is a meta-graph of named linked lists.** The file has an `id` and a `workflows` array. Each workflow has a unique `id` (the sub-graph name), nodes, and edges. Node ids are unique inside that workflow. A node’s `state` is the shared workflow vocabulary, so a list may visit the same state twice under two node ids. Edges form a single path from `start`: one head, one outgoing edge, one incoming edge, no cycles, no disconnected nodes. Walk order follows the links, not the order of the YAML list. There is no reader for the old `machineId` / `steps` / `end` shape. Those files fail schema validation with a migration hint.

**`machineId` is not compared.** It was removed. `verify` compares the mapping’s `chart` to the chart id and the mapping’s `workflowSet` to the workflow-set id. A mismatch is exit 2.

## Commands

```bash
clew chart check <chart.yaml> [--json]
clew chart analyze <chart.yaml> [--json]
clew workflows check <set.yaml> [--json]
clew verify <chart.yaml> <set.yaml> <mapping.yaml> [--flow <id>] [--select <file>] [--highlight <id>] [--out <dir>] [--json]
clew compare <verify.json>... [--out <dir>] [--json]
```

`--flow` is repeatable. `--select` reads a JSON file. Passing neither verifies every workflow, in file order. Passing both unions them, `--flow` first, dropping duplicates. `--select -` is rejected: Clew never reads stdin, so it cannot wait for input.

`--out` is optional. Reports and Graphviz charts are written only when it is set.

### Selection

`workflows check --json` lists every named sub-graph. That document is a valid `--select` file. A shorter selection is also accepted:

```json
{ "flows": ["W8"] }
```

Unknown ids, a failing check document, and a file that is neither shape are exit 2. Ids are the workflow `id`s, not node ids.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Chart schema and graph are valid; or the analysis is clean; or the workflow set is valid; or every selected flow passed; or compare has a winner |
| 1 | Schema or graph is invalid; or the analysis found an unreachable state or a dead end; or a selected flow failed; or compare has no winner |
| 2 | The file is missing or is not YAML/JSON; arguments are wrong; the chart is too invalid to analyze; the mapping does not apply; the selection names a missing flow |

Schema is checked before the graph. Graph findings are produced only after the schema is valid (`graphChecked` tells them apart). YAML and JSON syntax errors are exit 2: there is no document to judge yet.

On exit 2 the messages go to stderr. `--json` also prints a document on stdout. Exit 1 is a result, so the findings are on stdout and stderr stays empty.

## Data model

**Chart.** Unchanged aside from the removed `workflowState` field: `id`, `initial`, `guards`, `effects`, `states` (`id`, `label`, `final`, `data`), `transitions` (`from`, `event`, `to`, `actor`, `guard`, `effect`). State ids are camelCase. Events are `UPPER_SNAKE_CASE`.

**Workflow set.**

```yaml
id: todoFlows
workflows:
  - id: W2
    title: Snooze and resume
    expect: accepted
    start: edit
    nodes:
      - { id: edit, state: editing }
      - { id: working, state: active }
      - { id: snoozed, state: paused }
      - { id: resumed, state: active }
    edges:
      - { from: edit, event: submit, to: working, text: "Start it" }
      - { from: working, event: snooze, to: snoozed, text: "Snooze" }
      - { from: snoozed, event: resume, to: resumed, text: "Resume" }
```

`expect: rejected` adds `rejectAt` (1-based index in walk order) and must not be combined with an accepted flow. Workflow ids match `^[A-Za-z][A-Za-z0-9_-]*$`. State names, node ids, and events match `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. That vocabulary is deliberately not the chart’s.

**Mapping.**

```yaml
chart: todoTask
workflowSet: todoFlows
states:
  - { chart: draft, workflow: editing }
events:
  - { chart: SUBMIT, workflow: submit }
```

The workflow side is a function: one workflow state or event names one chart state or event. Several workflow names may share a chart name. Rows a selected flow does not use are not checked, so a partial mapping can prove one flow. A mapped chart state that is not on the chart is exit 2. A mapped chart event that the chart never declares is a failed flow (exit 1), which is how a weaker candidate such as `a-basic` shares a mapping with `b-full`.

A flow may start at any mapped chart state. Flows that start at the chart’s initial state are also proved with `@xstate/graph` `getPathsFromEvents`. Other flows are proved by replay.

## JSON documents

These are shapes. Captured command output is in the pull request. Every `--json` document has `command` and `ok`. `issues` is an array of `{ "kind", "file", "path", "message" }`. `kind` is `schema`, `graph`, `input`, or `mapping`. A verify trace lists every attempted step.

`chart.check`, valid:

```json
{
  "command": "chart.check",
  "ok": true,
  "graphChecked": true,
  "chart": {
    "id": "todoTask",
    "initial": "draft",
    "states": [{ "id": "draft", "label": "Draft", "final": false }],
    "transitions": [{ "from": "draft", "event": "SUBMIT", "to": "todo" }]
  },
  "issues": []
}
```

`chart.analyze`, when the chart is valid:

```json
{
  "command": "chart.analyze",
  "ok": true,
  "clean": true,
  "chartId": "todoTask",
  "structure": {
    "reachable": ["draft"],
    "unreachable": [],
    "deadEnds": [],
    "shortestPaths": { "draft": [] }
  },
  "issues": []
}
```

`ok` means the analysis ran. `clean` is false, and the exit code is 1, when `unreachable` or `deadEnds` is non-empty. An invalid chart is exit 2 with `fault: "invalid-chart"` and no `structure`.

`workflows.check`, valid, is the selection document. `nodes` and `edges` are in walk order:

```json
{
  "command": "workflows.check",
  "ok": true,
  "graphChecked": true,
  "id": "todoFlows",
  "workflowSet": {
    "id": "todoFlows",
    "workflows": [
      {
        "id": "W1",
        "title": "Create and complete a task",
        "expect": "accepted",
        "start": "edit",
        "nodes": [{ "id": "edit", "state": "editing" }],
        "edges": [
          {
            "from": "edit",
            "event": "submit",
            "to": "listed",
            "text": "Add the draft to my list",
            "stateFrom": "editing",
            "stateTo": "open"
          }
        ]
      }
    ]
  },
  "issues": []
}
```

`verify`:

```json
{
  "command": "verify",
  "ok": false,
  "candidate": "a-basic",
  "chartId": "todoTask",
  "workflowSetId": "todoFlows",
  "selected": ["W8"],
  "summary": { "passed": 0, "failed": 1, "total": 1 },
  "flows": [
    {
      "id": "W8",
      "title": "Unfinished task cannot be archived",
      "expect": "rejected",
      "pass": false,
      "reason": "should have been refused at step 3",
      "provedBy": "replay",
      "finalState": { "chart": "archived", "workflow": "kept" },
      "trace": [
        {
          "n": 3,
          "text": "Try to archive it before it is done",
          "accepted": true,
          "workflow": { "from": "active", "event": "archive", "to": "kept" },
          "chart": { "from": "inProgress", "event": "ARCHIVE", "to": "archived" }
        }
      ]
    }
  ],
  "unusedTransitions": [],
  "issues": []
}
```

`ok` is true only when every selected flow passed. `unusedTransitions` does not change the exit code. Preconditions (`fault` of `unreadable`, `invalid-chart`, `invalid-workflows`, `invalid-mapping`, `mismatch`, `selection`, or `mapping-gap`) are exit 2 and omit `flows`.

`compare`:

```json
{
  "command": "compare",
  "ok": true,
  "winner": "b-full",
  "candidates": [
    { "name": "b-full", "chartId": "todoTask", "ok": true, "passed": 8, "total": 8, "failures": [] }
  ],
  "issues": []
}
```

`candidate` is the chart file’s basename. Compare reads that field; the JSON file’s own name is not the candidate name.

The winner is the first candidate, in argument order after the pass-count sort, that passed every flow. Another candidate’s failures do not disqualify it. A tie keeps argument order. A document that is not a consistent verify result is exit 2.

Bad arguments, when `--json` was passed, use `{ "command", "ok": false, "fault": "usage", "issues" }` and exit 2.

## Migration

| Old | New |
|---|---|
| `machineId` on the workflow file | Removed. Not compared. The mapping file names `chart` and `workflowSet`. The set has its own `id`. |
| `workflowState` on a chart state | Removed. State pairs live under `mapping.states`. |
| `steps: [{ text, event }]` and `end` | `nodes` (`id`, `state`) and `edges` (`from`, `event`, `to`, `text`). `start` is the head. The old `end` is the state of the last node. |
| One implicit chain from the chart’s initial state | The list may start at any mapped state. Revisiting a state uses a second node id with the same `state`. |
| `clew verify chart workflows` and `clew compare workflows chart...` | `clew verify chart workflows mapping`. `clew compare` reads verify JSON files. |

`examples/todo/workflows.yaml` is the migrated to-do set: eight named sub-graphs. `examples/todo/a-basic.yaml` fails W6, W7, and W8. `examples/todo/b-full.yaml` passes all eight. The old `machineId` / `steps` / `end` shape and a chart that still carries `workflowState` are `tests/fixtures/workflows/legacy.yaml` and `tests/fixtures/charts/legacy-chart.yaml`. Those files fail schema validation with a migration hint. Other boundary files (a dead end, a branching list, a misspelled state, an effect that sets an undeclared field) are under `tests/fixtures/` and are covered by the Venom suites.

## Results on GitHub

The Venom suites run in the `venom` workflow on pull requests and on `main`. Open that run and read the venom job summary: one row per suite (suite, tests, passed, failed, time) and a collapsible section per suite. Failures come first and include the assertion text.

A failing test is an annotation on the run and on the pull request, on the test's line in `tests/venom/`. The `venom-report` artifact on the same run holds the JUnit XML, the HTML report, and `venom.log`. The artifact is kept for 14 days.
