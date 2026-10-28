# Conductor spec

Claude Code mod: design a workflow as a graph of blocks, hand the project to Claude to implement as a `Workflow` script, watch the run on the same graph.

## Paradigm

- The project is a **spec, not a program**: JSON plus free text. Claude reads it and writes the real script. There is no JSON → JS compiler and no JS → JSON import.
- **No field is mined.** `oncePer`, a stop condition, the votes in a logic are words for Claude; nothing parses them for a count or a meaning. Lints go by type, kind and whether a field is empty. The two places that do read text are wiring: the node id at the start of an agent's label, and the hand-off sentence.
- A pattern is a **kind** of the block it is made of, never a block type of its own; a kind adds presets (filled knobs, a filled logic, starter blocks, hints), never a field. A pattern that spans several blocks is a template.
- Text the person reads says "block" and "problem"; prose Claude is sent says "block" and "lint"; identifiers and schema fields say "node".

## Layout

```
hooks/register.tsx     composes the three below over one shared tracker
hooks/run.tsx          run hooks (Workflow and TaskStop tool.call, agent.spawn, turn.step, turn.complete, UserMessage ui.render), the save question, the run view pane
hooks/project.tsx      the designer: /conductor, the screen, the key catcher and ring, saving, the project tool, the band
hooks/offer.tsx        the before_workflow tool and its question
hooks/canvas.tsx       Client: draws the graph from props, posts pointer messages
hooks/splash.tsx       Client: the splash and the draft's waiting scene
src/run/               events (types) · reducer (events → RunState, label → block) · tracker (which run is whose, timers, run end)
                       journal (on-disk journal → events, phases, usage) · replay (events from a fixture or a project)
src/project/           model (types, parse, serialize) · ops (add, move, update, retype, remove) · lints (problems, preflight)
                       teach (per type and kind: hints, cards, fields, presets, palette) · templates
                       session (ProjectUi and every step on it, the view, graph props, help pages, start screen)
                       chat (the project tool: schema, description, ops, reports, change notes, briefs)
                       handoff (the hand-off text and prompts) · offer (every question's words and results) · history (undo)
src/ui/                graph-layout (project → cells, hit tests, navigation walks) · graph-paint (layout → styled spans, run overlay)
                       graph-model (Client props, messages, reducer) · keys (the one key table, legends) · compact (the band's view)
                       rail (run view rows, status text) · text · theme · tween · persona · wordmark
types/index.d.ts       the $.state contract; cannot import, so it re-declares the run and project shapes (tsc catches drift)
fixtures/              recorded runs, as generated .ts modules (the test runner refuses node:fs and non-code imports)
scripts/render-graph.ts  layout + paint as text with no session (--list names the cases)
```

- `src/` is pure TypeScript: no `$`, no engine imports beyond types. Everything decidable without the engine lives there; hooks call it.
- `$` may not be passed to an imported function (validate refuses it). Hence `hooks/project.tsx` is one large module, atoms are declared again in each hooks file, and cross-module calls that need `$` are closures built in `session.start` (`runBoardOf`, `setOfferBoard`).
- One unmatched hook per event per plugin: `run.tsx` holds the unmatched `session.start`, the others use always-true matchers.

## Project file

`.claude/workflow-conductor/<name>.json`, and no script beside it: Claude passes the script inline.

- Ids `n<k>` are never reused: `nextId` only grows, also across undo.
- Exactly one `start` block, first at the top level; it cannot be added, moved, removed or retyped. It alone carries `goal` and `args`; a project with nothing else is blank, which is what "empty" means everywhere.
- `parseProject` refuses any key, knob, type or kind it does not know, so nothing is read and then erased by the next save; the one exception is a `prompt` knob, whose text is read into the block's logic. Every edit, whoever made it, is serialized and parsed back before it counts.
- The plain kind of a type is never stored.
- `match` (labels or phase titles; a trailing `*` is a prefix) ties a block to a script that existed before the project.
- `replay-*` projects live in state only: never written, listed or handed off.
- A template is saved by its first edit or by a hand-off, not by opening it.
- A save first reads the file: where it is no longer what this session last read or wrote (another session sharing the root saved it), nothing is written, the board takes the file, and an edit Claude makes from an older read is denied until it reads the project again. On the board, one undo brings back the person's version with the refused edit made on it, and saves that; text typed in a field stays in it, to be sent onto the other session's. Where the file holds no valid project, nothing is written over it: the board keeps the edit, unsaved, each save tries again, and `f` writes the board over the file; Claude's edits are denied until the file is fixed.

