# Blocks and kinds

Eight blocks for creating workflows + **kinds** that represent useful patterns

The source of truth is `KINDS` in `src/project/model.ts` and `KIND_TEACH` / `KNOBS_BY_TYPE` in `src/project/teach.ts`.

## Fields per block

The same for every kind of a block: a kind adds no field. A field's key in the file is its name in camelCase (`oncePer`, `stopCondition`).

| Block | Text fields | Chips |
| --- | --- | --- |
| agent | name · logic · prompt · output | model · effort |
| code | name · logic · output | |
| subworkflow | name · logic · prompt · output | |
| start | goal · args | |
| pipeline | name · logic · once per | |
| parallel | name · logic · once per | |
| loop | name · logic · stop condition | |
| branch | name · logic | |

- A block directly inside a branch is an arm and also has a condition, whatever its type.
- Everything but `name` and `logic` sits under `knobs`, with `isolation` and `agentType`: those two have no control, Claude sets them and the pane shows them read-only.

## Kinds

Prefill is written into the field when the block is added; a hint shows while the field is empty.

| Block | Kind | Means | Prefill | Hint |
| --- | --- | --- | --- | --- |
| **agent**: what is its job? | task | does one thing | | |
| | scout | lists the work for a later fan-out | output `{ items: [{ id, what }] }` · effort low | prompt: what to list |
| | check | an exact pass or fail: tests, typecheck, a rule | output `{ ok: boolean, failures: [] }` | prompt: what must hold |
| | verify | voters try to refute each result; a majority decides | logic `3 votes: each voter tries to refute the result; it is kept when a majority fail to refute it` · output `{ refuted: boolean, reason }` | prompt: what to try to refute |
| | judge | voters score the candidates; the best wins | logic `3 votes: each judge scores every candidate; the highest total wins` · output `{ scores: [{ candidate, score, why }] }` | prompt: the criteria to score on |
| | critic | says what is missing; gaps become more work | output `{ gaps: [{ what, how_to_fill }] }` | prompt: what complete means here |
| | merge | merges every result into one answer | | prompt: what to write from all the results · output: free text |
| | classify | labels its input for a branch to route on | output `{ label }` · effort low | prompt: the labels to choose from |
| **loop**: when does it stop? | custom | the stop condition in your own words | | stop condition: 3 rounds · the check passes · 2 dry rounds · budget < 50k |
| | count | a fixed number of rounds | `3 rounds` | |
| | pass | until the check at the end of a round passes | `the check passes, at most 3 rounds` · starts with an attempt and a check | |
| | dry | until rounds in a row find nothing new | `2 rounds in a row find nothing new` · starts with a finder and a dedup step | |
| | converged | until a round changes nothing | `the result is the same as last round, at most 5 rounds` | |
| | target | until enough has been collected | `10 items collected` | |
| | budget | while the turn's token budget lasts | `budget below 50k tokens` | |
| **parallel**: what differs between its arms? | arms | different jobs side by side | | once per: leave empty |
| | each | the same job once per item, waits for all | | once per: the items, e.g. changed files, ×4 dimensions |
| | sweep | the same search from different angles | `4 search angles: by container, by content, by entity, by time` | |
| | attempts | independent tries at one task | `×3 angles: MVP-first, risk-first, user-first` | |
| **branch**: how is its arm picked? | if-else | a condition on an earlier result | | condition: e.g. no findings; last arm empty for the else |
| | guard | one arm: run it or skip it | | condition: when it runs; otherwise nothing runs |
| | route | the arm whose label a classify chose | | condition: the label that picks this arm |

`pipeline`, `code`, `subworkflow` and `start` have no kinds. A `code` block's logic field hints at what it is for: dedup, filter, top-K, merge.

## Rules

- A pattern that spans several blocks (judge panel: attempts, judge, merge) is a template, not a kind.
- Changing a block's kind keeps every value that was typed; a value still as the old kind filled it in is replaced by the new kind's. An empty container gets the new kind's starter blocks.
- A loop of kind pass or dry is added with its starter blocks in one edit (one undo).
- No field is read for a count or a meaning: `once per`, a stop condition and the votes in a logic are words for Claude.
