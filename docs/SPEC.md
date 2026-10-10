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
src/design/                 model.ts ops.ts lints.ts templates.ts teach.ts
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

The tree showed containment; a workflow is flow. The designer now draws the design as a board of cards. Three pure modules: `src/ui/board-layout.ts` (cells), `board-paint.ts` (styled spans), `board-model.ts` (props, messages, the Client's reducer). `hooks/canvas.tsx` is the Client.

**Layout rules**
- One model, two orientations: `horizontal` (flow left to right) when the pane is inline, `vertical` (top to bottom) when docked. Inline falls back to vertical only when the horizontal board is taller than the room and the vertical one fits the columns.
- Leaf = a bordered card, 4 rows, 16 to 30 columns (20 minimum with a run): `id type ×N` on the top border, title, then knobs (or the prompt's first words, which never widen the card) or the run's status.
- Container = a box around its children, its title after ` · ` in the header, its knobs or run sum on the bottom border. `pipeline`, `loop`, `loop-until-dry` and the top level are **chains**: children along the main axis, an edge and a `+` in each gap. `parallel`, `sweep`, `branch` are **stacks**: children across it, no edges, one `+` at the end.
- Edge kind (derived, not stored): inside a `pipeline` always stream (`─▶`). Elsewhere barrier (`═▶`) when the source yields many results (a `fanout` or `votes` knob, or a pipeline, parallel, sweep or judge-panel), else stream. Vertical glyphs: `│▼`, `║▼`.
- Fan-out: `×N` from a leading count in `fanout` or from `votes`, `×n` for a fan-out with no count; plus a `▒` column right of the card.
- Type accents are theme keys (`ACCENT` in `theme.ts`); `claude` is the selection, `success`/`error` run outcomes. The selected card has a heavy border.
- Slots: every list has a slot per insertion index. Those with a `+` take clicks; before the first card and between stacked cards a slot only takes a drop.
- The region is as tall as the board plus one legend line, up to the pane's room; past that it pans (drag the background; the selection is scrolled into view; a card held at the edge pans). No wheel: `ClientPointerEvent` has none.
- Agents no block claims are one `unmapped ×N` card after the design.

**Editing model**
- Single source of truth: selection, grab, picker place and the delete question live in `designUi` (hooks). The Client keeps only pan, a drag in flight and card motion, so `rev` and the Client-side selection are gone.
- Messages: `select`, `move {id, to}`, `addAt {at}`, `remove {id}`, `edit {id}`, `key {op, orientation}`. One per input.
- Click a card: select. Click a `+`: the hooks-tree type picker opens for that place (all 12 types as Buttons, the field filters). Drag: the card is drawn dashed where it stood, a bar marks the nearest slot within reach, release posts one `move`; no slot near, off the board, or its own place cancels.
- The selected card's bottom border carries `edit` and `del`; `del` on a container with children turns into `delete all?` and needs a second click.
- Keys (toolbar Buttons `h j k l a i x g e c r`, or the same keys and the arrows once the board was clicked): along the sibling axis to the previous or next block (before the first: the container; after the last: what follows the container on that axis); across it, forward into a container, backward out. With a block grabbed the direction keys call `moveBy` ±1.
- Run overlay: status glyph, `settled/total`, `N✗` failures and tokens on each card (containers sum their children, on the bottom border); never-reached blocks dim with `not run`. While running: no `+`, no `edit`/`del`, a press only selects or pans. The selected block's agents are listed in the inspector (no more per-row expand, `o`, or `runUi` in `designUi`).

**Findings**
- Drawn by cell: each board row is a `Box` row of `Text` spans. Nested bordered Boxes cannot put a title on a border, draw an edge between two boxes, or pan. A `Text` nested in a `Text` cannot start a hover group, hence sibling spans.
- A tree is refused past 100,000 characters: `paintWeight` estimates it and the board repaints without colours past 70,000.
- `rows`/`columns` on `$.ui.open` are requests: 28 rows were asked and a 50-row terminal gave `scroll.bodyRows` 14, so the board is sized from `bodyRows` and keeps at least 9 rows; the inspector's lower fields scroll.
- A string sent to a focused Client in one burst arrives as a single paste key and is ignored; Escape first hands the keys back to the prompt.
- Text measures by code unit: a title with wide or combined characters misaligns its card.
