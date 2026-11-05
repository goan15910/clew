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

**Concepts carry no kind; a frame's roles do.** A concept is a canonical word and the spans that say it. Whether `customer` is an actor or an object depends on where it sits in a clause, so that is a frame role, not a concept property. A role Clew cannot read is `unknown`. Clew does not invent an actor. A frame with an unknown actor still compiles, without an actor.

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
clew spec sentences add --text <sentence> [--after <id>] --reason <text> [--by <name>] [--finding <id>] [--comment <text>] [--session <id>] [--json]
clew spec sentences edit --id <id> --text <sentence> --reason <text> [--by <name>] [--finding <id>] [--comment <text>] [--session <id>] [--json]
clew spec sentences delete --id <id> --reason <text> [--by <name>] [--finding <id>] [--comment <text>] [--session <id>] [--json]
clew spec export [--version original|latest] (--out <file> | --dry-run) [--session <id>] [--json]
clew spec concepts list [--session <id>] [--json]
clew spec concepts group --span <id> (--into <concept> | --none) [--depends-on <span>]... --reason <text> [--by <name>] [--finding <id>] [--comment <text>] [--session <id>] [--json]
clew spec frames list [--sentence <id>] [--session <id>] [--json]
clew spec frames set --frame <id> --role actor|event|object|result|when (--value <ref>... | --unknown) [--depends-on <span>]... --reason <text> [--by <name>] [--finding <id>] [--comment <text>] [--session <id>] [--json]
clew spec frames not-transition --frame <id> [--clear] --reason <text> [--by <name>] [--finding <id>] [--comment <text>] [--session <id>] [--json]
clew spec impact <sentence> [--session <id>] [--json]
clew spec graph build [--session <id>] [--json]
clew spec graph split (--id <id> --at <edge> | --from <file.json>) [--session <id>] [--json]
clew spec graph group (--id <id> --id <id> | --transition <id> --transition <id> | --from <file.json>) [--title <text>] [--into <id>] [--session <id>] [--json]
clew spec emit (--dry-run | --out <file>) [--chart <file>] [--force] [--session <id>] [--json]
clew spec trace <id> [--session <id>] [--json]
clew spec status [--session <id>] [--json]
clew spec show tagged [--session <id>] [--json]
clew spec show tokens [--session <id>] [--json]
clew spec show concepts [--session <id>] [--json]
clew spec show frames [--session <id>] [--json]
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

`spec init` and `spec tag` split a plain-English spec and tag it. `spec concepts list` groups the spans into concepts, and `spec frames list` reads one clause frame per clause and compiles it. `spec concepts group`, `spec frames set`, and `spec frames not-transition` refine those layers, and `spec impact` lists what an edit of one sentence would drop. `spec graph build` assembles a draft graph from the compiled frames and proposes one path per transition, plus one rejected path per forbidden frame. `spec graph split` and `spec graph group` are how the agent edits those paths. `spec emit` writes the chosen paths as a workflow set. `spec show` prints one stored layer. `spec view` installs a human HTML inspector for one session. `spec trace` and `spec status` read the result back. `spec session list` and `spec session remove` show and delete sessions. Clew does not call a language model. The tagger and the proposal rules are a starting point; the calling agent is the guard.

`spec init <spec.md>` reads a Markdown or plain-text file and splits it into sentences. `-` is rejected: Clew never reads stdin. ATX headings (`#` through `######`) are section provenance on the following sentences, not sentences themselves. Fenced code blocks and HTML comments are skipped. Each sentence has an id (`s1`, `s2`, …), the exact source slice, a character span into the file, and a `sha256:` hash of that slice.

Running `spec init` again with the same session id refreshes that session. Without `--session`, the id is the spec file's basename, so two files with the same basename share a session unless one is given `--session`. Each sentence keeps `original` (the file text), `latest` (the text every later layer reads), and `history`. Unchanged original text keeps its id. A sentence nobody revised follows the file: when its text leaves the file it becomes a tombstone (`latest: null`) with a `removed-sentence` warning, and it is revived when the same text comes back. A sentence an agent or person revised keeps its `latest`. When its original leaves the file, Clew records that once in the history and reports `original-changed`. New text gets a new id; ids are never reused. Token spans shift if the text moved in the file.

`spec sentences add`, `edit`, and `delete` write `latest`. Every write needs `--reason`, records `--by` (default `agent`), and takes an optional `--finding` id and `--comment`. `add --after <id>` places the sentence; without it the sentence goes last. `--text` must be exactly one sentence. Delete leaves a tombstone. An edit or add re-tags that sentence when the session is tagged, and rebuilds its spans, concepts, and frames.

`spec export` writes the `original` or `latest` (default) sentences as Markdown, one paragraph per sentence under its section headings, so `spec init` reads the export back as the same sentences. It takes exactly one of `--out <file>` and `--dry-run`; `--dry-run` puts the Markdown in the document's `text`.

`spec tag` runs the part-of-speech tagger on the current sentences. `--sentence s3` tags only that sentence. The tagger is compromise, behind `PosTaggerPort`. `src/adapters/pos/compromise-tagger.ts` is the only file that imports it. The document names the tagger and its version. Running `tag` twice with the same tagger and the same sentences does not change the store. A tag history line lists sentence ids: `before` is the targeted sentences that already had current tokens, and `after` is every targeted sentence id. The first tag has an empty `before`. A token whose `origin` is `agent` is not overwritten; a disagreement is a `conflict` finding. Span edits are what set `origin` to `agent`. Each verb token also stores `lemma` and `participle`, both from compromise. A contraction such as "cannot" keeps the tags of its implied word, so it is `Negative`.

