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
clew spec init <spec.md> [--session <id>] [--json]
clew spec tag [--session <id>] [--sentence <id>] [--json]
clew spec entities list [--kind actor] [--status candidate] [--session <id>] [--json]
clew spec entities merge --into <id> --id <id> [--session <id>] [--json]
clew spec entities rename --id <id> (--name <name> | --text <text>) [--session <id>] [--json]
clew spec entities reject --id <id> [--reason <text>] [--session <id>] [--json]
clew spec entities promote --id <id> [--kind actor] [--session <id>] [--json]
clew spec facts propose [--sentence <id>] [--session <id>] [--json]
clew spec facts add (--type <type> ... | --from <file.json>) [--session <id>] [--json]
clew spec facts edit (--id <id> ... | --from <file.json>) [--session <id>] [--json]
clew spec facts remove (--id <id> ... | --from <file.json>) [--session <id>] [--json]
clew spec trace <id> [--session <id>] [--json]
clew spec status [--session <id>] [--json]
```

`--flow` is repeatable. `--select` reads a JSON file. Passing neither verifies every workflow, in file order. Passing both unions them, `--flow` first, dropping duplicates. `--select -` is rejected: Clew never reads stdin, so it cannot wait for input.

`--out` is optional. Reports and Graphviz charts are written only when it is set.

### Spec

`spec init` and `spec tag` split a plain-English spec and tag it. `spec entities` and `spec facts` turn those tokens into candidates and typed claims, and `spec trace` and `spec status` read the result back. The draft graph and emit are not in this version. Clew does not call a language model. The tagger and the proposal rules are a starting point; the calling agent is the guard.

`spec init <spec.md>` reads a Markdown or plain-text file and splits it into sentences. `-` is rejected: Clew never reads stdin. ATX headings (`#` through `######`) are section provenance on the following sentences, not sentences themselves. Fenced code blocks and HTML comments are skipped. Each sentence has an id (`s1`, `s2`, …), the exact source slice, a character span into the file, and a `sha256:` hash of that slice.

Running `spec init` again on the same file refreshes that session. Unchanged sentence text keeps its id. Changed or removed sentences stay in the store as `stale` and are reported. They are not deleted. A sentence that comes back with the same hash is revived, and token spans shift if the text moved in the file.

`spec tag` runs the part-of-speech tagger on the current sentences. `--sentence s3` tags only that sentence. The tagger is compromise, behind `PosTaggerPort`. `src/adapters/pos/compromise-tagger.ts` is the only file that imports it. The document names the tagger and its version. Running `tag` twice with the same tagger and the same sentences does not change the store. A token whose `origin` is `agent` is not overwritten; a disagreement is a `conflict` finding. Entity and fact edits are what set `origin` to `agent`.

`--session` selects a session. When it is omitted, Clew uses the only open session for this repo. Zero sessions, or more than one, is exit 2.

The session store is outside the repo. Nothing is written next to the spec, and there is nothing to commit. On Linux and macOS the base directory is `$XDG_DATA_HOME/clew`, or `~/.local/share/clew` when `XDG_DATA_HOME` is unset. On Windows it is `%LOCALAPPDATA%\clew`. `CLEW_DATA_DIR` overrides that base. Under it, sessions live at:

```txt
<repo-name>-<path-hash>/spec/<session-id>/
  session.json
  sentences.json
  tokens.json
  entities.json
  facts.json
  history.jsonl
  .lock
```

`<repo-name>` is the git root’s directory name (the working directory when there is no `.git`). `<path-hash>` is the first 12 hex characters of the SHA-256 of that directory’s real path. `<session-id>` defaults to the spec file’s basename. A `.lock` file is the single writer for that session. A lock whose process is gone is taken over. A live lock is exit 2.

`session.json` carries `schemaVersion`. This Clew reads schema 1. A different version is exit 2 and names the missing migration. The store adapter is the only place that validates that JSON with Zod.

Every spec document has `findings`. A finding is `{ id, kind, code, severity, message, refs }`. `kind` is `gap`, `conflict`, `stale`, `vocabulary`, or `coverage`. `severity` is `blocking`, `warning`, or `info`. `ok` means the layer was produced. It stays true when findings are present. Exit 0 means no blocking finding. Exit 1 means a blocking finding is in the document, and stderr stays empty. Warnings and info do not change the exit code.

`spec init` findings:

