# Agent CLI

Clew’s primary user is an agent. Each command does one thing, prints a JSON document on stdout when given `--json`, writes errors to stderr, and exits with a stable code. Commands do not prompt. An agent composes them: the output of one command is a file the next command can read, including a selection of named sub-graphs.

Nested and parallel states are out of scope. Zod runs only while reading a YAML or JSON file or the command line. Domain objects are built field by field.

## Decisions

**`compare` is kept, and it no longer replays.** It ranks JSON documents produced by `clew verify --json`. An agent verifies each candidate, then compares those documents. The candidate name is the chart file’s basename (`examples/todo/b-full.yaml` is `b-full`), carried on the verify document, because two charts can share one chart id.

**A workflow node is a full valuation.** `assign` names every spec var. `verify` replays each edge with domain `step` and `can`, and compares `valuationId`. An assign that is missing a var, names an unknown var, or fails a type check is exit 2 with fault `name-gap`. An event the spec never enables fails only that flow (exit 1). That is why `a-basic` fails W6, W7, and W8 while `b-full` passes all eight. Chart ids and workflow-set ids are not compared.

**Accepted flows start reachable from `initial`.** The first node's assign must be a valuation `explore` can reach from the spec's initial valuation. Starting at an unreachable valuation fails that flow. Labels are display on the spec and on traces. They never feed `step` or `valuationId`.

**Naming contract between workflow sets and charts.** Spec sessions and the draft graph keep kebab-case words (`mark-shipped`, `in-progress`). `spec emit` writes a node's `assign` as a full valuation of the unfolded spec vars, and an edge's `event` as `UPPER_SNAKE` (`MARK_SHIPPED`). Node ids, and edge `from`, `to`, and `start`, stay kebab-case. `--chart` writes the same `clew.spec.v1` Spec that `verify` replays.

**The first analyses are the chart-only checks already in Clew:** states reachable from the initial state, unreachable states, dead ends (non-final states with no outgoing transition), and the shortest event path to each reachable state. Transitions no selected flow exercises are reported by `verify`, because that check needs a workflow set. Further analyses are not in this command set.

**A workflow set is a meta-graph of named linked lists.** The file has an `id` and a `workflows` array. Each workflow has a unique `id` (the sub-graph name), nodes, and edges. Node ids are unique inside that workflow. A node's `assign` is a full valuation, so a list may visit the same phase twice under two node ids with different maps. Edges form a single path from `start`: one head, one outgoing edge, one incoming edge, no cycles, no disconnected nodes. Walk order follows the links, not the order of the YAML list. There is no reader for the old `machineId` / `steps` / `end` shape, or for a node `state` field. Those files fail schema validation with a migration hint.

**`machineId` is not compared.** It was removed. The workflow set has its own `id`. `verify` does not compare that id to the chart id.

**A noun is an actor only when the tagger tags it `Actor`.** A noun tagged only `Noun` stays an object, and the sentence gets `no-actor`. Clew does not guess the grammatical subject, and it does not invent an actor entity. Propose still mints the ActionFact or forbidden fact, with actor `actor:unspecified`, and records `action-without-actor`. Overlay and emit tolerate that sentinel id. The agent promotes a real noun with `spec entities promote --id <id> --kind actor`.

## Commands

```bash
clew help
clew help <command>...
clew chart check <chart.yaml> [--json]
clew chart analyze <chart.yaml> [--json]
clew chart view <chart.yaml> [--workflows <set.yaml>] [--open] [--json]
clew workflows check <set.yaml> [--json]
clew workflows view <set.yaml> [--chart <chart.yaml>] [--open] [--json]
clew verify <chart.yaml> <set.yaml> [--flow <id>] [--select <file>] [--highlight <id>] [--heatmap] [--replay] [--out <dir>] [--json]
clew compare <verify.json>... [--out <dir>] [--json]
clew spec init <spec.md> [--session <id>] [--json]
clew spec tag [--session <id>] [--sentence <id>] [--json]
clew spec entities list [--kind actor] [--status candidate] [--session <id>] [--json]
clew spec entities merge --into <id> --id <id> [--session <id>] [--json]
clew spec entities rename --id <id> (--name <name> | --text <text>) [--session <id>] [--json]
clew spec entities reject --id <id> [--reason <text>] [--session <id>] [--json]
clew spec entities promote --id <id> [--kind actor] [--session <id>] [--json]
clew spec facts propose [--sentence <id>] [--session <id>] [--json]
clew spec facts add (--kind <kind> ... | --from <file.json>) [--session <id>] [--json]
clew spec facts edit (--id <id> ... | --from <file.json>) [--session <id>] [--json]
clew spec facts remove (--id <id> ... | --from <file.json>) [--session <id>] [--json]
clew spec graph build [--session <id>] [--json]
clew spec graph split (--id <id> --at <edge> | --from <file.json>) [--session <id>] [--json]
clew spec graph group (--id <id> --id <id> | --transition <id> --transition <id> | --from <file.json>) [--title <text>] [--into <id>] [--session <id>] [--json]
clew spec emit (--dry-run | --out <file>) [--chart <file>] [--force] [--session <id>] [--json]
clew spec trace <id> [--session <id>] [--json]
clew spec status [--session <id>] [--json]
clew spec show tagged [--session <id>] [--json]
clew spec show tokens [--session <id>] [--json]
clew spec show entities [--session <id>] [--json]
clew spec show facts [--session <id>] [--json]
clew spec view <session-id> [--open] [--json]
clew spec session list [--json]
clew spec session remove <id> [--json]
```

