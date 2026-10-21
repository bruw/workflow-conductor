# API notes

Everything here was seen on Claude Code 2.1.296 to 2.1.299, terminal surface, fullscreen, inside tmux. Nothing was tried elsewhere.

## Workflow runs

### Agent spawns

- agent.spawn's description is exactly the workflow script's label.
- agent.spawn carries no agentId. The agentId is on what await next(e) resolves to: { model, agentId }.
- agent.spawn has no phase. e.workflow holds only runId and agentIndex.
- Every agent.spawn of a run carries the Workflow call's id as tool_use_id.
- The spawns of one parallel batch arrive out of order.
- The Workflow tool result arrives before the first agent.spawn, because the run goes on in the background.

### Turns and tokens

- A workflow agent raises one turn.complete with its agentId and the usage of its requests summed.
- The main loop's turn.complete has no agentId.
- turn.step is a streaming hook raised once per model request, the main loop's too. Its last chunk (kind stop) carries that request's usage.
- The workflow's token figure (the row, and subagent_tokens in the task notification) is, per agent, the four usage counts of its latest request summed: input, output, cache read and cache creation.
- That figure is the agent's context, not what it processed. Every request re-reads the whole prompt from the cache, so a sum over requests grows with their number.
- A workflow agent's own rows raise session.append with its agentId (door prompt, response, tool-result, attachment).
- Nothing is raised while a single tool call runs.

### The Workflow tool call

- A tool's input is flat on the tool.call event: e.script, not e.input.
- The Workflow result's fields are under r.result.
- A Workflow call carries script, name or scriptPath, each absent when not passed. scriptPath wins.
- After next(e), r.result.scriptPath holds the full script in all three forms, and workflowName is meta.name.
- The Workflow result carries taskId and taskType local_workflow.

### Transcript and journal

- transcriptDir is <projects>/<session id>/subagents/workflows/<runId>.
- $.fs reads it by absolute path with no permission prompt.
- journal.jsonl gets an agent's started line (label, phase) only once next(e) of its agent.spawn has resolved.
- agent-*.meta.json repeats that line as description and workflowPhase.
- The journal has no line for the end of a run.

### End of a run

- A run that completes or fails queues a task notification about 2 s after its last agent.
- session.append (door queue, agent main) is raised at once.
- prompt.submit (origin task-notification) and ui.render UserMessage (props.task: id, status, toolUseId, durationMs) are raised only once the main loop is idle. A held turn delays them until it ends.
- The notification's task id is the Workflow result's taskId. Its toolUseId is the Workflow call's.
- ui.render UserMessage is raised again for an old notification row whenever the transcript redraws it.
- The task's output file (the notification's output-file) is empty while the run goes on. It is written once at the end, with workflowProgress (per agent: state, attempt, tokens, toolCalls, durationMs) and logs.
- Neither the output file's path nor its format is in the types.

### Stopping a run

- A run stopped with TaskStop raises no notification.
- Its agents' turn.complete come at once with reason aborted.
- The journal and the task's output file stay as they were.

### What a mod cannot see

- $.agent.list() never lists a workflow's agents.
- There is no TaskOutput tool for $.tool.call.

## Module rules and validation

- validate refuses a telemetry.log hook on the anthropic stream. A hook with no to stands on that stream. It is for plugins built into the CLI.
- $.fs has no append.
- validate refuses $ passed to an imported function.
- The plugin directory checks $ beyond validate, and refuses things validate passes.
  - It follows $ into a top-level const arrow with a return type that takes values and retries by calling itself with $.
  - The same helper taking a function parameter and retrying through a closure that holds $ is not followed. This holds whether it is written as that arrow, as an untyped arrow or as a function declaration. Each call passing it $ is a finding.
  - Which of those two traits counts is not known.
  - As a typed arrow, that helper is also read as a hook the mod does not register.
- A tool.call matcher naming the mod's own tool type-checks only once .claude-plugin/types/claude-code-mcp/ lists it. That is written when a session reloads the mod with the tool registered.

## Hooks and the model

