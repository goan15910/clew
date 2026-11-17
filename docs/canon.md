# Canonical sentences to TLA+

`clew spec canon` is the prototype of the canonical pipeline: every spec sentence is held to one strict grammar, a sentence that does not fit is *dangling* and never reaches the model, and the sentences that fit compile straight to TLA+ actions that TLC can check. It runs beside the tagger and frames layers (`spec tag`, `spec frames`, `spec tla`), which are unchanged. Both read the same session and the same sentence history.

## Workflow

```bash
clew spec init order.md                                    # split the spec into sentences (unchanged)
clew spec canon lexicon --file lexicon.json --reason "..."   # actors, multi-word nouns/states/verbs
clew spec canon check                                      # gate every sentence; dangling ones get a draft
clew spec canon accept --id s9 --reason "..."              # take a draft (the sentence keeps its id and history)
clew spec sentences edit --id s4 --text "..." --reason "..." # or write the sentence yourself
clew spec canon merge --id s3 --id s4 --text "..." --reason "..."  # restate several sentences as one action block
clew spec canon export --dir tla --name Order              # OrderBlocks, Order (yours), OrderCheck, configs
clew spec canon tlc tla/OrderBlocks.tla --jar tla2tools.jar  # run TLC; the result maps back to sentences
clew spec canon tlc tla/OrderCheck.tla --jar tla2tools.jar   # your model refines the blocks
clew spec canon tlc tla/OrderCheck.tla --config tla/OrderCoverage.cfg --coverage --jar tla2tools.jar
```

`spec status` also lists the dangling sentences once the session has a canonical lexicon. A worked, synthetic example lives in `examples/canon/` (`order.md` and `lexicon.json`).

## The lexicon

```json
{ "actors": ["customer", "manager", "warehouse"], "terms": [], "states": [], "verbs": [], "instances": {}, "fixed": ["total"] }
```

* `actors` lists every actor. An actor is never an object.
* `terms`, `states`, and `verbs` list only the multi-word ones (`purchase order`, `On Hold`, `sign off`). A single word needs no entry: its place in the sentence says what it is.
* `instances` gives a noun a number of instances (1 to 8) in the exported module.
* `fixed` lists abstract conditions that keep the state they start with. See decision D19.

The lexicon is stored in the session (`canon.json`, beside `sentences.json`) with a history of who changed it and why.

## The grammar

| Form | Shape |
|---|---|
| block | `[When COND,] CLAUSE {and CLAUSE} [when COND] {, or CLAUSE {and CLAUSE} [when COND]}.` |
| clause | `[[The] ACTOR [can\|cannot]] VERB REF {SLOT} as STATE {SLOT}` |
| ref | `[the\|a] [QUALIFIER] [STATE] NOUN` |
| slot | `of [STATE] NOUN`; `with\|to [the same\|no] NOUN`; `for each [STATE] NOUN`; `for one NOUN`; `for the whole NOUN`; `on NOUN`; `after NOUN`; `from NOUN`; `via NOUN` |
| pred | `[each\|some\|one\|no] NOUN is [not] STATE {or STATE}` |
| cond | `PRED {and PRED} {or PRED {and PRED}}`, or `PRED and either PRED or PRED` |
| mark | `[The] NOUN starts as STATE.` and `[The] NOUN ends as STATE {or STATE}.` |
| invariant | `[The\|each\|no] NOUN is always [not] STATE {or STATE} [when COND].` and `... is never STATE ...` |

A block is one atomic TLA+ action per branch: one event, its clauses joined by `and`, the branch's condition as guards. A single sentence is a block with one branch. `can` is a permission and adds nothing; `cannot` is a refusal and stands alone, with no result.

The parser is Chevrotain (`src/adapters/canon/chevrotain-parser.ts`, the only file that imports it). The lexer is built per lexicon, so declared multi-word phrases are single tokens. A syntax error names the token found and what the grammar expected at that point.

## The gate

A sentence passes when it parses and breaks no rule above the grammar. Rule codes: `pronoun`, `again`, `qualifier`, `unknown-state`, `state-word`, `from-state`, `refusal`, `conflict`, `actor`, `extra-verb`, `retired-word`, `missing-result`, `mark-subject`. A state is *known* when some accepted sentence assigns it (`as STATE`) or a mark names it; the gate runs to a fixed point so order does not matter.

A dangling sentence gets a draft rewrite: the retired wording first (`if`/`once` → `when`, `must pack` → `packs`, `are` → `is`, `every` → `each`, ...), then token repairs, then the fixes the rules carry, for up to eight rounds. The draft says whether it `parses`, whether it guesses (`needsConfirm`), whether it holds a placeholder (`needsInput`), and which words it leaves out (`dropped`). `accept` refuses a draft that does not parse, and refuses one that drops words unless `--descriptive "<why they have no behaviour>"` is given.

## The model