`clew --help` and `-h` print usage, a short description, arguments, options, and subcommands. `clew help` lists every command. `clew help <command>` prints the long help for that command: the same usage text, then examples, exit codes, and notes. Use `clew help <command>` for examples and exit codes. An unknown command path exits 2.

`--flow` is repeatable. `--select` reads a JSON file. Passing neither verifies every workflow, in file order. Passing both unions them, `--flow` first, dropping duplicates. `--select -` is rejected: Clew never reads stdin, so it cannot wait for input.

`--out` is optional. Reports and Graphviz charts are written only when it is set. Charts need Graphviz 16.1.0 (`dot`, `gvpack`, `neato`) on `PATH`. Ubuntu's apt package is 2.42; `scripts/install-graphviz.sh` installs 16.1.0, and the `check`, `venom`, and `release` workflows run that script. `gvpack -V` was removed in Graphviz 16, so Clew probes `gvpack -?`.

The state chart (`<out>/state-chart.svg`, and `<out>/overview-<id>.svg` when `--highlight` is set) draws each state as an attribute table: the label, then one row per data field (name and type). A final state keeps a double border. Edges are colored by actor. The color is stable: sorted actor names pick a fixed palette. A guarded edge is dashed. States are grouped into clusters by the actor of their outgoing transitions. A state with no outgoing transition sits in `final` when it is final, and in `terminal` otherwise. `--highlight` numbers that workflow's accepted steps, draws them in blue, and fades every other state and edge. The guard stays dashed on a highlighted edge. SVG states and edges carry a tooltip and a link to the target state (`#<state id>`). Workflow proofs stay one cluster per workflow.

`--heatmap` writes `coverage-heatmap.svg` into `--out`, one file for that candidate. Each cell is one chart transition: the row is the source state, the column is the event, and the color is how many times a selected workflow accepted it. Zero is cold. A refused step is not coverage. `--heatmap` also adds `transitionCoverage` to the verify document, in chart order. `count` is accepted steps. `flows` lists the workflows that contributed, once each.

`--replay` writes `replays/<id>.gif` for each selected workflow. Frame 0 is the start state. Each later frame lights the next trace step. A rejected workflow includes the refused step: green, labeled `refused (as required)`, when the chart refused it on a passing proof; red, labeled `should be refused`, when the chart accepted a step it was required to refuse (W8 on `a-basic`). The last frame holds so that step stays visible. Replay frames are positioned DOT drawn by Graphviz `neato`. The heatmap is SVG and does not call Graphviz.

`--heatmap` or `--replay` without `--out` is exit 2. The flags do not change the pass/fail exit code. With either flag, the document gains `views`. Paths are relative to `--out`.

The `b-full` heatmap is [assets/coverage-heatmap.svg](assets/coverage-heatmap.svg). W8 on that chart, including the refused archive step, is [assets/w8-replay.gif](assets/w8-replay.gif).

### Spec

`spec init` and `spec tag` split a plain-English spec and tag it. `spec entities` and `spec facts` turn those tokens into candidates and typed claims. `spec graph build` assembles a draft graph and proposes one path per transition, plus one rejected path per forbidden fact. `spec graph split` and `spec graph group` are how the agent edits those paths. `spec emit` writes the chosen paths as a workflow set. `spec show` prints one stored layer. `spec view` installs a human HTML inspector for one session. `spec trace` and `spec status` read the result back. `spec session list` and `spec session remove` show and delete sessions. Clew does not call a language model. The tagger and the proposal rules are a starting point; the calling agent is the guard.

`spec init <spec.md>` reads a Markdown or plain-text file and splits it into sentences. `-` is rejected: Clew never reads stdin. ATX headings (`#` through `######`) are section provenance on the following sentences, not sentences themselves. Fenced code blocks and HTML comments are skipped. Each sentence has an id (`s1`, `s2`, …), the exact source slice, a character span into the file, and a `sha256:` hash of that slice.

Running `spec init` again with the same session id refreshes that session. Without `--session`, the id is the spec file's basename, so two files with the same basename share a session unless one is given `--session`. Unchanged sentence text keeps its id. Changed or removed sentences stay in the store as `stale` and are reported. They are not deleted. A sentence that comes back with the same hash is revived, and token spans shift if the text moved in the file.

`spec tag` runs the part-of-speech tagger on the current sentences. `--sentence s3` tags only that sentence. The tagger is compromise, behind `PosTaggerPort`. `src/adapters/pos/compromise-tagger.ts` is the only file that imports it. The document names the tagger and its version. Running `tag` twice with the same tagger and the same sentences does not change the store. A tag history line lists sentence ids: `before` is the targeted sentences that already had current tokens, and `after` is every targeted sentence id. The first tag has an empty `before`. A token whose `origin` is `agent` is not overwritten; a disagreement is a `conflict` finding. Entity and fact edits are what set `origin` to `agent`.

`--session` selects a session. When it is omitted, Clew uses the only open session. Zero sessions, or more than one, is exit 2.

