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

## Keys and mouse

The designer opens with the keyboard on its toolbar:

| Key | Action |
| --- | --- |
| `j` / `k` | move the selection down / up |
| `g` | grab the selected block; `j`/`k` then move it, `g` drops it |
| `a` | add a block after the selection |
| `i` | add a block inside the selected container |
| `x` | delete (a container asks first) |
| `e` | edit the title |
| `h` | show the block type's help card |
| `o` | list the selected node's agents (only with a run on the design) |
| `r` | put `/conductor run <name>` in the prompt; Enter sends it |

Mouse, on the canvas:

- Click a row to select it; click a container's glyph to fold or unfold it; click `+ add` to add at the end.
- Drag a row to move it. Moving left or right while dragging picks the depth
  (3 columns per level). Holding the pointer on the first or last visible row scrolls.
  Releasing outside the rows cancels.
- While a run is in progress editing is locked; a click opens or closes a row's agent list.

Clicking the canvas gives it the keyboard; Escape hands the keys back to the prompt.
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
- Each workflow agent spawn gives an agent and its label; the label's node id maps it to a design node. Agents whose label names no node of the design are listed as `unmapped`.
- Model requests and turn completions give tokens and the agent's end. The figure is the sum of input, output, cache-creation and cache-read tokens.
- Phases are read from the run's `journal.jsonl`.

Known limits:

- There is no run-end signal. A run is held finished after 8 seconds with no agent running and no new spawn; a later spawn for the same run reopens it.
- Phases rely on the journal file, an internal format that may change.
- A handoff claims the first Workflow run that starts within 3 minutes. A run started later, or without a handoff, is shown in the phase view only.
- One run is tracked at a time, and one canvas is mounted at a time.
- Delete has no undo.
- Replayed token counts are made up.

## Develop and test

The gate (also `bun run check`):

```
claude plugin validate . && bunx tsc -p . && claude plugin test .
```

- `src/` is pure logic (design model, run reducer and tracker, canvas model); `hooks/` holds the hooks modules and the canvas surface module; `tests/` runs under `claude plugin test`.
- `scripts/dev-session.sh` starts a detached tmux session running Claude Code with the mod loaded (`CONDUCTOR_SESSION`, `CONDUCTOR_COLS`, `CONDUCTOR_ROWS`); the debug log goes to `.capture/debug.log`.
- `scripts/send.sh '/conductor' Enter` sends keys to it; `scripts/capture.sh` prints the screen and the mod's recent debug lines (also written to `.capture/`).
- `/conductor replay …` exercises the run view and the overlay without running a workflow.
- `docs/SPEC.md` and `docs/API-NOTES.md` hold the design and what was learned about the mod API.
