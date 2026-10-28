![Conductor in Claude Code: open the board, build a workflow by keys and mouse, watch the run on the graph, minimize it](https://github.com/bruw/workflow-conductor/releases/download/media/conductor-demo-v7.gif)

# Conductor - visual workflow planner in Claude Code

A terminal UI for planning, running and understanding complex agent workflows inside Claude Code.
 
Don't hope that Claude one-shots your multi-step logic from a loosely worded description. 

Try **design → review → run** instead.


```
/plugin install workflow-conductor --marketplace bruw/workflow-conductor
/conductor
# make sure you're in a large terminal window
```
 
Conductor has Claude draw a **visual plan** that thinks through the workflow step by step. You can read it in ten seconds and check the logic before Claude writes the script.
 
A plan costs about as much as Plan mode, and it can save **a lot of tokens** compared with a workflow done badly.


## What
 
- **Design:** Draw it yourself, start from a template, or let Claude draft it from a description and refine it in plain words.
- **Check:** Common design mistakes are flagged on the graph before you run. Flags are warnings, not blocks: you can run anyway. It's your money.
- **Run:** Claude implements the spec as a Workflow script and runs it.
- **Monitor:** Progress, failures and token cost show up on the plan you made.
- **Learn:** Block kinds are named multi-agent patterns, and you can compare each design with the script it produced. That makes Conductor a practical way to learn how good workflows are built.


## How
Type `/conductor review this PR thoroughly`. Claude drafts this and puts it on the board:

```
╭───────────────────────────────────────────────────────────────────── n6 ─╮
│ START                                                                    │
│ Review the current diff along several dimensions and keep only findings… │
╰──────────────────────────────────────────────────────────────────────────╯
                                     ↓  [+]
╭───────────────────────────────────────────────────────────────────── n1 ─╮
│ AGENT scout / scout diff                                             low │
│ Cheap and mechanical. Its list of dimensions is the work-list for the p… │
╰──────────────────────────────────────────────────────────────────────────╯
                                     ↓  [+]
┌╴ PIPELINE / review · once per: ×4 dimensions ╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴ n2 ╴┐
╎ ╭───────────────────────────────────────────────────────────────── n3 ─╮ ╎
╎ │ AGENT / review                                                       │ ╎
╎ │ One reviewer per dimension.                                          │ ╎
╎ ╰──────────────────────────────────────────────────────────────────────╯ ╎
╎                                    ↓  [+]                                ╎
╎ ╭───────────────────────────────────────────────────────────────── n4 ─╮ ╎
╎ │ AGENT verify / verify findings                                       │ ╎
╎ │ 3 votes: each skeptic tries to refute a finding and defaults to ref… │ ╎
╎ ╰──────────────────────────────────────────────────────────────────────╯ ╎
└╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴ [+] ╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴┘
                                 all ⇓  [+]
╭───────────────────────────────────────────────────────────────────── n5 ─╮
│ AGENT merge                                                              │
│ Runs once over all surviving findings: merge duplicates, order by sever… │
╰──────────────────────────────────────────────────────────────────────────╯
```

Edit it directly in the UI, or ask Claude to edit it for you.
 
Then press `r` to script and run. Claude asks only about what is unresolved, states the plan with its worst-case cost, writes a real Workflow script from the project, and runs it. The board becomes the run:

```
╭───────────────────────────────────────────────────────────────────── n1 ─╮
│ AGENT scout / scout diff                                             low │
│ Cheap and mechanical. Its list of dimensions is the work-list for the p… │
╰─ ✗ 3/4 done · 1 failed · 20.4k ──────────────────────────────────────────╯
                                     ↓
┌╴ PIPELINE / review · once per: ×4 dimensions ╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴ n2 ╴┐
╎ ╭───────────────────────────────────────────────────────────────── n3 ─╮ ╎
╎ │ AGENT / review                                                       │ ╎
╎ │ One reviewer per dimension.                                          │ ╎
╎ ╰─ ✓ 4/4 done · 30.6k ─────────────────────────────────────────────────╯ ╎
╎                                    ↓                                     ╎
╎ ╭───────────────────────────────────────────────────────────────── n4 ─╮ ╎
╎ │ AGENT verify / verify findings                                       │ ╎
╎ │ 3 votes: each skeptic tries to refute a finding and defaults to ref… │ ╎
╎ ╰─ ✓ 4/4 done · 40.8k ─────────────────────────────────────────────────╯ ╎
└╴ ✓ 8/8 done · 71.4k ╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴┘
                                 all ⇓
╭───────────────────────────────────────────────────────────────────── n5 ─╮
│ AGENT merge                                                              │
│ Runs once over all surviving findings: merge duplicates, order by sever… │
╰─ · not run ──────────────────────────────────────────────────────────────╯
```


## Cost

Workflow script estimates, in tokens.

| Flow | Design | Hand-off (`r`) |
| --- | --- | --- |
| Draw it yourself, press `r` | ~0k: the board makes no Claude calls | ~10–20k, what Claude spends writing any Workflow script, but from a full spec |
| `/conductor <description…>`, press `r` | ~5–15k for the draft, like Plan mode | ~10–20k |
| Draft, `q` for a review, fix, press `r` | ~10–25k, like Plan mode plus a round of refinement | ~10–20k |

## The parts

There are eight blocks:
 
- **Work:** `agent`, `code`, `subworkflow`
- **Containers:** `pipeline`, `parallel`, `loop`, `branch`
- **Goal:** `start`

Each block comes in several kinds. A kind is a common pattern that prefills the block's logic field:

| Block | Kinds |
| --- | --- |
| agent | task · scout · check · verify · judge · critic · merge · classify |
| loop | custom · count · pass · dry · converged · target · budget |
| parallel | arms · each · sweep · attempts |
| branch | if-else · guard · route |

Four templates to start from (`Review`, `Research`, `Migrate`, `Judge panel`), or a blank board.

## Getting around

Conductor supports full mouse and keyboard navigation.

| | |
| --- | --- |
| `/conductor` | the board: the live run, else the last project, else the start screen |
| `/conductor <description…>` | Claude drafts a new project from your words |
| `/conductor min` · `max` | fold the designer away, bring it back |

| Key | Does |
| --- | --- |
| `w` `a` `s` `d` | move the selection; with Shift, move the block |
| `Enter` | edit the block's fields |
| `n` `x` `t` | add a block, delete it, change its type or kind |
| `1` `2` | step the model, the effort |
| `o` `b` | open a container as the view, back up a level |
| `u` `y` | undo, redo: fifty steps a project |
| `r` | implement and run |
| `q` | ask Claude to review the design |
| `p` | projects and templates |
| `f` | write the board over a project file that is no longer valid |
| `?` | every other key, and the mouse |


## Requirements

- Claude Code 2.1.296 or later, with the Workflow tool.
- A terminal 110 columns wide, in the fullscreen layout. Narrower than that, you get the compact strip and no designer; widen it and the designer opens by itself.
- Fullscreen for the mouse. The keys work without it.

## Develop

It's MIT-licensed, so feel free to change it to fit your needs.

```
claude --plugin-dir /path/to/conductor
```

In the desktop app, where no flag can be given, the `env` of your user settings takes it:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/conductor" } }
```

- `bun install`, then `bun run check`: the plugin validation, `tsc` and the tests.
- `bun scripts/render-graph.ts --list` names what it can draw, and draws it with no session.
- `scripts/dev-session.sh` starts Claude Code with the mod in tmux; `scripts/send.sh` sends it keys, `scripts/capture.sh` prints the screen and the debug lines.
- `src/` is pure logic; `hooks/` is what Claude Code loads.

## What it touches

Conductor makes no network requests, runs no program, and reads no settings or credentials.

**Files it writes.** Only under the session's root, and `<name>` is always kebab-case:

- `.claude/workflow-conductor/<name>.json`: the project, on every save.
- `.claude/workflows/<name>.js`: a copy of the script a run ran, only when you answer `Save to repo` after the run. The Workflow tool runs it by name.

It never writes any other file: not settings, `CLAUDE.md`, build or start-up files, and nothing another tool runs. It never deletes or renames a file: to remove or rename a project, remove or rename its files.

**Prompts it submits.** Two fixed sentences, sent to your own session:

- `r`: `Implement and run the "<name>" workflow project (Conductor hands it off: call mcp__workflow-conductor__before_workflow first).`
- `/conductor <description>`: `Draft a workflow project: <description>`, your own words.

`q` and the draft key only put a sentence in the prompt box for you to send. No file content or conversation text ever goes into a prompt it submits: only the project name, or your own words. It reads the prompt box only to see whether it is empty.

**Tools it adds.** Two of its own; it answers each call itself and never answers another tool's call:

- `mcp__workflow-conductor__before_workflow`: Claude calls it before writing or running a Workflow script. Conductor asks whether to design on the board first and answers with your choice. Subagents and `-p` runs get the standard answer without a question.
- `mcp__workflow-conductor__project`: Claude calls it to read and edit a project (`read`, `apply`, `write`, `attach`). The project's goal, blocks and file paths reach Claude this way, and in notes on the prompts you send while the board is open.

**Claude's own tools.** `Write`, `Edit` and `Workflow` calls pass through unchanged, except:

- A write or edit of a project file refreshes the board; while that project is running it is refused.
- A started `Workflow` run is tracked on the board. One no project claims gets a single question: a yes, or what you type instead, is added to the tool's result as a note to Claude.

**Hooks it holds.** Only these, and only to draw the board and the run:

- `/conductor`: opens the board or the run view, folds or expands the designer, or starts a draft. No other command.
- Subagent starts, model requests, turn ends: reads a workflow agent's id and label, its token usage and how its turn ended, and passes each on unchanged. It never reads a prompt, instruction or tool description here. The save question is asked when Claude's own turn ends after a run.
- The prompt box: while the board is taking the keyboard back, one letter typed into the empty box goes to the board as a key.
- Prompts you send: each is read for the hand-off sentence, and a note of board changes Claude has not seen is added as context.
- Run ends (`TaskStop`, the task-notification row): reads which run was stopped or ended.
- Compact, clear, resume: resets what Claude was told.
