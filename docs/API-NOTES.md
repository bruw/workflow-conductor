All seen on Claude Code 2.1.296, terminal surface, fullscreen, inside tmux; nothing here was tried elsewhere.
agent.spawn's description is the workflow script's label, exactly.
agentId is not on agent.spawn: it is on what await next(e) resolves to ({ model, agentId }).
agent.spawn has no phase: e.workflow holds only runId and agentIndex.
The spawns of one parallel batch arrive out of order.
A workflow agent raises one turn.complete with its agentId and usage; the main loop's turn.complete has no agentId.
The engine's token figure is the sum of all four usage counts: input, output, cache read, cache creation.
turn.step is a streaming hook raised per model request, main loop too; its last chunk (kind stop) carries that request's usage, so the stops summed per agentId are a live total.
A tool's input is flat on the tool.call event (e.script, no e.input); the Workflow result's fields are under r.result.
The Workflow tool result arrives before the first agent.spawn: the run is in the background.
transcriptDir is <projects>/<session id>/subagents/workflows/<runId>; $.fs reads it by absolute path with no permission prompt.
journal.jsonl gets an agent's started line (label, phase) only once next(e) of its agent.spawn has resolved; agent-*.meta.json repeats it (description, workflowPhase).
Nothing signals a run's end: no journal line, no hook event.
$.fs has no append, and validate refuses $ passed to a helper.
A command.run answer's context starts no turn; it is read on the next prompt, where it outweighs what was typed.
SGR mouse sequences sent with tmux send-keys -l reach a Client (down, move, up, hover) in 1-based screen cells, one event per frame: space them 0.3 s.
A click gives the Client the keyboard: text sent after it arrives as one key event holding the whole string, and Escape gives the keys back to the prompt with the pane left open.
surface.every is quantized to 16 ms frames and rounds up (33 gives 48, 100 gives 112): ask for multiples of 16.
A Button hotkey is one lowercase letter or digit, cannot see Shift, and ui.press carries no key.
A focused Input gets every printable key with its case as a ui.input change, Enter as a submit, a burst as one change; a Button's hotkey does not fire while the ring is on an Input.
Answering { element, value: '' } to ui.input does not empty the field; drawing the Input under a new key does, and the ring stays, kept by its place among the stops.
A key typed in the frame an Input is drawn under a new key is dropped.
A reused Input key brings back its old text, also from before a reload of the module.
Changing value under a focused Input replaces its text and leaves the cursor where it was.
An Input under a Box with display none stays a focus stop and takes keys with the terminal's cursor hidden; one pushed off-screen or clipped still shows its cursor, clamped to the edge.
Up and Down on an Input walk the ring; Left, Right and Backspace stay in the field.
The docked pane's background is the engine's (theme token composerSidebarBackground) and no mod can remove it; only a custom theme overrides it, with a concrete colour. The inline placement has none.
backgroundColor takes a theme key, one outside ThemeKey too; a cell has no alpha.
$.ui.ask works inside a tool.call hook mid-turn, and time inside a $ call is not on the hook's budget (174 s held).
The ask dialog adds two rows of its own, Type something (the free text comes back as the answer) and Chat about this: compare the answer with the labels exactly.
Esc and Chat about this reject with the same HooksError (<plugin>: $.ui.ask: no answer); a caught rejection does not end the turn.
The ask is a nested tool.call of AskUserQuestion that the module's other tool.call hooks see: a catch-all must pass it through.
An ask after await next(e) in the Workflow tool.call hook holds the turn while the run goes on: the model gets neither the tool result nor the run's completion notice until the person answers.
return { ...r, context: [...] } from a tool.call hook reaches the model.
Beside a docked pane the ask dialog is drawn in the transcript's 24 columns.
A Workflow call carries script, name or scriptPath (scriptPath wins), absent when not passed; after next(e), r.result.scriptPath holds the full script in all three forms, and workflowName is meta.name.
An open from a tool.call hook is unasked even right after a yes in $.ui.ask: placed from 144 columns, below that it waits (isPlaced false) and the person sees nothing, no ui.render raised.
A waiting pane seats itself when the terminal reaches 144 columns and stays when narrowed, inline under 110; an open from the person's own command is placed at any width.
The dock's width is the person's once they dragged it (dockColumns in ~/.claude.json): the mod's columns is only a request.
Claude does not find a deferred mod tool from a plain workflow request (0 of 2); named in hidden context it loads and calls it, but only when it is heading for Workflow (2 of 3).
A non-deferred tool whose description says to call it before authoring or running any Workflow script is the turn's first call (3 of 3), ahead of the workflow-authoring skill; a request for one subagent does not trigger it.
$.store (get, set, delete, keys) is the plugin's own JSON store kept between sessions, untyped, 4 MiB in all; read from the types, never run.
session.compact fires before the compaction and next(e) resolves after it; trigger is manual, auto, plugin or precompute (which installs nothing), and subagents compact too (agentId set).
An Input without the ring is always one line cut with …; with the ring it wraps only when its box spans the pane's full width (a narrower width, a sibling in the row, padding, a border or an absolute box keep it to one line).
An Input's label is drawn as Label: and the wrapped rows hang under the text's first cell, so a label of N spaces makes a wrapping column; the wrap width is the cells from the text's first to the pane's edge less 4.
Under a label of spaces an Input without the ring is drawn broken; moved between two parents under the same key it keeps its text, its cursor and the ring.
A placeholder never wraps: longer than the room it squeezes the label and moves the field's first cell left.
In a row a Text before an Input is squeezed to nothing by a long value unless it is in a box with a width and flexShrink 0.
A column with marginTop below zero inside overflow hidden is drawn moved up, its first rows cut.
A sibling drawn later with position absolute paints over what is under it, and a Client there takes its presses.
A prompt sent with $.prompt.submit skips the whole calling module (re-entry) and goes through every other plugin's hooks; it cannot carry context, and asUser true drops the plugin sent a message frame.
$.prompt.submit from a $.clock.after callback is accepted.
A ui.render hook for component AbovePrompt is drawn at any width, unasked: bodyColumns is the terminal's columns less 5, maxRows 6 of 24 rows and 15 of 40, a taller tree cut with ↓ n more.
Beside a docked pane the band has 19 cells and e.viewport.columns is the transcript column's 24, not the terminal's.
An inline pane and the band share the bottom slot: the band's maxRows falls from 6 to 2 or 3.
Collapsed by the person (ctrl+x ctrl+a) the band draws nothing of the mod's, and a Client's ticks stop.
In the band $.clock.every(33) with $.ui.invalidate('ui.render') gives 30 drawings a second; a Client's surface.every(33) gives 21 Hz.
A band Button's digit hotkey fires from an empty prompt with no focus; a letter hotkey needs the band to hold the keys (ctrl+x tab or a click).
$.ui.open({ focus: true }) from a band Button's onPress places the pane but does not give it the keys.
An open from a band press counts as the person's and is placed at any width; with no columns asked the dock leaves the transcript 24 cells.
A resize redraws the band, and narrowing redraws a placed pane with placement inline.
An unasked open from a band drawing was placed from 112 columns, against the 144 seen from a tool.call hook and the types; not explained, so keep the isPlaced check.
An idle session polls a --plugin-dir mod every 30 s; /reload-plugins forces the reload.
A reload restarts the module, remounts the Client, raises session.start again (tools registered there are registered again) and can give the Client one frame of props in the old shape.
An Input opened again under the key it last submitted from, with the same value, is drawn empty.
Stop order is tree order, and the pane's own ✕ stop sits before the mod's first.
A ui.focus hook cannot tell Up / Down from Shift+Tab / Tab, only where the move landed.
The Left arrow on a Button is the engine's (← for agents): the conversation goes to the background, the pane goes and the debug log stops; on an Input it stays in the field.
A ui.focus raised by the person for a stop that names no element cannot be given one with next({ ...e, element }).
A ui.focus hook may answer { deny } without next: the ring stays and no stop is lit, where a move that lands and is moved back lights the stop for a frame.
A click on a row is a ui.press, not a ui.focus.
A Select lists its options under itself, so its row must not have a fixed height.
ui.scroll is raised for the wheel even when the tree fits, with e.pointer.row and .column; answering {} without next keeps the pane still; one tmux wheel tick is by ±3; a Client gets no wheel.
A clicked Client gets keys ({ key: 'W', shift: true }, arrows, tab, return), but nothing focuses it without a click or tells it when it loses them.
A tool description is cut at 4096 characters.
A { deny } from a tool.call hook reaches the model as the tool's error, and Claude treats instructions in it as untrusted.
A tool.call matcher naming the mod's own tool type-checks only once .claude-plugin/types/claude-code-mcp/ lists it, written when a session reloads the mod with the tool registered.
tmux send-keys with text and Enter in one call can leave the text unsubmitted: send the text, wait a second, send Enter.
A request to orchestrate subagents with no word workflow starts real Agent subagents, not a Workflow.