## A run and its project

**Events.** `tool.call` on `Workflow` gives `runId`, `taskId`, `transcriptDir`, `scriptPath`, `workflowName`, before the first spawn. `agent.spawn` gives the label (`description`); the `agentId` is what `next(e)` resolves to. Phase is on no event: it is read from `journal.jsonl` under `transcriptDir` once the spawn has resolved. An agent's tokens are its latest request's four usage counts, live from the `stop` chunks of `turn.step`, as the built-in workflow row shows them. The on-disk files are internal: parse defensively, never throw on an unknown line.

**Run end is the engine's notice.** A run ends when the transcript draws the task notification for its `taskId` (`ui.render` of `UserMessage`, `props.task`): `completed` is `done`, `killed` is `stopped`, any other word `failed`; its `durationMs` is the run's time. The notice comes once the main loop is idle, so a run may show no agent running for a while before it ends. A stopped run gets no notice: a `TaskStop` of its task stops it, and so does `STOPPED_MS` with no agent running where every agent ended since the last spawn was aborted (the workflow view's stop); a later notice still says how it ended. Agents still open at the end take their `result` line in the journal, else fail. An agent silent for `STALE_MS` is held failed.

**Label → block** (`nodeOf`): the id at the start of the label (`n3: verify auth`), else the block whose `match` names the label, else the one whose `match` names the phase title (exact before prefix, longest prefix, project order). None: `unmapped`, drawn as one card after the project.

**Which project a run is** (`tracker.ts`):
- By name: a run whose `workflowName` is a saved project is that project's, with or without a handoff.
- By handoff: a handoff claims the next run under any other name for `HANDOFF_MS`; each prompt the person sends while it waits restarts the wait.
- Otherwise the run is nobody's: the Visualize question, and on yes Claude mirrors the script into a project with one `attach` call, after which the agents seen so far are placed again (`remap`).
- A run out of a handoff, or one `attach` drew the project of, is the project's last run: a module variable keeps its script's path for the next handoff to start from, with its run id and `transcriptDir`, until `/clear` or a resume, since a resume works only in the session that ran it. Nothing is persisted: in a later session the handoff starts from the saved copy, where there is one. A run that only has the project's name is the last run only where no script is remembered or the one remembered is gone.

**Where the script lives.** The Workflow tool keeps every run's script in the session folder (`<session>/workflows/scripts/<name>-<runId>.js`), which Claude Code clears after `cleanupPeriodDays`: that is the default. Saved, it is `.claude/workflows/<name>.js` under the session root, Claude Code's own folder of saved workflows, where every `*.js` runs by its `meta.name` with `Workflow({ name })`, Conductor or not (Claude Code reads that folder once and only its own save refreshes it, so a copy the mod writes runs by name after `/reload-plugins` or in a new session); such a run is the project's by name like any other. A handoff starts from the newer of the two by mtime (a copy can be changed by hand or pulled); Claude reads it and leaves the file as it is.

**The save question.** A run that ended `done`, of a saved project, started by the main conversation, with a surface to ask on, and whose script is not already the saved copy, asks `Save to repo` / `Not now` (worded as an update where a copy differs). It is asked at the main loop's next `turn.complete` after the end, from a clock callback: the notice starts or joins a turn in which Claude answers it, and the question waits for that turn rather than holding it. On yes the mod writes the copy itself with `$.fs.write`, so none of Claude's tools writes under `.claude/`; a failed read or write is a toast.

**On the board.** Run state overlays the project and locks editing while it runs (selection, views, help still work). The selection follows the running block until the person moves it; at the end it goes to the first failed block. Results stay until the first edit or `c`. Elapsed times are stamped into an atom by run.tsx: a drawing that reads the clock is invalidated by it.

## What Claude is sent

**The project tool** (`mcp__workflow-conductor__project`, deferred, so every brief names it in full): `read`, `apply` (ops, all or nothing), `write` (the whole tree; a block whose id existed keeps it, every other gets a fresh one), `attach` (a `write` for the run tracked now). It edits the mod's atoms, so the pane redraws from state. Claude reads the whole input and report; the transcript draws one line for the call and one for its result (`callLine`, `resultLine`, which reads back the report's own words). The engine stores the result as the text Claude read, so the result row is a rewrite of that text, except on an errored row, which draws the engine's own error text whatever `output` says, so the hook draws that line itself. The description is generated from `teach.ts` and must stay under the engine's cut at 4096 characters: what belongs to one field is said on that field in the schema.