`--session` selects a session. When it is omitted, Clew uses the only open session. Zero sessions, or more than one, is exit 2.

The session store is one store per OS user, outside any repo. Every `clew spec` command uses it from any directory, inside a git repo or not. A session is known by its id alone. Clew does not record the directory, repo, or spec path it was registered from. Nothing is written next to the spec, and there is nothing to commit. On Linux and macOS the base directory is `$XDG_DATA_HOME/clew`, or `~/.local/share/clew` when `XDG_DATA_HOME` is unset. On Windows it is `%LOCALAPPDATA%\clew`. `CLEW_DATA_DIR` overrides that base. The synthetic pipeline harness is `tests/spec/synthetic-pipeline.harness.ts`. It always runs in CI against `tests/fixtures/synthetic-pipeline.md`. Under the data dir, sessions live at:

```txt
spec/<session-id>/
  session.json
  sentences.json
  tokens.json
  concepts.json
  frames.json
  flows.json
  history.jsonl
  viewer.html
```

`<session-id>` defaults to the spec file’s basename. Older Clew versions kept one store per project under `<project-key>/spec/`. The first command that opens the store moves those sessions into `spec/` and drops the spec path they recorded. When two projects have a session with the same id, one is kept and the other is dropped. Clew holds a lock only while a command writes the session, and removes that lock before the command exits. The lock is not a file that stays in the session. A lock whose process is gone is taken over. A live lock is exit 2.

`spec view <session-id>` installs a stable `viewer.html` into that session folder. The page is a self-contained browser inspector with Frames, Concepts, Sentences, Span, and Graph tabs. A Frames card shows the frame id, its sentence, `marker`, `negated`, and `not a transition` pills (with the reason), an `incomplete` pill when a transition frame's event, object, or result is unknown, the clause text, and the five roles with their latest value (or `unknown`) and `dependsOn` span ids. A role an agent or person wrote last has a `refined` pill, and a role Clew dropped back to its derived value has a `dropped` pill; both list their history as who, reason, and value. A frame with `notTransition` revisions lists them the same way. A Concepts member whose grouping was refined is marked `regrouped`. A frame that compiles to an action has a `reachable` pill and its witness events, an `unreachable` pill and the guard equalities that never hold (`blockedBy`), or an `unexplored` pill, as in `spec frames list`. When a graph transition or a forbidden flow cites the frame, the card shows that transition's event, `from`, and `to`, or the flow. A Concepts card shows the concept id, its canonical word, and its member spans with each span's surface and sentence id. Frames, Concepts, and Sentences have collapsed lineage drawers that link sentence, span, concept, frame, and graph rows: a frame lists its `dependsOn` spans marked in its sentence, the concepts its roles cite, the frames its `when` cites and the frames whose `when` cites it, and the transitions, states, and flows that cite it; a concept lists its member spans and the frames whose roles cite it; a sentence lists its concepts, its frames, and their transitions. Text search applies to every card tab. The Frame filter (`transition`, `not a transition`, `negated`, `incomplete`) applies to Frames and to Sentences (a sentence with a matching frame). The Concept filter applies to Frames (a role cites it), Concepts, and Sentences (a span links to it). The Span filter applies to Sentences and Span. The Graph tab draws the session draft graph and the workflows that graph can render, as images. It needs Graphviz (`dot`) on the machine serving the page. The page does not change domain JSON, `session.json` timestamps, or `history.jsonl`. The command names one session id (not `--session`, and not the session list). An unknown id or an unsafe id (`..`, a slash, or any id outside the session-id pattern) is exit 2. The document command is `spec.view`.

Browsers treat `file://` pages as opaque origins and block `fetch()` of sibling JSON, so opening `viewer.html` directly cannot reload live session files. With `--open`, Clew serves that session folder read-only on `127.0.0.1`, opens the browser, and keeps serving until Ctrl+C. A reload then picks up the latest `session.json`, `sentences.json`, `tokens.json`, `spans.json`, `concepts.json`, `frames.json`, and `flows.json`. Lineage requests `graph.json`, the Frames tab requests `clause-reach.json` (`{ session, frames }`, each compiled frame id mapped to its `reach`), and the Graph tab requests `draft-graph.json`. The server unfolds those responses when the page asks, and does not write them into the session folder. The 🔄 button next to the banner does the same reload without leaving the page. The session name in the header is a dropdown: opening it re-reads the sessions for this repo from the store (`/sessions.json`), and choosing one loads that session's files from `/sessions/<id>/` and sets `?session=<id>` in the URL. The server only serves session folders directly under this repo's spec root. Without `--open`, Clew only writes `viewer.html` and prints its path (or the JSON document).

`spec session list` lists every session. Each row has the id, `updated` (the last time Clew wrote that session), and `summary` counts of live sentences, frames, and flows. A live sentence has `latest` text. A frame counts unless it is marked not a transition. Flows are the paths stored in `flows.json`; a session with no overlay counts zero. An empty list is exit 0. List does not take the write lock and does not change the store. A session whose files cannot be read is still listed, with empty counts and the file’s modification time.

`spec session remove <id>` deletes that session directory and nothing else. An unknown id is exit 2. A live lock is exit 2 and the directory stays. A lock whose process is gone is taken over, the same way as any other write, and then the directory is deleted. The id is one session name: a letter, then letters, digits, underscores, or hyphens. `..`, a slash, or any other unsafe id is exit 2. Clew deletes the directory only when its real path is `<spec-root>/<id>`. A symlink is left in place. Sessions for other repos are not touched.

