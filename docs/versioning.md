# Spec versioning: milestones over the history

The session history already records every write with its reason: `history.jsonl` holds one line per command, every sentence keeps all its revisions, and the canonical pipeline keeps its own entries (lexicon, accept, merge) in `canon.json`. What was missing is the unit a person reviews. A *milestone* is that unit. It is written when a batch of work is closed, and it sits on top of the history, which stays as it is.

This is section 5 of the PoC proposal. It stacks on the canonical pipeline ([canon.md](canon.md)).

## Workflow

```bash
clew spec milestone list                                   # what is closed, and what is not in a milestone yet
clew spec diff                                             # the work since the last milestone, with the reasons
clew spec milestone close --title "Gate pass" \
  --goal "every sentence passes the canonical gate" \
  --decision "accept both drafts: they keep the meaning"   # one --decision per decision, rationale included
clew spec milestone show m1                                # the digest of one milestone
clew spec milestone show m1 --changes                      # every log entry under it
clew spec diff m1 m2                                       # sentences, lexicon, gate counts, and actions between two versions
clew spec export --at m1 --out spec-m1.md                  # the spec as it was at m1
clew spec canon export --at m1 --dir tla-m1 --name Order   # the TLA+ as it was at m1
```

## Three levels

A person reads the work at three levels:

1. **The milestone list** (`spec milestone list`). One line per milestone: id, time, title, live sentences, and what changed. It ends with the changes not yet in a milestone.
2. **The digest of one milestone** (`spec milestone show <id>`). The goal, the decisions, and the counts against the milestone before it:

   ```text
   m1 "Gate pass" by agent, 2026-11-17T17:06:59Z (history lines 1-3, 3 canonical changes, since original)
     goal: every sentence passes the canonical gate
     decision: accept both drafts: they keep the meaning
     sentences  9 -> 9 live (0 added, 0 deleted, 2 edited)
     gate       7 -> 9 pass, 2 -> 0 dangling
     actions    5 -> 6 (1 new, 0 removed, 0 changed)
     lexicon    actors +customer +manager +warehouse; fixed +total
     commands   init 1, sentences.edit 2, canon.lexicon 1, canon.accept 2
   ```

3. **The single changes.** `spec milestone show <id> --changes` lists each history line and canonical change the milestone covers, in the order they were written, with its reason. `spec diff <a> <b>` prints each added, deleted, or edited sentence with its text before and after and the reasons recorded on it in between.

## Versions

A version is named `original`, `latest`, or a milestone id (`m1`, `m2`, ...).

* `original` is the spec as `spec init` read it. It has no canonical lexicon and no derived layers.
* `mN` is the session as it was when milestone N was closed: a frozen copy of its data files.
* `latest` is the session now.

`spec export --at`, `spec diff`, `spec canon check --at`, and `spec canon export --at` take any of them. `spec export --version original|latest` still works.

## What a milestone stores

`milestones.json` beside the session's other files lists the records:

```json
{
  "id": "m1",
  "title": "Gate pass",
  "goal": "every sentence passes the canonical gate",
  "decisions": ["accept both drafts: they keep the meaning"],
  "who": "agent",
  "at": "2026-11-17T17:06:59.123Z",
  "previous": "original",
  "history": { "from": 0, "to": 3 },
  "canon": { "from": 0, "to": 3 },
  "digest": {
    "before": { "live": 9, "accepted": 7, "dangling": 2, "actions": 5 },
    "after": { "live": 9, "accepted": 9, "dangling": 0, "actions": 6 },
    "added": [], "deleted": [], "edited": ["s7", "s9"],
    "lexicon": { "actors": { "added": ["customer", "manager", "warehouse"], "removed": [] }, "fixed": { "added": ["total"], "removed": [] } },
    "actions": { "added": ["PackOrder_s9"], "removed": [], "changed": [] },
    "commands": { "spec.init": 1, "spec.sentences.edit": 2, "spec.canon.lexicon": 1, "spec.canon.accept": 2 }
  }
}
```

`history` and `canon` are ranges (from inclusive, to exclusive, counted from 0) over `history.jsonl` and over the `history` list in `canon.json`. Both logs are append-only, so a range never moves. `milestones/<id>/` holds the frozen copy: `session.json`, `sentences.json`, `tokens.json`, `spans.json`, `concepts.json`, `frames.json`, `flows.json`, and `canon.json`, whichever exist.

## Decisions

These decisions were taken while building versioning. The proposal or the person had left them open. Each one is recorded with its rationale so that none is silent. The numbers continue from [canon.md](canon.md).

**D21. A milestone is an overlay on the history. The log is not changed.** `history.jsonl`, the sentence revisions, and `canon.json` keep their shape. A milestone records ranges into them. This is what the proposal asks. It also means sessions written before this change need no migration: their first milestone covers everything since `spec init`.

