# API notes (P1 spikes)

Observed on Claude Code 2.1.296, terminal surface, inside tmux 3.2a (160x50), on 2026-10-10.
Method: the probe mod `spikes/probe/` loaded beside Conductor, logging one JSON line per event to
`.capture/probe.jsonl` (gitignored). One real workflow run: 3 haiku agents, 2 phases, run `wf_612793e3-454`.
Log lines below are trimmed. `t` is ms since the probe loaded.

Rerun: `CONDUCTOR_EXTRA_PLUGIN_DIRS=spikes/probe scripts/dev-session.sh`, then `/probe-handoff`,
`/probe-pane`, `/probe-fs`, `/probe-keys` in the nested session.

S7 and the findings marked "redesign v1" were added on 2026-10-11, same version and surface.
S8 and the last two findings under S7 came with the UI pass that followed, same version and surface.

## S1. Is `agent.spawn`'s `description` the script's `label`? Yes. Phase on the event? No.

```
agent.spawn keys: tool_use_id prompt description subagentType provider model parentModel
                  permissionMode background fork workflow name cwd
{"description":"n1: two","workflow":{"runId":"wf_612793e3-454","agentIndex":2},"subagentType":"workflow-subagent","model":"haiku","prompt":"Reply with the single word ok"}
{"description":"n1: one","workflow":{"runId":"wf_612793e3-454","agentIndex":1}, …}
{"description":"n2: three","workflow":{"runId":"wf_612793e3-454","agentIndex":3}, …}
agent.spawn.after {"result":{"model":"claude-haiku-5-5","agentId":"a7d5df6f5c088efc8"}}
```

- `description` equals the label exactly. The id convention in SPEC (`/^(n\d+)\b/` on the label) stands.
- `agentId` is **not on the event**. It is on what `await next(e)` resolves to (`{ model, agentId }`).
  The run hook must call `next` and read the id from the result. SPEC's "agent.spawn: agentId" is wrong in that detail.
- No phase field. `workflow` holds only `runId` and `agentIndex`. Phase comes from the journal (S3) or from
  the node id in the label, which is enough for `byNode`. `byPhase` (no design loaded) needs the journal.
- Spawn events of one `parallel` batch arrive out of order (`agentIndex` 2 before 1). Never assume order.
- `name` and `cwd` keys exist with undefined values; `model` is the alias as written (`haiku`).

## S2. Do workflow agents raise `turn.complete` with matching `agentId` and `usage`? Yes. `turn.step`? Yes.

```
turn.complete keys: answer durationMs isAborted turnId agentId reason usage
{"agentId":"a7d5df6f5c088efc8","durationMs":1136,"reason":"answer","answer":"ok",
 "usage":{"input_tokens":2,"output_tokens":4,"cache_read_input_tokens":0,"cache_creation_input_tokens":32638,"model":"claude-haiku-5-5"}}
turn.step keys: turnId index model effort messageCount agentId      (input: no token counts)
turn.step.stop {"agentId":"a7d5df6f5c088efc8","index":0,"keys":["kind","stopReason","usage","ref"],
 "usage":{"input_tokens":2,"output_tokens":4,"cache_read_input_tokens":0,"cache_creation_input_tokens":32638,…}}
```

- All three agents raised one `turn.complete` each, `agentId` equal to S1's spawn result.
- Usage fields: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `model`.
- The engine's own figure ("3 agents · 97.9k tokens") is the sum of **all four** counts (3 × 32,644 = 97.9k).
  Define `tokens` as that sum so the pane matches `/workflows`.
- `turn.step` fires per model request for workflow agents. Its input has no tokens, but its stream's last
  chunk (`kind: 'stop'`) carries the request's `usage`. Summing stop chunks per `agentId` is a live running
  total; `turn.complete.usage` is the same sum at the end. So `agent-usage` events come from `turn.step`
  stop chunks, `agent-end` from `turn.complete`. No transcript polling needed.
- `turn.step` is a streaming hook (`async function*`, `for await (const c of next(e)) yield c`). It runs on
  the main loop too: pass every chunk through untouched and only read `stop`.
- The main loop's `turn.complete` has no `agentId`; ignore those for agent accounting.
- Not observed: a failing agent. `reason` (`answer | aborted | refusal | error`) and `isAborted` are there to map to `ok`.

## S3. Is `transcriptDir` on the Workflow result, and can `$.fs` read the run files? Yes to both.

```
workflow.call keys: script tool tool_use_id            (tool input is flat on the event, no `e.input`)
workflow.result keys: ref result text
  result keys: status taskId taskType workflowName runId summary transcriptDir scriptPath
  transcriptDir: ~/.claude/projects/-home-aturdiev-conductor/<session>/subagents/workflows/wf_612793e3-454
t=120426 workflow.result  list:["journal.jsonl"]  journalTypes:["launched"]
t=120430 agent.spawn.before (n1: two)   journal: ["launched"]
t=120463 agent.spawn.after              journal: ["launched","started"]  {"label":"n1: two","phase":"Alpha"}
probe-fs meta: {"agentType":"workflow-subagent","description":"n2: three","workflowPhase":"Beta","model":"haiku",…}
```

