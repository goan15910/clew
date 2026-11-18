# Projected views of a TLA+ model

A model that TLC checks can have millions of states. Nobody reads that. A *projected view* keeps a few variables and hides the rest, so the part of the behaviour a person asked about fits on a page. `clew spec projection` helps an agent decide what to keep, write the view, prove it against the model, and draw it.

This is section 6 of the PoC proposal ("Analysing and visualising the TLA+ model"). It stacks on the canonical pipeline ([canon.md](canon.md)), spec versioning ([versioning.md](versioning.md)), and English workflows ([workflows.md](workflows.md)), and works on any TLA+ module of the shape `clew spec canon export` writes. A worked, synthetic example is `examples/projection/Fulfil.tla`.

## Workflow

```bash
clew spec projection analyze tla/Fulfil.tla                       # what reads what; the views worth drawing
clew spec projection propose --name FulfilOrder --keep order_status --candidate c5 --reason "..."
clew spec projection draft tla/Fulfil.tla --name FulfilOrder --keep order_status   # a starter view, yours to edit
clew spec projection check tla/FulfilOrder.tla --against tla/Fulfil.tla --cover --name FulfilOrder
clew spec projection render tla/FulfilOrder.tla --out order.svg   # TLC dumps the graph, Graphviz draws it
clew spec projection finalize --name FulfilOrder --reason "..."   # only after a passing check
clew spec projection list
```

For a larger model, keep the state graph of a mid-sized view and read it many times:

```bash
clew spec projection dump tla/FulfilCore.tla --out tla/core.dot
clew spec projection analyze tla/FulfilCore.tla --graph tla/core.dot --keep order_status,payment_status
clew spec projection render tla/core.dot --keep order_status,payment_status --to order_status=closed --out order-payment.png
```

TLC comes from `--jar` or `TLA2TOOLS_JAR`, as for `clew spec canon tlc`. Pictures need Graphviz `dot` on `PATH` (`scripts/install-graphviz.sh`); `.dot` output does not.

## The analysis

`analyze` reads the module's text. For each action reachable from `Next` it lists the variables its guards read, the variables it writes, and the variables it reads to compute what it writes. From that:

* **Depends on.** `order_status` depends on `payment_status` when an action that writes the order reads the payment. The *cone* of a variable is everything it depends on, directly or through other variables.
* **Independent parts.** Variables that no action couples, by a read or by writing both in one step. The model is the product of its parts, so each part can be read alone and the state counts multiply.
* **Candidates.** Each has an id, the variables it keeps, whether it is exact, and a sentence of why.

| Kind | Keeps | Exact |
|---|---|---|
| `component` | one independent part | yes |
| `cone` | a variable and everything it depends on | yes |
| `focus` | variables that depend on each other, without what they only read | no |
| `lifecycle` | one variable | usually no |

A view is *exact* when nothing it keeps waits on a hidden variable: cutting the hidden variables out of the model gives precisely the model's behaviour on the kept ones. A *lossy* view hides a guard, so some of its steps are possible rather than certain.

`--out deps.svg` draws the dependency map: one box per variable, grouped by independent part, with an arrow from `a` to `b` when an action that writes `b` reads `a`.

`--keep a,b` reports the same for any set you name: which actions stay, which vanish, and which read a hidden variable.

`--graph` adds what the reachable states say. It takes a TLC dump (`.dot`) or a module for TLC to dump:

* each candidate projected on the graph: how many states and steps it has, and what share of its steps are certain;
* each instance of a function-valued variable alone (`shipment_status[shipment1]`): the lifecycle of one object;
* for each pair of variables, the correlation over the reachable states (normalised mutual information: 0 independent, 1 one determines the other), the share of steps that change both, and value pairs that never occur together ("payment null with order approved").

The analysis recommends. Which view to build is the agent's judgement, and `propose` records it with a reason.

## The view

A view is a TLA+ module of its own. `draft` writes a starter: the model with the hidden variables cut out.

* An action that writes no kept variable is removed.
* A guard on a hidden variable is dropped, left as a comment (`\* hidden (payment_status): payment_status = "paid"`), and listed under `weakened`. The view then allows that step whenever the kept variables do: more than the model, never less.
* An effect that needs a hidden value cannot be cut. It is marked `TODO`, listed under `needsInput`, and the command exits 1.
* `Init` and `TypeOK` keep the conjuncts of the kept variables. A definition that reads a hidden variable is omitted and listed.

The draft is the agent's from then on, like the model `clew spec canon export` writes: rename, merge states, add a derived variable. `draft` never overwrites it without `--force`.

## The check

`check` writes `<View>Refines.tla`, which Clew owns:

