# Conductor

Conductor is a Claude Code mod (a plugin with a hooks module) for workflows.
You lay a workflow out as a tree of blocks in a pane, hand the design to Claude to
implement and run, and watch the run's progress on the same design.

## Requirements

- Claude Code 2.1.296 or later (the version this was built and tested on), with the Workflow tool.
- A fullscreen terminal session for the mouse; the keyboard toolbar works without it.
- The pane asks the dock for a width that leaves the transcript about half the terminal. A dock width you dragged (Claude Code keeps it) wins over that.
- For development: `bun` (the gate runs `bunx tsc`).

## Before you start

- **Use a wide terminal and the docked pane.** About 160×40 or more: the pane then docks beside the transcript with the whole inspector and two key rows. Above the prompt (inline, under 110 columns) is a reduced view: a compact board of a few rows, one line for the selected block, the fields only while you edit. In a terminal as short as 30 rows the board shrinks to the selected card, and to nothing while the fields, the add list or a help page are open; the header row always stays.
- **A dock width you once dragged is remembered by Claude Code** and wins over the width Conductor asks for. Drag the dock's border to change it.
- **Escape always hands the keyboard back to the prompt.** No mod can keep it. Text you typed into a field is not lost: it is saved as an edit (the pane says `n3 changed: notes`, and `u` undoes it) on Escape and on every other way out of a field: Tab, Enter, a click on the board or on a key, a picker's choice, a `/conductor` command, a prompt you send, an edit from chat, a resize, closing the pane. Press `u` afterwards if you did not mean it.
- **Move with `h` `j` `k` `l`.** The arrow keys, Tab and Enter belong to Claude Code's focus ring, not to the board. On the key rows the ring stays on `c: help`, so Up, Down or Tab there do nothing and Enter opens a help page: no arrow-then-Enter can run or delete. Inside the fields (after `e`, `d` or a click on one) Tab and the arrows walk the fields and pickers as usual. The Left arrow opens Claude Code's own agents list; Conductor cannot change that, and on coming back from it the pane was seen to start afresh (saved designs are on disk; the selection and undo history were gone).
- **If letters appear in the prompt, the pane has lost the keyboard** (it says `keys are in the prompt · click the board or /conductor`). Clear the box, then click the board or type `/conductor`. A letter or digit that is no key in the pane is swallowed and the pane keeps the keyboard (`b is not a key here`); other characters go to the prompt.
- **The design is a spec.** Claude writes the workflow script from it; the structure follows the design, details vary between runs.
- **A run counts as ended after 8 quiet seconds** (no agent running, no new one started). Its results stay on the board until the first edit or `q`.
- **Undo is per design, fifty steps, for the session.** It is not saved with the design. It survives `/reload-plugins`; it is lost when the session ends, when the mod's code is reloaded after a change, and after a visit to the agents list.
- **No scroll wheel on the board.** Drag the background, or move the selection.
- **Names.** `/conductor design <name>` names a design before you start it; a design started without a name is `untitled`, and `/conductor rename <old> <new>` renames any saved design. Names starting with `replay-` are kept for replays.

## Install for development

Terminal:

```
claude --plugin-dir /path/to/conductor
```