`history.jsonl` records each write. `before` is the ids that existed before the write, and `after` is the ids after it. Tag records sentence ids, concepts list records concept ids, frames list records frame ids, and graph build, split, and group record flow ids. The first `spec tag`, `spec concepts list`, `spec frames list`, and `spec graph build` have an empty `before`. `spec concepts group` records the span's concept before and after (empty for `--none`), and `spec frames set` and `spec frames not-transition` record the frame id; their `args` carry the span, frame, role, values, `into`, `dependsOn`, and `clear` that were passed. A write that drops a refinement appends one more line per drop under the same command, with `args` `{ id, role, reason, finding, text }` (the target, the role, `sN changed`, the finding id, and the value it read). Its `after` is empty when the target no longer derives.

`session.json` carries `schemaVersion`. This Clew reads schema 5. A different version is exit 2 with no migration — drop the old session and re-run `clew spec init` / `tag`. The store adapter is the only place that validates that JSON with Zod.

Every spec document has `findings`. A finding is `{ id, kind, code, severity, message, refs }`. `kind` is `gap`, `conflict`, `stale`, `vocabulary`, or `coverage`. `severity` is `blocking`, `warning`, or `info`. `ok` means the layer was produced. It stays true when findings are present. Exit 0 means no blocking finding. Exit 1 means a blocking finding is in the document, and stderr stays empty. Warnings and info do not change the exit code.

`spec init` findings:

| Code | Severity | When |
|---|---|---|
| `no-sentences` | blocking | the file has no sentence text |
| `empty-sentence` | warning | a block had no sentence text |
| `non-english` | warning | a sentence uses a non-Latin script |
| `duplicate-sentence` | warning | the same sentence text appears twice |
| `removed-sentence` | warning | an unrevised sentence left the file and is now a tombstone |
| `original-changed` | warning | a revised sentence's original left the file; review the revision |

Latin-script languages are not detected. Translate those to plain English before `spec init`.

`spec tag` findings:

| Code | Severity | When |
|---|---|---|
| `no-verb` | warning | no token is tagged `Verb` |
| `no-actor` | warning | no token is tagged `Actor` |
| `condition-without-clause` | warning | the sentence says if, when, or unless, and the tagger returned one clause |
| `agent-tokens` | warning | agent-owned tokens were left in place |
| `tagger-version` | info | the stored tagger version differs from this one |
| `removed-sentence`, `original-changed` | warning | the same sentence findings as `spec init` |

`spec concepts list` groups the live spans into concepts and writes `concepts.json` the first time. Running it again, when nothing changed, does not append history. A concept is `{ id, canonical, members }`: `concept:<canonical>`, the canonical word, and the span ids that say it. It has no kind. A content verb's canonical word is its compromise lemma. A noun's is its singular. An adjective keeps its lower-cased surface. Values, units, currency, determiners, prepositions, pronouns, auxiliaries, and insignificant spans name no concept, so "dollars" and "it" are skipped. The same word maps to the same concept. A span whose link an agent or person set keeps that link. Each span's `entityId` holds its concept id. The document lists each concept with its members as `{ span, surface, sentence }`, and `groups`.

`spec concepts group --span <id> --into <concept>` moves one live span into another concept, and `--none` takes it out of every concept. A concept id that does not exist yet is created with the id's word as canonical. A grouping is `{ span, original, latest, dependsOn, history }`: `original` is the concept the words alone give, `latest` is the agent's choice, and `dependsOn` defaults to the span itself. Groupings are kept in `concepts.json` `groups` and applied after the lexical grouping on every rebuild, so the span's `entityId` follows `latest` and frames re-read their roles from it. Writing the value the span already has is exit 2, `<span> already reads that value`.

Refinements are kept until their evidence changes. When `spec sentences add`, `edit`, or `delete` changes a sentence that a refined field's or grouping's latest `dependsOn` cites, that `latest` falls back to `original`, a `clew` revision `{ reason: "sN changed", finding, value }` is appended with the value it read, and the frame layer reports `refinement-dropped`. A frame's own `notTransition` mark is dropped when its sentence changes. A refined frame or span that no longer derives is reported once, in the command's document and as a history line. `spec impact <sentence>` lists, without writing, every field and grouping whose latest `dependsOn` cites a span of that sentence (`refined` is true when an agent or person wrote it last), and the sentence's frames. An unknown sentence is exit 2.

`spec frames list` reads one clause frame per clause and writes `frames.json`. It derives concepts first when they are missing. `--sentence s1` limits the document, and its findings, to that sentence; the store still holds every frame. Running it again, when nothing changed, does not append history. A frame id is `fr:<first token id>` (`fr:s1.t7`). A frame has `sentence`, `clause` (`text`, `start`, `end`), an optional `marker` (`when`, `if`, `unless`, `after`, `before`, `once`, or `then`), `negated: true` when the clause says not, never, no, or a negative contraction, and `notTransition: { reason }` when the clause has no content verb. Its `roles` are `actor`, `event`, `object`, `result`, and `when`. Each role is a field `{ original, latest, history }`. A version is `{ value, dependsOn }`: `value` is `unknown` or `{ text, refs }`, and `dependsOn` lists the span ids it was read from. `history` entries are `{ at, who, reason, finding?, comment?, value }`. A frame also has its own `history` of `notTransition` revisions, whose `value` is `{ notTransition }`.