**Claude edits the board as it is.** `revisions[name]` counts every change; an edit from an older revision is denied. After a change by hand the next prompt carries a note of what differs from the project Claude last saw (`changedNote`), which counts as a read; with no snapshot, `staleNote` says to read. The snapshot is kept only while Claude holds the project whole: an edit that stored text Claude never saw (a kind's fill), a compaction, `/clear` or a resume drop it. A `write` over an unread project that has blocks is denied. A deny states a reason, never an instruction: Claude does not take instructions from a refusal.

**Write/Edit on a project file** is followed: after it lands the open project is parsed again; invalid, the last good one stays.

**The hand-off** (`buildHandoff`): the goal, the project file, the script to pass inline (written from the project, or the latest script, the last run's or the saved copy, changed only where the project changed), that run's id and journal where it was in this session, one line per kind the project uses (`KIND_TEACH[kind].script`: the Workflow reference's pattern name and what it leaves out), that work sent back reaches its agents in full, to ask only what is unresolved (the run input where `args` is set, a flow that looks ambiguous) and otherwise to say what it will do with its worst-case agent count and wall-clock and run it, and the three rules that tie a run to the board: every `agent()` label is `<nodeId>: <text>`, one phase per top-level block titled `<nodeId> <name>`, `meta.name` is the project's name. With a script, blocks with `match` keep the script's labels.

**How it gets there.** `r` saves, tells the tracker, and submits the hand-off sentence itself. The mod's own prompt skips its own hooks and carries no context, so the sentence tells Claude to call `before_workflow`, which answers with the hand-off once. A sentence the person sends goes through the `prompt.submit` hook instead, which makes the same hand-off, so `before_workflow` answers with it.

**The offer** (`mcp__workflow-conductor__before_workflow`, not deferred: Claude calls a tool before a workflow only when its description is in every turn). It asks whether to design in Conductor first, every time. No dialog, answer Standard: a subagent, no surface, a handoff waiting for its run. After a Conductor draft and until it is handed off, a call answers that the project waits unapproved.

**Draft** (`/conductor <words>`): the brief goes as the command's context, the prompt is submitted from a clock callback (refused inside `command.run`), Claude names the project in one `write`. The pane shows a waiting scene, then lays the blocks out a few per beat on its own, locked, until the turn ends.

## The designer

One screen: header (name as the project list's button, state; the legend on its second row), the graph and the detail pane side by side, a rule that holds what was just said, a last row of buttons. With no room for it (`fitsFull`) the pane draws nothing and the compact view takes the band above the prompt.

**State.** `ProjectUi` in `$.state` is the single source of truth for selection, view, picker, help, carousels. The Client keeps only pan, a drag in flight, hover and motion. What a keystroke must not redraw is a module variable in `hooks/project.tsx`: typed drafts, the ring's bookkeeping, undo histories, revisions, snapshots. Module variables survive `/reload-plugins` only while the source is unchanged.

**Keyboard.** A Button's hotkey cannot see Shift and a Client cannot be focused without a click, so the ring rests on one hidden `Input`, the **catcher**, first focus stop of the frame; what is typed into it is read as keys through `KEY_OPS` and applied one at a time on the state the last one left.
- The ring is kept by its place among the stops, not by key, and moves with no event when the stops before it change: `settleRing` puts it back whenever a drawing's stops differ.
- The ring rests on Inputs alone: on a Button the Left arrow is the engine's and takes the pane away. A move of the person's onto any other stop is followed at once by the mod's own move back to the catcher.
- A hook cannot tell an arrow from Tab, only where the move landed: lists read "landed on a row" as Down and anything else as Up, then put the ring back.
- An Input is emptied only by drawing it under a new key, and a key typed in that frame is dropped; so the catcher is re-keyed only when long and idle, and keys carry a per-load stamp because a reused key brings back old text.
- **The Client never keeps the keyboard.** Every pointer release posts one message and the hook retakes the keys for the pane. Where the engine refuses (the prompt box holds text), `handed` is set and keys do nothing but say so.
- No call moves the keyboard to the prompt: `r` and `q` close the pane and open it again without focus.
- While the pane is not focused the legend is dim and the cue says where input goes; the pane never names a key that would go to the prompt.

**Typed text is never dropped.** Drafts are flushed as one undoable edit before anything else acts, on every way out of a field a hook hears of, and by a drawing that finds the field can no longer be typed in. So Escape saves. An open field is drawn with the text it opened with for as long as it is typed in: changing `value` under a focused Input leaves the cursor where it was.

**Undo.** Every change goes through one choke point that records `{ project, what }` per project name and announces `what`; an edit that changes nothing records nothing. Edits by Claude and by file are in the same history.

**The graph.** Top to bottom only. Chains (top level, `pipeline`, `loop`) list blocks one under the other; stacks (`parallel`, `branch`) stand arms side by side, with a carousel when they do not fit. The border says the flow: solid leaf, dashed chain, dotted stack, heavy when selected. Containers too deep or too narrow are drawn collapsed; `o` opens one as the view and the person's keys never leave the view. An arrow is a barrier (`⇓`) after a pipeline or a parallel, else a stream. The hooks module lays out the same props as the Client to navigate over what is drawn. Drawn by cell as rows of spans; while a run is drawn the graph is in theme grays and only the run keeps its colours (and `claude`, what can be pressed); past `WEIGHT_MAX` the paint drops colours to stay under the engine's tree limit. No wheel reaches a Client: `ui.scroll` on the pane is summed and passed down as a prop.

**The detail pane** shows the selected block's fields (the type's, the same for every kind), the add / retype list, a help page, or the start screen's list. `model` and `effort` are stepped by `1` `2` on the card; `isolation` and `agentType` are Claude's to set and shown read-only.

**Compact view** (`$.state` `shell`): `m` (only while a workflow runs, or a replay is on the board) or a pane with no room minimizes into the band; any drawing of a placed pane with room ends it, so no way of opening the pane needs to know of it. The band is one row: the project, then its plan as a strip of step titles (containers open into their blocks, parallel and branch arms in parentheses) with the run's marks on them, centred on the current step and cut off at the edges, or with no run why the designer is not on screen; and Expand. The native workflow bar under the prompt has the counts, the tokens and the time, so the strip does not.

**`/conductor`**: bare is the run in progress, else the project last opened, else the start screen; `min` / `max` move the designer; any other words are a draft. Everything else (projects, replays) is on the start screen.

## Not exercised

The desktop surface; the main screen outside fullscreen; clicks on the band and on the last row's buttons; a session resume; a retry of a failed script after the handoff's claim is spent.

## Known and accepted

- Known block ids are not restored if the plugin reloads mid-run.
- A prompt queued mid-turn marks the change note as seen early.
- After `/clear`, an `attach` to the run still shown is refused.
- The turn is held while the Visualize dialog is up.
- A project file changed outside Claude's tools is not followed until this session's next save, which shows it in place of the edit.
