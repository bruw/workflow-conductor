# Conductor

Conductor is a Claude Code mod (a plugin with a hooks module) for workflows.
You lay a workflow out as a tree of blocks in a pane, hand the design to Claude to
implement and run, and watch the run's progress on the same design.

## Requirements

- Claude Code 2.1.296 or later (the version this was built and tested on), with the Workflow tool.
- A fullscreen terminal session for the mouse; the keyboard toolbar works without it.
- The pane asks the dock for a width that leaves the transcript about half the terminal. A dock width you dragged (Claude Code keeps it) wins over that.
- For development: `bun` (the gate runs `bunx tsc`).

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
| `/conductor design [name]` | Opens the designer on a saved design, or offers templates for a new one. The name defaults to `untitled`. |
| `/conductor draft <name> <description…>` | Claude drafts a design for the description, saves it under that name and shows it on the board. Refused when a design of that name already holds blocks. |
| `/conductor run <name> [fill]` | Hands the saved design to Claude and submits the prompt. With `fill`, the prompt is left in the box for you to send. The answer says what the design implies: `at least 18 agents · no lints`. |
| `/conductor list` | Names the saved designs. |
| `/conductor replay <review-41\|partial-29\|clear> [fast\|slow]` | Dev: replays a recorded run in the run view, or clears it. |
| `/conductor replay design <template> [fast\|slow]` | Dev: replays a made-up run over a template's design (`review`, `research`, `migrate`, `judge-panel`). |

## Designing by talking

You do not have to assemble blocks by hand. `/conductor draft review-pr review this PR thoroughly`
has Claude draft the design; with a design open, plain messages change it:
"add an adversarial verify with 3 votes after n3", "set this block to low effort"
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
│ │ adversarial verify                     │ │
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
│ effort: low · out: { dime… │    │ │ review                     │ ─▶ │ adversarial verify         │ │    │              │
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
- `×4` and a double bottom border (`╘═══╛`) mean it runs many times (a fan-out, or votes); no badge for one.
  A container's header says what each run is for (`each: …`); its knobs and `out: …` are on its bottom border.
- `+` adds a block there. The ones around the selection and at the ends are always drawn; the rest
  show under the pointer. A `+` on a container's bottom border adds at the end of that container.
- `▲ 3 more above` / `▼ 5 more below` on the board's edge say it goes on; a container whose header
  has scrolled off keeps it pinned on the first row.
- `▲` on a border is a lint; the inspector under the board says what it is.

Under the board: a line for whatever needs saying about it (the delete question, what a grab's keys do,
a refused edit, the lock), one row of keys, then the inspector. Inline the inspector is one line until you press `e`.

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
Enter in a field saves it and returns the keys to the key row.

With the mouse:

- Click a card to select it.
- Click a `+` to add a block at that place.
- Drag a card to a slot to move it, into or out of a container too. A bar shows where it will land
  and the words at the pointer say what a release does; releasing away from any slot cancels.
  Held at the board's edge, the board pans.
- The selected card carries `edit` and `del` on its border. `del` on a container that holds blocks asks once more.
- Drag the background to pan.
- While a run is in progress editing is locked: a click only selects, the key row shows only the keys that still work,
  and the inspector lists the selected block's agents.

With the keyboard. The keys do the same whether the pane's key row or the board (after a click on it) has the keyboard:

| Key | Action |
| --- | --- |
| `h` `j` `k` `l` | move the selection: along the flow to the next or previous block, across it into a container or back out |
| `a` | add a block after the selection: a list of the block types, each with a line on what it is for; type to narrow, Enter adds the first. The new block's title is typed next (Enter keeps the default) |
| `i` | add a block inside the selected container, the same way |
| `x` | delete (a container that holds blocks asks first) |
| `g` | grab the selected block; the direction keys then move it a step at a time, `g` drops it |
| `e` | edit: the title field takes the keyboard, Tab reaches the other fields and the pickers; Enter saves |
| `z` | compact: every card but the selected one becomes one row (branches one under the other); `z` again brings them back. Inline starts compact, docked starts whole; each keeps its own setting for the session, whatever design is open |
| `c` | help, a page a press, in the inspector's place: the block type's card, what the board's marks mean, mouse and keys and the design file's path; then closed |
| `r` | put `/conductor run <name>` in the prompt; Enter sends it. The line under the board says what the design implies first: `run: 6 blocks · at least 18 agents · no lints` |

After a click on the board the arrow keys also move the selection and Enter edits. Escape hands the keys back to the prompt.
After a handoff the keyboard is in the prompt: `/conductor` reopens the pane with the keyboard.
Reopening a design brings back the block it was left on.

## Watching a run

A run started from a design is laid over it:

- The header says the run in one line: `run running · 5/9 agents done · 1 failed · 57.4k tokens · 4.5s`.
- Each card's bottom border says its agents: `⠹ 2/4 done · 1 failed · 22.3k` (ended well, of started; failures; tokens).
  A container sums what it holds. `waiting` has no agent yet; `not run` never got one.
- The selection follows the block that is running (the furthest along when several are), and the board scrolls
  with it, until you move the selection yourself; from then on it stays where you put it.
- "At least N agents" before a run is a floor, not an estimate: counts multiply only where the design states a number.

## How a design becomes a workflow

A design is a spec, not a program. `/conductor run <name>` gives Claude the design
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
- Delete has no undo.
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
