# Conductor spec

Claude Code mod: design a workflow visually, hand the design to Claude to implement, watch the run on the same design. This file is the shared context for every implementation phase. Decisions here are settled; do not reopen them.

## Paradigm

- The design is a **spec, not a program**. It is JSON plus free-text notes. Claude reads it and writes the real workflow script. There is no JSON → JS compiler and no JS → JSON import.
- Goals: expose the workflow primitives, teach them, hand off a precise spec, show live progress over the design.

## Background: workflows

A workflow is a plain-JS script run by the `Workflow` tool. API: `agent(prompt, {label, phase, schema, model, effort, isolation, agentType})`, `pipeline(items, ...stages)` (no barrier between stages), `parallel(thunks)` (barrier), `phase(title)`, `log()`, `workflow()` (nest once), `args`, `budget`. `export const meta = {name, description, phases}` is a pure literal. Caps: ~16 concurrent agents, 1000 per run.

## Layout

```
.claude-plugin/plugin.json
hooks/hooks.json            { "modules": ["./register.tsx"] }
hooks/register.tsx          composes run + design hooks only
hooks/run.tsx               run hooks + run pane tree
hooks/design.tsx            design hooks, inspector, commands (rename from .ts when it draws)
hooks/canvas.tsx            Client module: the flow board
src/run/                    events.ts reducer.ts journal.ts
src/design/                 model.ts ops.ts lints.ts templates.ts teach.ts chat.ts
src/ui/                     rail.ts theme.ts tween.ts board-layout.ts board-paint.ts board-model.ts
types/index.d.ts            $.state contract
tests/ fixtures/
scripts/dev-session.sh capture.sh
docs/SPEC.md API-NOTES.md
```

Rule: `src/` is pure TypeScript with no `$`, no engine imports beyond types. Hooks modules stay thin.

## Data shapes

### Design (persisted at `.claude/workflow-designs/<name>.json`)

```ts
type Design = {
  version: 1
  name: string            // kebab-case, becomes meta.name
  description: string
  nodes: DesignNode[]     // top-level order = execution order
  nextId?: number         // next n<k> to hand out, so ids are never reused
}
type DesignNode = {
  id: string              // stable, short: "n1", "n2"… never reused
  type: NodeType
  title: string           // human label, e.g. "review"
  notes?: string          // free text for Claude: anything blocks can't express
  knobs?: {
    prompt?: string       // intent of the agent prompt, not final wording
    schema?: string       // described in words or as JSON Schema text
    model?: string
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    isolation?: 'worktree'
    agentType?: string
    fanout?: string       // what it fans out over: "changed files", "×4 dimensions"
    votes?: number        // verify / judge blocks
    until?: string        // loop blocks: "2 dry rounds", "budget < 50k"
  }
  children?: DesignNode[] // stages inside pipeline/parallel/loop
}
type NodeType =
  // primitives
  | 'agent' | 'pipeline' | 'parallel' | 'loop' | 'branch' | 'subworkflow' | 'code'
  // patterns
  | 'verify' | 'judge-panel' | 'loop-until-dry' | 'sweep' | 'critic'
```

The JSON holds design data only. General conventions and instructions never go in it.

### Run

```ts
type RunEvent =
  | { kind: 'run-start'; runId: string; name?: string; transcriptDir?: string; at?: number }
  | { kind: 'agent-start'; runId: string; agentId: string; label: string; phase?: string; index?: number; at?: number }
  | { kind: 'agent-usage'; agentId: string; tokens: number }
  | { kind: 'agent-end'; agentId: string; ok: boolean; durationMs?: number; tokens?: number }
  | { kind: 'run-end'; runId: string; ok: boolean }

type RunState = {
  runId?: string; name?: string; status: 'idle' | 'running' | 'done' | 'failed'
  agents: Record<string, AgentRun>          // by agentId
  byNode: Record<string, NodeRun>           // by design node id
  byPhase: Record<string, NodeRun>          // by phase title (used when no design is loaded)
  unmapped: string[]                        // agentIds whose label carries no known node id
}
type AgentRun = { agentId: string; label: string; nodeId?: string; phase?: string
                  status: 'running' | 'done' | 'failed'; tokens: number; durationMs?: number }
type NodeRun  = { total: number; running: number; done: number; failed: number; tokens: number }
```