- A command.run answer's context starts no turn. It is read on the next prompt, where it outweighs what was typed.
- return { ...r, context: [...] } from a tool.call hook reaches the model.
- A { deny } from a tool.call hook reaches the model as the tool's error, and Claude treats instructions in it as untrusted.
- A tool description is cut at 4096 characters.
- session.compact fires before the compaction, and next(e) resolves after it.
  - trigger is manual, auto, plugin or precompute. precompute installs nothing.
  - Subagents compact too, with agentId set.

## Prompts, clock and store

- A prompt sent with $.prompt.submit skips the whole calling module (re-entry) and goes through every other plugin's hooks.
- $.prompt.submit cannot carry context.
- With asUser true it drops the frame that says the plugin sent a message.
- $.prompt.submit from a $.clock.after callback is accepted.
- $.store (get, set, delete, keys) is the plugin's own JSON store, kept between sessions, untyped, 4 MiB in all. This was read from the types and never run.

## The ask dialog ($.ui.ask)

- $.ui.ask works inside a tool.call hook mid-turn.
- Time inside a $ call is not on the hook's budget (174 s held).
- The dialog adds two rows of its own:
  - Type something: the free text comes back as the answer.
  - Chat about this.
  - So compare the answer with the labels exactly.
- Esc and Chat about this both reject with the same HooksError: <plugin>: $.ui.ask: no answer.
- A caught rejection does not end the turn.
- The ask is a nested tool.call of AskUserQuestion, and the module's other tool.call hooks see it. A catch-all must pass it through.
- An ask after await next(e) in the Workflow tool.call hook holds the turn while the run goes on. The model gets neither the tool result nor the run's completion notice until the person answers.
- Beside a docked pane the dialog is drawn in the transcript's 24 columns.

## Pane placement and the dock

- An open from a tool.call hook is unasked, even right after a yes in $.ui.ask.
  - It is placed from 144 columns.
  - Below that it waits (isPlaced false), the person sees nothing, and no ui.render is raised.
- A waiting pane seats itself when the terminal reaches 144 columns and stays when narrowed. Under 110 columns it goes inline.
- An open from the person's own command is placed at any width.
- An unasked open from a band drawing is placed from 112 columns, against 144 from a tool.call hook and in the types. This is not explained, so keep the isPlaced check.
- The dock's width is the person's once they dragged it (the dockColumns setting). The mod's columns is only a request.
- The docked pane's background is the engine's (theme token composerSidebarBackground) and no mod can remove it. Only a custom theme overrides it, with a concrete colour.
- The inline placement has no such background.
- Narrowing the terminal redraws a placed pane with placement inline.

## The band above the prompt

- A ui.render hook for component AbovePrompt is drawn at any width, unasked.
- bodyColumns is the terminal's columns less 5.
- maxRows is 6 at 24 rows and 15 at 40 rows. A taller tree is cut with ↓ n more.
- Beside a docked pane the band has 19 cells, and e.viewport.columns is the transcript column's 24, not the terminal's.
- An inline pane and the band share the bottom slot. The band's maxRows then falls from 6 to 2 or 3.
- Collapsed by the person (ctrl+x ctrl+a), the band draws nothing of the mod's and a Client's ticks stop.
- A resize redraws the band.
- In the band, $.clock.every(33) with $.ui.invalidate('ui.render') gives 30 drawings a second. A Client's surface.every(33) gives 21 Hz.
- A band Button's digit hotkey fires from an empty prompt with no focus.
- A band Button's letter hotkey needs the band to hold the keys (ctrl+x tab or a click).
- $.ui.open({ focus: true }) from a band Button's onPress places the pane but does not give it the keys.
- An open from a band press counts as the person's and is placed at any width. With no columns asked, the dock leaves the transcript 24 cells.

## Input fields

### Keys

- A focused Input gets every printable key, with its case, as a ui.input change.
- Enter is a submit.
- A burst of keys is one change.
- A Button's hotkey does not fire while the ring is on an Input.
- Up and Down on an Input walk the ring. Left, Right and Backspace stay in the field.
- A key typed in the frame an Input is drawn under a new key is dropped.

### Value and text

