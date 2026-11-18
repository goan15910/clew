# Workflows in English

The blocks module and the agent's model come from the same sentences, so a misread sentence passes every check the canonical pipeline has. A *workflow* is a second, independent statement of intent: a short story in the same canonical grammar, marked as *must be possible* or *must be refused*, and checked against the model by TLC.

This is section 7 of the PoC proposal, option C. It stacks on the canonical pipeline ([canon.md](canon.md)) and on spec versioning ([versioning.md](versioning.md)).

## Workflow

```bash
clew spec workflow add --file workflows.md --reason "intent from the brief"   # one workflow per heading
clew spec workflow check                       # gate, concepts, and the spec actions each step cites
clew spec workflow edit --id w1.s2 --text "..." --reason "..."   # or: step, delete, accept, set
clew spec workflow parse                       # after the lexicon's actors, terms, states, or verbs change
clew spec canon export --dir tla --name Order  # the blocks module and your model, as before
clew spec workflow export --dir tla --name Order                 # compiles now; writes OrderWorkflows.tla and one config per workflow
clew spec workflow verify --dir tla --name Order --jar tla2tools.jar   # TLC, read against what each workflow expects
```

A worked, synthetic example is `examples/canon/workflows.md`, against `examples/canon/order.md`.

## The file

```markdown
## Happy path (possible)

1. The customer submits the order as submitted.
2. The manager reviews the order as approved when the total is small.
3. The warehouse ships the order as shipped.
4. The order ends as shipped.

## Approve before submit (refused, exact)

1. The manager reviews the order as approved.
```

* A heading that ends in `(possible)` or `(refused)` opens a workflow. Its sentences, in order, are its steps.
* `(possible)`: TLC must find a behaviour that takes the steps in order (a witness). `(refused)`: no behaviour may.
* `, exact` (`(refused, exact)`): no spec action happens but the steps, in this order. Without it (`loose`, the default), other spec actions may happen before, between, and after the steps.
* `The NOUN starts as STATE.` pins the first state of this workflow. `The NOUN ends as STATE.` is checked after the last step.
* Prose under any other heading is listed as `skipped` and is never a step.

## What a workflow shares, and what it owns

|  | Spec | Workflows |
|---|---|---|
| Concepts (lexicon, nouns, states, actors, events) | Shared | Shared |
| Sentences | `s1`, `s2`, ... in `sentences.json` | `w1.s1`, `w1.s2`, ... in `workflows.json` |
| Clauses | of a spec sentence | of a workflow sentence |
| Frames | the compiled actions, `ReviewOrder_s3_1` | the step frames, `W1_Step2_ReviewOrder_s3_1` |
| May cite | its own | its own, and the spec's |
| Stored | `sentences.json`, `canon.json`, `history.jsonl` | `workflows.json`: each sentence's text, history, and parse |
| Versioned | milestones, `spec diff`, `--at` | no: workflows are data the spec is checked against, like fixtures |

References go one way. A step cites the spec actions it matches, the spec sentences behind them, and the shared concepts it names (`actor:manager`, `noun:order`, `state:order/approved`, `event:REVIEW/order`). The spec's gate, compiler, TLA+ export, use cases, and versioning (milestones and `spec diff`) never read a workflow: the dependency-cruiser rule `spec-never-cites-workflows` fails the build if one of them imports the workflow modules, and no workflow command writes `sentences.json` or `canon.json`.

## What is stored, and what is compiled