`spec frames set --frame <id> --role <role>` writes one role's `latest`. `--value` is a concept id for `actor`, `object`, and `result`, a live content-verb span for `event`, and one or more frame ids for `when` (repeatable, in order); `--unknown` sets it to `unknown`. The text is read from the refs: the concept canonical, the span lemma, or the cited clauses joined with " and ". `--depends-on` is repeatable and may cite spans in other sentences; it defaults to the value's evidence: the concept's members in this sentence (else all of them), the event span, or each cited frame's event span (or its first significant span). A ref that is not live, or the wrong kind for the role, is exit 2. `spec frames not-transition --frame <id> --reason <text>` marks a frame `notTransition: { reason, who }`, and `--clear` drops the mark so the frame falls back to its derived value. Both re-compile the frames. Writing the value the field already has is exit 2, `<frame> <role> already reads that value`. The document is the frame view and the findings on that frame's sentence.

Roles are read by position. The event is the first content verb that is not adjectival ("a shipped order" is not an event). The actor is the last noun before it, and the object is the first noun after it, up to as, into, a condition marker, or then. A clause with only one noun reads it as the object. A passive verb takes the noun before it as the object and the noun after "by" as the actor. A clause that starts with and, or, or then, and has no actor, inherits the previous frame's actor. An object pronoun ("it", "them") after the event takes the previous frame's object in the same sentence, and the pronoun span joins its `dependsOn`. The result is the concept after "as" or "into", otherwise the event's compromise past participle (`approved`). `when` lists the condition frames and earlier frames this one waits on. A condition clause attaches to the next transition clause, or to the previous one when it comes last. A `then` clause waits on the frame before it, across sentences.

Each frame compiles into the spec. An object becomes the atom var `<object>_status`, starting at `null`. The event becomes `UPPER_SNAKE` (`APPROVE`), and the action assigns the result. A `when` ref to a frame on the same object sets `from` to that frame's result. A ref to another object adds an equality on that object's result. A ref to a not-a-transition frame becomes the boolean var `cond_<sentence>_<token>` (`cond_s1_t12`), true for if and when, false for unless; the guard is `condition:cond_s1_t12`. A negated frame compiles to a forbidden item instead of an action. A frame with an unknown actor compiles without one. A frame that restates an earlier frame (same kind, object, event, from, result, and guard) adds nothing. Clew does not propose init or terminal marks, so every object starts at `null`. Each document frame that compiles carries `compiled` (`kind`, `event`, `object`, `from`, `to`, `actor`); a restating frame shows the earlier frame's.

`spec frames list` also explores the compiled spec breadth-first from its initial valuation, up to 5000 states, and gives each frame that compiles to an action a `reach`. `reach.status` is `reachable` when the action's guard holds in a reached state; `witness` is then the shortest event path to the first such state, followed by the action's own event (`["PACK", "SHIP"]`). It is `unreachable` when the search finished without the guard holding; `blockedBy` lists the guard equalities that hold in no reached state (`cond_s3_t1 = true`, `order_status = "paid"`), and is empty when each holds somewhere but never together. It is `unexplored` when the search hit the bound first; the kernel never says `unreachable` after a truncated search. Forbidden and not-a-transition frames have no `reach`, and a restating frame shows the earlier frame's. The text summary prints `reachable via PACK → SHIP` or `unreachable: <blockedBy>` under the frame. Reach is derived on read and never stored. `spec status` reports the matching findings; `spec frames list` does not.

`spec frames list` findings:

| Code | Severity | When |
|---|---|---|
| `frame-missing-event` | warning | a transition frame has no event |
| `frame-missing-object` | warning | a transition frame has no object, for example "ships it" |
| `frame-missing-result` | warning | a transition frame has no result |
| `value-never-assigned` | warning | a guard checks a value that no action assigns, such as a condition var |
| `refinement-dropped` | warning | a sentence a refined field, grouping, or `notTransition` mark depended on changed, so it fell back to its derived value (kind `stale`) |

`spec trace <id>` walks provenance. It resolves a concept id (`concept:order`) first, then a transition id, then a frame id, a token id, a sentence id, and a flow id (`W1`). Graph transitions use their frame id (`fr:s1.t7`), so a transition walks to its frames, their concepts, their tokens, and the sentence. A concept walks its member tokens and their sentences. A state walks the frames that reach or leave it. A chain with no sentence also reports `orphan`. An unknown id is exit 2. Trace does not write the store.

`spec show sentences`, `spec show tagged`, `spec show tokens`, `spec show spans`, `spec show concepts`, and `spec show frames` print one stored layer. The command values are `spec.show.sentences`, `spec.show.tagged`, `spec.show.tokens`, `spec.show.spans`, `spec.show.concepts`, and `spec.show.frames`.

`spec show sentences` works right after `spec init`. Each row has `id`, `text`, `section` (the heading path), `status`, and `workflows`. `workflows` lists the `id` and `title` of each draft-graph flow whose transitions or forbidden frame cite the sentence. It is empty until `spec graph build` writes flows. `spec show spans` lists the live span partition after `spec tag`. Each span has `id`, `sentence`, `surface`, and `tags` (the POS tags), plus its token cover, origin, and concept link (`entityId`). Every span view carries `sentence`, including the spans in `spec tag` and `spec spans merge` output.

These commands leave the session and `history.jsonl` unchanged, and `updated` stays as it was. `findings` is always an empty list. `spec status` recomputes findings.

Exit 0 means the requested layer has been written. An empty concept list and an empty frame list are written. Exit 2 means the layer has not been written, the session is missing, the session is locked, or the arguments are wrong. The exit is 0 or 2.

