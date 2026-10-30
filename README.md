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
# From a local checkout
bash scripts/install-clew.sh --from local

# From GitHub (branch, tag, or commit)
bash scripts/install-clew.sh --from github main
bash scripts/install-clew.sh --from github v0.1.0-alpha.3

# From a GitHub Release tarball (no tag means the highest SemVer release, prereleases included).
# The tarball must match SHA256SUMS or nothing is installed.
bash scripts/install-clew.sh --from release v0.1.0-alpha.3
```

A commit with an exact `v*` tag installs as its tag, such as `0.1.0-alpha.3`. Any other commit installs as `{pkg}.dev.{commit count}+g{sha7}`, such as `0.1.0-alpha.3.dev.36+g24cb67d`. Each install also records its channel (`release`, `head`, or `local`) and commit in `build-info.json` for `clew upgrade`.

`clew --version` prints the installed version string. Pass `--prefix DIR` to install into a non-default prefix (adds `DIR/bin` to your `PATH` yourself).

## Upgrade

```bash
clew upgrade                    # newest build on the channel you installed from
clew upgrade --check --json     # report what would change, install nothing
clew upgrade --version 0.1.0-alpha.3   # exact release, downgrades allowed, no API call
clew upgrade --channel head     # switch to the rolling edge prerelease built from main
```

`release` installs from GitHub releases (highest SemVer; prereleases only when the installed build is one). `head` installs the rolling `edge` prerelease that CI publishes on every push to main, and compares by commit. Plain `clew upgrade` never changes channel.

The tarball must match `SHA256SUMS` (and GitHub's asset digest, and `--checksum` when given) before `npm install -g <that file>` runs. `--verify-provenance` also runs `gh attestation verify`. Local builds, `npm link`, and checkouts are refused unless `--force`. An unwritable prefix prints the `npm install -g` command to run, and Clew never runs `sudo`. Spec sessions are never touched. Set `GITHUB_TOKEN` to raise the API rate limit. macOS and Linux only.

Installs up to `0.1.0-alpha.2` have no `upgrade` command. Re-run the install script for those.

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

View a chart or workflow set without a session (`--workflows` / `--chart` for a combined page):

```bash
clew chart view examples/todo/b-full.yaml --open
clew workflows view examples/todo/workflows.yaml --chart examples/todo/b-full.yaml --open
```
