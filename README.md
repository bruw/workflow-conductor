# Conductor

There's a thing that happens when you ask Claude for a workflow. It writes two hundred lines of orchestration, tells you it'll start nine agents, and asks if that's all right. You say yes. Most everybody says yes. Nobody reads the script.

Then the agents go off somewhere you can't see, and you sit watching a counter, hoping that what's burning your tokens is the thing you meant.

Conductor is a Claude Code mod for people who got tired of hoping. The workflow is a graph, in a pane beside your transcript. You draw it, or you tell Claude to and fix what it got wrong. One key hands it over. The run comes back onto the same graph, block by block, so you know which agent failed, where, and what it cost you.

```
/plugin install conductor --marketplace bruw/workflow-conductor
```

## What you get

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

You can read that in ten seconds. That's the whole point of it.

Don't like it? Say so, in plain words: *"add a verify with 3 votes after n3"*, *"set this block to low effort"*. Or do it by hand: `n` adds a block, `x` deletes one, `1` and `2` step the model and the effort, `u` takes back anything, Claude's edits included.

Then press `r`. Claude confirms the design, asks what to run it on, writes a real Workflow script from the project, and runs it. The board becomes the run:

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

(Both drawings are `bun scripts/render-graph.ts review --cols 76 --rows 30`, the second with `--run`; its figures are made up.)

## Why a man might want it

- **You approve a design, not a script.** `agents ≥ 12` sits in the header before a single token is spent. It's a floor, and it says so.
- **The project is a file in your repo.** `.claude/workflow-conductor/<name>.json`, with the script it was last run as beside it. It diffs. It reviews. The next run changes only what the project changed.
- **It tells you what's wrong and stops nobody.** A loop with no stop condition, a verify with nothing to check, a branch arm with no condition: each gets a ` ! ` on its card. You can run it anyway. It's your money.
- **It works on runs you never designed.** When Claude starts a workflow on its own, Conductor asks once whether to draw it. Say yes and the run shows up on a graph of the script that's already running.
- **It gets out of the way.** `m` folds the designer into a strip above the prompt: the project, a progress bar, the tokens. `m` again brings it back.

## The parts

Nine blocks, the same ones a workflow script is written in. Three do work: `agent`, `code`, `subworkflow`. Five hold other blocks: `pipeline`, `parallel`, `loop`, `branch`, `phase`. And `start`, which carries the goal.

A pattern is a **kind** of a block, and picking one fills in what the pattern needs:

| Block | Kinds |
| --- | --- |
| agent | task · scout · check · verify · judge · critic · merge · classify |
| loop | custom · count · pass · dry · converged · target · budget |
| parallel | arms · each · sweep · attempts |
| branch | if-else · guard · route |

Four templates to start from (`Review`, `Research`, `Migrate`, `Judge panel`), or a blank board.

## Getting around

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
| `?` | every other key, and the mouse |

The mouse works too: click to select, drag the selected card to move it, wheel to scroll.

Two things a man learns his first day. Escape always gives the keyboard back to the prompt, and no mod can stop it; whatever you had typed in a field is saved, and `u` undoes it. And `←` outside a text field belongs to Claude Code: it'll take you to the agents list. `/conductor` brings you home.

## What you need

- Claude Code 2.1.296 or later, with the Workflow tool.
- A terminal 110 columns wide, in the fullscreen layout. Narrower than that, you get the compact strip and no designer; widen it and the designer opens by itself.
- Fullscreen for the mouse. The keys work without it.

## What it won't do

I'd be lying if I told you it knew everything.

- **The project is a spec, not a program.** Claude writes the script from it. The structure holds; the details vary between runs.
- **Nobody tells Conductor a run is over.** It calls one finished after 8 quiet seconds, and reopens it if another agent turns up. Progress is pieced together from hooks, not from the engine.
- **One run at a time, one graph at a time.**
- **Phases come from the run's `journal.jsonl`**, an internal format that may change.
- **Undo lasts the session.** It isn't saved with the project.
- **Wide and combined characters** in a title misalign its card.

## Working on it

```
claude --plugin-dir /path/to/conductor
```

In the desktop app, where no flag can be given, `~/.claude/settings.json` takes it:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/conductor" } }
```

- `bun install`, then `bun run check`: the plugin validation, `tsc` and the tests.
- `bun scripts/render-graph.ts --list` names what it can draw, and draws it with no session.
- `scripts/dev-session.sh` starts Claude Code with the mod in tmux; `scripts/send.sh` sends it keys, `scripts/capture.sh` prints the screen and the debug lines.
- `src/` is pure logic; `hooks/` is what Claude Code loads.

MIT. Get busy designing.
