# 🧶 Clew

Agents turn plain-English workflows into XState machines. Clew checks a state chart, checks a workflow set, and proves each named flow. The exported visuals are the human-facing contract and proof.

Clew is the ball of thread Ariadne gave Theseus: a proven path through the maze.

The command contract, JSON shapes, and file format are in [docs/agent-cli.md](docs/agent-cli.md).

## Prerequisites

- Node.js 22.12 or newer
- For chart image export (`clew verify --out`): Graphviz 16.1.0 (`dot`, `gvpack`, `neato`) on `PATH`. Ubuntu apt still ships 2.42; `bash scripts/install-graphviz.sh` installs 16.1.0. `clew verify` without `--out`, and `--heatmap`, do not need Graphviz.

## Install

Clew is not published to the npm registry. Use the install script:

```bash
# From a local checkout (version is package.json, plus -<shortSha> when HEAD has no git tag)
bash scripts/install-clew.sh --from local

# From GitHub (branch, tag, or commit) — version is package.json as-is
bash scripts/install-clew.sh --from github main
bash scripts/install-clew.sh --from github v0.1.0-alpha3

# From a GitHub Release tarball
bash scripts/install-clew.sh --from release v0.1.0-alpha3
```

`clew --version` prints the installed version string. Pass `--prefix DIR` to install into a non-default prefix (adds `DIR/bin` to your `PATH` yourself).

## Help

```bash
clew --help          # top-level commands
clew help            # every command
clew help verify     # one command: examples and exit codes
```

## Demo

Prove the to-do example and write charts, a coverage heatmap, and a replay:

```bash
clew verify examples/todo/b-full.yaml examples/todo/workflows.yaml \
  --heatmap --replay --out /tmp/clew-demo
```

Overall state chart:

![Overall state chart](docs/assets/state-chart.svg)

W2, snooze and resume (path highlighted):

![W2 Snooze and resume, path highlighted](docs/assets/w2-snooze-and-resume.svg)

Workflow proofs:

![Workflow proofs, W1 through W8](docs/assets/workflow-proofs.svg)

Transition coverage heatmap:

![Transition coverage heatmap for b-full](docs/assets/coverage-heatmap.svg)

W8 replay (ends on the refused archive step):

![W8 replay, including the refused archive step](docs/assets/w8-replay.gif)

Inspect a plain-English spec session in the browser:

```bash
clew spec init examples/spec/order.md --json
clew spec tag
clew spec view <session-id> --open
```