| Code | Severity | When |
|---|---|---|
| `no-sentences` | blocking | the file has no sentence text |
| `empty-sentence` | warning | a block had no sentence text |
| `non-english` | warning | a sentence uses a non-Latin script |
| `duplicate-sentence` | warning | the same sentence text appears twice |
| `stale-sentence` | warning | a previous sentence changed or was removed |

Latin-script languages are not detected. Translate those to plain English before `spec init`.

`spec tag` findings:

| Code | Severity | When |
|---|---|---|
| `no-verb` | warning | no token is tagged `Verb` |
| `no-actor` | warning | no token is tagged `Actor` |
| `condition-without-clause` | warning | the sentence says if, when, or unless, and the tagger returned one clause |
| `agent-tokens` | warning | agent-owned tokens were left in place |
| `tagger-version` | info | the stored tagger version differs from this one |
| `stale-sentence` | warning | a stale sentence is still in the session |

`spec entities list` derives candidates from the current tokens and writes them the first time. Running it again, when nothing changed, does not append history. `--kind` and `--status` filter the document. There is no separate extract command. Actor-tagged nouns become actors. Other nouns become objects, except pronouns, currency, units, determiners, and values, so "dollars" is skipped. Verbs become actions, except copulas, auxiliaries, and modals. An adjectival verb between a determiner and a noun ("a shipped order") is not an action. A sentence-initial “When” is a condition only when its clause has no content verb; mid-sentence if, when, and unless are conditions. Same-lemma nouns merge. A single token stays `origin: tagger`. Two sources of the same lemma are `origin: rule`.

`spec entities list` findings:

| Code | Severity | When |
|---|---|---|
| `unreviewed` | warning | a candidate has not been confirmed or rejected |
| `near-duplicate` | warning | two live names of the same kind differ by one edit, and both are at least four letters |
| `agent-entity` | warning | an agent-owned entity disagrees with the tokens and was left in place |

`spec entities merge` keeps `--into` and folds each `--id` into it. The ids must be the same kind, and the target must not be rejected. `rename` takes `--name` for an actor, object, or action, and `--text` for a condition. A name that is not workflow vocabulary is blocking and is not written. A name that only needs kebab-case is written, with an info `normalized-name` finding. `reject` sets `status: rejected`, keeps `origin`, and stores `note` as `agent: <reason>` when a reason is given. Facts that cite it become stale. `promote` confirms the entity. `--kind` changes the id prefix for actor, object, and action. A condition cannot change kind.

`spec entities` edit findings:

| Code | Severity | When |
|---|---|---|
| `merge-across-kinds` | blocking | a merge or a `--kind` change crosses kinds, including a condition |
| `rejected-entity` | blocking | the merge target is rejected |
| `vocabulary` | blocking | the new name cannot be workflow vocabulary |
| `duplicate-entity` | blocking | the new id already exists |
| `normalized-name` | info | the written name was normalized |
| `stale-fact` | warning | rejecting an entity marked the facts that cite it stale |

`spec facts propose` drafts facts from subject-verb-object frames, clause order, and condition markers. It does not overwrite `origin: agent`. A disagreement is `agent-fact`. Running it again, when nothing changed, does not append history. `--sentence s1` limits the proposal to that sentence. Emission order inside a sentence is performs, then transitions, then forbidden, then guards. The first transition on an object has `from: null` and confidence 0.5. A later transition in a When sentence takes the previous `to` as `from`, confidence 0.6. A past participle is the `to` state (`submit` becomes `submitted`; a surface form such as `cancelled` is kept). Negation (`cannot`, `not`, `never`) emits `forbidden` instead of a transition, and still emits `performs`. Passive voice takes the noun before the verb as the object and the actor after “by”. `initial` and `final` are not proposed. Removed facts stay in the store as tombstones (`removed: true`, `status: stale`, `origin: agent`) so a later propose does not recreate that signature. Documents omit removed facts. Adding a fact with a removed signature revives that id. Adding a live duplicate signature is a blocking `contradicting-facts` finding and does not write.

`spec facts add`, `edit`, and `remove` take flags or `--from <file>`. `--from -` is rejected. Flags and `--from` together are rejected. `--from-state` and `--to-state` name transition states, because `--from` is the patch file. `--source` and `--id` are repeatable on the commands that accept them. Confidence is a number from 0 to 1. An edit sets confidence to 1 unless the patch sets it. An unknown fact id is exit 2. A well-formed entity id that is not in the session is a blocking finding, not an input issue.