## Id convention (design ↔ run)

- At handoff Claude is told: every `agent()` call sets `label: "<nodeId>: <short text>"`, e.g. `n3: verify auth`, and each top-level node maps to one `phase` titled `<nodeId> <title>`.
- The mod parses the node id from the label with `/^(n\d+)\b/`. No match → `unmapped`.
- The label is stored as the agent's `description` (seen on disk in `agent-<id>.meta.json`; to be confirmed on the live `agent.spawn` event in P1).

## Run data sources

Live (primary), mod hook events:
- `agent.spawn`: `description` (the label, confirmed), `prompt`, `workflow.{runId, agentIndex}` (present only for workflow agents). No `agentId` and no phase on the event: `agentId` is what `await next(e)` resolves to. Parallel spawns arrive out of order. A hook may only observe or deny.
- `turn.complete`: `agentId`, `durationMs`, `usage`, `isAborted`.
- `tool.call` on `{ tool: 'Workflow' }`: result has `runId`, `transcriptDir`, `scriptPath`, `workflowName`, `taskId`.

On disk (phase lookup, backfill), under `transcriptDir`
(`~/.claude/projects/<proj>/<session>/subagents/workflows/wf_<id>/`):
- `journal.jsonl`: `{type:'launched'}`, `{type:'started', key, agentId, label, phase}`, `{type:'result', key, agentId, result}`.
- `agent-<id>.meta.json`: `{agentType:'workflow-subagent', description, workflowPhase, …}`.
- `agent-<id>.jsonl`: subagent transcript; assistant lines carry `message.usage` (`input_tokens`, `output_tokens`, cache fields).

These files are internal and may change between versions: parse defensively, never throw on an unknown line.

## Mod API facts (from the type declarations)

- Hooks: `on(event, matcher?, ($, e, next) => …)`. Elements come from `$.ui.resolve(e)`; never hard-code a surface.
- Pane: `$.ui.open({ id, title, rows?, columns?, focus?, closeOnEscape? })`, drawn by a `ui.render` hook on `{ component: 'Pane', requestId: id }`.
- State: `atom(ref, initial)`, `read($, atom)` while drawing, `update($, atom, fn)` elsewhere. Every `$.state` key is declared in `types/index.d.ts` under `interface PluginState`.
- `Client` element: `<Client key module="./canvas.tsx" props={…} />`; module path is a string literal relative to the hooks file. The module gets `(props, surface)`; `surface` has `elements`, `state`/`setState`, `columns`, `rows`, `every(ms, fn)`, `onPointer(fn)`, `onKey(fn)`, `post(data)`. No `$` inside. `post` arrives as a `ui.message` event; a hook answering `{ props }` hands the instance new props.
- Pointer events: `down | move | up | enter | leave` with cell `x`,`y`; after `down` the instance holds the pointer until `up`.
- Limits: tree 20,000 nodes, 32 deep, 100,000 chars; Client props 100,000 chars; one `post` per frame; a Client render call may take 1s at most; three `setState` in a row with no input between is a render loop and unmounts.
- Surfaces: `Client` exists on terminal and desktop only. Mobile has no `Input`/`Select`.
- Colors: theme keys only — `text`, `inactive`, `subtle`, `suggestion`, `success`, `error`, `warning`, `claude`, `permission`, …
- Other: `$.ui.status(text)`, `$.ui.toast(text)`, `$.fs.read/write`, `$.prompt.fill`, `$.command.register` + `command.run` hook returning `{ text, context? }` (`context` = hidden notes only the model reads).
- Types: grep `.claude-plugin/types/claude-code/index.d.ts` (present once the mod has loaded) for the name at hand. Never read it whole.

## UX

The designer's drawing and editing were replaced by the flow board (last section): the row sketch and the `j/k`-first input below describe the first design and the run pane, not the designer.

Aesthetic: native Claude Code, geeky, text-first. Motion: short eased tweens on state change only.