The stderr message names only the first missing layer. Tagged sentences and unique tokens need the tag layer, and the message is `no tokens; run clew spec tag first`. Concepts need that layer, then a written concept list: `no concepts; run clew spec concepts list first`. Frames need the tag layer, then a written frame list: `no frames; run clew spec frames list first`. `spec graph build` also needs the frame list, with the same message.

`spec init` writes an empty `tokens.json` and leaves the tagger unset. That file is not a tag layer. The tag layer is written when the session has a tagger, or when any tagged sentence has tokens.

`spec show tagged` prints `sentences`, the same tagged view as `spec tag`, for the current sentences. `spec show tokens` prints `tokens`. Each item has the lower-cased `text`, a `count`, the original `forms` in first-seen order, and `readings`. A reading has `tags` and the token ids. Unique tokens are grouped words with tag readings and sN.tM ids, not a concept list. `spec show concepts` prints `concepts` in stored order. `spec show frames` prints `frames`, the same view as `spec frames list`.

`spec status` recomputes open findings by layer. `coverage.sentences` is mapped, pending, and deleted. A live sentence is mapped when one of its frames compiles. `coverage.concepts` is the concept count. `coverage.frames` counts `transition`, `notTransition`, and `incomplete` (a transition frame that does not compile). `layers` reports `tokens`, `concepts`, `frames`, and `graph`; `layers.graph` is true after `spec graph build` has written `flows.json`. A missing concept, frame, or graph layer is an info `concepts-absent`, `frames-absent`, or `graph-absent` finding. The frame layer's findings are the `spec frames list` findings, including `refinement-dropped` until a later write refines that field again, followed by the clause kernel findings `clause-unreachable` and `clause-unexplored`. `clauses` lists one entry per compiled action, `{ frame, sentence, event, status, witness?, blockedBy? }`, with the same reach as `spec frames list`. The text summary prints one `clause <frame> <EVENT> reachable via …`, `unreachable: …`, or `unexplored: …` line per entry before the findings. Kernel findings are a warning and an info, so they do not change the exit. Status does not write the store. `findingsByLayer.graph` is the graph layer on its own.

`spec trace` and `spec status` findings:

| Code | Severity | When |
|---|---|---|
| `orphan` | warning | a traced id has no sentence source |
| `transition-without-from` | blocking | a compiled action has no source valuation for its object var |
| `tokens-absent` | info | `spec tag` has not been run |
| `concepts-absent` | info | `spec concepts list` has not been run |
| `frames-absent` | info | `spec frames list` has not been run |
| `graph-absent` | info | `spec graph build` has not been run |
| `clause-unreachable` | warning | a compiled action is never enabled from the initial state; kind `gap`, refs `[frame, sentence]`, message `<frame> (<EVENT>) is never enabled from the initial state: <blockedBy> never holds` |
| `clause-unexplored` | info | the reach search hit its state bound before the action was enabled; kind `gap`, refs `[frame, sentence]` |

`spec graph build` unfolds overlay states and transitions from the compiled frames and writes a flows overlay keyed by frame id (`flows.json`). Truncation explores the compiled spec from its initial valuation. States and transitions are recomputed on every read. A leftover `graph.json` is read as-is until the next write, which unlinks it and stores `flows.json`. Concept and frame writes keep the overlay when frame ids remain. Running build again, when the paths are unchanged, does not append history. A build history line’s `before` lists the flow ids already stored, and `after` lists the flow ids written. The first build has an empty `before`. Split and group record the same way. A transition's `id` and `frame` are its frame id, and `frames` lists the frames it cites. A state's `frames` lists the frames that reach or leave it. Transition `from` and `to` are result atoms (`submitted`, `approved`). Transition `event` is the frame's event (`SUBMIT`). A frame that waits on nothing for its object starts at the default atom `null`. `transition-without-from` stays only when the source valuation is missing. Truncation at the reach bound is a blocking `state-space-truncated`.

The path cover is one accepted flow per provable transition (`Submit order` for event `SUBMIT` on object `order`) and one rejected flow per forbidden frame (`Cannot approve order`, `rejectAt` 1). A condition var is boolean, so the false value is the else and `guard-without-else` is not raised for `condition:` guards. A forbidden frame that matches a transition on the same object and event cites that transition. A forbidden frame with no matching transition needs an initial state; it is then a rejected flow with an empty transition list, and emit draws it from that state to the attempted result atom and uses the source sentence as the edge text. Without either, it is `forbidden-uncovered`. Because Clew does not propose initial marks, "The customer cannot cancel a shipped order" alone is `forbidden-uncovered`. The flow's `forbidden` is the frame id. Flows with `origin: agent` are kept when they still chain. A disagreement is a warning `agent-flow`. An agent flow that no longer chains is dropped, with a warning `stale-flow`. Rule flows that are still the same single edge, or the same forbidden frame, keep their ids.

`spec graph split --id W1 --at 2` cuts an accepted path before the second edge. `--at fr:s1.t7` names that transition instead. The first path keeps `W1`. The second path gets the next workflow id. Both become `origin: agent`. A rejected path is a blocking `rejected-split` and is not written. A cut that would leave a path with no edge is `unsplittable` and is not written. An unknown flow or split point is exit 2.

`spec graph group` joins accepted paths into one linear workflow. `--id W1 --id W2` walks the flows in that order. `--transition fr:s1.t1 --transition fr:s1.t7` walks those edges. The two modes are not combined. `--into` defaults to the first flow, or to the flow that already contains the first transition. `--title` sets the title; otherwise the titles are joined with ` and `. The result is `origin: agent`. A rejected input is `rejected-group`. Paths that do not chain are `not-linear`. A flow that shares some of the named transitions and keeps others is `overlap`. An `--into` id that already exists and is not one of the inputs is `duplicate-flow`. Those findings do not write. A successful edit writes even when other graph findings are still blocking, and the exit is 1.