A workflow sentence is stored as its text, its history, and its parse: the tree the canonical parser builds, with the words and spans it came from (`parsed` in `workflows.json`). The parse is the deepest layer that names nothing of the spec, so it stays true while the spec changes from version to version. Everything below it (the gate's rules, the concepts, the citations of spec actions, the monitor) is compiled from the stored parse and the spec as it is now, every time `check`, `export`, or `verify` runs, and is never saved. `export` writes only the TLA+ module and its configs.

The parser reads four lists of the lexicon: actors, multi-word terms, multi-word states, and verbs. Each parse records a key of those words (`grammar`). When they change, a stored parse may no longer be what the parser says, so `check` reports `parse-stale` and does not read it; `clew spec workflow parse` parses the stale sentences again. A change to `instances` or `fixed`, or to any spec sentence, does not make a parse stale.

## The gate and the checks

A workflow sentence goes through the spec's parser when it is written, and its stored parse goes through the spec's gate rules on every check, with the spec's lexicon and the spec's known states. It gets the same draft rewrites (`clew spec workflow accept`). Three rules sit on top:

| Code | Rejects |
|---|---|
| `workflow-refusal` | `cannot` in a step. Mark the whole workflow `(refused)` instead. |
| `workflow-branches` | `, or` in a step. A choice is two workflows. |
| `workflow-invariant` | An invariant. It holds on every path, so it belongs in the spec. |

Then each workflow is checked against the spec's compiled model:

| Finding | Severity | Meaning |
|---|---|---|
| `step-dangling` | blocking | A sentence does not pass the gate. |
| `parse-stale` | blocking | The sentence was parsed with other grammar words than the lexicon has now: run `clew spec workflow parse`. |
| `no-steps` | blocking | The workflow names nothing that happens. |
| `unknown-concept` | blocking | A noun, actor, or event the spec does not have. A workflow cannot add one. |
| `step-unmatched` | blocking | No spec action has this event, object, actor, and result. The message names the spec actions with the same event. |
| `needs-instances` | blocking | The step needs several instances of a noun the spec models as one status variable (below). |
| `state-not-of-noun` | warning | A state the spec knows, but never gives this noun. |
| `step-ambiguous` | info | Several spec actions match; the monitor takes any of them. |
| `unscoped-condition` | warning | As in the spec: a condition on a noun with instances that names none of them. |

### needs-instances

"The customer closes the order as closed when some shipment is delivered and some shipment is in transit" needs two shipments in different states. If the spec gives the shipment one status variable, the scenario cannot even be stated, and TLC would only report it unreachable. The check runs on the parsed step, before any model checking: a quantifier (`each`, `some`, `one`, `no`) over such a noun, or two conditions joined by `and` that put it in disjoint states, raise `needs-instances`. The fix is in the spec: give the noun instances in the lexicon (`"instances": { "shipment": 2 }`). With that, TLC finds the 6-step witness of experiment E13.

## The scenario monitor

`clew spec workflow export` compiles the workflows and writes `<Name>Workflows.tla`. The module declares the blocks module's variables itself, by the same names, and instances the blocks module with each one mapped to itself, so a step's conditions read the variables directly. The blocks module is not changed for it. For each ready workflow `wN`:

```tla
EXTENDS Naturals, FiniteSets
VARIABLES order_status, total_status                  \* the variables of OrderBlocks
vars == <<order_status, total_status>>
Blocks == INSTANCE OrderBlocks WITH order_status <- order_status, total_status <- total_status
VARIABLES wf_pc

W1_Init == Blocks!Init /\ wf_pc = 0
W1_Step2_ReviewOrder_s3_1 ==            \* one definition per step and spec action it cites
  /\ wf_pc = 1
  /\ total_status = "small"             \* the step's own condition
  /\ Blocks!Next
  /\ Blocks!ReviewOrder_s3_1
  /\ wf_pc' = 2
W1_Other_PackOrder_s9 == Blocks!Next /\ Blocks!PackOrder_s9 /\ UNCHANGED wf_vars   \* loose only
W1_Env == Blocks!Next /\ ~Blocks!Actions /\ UNCHANGED wf_vars                       \* the environment
W1_Spec == W1_Init /\ [][W1_Next]_<<vars, wf_vars>>
W1_NotDone == ~W1_Done
```

`wf_pc` counts the steps taken. A noun the workflow names without a quantifier is one instance throughout, held in `wf_<noun>`. The monitor runs on the spec's blocks module, not on the agent's model `<Name>.tla` (D47). The export refuses a blocks module that is missing or stale: run `clew spec canon export` first.

## Reading TLC back

`clew spec workflow verify` exports, then runs TLC once per ready workflow with `INVARIANT W<n>_NotDone`:

| Expect | TLC | Outcome |
|---|---|---|
| possible | `W<n>_NotDone` violated | **holds**: the trace is the witness |
| possible | no error | **fails**: Clew probes `W<n>_Before<k>` from the last step down and names the first step the model never takes, with the guards of the spec actions it cites |
| refused | no error | **holds** |
| refused | `W<n>_NotDone` violated | **fails**: the trace is the path that should not exist |

Each path step names the workflow step (or `other` / `environment`), the spec action, and the spec sentence. On the README order example, `Reject a draft (refused)` fails: branch 2 of s3 ("or reviews the order as rejected when the total is large") has no "submitted" guard, so a draft order can be rejected. That is the kind of weak guard the frames and the agent's model cannot catch on their own.

## Versioning

Milestones and `spec diff` version the spec only. A milestone does not freeze `workflows.json`, and `spec diff` does not compare workflows: workflows are data the spec is checked against, like test fixtures, and they are checked against whatever version of the spec is current. Workflow writes keep their own history in `workflows.json` (each sentence's revisions, and each workflow's title, expectation, mode, and deletion, with who and why).

## Decisions

These continue the numbering of [canon.md](canon.md) (D1 to D20) and [versioning.md](versioning.md) (D21 to D37). Each was open; the rationale and what would change it are recorded so none is silent.

**D38. Workflows run on the canonical pipeline only.** In that pipeline the frame of a clause is the action it compiles to, so a step frame cites spec actions. The tagger and frames path (D15) stays as it is and has no English workflows. Rationale: the canonical pipeline is where the PoC is heading, and one grammar is the point of option C.

**D39. A step uses the spec's grammar unchanged, so it needs a result (`as STATE`) like any spec sentence.** Rationale: one gate, one grammar, and the result pins the spec action exactly (`reviews ... as approved` is branch 1 of s3, not branch 2). The gate's draft adds a guessed result for confirmation. Revisit if authors find it heavy for long workflows.

**D40. Three workflow rules sit on top of the gate: no `cannot`, no `, or`, no invariant.** Possible or refused belongs to the whole workflow; a choice is two workflows; an invariant is a property of every path and belongs in the spec.

**D41. Marks mean something in a workflow.** `starts as` pins this workflow's first state (for example "The total starts as large."), and `ends as` is checked after the last step. Both read through the same condition compiler as a spec condition.

**D42. A workflow uses only concepts the spec already has.** This confirms the proposal's assumption for open question 5. There is no workflow lexicon. An unknown noun, actor, or event is `unknown-concept`, and a step that no spec action states is `step-unmatched`, both blocking: a workflow never adds a second concept or a step for the same thing. A state the spec never gives that noun is a warning, because TLC will show its effect.

**D43. Namespaces: `w1` for a workflow, `w1.s2` for its sentences, `W1_Step2_<spec action>` for its step frames.** Ids are never reused; a deleted sentence or workflow stays as a tombstone with its history, as spec sentences do.

**D44. The one-way rule is enforced, not only documented.** A dependency-cruiser rule forbids the spec's grammar, gate, compiler, TLA+ export, canonical use cases, versioning (milestones and diff), and their adapters from importing the workflow modules, and workflows live in their own file. A test checks that the blocks module is the same with and without workflows.

**D45. A step matches the spec actions with its first clause's event and object, its actor when both name one, and every result it states.** Several matches are all cited and the monitor takes any of them (`step-ambiguous`, info), because naming the branch is the author's choice, not an error.

**D46. One meaning for conditions.** The condition compiler was moved out of `compileCanon` into `conditionExpressions`, which both the blocks compiler and the workflow monitor call. The blocks module is otherwise unchanged; the README order example exports byte-for-byte the same actions.

**D47. The monitor runs on the blocks module, and owns its mapping.** (Revised by Jeff. It used to extend the agent's model `<Name>.tla` and read the blocks variables through `Get_<variable>` accessors added to the blocks module.) The monitor declares the blocks module's variables itself and writes `Blocks == INSTANCE <Name>Blocks WITH v <- v, ...`, so a step's conditions read the variables directly and spec actions are `Blocks!<action>`, `Blocks!Init`, and `Blocks!Next`. The blocks module has no accessor, and `clew spec canon export` writes the same files as before workflows existed. Rationale: the workflow side owns all of the coupling, so the spec's output never changes for a workflow. Consequence: a workflow is checked against the spec as compiled, not against the agent's model. A refused workflow that holds on the blocks module holds, as seen through the mapping, on any model that passes `<Name>Check`, because that check is a refinement; a witness on the blocks module is not a witness on the model. Revisit if a workflow must be checked on the model too: the monitor would then take the model's mapping, which is the agent's text, not Clew's.

**D48. Steps are loose by default; `exact` is per workflow.** Loose lets other spec actions happen before, between, and after the steps; exact allows none. Environment steps always may. Rationale: an author names the steps that matter (E13's step needs shipments packed, shipped, and delivered first), and "approve as the very first step" (E7) is the exact case. In a loose trace, each other step still names its spec action.

**D49. A noun named without a quantifier is one instance for the whole workflow** (`wf_<noun>`, chosen at the start). There is no way yet to name a second one ("another shipment"); quantifiers cover counting. Revisit with scopes (D7).

**D50. `needs-instances` is blocking and is raised before any model checking.** It fires on a quantifier over a noun the spec models as one status variable, and on two conditions joined by `and` that put that noun in disjoint states. The fix is in the spec (lexicon `instances`), never in the workflow.

**D51. A possible workflow with no witness is probed to name the step that cannot happen.** Clew runs TLC again with `W<n>_Before<k>` from the last step down, at most one run per step, and stops at the first that is violated. The probe configs are written beside the module. Rationale: "not possible" alone does not tell a person which sentence to look at.

**D52. Prose under a heading that opens no workflow is listed as `skipped`.** It is never a step and never dropped without a word. A file with no workflow heading at all is refused.

**D53. Milestones do not freeze `workflows.json`.** (Revised by Jeff, see D88. It used to be in `SNAPSHOT_FILES`.) Milestones, `spec diff`, and `--at` version and release the spec only. Workflow writes keep their history in `workflows.json`, not in `history.jsonl`, so a workflow change never counts toward a milestone.

**D54. Workflows are checked against the spec's accepted sentences only.** A dangling spec sentence is not in the model, so every workflow document lists the spec's dangling sentences (`specDangling`); a failing workflow is not mistaken for a spec that says otherwise.

**D55. Workflow writes do not take the session lock,** like `canon.json` writes (D36): they touch only `workflows.json`, and no milestone reads it.

**D56. Adding workflows needs the spec's canonical lexicon.** Without it there are no shared concepts to check against, so `workflow add` refuses before it writes anything.

These continue after D87, the last number taken in the stack above this one ([projection.md](projection.md) and the actor-guard work).

**D88. Workflows are data the spec is checked against, like test fixtures, not part of the spec's versions.** (Jeff's decision.) They stay in the session store, in `workflows.json`, with their own history. A milestone does not freeze them, `spec diff` does not compare them, and the dependency-cruiser rule keeps the versioning modules from reading them. Rationale: a milestone versions and releases the spec; a workflow probes whatever spec is current, and a spec change should never wait on, or be undone with, a workflow change.

**D89. The deepest layer stored for a workflow sentence is its parse.** (Jeff's decision.) `workflows.json` keeps the parser's tree (`statement`, or null) and its syntax diagnostics, beside the text. Rationale: the parse names only words and spans, never a spec sentence, action, or state the spec knows, so it stays valid across spec versions. The gate's rules are not stored, because they read the spec's known states, which change with the spec.

**D90. A parse is current while the parser's lexicon words are the same, and a stale one blocks until `workflow parse`.** Each parse records a key of the lexicon's actors, terms, states, and verbs (FNV-1a over the sorted lists: a fingerprint, not a security hash). When it differs, `check` raises `parse-stale` (blocking) and does not read that parse, and `clew spec workflow parse` parses only the stale sentences again, with no history entry because the text did not change. Other writes never re-parse a sentence whose text they did not change. Rationale: a stored layer that is silently rebuilt is a cache, not a layer; a lexicon change to the grammar words is rare and one command clears it. Revisit if lexicon edits become frequent: `check` could then parse stale sentences in memory and only warn.

**D91. Compiled workflows live only in the domain.** (Jeff's decision.) `check`, `export`, and `verify` compile from the stored parses and the spec as it is now, on every run. `export` writes the TLA+ module and its configs, and `verify` its probe configs, and nothing else; there is no compiled-workflow file to go stale. The blocks module on disk must still be current (D47), because the monitor instances it.
