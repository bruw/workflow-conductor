# Conductor

Conductor is a Claude Code mod (a plugin with a hooks module) for workflows.
You lay a workflow out as a graph of blocks in a pane, hand the project to Claude to
implement and run, and watch the run's progress on the same project.

## Requirements

- Claude Code 2.1.296 or later (the version this was built and tested on), with the Workflow tool.
- A fullscreen terminal session for the mouse; the keys work without it.
- Docked beside the transcript, the pane asks the dock for the terminal's width less 30 columns (the transcript keeps a sliver, the prompt stays full width). A dock width you dragged (Claude Code keeps it) wins over that.
- For development: `bun` (the check runs `bunx tsc`).

## Before you start

- **Use a wide terminal and the docked pane.** With 100 columns or more inside the docked pane, the graph and the detail pane stand side by side. A terminal under 130 columns cannot give the pane that (it asks for the terminal's width less 30); it then gets the stacked screen: the same parts in one column. Above the prompt (inline) the screen is always stacked and short: the detail pane is one row until you open a field, the add list, the goal or a help page.
- **A dock width you once dragged is remembered by Claude Code** and wins over the width Conductor asks for. Drag the dock's border to change it.
- **The pane says when the keyboard is not its own.** While letters go to Claude Code's prompt, the legend and the key hints are dim and the footer says `Input: prompt · click the graph or /conductor`: do one of the two to get the keys back. While the pane has the keyboard, letters are keys on the graph and text in an open field.
- **Escape always hands the keyboard back to the prompt.** No mod can keep it. Text you typed into a field is not lost: it is saved as an edit (the pane says `n3 changed: notes`, and `u` undoes it) on Escape and on every other way out of a field: an arrow to another field, Enter, a click on the graph, a picker's choice, a `/conductor` command, a prompt you send, an edit from chat, a resize, closing the pane. Press `u` afterwards if you did not mean it.
- **Move with `w` `a` `s` `d`; the arrows are for fields and lists.** The arrow keys belong to Claude Code's focus ring, not to the graph: `↓` from the graph opens the selected block's fields, `↑` / `↓` walk them, and in a list of blocks they choose. `←` / `→` move the cursor in a field. (Tab and Shift+Tab step the ring like `↓` and `↑`; no hint names them.)
- **`←` is Claude Code's wherever the keyboard is not in a text field.** It opens the agents list and the pane goes (`/conductor` brings it back). So Conductor keeps the keyboard in a field at all times (a hidden one while you are on the graph), and no arrow leaves it on a button: the block's type, on the detail pane's top row, is opened with `t` or a click. For a moment after `↑` past the first field or `↓` past the last, the ring is on the pane's `✕` on its way back to the graph: `←` in that instant still leaves.
- **Letters are keys only while the pane has the keyboard and no field is open.** A character that is no key says so (`k is not a key here`) and does nothing. More than 8 characters arriving at once are taken for a paste and ignored (`pasted text is not keys: nothing was done`).
- **The project is a spec.** Claude writes the workflow script from it; the structure follows the project, details vary between runs.
- **A run counts as ended after 8 quiet seconds** (no agent running, no new one started). Its results stay on the graph until the first edit or `c`.
- **Undo is per project, fifty steps, for the session.** It is not saved with the project. It survives `/reload-plugins`; it is lost when the session ends and when the mod's code is reloaded after a change.
- **Names.** Claude names a project it drafts; a project started from a template is `untitled` (`untitled-2`, …). A saved project is renamed on the start screen: mark it, press `e`, type the name, Enter. Names starting with `replay-` are kept for replays.

## Install

In a terminal session:

```
/plugin install conductor --marketplace bruw/workflow-conductor
```

Answer `y` to add the marketplace, then pick a scope (Enter takes the user scope). The repository is its own marketplace (`.claude-plugin/marketplace.json`).

### Install for development

Terminal:

```
claude --plugin-dir /path/to/conductor
```

Desktop app (no flag can be given): name the folder in the `env` block of `~/.claude/settings.json`.

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/conductor" } }
```

## Commands

| Command | What it does |
| --- | --- |
| `/conductor` | The board. With a run in progress: that run, on its project when it came from one. Otherwise the project last opened in this session, with the keyboard, or the start screen when there is none: the saved projects to open, rename or delete, above the templates for a new one. |
| `/conductor <description…>` | Claude drafts a new project for the description, names it and shows it on the graph (see "Designing by talking"). Always a new project, unless your own words name an existing one to change. |

There are no verbs: a project is opened, renamed and deleted on the start screen, and run with `r` on its board. Replays and the reset of stored answers are rows of the start screen too.

## Designing by talking

You do not have to assemble blocks by hand. `/conductor review this PR thoroughly`
has Claude draft a new project and name it. While it works the pane shows the splash (Claude may ask you something first: answer in the prompt). When the project lands its blocks are laid out on the graph one after the other, the header says `DRAFTING`, the detail pane is hidden and editing is locked; once Claude's turn ends the project is yours to edit and the board takes the keyboard (unless you are typing in the prompt). With a project open, plain messages change it:
"add a verify with 3 votes after n3" (the votes go in its logic), "set this block to low effort"
("this block" is the one selected on the graph). The graph follows at once, the
touched blocks are drawn in the accent colour for a moment, and the footer says what
changed (`Claude added n10 · [u] Undo`). Claude edits through the `mcp__conductor__project`
tool, which checks every edit against the project model, keeps block ids stable and
answers with the problems the project now has; a refused edit changes nothing. While a run of the project is
live, edits from chat are refused, as edits in the pane are. A project file changed
with Claude's Write or Edit tools is reloaded into the open pane too.

Claude works from the project as it is on the board: every answer of its project tool names a revision, and a prompt sent after you changed the project by hand carries a note with the change itself (the blocks added, changed, moved and removed, and the one selected), so Claude need not read the project again. Where the change cannot be said that way (Claude never read the whole project in this conversation, the conversation was compacted, or the change is longer than the project), the note tells it to read first. An edit made from an older revision is refused and changes nothing, and so is a whole-project write over a project Claude has not read in this conversation. The tool is loaded when Claude needs it, not sent with every turn. Adding a block "after" one that stands directly in a branch makes a new arm; the tool says so and says how to get a sequence (wrap the two in a pipeline). A `when` set on a block that is no arm of a branch is pointed out too: nothing reads it there.

## The designer

### The screen

Four parts, each in a fixed place: a **header**, the **graph** of the workflow, a **detail pane** for the selected block, and a **last row** with the buttons that hand the project to Claude. The key legend is the header's second row.

- **Wide** (docked, at least 100 columns inside the pane): the graph on the left, the detail pane on the right (about 30% of the width, 38 to 52 columns), a rule between them. `i` hides the detail pane and the graph takes its width (the legend then names `[i] Show details`); `i` again, or anything that needs the pane (`e`, `n`, `g`, `?`), brings it back.
- **Stacked** (docked and narrower, or inline above the prompt): the same parts in one column, the detail pane under the graph. Docked it has a fixed share of the rows at rest (about 45%) and grows while a field, the add list, the goal or a help page is open. Inline it is one row (its key hints) until one of those is open, the goal has one row and the legend one. Hidden with `i`, it takes no rows.
- **Header.** Row 1: `conductor / <project name> / agents ≥ 12`, the last part in a colour of its own: one per agent block (the cheapest arm of a branch), `agents = 3` when every block runs once, `agents ≥ 12` where the project holds a block that may run its agents more than once: a pipeline or a parallel, a loop, a verify or a judge, a subworkflow. Nothing typed into a field is read for a count. At the right, the state: `EDITING · saved`, `EDITING · unsaved template` (started from a template, nothing written yet), `EDITING · not saved yet` (a new empty project), `EDITING · replay, not saved`, `DRAFTING` (Claude was asked for a draft and nothing has arrived), `RUNNING · …` / `FINISHED · …` (a run laid over the project), `START · …` (the start screen). The goal is not in the header: it is the first line of the start block. Docked, a rule across the pane stands under the header.
- **Header:** `conductor / <name> ▾ / EDITING · saved / agents ≥ 8`: the project's name, its state in a quiet colour, the agents it starts. Short of room the agents go first, then the state. The name is a button: a press on it, or `p`, lists the project's projects. During a run the state is the run's summary.
- **Legend:** the header's second row, for the keys of the graph and of the pane as a whole. Each key is in brackets with its word after it (`[p] Projects  [⇧+WASD] (Move) Navigate  [n] New  [x] Delete …`), in a fixed order. With Shift the four keys move the block; where the block cannot move the entry is `[WASD] Navigate`. It names only keys that work right now: no `[x] Delete` with nothing selected, no `[o] Open` on a block that holds none, and during a run only what still works. It is one row always: where the room is short the less-used entries are left out; the help page "Keys" has them all.
- **Last row:** `[r] Implement and Run` and `[q] Claude Review`, centred, and `[c] Clear results` while a run's results show. Each is a button: press it, or type its key. Dim while it cannot be used (an empty project, a run in progress, a field open).
- **What was last said** (a change and its way back, `Last change: n5 changed: notes · [u] Undo`; a refusal, a question, the run's lock) stands centred in the rule over the last row, on one row; inline, where there is no rule, on the row over the buttons.
- **Key hints.** The keys of the detail pane are named on its own last rows, and no key is named in both places: `[Enter] Edit  [i] Hide` at rest; in a field `[↑ ↓] Field  [Enter] Save, back to the graph`, and the header then names only `[Esc] Keys to the prompt` (so too in the add list and in the goal's field, each with its own keys on those rows); with a help page open, `[? h] Next page  [x] Close help`.

### The graph

The workflow runs top to bottom. The graph never pans sideways: it is laid out for the width it has (132 columns at most; in a wider region it is centred).

```
┌╌ PARALLEL sweep / multi-modal sweep · once per: 4 search angl… ╌ n1 ╌┐
┊ ╭───────────────────────────────────────────────────────────── n2 ─╮ ┊
┊ │ AGENT / search                                               low │ ┊
┊ │ One agent per search angle.                                      │ ┊
┊ ╰──────────────────────────────────────────────────────────────────╯ ┊
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ [+] ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
                               all ⇓  [+]
╭───────────────────────────────────────────────────────────────── n3 ─╮
│ CODE / dedupe sources                                                │
│ Plain code over all sweep results: drop duplicate refs before the e… │
╰──────────────────────────────────────────────────────────────────────╯
                                   ↓  [+]
┌╴ PIPELINE / deep read · once per: deduped sources ╴╴╴╴╴╴╴╴╴╴╴╴╴╴ n4 ╴┐
╎ ╭───────────────────────────────────────────────────────────── n5 ─╮ ╎
╎ │ AGENT / read source                                              │ ╎
╎ │ One reader per source.                                           │ ╎
╎ ╰──────────────────────────────────────────────────────────────────╯ ╎
╎                                  ↓  [+]                              ╎
╎ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ n6 ━┓ ╎
╎ ┃ AGENT verify / check claims                    [1] model  [2] effort ┃ ╎
╎ ┃ 2 votes: drop claims the source does not actually support.       ┃ ╎
╎ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ╎
└╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴ [+] ╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴┘
 ▼ 1 more below
```

(`bun scripts/render-graph.ts research --cols 72 --rows 30 --select n6`: the Research template, `n6` selected.)

**Cards**

- A block that holds none is a card with a light rounded border and its id on the top border. Row 1: `TYPE kind / Name` (`AGENT verify / check claims`; the kind is left out on a plain block, and the name while it is still the type's or the kind's) and, at the right, its model and effort where they are set. Row 2: the first line of its notes (of its prompt when it has no notes), cut with `…`. Its output is said in the detail pane, not on the graph. A card with nothing for row 2 is three rows tall.
- What a block needs and lacks is said in its place, in the error colour: `Instruction [not set]` (an agent with neither logic nor a prompt), `Stop [not set]` (a loop with no stop condition), `IF [not set]` (an arm of a branch with no condition).
- A container is a box in its type's colour around its blocks, and its line says how it runs them: **dashed** for a chain (pipeline, loop: one block after the other), **dotted** for a stack (parallel, branch: side by side). A **phase** has no outline: it stands on a ground of its own, a step off the pane's (a phase in a phase goes back to the pane's). Its top border is its header: `TYPE / Title`, then what fits of its fields as they were typed: `· once per: …`, `· stop: …`. An empty container says `empty` where its blocks would stand; its `[+]` is on its bottom border.
- **The selected card** has a heavy border in the accent colour (heavy dashes or dots on a chain or a stack, a plain heavy line on a phase). A selected block shows all its logic, wrapped (up to a third of the graph's rows, 8 at most, then `… N more lines`), and its **chips** in place of the model and effort: `[1] model  [2] effort`. A chip shows its digit and the knob's value, or the knob's name, dim, while the knob is not set. A selected sweep or loop-until-dry carries its chips on its top border where they fit.
- ` ! ` in inverse error colour marks a block that has a problem: on the top border, just left of the id, on a card and on a container alike. A collapsed container carries it when a block inside it has one. It is a mark, not a count: the detail pane says what the problems are.
- `↓` between two blocks hands each result on as it arrives; `all ⇓` waits for all results first.
- `[+]` adds a block there, and every one is always drawn: between two blocks of a chain on the arrow's row, right of the arrow; at the end of a container's list (a chain's or a stack's) in the middle of its bottom border; at the end of the top level on a row of its own, under the arrows. At rest a `[+]` is faded. The active one is Claude orange and bold: the place `n` would add at right now, and the one under the pointer. (None is lit for `n` while the keys are in the prompt.) The place the add list is open for reads `[+] Add block here`.
- `▲ N more above` / `▼ N more below` on the graph's first and last row say it goes on (blocks wholly out of view, or rows when only part of one is); a container whose header has scrolled off keeps it on the first row.

**Chains and stacks**

- The top level, `pipeline` and `loop` are chains: their blocks one under the other, each as wide as the list, one arrow row between two.
- `parallel` and `branch` are stacks: their blocks (arms) side by side at equal widths, as tall as the tallest, with `∥` (they run at the same time) or `OR` (one of them runs) between two. No arrows between arms.
- **An arm of a branch says its condition** on its top border: `IF <condition>`, from the block's `condition` knob. The last arm with none reads `ELSE`; any other arm with none reads `IF [not set]` and carries a problem. `Condition` is a field of the detail pane, offered only to a block that stands directly in a branch.

```
┌─ BRANCH / Choose response ────────────────────────────────────────────────────────────────── n6 ─┐
│ ╭─ IF the claims … ─ !  n7 ─╮    ╭─ IF [not set] ──── !  n8 ─╮    ┌─ ELSE ───────────── !  n9 ─┐ │
│ │ AGENT / Write answer      │ OR │ AGENT / Ask the user      │ OR │ ▸ LOOP / Close g…  1 block │ │
│ │ Instruction [not set]     │    │ Say what is unclear and … │    │ Investigate gaps   o: open │ │
│ ╰───────────────────────────╯    ╰───────────────────────────╯    └────────────────────────────┘ │
└────────────────────────────────────────────── [+] ───────────────────────────────────────────────┘
```

(The last rows of `bun scripts/render-graph.ts branch-when --cols 100 --rows 30`.)

- **The carousel.** An arm is never narrower than 28 columns. A stack whose arms do not all fit shows as many as fit, between two gutters of 3 columns: `◀` and `▶` with the number of arms out of sight on that side under them, and `· 3–5 of 9` in the header. The window always holds the selected arm: `a` / `d` past its edge slide it. A click on `◀` or `▶` slides it by one; if that takes the selected arm out of sight, the selection steps back to the stack itself.

```
┌╌ PARALLEL / lenses · 3–5 of 9 ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ n2 ╌┐
┊    ┏━━━━━━━━━━━━━━━━━━━━━ n5 ━┓   ╭───────────────────── n6 ─╮   ╭───────────────────── n7 ─╮    ┊
┊  ◀ ┃ AGENT / performance      ┃ ∥ │ AGENT / tests     sonnet │ ∥ │ AGENT verify / docs      │ ▶  ┊
┊  2 ┃ [1] model  [2] effort        ┃   │ Review the change for t… │   │ 3 votes: review the cha… │ 4  ┊
┊    ┃ Review the change for    ┃   │                          │   │                          │    ┊
┊    ┃ performance only.        ┃   │                          │   │                          │    ┊
┊    ┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛   ╰──────────────────────────╯   ╰──────────────────────────╯    ┊
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ [+] ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```

(From `bun scripts/render-graph.ts parallel-9 --cols 100 --rows 15 --select n5 --scroll n2=2`.)

**Collapsed containers and nested views**

- A container that cannot be drawn open is drawn **collapsed**, as one card of four rows: when it stands more than 3 containers deep in the view, or when the room inside it would be under 34 columns. Row 1: `▸ TYPE / Title` and how many blocks it holds, at any depth. Row 2: the titles of its blocks joined by ` → ` (a chain) or ` | ` (a stack), and `o: open`.
- `o` opens the selected container as **the view**, collapsed or not (so does a click on a container that is already selected). The view shows only that container, as the frame, at full width; what was collapsed inside it may now be drawn open. The graph's first row is then the breadcrumb, `LEVEL 3   six-deep  ›  n1 outer  ›  n3 rounds  ›  n4 finders`, with a rule between it and the graph: first how many containers deep the view is, then the way down to it. The last crumb is the view and is lit; every other one can be clicked, and a trail too long for the row loses its middle to `…`.
- `b` goes one level up and selects the container it came out of.
- Your own keys never take the selection out of the view. When something else selects a block the view does not draw (a run being followed, an edit from chat, undo), the view changes to one that draws it: the whole project where that does, else the outermost container that does.

```
 LEVEL 3   six-deep   ›   n1 outer   ›   n3 rounds   ›   n4 finders
────────────────────────────────────────────────────────────────────────────────────────────────────
┌─ PARALLEL / finders ───────────────────────────────────────────────────────────────────── !  n4 ─┐
│ ┌─ PIPELINE / find and check ─────────── n5 ─┐   ╭─────────────────────────────────────── n12 ─╮ │
│ │ ╭─────────────────────────────────── n6 ─╮ │ ∥ │ AGENT / grep sweep                    haiku │ │
│ │ │ AGENT / find                       low │ │   │ A cheap textual pass over everything.       │ │
│ │ │ Look for the defect in this file.      │ │   ╰─────────────────────────────────────────────╯ │
│ │ ╰────────────────────────────────────────╯ │                                                   │
│ │                     ↓  [+]                 │                                                   │
│ │ ┌─ LOOP-UNTIL-DRY / dig ──────────── n7 ─┐ │                                                   │
│ │ │ ┌─ SWEEP / angles · 1 of 2 ───── n8 ─┐ │ │                                                   │
│ │ │ │    ╭───────────────────── n9 ─╮    │ │ │                                                   │
 ▼ 1 more below
```

(`bun scripts/render-graph.ts deep-6 --cols 100 --rows 12 --view n4`. In the whole project `n5` is a collapsed card: `▸ PIPELINE / find and ch…  6 blocks`.)

### Keys

Letters are keys while the pane has the keyboard and no field is open. Case matters: `w` moves the selection, `W` (Shift+W) the block.

| Key | Does |
| --- | --- |
| `w` `s` | the previous / next block in reading order: from a container down into its first block, from the last block of a container on to what follows it, `w` from a first block up to its container. Inside an arm they stay in that arm to its end |
| `a` `d` | in a stack, the arm to the left / right (the block of it nearest in height). Elsewhere `d` goes into a container and `a` out to the one around the selection. Nothing wraps; at an edge nothing happens |
| `Shift+W` `Shift+S` | move the selected block one place up / down: past the block beside it, into an open container that comes next, out of the end of its own container. A collapsed container is one place (open it first to move a block into it). A block never leaves the view |
| `Shift+A` `Shift+D` | swap an arm with the one beside it. Outside a stack they say `only arms move sideways` |
| `Enter` or `e` | edit: the fields of the selected block open, the keyboard in its name |
| `↑` `↓` | in a field: the field above / below, what was typed saved; `↓` from the graph opens the first field. Past the first or the last field: back to the graph. In a list of blocks: choose |
| `t` | the block and its kind: the detail pane becomes the list of what the selected block may become |
| `n` or `+` | a new block after the selection (inside it when it is an empty container, or the view's frame), where the lit `[+]` stands: the detail pane becomes the add list: pick a block, then its kind, or type either name. `n` again in the list changes the place: after, inside (a container), before |
| `x` | delete: a single block at once, a container that holds blocks after a second `x`. Also closes the add list and the help pages |
| `1` `2` | step a knob of the selected block, as its chips show: `1` model (inherit → haiku → sonnet → opus → inherit), `2` effort (inherit → low → medium → high → xhigh → max → inherit). Only the ones the block has |
| `o` `b` | open the selected container as the view / back up one level |
| `i` | hide or show the detail pane |
| `u` `y` | undo and redo. Every change to a project can be undone: add, delete, move, retype, a field, a knob, the goal, a drop, and what Claude changed from chat. Fifty steps per project, for the session |
| `q` | Claude review: puts `Review the "<name>" workflow project as it is on the board now (read it first, it may have changed by hand): is the structure right for its goal, what is missing, what is wasteful?` in the prompt, not sent; the keys go to the prompt |
| `r` | implement and run: hands the project to Claude at once (the prompt `Implement and run the "<name>" workflow project …` is sent for you) and the keys go to the prompt. Claude first confirms the design and asks what to run it on, in chat; your answer starts the work. A toast says what the project implies: `agents ≥ 12 (more: 2 blocks may fan out, 1 loop repeats) · problems in n3, n5`. Where the prompt box already holds text the request is left there for you to send |
| `c` | put away the results of a run that is over (the first edit does the same) |
| `p` | the projects: the start screen over the open project, with the saved ones (the open one marked `open`, one being run `running`) and the templates. Enter opens the marked one or starts a new project from a template; on a saved one `e` renames it and `x` deletes it (asked again: `x` once more); `p` or `b` goes back to the project as it was left. A project started from a template and never edited has no file: left for another, nothing of it is kept |
| `?` or `h` | help, in the detail pane, a page a press, round again; `x` closes it |

- Every change says what it did and how to take it back: `moved n7 into n4 · [u] Undo`, `deleted n7 "verify" · [u] Undo`, `n5 model: haiku · [u] Undo`. A move that cannot be made says why (`already at the bottom`, `already the last arm`).
- Up to 8 characters arriving at once are applied in order.
- While a run locks the project only `w a s d`, `o`, `b`, `i`, `p`, `?` act; any other key says `run in progress · editing locked`.
- In a field: `↑` / `↓` walk the fields, Enter saves and returns to the graph, `↑` from the first field and `↓` from the last return to the graph too (saved), Escape hands the keyboard to the prompt (the text is saved).
- `q` puts a request in the prompt box and `r` sends one; either way the keys go to the prompt with it, so what you type next is typed into the prompt. If the prompt box already holds text when you click the graph, the keys here stay off and the pane says so (`keys are off here while the prompt box holds text · Esc returns to the prompt`).

### The detail pane

For the selected block, from the top:

1. The block's type and kind, and at the right its id (`agent verify ▾      n4`). The type is a button: a press opens the list of blocks and kinds. The start block has none to pick (`start n1`).
2. **Meaning**: what its kind does (its type's, on a plain block), in one line, and `use when: …`.
3. Its fields, each label on a row above its value. One a problem names is marked on its label while it is empty, in the error colour (`Goal [Required]`):

| Field | For | Shown on |
| --- | --- | --- |
| `Name` | the block's name on the graph | every block |
| `Logic` | what the block does and why, for whoever reads the project | every block but a phase (a phase is its name and no more) |
| `Prompt` | the agent: the intent of its prompt (Claude writes the wording) | agent, subworkflow |
| `Condition` | the condition that picks this arm; empty on the last arm for the else | a block directly in a branch |
| `Once per` | what it runs once per, in your own words: `changed files`, `4 dimensions` | pipeline, parallel |
| `Stop condition` | when a loop stops, in your own words | loop |
| `Output` | what the block hands on, in words or as JSON Schema text | agent, code, subworkflow |
| `Goal` | what the workflow is for, in a sentence: Claude is handed it as the goal. Required: `[not set]` and a problem while it is empty | start (its only fields, with `Args`: it has no name or logic to set) |
| `Args` | what the workflow is run on, in words or as a shape: `{ target? }: a branch or a path`. Empty: it takes no input | start |

A block's fields are its type's, the same for every kind of it: a kind adds no field. The project file names them with the same words: `name`, `logic`, and under `knobs` `prompt`, `output`, `oncePer`, `stopCondition`, `condition`. An empty field says what it is for, in the kind's words (a loop of kind pass: `the check passes, at most 3 rounds`), and a new block of a kind has the fields its pattern needs filled in already. A container hands on what its last block makes, so it has no output of its own.

4. Read only, where the file sets them: `Isolation  worktree` and `Agent type  <name>` (the pane has no control for either; Claude sets or drops them). The model and the effort have no picker here: the chips on the card step them. A block whose file sets `isolation: worktree` shows a read-only line, `Isolation  worktree`: the pane has no control for it, Claude sets or drops it when asked.
5. **Run**, while a run's results show: the block's agents.

The pane's last rows name its keys: `[Enter] Edit  [i] Hide` at rest, and the keys of a field, the add list or a help page while one of those is open.

- **At rest** a field is text: its whole value, wrapped, `[not set]` where it is empty (in the error colour, and its label marked `[Required]`, where a problem names that field). A knob a block carries that its type does not list (set from chat, or in the file) gets its field too.
- **While editing** (after `e`, Enter, `↓`, or a click on a field) every field is an input under its label: the one you are typing in wraps over as many rows as its text takes, the others are one line, cut with `…`. Where the text is taller than the pane, the pane moves up so the row being typed stays in view. Enter saves and returns to the graph. Text typed into a field is never dropped: every other way out saves it too (an arrow to the next field, a picker's choice, a click on the graph, Escape, a command, a prompt sent, an edit from chat, a resize, closing the pane), each as an edit `u` undoes.
- Where the pane is short of rows it gives up, in this order: the blank rows, the Meaning section (help page 1 says it), then the long texts are cut to fewer rows.
- The type on the top row (`agent verify ▾`) opens the add list on the block: its own kinds first, then the other blocks. The block becomes what is picked and keeps its name, its logic, what it holds and every knob that was typed; a knob still as its old kind filled it in is replaced by the new kind's; a name it never got (still the old type's or kind's) becomes the new one's; one that holds blocks can only become another container.

The same pane shows, in place of the block:

- **The add list** (`n`, `+`, a click on a `[+]`). Its heading says the place (`New block after n4 Deep read`), then a filter field, then the eight blocks, each on a row with what it does, in two groups (blocks that do work, blocks that hold blocks). A block that has kinds is marked `▸`, and the marked row names them; Enter on it opens its kinds (`· which loop?`), the plain one first, and `b` goes back to the blocks. Typing skips that step: the list then shows every block whose name holds what was typed, at the block's level or the kind's, each named in full (`ver`: `AGENT verify`, `LOOP converged`; `loop`: every kind of loop). Names only are searched. `↑` / `↓` move the mark, always. `n` changes the place while the filter is empty; every other letter is typed into the filter (`s` is the filter `s`). Enter adds the marked row, a click the one clicked, `x` cancels. The new block is selected and its name is typed next (Enter keeps the default).
- **Help** (`?`, `h`), four pages: the selected block's type and kind, what the graph's marks mean, the keys, the mouse and the project file's path.
- **The goal and the args** are fields of the start block: select it (a project opens on it) and press `Enter`.
- With nothing selected: the goal, and how to go on.

### The start screen

`/conductor`, with nothing opened yet in the session, opens the start screen (`p` opens it from a project). The detail pane lists the saved projects (each with its block count and what it is for) above the templates (`Review`, `Research`, `Migrate`, `Judge panel`) and `Blank`; `↑` / `↓` (or `w` / `s`) move the mark, Enter or a click opens the row. On a saved project `e` renames it (its name becomes a field: type, Enter; an arrow leaves it as it was) and `x` deletes it and its script, after asking once more (`x` again; any other key keeps it). A project that is being run is neither renamed nor deleted. The graph shows the marked project read-only, the header its name and goal. Under the list, `[Draft using claude]` puts `/conductor ` in the prompt box, for you to say what the workflow should do. `?` opens help here too.

Under all of those the list goes on with what opens no project. **Replay a run** (dev): a made-up run replayed over each template (the project is named `replay-<template>`, lives in the session only, and is never saved or listed: the `replay-` prefix is kept for this), and each recorded run (`review-41`, `partial-29`) replayed in the run view. Token counts are made up. Last, **Ask again** forgets every stored `Always …` and `Never …` answer, so Conductor asks both its questions again (see "When Claude starts a workflow").

A project started from a template or blank is not written to disk until its first edit, or until it is run. Reopening a project brings back the block it was left on.

### An empty project

```
╭────────────────────────────────────────────────────────────────────── !  n1 ─╮
│ START                                                                        │
│ Goal [not set]                                                               │
╰──────────────────────────────────────────────────────────────────────────────╯

                   [+]

                   n  add a block
                   e  say what this workflow is for

                   A plain message to Claude in the prompt
```

(`bun scripts/render-graph.ts empty --cols 80 --rows 14`, blank rows cut.) The start block is there from the start, as in every project, and the project opens on it. While Claude drafts a project (`/conductor <description>`) the pane shows the splash and `Claude is drafting your workflow · answer its questions in the prompt` until the project lands.

### The mouse and the wheel

- Click a card to select it (press and release on the same cell).
- Click the selected container again to open it as the view; click a crumb to go back to that view.
- Click a `[+]` for a new block there: press and release on the same `[+]` (a press let go elsewhere does nothing). The one under the pointer lights up.
- Click a chip to step it, `◀` or `▶` to slide the arms.
- Drag the **selected** card to a slot to move it, into or out of a container too. A bar shows where it will land and the words at the pointer say what a release does (`drop here`, `drop into n4`, `no slot here: release cancels`). Held at the graph's top or bottom edge, the graph scrolls.
- Drag anything else to scroll up and down: the background, a container's body, a card that is not selected. No block moves by accident.
- The wheel over the graph scrolls it.
- In the detail pane, click a field to edit it, a row of the add list to add that type.
- After any click on the graph the keyboard is the pane's again, so the next letter is a key.

### Blocks and kinds

There are nine blocks, the ones a workflow script is written in: `agent`, `code`, `subworkflow`, `start`, and the ones that hold blocks: `pipeline`, `parallel`, `loop`, `branch`, `phase`. A pattern is not a block of its own: it is a **kind** of the block it is made of, picked one step after the block (or typed by name). Each block's kinds answer one question about it, and the first one is the plain block.

| Block | Its kinds answer | Kinds |
| --- | --- | --- |
| agent | what is its job? | task · scout (lists the work) · check (exact pass or fail) · verify (voters try to refute) · judge (voters score the candidates) · critic (what is missing) · merge (merges all results) · classify (labels for a branch) |
| loop | when does it stop? | custom · count (N rounds) · pass (the round's check passes) · dry (rounds find nothing new) · converged (a round changes nothing) · target (enough collected) · budget (the token budget lasts) |
| parallel | what differs between its arms? | arms (different jobs) · each (the same job per item) · sweep (the same search, different angles) · attempts (independent tries at one task) |
| branch | how is its arm picked? | if-else · guard (one arm: run it or skip it) · route (by a label) |

`pipeline`, `phase`, `code`, `subworkflow` and `start` have no kinds. A `code` block's logic field says what such a block is for (dedup, filter, top-K, merge).

What a kind does:

- **It names the block** on its card and in the hand-off (`AGENT verify`), and says what it means in the detail pane and on help page 1.
- **It fills in** the fields its pattern needs on a new block: a verify gets `3 votes: …` as its logic and `{ refuted: boolean, reason }` as its output, a loop of kind dry `2 rounds in a row find nothing new` as its stop condition, a sweep its four search angles. Everything filled in is an ordinary value: change it or clear it.
- **It hints** at what the empty fields are for, in place of the field's general hint.
- **Two kinds start with blocks**, in the same edit (one undo): a loop of kind pass holds an attempt and a check, a loop of kind dry a finder and a dedup step.

Votes are a knob of the two voting kinds of agent (verify, judge), not a kind of their own. In the file a kind is the block's `kind` (left out on a plain block).

### Problems

Conductor checks the project as you build and never blocks anything. A block that has a problem is marked on its card (` ! `); the empty field a problem is about is marked `[Required]` on its label in the detail pane, and the blocks that have one are named before a run (`problems in n3, n5`). Problems are not counted anywhere. Every check is about what blocks there are, where they stand and which fields are empty: none reads the words or the numbers in a field. What it flags:

- a loop with no stop condition
- a code block reading an agent's output that has no output shape set
- an agent with neither logic nor a prompt (the kinds whose name is the task are let off: verify, judge, critic)
- a verify with nothing before it to check
- a parallel holding a single block with nothing said to run it once per
- a loop whose round ends in nothing the stop test can read
- an arm of a branch with no condition (only the last arm may go without one, as the else)

**Two blocks that do no work.** `start` is where the workflow starts. It carries two fields, edited in the detail pane like any other: the **goal** (what the workflow is for; required, the card's first line, `Goal [not set]` and a problem while it is empty) and the **args** (what it is run on; not shown on the card, and left empty the workflow takes no input). Every project has it, always as its first block: a new project opens with it, a project saved without one is given an empty one when it is read, and it is not in the add list. It is not deleted, does not move and becomes no other type, and nothing goes above it. `phase` is a titled group: it holds any block, has no knobs, and its blocks run one after the other where it stands, as if it were not there. It costs no nesting level (a container in a phase is drawn open as deep as it would be without it).

## When Claude starts a workflow

Conductor asks two questions, each with four answers and the two rows Claude Code adds (typed text, which Claude gets as your words, and `Chat about this`).

**Before Claude writes a workflow script: `Design this workflow in Conductor first?`**

- `Conductor`: Claude drafts a project, names it and shows it on the board, as `/conductor <description>` does (the splash while it works, then the blocks laid out). Nothing is written or run until you approve it there with `r`. If you say "run it" in chat instead, Claude is given the same hand-off.
- `Standard`: Claude writes the script and runs it as it would without Conductor.
- `Always Standard`, `Always Conductor`: the same, and the answer is kept; you are not asked again.

It is not asked for a project you handed off (that was your answer), from a subagent, or in a session with no screen.

**When a workflow that belongs to no project has started: `Visualize this run in Conductor?`**

- `Visualize`: Claude draws a project of the script that is running, under the workflow's own name, and the run shows on it. The run goes on meanwhile; the chat waits until you answer.
- `Skip`: the run is shown in the phase view only.
- `Always visualize`, `Never visualize`: the same, kept.

A project drawn this way ties its blocks to the script with `match`: the agent labels (or phase titles) a block stands for, each exact, or a prefix when it ends in `*`. The script is kept beside the project, as `.claude/workflow-conductor/<name>.workflow.js`.

A run whose workflow name is a saved project's name is that project's run: it is shown on the project with no question, whatever is stored for the second one. So the next run of a script you had visualized lands on its project.

`Ask again`, the last row of the start screen, forgets the kept answers to both questions.

## Watching a run

A run started from a project is laid over it:

- The header's right end says the run, always on the one row: `RUNNING · 5/9 agents done · 1 failed · 57.4k tokens · 4.5s`, in fewer words where the pane is narrow (the time goes first, then the tokens; the status stays).
- When it ends with failures the header says `FINISHED · … · 1 failed` and the selection goes to the first block that failed. The results stay on the graph until your first edit, or `c`.
- With the pane closed the status line names the block that is running: `wf 3/4 ▸ n3 review`.
- Each card's bottom border says its agents, at the left: `✓ 4/4 done · 10.2k`, `✗ 3/4 done · 1 failed · 20.4k` (ended well, of started; failures; tokens).
  A container sums what it holds, a collapsed one and a carousel included. `waiting` has no agent yet; `not run` never got one, and its card is dim.
- The selection follows the block that is running (the furthest along when several are), the graph scrolls
  with it and the view changes to one that draws it, until you move the selection yourself; from then on it stays where you put it.
- While the run is in progress editing is locked: the legend and the key hints show only the keys that still work (`w a s d`, `o`, `b`, `i`, `?`), a click only selects, opens or scrolls, the chips are gone, and the detail pane lists the selected block's agents under `Run` (twelve at most, failures first) in place of its fields.
- Agents whose label names no block of the project get one card after the project, `N agents no block claims`.
- `agents ≥ N` before a run is a floor, not an estimate: every agent block counts once, however often the project says it runs.

## How a project becomes a workflow

A project is a spec, not a program. `r` (Implement and Run) sends Claude the request and
gives it the project's goal (the start block's), the project
file's path and no more about the workflow: the project says what to build. Claude is told to confirm the design with you first
(what the workflow will do, and a question about any flow that is ambiguous or looks unintended) and to ask what to run it on,
unless you said so or the workflow takes no input; after your answer it writes a real Workflow script and runs it with the Workflow tool.
The hand-off reaches Claude as the answer of Conductor's `before_workflow` tool, which the request tells it to call first.
The one thing the hand-off adds is how the run is tied back to the board:

- Label: every `agent()` call is labelled `<nodeId>: <short text>`, with the id of the innermost project node it belongs to.
- Phase: each top-level node (the start block left out) is one phase titled `<nodeId> <title>`, listed in `meta.phases` in project order. A top-level `phase` block is such a node: its title names that part of the run.

The script the project was run as is kept beside it, `.claude/workflow-conductor/<name>.workflow.js`. Once a project has one, the hand-off tells Claude to update that file to match the project as it is now, changing only what the project changed, and to run it; blocks with `match` keep the script's own labels and phase titles. A run out of a hand-off replaces the kept script; a run that merely has the project's name gives a project its first script and never writes over one it has.

Projects are stored in the repo, one JSON file each: `.claude/workflow-conductor/<name>.json`.
The designer saves on every change.

## Run progress and its limits

Progress is derived from hooks, not from the workflow engine's own state:

- The Workflow tool call gives the run id, name and transcript folder.
- Each workflow agent spawn gives an agent and its label. The node id the label starts with maps it to a project node; without one, the block whose `match` names the label does, then the block whose `match` names the agent's phase title (an exact string before a prefix, the longest prefix first). Agents no block takes are counted on a card of their own after the project.
- Model requests and turn completions give tokens and the agent's end. The figure is the sum of input, output, cache-creation and cache-read tokens.
- Phases are read from the run's `journal.jsonl`.

Known limits:

- There is no run-end signal. A run is held finished after 8 seconds with no agent running and no new spawn; a later spawn for the same run reopens it. It is held failed only when an agent failed and none succeeded. An agent not heard from for 30 minutes is held failed, so its run can end.
- A replay does not start while a workflow is running or a handed-off project waits for its run: the message row says so.
- Phases rely on the journal file, an internal format that may change.
- A run belongs to the saved project its workflow is named as. A handoff also claims the first run under any other name that starts within 3 minutes of it, or of your last prompt while it waits. A run neither rule takes is shown in the phase view only, unless you have it visualized.
- One run is tracked at a time, and one graph is mounted at a time.
- Undo history is kept for the session only. It survives `/reload-plugins`; it is lost when the mod's code is reloaded after a change.
- Text is measured by code unit: a title with wide or combined characters misaligns its card.
- A very large graph (a drawing estimated past 70,000 characters) is drawn without colours.
- Replayed token counts are made up.

## Develop and check

The check:

```
claude plugin validate . && bunx tsc -p .
```

- The project writes and runs no tests. The files under `tests/` are stale (type errors there are known), and `bun run check` still runs them: use the two commands above.
- `src/` is pure logic (project model, run reducer and tracker, the graph's layout, paint and model, the key table); `hooks/` holds the hooks modules and the graph's surface module (`hooks/canvas.tsx`).
- `bun scripts/render-graph.ts --list` names the projects it can draw; `bun scripts/render-graph.ts research --cols 100 --rows 40 --select n5` prints the graph as the pane paints it, with no session (`--view`, `--scroll`, `--run`, `--ansi`: see the file's head). The examples in this README are its output.
- `scripts/dev-session.sh` starts a detached tmux session running Claude Code with the mod loaded (`CONDUCTOR_SESSION`, `CONDUCTOR_COLS`, `CONDUCTOR_ROWS`); the debug log goes to `.capture/debug.log`.
- `scripts/send.sh '/conductor' Enter` sends keys to it; `scripts/capture.sh` prints the screen and the mod's recent debug lines (also written to `.capture/`).
- The start screen's `Replay a run` rows exercise the run view and the overlay without running a workflow.
- `docs/SPEC.md` and `docs/API-NOTES.md` hold the design and what was learned about the mod API; `docs/redesign-v1/BRIEF.md` is the brief the current pane was built from.