```tla
EXTENDS Fulfil
View == INSTANCE FulfilOrder WITH order_status <- order_status
ImplementsView == View!Spec
Cover_ApproveOrder_s3 == Next /\ View!ApproveOrder_s3
```

and asks TLC for `PROPERTY ImplementsView` on the model's `Spec`. It holds when every behaviour of the model, with the hidden variables dropped, is a behaviour of the view. A violation prints the model steps that lead to a step the view forbids.

A view variable the model does not have needs `--map`: `--map 'phase <- IF order_status \in {"closed", "cancelled"} THEN "done" ELSE "open"'`, or `--map 'shipment <- shipment_status["shipment1"]'` for the lifecycle of one instance.

`--cover` runs the coverage config instead (`-coverage 1`) and reports the steps of the view the model never takes. The refinement says the view allows everything the model does; coverage says where it allows more.

**Implementing is transitive.** Check a large exact view against the full model once (minutes), then check small views `--against` that view (seconds). The result still holds for the full model.

## Pictures

`render` takes a TLC dump or a module, projects it onto `--keep` when given, and writes `.svg`, `.png`, or `.dot`:

* a solid arrow is a step every state behind its source can take;
* a dashed arrow is possible from some of them only: it waits on a hidden variable;
* a double border marks a state no step leaves;
* `--to variable=value` highlights a shortest path from the start to such a state.

The numbers come with it: states and steps of the view, how many of the full graph they stand for, and each possible step with how many source states allow it. A view over `--max-states` (150) is refused for a picture: keep fewer variables.

There are two ways to a picture, and they answer different questions. `render <View.tla>` draws a view the agent wrote and TLC checked; every arrow is solid, because the view is a model of its own. `render <graph.dot> --keep ...` computes a projection from a dump without writing a module; it is the quick look, and it shows which steps wait on hidden variables.

## The record

`propose`, `check --name`, and `finalize` keep `projections.json` beside the session's sentences: each projection's name, kept variables, the candidate it came from, the last check (result, files, and their hashes), and a history of who did what and why. `finalize` refuses a view with no passing check, and a view or model edited since the check. `finalize --drop` records that a projection was given up. `list` says of each stored check whether the view and the model are still the files TLC checked (`current`); that is worked out on every read and never stored. A milestone does not freeze the record: milestones version the spec only (D92).

## Decisions

These continue the numbering of [workflows.md](workflows.md) (D38 to D56). Each was open; the rationale and what would change it are recorded so none is silent.

**D57. The analysis reads the module's text with a light scanner, not a TLA+ parser.** It finds definitions by their `Name ==` line, splits bulleted `/\` and `\/` lists by the column of their bullets as TLA+ does, and sorts identifiers into unprimed, primed, and `UNCHANGED`. Rationale: it works on the agent's edited model, not only on what Clew compiled, and needs no Java. It can misread unusual layouts; it never decides correctness, because TLC checks every view. Revisit with SANY's XML exporter if agents write models the scanner misreads.

**D58. Dependencies are read per conjunct.** A variable depends on the guards of an action that writes it and on what its own new value reads, not on what another conjunct of the same action reads. Writing two variables in one step couples them (same part) without making either depend on the other. Rationale: per action, every co-written variable would land in every cone and no small exact view would exist.

**D59. Four kinds of candidates, and the agent decides.** Components and cones are exact by construction; focus and lifecycle views are the lossy ones people actually ask for. The analysis gives each a reason and, with `--graph`, a size and a certainty share, and stops there. Rationale: what is worth looking at depends on the question, which the analysis does not know.

**D60. Correlation is normalised mutual information over the reachable states, beside co-change over the steps and never-together value pairs.** Mutual information is divided by the smaller entropy, so it reads "how much of the less varied variable the other explains"; a variable that is nearly constant can score high on few states, which is why the value pairs are printed with it. The three answer different questions (do they go together, do they move together, what excludes what) and none is folded into one score.

**D61. Statistics need a state graph, and Clew does not dump a graph it cannot read.** A dump grows by about 2 KB per state. The static analysis runs on any model; the statistics run on a view small enough to dump (tens of thousands of states). The way in for a large model is its exact parts: draft the part, dump that.

**D62. A view is a module the agent writes; Clew writes only the check.** This is the person's suggestion. `View == INSTANCE <View> WITH ...` in a module that extends the model, and `View!Spec` as a TLC property. Rationale: the agent can do more than hide variables (rename, merge states, derive a phase), and TLC, not Clew, says whether the result is still true of the model.

**D63. The starter view weakens, never strengthens.** A hidden guard is dropped, not guessed, so the draft always passes the check when the cut is clean. An effect that reads a hidden value is left as a `TODO` rather than replaced with a nondeterministic choice, because Clew does not know the value's type. Dropped guards stay as comments so a reviewer sees what the view no longer says.