```
 wf: review-changes                    design ▸ run
 ●  n1  scout diff            agent
 │
 ◆  n2  review  ×4            pipeline        7/12  18.2k
 │  ├ ⠹ review:bugs                           4.1k
 │  ╰ ✓ review:perf                           3.3k
 ◇  n3  verify  ×3 votes      adversarial
 ╰─ + add
 ─────────────────────────────────────────────
 n2 · pipeline: no barrier between stages   ? more
```

- **Nodes:** borderless rows on a glyph rail. Border only on the selected node.
- **Color:** `claude` = running/selected, `success`/`error` = outcome, `subtle` = rail and hints, `warning` = lints, `inactive` = not yet run.
- **Fan-out:** collapsed `×N` badge, expandable; failures auto-expand.
- **Pane:** canvas on top, inspector as a bottom drawer; side by side above a width threshold.
- **Design vs run:** one canvas; run state overlays the design; editing is locked while running.
- **Run density:** aggregate per node (`7/12`, tokens, elapsed, spinner) with drill-down to agents.
- **Input:** keyboard-first with mouse parity. `j/k` move, `space` grab/drop, `a` add, `enter` edit, `x` delete, `?` help. Dim hotkey hints.
- **Adding:** inline fuzzy picker at the insertion point.
- **Drag:** lifted row (inverse), siblings slide to open a gap, drop commits.
- **Empty state:** pick a template (review, research, migrate, judge panel).
- **Teaching:** one dim hint line for the selected node; `?` expands the full card.
- **Lints:** inline `▲` in `warning`, reason in the hint line; never blocking.
- **Motion:** tween reorder and expand/collapse (120–180 ms), count-up on tokens, eighth-block progress bars, spinner on running nodes. No ambient motion.
- **Timers:** one shared tick, started on demand, cleared when idle. Hover uses the `hover` prop.
- **Update rate:** coalesce to ~10 state updates/s, token counts ~2/s. Draw only visible rows.
- **Out of pane:** status line while the pane is closed (`wf 7/12 ▸ verify`), one toast at run end. No sound.

## Lints

1. `parallel` barrier whose next stage needs no cross-item context → suggest `pipeline`.
2. `isolation: worktree` on an agent that only reads.
3. Loop with no `until` (or no budget guard).
4. Agent output feeds a `code` node but has no `schema`.
5. Stated fan-out above the concurrency cap with a barrier (long queue).

## Handoff

- `/conductor run <name>`: a mod command. Its `command.run` answer carries `context` with the conventions (id/label rule, phase rule, "implement as a Workflow script and run it") and the design path. Conventions live once, in mod source.
- The pane's Run button does `$.prompt.fill('/conductor run <name>')`; the person presses Enter.

## Testing layers

1. `claude plugin validate .`
2. `bunx tsc -p .`
3. `claude plugin test .` — `*.test.ts`, imports from `claude-code/testing`. Pure logic, hook events, and UI trees mounted on `terminal` and `desktop` (loop the body over both). `Client` acts: `key`, `pointer`, `post`, `advance`, `resize`. The clock is mocked.
4. Real paint: `scripts/dev-session.sh` (tmux, `claude --plugin-dir . --debug`), then `scripts/capture.sh`.

The test kit checks the tree a hook returns, not the surface's paint.

## Findings from implementation

- `hooks/` modules may import from `../src`; tests live in `tests/`.
- A file that draws JSX is `.tsx`.
- JSX `key` on `Text` does not reach the test kit's `find({ key })`; query by `type` + `text`, or key a `Box`/`Button`.
- `types/index.d.ts` must not contain `export {}`; validate refuses it.
- With a single pane open the engine draws no title; the mod draws its own.
- Dev session debug log: `.capture/debug.log` (pinned by `scripts/dev-session.sh`).

## Spike outcomes (details and evidence: docs/API-NOTES.md — read it before writing hooks)