- The fields are under `result.result`, not on the top level of what `next(e)` resolves to.
- `$.fs.list(dir)`, `$.fs.read(journal.jsonl)`, `$.fs.read(agent-*.meta.json)` and reading an
  `agent-*.jsonl` transcript all work on `~/.claude/projects/...`; no permission prompt, absolute paths.
- Timing: the run starts in the background, so the tool result arrives **before** the first `agent.spawn`
  (4 ms here). `run-start` comes from the tool result; `transcriptDir` is known before any agent starts.
- The journal's `started` line is absent when the `agent.spawn` hook is entered and present once `next(e)`
  has resolved, in all three spawns. So: `await next(e)`, then read the journal for that `agentId`'s phase.
  Read defensively (retry on the next event if the line is missing).
- `transcriptDir` can also be built without the result: `<projects>/<$.session.id()>/subagents/workflows/<runId>`.
- `agent-*.meta.json` appears after the spawn and duplicates label and phase (`description`, `workflowPhase`).
- No run-end signal was found: the journal has no end line and no hook event names the run's end. The main
  loop takes a turn after the completion notification. P2 must pick one: "all started agents ended and no
  spawn for N seconds", or the `session.append` notification row (untested). `result.status`/`taskId` exist.
- `$.fs` has no append. `$` may not be passed to a helper (`validate` refuses `log($.fs, …)`); every `$` call is spelled at the call site.

## S4. Does `command.run`'s `context` make the model take a turn? No. It is used on the next prompt: yes.

```
❯ /probe-handoff
  ⎿  conductor-probe: probe handoff          (20 s: no turn, no turn.step, no turn.complete)
❯ hi
● PONG
```

- The `context` entry is recorded as a hidden message and read on the next turn, where it won over the typed `hi`.
- Consequence: `/conductor run <name>` alone does not start the implementation. Options, in order:
  1. The command's hook calls `$.prompt.submit(...)` (declared in the types, **untested**) with a visible
     one-line prompt such as "Implement and run the workflow design <name>", conventions staying in `context`.
  2. Fallback: the command answers `text` telling the person to press Enter on a prompt it filled with
     `$.prompt.fill`. The Run button already uses `$.prompt.fill`.
  Test option 1 first in P2; it is one small turn.
- The output row is prefixed with the mod's name (`conductor-probe: …`).

## S5. Can tmux-injected mouse events reach a `Client`? Yes.

```
tmux send-keys -t conductor-dev -l $'\e[<0;95;5M'     → {"type":"down","x":5,"y":2,"keys":["type","x","y","button"]}
tmux send-keys -t conductor-dev -l $'\e[<32;100;6M'   → {"type":"move","x":10,"y":3}
tmux send-keys -t conductor-dev -l $'\e[<32;105;7M'   → {"type":"move","x":15,"y":4}
tmux send-keys -t conductor-dev -l $'\e[<0;105;7m'    → {"type":"up","x":15,"y":4}
tmux send-keys -t conductor-dev -l $'\e[<35;96;5M'    → enter, then {"type":"move","x":6,"y":2}   (hover, no button)
```

- SGR sequences work as given, 1-based screen cells. The Client's region began at screen column 90, row 3,
  so `x = COL - 90`, `y = ROW - 3`. Find the origin from a capture; it moves with the pane's width.
- Space the sequences (0.3 s used); one event is delivered per frame.
- No setting was needed: the nested session was already fullscreen (`viewport.isFullscreen: true`) with mouse
  reporting on (tmux `mouse_any_flag=1`, `mouse_sgr_flag=1`). tmux's own `mouse off` does not matter for
  `send-keys -l`. Not tested: a non-fullscreen session (the types say presses need the fullscreen terminal).
- `button` is on `down`/`move`-while-held/`up` only. `fine` is absent under tmux, as documented.
- **A click gives the Client the keyboard.** After the click, text sent to the session went to `onKey` as one
  key event holding the whole string, not to the prompt. `Escape` returns focus to the prompt and leaves
  the pane open. The harness must send `Escape` after pointer tests before typing; the canvas should
  treat a multi-character key as paste or ignore it.
- A pane opened by the person's command docked at 88/72 columns in a 160-column terminal.
- Consequence: drag and click can be tested end to end from the harness. Mouse parity in SPEC stands.

## S6. What tick rate does `surface.every` sustain? About 60 Hz at 16 ms; intervals round up to 16 ms frames.