`spec facts propose` findings:

| Code | Severity | When |
|---|---|---|
| `transition-without-from` | warning | a current transition still has `from: null` |
| `unused-entity` | warning | a live entity is not cited by a current fact |
| `action-without-actor` | warning | a frame has an action and no actor |
| `action-without-object` | warning | a frame has an action and no object |
| `guard-without-action` | warning | a condition does not attach to an action |
| `agent-fact` | warning | an agent-owned fact disagreed with the proposal and was kept |
| `contradicting-facts` | warning | live facts disagree, for example two transitions of the same object and action |

`spec facts add` and `edit` findings:

| Code | Severity | When |
|---|---|---|
| `unknown-entity` | blocking | a fact cites an entity id that is not in the session |
| `type-mismatch` | blocking | a fact is missing a field, or an entity has the wrong kind |
| `rejected-entity` | blocking | a fact cites a rejected or stale entity |
| `vocabulary` | blocking | a state name is not workflow vocabulary |
| `normalized-name` | info | a state name was normalized |
| `contradicting-facts` | blocking | the signature is already recorded by a live fact |

`spec trace <id>` walks provenance: state, then facts, then entities, then tokens, then the sentence. An implied fact (no sources) still walks the entities it names, and it also reports `orphan`. An unknown id is exit 2. Trace does not write the store.

`spec status` recomputes open findings by layer. `coverage.sentences` is mapped, pending, and stale. A current sentence is mapped when a current fact sources that sentence or one of its tokens. `coverage.entities` counts candidate, confirmed, rejected, and stale. `coverage.facts` counts current, stale, implied, and removed. `layers.graph` is false until a later slice builds the graph. A missing entities or facts layer is an info `entities-absent` or `facts-absent` finding. Status does not write the store.

`spec trace` and `spec status` findings:

| Code | Severity | When |
|---|---|---|
| `orphan` | warning | a fact or other id has no sentence source |
| `removed-fact` | info | the traced fact is a tombstone |
| `stale-entity` | warning | an entity is stale after the spec changed |
| `stale-fact` | warning | a fact is stale |
| `transition-without-from` | warning | status still sees a current transition with no source state |
| `entities-absent` | info | `spec entities list` has not been run |
| `facts-absent` | info | `spec facts propose` or an edit has not been run |

Input failures use `issues` with `{ kind, file, path, message }` and `kind: "input"`. Model problems stay in `findings`. A blocking finding is exit 1 with an empty stderr. A bad id, a missing layer, or a bad patch is exit 2.

### Selection

`workflows check --json` lists every named sub-graph. That document is a valid `--select` file. A shorter selection is also accepted:

```json
{ "flows": ["W8"] }
```

Unknown ids, a failing check document, and a file that is neither shape are exit 2. Ids are the workflow `id`s, not node ids.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Chart schema and graph are valid; or the analysis is clean; or the workflow set is valid; or every selected flow passed; or compare has a winner; or a spec command left no blocking findings |
| 1 | Schema or graph is invalid; or the analysis found an unreachable state or a dead end; or a selected flow failed; or compare has no winner; or a spec command reported a blocking finding |
| 2 | The file is missing or is not YAML/JSON; arguments are wrong; the chart is too invalid to analyze; the mapping does not apply; the selection names a missing flow; the spec file, session, or id cannot be read |

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

`spec.init`, after a readable file. `ok` stays true when a blocking finding is present; the exit code is 1 in that case. `section` is `""` when the sentence is above any heading.

```json
{
  "command": "spec.init",
  "ok": true,
  "session": "order",
  "spec": "examples/spec/order.md",
  "specHash": "sha256:…",
  "sentences": [
    {
      "id": "s1",
      "text": "When the customer submits an order, the manager approves the order if the total is under 500 dollars.",
      "span": [18, 119],
      "hash": "sha256:…",
      "section": "Order approval"
    }
  ],
  "findings": [],
  "issues": []
}
```

`spec.tag`. Spans are character offsets into the spec file, the same coordinates as the sentence span. The store keeps every token; this excerpt is the start of the sample sentence.