- Answering { element, value: '' } to ui.input does not empty the field.
- Drawing the Input under a new key does empty it. The ring stays, kept by the Input's place among the stops.
- A reused Input key brings back its old text, also from before a reload of the module.
- An Input opened again under the key it last submitted from, with the same value, is drawn empty.
- Changing value under a focused Input replaces its text and leaves the cursor where it was.

### Hidden and clipped Inputs

- An Input under a Box with display none stays a focus stop and takes keys, with the terminal's cursor hidden.
- An Input pushed off-screen or clipped still shows its cursor, clamped to the edge.

### Wrapping and labels

- An Input without the ring is always one line, cut with ….
- With the ring it wraps only when its box spans the pane's full width. A narrower width, a sibling in the row, padding, a border or an absolute box keep it to one line.
- An Input's label is drawn as Label: and wrapped rows hang under the text's first cell. So a label of N spaces makes a wrapping column.
- The wrap width is the cells from the text's first cell to the pane's edge, less 4.
- Under a label of spaces, an Input without the ring is drawn broken.
- Moved between two parents under the same key, an Input keeps its text, its cursor and the ring.
- A placeholder never wraps. When it is longer than the room, it squeezes the label and moves the field's first cell left.
- In a row, a Text before an Input is squeezed to nothing by a long value, unless the Text is in a box with a width and flexShrink 0.

## Focus, keys and buttons

- A Button hotkey is one lowercase letter or digit. It cannot see Shift, and ui.press carries no key.
- Stop order is tree order. The pane's own ✕ stop sits before the mod's first.
- A ui.focus hook cannot tell Up and Down from Shift+Tab and Tab, only where the move landed.
- A ui.focus raised by the person for a stop that names no element cannot be given one with next({ ...e, element }).
- A ui.focus hook may answer { deny } without next. The ring then stays and no stop is lit. A move that lands and is moved back lights the stop for a frame.
- The Left arrow on a Button is the engine's (← for agents): the conversation goes to the background, the pane goes and the debug log stops. On an Input, Left stays in the field.

## Mouse and Clients

- SGR mouse sequences sent with tmux send-keys -l reach a Client (down, move, up, hover) in 1-based screen cells.
- One event is taken per frame, so space them 0.3 s apart.
- A click gives the Client the keyboard. Text sent after it arrives as one key event holding the whole string.
- Escape gives the keys back to the prompt and leaves the pane open.
- A clicked Client gets keys such as { key: 'W', shift: true }, arrows, tab and return.
- Nothing focuses a Client without a click, and nothing tells it when it loses the keys.
- A click on a row is a ui.press, not a ui.focus.
- ui.scroll is raised for the wheel even when the tree fits, with e.pointer.row and e.pointer.column.
- Answering {} to ui.scroll without next keeps the pane still.
- One tmux wheel tick scrolls by 3, up or down.
- A Client gets no wheel events.
- surface.every is quantized to 16 ms frames and rounds up: 33 gives 48, 100 gives 112. Ask for multiples of 16.

## Layout and drawing

- backgroundColor takes a theme key, including one outside ThemeKey.
- A cell has no alpha.
- A column with marginTop below zero inside overflow hidden is drawn moved up, with its first rows cut.
- A sibling drawn later with position absolute paints over what is under it, and a Client there takes its presses.
- A Select lists its options under itself, so its row must not have a fixed height.

## Reloads and the dev loop

- An idle session polls a --plugin-dir mod every 30 s. /reload-plugins forces the reload.
- A reload restarts the module and remounts the Client.
- A reload raises session.start again, so tools registered there are registered again.
- A reload can give the Client one frame of props in the old shape.
- tmux send-keys with text and Enter in one call can leave the text unsubmitted. Send the text, wait a second, then send Enter.

## How Claude picks tools

- Claude does not find a deferred mod tool from a plain workflow request (0 of 2).
- Named in hidden context, a deferred mod tool is loaded and called, but only when Claude is heading for Workflow (2 of 3).
- A non-deferred tool whose description says to call it before authoring or running any Workflow script is the turn's first call (3 of 3), ahead of the workflow-authoring skill.
- A request for one subagent does not trigger that tool.
- A request to orchestrate subagents without the word workflow starts real Agent subagents, not a Workflow.
