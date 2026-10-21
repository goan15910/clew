# 🧶 Clew

Agents turn plain-English workflows into XState machines. Clew checks each model against structural checks and traversal proofs. The exported visuals are the human-facing contract and proof.

Clew is the ball of thread Ariadne gave Theseus: a proven path through the maze.

## Quick start

Image export needs Graphviz (`dot`, `gvpack`, `neato`).

```bash
npm install
npm run clew -- verify <model.yaml> <workflows.yaml> [--out dir] [--highlight W2] [--json]
npm run clew -- compare <workflows.yaml> <model.yaml>... [--out dir] [--highlight W2] [--json]
```

`clew verify --help` and `clew compare --help` list the typed options. There are no prompts.

Exit codes:

- `0` — every workflow passes (`verify`), or a candidate passes all of them (`compare`)
- `1` — a workflow failed
- `2` — the model or the input is invalid

Errors go to stderr. `--json` prints the result document on stdout.

The to-do example is in `examples/todo/`. `b-full` passes all eight workflows. `a-basic` fails W6, W7, and W8.

## Your files

Pass the paths to your own model and workflows file.

**Model.** A YAML file. Clew validates it with Zod once, then builds a flat XState machine with `createMachine`. Guards and effects are named declarations, not code. Nested and parallel states are out of scope.

```yaml
id: todoTask
initial: draft
guards:
  - { name: titleNotEmpty, reads: title }
effects:
  - { name: markListed, sets: listed }
states:
  - id: draft
    label: Draft
    workflowState: editing
    data:
      title: string
  - id: todo
    label: Todo
    workflowState: open
    data:
      listed: boolean
transitions:
  - { from: draft, event: SUBMIT, to: todo, actor: user, guard: titleNotEmpty, effect: markListed }
```

State ids are camelCase. Events are `UPPER_SNAKE_CASE`. Each state declares `data` fields as `string`, `boolean`, `number`, or `timestamp`. A guard may only read a field declared on the source state. An effect may only set a field declared on the target state. The initial state and every transition target are checked when the file is loaded. `final: true` marks a state that must not have outgoing transitions.

**Workflows.** A YAML file of event sequences:

```yaml
machineId: myMachine
workflows:
  - id: W1
    title: Happy path
    expect: accepted
    end: done
    steps:
      - { text: "Start the work", event: START }
  - id: W2
    title: A step the machine must refuse
    expect: rejected
    rejectAt: 2
    steps:
      - { text: "Start", event: START }
      - { text: "Try the forbidden step", event: ARCHIVE }
```

`expect` is **accepted → final state** (`end`: the sequence must be possible and finish in that state) or **rejected at step N** (`rejectAt`: the model must refuse the sequence at that step).

`--highlight W2` draws that workflow's path on the state chart. Reports and charts are written to the directory you pass with `--out`.

## Layout

- `src/model.ts` — YAML schema, `loadModel()`, and the XState-backed `Model`
- `src/verify.ts` — reachability, dead ends, and workflow traversal (`@xstate/graph`)
- `src/render.ts` — Graphviz and Mermaid text
- `src/cli.ts` — `clew verify` and `clew compare`, file output, and Graphviz
- `examples/todo/` — ported to-do candidates and the eight workflows
- `examples/invalid/` — a misspelled state id, and an effect that sets an undeclared field
- `docs/assets/` — illustration SVGs

## Visuals

Overall state chart:

![Overall state chart](docs/assets/state-chart.svg)

*Overall state chart.*

W2, Snooze and resume:

![W2 Snooze and resume, path highlighted](docs/assets/w2-snooze-and-resume.svg)

*W2 "Snooze and resume": traversal path highlighted.*

Workflow proofs:

![Workflow proofs, W1 through W8](docs/assets/workflow-proofs.svg)

*W1–W8, with W8 refused as required.*