**D22. A milestone is written only when the work is closed.** There is no `open` command, and no plan or goal is stored ahead of the work. `close` refuses when nothing was written since the last milestone. This follows the proposal's assumption on the open question "when a milestone is written". The alternative, opening a milestone with a goal first, can be added later without changing the record.

**D23. A milestone covers two ranges, one in `history.jsonl` and one in `canon.json`.** PR 75 writes `lexicon`, `accept`, and `merge` to `canon.json`, not to `history.jsonl`. Accept and merge also write the sentence edits to `history.jsonl`, but a lexicon change appears only in `canon.json`. Logging canonical commands into `history.jsonl` as well was rejected: it changes PR 75's store, and it would log every accept twice. `show --changes` merges the two logs by time.

**D24. The snapshot is a frozen copy of the session's data files, not a replay of the revisions.** The sentence revisions could rebuild the sentences at any point in time, but nothing could rebuild the lexicon: `canon.json` records that the lexicon changed and why, not what it was. The frames-path layers would also need a replay. A copy is exact and cheap: about 240 KB per milestone on the 11-17 trial session, which has 264 history lines. `history.jsonl` is not copied, because the ranges point into it. The viewer and earlier milestones are not copied either. The copied files are one list, `SNAPSHOT_FILES` in `src/adapters/spec-store/milestone-store.ts`. A new session file, such as a workflows file, joins it there.

**D25. Versions are `original`, `latest`, and `mN`.** Milestone ids are sequential and never reused, like sentence ids. Versions are ordered by number, not by time, so two milestones closed in the same millisecond still have an order.

**D26. `original` is the spec as `spec init` read it, with no lexicon and no derived layers.** Added sentences are absent from it. Its derived layers were never built for that text, so none are kept.

**D27. Each side of a diff is gated with its own lexicon. A side with no lexicon is gated with the other side's.** The number that shows the rewrite pass is "207 dangling, then 0". That number needs the original gated, and the original has no lexicon. Gating it with the later lexicon measures the rewrite rather than the lexicon. The document's `gatedWith` field and the text output say when this happened. A version with no lexicon on either side has no gate counts.

**D28. The digest is computed when the milestone is closed and stored with it.** The list stays cheap, and the record keeps what the author saw when they closed it, even if the gate changes in a later Clew. `spec diff` recomputes from the frozen copies with the current gate.

**D29. The digest holds what the canonical pipeline can measure.** It holds live sentences; sentences added, deleted, and edited; gate pass and dangling counts; compiled actions, with an action diff; the frames count when the frames layer exists; the lexicon diff; and a count per command. The proposal's example digest also shows incomplete frames and frames-path actions. Those are left out: they need the frames kernel, and the canonical pipeline is the path the PoC now uses. Adding them later only adds digest fields.

**D30. Decisions are free text, one `--decision` per decision, with the rationale written inside it.** None is required: a mechanical batch may have no decisions. Typed evidence and the assumption register (proposal section 8) are separate work. When they land, a decision can cite them.

**D31. The reasons shown in a diff are the sentence revisions recorded between the two versions.** They are counted by revision index, not by time. A sentence that was edited and then reverted shows no change. A diff run backwards (`spec diff m2 m1`) still lists the reasons, taken from the later version.

**D32. Actions are matched by name.** The name carries the sentence id and branch (`ShipOrder_s4`). An action matched by name has changed when its guards or effects have. A sentence whose verb changes shows its action as removed and added.

**D33. `--at` replaces the original-or-latest choice, and `--version` stays.** `spec export --at` takes any version. `--version original|latest` still works as the older spelling, so existing scripts do not break. `--at` is also on `spec canon check` and `spec canon export`. The proposal did not ask for this, but it lets a TLC result be reproduced as of a milestone. The frames-path `spec tla export` does not take `--at`.

**D34. `spec diff` with no versions named shows the work not yet in a milestone.** It compares the last milestone (or `original`) with `latest`. It is the review to read before closing the next milestone.

**D35. The three reading levels are CLI commands. The viewer has no milestone tab yet.** The viewer serves GET only and is built around frames. A milestone tab belongs with the review surface of proposal section 8, where a reviewer can also act on what they read.

**D36. `close` holds the session lock while it reads and copies.** A sentence write cannot interleave. `canon.json` writes do not take the lock (PR 75), so a canonical write running at the same moment could land on either side of the milestone. This is not fixed here.

**D37. The author defaults to `agent`, as for every other write.** `--by` names someone else.

## Not covered

* Merged blocks are still logged as one add and several deletes (trial gap B7). The digest counts them that way. `show --changes` shows the `canon.merge` entry beside those lines, so the grouping is visible.
* A milestone cannot be edited or deleted. Close a new one instead.
* `spec status` does not show pending changes. `spec milestone list` does.