`spec graph split` and `group` take flags or `--from <file>`. `--from -` is rejected. Flags and `--from` together are rejected. A split patch is `{ "id": "W1", "at": 2 }` or `{ "id": "W1", "at": "fr:s1.t7" }`. A group patch is `{ "ids": ["W1", "W2"], "title": "..." }` or `{ "transitions": ["fr:s1.t1", "fr:s1.t7"] }`, with optional `into`.

`spec graph build` findings:

| Code | Severity | When |
|---|---|---|
| `transition-without-from` | blocking | a compiled action still has no source valuation, so it is omitted |
| `guard-without-else` | blocking | a guarded transition has no other guard on the same state and event, and no forbidden frame for that object and event |
| `self-loop` | blocking | a transition’s source and target are the same state |
| `vocabulary` | blocking | a state name is not workflow vocabulary |
| `type-mismatch` | blocking | a compiled action has no target assign |
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

`spec emit` writes the chosen paths as a workflow set of full valuation maps. `--chart` writes the unfolded Spec as `clew.spec.v1` YAML, including a valid empty spec (no vars, no actions) when that is what the frames yield. The draft overlay is keyed by frame id. `--dry-run` prints the YAML in the JSON document (`yaml` and `chartYaml`) and does not write a file, even with `--force`. `--out` is required otherwise. `--dry-run` and `--out` together are exit 2. `--out -` and `--chart -` are rejected. Emit walks each flow with the `when` equalities that no action assigns, so a later guard can still produce a total map. `--chart` writes the compiled spec (one initial, every var `null` or `false`) whenever `--chart` is set, even when the workflow set is empty or missing. A flow whose start is not reachable from that initial fails `verify`. Edge text is the clause that contains the action, extended through the object, with a leading when, after, before, or once removed. A guard’s text is appended when the clause does not already contain it. A rejected flow uses the forbidden frame’s source sentence.

Emit refuses while a blocking finding remains on the graph layer. `--force` writes the requested files anyway, sets `forced: true`, lists the findings, and still exits 1. `--force --chart` still writes the chart when there are no workflows. Earlier-layer warnings, such as `frame-missing-object`, do not block emit. There is no per-finding waiver. There is no `stale-graph`: unfold recomputes on read, and split/group overlays survive when frame ids remain. Emit does not write the session. Check failures from the workflow-set rules are `workflow-check` findings, with refs to the flow, its frames, and their sources. They are not `issues`. The set id is the object name plus `Flows` (`order` becomes `orderFlows`). Two objects join as `orderAndShipmentFlows`.

`spec emit` findings:

| Code | Severity | When |
|---|---|---|
| `uncovered-transition` | blocking | a provable transition is not on an accepted path. A guard with no else is `guard-without-else` instead |
| `overlap` | blocking | a transition is on more than one accepted path |
| `path-not-linear` | blocking | a flow does not chain |
| `missing-transition` | blocking | a flow cites a transition that is gone |
| `missing-reject-at` | blocking | a rejected flow has no `rejectAt` |
| `forbidden-uncovered` | blocking | a forbidden frame has no rejected flow |
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

`spec.concepts.list`, after `spec tag`. Concepts have no kind. This excerpt shows two of the six.

```json
{
  "command": "spec.concepts.list",
  "ok": true,
  "session": "order-sentence",
  "concepts": [
    { "id": "concept:customer", "canonical": "customer", "members": [{ "span": "sp:s1.t3..s1.t3", "surface": "customer", "sentence": "s1" }] },
    { "id": "concept:order", "canonical": "order", "members": [{ "span": "sp:s1.t6..s1.t6", "surface": "order", "sentence": "s1" }, { "span": "sp:s1.t11..s1.t11", "surface": "order", "sentence": "s1" }] }
  ],
  "findings": [],
  "issues": []
}
```

`concepts.json` stores `{ "schemaVersion": 5, "concepts": [{ "id", "canonical", "members": ["sp:s1.t6..s1.t6"] }], "groups": [] }`.

`spec.concepts.group --span sp:s1.t8..s1.t8 --into concept:clerk`, on a spec whose second sentence is "A clerk must not cancel a shipped package." `concepts` is the same list as `spec.concepts.list` and is not shown. `groups` lists every grouping in the session.

```json
{
  "command": "spec.concepts.group",
  "ok": true,
  "session": "refine",
  "grouping": {
    "span": "sp:s1.t8..s1.t8",
    "original": "concept:manager",
    "latest": "concept:clerk",
    "dependsOn": ["sp:s1.t8..s1.t8"],
    "history": [{ "at": "2026-01-01T00:00:00.000Z", "who": "agent", "reason": "same role as the clerk", "value": { "concept": "concept:clerk", "dependsOn": ["sp:s1.t8..s1.t8"] } }]
  },
  "groups": [{ "span": "sp:s1.t8..s1.t8", "original": "concept:manager", "latest": "concept:clerk", "dependsOn": ["sp:s1.t8..s1.t8"], "history": ["..."] }],
  "findings": [],
  "issues": []
}
```

`spec.frames.list --sentence s1`, one frame. Only `actor` and `when` are shown; `event`, `object`, and `result` have the same field shape. `when` waits on the first clause and the condition clause, so the action is guarded by `condition:cond_s1_t12`.