The session store is one store per OS user, outside any repo. Every `clew spec` command uses it from any directory, inside a git repo or not. A session is known by its id alone. Clew does not record the directory, repo, or spec path it was registered from. Nothing is written next to the spec, and there is nothing to commit. On Linux and macOS the base directory is `$XDG_DATA_HOME/clew`, or `~/.local/share/clew` when `XDG_DATA_HOME` is unset. On Windows it is `%LOCALAPPDATA%\clew`. `CLEW_DATA_DIR` overrides that base. The synthetic pipeline harness is `tests/spec/synthetic-pipeline.harness.ts`. It always runs in CI against `tests/fixtures/synthetic-pipeline.md`. Under the data dir, sessions live at:

```txt
spec/<session-id>/
  session.json
  sentences.json
  tokens.json
  entities.json
  facts.json
  flows.json
  history.jsonl
  viewer.html
```

`<session-id>` defaults to the spec file’s basename. Older Clew versions kept one store per project under `<project-key>/spec/`. The first command that opens the store moves those sessions into `spec/` and drops the spec path they recorded. When two projects have a session with the same id, one is kept and the other is dropped. Clew holds a lock only while a command writes the session, and removes that lock before the command exits. The lock is not a file that stays in the session. A lock whose process is gone is taken over. A live lock is exit 2.

`spec view <session-id>` installs a stable `viewer.html` into that session folder. The page is a self-contained browser inspector with Facts, Entities, Sentences, and Graph tabs. Facts, Entities, and Sentences have collapsed lineage drawers. Filters cover entity kind, fact type, fact status, and text search, and they apply to Facts, Entities, and Sentences. The Graph tab draws the session draft graph and the workflows that graph can render, as images. It needs Graphviz (`dot`) on the machine serving the page. The page does not change domain JSON, `session.json` timestamps, or `history.jsonl`. The command names one session id (not `--session`, and not the session list). An unknown id or an unsafe id (`..`, a slash, or any id outside the session-id pattern) is exit 2. The document command is `spec.view`.

Browsers treat `file://` pages as opaque origins and block `fetch()` of sibling JSON, so opening `viewer.html` directly cannot reload live session files. With `--open`, Clew serves that session folder read-only on `127.0.0.1`, opens the browser, and keeps serving until Ctrl+C. A reload then picks up the latest `session.json`, `sentences.json`, `tokens.json`, `entities.json`, `facts.json`, and `flows.json`. The Graph tab requests `graph.json` and `draft-graph.json`. The server unfolds those responses when the page asks, and does not write them into the session folder. The 🔄 button next to the banner does the same reload without leaving the page. The session name in the header is a dropdown: opening it re-reads the sessions for this repo from the store (`/sessions.json`), and choosing one loads that session's files from `/sessions/<id>/` and sets `?session=<id>` in the URL. The server only serves session folders directly under this repo's spec root. Without `--open`, Clew only writes `viewer.html` and prints its path (or the JSON document).

`spec session list` lists every session. Each row has the id, `updated` (the last time Clew wrote that session), and `summary` counts of live sentences, facts, and flows. A live sentence is `status: current`. A live fact is current and is not a removed tombstone. Flows are the paths stored in `flows.json`; a session with no overlay counts zero. An empty list is exit 0. List does not take the write lock and does not change the store. A session whose files cannot be read is still listed, with empty counts and the file’s modification time.

`spec session remove <id>` deletes that session directory and nothing else. An unknown id is exit 2. A live lock is exit 2 and the directory stays. A lock whose process is gone is taken over, the same way as any other write, and then the directory is deleted. The id is one session name: a letter, then letters, digits, underscores, or hyphens. `..`, a slash, or any other unsafe id is exit 2. Clew deletes the directory only when its real path is `<spec-root>/<id>`. A symlink is left in place. Sessions for other repos are not touched.

`history.jsonl` records each write. `before` is the ids that existed before the write, and `after` is the ids after it. Tag records sentence ids, propose records live fact ids, and graph build, split, and group record flow ids. The first `spec tag`, `spec facts propose`, and `spec graph build` have an empty `before`.

`session.json` carries `schemaVersion`. This Clew reads schema 2. A different version is exit 2 and names the missing migration. There is no migration from schema 1. The store adapter is the only place that validates that JSON with Zod.

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

`spec entities list` derives candidates from the current tokens and writes them the first time. Running it again, when nothing changed, does not append history. `--kind` and `--status` filter the document. There is no separate extract command. Actor-tagged nouns become actors. A noun the tagger does not tag `Actor` is not promoted to an actor. Other nouns become objects, except pronouns, currency, units, determiners, and values, so "dollars" is skipped. Verbs become actions, except copulas, auxiliaries, and modals. An adjectival verb between a determiner and a noun ("a shipped order") is not an action. A sentence-initial “When” is a condition only when its clause has no content verb; mid-sentence if, when, and unless are conditions. Same-lemma nouns merge. A single token stays `origin: tagger`. Two sources of the same lemma are `origin: rule`.

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

`spec entities list` and every entity edit (`merge`, `rename`, `reject`, `promote`) also run `rebuildFacts` in the same store write, so facts follow the live entities. `spec facts propose` is the same rebuild, invoked on its own. It does not overwrite `origin: agent`. A disagreement is `agent-fact`. Running it again, when nothing changed, does not append history. `--sentence s1` limits the proposal to that sentence.