- **Label:** `agent.spawn` `e.description` is the workflow label. The id convention stands.
- **Completion and tokens:** `turn.complete` carries the agent's `agentId` and `usage`; the final `stop` chunk of `turn.step` carries usage too, so a live total needs no transcript polling.
- **Token figure shown:** the sum of all four usage counts (input, output, cache creation, cache read), so it agrees with Claude Code's own workflow view. Input + output alone showed 19 tokens where the engine showed 98.1k.
- **Phase:** not on any event. Read it from `journal.jsonl` (`started` line, present once the spawn's `next(e)` resolves) via `$.fs.read`. `transcriptDir` is at `result.result.transcriptDir` of the Workflow `tool.call`, which resolves before the first spawn.
- **Run end:** no signal exists. Treat a run as done when no agent is running and no spawn arrived for a quiet period (8 s); a later spawn for the same run id flips it back to running. A definitive signal can replace this later.
- **Handoff:** a `command.run` answer with `context` does not start a model turn; the context is used on the next prompt. `/conductor run` therefore also needs `$.prompt.submit` (declared, untested) or fill-and-Enter.
- **Pointer:** SGR mouse sequences injected through tmux reach a `Client` (fullscreen session). Clicking a Client gives it the keyboard until Escape.
- **Tick:** `surface.every` runs on 16 ms frames (~60 Hz); ask for multiples of 16.
- **Rules:** `$` may not be passed to a helper function (validate refuses it): spell every `$` call at the call site inside the hook. `$.fs` has no append. The test runner refuses `node:fs` and non-code imports (fixtures are generated `.ts` modules). Idle hot reload lags; `/reload-plugins` forces it.

## Findings from P3 and P5a

- **Canvas focus:** no API focuses a `Client`; it gets the keyboard only after a click, and Escape or ctrl+c hand the keys back to the prompt. `$.ui.focus` works for `Button`/`Input`/`Select` only, and only while that site holds the keyboard. A pane opened with `focus: true` plus an `autoFocus` element does take the keys (the template picker works this way).
- **Consequence:** keyboard-first cannot rest on the Client alone. Keyboard commands also need a route through the hooks tree (`Button` hotkeys in a focused pane); the Client stays the pointer surface and handles keys once clicked.
- **Commands:** `/conductor` (run view), `/conductor replay <fixture> [fast|slow|clear]`, `/conductor design [name]` (designer, pane id `conductor-design`), `/conductor run <name> [fill]` (handoff), `/conductor list`.
- **Hooks:** validate allows one unmatched hook per event per plugin. `run.tsx` holds the unmatched `session.start`; `design.tsx` uses the always-true matcher `{ cwd: /^/ }`.
- **Contract:** `types/index.d.ts` cannot import, so it re-declares the run and design shapes; `tsc` catches drift.
- **Test kit:** it cannot read `$.state`; tests observe `state.set`. Tests of run hooks must raise `session.start` first (timers are built there).
- **Canvas:** messages discriminate on `kind`; two posts in one frame can drop one, so send one message per input. The canvas takes a `maxRows` prop.
- **Run view:** counts are settled/total; replay token counts are synthetic; a quiet end always marks `done`, failures show as counts.

## Findings from P5b and P6a

- **Keyboard without a click works** through a hooks-tree toolbar of hotkey `Button`s in a pane opened with `focus: true`: `j` `k` move, `g` grab/drop, `a` add, `i` add inside, `x` delete (containers confirm), `e` edit title, `h` card, `r` run. The focus ring must rest on a `Button` (a ringed `Input` swallows letters), so it is sent back to the toolbar after each field's Enter.
- **Handoff:** `$.prompt.submit` is refused inside a `command.run` hook; it is sent from `$.clock.after(64)`. `/conductor run <name> fill` fills the prompt instead. The Run button and `r` fill `/conductor run <name>` (a plugin's own `$.command.run` skips its own hooks). Conventions text lives in `src/design/handoff.ts`.
- **Drag:** depth follows horizontal movement since the press (3 columns per level); release outside the rows or any key cancels; rows are placed by line order with blank lines; one module-level ticker (one canvas at a time).
- **Open canvas items:** the canvas hint line duplicates the toolbar; toolbar grab is not drawn on the canvas (needs a `grabbedId` prop); the canvas's own `x` deletes containers without confirming; a refused move leaves the row lifted; no auto-scroll during drag.

## Findings from P6b

- **Overlay:** the designer canvas shows per-node status glyph, settled/total, tokens and (from 72 columns) a bar; containers aggregate descendants; an `unmapped ×N` group lists agents whose label matched no node; `o` or a click opens a node's agent list (capped at 12).
- **Attribution:** `runDesign` is set by handoff only. A handoff never followed by a run would claim the next unrelated run.
- **Lock:** editing is refused while the run is active; selection and expand still work.
- **Dev aid:** `/conductor replay design <template> [fast|slow]` feeds a synthetic run mapped to a template's node ids.
- **Atoms** are declared in both hooks files: validate refuses a shared atoms module.
- **Lost on reload:** known node ids are not restored if the plugin reloads mid-run.

## Flow board (replaces the designer's tree view)

The tree showed containment; a workflow is flow. The designer draws the design as a board of cards. Three pure modules: `src/ui/board-layout.ts` (cells), `board-paint.ts` (styled spans), `board-model.ts` (props, messages, the Client's reducer). `hooks/canvas.tsx` is the Client. The docked pane (narrow, tall, flowing top to bottom) is the main view; inline (wide, short, left to right) is the other.

```
│ ╭── n4 pipeline ×n · deep read · each: deduped sources ─────────── ▲ 1 more above ─╮
│ │   │  +                                                                           │
│ │ ┏━▼ n5 agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ │ ┃ read source                                                                  ┃ │
│ │ ┃ One reader per source.                                                       ┃ │
│ │ ┃ out: { claims: [{ claim, quote, confidence }] }                              ┃ │
│ │ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ edit ━ del ━┛ │
│ │   │  +                                                                           │
│ │ ╭─▼ n1 sweep ×4 · multi-modal sweep · each: search angles: by container, by c… ╮ │
│ │ │  + add first block                                                           │ │
│ │ ╰──────────────────────────────────────────────────────────────────────────────╯ │
│ │  ╰────────────────────────────────────────────────────────────────────────────╯  │
│ │   ╰──────────────────────────────────────────────────────────────────────────╯   │
│ ╰─ + ──────────────────────────────────────────────────────────────────────────────╯
│  ╰────────────────────────────────────────────────────────────────────────────────╯
│   ╰──────────────────────────────────────────────────────────────────────────────╯
│   ║
│ ╭─▼ n7 critic ─────────────────────────────────────────────────────────────────────╮
```

**Layout rules**
- One model, two orientations: `horizontal` when the pane is inline, `vertical` when docked. Inline falls back to vertical only when the horizontal board is taller than the pane at rest and the vertical one fits the columns. The direction never depends on the selection or on the inspector opening (`turnRoom`).
- **Vertical: cards fill the width.** Every card is as wide as its list (`width`, the pane's columns, at most `BOARD_MAX_W` 100); a container's children are 4 columns narrower. Branches of a `parallel`/`sweep`/`branch` stand side by side and share the width down to `BRANCH_MIN_W` 18; past that the box grows and the board pans sideways.
- **Horizontal:** a card is as wide as its words (16 to 30; 20 minimum with a run); the selected one grows to `EXPANDED_W` 40 so its notes can wrap.
- **A card's text:** the title, then the block's notes (with none, its prompt): two lines when vertical, one when horizontal, the last ending in `…`. Heights vary; a card with no text is three rows when vertical.
- **The selected card expands:** all its notes word-wrapped, up to `expandRows(orientation, room)` rows (a third of the board's rows, 3 to 10; horizontal 2 to 4), then `… N more lines`, then one line of knobs (`low · 3 votes · out: <schema>`). Horizontal has no row to spare: the last note line ends in `…` and the knobs stay on the border. A selected container says its notes above its children. Growth is tweened with the cards' slide (`motionH` beside `motionX`/`motionY`), and the window scrolls so the whole card shows with a cell to spare on each side (`revealPadded`).
- **Bottom border:** a leaf's knobs (model, effort, isolation, votes, `until`, and `each: …` for a leaf that fans out); with a run, its status instead. A container's knobs and `out: <schema knob>`.
- **Container wording:** header `id type ×N · title · each: <fanout knob without its count>`; `out:` is the `schema` knob. No new fields. The title keeps at least half the header's room; both are cut with `…`.
- Container = a box around its children. `pipeline`, `loop`, `loop-until-dry` and the top level are **chains**; `parallel`, `sweep`, `branch` are **stacks** (no edges between children).
- **Connectors:** vertical, one row between two stacked siblings and nothing else: `│` (each result handed on) or `║` (barrier), the head `▼` on the next card's top border (`╭─▼ n6 …`), always two columns in from the list's left edge. Horizontal keeps `─▶` / `═▶`. Edge kind is derived: inside a `pipeline` always stream; elsewhere barrier when the source yields many results.
- **Fan-out:** `×N` in the header (`×n` with no count) and bottom borders stacked under the box, each a column in: one more for two, two for three or more. No shade column. Both orientations. The rows are outside the card's own (`card.stack`).
- **Compact (`z`):** every leaf that is not selected is one row, `╶── n3 agent · review ───╴` (the run's count at its right end); containers keep their boxes, the selected card stays expanded.
- **Slots:** every list has a slot per insertion index. Its `+` is drawn only (`slotVisible`) before and after the selected card, at the end of the list the selection is in, at the end of the selected container's own list, at the end of the top level, and in an empty container. Every other `+` shows while the pointer is on it (the Client keeps `hover`) and takes a click either way; all slots take a drop. Where it stands says what it adds to: between two cards on the connector's row, three cells right of the line; **the end of a container's list on that container's bottom border** (`╰─ + ──`); the end of the top level on a row of its own (`+ add block`); an empty container holds one `+ add first block` row. Before the first card of a list a slot only takes a drop.
- **Past the window:** the first row says `▲ N more above`, the last `▼ N more below` (N blocks wholly out of view; without N when only part of one is). Sideways a `◀`/`▶` on the empty cell of the edge column nearest mid-height. When a container's header is scrolled off and its body shows, its header is drawn on the first row (sticky, the innermost container; `stickyCards`), carrying the `▲` words.
- **Colour:** each type has its accent (`ACCENT` in `theme.ts`); none is dim (`code` is `ide`). Selection is shape: heavy border, bold header and title, in the type's own colour. `claude` marks only what can be pressed (`edit`, `del`, a `+` in use, a card in hand). `inactive` is a block a finished run never reached, and a card lifted by a drag.
- The region is as tall as the board up to the pane's room; past that it pans (drag the background; the selection is scrolled into view; a card held at the edge pans).
- Agents no block claims are one `unmapped ×N` card after the design.

**Pane chrome**
- Header row, the board, **one key row**, the inspector. No legend row, no file row: the legend and the design file's path are in the help card (`c`). While a card is dragged, what a release does is said beside it (`n6 critic · drop into n2`).
- Key row: `h: ← j: ↓ k: ↑ l: → a: add i: in x: del g: grab e: edit z: compact c: ? r: run`, 78 cells. A Button takes one hotkey, so the four directions are four Buttons (`hjkl: move` is not possible). The row wraps where the pane is narrower; its rows are counted (`wrapRows`).
- **Inspector, docked:** headline, lints, the agents of a run, `title` and `notes` fields, then the notes word-wrapped under the field (bounded by `inspectorNoteRows`, 2 to 8 rows, with `… N more lines`), the knob pickers. The board keeps at least 55% of the pane's rows.
- **Inspector, inline:** one line (`n4 · verify · title — notes…`) until a field is being typed in (`designUi.editing`: set by `e`, by `edit` on the card, or by the ring landing on a field; cleared when the field is sent, the selection changes, another key comes, or the person moves the ring off). While open the board shrinks, never turns.

**Editing model**
- Single source of truth: selection, grab, picker place, the delete question, `compact` and `editing` live in `designUi` (hooks). The Client keeps only pan, a drag in flight, the hovered slot and card motion.
- Messages: `select`, `move {id, to}`, `addAt {at}`, `remove {id}`, `edit {id}`, `key {op, orientation}`. One per input.
- Click a card: select. Click a `+`: the hooks-tree type picker opens for that place. Drag: the card is drawn dashed where it stood, a bar marks the nearest slot within reach, release posts one `move`; no slot near, off the board, or its own place cancels.
- The selected card's bottom border carries `edit` and `del`; `del` on a container with children turns into `delete all?` and needs a second click.
- **One key model.** The letters `h j k l a i x g e z c r` do the same whether the toolbar's Buttons or the clicked board hold the keyboard (`KEY_OPS` mirrors the toolbar; a kit test drives both and compares the state after every key). `e` and a `+` from the board first take the keyboard back for the pane (`$.ui.open` with `focus`), then move the ring to the field. Not identical, by the engine: the arrows (on the board they move the selection; on the toolbar they move the focus ring), Enter (edit on the board; on the toolbar it presses the Button under the ring, which rests on `edit`, so the same until the person moves the ring), Escape (on the board it lets go of a grab or the picker; elsewhere the engine hands the keys to the prompt).
- Along the sibling axis the direction keys go to the previous or next block; across it, forward into a container, backward out. With a block grabbed they call `moveBy` ±1.
- Run overlay: status glyph, `settled/total`, `N✗` failures and tokens on each card's bottom border (containers sum their children); never-reached blocks dim with `not run`. While running: no `+`, no `edit`/`del`, a press only selects or pans. The selected block's agents are listed in the inspector.

**Findings**
- Drawn by cell: each board row is a `Box` row of `Text` spans. Nested bordered Boxes cannot put a title on a border, draw an edge between two boxes, or pan. A `Text` nested in a `Text` cannot start a hover group, hence sibling spans.
- A tree is refused past 100,000 characters: `paintWeight` estimates it and the board repaints without colours past 70,000.
- `rows`/`columns` on `$.ui.open` are requests: 28 rows were asked and a 50-row terminal gave `scroll.bodyRows` 14 inline. A dock's width the person dragged is kept and wins over the request (86 was asked, the kept 72 was given until the border was dragged).
- `Input` has no multi-line prop (`InputProps`: key, label, placeholder, value, submitLabel, autoFocus, onInput, onSubmit). In real paint a **focused** field wraps its text over as many rows as it takes; at rest it is one line cut with `…` (with an empty row under it when the text is much longer). So notes are typed in the one field, which wraps while typed in, and shown wrapped under it at rest; the pane reserves rows for both (`inspectorTyping`, `inspectorNotes`).
- A pointer `move` with no button reaches `onPointer` (tmux: SGR code 35): that is how a hidden `+` shows under the pointer. One `setState` per change of slot, none while the pointer stays on it.
- `$.ui.open({ focus: true })` on the open pane takes the keyboard back from a clicked Client; `$.ui.focus` then lands on a field. A `ui.focus` hook sees the ring move (`e.element`, `e.origin.kind`).
- A hot reload of the plugin hands the keyboard to the prompt.
- A string sent to a focused Client in one burst arrives as a single paste key and is ignored; Escape first hands the keys back to the prompt.
- Text measures by code unit: a title with wide or combined characters misaligns its card.
- No wheel reaches a Client (`ClientPointerEvent` has none). The pane's own `ui.scroll` event carries wheel ticks; panning the board from it is not built.

## Design from chat

Claude drafts and changes a design; the board follows live. Pure logic in `src/design/chat.ts`, hooks in `hooks/design.tsx`.

**Mechanism**
- **A model-callable tool**, `mcp__conductor__design`, registered with `$.tool.register` in a `session.start` hook (`isDeferred: false`, so its schema is in the tool list and a plain chat message reaches it without ToolSearch) and served by a `tool.call` hook on that name. The hook edits the mod's own atoms, so the pane redraws from state and nothing unchecked is saved.
- **No system-prompt section.** The tool's description carries the vocabulary; `prompt.compose` is not hooked.
- **The description is generated** (`toolDescription()`): one line per type from `NODE_TYPES` + `TEACH[type].hint` + `canHoldChildren`, the knobs from `KNOB_HELP` (new, in `teach.ts`, typed `Record<keyof Knobs, string>` so a new knob cannot be left out). About 2,600 characters. The long cards (`TEACH[type].card`) are behind the `guide` action and in the draft's hidden context, not in every turn.
- **`/conductor draft <name> <description…>`**: saves an empty design with that description, shows it (pane opened without `focus`), answers with `context` (`draftBrief`: what to do, plus the full guide) and submits `Draft the "<name>" workflow design: …` from `$.clock.after(SUBMIT_DELAY_MS)`, as the handoff does. Refused when a design of that name already holds blocks.
- **Write/Edit follow-up**: a `tool.call` hook on `{ tool: ['Write', 'Edit'] }`. When `file_path` is a design file (`designOfPath`), after `next(e)` the open design of that name is re-read and re-parsed: valid, it replaces the board's; invalid, a toast and the last good design stays. Before `next(e)` the run lock denies the call.

**Tool contract** (`TOOL_SCHEMA`)
- `action: read` → the design JSON, whether it is open, the selected block ("this block"), whether a run locks it, the lints.
- `action: apply`, `ops: [...]`, in order, all or nothing (`applyOps`): `add` (type, title, notes?, knobs?, children? nested; placed by `after` | `before` a sibling id, or `parent` a container id, else the end of the top level), `update` (`id` + title | notes | knobs | type; a knob set to `""` is cleared), `move` (`id` + after | before | parent), `remove` (`id`).
- `action: write`, `nodes: [...]` (`replaceDesign`): the whole tree. A block whose id exists in the design as it stood keeps it; every other block gets a fresh id from the high-water mark, whatever id it came with.
- `action: guide` → every type's long card.
- `name` defaults to the open design; a name that is not open is loaded from its file (or started empty) and becomes the design shown. `description` sets the design's description.
- Answer to an edit (`editReport`): `added / changed / removed` ids, the outline (the handoff's `outline`), the lints. A refusal is `{ deny }`, which the model reads as an error: `ops[1] (move): no node n9. Nothing was changed.`, with the list to pick from appended for an unknown type, knob or a non-container parent.
- Validation: ops go through `ops.ts` (`addNode`, `updateNode`, `moveNode`, `removeNode`, new `retypeNode`); the result is serialized and read back by `parseDesign` before it counts. Unknown knob keys are refused here (`parseDesign` alone drops them silently).
- Run lock: an edit is denied while `runDesign` is this design and the run is `running`.

**Board**
- `designUi.flash = { ids, seq }` (`showEdit`): the added and changed blocks. The selection moves to the first added block, so the board scrolls to it; with none added it stays.
- The Client takes a new `seq` (`flashBoard`), counts `FLASH_MS` 800 down on the shared ticker (`boardTicking` includes it; the ticker stops when it ends) and paints those cards in `claude`, the header inverse for the first 400 ms. The hooks module empties `ids` after `FLASH_CLEAR_MS` with one `$.clock.after`, so a pane reopened later does not flash again.
- After an edit the pane is opened without `focus`: the keyboard stays in the prompt.

**Findings**
- A registered tool is served as an MCP tool of a server named after the plugin (`conductor - design (MCP)` in the transcript); it was visible about 0.5 s after `session.start`.
- A `tool.call` hook that returns `{ result: string }` is what the model reads; `{ deny }` reads as an error.
- The tool's arguments arrive spread on `e` beside `tool` and `tool_use_id`, so no argument may be named `tool`, `tool_use_id` or `agentId`.
- In the dev session (auto mode) no permission question was asked for the tool. Other permission modes were not tried; `tool.check` can allow it if they ask.
- A matcher's array is any-of: `{ tool: ['Write', 'Edit'] }` is one hook for both.
- Real use, one session: a draft was one `write` call with no retry (6 blocks, no lints); "add a completeness critic after n4" was one `apply`; "set this block to low effort, and make n1 fan out over changed files" was a `read` then one `apply`, which also reworded two blocks' notes nobody asked about.
- Not built: following a design file changed outside Claude's tools (no file watch), undo of a chat edit, a diff shown before applying.