```json
{
  "command": "spec.frames.list",
  "ok": true,
  "session": "order-sentence",
  "frames": [
    {
      "id": "fr:s1.t7",
      "sentence": "s1",
      "clause": { "text": "the manager approves the order", "start": 36, "end": 66 },
      "roles": {
        "actor": {
          "original": { "value": { "text": "manager", "refs": ["concept:manager"] }, "dependsOn": ["sp:s1.t8..s1.t8"] },
          "latest": { "value": { "text": "manager", "refs": ["concept:manager"] }, "dependsOn": ["sp:s1.t8..s1.t8"] },
          "history": []
        },
        "when": {
          "original": { "value": { "text": "When the customer submits an order and if the total is under 500 dollars", "refs": ["fr:s1.t1", "fr:s1.t12"] }, "dependsOn": ["sp:s1.t1..s1.t1", "sp:s1.t4..s1.t4", "sp:s1.t12..s1.t12", "sp:s1.t14..s1.t14"] },
          "latest": { "value": { "text": "When the customer submits an order and if the total is under 500 dollars", "refs": ["fr:s1.t1", "fr:s1.t12"] }, "dependsOn": ["sp:s1.t1..s1.t1", "sp:s1.t4..s1.t4", "sp:s1.t12..s1.t12", "sp:s1.t14..s1.t14"] },
          "history": []
        }
      },
      "compiled": { "event": "APPROVE", "object": "order", "from": "submitted", "to": "approved", "actor": "manager", "kind": "action" },
      "reach": { "status": "unreachable", "blockedBy": ["cond_s1_t12 = true"] }
    }
  ],
  "findings": [
    { "id": "value-never-assigned:cond_s1_t12=true", "kind": "gap", "code": "value-never-assigned", "severity": "warning", "message": "cond_s1_t12 is checked for true, but no action assigns it", "refs": ["cond_s1_t12", "fr:s1.t7"] }
  ],
  "issues": []
}
```

The condition clause is its own frame, `fr:s1.t12`, with `"marker": "if"`, `"notTransition": { "reason": "no verb" }`, and every role `unknown`. `frames.json` stores `{ "schemaVersion": 5, "frames": [...] }` without `compiled`. Each stored frame has `history`, and an agent's `notTransition` also stores `who`.

`spec.frames.set --frame fr:s1.t7 --role actor --value concept:clerk` on the same two-sentence spec. Only `actor` is shown. `dependsOn` defaults to the clerk span in s2, so an edit of s2 drops this write.

```json
{
  "command": "spec.frames.set",
  "ok": true,
  "session": "refine",
  "frame": {
    "id": "fr:s1.t7",
    "sentence": "s1",
    "clause": { "text": "the manager approves the order", "start": 36, "end": 66 },
    "roles": {
      "actor": {
        "original": { "value": { "text": "manager", "refs": ["concept:manager"] }, "dependsOn": ["sp:s1.t8..s1.t8"] },
        "latest": { "value": { "text": "clerk", "refs": ["concept:clerk"] }, "dependsOn": ["sp:s2.t2..s2.t2"] },
        "history": [{ "at": "2026-01-01T00:00:00.000Z", "who": "agent", "reason": "the clerk approves", "value": { "value": { "text": "clerk", "refs": ["concept:clerk"] }, "dependsOn": ["sp:s2.t2..s2.t2"] } }]
      }
    },
    "history": [],
    "compiled": { "event": "APPROVE", "object": "order", "from": "submitted", "to": "approved", "actor": "clerk", "kind": "action" }
  },
  "findings": [
    { "id": "value-never-assigned:cond_s1_t12=true", "kind": "gap", "code": "value-never-assigned", "severity": "warning", "message": "cond_s1_t12 is checked for true, but no action assigns it", "refs": ["cond_s1_t12", "fr:s1.t7"] }
  ],
  "issues": []
}
```

`spec.frames.not-transition` returns the same document as `spec.frames.set`, with the frame's `notTransition` and its frame-level `history`.

`spec.impact s2` after that write. The first entry is the refined actor; the rest are s2's own derived fields. An edit of s2 then reports `{ "id": "refinement-dropped:fr:s1.t7:actor", "kind": "stale", "code": "refinement-dropped", "severity": "warning", "message": "fr:s1.t7 actor fell back to its derived value (s2 changed); it read \"clerk\"", "refs": ["fr:s1.t7", "s1"] }`, and the actor reads `manager` again.

```json
{
  "command": "spec.impact",
  "ok": true,
  "session": "refine",
  "sentence": "s2",
  "impact": [
    { "kind": "field", "frame": "fr:s1.t7", "role": "actor", "value": { "text": "clerk", "refs": ["concept:clerk"] }, "dependsOn": ["sp:s2.t2..s2.t2"], "refined": true },
    { "kind": "field", "frame": "fr:s2.t1", "role": "actor", "value": { "text": "clerk", "refs": ["concept:clerk"] }, "dependsOn": ["sp:s2.t2..s2.t2"], "refined": false },
    { "kind": "field", "frame": "fr:s2.t1", "role": "event", "value": { "text": "cancel", "refs": ["sp:s2.t5..s2.t5"] }, "dependsOn": ["sp:s2.t5..s2.t5", "sp:s2.t4..s2.t4"], "refined": false }
  ],
  "frames": ["fr:s2.t1"],
  "findings": [],
  "issues": []
}
```

A grouping entry is `{ "kind": "grouping", "span", "value", "dependsOn", "refined" }`, with the concept id (or null) as `value`. An agent's `notTransition` mark on one of the sentence's frames is an entry with role `notTransition`, its reason as the value, and an empty `dependsOn`. The text form prints one line per entry, `refined fr:s1.t7 actor = clerk  <- sp:s2.t2..s2.t2`.