```
{"askedMs":16, "calls":123,"elapsedMs":2004,"meanMs":16.3, "hz":61.4,"maxGapMs":26, "renders":122}
{"askedMs":33, "calls":42, "elapsedMs":2013,"meanMs":47.9, "hz":20.9,"maxGapMs":50, "renders":42}
{"askedMs":100,"calls":18, "elapsedMs":2018,"meanMs":112.1,"hz":8.9, "maxGapMs":115,"renders":18}
```

- Each tick called `setState`, and every tick produced a render, so these are redraw rates of a small tree.
  A second run after a reload gave the same means (16.6 / 48.6 / 113.8 ms) with one 96 ms gap.
- The clock is quantized to ~16 ms frames and rounds **up**: 33 → 48 ms (3 frames), 100 → 112 ms (7 frames).
  Ask for multiples of 16: 16 (60 Hz), 32 (30 Hz), 96 (10 Hz).
- Consequence: 120–180 ms tweens get 7–11 frames at `every(16)`, which is enough; SPEC's motion plan stands.
  Use `every(16)` only while a tween runs, `every(96)` for spinners, and stop the timer when idle.
- Measured on an idle session with a 40x8 region. Not measured: a full-size canvas or a session busy streaming.

## S7. Can a focused `Input` serve as a key catcher: every key with its case, and kept empty? Yes, by re-keying it.

The question came from a Button `hotkey`: `Shift+j` pressed `j`'s Button, and `ui.press` carries no key, so a
hotkey cannot tell `w` from `W`, and `+` and `?` cannot be hotkeys at all.

Probe: `/probe-keys` in `spikes/probe/hooks/register.tsx` opens a pane with `focus: true` holding an `Input`
with `autoFocus` (`value=""`), a second `Input` and a Button with hotkey `z`. A `ui.input` hook logs each event.

First run: the hook answers `{ element, value: '' }` and the Input keeps one key (`catch`).

```
{"kind":"ui.focus","element":"catch","origin":{"kind":"plugin","name":"conductor-probe"}}
{"kind":"change","element":"catch","value":"w"}
{"kind":"change","element":"catch","value":"wW"}
{"kind":"change","element":"catch","value":"wWs"}
{"kind":"change","element":"catch","value":"wWsD"}
{"kind":"change","element":"catch","value":"wWsD+"}
{"kind":"change","element":"catch","value":"wWsD+?"}
{"kind":"change","element":"catch","value":"wWsD+?1"}
{"kind":"change","element":"catch","value":"wWsD+?1z"}
{"kind":"change","element":"catch","value":"wWsD+?1zwwssdd"}
{"kind":"ui.focus","origin":{"kind":"person"}}
{"kind":"ui.focus","element":"catch","origin":{"kind":"person"}}
```

Second run: the Input is drawn under a new key after every event (`catch:<n+1>`, `value=""`).

```
{"kind":"ui.input","element":"catch:0","inputKind":"change","value":"w"}
{"kind":"ui.input","element":"catch:1","inputKind":"change","value":"W"}
{"kind":"ui.input","element":"catch:2","inputKind":"change","value":"s"}
{"kind":"ui.input","element":"catch:3","inputKind":"change","value":"D"}
{"kind":"ui.input","element":"catch:4","inputKind":"change","value":"+"}
{"kind":"ui.input","element":"catch:5","inputKind":"change","value":"?"}
{"kind":"ui.input","element":"catch:6","inputKind":"change","value":"1"}
{"kind":"ui.input","element":"catch:7","inputKind":"change","value":"z"}
{"kind":"ui.input","element":"catch:8","inputKind":"submit","value":""}
{"kind":"ui.input","element":"catch:9","inputKind":"change","value":"wasdWASD"}
```

- A focused `Input` receives every printable key with its case, one `ui.input` `change` each; Enter is a
  `submit`. `z`, the Button's hotkey, arrived as text: a hotkey does not fire while the ring is on an Input.
- A burst sent at once is one `change` holding all the characters (`wwssdd` in the first run, `wasdWASD` in
  the second).
- **Answering `{ element, value: '' }` does not empty the field** (first run: the value keeps growing).
  **Drawing the Input under a new key does**, and the ring stays on it: the ring is kept by its place among
  the stops, not by key.
- Up / Down on the Input walk the ring (a `ui.focus`, origin `person`, no key told; the first of the two
  above names no element). Left / Right / Backspace stay in the field. Tab goes to the next stop.