Facts are a discriminated union. An `action` fact has `event` (UPPER_SNAKE from the action lemma), `actor`, `when` (a predicate), and a non-empty `assign` patch. `init`, `terminal`, and `forbidden` are configuration facts over a predicate or an attempted assign. There is no `performs` / `transition` / `guard` join by action name, and no vocabulary `from` / `to` location strings. Object vars start as `null` until assigned. A later action in the same sentence takes the previous assign as `when`. Condition entities become boolean vars (`eq c1 true`), so the false value is the else. The assign atom is the action lemma (`submit`, `ship`, `cancel`), not a past participle. Negation emits `forbidden` instead of an action. A frame with no Actor tag still mints the fact, with actor `actor:unspecified`, and keeps the `action-without-actor` warning. Passive voice takes the noun before the verb as the object and the actor after “by”. `init` and `terminal` are not proposed. Removed facts stay in the store as tombstones (`removed: true`, `status: stale`, `origin: agent`) so a later propose does not recreate that signature. Documents omit removed facts. Adding a fact with a removed signature revives that id. Adding a live duplicate signature is a blocking `contradicting-facts` finding and does not write.

`spec facts add`, `edit`, and `remove` take flags or `--from <file>`. `--from -` is rejected. Flags and `--from` together are rejected. `--kind` is `action`, `init`, `terminal`, or `forbidden`. `--when` and `--assign` are JSON. `--from` is only the patch file. `--source` and `--id` are repeatable on the commands that accept them. Confidence is a number from 0 to 1. An edit sets confidence to 1 unless the patch sets it. An unknown fact id is exit 2. A well-formed entity id that is not in the session is a blocking finding, not an input issue.

`spec facts propose` findings:

| Code | Severity | When |
|---|---|---|
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

`spec trace <id>` walks provenance. An overlay fact id (`f1`) that is also a transition, or a flow id (`W1`), is resolved first. Otherwise it walks a state, then facts, then entities, then tokens, then the sentence. An implied fact (no sources) still walks the entities it names, and it also reports `orphan`. An unknown id is exit 2. Trace does not write the store.

`spec show sentences`, `spec show tagged`, `spec show tokens`, `spec show spans`, `spec show entities`, and `spec show facts` print one stored layer. The command values are `spec.show.sentences`, `spec.show.tagged`, `spec.show.tokens`, `spec.show.spans`, `spec.show.entities`, and `spec.show.facts`.

`spec show sentences` works right after `spec init`. Each row has `id`, `text`, `section` (the heading path), `status`, and `workflows`. `workflows` lists the `id` and `title` of each draft-graph flow whose transitions or forbidden fact cite the sentence. It is empty until `spec graph build` writes flows. `spec show spans` lists the live span partition after `spec tag`. Each span has `id`, `sentence`, `surface`, and `tags` (the POS tags), plus its token cover, origin, and entity link. Every span view now carries `sentence`, including the spans in `spec tag` and `spec spans merge` output.

These commands leave the session and `history.jsonl` unchanged, and `updated` stays as it was. `findings` is always an empty list. `spec status` recomputes findings.

Exit 0 means the requested layer has been written. An empty entity list and an empty fact list are written. Exit 2 means the layer has not been written, the session is missing, the session is locked, or the arguments are wrong. The exit is 0 or 2.

The stderr message names only the first missing layer. Tagged sentences and unique tokens need the tag layer, and the message is `no tokens; run clew spec tag first`. Entities need that layer, then a written entity list. When the tag layer is missing, the message is the tag sentence. When the entity list is missing, the message is `no entities; run clew spec entities list first`. Facts need the tag layer, then entities, then a written fact list. The messages follow that order. `spec entities list` writes facts, so after list the fact list is present. When the fact list is missing, the message is `no facts; run clew spec entities list first`.

`spec init` writes an empty `tokens.json` and leaves the tagger unset. That file is not a tag layer. The tag layer is written when the session has a tagger, or when any tagged sentence has tokens.

`spec show tagged` prints `sentences`, the same tagged view as `spec tag`, for the current sentences. `spec show tokens` prints `tokens`. Each item has the lower-cased `text`, a `count`, the original `forms` in first-seen order, and `readings`. A reading has `tags` and the token ids. Unique tokens are grouped words with tag readings and sN.tM ids, not a second entity list. `spec show entities` prints `entities` in stored order, including rejected and stale entities. `spec show facts` prints `facts` and leaves removed facts out.

`spec status` recomputes open findings by layer. `coverage.sentences` is mapped, pending, and stale. A current sentence is mapped when a current fact sources that sentence or one of its tokens. `coverage.entities` counts candidate, confirmed, rejected, and stale. `coverage.facts` counts current, stale, implied, and removed. `layers.graph` is true after `spec graph build` has written `flows.json`. A missing entities, facts, or graph layer is an info `entities-absent`, `facts-absent`, or `graph-absent` finding. Status does not write the store. `findingsByLayer.graph` is the graph layer on its own.

`spec trace` and `spec status` findings:

| Code | Severity | When |
|---|---|---|
| `orphan` | warning | a fact or other id has no sentence source |
| `removed-fact` | info | the traced fact is a tombstone |
| `stale-entity` | warning | an entity is stale after the spec changed |
| `stale-fact` | warning | a fact is stale |
| `transition-without-from` | blocking | an action fact has no source valuation for its object var |
| `entities-absent` | info | `spec entities list` has not been run |
| `facts-absent` | info | `spec entities list` has not written facts yet |
| `graph-absent` | info | `spec graph build` has not been run |