```json
{
  "command": "spec.tag",
  "ok": true,
  "session": "order",
  "tagger": { "name": "compromise", "version": "14.19.0" },
  "sentences": [
    {
      "id": "s1",
      "text": "When the customer submits an order, the manager approves the order if the total is under 500 dollars.",
      "section": "Order approval",
      "clauses": [
        "When the customer submits an order,",
        "the manager approves",
        "the order if the total is under 500 dollars."
      ],
      "tokens": [
        { "id": "s1.t1", "text": "When", "tags": ["Connector", "Conjunction"], "span": [18, 22], "origin": "tagger" },
        { "id": "s1.t3", "text": "customer", "tags": ["Noun", "Actor", "Singular"], "span": [27, 35], "origin": "tagger" }
      ]
    }
  ],
  "findings": [],
  "issues": []
}
```

A missing session, a live lock, a bad id, or an unreadable spec is exit 2: `ok` is false, `fault` is `session`, `locked`, `schema`, `unreadable`, or `usage`, `findings` is empty, and `issues` carries the message. The same shape is printed for `--json`. Without `--json`, exit 2 writes only to stderr.

`spec.entities.list`, after `spec tag`. `ok` stays true when the only findings are warnings.

```json
{
  "command": "spec.entities.list",
  "ok": true,
  "session": "order-sentence",
  "entities": [
    { "id": "actor:customer", "kind": "actor", "name": "customer", "sources": ["s1.t3"], "origin": "tagger", "status": "candidate" },
    { "id": "object:order", "kind": "object", "name": "order", "sources": ["s1.t6", "s1.t11"], "origin": "rule", "status": "candidate" },
    { "id": "condition:c1", "kind": "condition", "text": "the total is under 500 dollars", "sources": ["s1.t12"], "origin": "rule", "status": "candidate" }
  ],
  "findings": [
    { "id": "unreviewed:actor:customer", "kind": "coverage", "code": "unreviewed", "severity": "warning", "message": "actor:customer is an unreviewed candidate", "refs": ["actor:customer"] }
  ],
  "issues": []
}
```

`spec.facts.propose`. `from: null` means the rule did not see a source state. The agent supplies one with `spec facts edit --id f3 --from-state draft`. This excerpt omits the warning findings that proposal usually returns.

```json
{
  "command": "spec.facts.propose",
  "ok": true,
  "session": "order-sentence",
  "facts": [
    { "id": "f1", "type": "performs", "actor": "actor:customer", "action": "action:submit", "origin": "rule", "confidence": 0.9, "sources": ["s1"], "status": "current" },
    { "id": "f3", "type": "transition", "object": "object:order", "action": "action:submit", "from": null, "to": "submitted", "origin": "rule", "confidence": 0.5, "sources": ["s1.t4", "s1.t6"], "status": "current" },
    { "id": "f5", "type": "guard", "action": "action:approve", "condition": "condition:c1", "origin": "rule", "confidence": 0.8, "sources": ["s1.t12"], "status": "current" }
  ],
  "findings": [],
  "issues": []
}
```

`spec.facts.add --from patch.json` accepts one fact or `{ "facts": [ ... ] }`. `spec.facts.edit --from` accepts the fields to change, including `id`. `spec.facts.remove --from` accepts `{ "id": "f5" }` or `{ "ids": ["f5"] }`.

`spec.trace` for an implied fact. The chain still names the entity, and `orphan` says there is no sentence source on the fact itself.

```json
{
  "command": "spec.trace",
  "ok": true,
  "session": "order-sentence",
  "id": "f6",
  "chain": [
    { "layer": "fact", "id": "f6", "type": "initial", "status": "current", "origin": "agent", "refs": [] },
    { "layer": "entity", "id": "object:order", "kind": "object", "name": "order" }
  ],
  "findings": [
    { "id": "orphan:f6", "kind": "coverage", "code": "orphan", "severity": "warning", "message": "f6 has no sentence source", "refs": ["f6"] }
  ],
  "issues": []
}
```

`spec.status`. `layers.graph` stays false in this version.

```json
{
  "command": "spec.status",
  "ok": true,
  "session": "order-sentence",
  "coverage": {
    "sentences": { "mapped": ["s1"], "pending": [], "stale": [] },
    "entities": { "candidate": 6, "confirmed": 0, "rejected": 1, "stale": 0 },
    "facts": { "current": 6, "stale": 0, "implied": 1, "removed": 0 }
  },
  "layers": { "tokens": true, "entities": true, "facts": true, "graph": false },
  "findings": [],
  "issues": []
}
```

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