**D64. Coverage is opt-in.** `--cover` adds one `Next /\ View!Action` per step of the view, which costs TLC several times the plain check on a large model. Rationale: the refinement is the claim; coverage is evidence of tightness, and it is cheap where it matters, on small views checked against a mid-sized one.

**D65. Checks chain.** `--against` takes any module, so a view can be checked against a larger view. Clew does not track the chain; the record keeps which file each check ran against.

**D66. `--map` gives a view variable as an expression over the model.** It is the refinement mapping of TLA+, passed through to `WITH`. Without it, a view variable must have the model's name.

**D67. Clew reads TLC's own dump (`-dump dot,actionlabels`) and lays pictures out with Graphviz.** The proposal's figures were laid out by hand because no layout tool was wired in; the repository already installs Graphviz 16.1.0 for the chart diagrams, so the same `dot` draws these. Clew writes its own Graphviz text from the parsed graph rather than passing TLC's through, because TLC's node labels are whole states and its parallel edges are not merged.

**D68. A computed projection marks each edge certain or possible.** Certain means every full state behind the source takes the step. A step inside one view state (it changes hidden variables only) is not drawn. Rationale: it is the honest picture of a lossy view, and the share of certain edges is the number the analysis reports.

**D69. A function-valued variable can be read one instance at a time.** `l2_status[l21]` is a name `--keep` accepts for a dump, and the analysis scores each instance alone. Rationale: the lifecycle of one object is the state machine a person expects to see, and it is far smaller than the product over instances. As a checked view it is a `--map`.

**D70. Pictures are refused above 150 states by default.** A larger graph is unreadable as an image; `.dot` output is not limited. Revisit when the interactive view exists.

**D71. The record is its own file, `projections.json`, written without the session lock,** like `canon.json` and `workflows.json` (D36, D55), and no milestone reads it (D92). `check` reads the record again after TLC returns, so two long checks do not overwrite each other's result.

**D72. Finalizing needs a passing check of the files as they are now.** The record keeps a hash of the view and of the model at check time. A check after finalizing makes the projection a proposal again. Rationale: a final view that no longer matches its model is worse than none.

**D73. Projection commands take files, not a session, except the record.** `analyze`, `draft`, `check`, `dump`, and `render` work on any TLA+ module in a directory; only `propose`, `finalize`, `list`, and `check --name` need a session. Rationale: the model is a file the agent edits, as with `clew spec canon tlc`.

**D74. The TLC runner is shared with the canonical pipeline.** `TlcRequest` gained an optional dump path. The earlier rule that Clew runs TLC only when asked (D16) holds: every run here is a command the agent typed.

### Aligned with the revised workflows (D88 to D91)

Jeff asked for the projection work to follow the direction PR 76 and PR 77 took. These continue after D91 in [workflows.md](workflows.md).

**D92. Milestones do not freeze `projections.json`.** (Follows Jeff's D88. It used to be in `SNAPSHOT_FILES`.) A projection is a way of looking at a TLA+ model that was exported from whatever spec is current, like a workflow is a probe of it; neither is part of the spec's versions. The record keeps its own history (who proposed, checked, finalized, or dropped, and why), `spec diff` does not compare it, and the dependency-cruiser rule `spec-never-cites-projections` keeps the spec's grammar, gate, compiler, export, store, and versioning from reading any projection module. Rationale: a milestone versions and releases the spec, and a spec change should never wait on, or be undone with, a change to a view.

**D93. Nothing compiled from a projection is stored.** (Follows Jeff's D91.) The analysis, the candidates, the draft, the projected graph, and the explorer's payload are built in the domain from the model's text and TLC's dump on every run. The commands write only the files an agent asked for: the view module, the check module and its configs, a dump, a picture, a page. The record holds decisions and observations, not derived data: the name, the kept variables, the status, the history, and the last check.

**D94. The stored check is an observation tied to file hashes, and its freshness is computed on every read.** (Follows D90: a stored layer that is silently rebuilt is a cache, not a layer.) A TLC run takes minutes, so its result is kept with the hashes of the view and the model it was given. `list`, `propose`, and `finalize` report `current: false` when either file changed, and `finalize` refuses (D72); nothing re-runs TLC silently, and one `check` clears it. `current` is not written to `projections.json`. Revisit if agents want `finalize` to run the check itself.

**D95. The check module keeps extending the model.** The workflow monitor stopped extending the agent's model and dropped the `Get_` accessors so that the spec's output never changes for a workflow (D47). The projection check already had that property: `<View>Refines.tla` is a new Clew-owned file that extends the model and instances the view, the same shape as the canonical `<Name>Check` module, and neither the model nor the view gains a definition for it. So nothing changed here.