`spec graph build` unfolds overlay states and transitions from current facts and writes a flows overlay keyed by fact id (`flows.json`). Truncation uses `reachableFromInitial` on `specFromFacts`. Schema version is 2. A schema 1 session is exit 2 with no migration. States and transitions are recomputed on every read. A leftover `graph.json` is read as-is until the next write, which unlinks it and stores `flows.json`. Entity writes keep the overlay when fact ids remain. Running build again, when the paths are unchanged, does not append history. A build history line’s `before` lists the flow ids already stored, and `after` lists the flow ids written. The first build has an empty `before`. Split and group record the same way. Transition `from` and `to` are assign atoms (the action lemma, not a past participle). Transition `event` is the ActionFact event (`SUBMIT`). When `when` is `null` for the object var, overlay `from` is that object's initial atom: the `init` ConfigurationFact assign if one exists, otherwise the default atom `null`. `transition-without-from` stays only when the source valuation is missing, not when it is the initial `null`. Truncation at the reach bound is a blocking `state-space-truncated`.

The path cover is one accepted flow per provable transition (`Submit order` for event `SUBMIT` on object `order`) and one rejected flow per `forbidden` fact (`Cannot approve order`, `rejectAt` 1). A condition entity is a boolean var, so the false value is the else and `guard-without-else` is not raised for `condition:` guards. A forbidden fact that matches a transition cites that transition. A forbidden fact with no transition is a rejected flow with an empty transition list; emit draws it from the object’s initial state to the attempted assign atom (`cancel`) and uses the source sentence as the edge text. Flows with `origin: agent` are kept when they still chain. A disagreement is a warning `agent-flow`. An agent flow that no longer chains is dropped, with a warning `stale-flow`. Rule flows that are still the same single edge, or the same forbidden fact, keep their ids.

`spec graph split --id W1 --at 2` cuts an accepted path before the second edge. `--at f2` names that fact instead. The first path keeps `W1`. The second path gets the next workflow id. Both become `origin: agent`. A rejected path is a blocking `rejected-split` and is not written. A cut that would leave a path with no edge is `unsplittable` and is not written. An unknown flow or split point is exit 2.

`spec graph group` joins accepted paths into one linear workflow. `--id W1 --id W2` walks the flows in that order. `--transition f1 --transition f2` walks those edges. The two modes are not combined. `--into` defaults to the first flow, or to the flow that already contains the first fact. `--title` sets the title; otherwise the titles are joined with ` and `. The result is `origin: agent`. A rejected input is `rejected-group`. Paths that do not chain are `not-linear`. A flow that shares some of the named facts and keeps others is `overlap`. An `--into` id that already exists and is not one of the inputs is `duplicate-flow`. Those findings do not write. A successful edit writes even when other graph findings are still blocking, and the exit is 1.

`spec graph split` and `group` take flags or `--from <file>`. `--from -` is rejected. Flags and `--from` together are rejected. A split patch is `{ "id": "W1", "at": 2 }` or `{ "id": "W1", "at": "f2" }`. A group patch is `{ "ids": ["W1", "W2"], "title": "..." }` or `{ "transitions": ["f1", "f2"] }`, with optional `into`.

`spec graph build` findings:

| Code | Severity | When |
|---|---|---|
| `transition-without-from` | blocking | an action fact still has no source valuation, so it is omitted |
| `guard-without-else` | blocking | a guarded transition has no other guard on the same state and event, and no forbidden fact for that object and action |
| `self-loop` | blocking | a transition’s source and target are the same state |
| `vocabulary` | blocking | a state name is not workflow vocabulary |
| `unknown-entity` | blocking | a fact cites an entity id that is not in the session |
| `rejected-entity` | blocking | a fact cites a rejected or stale entity |
| `type-mismatch` | blocking | a fact is missing a field, or an entity has the wrong kind |
| `no-final-state` | warning | a state has no outgoing transition and is not marked final |
| `no-initial-state` | warning | an object has no initial state |
| `unreachable-state` | warning | a state is not reachable from an initial state |
| `transition-without-actor` | warning | a transition has no actor |
| `same-state-two-objects` | warning | two objects use the same state name |
| `agent-flow` | warning | an agent-owned flow was kept |
| `stale-flow` | warning | an agent-owned flow no longer matched and was dropped |
| `state-space-truncated` | blocking | `explore` stopped at the reach bound |

`spec graph split` and `group` findings, besides the graph findings above:

| Code | Severity | When |
|---|---|---|
| `rejected-split` | blocking | the path to split is rejected |
| `unsplittable` | blocking | the cut does not leave an edge on both paths |
| `rejected-group` | blocking | a grouped path is rejected |
| `not-linear` | blocking | the paths or transitions do not chain |
| `overlap` | blocking | a flow shares some named transitions and keeps others |
| `duplicate-flow` | blocking | `--into` names a flow that is not one of the inputs |

`spec emit` writes the chosen paths as a workflow set of full valuation maps. `--chart` writes the unfolded Spec as `clew.spec.v1` YAML, including a valid empty spec (no vars, no actions) when that is what the facts yield. The draft overlay stays kebab-case fact ids. `--dry-run` prints the YAML in the JSON document (`yaml` and `chartYaml`) and does not write a file, even with `--force`. `--out` is required otherwise. `--dry-run` and `--out` together are exit 2. `--out -` and `--chart -` are rejected. Emit walks each flow with the `when` equalities that no action assigns, so a later guard can still produce a total map. `--chart` writes `specFromFacts` (one initial) whenever `--chart` is set, even when the workflow set is empty or missing. A flow whose start is not reachable from that initial fails `verify`. Edge text is the clause that contains the action, extended through the object, with a leading when, after, before, or once removed. A guard’s text is appended when the clause does not already contain it. A rejected flow that cites a fact uses the forbidden fact’s source sentence.