`spec.trace concept:order`. A concept walks its member tokens and their sentence.

```json
{
  "command": "spec.trace",
  "ok": true,
  "session": "order-sentence",
  "id": "concept:order",
  "chain": [
    { "layer": "concept", "id": "concept:order", "name": "order", "refs": ["sp:s1.t6..s1.t6", "sp:s1.t11..s1.t11"] },
    { "layer": "token", "id": "s1.t6", "text": "order", "tags": ["Noun", "Singular"], "span": [29, 34], "origin": "tagger", "status": "current" },
    { "layer": "sentence", "id": "s1", "status": "original", "text": "When the customer submits an order, the manager approves the order if the total is under 500 dollars.", "span": [0, 101], "section": "" },
    { "layer": "token", "id": "s1.t11", "text": "order", "tags": ["Noun", "Singular"], "span": [61, 66], "origin": "tagger", "status": "current" }
  ],
  "findings": [],
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

`spec.session.list` after `spec init` of `examples/spec/order.md`. `updated` is the timestamp stored in `session.json`. Counts are the live sentences, transition frames, and flows.

```json
{
  "command": "spec.session.list",
  "ok": true,
  "sessions": [
    {
      "id": "order",
      "updated": "2026-10-27T01:24:00.000Z",
      "summary": { "sentences": 3, "frames": 0, "flows": 0 }
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

`spec.status` before `spec graph build`. Other warnings, including the frame layer's `clause-unreachable:fr:s1.t7`, are omitted. `graph-absent` is info and `clause-unreachable` is a warning, so the exit is still 0.

```json
{
  "command": "spec.status",
  "ok": true,
  "session": "order-sentence",
  "coverage": {
    "sentences": { "mapped": ["s1"], "pending": [], "deleted": [] },
    "concepts": 6,
    "frames": { "transition": 2, "notTransition": 1, "incomplete": 0 }
  },
  "layers": { "tokens": true, "concepts": true, "frames": true, "graph": false },
  "findingsByLayer": {
    "graph": [
      { "id": "graph-absent", "kind": "coverage", "code": "graph-absent", "severity": "info", "message": "the graph layer has not been built", "refs": [] }
    ]
  },
  "clauses": [
    { "frame": "fr:s1.t1", "sentence": "s1", "event": "SUBMIT", "status": "reachable", "witness": ["SUBMIT"] },
    { "frame": "fr:s1.t7", "sentence": "s1", "event": "APPROVE", "status": "unreachable", "blockedBy": ["cond_s1_t12 = true"] }
  ],
  "findings": [
    { "id": "graph-absent", "kind": "coverage", "code": "graph-absent", "severity": "info", "message": "the graph layer has not been built", "refs": [] }
  ],
  "issues": []
}
```

`spec.graph.build` after `spec frames list`. No init mark is proposed, so the order starts at `null` and the build warns `no-initial-state`. `approved` is not final, so the exit is 0 with warnings. Boolean condition vars do not raise `guard-without-else`. The two transitions chain into one flow.

```json
{
  "command": "spec.graph.build",
  "ok": true,
  "session": "order-sentence",
  "graph": {
    "objects": ["order"],
    "states": [
      { "id": "null", "object": "order", "frames": ["fr:s1.t1"] },
      { "id": "submitted", "object": "order", "frames": ["fr:s1.t1", "fr:s1.t7"] },
      { "id": "approved", "object": "order", "frames": ["fr:s1.t7"] }
    ],
    "transitions": [
      { "id": "fr:s1.t1", "from": "null", "event": "SUBMIT", "to": "submitted", "object": "order", "frame": "fr:s1.t1", "frames": ["fr:s1.t1"], "actor": "customer" },
      { "id": "fr:s1.t7", "from": "submitted", "event": "APPROVE", "to": "approved", "object": "order", "frame": "fr:s1.t7", "frames": ["fr:s1.t7"], "actor": "manager", "guard": "condition:cond_s1_t12" }
    ]
  },
  "flows": [
    { "id": "W1", "title": "Order lifecycle", "expect": "accepted", "transitions": ["fr:s1.t1", "fr:s1.t7"], "origin": "rule" }
  ],
  "findings": [
    { "id": "no-initial-state:order", "kind": "gap", "code": "no-initial-state", "severity": "warning", "message": "order has no initial state", "refs": ["order"] },
    { "id": "no-final-state:order:approved", "kind": "gap", "code": "no-final-state", "severity": "warning", "message": "approved has no outgoing transition and is not marked final", "refs": ["approved"] }
  ],
  "issues": []
}
```

`spec.emit --dry-run` for that graph. `workflowSet` is that set as structured views, including each node's `assign`. The findings match the build, and they are omitted here, as is the second edge. No file is written.

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
        "title": "Order lifecycle",
        "expect": "accepted",
        "start": "null",
        "nodes": [
          { "id": "null", "assign": { "cond_s1_t12": false, "order_status": null }, "state": "cond_s1_t12,order_status" },
          { "id": "submitted", "assign": { "cond_s1_t12": false, "order_status": "submitted" }, "state": "submitted" },
          { "id": "approved", "assign": { "cond_s1_t12": true, "order_status": "approved" }, "state": "approved" }
        ],
        "edges": [
          { "from": "null", "event": "SUBMIT", "to": "submitted", "text": "The customer submits an order", "stateFrom": "cond_s1_t12,order_status", "stateTo": "submitted" }
        ]
      }
    ]
  },
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