Desktop app (no flag can be given): name the folder in the `env` block of `~/.claude/settings.json`.

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/conductor" } }
```

The repository is also a marketplace (`.claude-plugin/marketplace.json`), so from a
terminal session it installs with `/plugin install conductor --marketplace <owner>/<repo>`.

## Commands

| Command | What it does |
| --- | --- |
| `/conductor` | With a run in progress: that run, on its design when it came from one. Otherwise the design last opened in this session, with the keyboard, or the template picker when there is none. |
| `/conductor design [name]` | Opens the designer on a saved design, or offers templates for a new one. With no name: the saved designs to open (each with its block count and what it is for), above the templates for a new one. |
| `/conductor draft <name> <description…>` | Claude drafts a design for the description, saves it under that name and shows it on the board. Refused when a design of that name already holds blocks. |
| `/conductor run <name> [fill]` | Hands the saved design to Claude and submits the prompt; the pane switches to that design. With `fill`, the request is left in the box, ending `on: `, for you to say what to run it on and send. The answer says what the design implies: `at least 18 agents · 2 lints (n3, n5)`. |
| `/conductor list` | The saved designs, each with its block count and description. |
| `/conductor rename <old> <new>` | Renames a saved design (the file, and this session's undo history of it). Refused when `<new>` exists or starts with `replay-`. |
| `/conductor delete <name>` | Deletes a saved design. Asks once more: it answers with what would go, and `/conductor delete <name> confirm` does it. |
| `/conductor replay <review-41\|partial-29\|clear> [fast\|slow]` | Dev: replays a recorded run in the run view, or clears it. |
| `/conductor replay design <template> [fast\|slow]` | Dev: replays a made-up run over a template's design (`review`, `research`, `migrate`, `judge-panel`). The design is named `replay-<template>`, lives in the session only, and is never saved or listed (the `replay-` prefix is kept for this). |

## Designing by talking

You do not have to assemble blocks by hand. `/conductor draft review-pr review this PR thoroughly`
has Claude draft the design; with a design open, plain messages change it:
"add a verify with 3 votes after n3", "set this block to low effort"
("this block" is the one selected on the board). The board follows at once and the
touched blocks light up for a moment. Claude edits through the `mcp__conductor__design`
tool, which checks every edit against the design model, keeps block ids stable and
answers with the lints; a refused edit changes nothing. While a run of the design is
live, edits from chat are refused, as edits on the board are. A design file changed
with Claude's Write or Edit tools is reloaded into the open board too.

## The designer: a flow board

The design is drawn as a board of cards, in the order the workflow runs. Docked beside
the transcript it flows top to bottom and every card is as wide as the pane:

```
╭── n1 agent ────────────────────────────────╮
│ scout diff                                 │
│ effort: low · out: { dimensions: [{ name…  │
╰────────────────────────────────────────────╯
  │  +
╭─▼ n2 pipeline ×4 · review · each: dimensi… ╮
│ ┏━━ n3 agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ review                                 ┃ │
│ ┃ One reviewer per dimension.            ┃ │
│ ┃ out: { findings: [{ file, line, sever… ┃ │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━ edit ━ del ━┛ │
│   │  +                                     │
│ ╭─▼ n4 verify ×3 ────────────────────────╮ │
│ │ verify findings                        │ │
│ │ 3 votes · out: { refuted: boolean, re… │ │
│ ╘════════════════════════════════════════╛ │
╘═ + ════════════════════════════════════════╛
  ║
╭─▼ n5 agent ────────────────────────────────╮
```

Above the prompt (inline) it flows left to right. It starts compact there (one row a card, the selected one whole); `z` shows it whole, as here:

```
╭ n1 agent ──────────────────╮    ╭ n2 pipeline ×4 · review · each: dimensions ──────────────────────╮    ╭ n5 agent ────╮
│ scout diff                 │ ─▶ │ ╭ n3 agent ──────────────────╮    ╭ n4 verify ×3 ──────────────╮ │ ═▶ │ synthesize   │ +
│ effort: low · out: { dime… │    │ │ review                     │ ─▶ │ verify findings            │ │    │              │
╰────────────────────────────╯    │ │ out: { findings: [{ file,… │    │ 3 votes · out: { refuted:… │ │    ╰──────────────╯
                                  │ ╰────────────────────────────╯    ╘════════════════════════════╛ │
                                  ╘══════════════════════════════════════════════════════════════════╛
```

- A block is a card: `id type` on its top border, its title, then one meta row: its knobs, each
  with its name (`effort: low`, `3 votes`, `until: 2 dry rounds`), and `out: …`, the schema it hands on.
  Notes are not on a card until it is selected.
- The selected card has a heavy border and grows to show all its notes, word-wrapped. That is the one
  place the notes are read; the inspector holds the field they are edited in. Its colour stays its type's.
- A container is a box around its blocks. A pipeline or loop chains them along the flow;
  a parallel, sweep or branch puts them side by side across it.
- `│` (or `─▶`) hands each result on as it arrives; `║` (or `═▶`) waits for all results first.
- `×4` and a double bottom border (`╘═══╛`) mean a fan-out and nothing else: the block runs once per item (`×n` when the count is not stated; no badge for one). Votes are said in words, `3 votes`.
  A container's header says what each run is for (`each: …`); its knobs and `out: …` are on its bottom border.
- `+` adds a block there. The ones around the selection and at the ends are always drawn; the rest
  show under the pointer. A `+` on a container's bottom border adds at the end of that container.
- `▲ 3 more above` / `▼ 5 more below` on the board's edge say it goes on; a container whose header
  has scrolled off keeps it pinned on the first row.
- `▲` on a border is a lint; the inspector under the board says what is wrong and how to fix it. The header counts them (`▲ 2`) and `n` goes to the next one.
- Under the header, `goal: …` is the design's description: what the workflow is for. `d` edits it. Claude is handed it as the goal.

The keys and the inspector stand at the bottom of the pane and the board takes every other row, so the keys never move:
not when another block is selected, not when something is said. Docked, from the bottom up: two rows of keys (the first
acts on the selected block, the second on the design; each key keeps its place whether it is shown or not), one row for
whatever needs saying (a change just made and `u: undo`, the delete question, a refused edit, the lock), the inspector, the board.
Inline: every key that works now under a short label (`a: +`, `z: fold`, `c: ?`, `n: lint`, `q: clear`) on one row, or on two
where one cannot hold them (about 100 columns with redo, a lint or run results to show); one line for the selected block;
the board; the inspector's fields open when you press `e`. No key is left out, so nothing the pane says names a key that is not drawn.

The key rows say who has the keyboard. While the pane has it, each key's letter is lit. While it does not (after a chat
turn, a reload, a resize, Escape), the keys are dim and the message row says `keys are in the prompt · click the board or /conductor`
first, before anything else: what was just said follows it only without its key hint (`· n3 changed: notes`), and only where both fit.
A click on the board gives the keys to the key rows. `r` and `v` put a request in the prompt box and the keys go there with
it, so what you type next is typed into the prompt. If the prompt box already holds text when you click the board, the keys
here stay off and the pane says so (`Esc returns to the prompt`).

The inspector has a field for everything a block can carry, and shows only what suits the block's type:

| Field | For | Shown on |
| --- | --- | --- |
| `title` | the block's name on the board | every block |
| `notes (what it does)` | whoever reads the design: what the block does and why | every block |
| `prompt (tell the agent)` | the agent: the intent of its prompt (Claude writes the wording) | agent, verify, judge panel, critic, subworkflow |
| `fanout (once per)` | what it runs once per, with a count when known (`×4 dimensions`) | agent, verify, judge panel, pipeline, parallel, sweep, loop until dry |
| `until (stop when)` | when a loop stops | loop, loop until dry |
| `schema (out)` | what the block hands on, in words or as JSON Schema text | every block |
| `agentType` | a subagent type to run as | agent, verify, critic |
| `model`, `effort` | pickers; `inherit` leaves them to the session | blocks that spawn agents |
| `isolation` | picker: `worktree` or none | agent |
| `votes` | picker | verify, judge panel |

A knob a block carries that its type does not list (set from chat, or in the file) gets its field too.
Enter in a field saves it and returns the keys to the key row. Text typed into a field is never dropped: every other way out of the field saves it too (Tab to the next field, a picker's choice, a click on the board or a key, Escape, a command, a prompt sent, an edit from chat, a resize, closing the pane), each as an edit `u` undoes.
The keyboard is in a field only after `e`, `d` or a click on that field: when a run ends, when the pane is opened or shown again, the ring is on the key rows.
The row of pickers starts with `type`, which opens the same list a block is added from (every type with what it does): the block becomes another type and keeps its notes and knobs; a title it never got (still the old type's name) becomes the new type's; one that holds blocks can only become another container.
While the board leaves rows free, the headline and a long `notes` or `prompt` wrap into them; the goal under the header wraps to three rows.
Under the block's id the inspector says its type in two lines: what it does, and `use when: …`.

With the mouse:

- Click a card to select it.
- Click a `+` to add a block at that place: press and release on the same `+` (a press let go elsewhere does nothing).
- Drag the **selected** card to a slot to move it, into or out of a container too. A bar shows where it will land
  and the words at the pointer say what a release does; releasing away from any slot cancels.
  Held at the board's edge, the board pans. Every move says where the block went: `moved n7 after n11 · u: undo`.
- Drag anything else to pan: the background, a container's body, a card that is not selected. No block moves by accident.
- The selected card carries `edit` and `del` on its border. `del` on a container that holds blocks asks once more; a single block goes at once (`u` brings it back).
- While a run is in progress editing is locked: a click only selects, the key row shows only the keys that still work,
  and the inspector lists the selected block's agents.

With the keyboard, from the pane's key rows:

| Key | Action |
| --- | --- |
| `h` `j` `k` `l` | move the selection: along the flow to the next or previous block, across it into a container or back out |
| `a` | add a block after the selection (the field says where: `+ add after n4 (in n2)`): a list of the block types, each with a line on what it does, and for the best match `use when: …`; type to narrow, Enter adds that match. The new block's title is typed next (Enter keeps the default) |
| `i` | add a block inside the selected container, the same way |
| `x` | delete: a single block at once, a container that holds blocks after a second `x`. Either way `u` brings it back |
| `u` `y` | undo and redo. Every change to a design can be undone: add, delete, move, retype, a field, a knob, the goal, a drop, and what Claude changed from chat. Fifty steps per design, for the session |
| `g` | grab the selected block; the direction keys then move it a step at a time, `g` drops it |
| `e` | edit: the title field takes the keyboard, Tab reaches the other fields and the pickers; Enter saves |
| `z` | compact: every card but the selected one becomes one row (branches one under the other); `z` again brings them back. Inline starts compact, docked starts whole; each keeps its own setting for the session, whatever design is open |
| `c` | help (a Button takes a letter or a digit as its key, so not `?`), a page a press, in the inspector's place: the block type's card, what the board's marks mean, mouse and keys and the design file's path; then closed |
| `d` | the goal: the design's description opens as a field under the header |
| `n` | go to the next block with a lint (shown while there is one) |
| `v` | ask Claude: puts `Review the "<name>" workflow design as it is on the board now (read it first, it may have changed by hand): is the structure right for its goal, what is missing, what is wasteful?` in the prompt, not sent; the keys go to the prompt |
| `r` | run: puts `Implement and run the "<name>" workflow design on: ` in the prompt, for you to say what to run it on and send. The keys go to the prompt. The message row says what the design implies first: `run: 6 blocks · 18 agents · 2 lints (n3, n5)`, or `12+ agents (more: 2 blocks fan out over an unknown number)` where the drawing does not say how many |
| `q` | put away the results of a run that is over (shown while they are on the board; the first edit does the same) |

Escape hands the keys back to the prompt (it saves an open field's text, and closes the add or type picker to the eye). `/conductor` gives them back to the pane.
The arrow keys, Tab and Enter belong to the pane's focus ring; `h` `j` `k` `l` move the selection. On the key rows the ring rests on `c: help` and cannot be walked onto another key, so Enter there only opens help.
A letter or digit that is no key here is swallowed (`b is not a key here`) instead of dropping into the prompt and taking the keyboard with it.

Blocks that do not follow one another are drawn so: the arms of a `branch` have `or` between them, the blocks of a `parallel` or `sweep` have `∥`, side by side when the board is whole and on a dotted row between them when it is compact.

Claude always reads the board before it reviews or edits: every answer of its design tool names a revision, a prompt sent after you changed the board by hand tells it so, and an edit made from an older revision is refused until it has read again. Adding a block "after" one that stands directly in a branch makes a new arm; the tool says so and says how to get a sequence (wrap the two in a pipeline).
A design started from a template is not written to disk until its first edit, or until it is run.
Reopening a design brings back the block it was left on.

## Watching a run

A run started from a design is laid over it:

- The header says the run in one row, always: `run running · 5/9 agents done · 1 failed · 57.4k tokens · 4.5s`, in fewer words where the pane is narrow (the time goes first, then the tokens; the status stays).
- When it ends with failures the header says `run finished · … · 1 failed` and the selection goes to the first block that failed. The results stay on the board until your first edit, or `q`.
- With the pane closed the status line names the block that is running: `wf 3/4 ▸ n3 review`.
- Each card's bottom border says its agents: `⠹ 2/4 done · 1 failed · 22.3k` (ended well, of started; failures; tokens).
  A container sums what it holds. `waiting` has no agent yet; `not run` never got one.
- The selection follows the block that is running (the furthest along when several are), and the board scrolls
  with it, until you move the selection yourself; from then on it stays where you put it.
- "At least N agents" before a run is a floor, not an estimate: counts multiply only where the design states a number.

## How a design becomes a workflow

A design is a spec, not a program. `/conductor run <name>` (or `r`, which leaves the request in the prompt for you to finish)
gives Claude the design's goal (its description), the design
file's path, an outline and the mapping rules, and asks it to write a real Workflow
script and run it with the Workflow tool. The rules the run view depends on:

- Label: every `agent()` call is labelled `<nodeId>: <short text>`, with the id of the innermost design node it belongs to.
- Phase: each top-level node is one phase titled `<nodeId> <title>`, listed in `meta.phases` in design order.

Designs are stored in the project, one JSON file each: `.claude/workflow-designs/<name>.json`.
The designer saves on every change.

## Run progress and its limits

Progress is derived from hooks, not from the workflow engine's own state:

- The Workflow tool call gives the run id, name and transcript folder.
- Each workflow agent spawn gives an agent and its label; the label's node id maps it to a design node. Agents whose label names no node of the design get an `unmapped` card after the design.
- Model requests and turn completions give tokens and the agent's end. The figure is the sum of input, output, cache-creation and cache-read tokens.
- Phases are read from the run's `journal.jsonl`.

Known limits:

- There is no run-end signal. A run is held finished after 8 seconds with no agent running and no new spawn; a later spawn for the same run reopens it.
- Phases rely on the journal file, an internal format that may change.
- A handoff claims the first Workflow run that starts within 3 minutes. A run started later, or without a handoff, is shown in the phase view only.
- One run is tracked at a time, and one board is mounted at a time.
- Undo history is kept for the session only. It survives `/reload-plugins`; it is lost when the mod's code is reloaded after a change, and after a visit to Claude Code's agents list (Left arrow).
- Inline at about 100 columns the keys take two rows when redo, a lint or run results add theirs; in a 30-row terminal the board then has four rows and shows the top of the selected card only.
- Replayed token counts are made up.

## Develop and test

The gate (also `bun run check`):

```
claude plugin validate . && bunx tsc -p . && claude plugin test .
```

- `src/` is pure logic (design model, run reducer and tracker, the board's layout, paint and model); `hooks/` holds the hooks modules and the board's surface module (`hooks/canvas.tsx`); `tests/` runs under `claude plugin test`.
- `scripts/dev-session.sh` starts a detached tmux session running Claude Code with the mod loaded (`CONDUCTOR_SESSION`, `CONDUCTOR_COLS`, `CONDUCTOR_ROWS`); the debug log goes to `.capture/debug.log`.
- `scripts/send.sh '/conductor' Enter` sends keys to it; `scripts/capture.sh` prints the screen and the mod's recent debug lines (also written to `.capture/`).
- `/conductor replay …` exercises the run view and the overlay without running a workflow.
- `docs/SPEC.md` and `docs/API-NOTES.md` hold the design and what was learned about the mod API.