Emit refuses while a blocking finding remains on the graph layer. `--force` writes the requested files anyway, sets `forced: true`, lists the findings, and still exits 1. `--force --chart` still writes the chart when there are no workflows. Earlier-layer warnings, such as an unreviewed entity, do not block emit. There is no per-finding waiver. There is no `stale-graph`: unfold recomputes on read, and split/group overlays survive when fact ids remain. Emit does not write the session. Check failures from the workflow-set rules are `workflow-check` findings, with refs to the flow, its facts, and their sources. They are not `issues`. The set id is the object name plus `Flows` (`order` becomes `orderFlows`). Two objects join as `orderAndShipmentFlows`.

`spec emit` findings:

| Code | Severity | When |
|---|---|---|
| `uncovered-transition` | blocking | a provable transition is not on an accepted path. A guard with no else is `guard-without-else` instead |
| `overlap` | blocking | a transition is on more than one accepted path |
| `path-not-linear` | blocking | a flow does not chain |
| `missing-transition` | blocking | a flow cites a transition that is gone |
| `missing-reject-at` | blocking | a rejected flow has no `rejectAt` |
| `forbidden-uncovered` | blocking | a forbidden fact has no rejected flow |
| `no-workflows` | blocking | there is nothing to emit |
| `workflow-check` | blocking | the rendered set fails `workflows check` |

Input failures use `issues` with `{ kind, file, path, message }` and `kind: "input"`. Model problems stay in `findings`. A blocking finding is exit 1 with an empty stderr. A bad id, a missing layer, or a bad patch is exit 2.

### Selection

`workflows check --json` lists every named sub-graph. That document is a valid `--select` file. A shorter selection is also accepted:

```json
{ "flows": ["W8"] }
```

Unknown ids, a failing check document, and a file that is neither shape are exit 2. Ids are the workflow `id`s, not node ids.

### Exit codes

`clew help <command>` prints the exit codes for that command.

| Code | Meaning |
|---|---|
| 0 | Chart schema and graph are valid; or the analysis is clean; or the workflow set is valid; or every selected flow passed; or compare has a winner; or a spec command left no blocking findings |
| 1 | Schema or graph is invalid; or the analysis found an unreachable state or a dead end; or a selected flow failed; or compare has no winner; or a spec command reported a blocking finding |
| 2 | The file is missing or is not YAML/JSON; arguments are wrong; the chart is too invalid to analyze; a node assign is not a total valuation of the spec; the selection names a missing flow; the spec file, session, or id cannot be read |

Schema is checked before the graph. Graph findings are produced only after the schema is valid (`graphChecked` tells them apart). YAML and JSON syntax errors are exit 2: there is no document to judge yet.

On exit 2 the messages go to stderr. `--json` also prints a document on stdout. Exit 1 is a result, so the findings are on stdout and stderr stays empty.

## Data model

**Chart.** `kind: clew.spec.v1` with `id`, `vars`, a total `initial` valuation, guarded `actions`, and optional `labels`. Location-id charts fail schema. Events are `UPPER_SNAKE_CASE`. Variable ids are `lower_snake_case`. `chart check` reports that sketch. `chart analyze` and `chart view` still project labels to a flat location picture for XState. `verify` does not.

**Workflow set.**

```yaml
id: todoFlows
workflows:
  - id: W2
    title: Snooze and resume
    expect: accepted
    start: working
    nodes:
      - { id: working, assign: { phase: inProgress, listed: true, title: task, started_at: set, completed_at: null, wake_at: null, deleted_at: null } }
      - { id: snoozed, assign: { phase: snoozed, listed: true, title: task, started_at: set, completed_at: null, wake_at: set, deleted_at: null } }
      - { id: resumed, assign: { phase: inProgress, listed: true, title: task, started_at: set, completed_at: null, wake_at: null, deleted_at: null } }
    edges:
      - { from: working, event: SNOOZE, to: snoozed, text: "Snooze" }
      - { from: snoozed, event: RESUME, to: resumed, text: "Resume" }
```