* A noun some sentence moves gets a status variable over its states, plus `Null` (not created) unless a mark starts it.
* A noun no sentence changes and no mark starts is an *abstract condition*: the `Environment` action changes it, one step at a time, unless the lexicon fixes it. `on`/`after` events are free booleans set the same way.
* `with`/`to` slots are links: a variable from the object to the target's instances. `the same` and `no` compare links.
* A counted noun (`each`, `some`, `one`, `no`, or `for each`) has two instances; every other noun has one. The lexicon overrides that.
* A refusal compiles to an action property `[][Act => ~(guard)]_vars` over the actions with the same verb and object.
* `ends as` marks define `Done`. `NoStuck == (~ENABLED Actions) => Done` replaces TLC's deadlock check (`CHECK_DEADLOCK FALSE`), so a finished object is not a deadlock and a stuck one is.
* Each action is named after its sentence (`ReviewOrder_s3_2` is branch 2 of `s3`), so `spec canon tlc` maps a violation, each trace step, and each coverage line back to a sentence.

`export` writes `<Name>Blocks.tla/.cfg`, `<Name>Check.tla/.cfg`, and `<Name>Coverage.cfg`, all owned by Clew and rewritten every time, and `<Name>.tla`, the model, which starts as a copy of the blocks plus `Blocks == INSTANCE <Name>Blocks` and is yours: it is kept unless `--force`. The check module asserts `Blocks!Spec`, the blocks' invariants and refusals, and one `Cover_` per action.

Compiler findings: `abstract-condition`, `unscoped-condition`, `owner-unknown`, `scope-not-compiled`, `copy-source`, `same-on-single`, `refusal-unmatched`, `many-starts`, `final-has-exit`, `state-never-set`, `no-final-states`, `same-step-two-results`, `no-states`.

## Decisions

Each decision below was taken while building the prototype. The proposal or the person had left it open; the rationale and what would change it are recorded so none of them is silent.

**D1. Action blocks are adopted now, not trialled first.** The parser, the gate, and the compiler take blocks; a single sentence is a block with one branch. Rationale: the earlier trial showed the fusions the model needed (one step setting two objects) cannot be stated one sentence at a time, and a block costs nothing for a sentence that does not use it. Revisit if the trials show authors misuse `, or`.

**D2. `either` keeps its keyword.** `A and either B or C` is the only way to write a mixed condition without brackets, and the trial corpus used it. Without it, `A and B or C` would need a precedence rule people get wrong.

**D3. `, or` carries meaning: it separates the branches of a block.** A bare `or` joins predicates or states. The comma is the cheapest mark that keeps the two apart, and the draft rewrite adds or removes it.

**D4. NoStuck with `Done`, not TLC's deadlock check.** `Done` is built from the `ends as` marks; an object that was never created counts as done. With no `ends as` mark, `no-final-states` warns that dead ends are not checked.

**D5. A noun no sentence changes is an abstract condition the environment changes freely.** It is the weakest assumption that keeps every guard reachable. Consequence: an invariant over such a noun fails as soon as the environment flips it (see D19).

**D6. Instances: two for a counted noun, one otherwise, the lexicon overrides.** Two instances on every noun made the trial model explode (hundreds of thousands of states in seconds); counting is what needs two.

**D7. Scopes (`for each`, `for one`, `for the whole`) parse but do not compile yet.** They raise `scope-not-compiled` so nobody mistakes them for checked behaviour.

**D8. `from` and `via` are kept as notes on the action.** `from` is a copy source only (the person's decision); values are abstract, so there is nothing to copy. `from` also gives a `copy-source` info finding.

**D9. A condition on a noun with instances, with no qualifier, is resolved through a binding, a link, or ownership, in that order; otherwise it reads as `some`, with an `unscoped-condition` warning.**

**D10. Ownership falls back to a fixed map from object instances to owner instances when no link says which owner.** Flagged with `owner-unknown`.

**D11. A refusal is an action property over the actions with the same verb and object.** A refusal that matches no action is `refusal-unmatched` (info): it still documents intent, and holds trivially.

**D12. Marks and invariants are two new forms on top of the block grammar.** The proposal's sections 1 to 4 need an initial state, final states, and safety properties; spelling them as sentences keeps everything in the one gate.

**D13. Drafts come from grammar repair, not from the tagger.** Drafting from raw English with the tagger is deferred: repair of near-misses already covers the trial's dangling sentences, and a draft that guesses says so.

**D14. Section defaults from headings are deferred.** Headings stay provenance only.

**D15. The canonical pipeline runs beside the frames path, which stays intact.** Both read the same sentences, so a session can be compared on both until one is retired.

**D16. Clew runs TLC, opt-in.** This changes the earlier rule that Clew never runs TLC: the end-to-end trial needs raw spec to TLC result in one tool, with the result mapped back to sentences. Clew still does not ship TLC; the jar comes from `--jar` or `TLA2TOOLS_JAR`.

**D17. Accepting a draft edits the sentence in place.** It keeps the id and history, so the canonical sentence links to its original wording. Dropped words need `--descriptive` with a reason, because there is no "kept as detail" bucket.

**D18. A `with`/`to` link target always gets an instance set**, even when nothing counts it, so a link can point at "no instance yet" (`Null`).

**D19. The lexicon can fix an abstract condition (`fixed`).** Found on the order example: "the order is never shipped when the total is large" failed because the environment changed the total after shipping. An order's total is an attribute, picked once. `fixed` makes it keep its initial state; the `abstract-condition` finding says how to use it.

**D20. `spec status` lists dangling sentences but keeps its exit code.** Status reports the frames layers; the canonical gate's exit code is `spec canon check`'s.
