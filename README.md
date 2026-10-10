# Conductor

Conductor is a Claude Code mod (a plugin with a hooks module) for workflows.
You lay a workflow out as a tree of blocks in a pane, hand the design to Claude to
implement and run, and watch the run's progress on the same design.

## Requirements

- Claude Code 2.1.296 or later (the version this was built and tested on), with the Workflow tool.
- A fullscreen terminal session for the mouse; the keyboard toolbar works without it.
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
| `/conductor` | Opens the run view. If the current run came from a design, opens that design with the run laid over it. |
| `/conductor design [name]` | Opens the designer on a saved design, or offers templates for a new one. The name defaults to `untitled`. |
| `/conductor run <name> [fill]` | Hands the saved design to Claude and submits the prompt. With `fill`, the prompt is left in the box for you to send. |
| `/conductor list` | Names the saved designs. |
| `/conductor replay <review-41\|partial-29\|clear> [fast\|slow]` | Dev: replays a recorded run in the run view, or clears it. |
| `/conductor replay design <template> [fast\|slow]` | Dev: replays a made-up run over a template's design (`review`, `research`, `migrate`, `judge-panel`). |

## The designer: a flow board

The design is drawn as a board of cards, in the order the workflow runs. Docked beside
the transcript it flows top to bottom and every card is as wide as the pane:

```
╭── n1 agent ────────────────────────────────╮
│ scout diff                                 │
│ Cheap and mechanical. Its list of          │
│ dimensions is the work-list for the…       │
╰ low ───────────────────────────────────────╯
  │  +
┏━▼ n2 pipeline ×4 · review · each: dimensi… ┓
┃ ╭── n3 agent ────────────────────────────╮ ┃
┃ │ review                                 │ ┃
┃ │ One reviewer per dimension.            │ ┃
┃ ╰────────────────────────────────────────╯ ┃
┃   │                                        ┃
┃ ╭─▼ n4 verify ×3 ────────────────────────╮ ┃
┃ │ adversarial verify                     │ ┃
┃ │ Each skeptic tries to refute a finding │ ┃
┃ │ and defaults to refuted when unsure.…  │ ┃
┃ ╰ 3 votes ───────────────────────────────╯ ┃
┃  ╰──────────────────────────────────────╯  ┃
┃   ╰────────────────────────────────────╯   ┃
┗━ + ━━━━━━━━━━━━━━━━━━━━━━━━━━━ edit ━ del ━┛
 ╰──────────────────────────────────────────╯
  ╰────────────────────────────────────────╯
  ║  +
╭─▼ n5 agent ────────────────────────────────╮
```

Above the prompt (inline) it flows left to right:

```
╭ n1 agent ────╮    ╭ n2 pipeline ×4 · review · each: dimensions ───╮    ╭ n5 agent ────╮
│ scout diff   │ ─▶ │ ╭ n3 agent ────╮    ╭ n4 verify ×3 ──────╮    │ ═▶ │ synthesize   │ +
│ Cheap and…   │    │ │ review       │ ─▶ │ adversarial verify │    │    │ Runs once…   │
╰ low ─────────╯    │ │ One reviewe… │    │ Each skeptic trie… │    │    ╰──────────────╯
                    │ ╰──────────────╯    ╰ 3 votes ───────────╯    │
```

- A block is a card: `id type` on its top border, its title, the start of its notes, its knobs
  on the bottom border (with a run, its progress there instead).
- The selected card has a heavy border and grows to show all its notes and a line of its knobs.
  Its colour stays its type's.
- A container is a box around its blocks. A pipeline or loop chains them along the flow;
  a parallel, sweep or branch puts them side by side across it.
- `│` (or `─▶`) hands each result on as it arrives; `║` (or `═▶`) waits for all results first.
- `×4` and the borders stacked under a box mean it runs many times (a fan-out, or votes).
  A container's header says what each run is for (`each: …`); `out: …` on its bottom border is what it hands on.
- `+` adds a block there. The ones around the selection and at the ends are always drawn; the rest
  show under the pointer. A `+` on a container's bottom border adds at the end of that container.
- `▲ 3 more above` / `▼ 5 more below` on the board's edge say it goes on; a container whose header
  has scrolled off keeps it pinned on the first row.
- `▲` on a border is a lint; the inspector under the board says what it is.

Under the board: one row of keys, then the inspector. Docked, the inspector has the title and
notes fields, with the notes word-wrapped under their field. Inline it is one line until you press `e`.

With the mouse:

- Click a card to select it.
- Click a `+` to add a block at that place.
- Drag a card to a slot to move it, into or out of a container too. A bar shows where it will land
  and the words at the pointer say what a release does; releasing away from any slot cancels.
  Held at the board's edge, the board pans.
- The selected card carries `edit` and `del` on its border. `del` on a container that holds blocks asks once more.
- Drag the background to pan.
- While a run is in progress editing is locked: a click only selects, and the inspector lists the selected block's agents.

With the keyboard. The keys do the same whether the pane's key row or the board (after a click on it) has the keyboard:

| Key | Action |
| --- | --- |
| `h` `j` `k` `l` | move the selection: along the flow to the next or previous block, across it into a container or back out |
| `a` | add a block after the selection |
| `i` | add a block inside the selected container |
| `x` | delete (a container that holds blocks asks first) |
| `g` | grab the selected block; the direction keys then move it a step at a time, `g` drops it |
| `e` | edit: the title field takes the keyboard, Tab reaches the notes; Enter saves |
| `z` | compact: every card but the selected one becomes one row; `z` again brings them back |
| `c` | help: the block type's card, what the board's marks mean, the design file's path |
| `r` | put `/conductor run <name>` in the prompt; Enter sends it |

After a click on the board the arrow keys also move the selection and Enter edits. Escape hands the keys back to the prompt.
After a handoff the keyboard is in the prompt: `/conductor` reopens the pane with the keyboard.

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