`expect: rejected` adds `rejectAt` (1-based index in walk order) and must not be combined with an accepted flow. Workflow ids match `^[A-Za-z][A-Za-z0-9_-]*$`. Node ids match `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. Events match `^(?:[A-Z][A-Z0-9_]*|[a-z][a-z0-9]*(-[a-z0-9]+)*)$`. `assign` is a map of spec vars to scalars. Completeness against the spec is checked at `verify` time.

`verify` replays with `step`. `provedBy` is `next-state`. XState is not on this path. An assign that is not a total valuation of the spec is exit 2, fault `name-gap`, and the verify document has no `flows`. An event the spec never enables fails only that flow (exit 1). `a-basic` never declares `RESTORE`, so W6 fails and W1 still passes. An accepted flow whose start is not reachable from `initial` fails.

## JSON documents

These are shapes. Captured command output is in the pull request. Every `--json` document has `command` and `ok`. `issues` is an array of `{ "kind", "file", "path", "message" }`. `kind` is `schema`, `graph`, or `input`. A name gap is `graph`. A verify trace lists every attempted step. Each step still has `workflow` and `chart`, each `{ from, event, to }`. Those strings are label ids when a label uniquely matches the valuation. On a refused step, both `to` values are null.

`chart.check`, valid:

```json
{
  "command": "chart.check",
  "ok": true,
  "graphChecked": true,
  "chart": {
    "id": "todoTask",
    "vars": [{ "id": "phase", "type": "atom" }],
    "initial": { "phase": "draft" },
    "actions": [{ "event": "SUBMIT", "actor": "user" }],
    "labels": [{ "id": "draft", "text": "Draft" }]
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
        "nodes": [{ "id": "edit", "assign": { "phase": "draft", "listed": false, "title": "task" }, "state": "draft" }],
        "edges": [
          {
            "from": "edit",
            "event": "SUBMIT",
            "to": "listed",
            "text": "Add the draft to my list",
            "stateFrom": "draft",
            "stateTo": "todo"
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
      "provedBy": "next-state",
      "finalState": { "chart": "archived", "workflow": "archived" },
      "trace": [
        {
          "n": 3,
          "text": "Try to archive it before it is done",
          "accepted": true,
          "workflow": { "from": "inProgress", "event": "ARCHIVE", "to": "archived" },
          "chart": { "from": "inProgress", "event": "ARCHIVE", "to": "archived" }
        }
      ]
    }
  ],
  "unusedTransitions": [],
  "issues": []
}
```

`ok` is true only when every selected flow passed. `unusedTransitions` does not change the exit code. Preconditions (`fault` of `unreadable`, `invalid-chart`, `invalid-workflows`, `selection`, or `name-gap`) are exit 2 and omit `flows`. `transitionCoverage` and `views` are omitted unless `--heatmap` or `--replay` was passed.

`--heatmap --replay --out` adds:

```json
{
  "transitionCoverage": [
    { "from": "draft", "event": "SUBMIT", "to": "todo", "count": 7, "flows": ["W1", "W2", "W3", "W4", "W6", "W7", "W8"] }
  ],
  "views": {
    "heatmap": "coverage-heatmap.svg",
    "replays": [{ "id": "W8", "file": "replays/W8.gif", "frames": 4 }]
  }
}
```

`frames` counts the start state plus every trace step, so a three-step W8 replay has four frames and the fourth is the refused step. `--heatmap` alone omits `replays`. `--replay` alone omits `heatmap` and `transitionCoverage`.

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

`spec.facts.propose`. The first action `when` is `order: null`. The agent supplies a source valuation with `spec facts edit --id f1 --when '{"op":"eq","var":"order","value":"draft"}'`. This excerpt omits the warning findings that proposal usually returns.

```json
{
  "command": "spec.facts.propose",
  "ok": true,
  "session": "order-sentence",
  "facts": [
    { "id": "f1", "kind": "action", "event": "SUBMIT", "actor": "actor:customer", "when": { "op": "eq", "var": "order", "value": null }, "assign": { "order": "submit" }, "origin": "rule", "confidence": 0.5, "sources": ["s1.t4", "s1.t6"], "status": "current" },
    { "id": "f2", "kind": "action", "event": "APPROVE", "actor": "actor:manager", "when": { "op": "and", "of": [{ "op": "eq", "var": "order", "value": "submit" }, { "op": "eq", "var": "c1", "value": true }] }, "assign": { "order": "approve" }, "origin": "rule", "confidence": 0.6, "sources": ["s1.t9", "s1.t11"], "status": "current" }
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
  "id": "f3",
  "chain": [
    { "layer": "fact", "id": "f3", "type": "init", "status": "current", "origin": "agent", "refs": [] },
    { "layer": "entity", "id": "object:order", "kind": "object", "name": "order" }
  ],
  "findings": [
    { "id": "orphan:f3", "kind": "coverage", "code": "orphan", "severity": "warning", "message": "f3 has no sentence source", "refs": ["f3"] }
  ],
  "issues": []
}
```

`spec.view` after `spec init` of a session named `order`. `htmlPath` and `sessionDir` are absolute. Without `--open`, `url` is omitted.

```json
{
  "command": "spec.view",
  "ok": true,
  "session": "order",
  "htmlPath": "/home/user/.local/share/clew/repo-aaaaaaaaaaaa/spec/order/viewer.html",
  "sessionDir": "/home/user/.local/share/clew/repo-aaaaaaaaaaaa/spec/order",
  "mode": "session-folder",
  "findings": [],
  "issues": []
}
```

`spec.session.list` after `spec init` of `examples/spec/order.md`. `updated` is the timestamp stored in `session.json`. Counts are the live sentences, facts, and flows.

```json
{
  "command": "spec.session.list",
  "ok": true,
  "sessions": [
    {
      "id": "order",
      "updated": "2026-10-27T01:24:00.000Z",
      "summary": { "sentences": 3, "facts": 0, "flows": 0 }
    }
  ],
  "findings": [],
  "issues": []
}
```

An empty repo is `"sessions": []` and exit 0. `spec.session.remove` of that session:

```json
{
  "command": "spec.session.remove",
  "ok": true,
  "session": "order",
  "findings": [],
  "issues": []
}
```

An unknown id is exit 2 with `fault: "session"` and `issues` of `kind: "input"`. A live lock is exit 2 with `fault: "locked"`. A session id that fails the name rule is exit 2 with `fault: "usage"`.

`spec.status` before `spec graph build`. Other warnings are omitted. `graph-absent` is info, so the exit is still 0.

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
  "findingsByLayer": {
    "graph": [
      { "id": "graph-absent", "kind": "coverage", "code": "graph-absent", "severity": "info", "message": "the graph layer has not been built", "refs": [] }
    ]
  },
  "findings": [
    { "id": "graph-absent", "kind": "coverage", "code": "graph-absent", "severity": "info", "message": "the graph layer has not been built", "refs": [] }
  ],
  "issues": []
}
```

`spec.graph.build` after the agent sets `f1`’s `when` to `draft` and adds an `init` fact. `approve` is not final, so the exit is 0 with a warning. Boolean condition vars do not raise `guard-without-else`.

```json
{
  "command": "spec.graph.build",
  "ok": true,
  "session": "order-sentence",
  "graph": {
    "objects": ["order"],
    "states": [
      { "id": "draft", "object": "order", "initial": true, "facts": ["f1", "f3"] },
      { "id": "submit", "object": "order", "facts": ["f1", "f2"] },
      { "id": "approve", "object": "order", "facts": ["f2"] }
    ],
    "transitions": [
      { "id": "f1", "from": "draft", "event": "SUBMIT", "to": "submit", "actor": "customer", "object": "order", "fact": "f1", "facts": ["f1"] },
      { "id": "f2", "from": "submit", "event": "APPROVE", "to": "approve", "actor": "manager", "guard": "condition:c1", "object": "order", "fact": "f2", "facts": ["f2"] }
    ]
  },
  "flows": [
    { "id": "W1", "title": "Submit order", "expect": "accepted", "transitions": ["f1"], "origin": "rule" },
    { "id": "W2", "title": "Approve order", "expect": "accepted", "transitions": ["f2"], "origin": "rule" }
  ],
  "findings": [
    { "id": "no-final-state:order:approve", "kind": "gap", "code": "no-final-state", "severity": "warning", "message": "approve has no outgoing transition and is not marked final", "refs": ["approve"] }
  ],
  "issues": []
}
```

`spec.emit --dry-run` for that graph. Both transitions are accepted flows. `workflowSet` is that set as structured views, including each node's `assign`. The findings match the build, and they are omitted here. No file is written.

```json
{
  "command": "spec.emit",
  "ok": true,
  "session": "order-sentence",
  "dryRun": true,
  "id": "orderFlows",
  "workflowSet": {
    "id": "orderFlows",
    "workflows": [
      {
        "id": "W1",
        "title": "Submit order",
        "expect": "accepted",
        "start": "draft",
        "nodes": [
          { "id": "draft", "assign": { "order": "draft", "c1": false, "total": null }, "state": "draft" },
          { "id": "submit", "assign": { "order": "submit", "c1": false, "total": null }, "state": "submit" }
        ],
        "edges": [
          {
            "from": "draft",
            "event": "SUBMIT",
            "to": "submit",
            "text": "The customer submits an order",
            "stateFrom": "draft",
            "stateTo": "submit"
          }
        ]
      }
    ]
  },
  "yaml": "id: orderFlows\nworkflows:\n  - id: W1\n    title: \"Submit order\"\n    expect: accepted\n    start: draft\n    nodes:\n      - { id: \"draft\", assign: { order: \"draft\", c1: false, total: null } }\n      - { id: \"submit\", assign: { order: \"submit\", c1: false, total: null } }\n    edges:\n      - { from: \"draft\", event: \"SUBMIT\", to: \"submit\", text: \"The customer submits an order\" }\n",
  "findings": [],
  "issues": []
}
```

## Migration

| Old | New |
|---|---|
| `machineId` on the workflow file | Removed. Not compared. The set has its own `id`. |
| `workflowState` on a chart state | Removed. The workflow state name is the chart state id. |
| `steps: [{ text, event }]` and `end` | `nodes` (`id`, `assign`) and `edges` (`from`, `event`, `to`, `text`). `start` is the head. |
| Node `state` | `assign`, a full valuation of the spec vars. A node `state` field fails schema. |
| One implicit chain from the chart’s initial state | The list starts at a valuation reachable from `initial`. Revisiting a phase uses a second node id with a different map. |
| `clew verify chart workflows` and `clew compare workflows chart...` | `clew verify chart workflows`. `clew compare` reads verify JSON files. |
| `mapping.yaml` as the third argument to `clew verify` | Removed. This is a breaking change. `verify` uses domain `step`. An assign that is not a total valuation is exit 2 (`name-gap`). An event the spec never enables fails only that flow (exit 1). `provedBy` is `next-state`. |

`examples/todo/workflows.yaml` is the migrated to-do set: eight named sub-graphs. `examples/todo/a-basic.yaml` fails W6, W7, and W8. `examples/todo/b-full.yaml` passes all eight. The old `machineId` / `steps` / `end` shape and a chart that still carries `workflowState` are `tests/fixtures/workflows/legacy.yaml` and `tests/fixtures/charts/legacy-chart.yaml`. Those files fail schema validation with a migration hint. Other boundary files (a dead end, a branching list, a misspelled state, an effect that sets an undeclared field) are under `tests/fixtures/` and are covered by the Venom suites.

## Results on GitHub

The Venom suites run in the `venom` workflow on pull requests and on `main`. Open that run and read the venom job summary: one row per suite (suite, tests, passed, failed, time) and a collapsible section per suite. Failures come first and include the assertion text.

A failing test is an annotation on the run and on the pull request, on the test's line in `tests/venom/`. The `venom-report` artifact on the same run holds the JUnit XML, the HTML report, and `venom.log`. The artifact is kept for 14 days.