- Found while building on it (seen in the designer, not in this probe):
  - A key typed in the frame an Input is drawn under a new key is dropped. So the catcher is not re-keyed
    per key: its whole text is read each time (the new characters are those after the ones already taken)
    and it is re-keyed only once the typing has paused.
  - A reused key brings back its old text, also from before a reload of the module (whose counters start
    from 0 again). Keys carry a per-load stamp: `keys:<load>.<n>`.
  - Changing `value` under a focused Input replaces its text and leaves the cursor where it was, so the next
    letter lands in the middle. A field being typed in is drawn with the text it opened with until the
    typing pauses.
  - An `Input` under a `Box` with `display="none"` stays a focus stop and takes keys, while the terminal's
    cursor is hidden (tmux `#{cursor_flag}` = 0).
  - A focused Input pushed off-screen or clipped still has its cursor shown, clamped to the screen edge.
    So drawing an Input out of sight does not hide its cursor.
- Consequence: the designer's ring rests on one small `Input`, the first child of the pane's tree and so the
  mod's first stop, under a `Box` with `display="none"`: it is not drawn, takes no cell, and no cursor
  blinks while the ring rests on it. Every character typed there is looked up in one key table
  (`src/ui/keys.ts`). `Shift+WASD`, `+` and `?` work without a click. It replaces the hotkey Buttons, the
  rewrite of the ring onto a home key, and the `prompt.edit` swallow of unbound letters (an unbound
  character is now typed into the catcher, which says so). The Client still handles the pointer only.

## S8. Can a mod remove the docked pane's background colour? No.

The docked pane has a background colour of its own. It is the engine's: Claude Code 2.1.296 wraps the dock
in a `Box` with `backgroundColor: composerSidebarBackground`, and every descendant inherits it.

- `composerSidebarBackground` is a theme token: `rgb(38,38,38)` in the dark theme, `rgb(245,245,245)` in the
  light one; the ANSI themes use `blackBright` and `white`.
- Nothing the mod draws takes it away: `backgroundColor="default"` or `"transparent"` on a `Box` or a
  `Text`, a `Raster`'s default cell and a `Client` region all keep it.
- `$.ui.open` has no option for it.
- The inline placement has no such background.
- The only control is the person's: a custom theme that overrides `composerSidebarBackground` with a
  concrete colour (`"default"` is dropped).
- Consequence: the mod draws on what the dock gives it. The one background it sets is a phase's ground on the
  graph: `backgroundColor="inverseText"` on the `Text` of its cells. A theme key is accepted there and follows
  the theme (seen in tmux at 256 colours: the dock `48;5;235`, the phase `48;5;16`).

## Other findings

- Hot reload of a `--plugin-dir` mod is not immediate when the session is idle (the watch drops to a 30 s
  poll). `/reload-plugins` forces it. A reload restarts the module (variables reset) and remounts the Client.
- `spikes/` is outside the root `tsconfig.json` `include`, so root `tsc` does not see it. The probe has its
  own `tsconfig.json`: `bunx tsc -p spikes/probe`.
- `scripts/dev-session.sh` takes `CONDUCTOR_EXTRA_PLUGIN_DIRS` (colon-separated, relative to the repo or absolute).
- Redesign v1, Input:
  - A focused `Input` wraps only when it has the pane's full body width; inside any narrower column it is one
    line cut with `…`. So a field being edited keeps one line and the mod draws the whole text wrapped under
    it, redrawn per keystroke.
  - An Input opened again under the key it last submitted from, with the same `value`, was drawn empty
    (Enter then saved an empty text). It is drawn under a new key each time it opens.
- Redesign v1, the ring:
  - Stop order is tree order, and an engine stop (the pane's ✕) sits before the mod's first. A `column-reverse`
    Box puts the tree's first stop on the pane's last row: how the catcher was first placed. It is not used
    any more: the catcher is the tree's first child, under `display="none"` (S7).
  - Up / Down walk the ring like Shift+Tab / Tab, and a hook cannot tell them apart.
  - A `ui.focus` raised by the person for a stop that names no element cannot be given one with
    `next({ ...e, element })`: the engine refuses it. The mod lets the move land and then moves the ring itself.
  - A `Select` the ring opens lists its options under itself, so its row must not have a fixed height.
- Redesign v1, the wheel: `ui.scroll` is raised for the wheel even when the tree is exactly as tall as the
  body, with the pointer's cell (`e.pointer.row`, `.column`). Answering `{}` without `next` keeps the pane
  still. One tmux wheel tick is `by: ±3`. A Client still gets no wheel: the hooks module sums the rows and
  hands the sum to the Client in its props.
- Redesign v1, the Client:
  - On `/reload-plugins` the Client module can get one frame of props in the old shape: read props defensively.
  - A clicked Client gets `{ key: 'W', shift: true }`, arrows, `tab`, `return`. Nothing can focus a Client
    without a click or tell when it loses the keys, so the Client still never keeps the keyboard: after a
    click the hooks take it back for the pane.
- Redesign v1, tools: a tool description is cut at 4096 characters (Conductor's is 4,050: what each knob means moved to the schema's `knobs` field when `args` and `phase` took the room).
- The dock's width is the person's once they dragged it (kept in `~/.claude.json`); the mod's `columns` is
  only a request.
