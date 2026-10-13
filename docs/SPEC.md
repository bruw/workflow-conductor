# Conductor spec

Claude Code mod: design a workflow visually, hand the design to Claude to implement, watch the run on the same design. This file is the shared context for every implementation phase. Decisions here are settled; do not reopen them.

## Paradigm

- The design is a **spec, not a program**. It is JSON plus free-text notes. Claude reads it and writes the real workflow script. There is no JSON → JS compiler and no JS → JSON import.
- Goals: expose the workflow primitives, teach them, hand off a precise spec, show live progress over the design.

## Background: workflows

A workflow is a plain-JS script run by the `Workflow` tool. API: `agent(prompt, {label, phase, schema, model, effort, isolation, agentType})`, `pipeline(items, ...stages)` (no barrier between stages), `parallel(thunks)` (barrier), `phase(title)`, `log()`, `workflow()` (nest once), `args`, `budget`. `export const meta = {name, description, phases}` is a pure literal. Caps: ~16 concurrent agents, 1000 per run.

## Layout

The files as they stand after Redesign v1 (last section), which replaced the flow board's modules (`board-model.ts` is gone; see "What was deleted" there for the two that remained while this was written).

```
.claude-plugin/plugin.json
hooks/hooks.json            { "modules": ["./register.tsx"] }
hooks/register.tsx          composes run + design hooks only
hooks/run.tsx               run hooks + run pane tree (the phase view)
hooks/design.tsx            design hooks, commands, the designer's screen: header, detail pane, footer, the key catcher
hooks/canvas.tsx            Client module: the graph
hooks/splash.tsx            Client module: the splash's scene, counting its own beats
src/run/                    events.ts reducer.ts journal.ts tracker.ts replay.ts
src/design/                 model.ts ops.ts lints.ts templates.ts teach.ts chat.ts handoff.ts history.ts session.ts
src/ui/                     graph-layout.ts graph-paint.ts graph-model.ts keys.ts text.ts rail.ts theme.ts tween.ts persona.ts
types/index.d.ts            $.state contract
tests/                      stale, not run (AGENTS.md)
fixtures/                   recorded runs for /conductor replay
scripts/                    dev-session.sh send.sh capture.sh render-graph.ts make-fixture.ts
spikes/probe/               the probe mod of docs/API-NOTES.md
docs/SPEC.md API-NOTES.md PRODUCT.md redesign-v1/BRIEF.md
AGENTS.md                   rules for agents: no tests
```

Rule: `src/` is pure TypeScript with no `$`, no engine imports beyond types. Hooks modules stay thin.

## Data shapes

### Design (persisted at `.claude/workflow-designs/<name>.json`)

```ts
type Design = {
  version: 1
  name: string            // kebab-case, becomes meta.name
  nodes: DesignNode[]     // top-level order = execution order
  nextId?: number         // next n<k> to hand out, so ids are never reused
}
type DesignNode = {
  id: string              // stable, short: "n1", "n2"… never reused
  type: NodeType
  kind?: Kind             // the pattern it is used for; left out on a plain block (see "Blocks and kinds")
  name: string            // human label, e.g. "review"
  logic?: string          // free text for Claude: what the block does, anything blocks can't express
  knobs?: {
    goal?: string         // the start block only: what the workflow is for
    args?: string         // the start block only: what it is run on, in words or as a shape
    prompt?: string       // intent of the agent prompt, not final wording
    output?: string       // what it hands on, in words or as JSON Schema text
    model?: string
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    isolation?: 'worktree'
    agentType?: string
    oncePer?: string      // a pipeline or parallel: what it fans out over, "changed files", "×4 dimensions"
    stopCondition?: string // a loop: when it stops, in words, "2 dry rounds", "budget < 50k"
    condition?: string    // a block directly in a branch: what picks this arm
  }
  match?: string[]        // a design of a script that exists: the script's agent labels or phase titles this block stands for; one ending in * is a prefix
  children?: DesignNode[] // stages inside pipeline/parallel/loop
}
type NodeType =
  // what a workflow script is written in
  | 'agent' | 'pipeline' | 'parallel' | 'loop' | 'branch' | 'subworkflow' | 'code'
  // frame (see "The start block")
  | 'start' | 'phase'
type Kind =               // by type; the first of each row is the plain block and is not written
  | 'task' | 'scout' | 'check' | 'verify' | 'judge' | 'critic' | 'merge' | 'classify'   // agent
  | 'custom' | 'count' | 'pass' | 'dry' | 'converged' | 'target' | 'budget'                  // loop
  | 'arms' | 'each' | 'sweep' | 'attempts'                                                   // parallel
  | 'if-else' | 'guard' | 'route'                                                            // branch
```

The keys are the pane's words for the fields (`oncePer` is "once per", `stopCondition` "stop condition"). Earlier sections of this file name them as they were: `title` is `name`, `notes` `logic`, `schema` `output`, `fanout` `oncePer`, `until` `stopCondition`, `when` `condition`; and `verify`, `judge-panel`, `critic`, `sweep`, `loop-until-dry` are kinds, not types. The old forms are not read (AGENTS.md, "Compatibility").

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
- The mod parses the node id from the label with `/^(n\d+)\b/`. With no id (or one the design does not have), the block whose `match` names the label takes the agent, else the one whose `match` names its phase title (`nodeOf`, `matchNode`: an exact string before any prefix, the longest prefix, the first block in design order on a tie). None → `unmapped`.
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

Replaced for the designer by "Redesign v1: graph, detail pane, legend" (last section): the rows, the input, adding, drag, the empty state, teaching and lints as listed here. Still current: the aesthetic, the timers and update rate, "Out of pane", and the run pane (`hooks/run.tsx`).

The designer's drawing and editing were first replaced by the flow board ("Flow board" below): the row sketch and the `j/k`-first input below describe the first design and the run pane, not the designer.

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

The project writes and runs no tests (`AGENTS.md`). A change is verified with:

1. `claude plugin validate .`
2. `bunx tsc -p .` (errors under `tests/` are known and ignored).
3. Real paint: `scripts/dev-session.sh` (tmux, `claude --plugin-dir . --debug`), `scripts/send.sh` to send keys, then `scripts/capture.sh`.
4. The graph alone, with no session: `bun scripts/render-graph.ts <template | stress case | design.json>` prints it as the pane paints it (`--list` names what it can draw).

The files under `tests/` (`claude plugin test .`, `*.test.ts` on `claude-code/testing`) date from before review round 3 and are stale: they are not run and not updated, and `bun run check` (`package.json`) still calls them. Where earlier sections say "tests will need updating", that was dropped, not done.

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
- **Commands:** `/conductor` (run view; since the review round see "Bare `/conductor`" under Flow board), `/conductor replay <fixture> [fast|slow|clear]`, `/conductor design [name]` (designer, pane id `conductor-design`), `/conductor run <name> [fill]` (handoff), `/conductor list`.
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

Replaced by "Redesign v1: graph, detail pane, legend" (last section): the layout rules (both orientations, compact, sideways pan, the fan-out border), the pane chrome (key row, inspector, help card, pickers), the messages, the key model and the `edit` / `del` marks. Still current: the run overlay's wording (`runWords`, `fitStatus`), following the run, elapsed time, preflight, bare `/conductor`, the selection kept per design, and the findings except the two on `Input` wrapping and on the wheel (corrected in the last section).

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
│ │ ╭─▼ n6 verify ×2 ──────────────────────────────────────────────────────────────╮ │
│ │ │ check claims                                                                 │ │
│ │ │ 2 votes · out: { refuted: boolean, reason }                                  │ │
│ │ ╘══════════════════════════════════════════════════════════════════════════════╛ │
│ ╘═ + ══════════════════════════════════════════════════════════════════════════════╛
│   ║
│ ╭─▼ n7 critic ─────────────────────────────────────────────────────────────────────╮
```

**Layout rules**
- One model, two orientations: `horizontal` when the pane is inline, `vertical` when docked. Inline falls back to vertical only when the horizontal board is taller than the pane at rest and the vertical one fits the columns. The direction never depends on the selection or on the inspector opening (`turnRoom`).
- **Vertical: cards fill the width.** Every card is as wide as its list (`width`, the pane's columns, at most `BOARD_MAX_W` 100); a container's children are 4 columns narrower. Branches of a `parallel`/`sweep`/`branch` stand side by side and share the width down to `BRANCH_MIN_W` 18; past that the box grows and the board pans sideways.
- **Horizontal:** a card is as wide as its words (16 to 30; 28 minimum with a run); the selected one grows to `EXPANDED_W` 40 so its notes can wrap.
- **A card's text:** the title, then one **meta row** (`metaLine`): the knobs, each with its name so it reads with no context (`model: sonnet · effort: low · isolation: worktree · as: <agentType> · 3 votes · until: 2 dry rounds`, `knobLine`), `each: …` for a leaf that fans out, then `out: <schema knob>`. No notes: a card that is not selected is four rows, three with no meta. `out:` is therefore on every block that has a schema, selected or not.
- **The selected card expands:** between the title and the meta row, all its notes (with none, its prompt) word-wrapped, up to `expandRows(orientation, room)` rows (a third of the board's rows, 3 to 10; horizontal 2 to 4), then `… N more lines` (horizontal: the last line ends in `…`). A selected container says its notes above its children. The notes are read here and nowhere else: the inspector has the field, not a copy. Growth is tweened with the cards' slide (`motionH` beside `motionX`/`motionY`), and the window scrolls so the whole card shows with a cell to spare on each side (`revealPadded`).
- **Bottom border:** a leaf's is free for the run's status. A container's says its meta (knobs, `out:`) from the left, after its `+`; with a run the status follows it, and the meta is cut to make room.
- **Container wording:** header `id type ×N · title · each: <fanout knob without its count>`; `out:` is the `schema` knob. No new fields. The title keeps at least half the header's room; both are cut with `…`.
- Container = a box around its children. `pipeline`, `loop`, `loop-until-dry` and the top level are **chains**; `parallel`, `sweep`, `branch` are **stacks** (no edges between children).
- **Connectors:** vertical, one row between two stacked siblings and nothing else: `│` (each result handed on) or `║` (barrier), the head `▼` on the next card's top border (`╭─▼ n6 …`), always two columns in from the list's left edge. Horizontal keeps `─▶` / `═▶`. Edge kind is derived: inside a `pipeline` always stream; elsewhere barrier when the source yields many results.
- **Fan-out:** `×N` in the header, from the `fanout` knob only since round 2 (`×n` with no count; nothing for a count of one; votes are never a `×`) and a double-line bottom border, `╘═══╛` (`╚═══╝` on the selected card): `card.fanned`, `FAN_BOTTOM`. No rows of its own, both orientations. Borders stacked under the box were tried first and dropped: nested, they cost up to three rows a card.
- **Compact (`z`):** every leaf that is not selected is one row, `╶── n3 agent · review ───╴` (the run's count at its right end); containers keep their boxes, the selected card stays expanded. Top to bottom, branches of a `parallel`/`sweep`/`branch` are listed one under the other at full width (`flowAxis(flow, orientation, compact)`; side by side each was a few cells: `Repeat-…`), and the arrows follow (`navigate` takes `compact`).
- **Compact is per placement:** `designUi.compact = { dock, inline }`, inline `true` and docked `false` to start (`COMPACT_DEFAULT`). `z` flips the one for where the pane sits (a board key carries its `placement`); both outlive the design shown (`carryUi`), for the session.
- **Slots:** every list has a slot per insertion index. Its `+` is drawn only (`slotVisible`) before and after the selected card, at the end of the list the selection is in, at the end of the selected container's own list, at the end of the top level, and in an empty container. Every other `+` shows while the pointer is on it (the Client keeps `hover`) and takes a click either way; all slots take a drop. Where it stands says what it adds to: between two cards on the connector's row, three cells right of the line; **the end of a container's list on that container's bottom border** (`╰─ + ──`); the end of the top level on a row of its own (`+ add block`); an empty container holds one `+ add first block` row. Before the first card of a list a slot only takes a drop.
- **Past the window:** the first row says `▲ N more above`, the last `▼ N more below` (N blocks wholly out of view; without N when only part of one is). Sideways a `◀`/`▶` on the empty cell of the edge column nearest mid-height. When a container's header is scrolled off and its body shows, its header is drawn on the first row (sticky, the innermost container; `stickyCards`), carrying the `▲` words.
- **Colour:** each type has its accent (`ACCENT` in `theme.ts`); none is dim (`code` is `ide`). Selection is shape: heavy border, bold header and title, in the type's own colour. `claude` marks only what can be pressed (`edit`, `del`, a `+` in use, a card in hand). `inactive` is a block a finished run never reached, and a card lifted by a drag.
- The region is as tall as the board up to the pane's room; past that it pans (drag the background; the selection is scrolled into view; a card held at the edge pans).
- Agents no block claims are one `unmapped ×N` card after the design.

**Pane chrome** (the order of the rows, the key rows, the type picker and who holds the keyboard changed in Review round 3, last section; where the two differ, that section stands)
- Header row, the board, a **message row** when there is something to say, **one key row**, the inspector. No legend row, no file row: both are in the help card (`c`). While a card is dragged, what a release does is said beside it (`n6 critic · drop into n2`).
- **Header (see Review round 2: one row, lint count, goal):** `wf: <name>`, and at the right the plain word `design` (a label; the old `design ▸ run` looked pressable and was not) or, with a run laid over the design, its summary (`runSummary`): `run running · 5/9 agents done · 1 failed · 57.4k tokens · 4.5s`, `run finished · …` after. On a second row where it does not fit beside the name.
- **Message row**, directly under the board: `designUi.notice` (a refused edit, the delete question, `run: <preflight> · Enter sends /conductor run <name>`), else what a grab's keys do, else while locked `run in progress · editing locked · keys in the prompt? /conductor returns them`. Nothing is said below the inspector any more.
- Key row (round 2 added `d n v q`; two rows docked): `h: ← j: ↓ k: ↑ l: → a: add i: in x: del g: grab e: edit z: compact c: ? r: run`, 78 cells. A Button takes one hotkey, so the four directions are four Buttons (`hjkl: move` is not possible). The row wraps where the pane is narrower; its rows are counted (`wrapRows`). **While a run locks editing** only what still works is drawn: `h j k l z c` (`LOCKED_OPS`); the ring then rests on `↓` (`HOME_LOCKED_KEY`), `edit` not being there.
- **Inspector, docked:** headline, lints (wrapped, counted), the agents of a run, then one field per row: `title`, `notes (what it does)`, and the text knobs of the block's type, then one row of pickers. Editable fields only: no copy of the notes. While locked: headline, lints, agents, no fields. The board keeps at least 55% of the pane's rows.
- **Which knobs a type gets** is one table, `KNOBS_BY_TYPE` in `teach.ts` (`knobsOf(node)` adds any knob the block carries anyway, so nothing set is out of reach). Text knobs (`TEXT_KNOBS`: `prompt`, `fanout`, `until`, `schema`, `agentType`) are fields keyed `design-knob:<knob>`; `model`, `effort`, `isolation`, `votes` are Selects. Labels and placeholders: `FIELD_LABEL`, `FIELD_PLACEHOLDER`; `notes (what it does)` is for the reader, `prompt (tell the agent)` for the agent.
- **Inspector, inline:** one line (`n4 · verify · title — notes…`) until a field is being typed in (`designUi.editing`: set by `e`, by `edit` on the card, by a block just added, or by the ring landing on a field; cleared when the field is sent, the selection changes, another key comes, or the person moves the ring off). Open, the short fields go two to a row, then `notes` and `prompt`; no headline and no agent list. While open the board shrinks, never turns.
- **Help card (`c`)** takes the inspector's place, a page a press (`designUi.help` 1 to `HELP_PAGES` 3, then 0): the selected type's card, the board's marks, mouse and keys and the file. Lines are wrapped and counted, so the board keeps its rows (inline it may go down to 3 under the card).
- **Add picker** takes the key row's and the inspector's place: the field, then a row per match (`PICK_ROWS`: 12 docked, 4 inline; the rest are a count), each the type's id and its `TEACH` hint. No glyphs. The block added is selected with `editing` on and `freshId` set: its title field has the ring and is empty, the default title shown as placeholder; Enter on nothing keeps the default.
- **Template picker** ends with the chat route: `or type: /conductor draft <name> <what you want>`.
- **Empty board:** while `designUi.drafting` (set by `/conductor draft`, cleared by the first edit that lands or a block added by hand) the board and the inspector line say `Claude is drafting this design: …` in place of `+ add the first block`.

**Editing model** (round 3 changed what a drag and a click do, and added undo: see the last section)
- Single source of truth: selection, grab, picker place, the delete question, `compact` and `editing` live in `designUi` (hooks). The Client keeps only pan, a drag in flight, the hovered slot and card motion.
- Messages: `select`, `move {id, to}`, `addAt {at}`, `remove {id}`, `edit {id}`, `key {op, orientation}`. One per input.
- Click a card: select. Click a `+`: the hooks-tree type picker opens for that place. Drag: the card is drawn dashed where it stood, a bar marks the nearest slot within reach, release posts one `move`; no slot near, off the board, or its own place cancels.
- The selected card's bottom border carries `edit` and `del`; `del` on a container with children turns into `delete all?` and needs a second click.
- **One key model.** The letters `h j k l a i x g e z c r` do the same whether the toolbar's Buttons or the clicked board hold the keyboard (`KEY_OPS` mirrors the toolbar; a kit test drives both and compares the state after every key). `e` and a `+` from the board first take the keyboard back for the pane (`$.ui.open` with `focus`), then move the ring to the field. Not identical, by the engine: the arrows (on the board they move the selection; on the toolbar they move the focus ring), Enter (edit on the board; on the toolbar it presses the Button under the ring, which rests on `edit`, so the same until the person moves the ring), Escape (on the board it lets go of a grab or the picker; elsewhere the engine hands the keys to the prompt).
- Along the sibling axis the direction keys go to the previous or next block; across it, forward into a container, backward out. With a block grabbed they call `moveBy` ±1.
- Run overlay: on each card's bottom border, status glyph and `2/4 done · 1 failed · 22.3k` (`runWords`: agents that ended well of agents started, failures by name, tokens once there are any; containers sum their children). A border too short takes the next shorter wording (`fitStatus`: without tokens, then `2/4 · 1 failed`, then `2/4`). Never-reached blocks dim with `not run`. While running: no `+`, no `edit`/`del`, a press only selects or pans. The selected block's agents are listed in the inspector.
- **Following the run:** while `designUi.follow` holds, the selection is put on the block that is running (`runningBlock`: the last in design order with an agent running), so the board scrolls there and the inspector lists its agents. Any move of the selection by the person (an arrow, a click) clears `follow`; a handoff or a replay sets it again. It is written by run.tsx's `write` (the tracker's state write), since no hook of design.tsx runs when the run moves and a drawing may not write state.
- **Elapsed time:** `runTimes` atom (`stampTimes`), stamped by run.tsx as the state is written and about once a second on the frame tick; the drawing reads the atom, never the clock.
- **Preflight:** `r` and `/conductor run <name> [fill]` say `agents = N · problems in n3, n5` (`preflight`, `preflightLine` in `lints.ts`; `agents ≥ N (more: …)` where a count is open; the blocks that have a problem are named, not counted) before handing off. A floor: a fan-out or votes multiplies only where it is a number; branches side by side count the larger of their own agents and the stated count; one path of a `branch`; a loop once; `code` and `subworkflow` nothing. It informs, never blocks.
- **Bare `/conductor`** (`bareTarget`, asked by both hooks modules): a run in progress → its design, or the phase view when it came from none; otherwise the design last opened this session with the keyboard (the template picker for `untitled` with none); a finished run from no design, with no design opened, is still the phase view. Never the empty run view.
- **Selection kept:** `designUi.picks` holds the block each design was left on; reopening a design selects it (`openDesign(name, text, previous)`).

**Findings**
- Drawn by cell: each board row is a `Box` row of `Text` spans. Nested bordered Boxes cannot put a title on a border, draw an edge between two boxes, or pan. A `Text` nested in a `Text` cannot start a hover group, hence sibling spans.
- A tree is refused past 100,000 characters: `paintWeight` estimates it and the board repaints without colours past 70,000.
- `rows`/`columns` on `$.ui.open` are requests: 28 rows were asked and a 50-row terminal gave `scroll.bodyRows` 14 inline. A dock's width the person dragged is kept and wins over the request (86 was asked, the kept 72 was given until the border was dragged).
- `Input` has no multi-line prop (`InputProps`: key, label, placeholder, value, submitLabel, autoFocus, onInput, onSubmit). In real paint a **focused** field wraps its text over as many rows as it takes; at rest it is one line cut with `…`. The pane reserves rows for the focused one (`inspectorTyping`).
- **An `Input`'s own `label` is squeezed by a long value:** it lost its trailing space (`notes:Each…`), and a longer label wrapped onto a second row (the "empty row under a long field" seen before was this). The mod draws the label itself, a `Text` in a `Box flexShrink={0}` beside the label-less `Input` in a `Box flexGrow={1}`: one row whatever the value. Two such pairs sit side by side in a row at `width="50%"` each.
- **Edit focus (was three outcomes for one key sequence):** after a Select was used the ring stayed on it, and `e` moved the ring in the same breath as the state write that redraws the pane. Now every Select's pick sends the ring home, and every move of the ring to a field is made one redraw later (`FOCUS_DELAY_MS`) with one retry, whatever held the ring. `e Tab×6 ↓ Enter e <letter> Enter` gave the same result three times running.
- **Dock width:** `command.run` carries `e.presentation.columns`, the terminal's width; no other hook is told it, so it is remembered in a module variable. `dockColumns` asks for at most 55% of it less 3 (56 with the width unknown). **A kept width wins:** Claude Code stores the dock's width in `~/.claude.json` (`dockColumns`, 87 here), and with it set a 110-column terminal still gave the dock 85 and the transcript 24 after asking for 57, also after closing and reopening the pane. The mod cannot change that; dragging the dock's border does.
- A drawing that reads `$.clock.now()` is invalidated by the clock (`ui.render`: "a clock invalidates"): times are stamped into an atom elsewhere.
- A replay reuses its run id (`replay:<name>`), so the times are reset by the replay command, not by the id changing.
- A pointer `move` with no button reaches `onPointer` (tmux: SGR code 35): that is how the `[+]` the pointer is on is lit (every `[+]` is drawn now; on the flow board it was how a hidden one showed). One `setState` per change of slot, none while the pointer stays on it.
- `$.ui.open({ focus: true })` on the open pane takes the keyboard back from a clicked Client; `$.ui.focus` then lands on a field. A `ui.focus` hook sees the ring move (`e.element`, `e.origin.kind`).
- A hot reload of the plugin hands the keyboard to the prompt.
- A string sent to a focused Client in one burst arrives as a single paste key and is ignored; Escape first hands the keys back to the prompt.
- Text measures by code unit: a title with wide or combined characters misaligns its card.
- No wheel reaches a Client (`ClientPointerEvent` has none). The pane's own `ui.scroll` event carries wheel ticks; panning the board from it is not built.

## Design from chat

Claude drafts and changes a design; the board follows live. Pure logic in `src/design/chat.ts`, hooks in `hooks/design.tsx`.

**Mechanism**
- **A model-callable tool**, `mcp__conductor__design`, registered with `$.tool.register` in a `session.start` hook (`isDeferred: true` now: only its name is in every turn and Claude loads the schema with ToolSearch; every brief that wants it used names it in full, see "Before a workflow, a run on a design, and what Claude is sent") and served by a `tool.call` hook on that name. The hook edits the mod's own atoms, so the pane redraws from state and nothing unchecked is saved.
- **No system-prompt section.** The tool's description carries the vocabulary; `prompt.compose` is not hooked.
- **The description is generated** (`toolDescription()`): one line per type from `NODE_TYPES` + `TEACH[type].hint` + `canHoldChildren`, the knobs from `KNOB_HELP` (new, in `teach.ts`, typed `Record<keyof Knobs, string>` so a new knob cannot be left out). About 2,600 characters. The long cards (`TEACH[type].card`) are the board's help page only: Claude is not sent them (the `guide` action that answered with them is removed).
- **`/conductor draft <name> <description…>`**: saves an empty design with that description, shows it (pane opened without `focus`, `designUi.drafting` set so the empty board says Claude is drafting), answers with `context` (`draftBrief`: the tool's full name, one `write` call, the two `DRAFT_RULES` sentences, what to say afterwards; no guide) and submits `Draft the "<name>" workflow design: …` from `$.clock.after(SUBMIT_DELAY_MS)`, as the handoff does. Refused when a design of that name already holds blocks.
- **Write/Edit follow-up**: a `tool.call` hook on `{ tool: ['Write', 'Edit'] }`. When `file_path` is a design file (`designOfPath`), after `next(e)` the open design of that name is re-read and re-parsed: valid, it replaces the board's; invalid, a toast and the last good design stays. Before `next(e)` the run lock denies the call.

**Tool contract** (`TOOL_SCHEMA`)
- `action: read` → the design JSON, whether it is open, the selected block ("this block"), whether a run locks it, the lints.
- `action: apply`, `ops: [...]`, in order, all or nothing (`applyOps`): `add` (type, title, notes?, knobs?, children? nested; placed by `after` | `before` a sibling id, or `parent` a container id, else the end of the top level), `update` (`id` + title | notes | knobs | type; a knob set to `""` is cleared), `move` (`id` + after | before | parent), `remove` (`id`).
- `action: write`, `nodes: [...]` (`replaceDesign`): the whole tree. A block whose id exists in the design as it stood keeps it; every other block gets a fresh id from the high-water mark, whatever id it came with.
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
- Not built: following a design file changed outside Claude's tools (no file watch), a diff shown before applying. (Undo of a chat edit: round 3.)

## Review round 2

**Lints** (`lints.ts`; 6 to 10 are structural, no keyword heuristics). Every message says what is wrong and how to fix it.
6. `agent-no-brief`: an `agent` with neither notes nor a `prompt` knob.
7. `no-votes`: a `verify` or `judge-panel` whose `votes` is unset.
8. `verify-nothing-before`: a `verify` nothing reaches (`hasInput`): no block before it in its own chain or any chain around it (the top level, `pipeline`, `loop`, `loop-until-dry`), no container around it with a `fanout`, and not in a loop beside other blocks.
9. `single-branch`: a `parallel` or `sweep` holding exactly one block where neither states a `fanout` (one block run once per item is a real use).
10. `loop-no-decider`: a `loop` / `loop-until-dry` with blocks, whose last block of a round (`producer`: the last stage, followed into containers, not into a `branch`) is a model's answer (`agent`, `verify`, `judge-panel`, `critic`) with no `schema`, so the stop test has nothing exact to read; or is a `critic` while the loop has no `until`. A round ending in `code`, a `branch` or a `subworkflow` is left alone.
- Findable: the header says `▲ N`; `n` (`nextLint`) selects the next block with a lint in design order, round again from the top, and is drawn only while a lint stands; `preflightLine` names the blocks, `2 lints (n3, n5)` (`LINT_IDS_MAX` 6). (As it stands now, last section: no count anywhere, no key for the next one; `preflightLine` says `problems in n3, n5`.)

**The goal.** `design.description` (no new field) is drawn under the header docked (`goal: …`, or `goal: not said yet · d: say what this workflow is for`), after the name inline. `d` (`describe`, `designUi.describing`) opens its field (`design-description`) on rows of its own, where a focused field wraps; Enter saves (`describeDesign`). The handoff's second line is `Goal of the workflow (the design's \`description\`): …`, and it says a block's `prompt` knob is the intent for that agent's prompt. The chat tool's description says the same of `description`.

**Handoff by prompt.** `r` fills `Implement and run the "<name>" workflow design on: ` (`handoffPrompt`) and submits nothing. A pane handler cannot answer as a command does, so the conventions travel with the prompt: a `prompt.submit` hook matched on `{ text: /^\s*Implement and run the "/ }` reads the named design's file, calls `tracker.handoff`, and attaches `buildHandoff(...).context` with `next({ ...e, context })`. `/conductor run <name> [fill]` still answers with `context` as before and sets a module flag (`delivered`) so the hook does not attach it twice; `fill` now leaves the same `… on: ` request. The command also shows the design it runs (`openDesign`) when the pane was on another. Label, phase and name conventions are unchanged.

**Run.**
- `runSummary(run, elapsed, room)` picks the longest wording that fits: the header is one row always. Order of loss: the long words, the time, the tokens, the failures or the count; the status stays. `0 failed` is not said.
- Run end: `endRun` (run.tsx's `write`, once, while `follow` held) selects the first block with a failed agent (`failedBlock`).
- `designUi.runCleared`: the results of a run that is over are put away by the first edit that changes the design (`settle`, `showEdit`) or by `q` (`clearRun`, drawn only while results show); `overlaysDesign` is false from then until the next handoff or replay.
- Status line: `statusText(state, titles)` names the running block (`wf 3/4 ▸ n3 review`; `Handoff.titles`, from `handoffOf`); with no design, the phase, and nothing for agents with no phase. **The `⚠ conductor:` before it is the engine's**: `$.ui.status` takes a text and nothing else.
- Replay designs (`replay-<template>`, `SCRATCH_PREFIX`, `isSaved`) are held in state only: never written, never listed, not handed off, and always made from the template.

**Teaching.** `TEACH[type].hint` is plain words (no "barrier"); `TEACH[type].when` is the `use when: …` line (`useWhen`), both at most 70 characters. Shown: the inspector's headline (two rows), the add picker (each type's hint; `use when` for the best match, the one Enter adds), the help card, and the tool description (`- type (container): <hint>. Use when <when>.`, about 3,600 characters in all). The verify type is `verify` everywhere.

**Coming back.** `/conductor design` with no name, and bare `/conductor` with nothing opened: `designUi.saved` (read by the command: name, block count, description) is listed as Buttons above the templates; a template then starts `freeName` (`untitled`, `untitled-2`, …). `/conductor list` prints the same lines.

**Other.**
- Fields: what is typed in a block's fields is kept in a module variable (`drafts`, not state: a keystroke must not redraw) and Enter on any field saves them all (`save`). This is the fix for a new block's title lost on Tab.
- `×N` is a fan-out only (`fanOf`); votes keep the barrier edge (`edgeKind`) but get no `×` and no double border. `eachOf` drops a leading `each` / `for each` / `each of the`.
- Inspector: a `type` Select first in the picker row (`retypeBlock`, `retypeChoices`: containers only while the block holds blocks).
- Add picker: its label says the place, `+ add after n4 (in n2)`, `first in n2`, `after n5 (at the end)` (`placeLabel`).
- Key row: `… e: edit d: goal z: compact c: ? [n: next lint] v: ask Claude r: run [q: clear run]`; two rows at 85 columns. `v` fills `reviewPrompt`.
- Inline: the board's region takes all the room left (`boardView` `fill`), so the pane keeps its height (the frame's `bodyRows`) whatever is selected and during a run; the board pans inside.
- Message row: up to two rows. While locked the hint to type `/conductor` shows only when the pane does not hold the keyboard.
- User-visible text says "block", never "node" (the handoff's hidden conventions keep `nodeId`).

**Findings**
- `e.props.isFocused` (Pane render props) is false once Escape hands the keys to the prompt; no `ui.focus` is raised for that. An inline pane's fields are collapsed on it.
- A `prompt.submit` matcher takes `text` as a regular expression; context attached on the way down reached the model (it read the design file named there).
- An `Input`'s `⏎ <submitLabel>` is not counted in the field's width: with a long value the label wrapped under the field. `submitLabel=""` draws the `⏎` alone, on the same row. In a row beside its label a focused field is cut with `…` and does not wrap; alone on its rows it wraps (the goal's field).
- `$.fs.list` entries are read one by one for the picker and `/conductor list` (at most `SAVED_MAX` 60).

## Review round 3: safety and coherence

Replaced by "Redesign v1" (last section): the cue as hotkey Buttons, the two key rows and the whole **Layout** part, the type picker's rows, the compact rule under **Branch arms**, and `edit` / `del` under **Pointer**. Still current: what a mod can know of the keyboard, "the board never keeps the keyboard", the refusal (`handed`), `r` and the review key handing the keys to the prompt, undo, the revisions Claude reads, drag-only-the-selected-card.

Nothing done by accident may damage a design, and the screen holds still.

**Who has the keyboard** (`hooks/design.tsx`)
- **What a mod can know.** `e.props.isFocused` of the Pane render is true only while the pane's own ring holds the keys (its Buttons, fields); the pane is redrawn when that changes (Escape, a chat turn, a reload, a resize were all seen to redraw it with `false`). It is **false while a clicked `Client` holds the keys**, and nothing tells a hook when the Client loses them again (Escape never reaches `onKey`, no event is raised, the pane is not redrawn). `$.ui.panes()` asked right after `$.ui.open({ focus: true })` still says `isFocused: false`. `$.ui.focus` is refused (`{ deny }`) in a site that does not hold the keys: that is the probe.
- **So the board never keeps the keyboard.** Every pointer release posts one message (`select`, `move`, `addAt`, or `touch` when it asked for nothing), and the `ui.message` hook answers a pointer message with `$.ui.open(paneArgs(true))` and, a redraw later, `$.ui.focus` onto the home key (or the field an `edit` / `+` needs). The keys are then the pane's, and `isFocused` tells the truth from there on. Cost: the arrows and Enter no longer act on the board after a click (they are the ring's); `h j k l e` do.
- **Refused** (the engine gives a pane the keys only over an empty prompt box): the Client keeps the keyboard. `designUi.handed` is set, the board gets `hold` and answers no key (`reduceKey`), `applyOp` does nothing but say `HANDED_NOTICE` (`keys are off here while the prompt box holds text · Esc returns to the prompt`). Cleared by the next pointer message whose probe succeeds, by `prompt.submit`, by any `/conductor`.
- **`r` and `v` hand the keys to the prompt.** No call moves the keyboard from a pane to the prompt. After `$.prompt.fill` took the request, the pane is closed and opened again without `focus` (`$.ui.close`, `$.ui.open(paneArgs(false))`): the keys are then the prompt's and the pane is still shown (the Client remounts: its pan is lost, the selection is scrolled back into view). A probe follows; if the ring can still be moved, `handed` is set as above. Seen live: `r`, then `xj the diff` typed at once, all of it in the prompt box, no block touched.
- **The cue.** Pane focused: each key is a `Button` with its `hotkey` (the letter in the accent colour). Not focused: the same Buttons without `hotkey`, `dimColor`, label `e: edit` (still clickable), and `KEYS_CUE` (`keys are in the prompt · click the board or /conductor`) on the message row, first (round 4: before anything else said there; inline at the start of the status line).
- **Escape** always hands the keys to the prompt and cannot be heard. The add / type picker is drawn only while the pane is focused (`picking`), so Escape closes it to the eye and the board is back; `/conductor`, a click on the board or any key op clears `designUi.picker`.

**Undo** (`src/design/history.ts`, held in `hooks/design.tsx`)
- `History = { undo, redo }` of `{ design, what }`, per design name, `HISTORY_MAX` 50, in a module variable (`histories`): not state (fifty designs). Seen in round 4: it survives `/reload-plugins` (the module is not evaluated again while its source is unchanged) and is lost when the module is loaded again after a source change, and with the session.
- One choke point: a `Step` that changed the design carries `what` (the change in words); `store` (pane handlers) and the `ui.message` hook call `record(name, before, what)`; the tool hook and the Write/Edit follow-up record `Claude added n12; changed n3` / `the file …`.
- `u` / `y` (`undo`, `redo` in `BoardOp`, on the first key row): `timeTravel` → `travel` → `restoreDesign`. The selection goes to a block the step brought back. `nextId` never goes back, so ids are not reused after an undone add.
- Every announcement of a change ends `· u: undo` (`settle` builds it from `what`): `deleted n7 "verify" · u: undo`, `moved n7 after n11 · u: undo` (`whereIs`; drag and grab alike), `added n12 agent after n4`, `n3 changed: title, notes`, `n6 is now a verify`, `goal changed`, `Claude added n10`. After `u`: `undone: … · y: redo`. `noticeInforms` draws these plain; a refusal or a question stays `warning`.
- An edit that changes nothing (Enter on an untouched field) is no change: `settle` compares the designs, nothing is saved or recorded.
- A single block is deleted at once; a container that holds blocks still asks (`x again deletes them all (u undoes it)`).

**Claude reads the board as it is** (the cause of a review of a deleted block: the tool said "read first unless you just did", and Claude had)
- `revisions[name]` counts every change this load (by hand, chat, undo); `seenByClaude[name]` is the count at Claude's last `read` or own edit. `readReport` / `editReport` name the revision.
- `prompt.submit` (now matched on every prompt, `{ text: /^/ }`): when the open design's revision differs from what Claude saw, a note is attached as context, once per revision: `changedNote` (the change itself) where the design Claude last saw is at hand, else `staleNote` (read again). The same hook still attaches the hand-off conventions.
- An `apply` / `write` from an older revision is denied, with the reason only (`The user changed design … so this edit was made from a board that is gone. Nothing was changed.`).
- The tool description, every `read` / edit answer and `reviewPrompt` say the same rule: read first, unless a Conductor note with the prompt has said what changed.
- Seen live: chat edit, then `n6` deleted by hand, `v`, send: Claude called `read` (revision 2) and answered `n6 is gone (removed by hand)`.

**Pointer** (`board-model.ts`)
- Only the **selected** card is picked up by a drag (`BoardDrag` `card`). A press on any other card, a container's body or the background is `pan`; released on the cell it went down on, a card pressed is selected (`select` is posted on release, no longer on press).
- A `+` is `slot`: its picker opens only when the release is on the same `+`.
- `edit` / `del` on the selected card still act on press.

**Layout** (`hooks/design.tsx` render, `boardView`)
- Docked, top to bottom: header; goal (wrapped, up to `GOAL_ROWS` 3); the board (`fill`: every row the rest leaves, so the pane is always `bodyRows` tall); a rule; the inspector; the message row (always one row, a second when the text needs it); two key rows. Only the board changes size. One row at the pane's bottom stays blank: `scroll.bodyRows` is one less than what the frame shows.
- Key rows (`BLOCK_KEYS`, `DESIGN_KEYS`): `h j k l a i x g e u y` act on the block, `d z n v r c q` on the design. Each key stands in a `Box` as wide as its longest label (`cells`); a key that does not apply now (`n` with no lint, `q` with no results, most of them while locked) leaves its cell blank, so no key shifts. `?` cannot be a Button hotkey (one digit or lowercase letter): help is `c`.
- Inline: header, board, lines said in the board's free rows (below), the status line (what was just said, else the block's summary), the fields while `editing`, one key row. Labels are short (`v: ask`, `c: ?`, `n: lint`, `q: clear`), keys that cannot work now are left out, and since round 4 none is dropped: the keys wrap onto a second row where one cannot hold them (see Review round 4).
- `z` does not turn an inline board: `chooseOrientation` is asked for the compact board whatever `z` says.
- **Free rows** (`room - view.height`, the board shorter than its region) are used, and the region shrinks by as many: docked the headline wraps and a long `notes` / `prompt` continues under its field, dim, from the word the field cut (`overflow`, `WRAP_EXTRA` 3 rows each; an `Input` at rest is one line and cannot wrap); inline the selected block's lints and, after a run, `✗ failed: <labels>`.
- **Type picker.** The engine's `Select` shows eight options and scrolls the rest with no marker. The block's type is picked from the add picker instead (`designUi.picker.retypeId`, `openRetype`, `pickBlock` → `retypeBlock`): docked all twelve types with their hints, none scrolled; inline four and `… N more types: type to narrow`.

**Branch arms**
- `armNote`: an `add` with `after` / `before` whose target stands directly in a `branch` answers `Note: n10 was added as a new arm of branch n7 … wrap the two in a pipeline` (`parallel` / `sweep`: `run at the same time`). The tool description states the rule in one sentence.
- Board: `layout.rules`. Top to bottom, side by side: the word in the gap (`stackGap`: 4 cells for `or`, 3 for `∥`). Compact (one under the other): a dotted row with the word between two blocks. Left to right a stack stands across the flow and gets no rule (the arrows tell the sequence).

**Small things**
- Preflight: `agentsText`: `agents = 12` when every count is stated, else `agents ≥ 12 (more: 2 blocks fan out over an unknown number, 1 loop repeats, 1 subworkflow starts its own)`.
- Header: `running · …` / `finished · …`. `unmapped` card: no `×`, no double border; its title says the count.
- `▼ N more below` always has a number: the blocks wholly out of view, or `N more rows` when only part of one is.
- A retyped block still titled after its old type takes the new type's name. `TEACH[type].name` is the type's id everywhere.
- `startDesign` writes nothing: a template is saved by its first edit, by `r` / a hand-off prompt, or by `/conductor run`.
- `/conductor delete <name> [confirm]`: `$.fs` has no delete, the file is removed with `$.process.run(['rm', '--', path])`.

**Findings**
- A burst of text sent to a focused pane whose first character is no hotkey lands in the prompt box whole.
- `ui.open` from a `ui.message` hook is logged `unasked`; it was placed (175 columns) for a pane the person had opened; narrower terminals were not tried for that path.
- First real hand-off by prompt (`r`, finish the sentence, Enter), design of three `agent` blocks (`haiku`, `low`): Claude read the file, loaded the workflow skill, wrote the script with labels `n1: prime` … and one phase per block; the overlay showed `1/1 done` on each block, none unmapped; the header went `running · 3/3 agents done` → `finished · 3/3 agents done · 105k tokens · 15s` (the 15 s include the 8 s quiet period that ends a run).
- Tests were not touched in this round and were not run: those that drive the old pointer rules (select on press, `+` on press), the old key row and the confirm text will need updating.

## Review round 4: typed text is kept, and the keyboard is where the pane says

Replaced by "Redesign v1" (last section): the home key and the rewrite of the ring onto it ("No arrow-then-Enter runs or deletes"), the inline key rows and the `prompt.edit` swallow ("The pane never advertises a key that goes to the prompt"), "Short terminals", and `overflow` under "Leftovers". Still current: `drafts` and `flushDrafts`, the ring's engine facts, `settleRing`, the cue first on the message row (`KEYS_CUE`, `withoutKeys`), names.

**Typed field text is never dropped** (`hooks/design.tsx`: `drafts`, `flushDrafts`)
- `drafts = { name, id, values, goal }`: what was typed and not saved, for one block of one design, by field (`design-notes`, `design-knob:fanout`), and for the goal's field. A module variable (a keystroke must not redraw the pane).
- `flushDrafts($)` saves them as one edit through `patchNode` / `describeDesign`: recorded for undo, written to the file, announced (`n5 changed: notes, fanout · u: undo`). Calls are chained (`flushing`), so two hooks asking at once save once and the second acts on the saved design.
- It is called before anything else acts, on every way out of a field a hook hears of: `ui.focus` with origin `person` (Tab to another field, a click on a picker), a field's Enter, a `Select`'s choice (`choose`), the type button, the add/type picker (`pick`), a key Button (`press`), `ui.message` (a click on the board, a key of its), `command.run` (every `/conductor`, so before another design opens, a run, a rename), `prompt.submit` (the hand-off reads the file), the design tool's `tool.call` (then an edit Claude sends without reading is refused as stale, not written over the text), Write/Edit on the design file, `ui.close`.
- **And where no hook hears of it, a drawing does.** The pane is redrawn with `isFocused: false` when the keys leave (Escape, a chat turn, a resize, a click on the board). A drawing that finds drafts whose field can no longer be typed in (pane not focused, another placement or width than the last drawing's, another block selected, another design) asks for a flush (`$.clock.after(0, …)` from the render hook; one at a time, `flushAsked`), and after a loss of the keyboard closes the field (`editing`, `describing` false). So **Escape saves**: seen live, `e`, type, Escape → `keys are in the prompt · click the board or /conductor · n5 changed: title`, the text in the file, `u` takes it back. There is no `discarded` path left for Escape.
- The only drafts not saved: typed for a design no longer on the board (cannot happen through a command: the command flushes first; said with a toast if it does) or while a run locks the design (`unsaved text in notes discarded · run in progress · editing locked`; the fields are not drawn while locked, so not reachable by typing).
- A field's `Input` is keyed by field and block (`fieldKey`: `design-notes@n5`): the engine keeps what was typed in an Input under its key, which is how one block's draft was once drawn as another's title after dock → inline → dock. `isField` / `baseOf` strip the block.
- A flush asked by a drawing can land just before the action that would have asked (a click redraws the pane first): what it said is kept for `SAID_MS` (`justSaid`) and `keepSaid` puts it back when the action left the message row empty.

**The ring** (engine facts, seen live)
- The focus ring is kept **by its place among the stops**, not by key: when the stops before it change (a run ends and the fields are drawn again, a block with other fields is selected), the ring rests on whatever now stands at that place, with **no `ui.focus` raised**. That is how `l j j` after a run's end were typed into `notes`.
- Up / Down walk the ring to the previous / next stop like Shift+Tab / Tab, each raising `ui.focus` (origin `person`); an arrow on a `Select` opens it. A hook is not told which key moved the ring. A click on a Button raises `ui.press` only, no `ui.focus`. The plugin's own `$.ui.focus` does not reach its own `ui.focus` hook (`skipped: re-entry`). The **Left arrow is the engine's** (`← for agents`): it opens the agents list, the pane goes, and on return `$.state` was seen reset (`designUi` back to `closed`) and the debug log no longer written.
- `settleRing($)`: a redraw later, unless a field is asked for (`editing`, `describing`), `$.ui.focus` onto the picker's field while one is open, else the home key. Called after every `$.ui.open({ focus })` of a command, after a template or saved design is picked, by `home()`, and by the render hook whenever this drawing's stops (`ringStops`: lock, picker, help, goal field, block id and knobs, keys drawn) differ from the last one's while the pane is focused.
- A field's `onInput` / `onSubmit` reached while `editing` is false (the ring was left there for the 48 ms before `settleRing` lands) drops the letters and sends the ring home. `editing` is set by the `ui.focus` hook when the person's ring lands on a field (a click on it), and by `e` / a new block.
- `session.start` (first load and every reload) closes what belonged to the moment: `editing`, `describing`, `picker`, `handed`, `grabbedId`, `confirmId`, a `run: …` / `ask: …` / handed notice.

**No arrow-then-Enter runs or deletes**
- Home key is now `key:card` (`c: help`): Enter under a resting ring opens a help page. Locked: `key:down`.
- `ui.focus` hook: a move by the person onto any key Button (`key:*`, `design-run`) other than the home key is rewritten to the home key (`next({ ...e, element: homeKey })`). So on the key rows Up, Down, Tab and Shift+Tab leave the ring where it is; from the last picker Tab lands on help. The keys still answer their letter and a click. `c` sits between `n` and `v` in `DESIGN_KEYS` so that its neighbours are keys, never an engine stop or a field.
- Not possible: telling an arrow from Tab or from a click in `ui.focus`; making arrows move the selection (the direction is not given).

**The pane never advertises a key that goes to the prompt**
- Not focused: the message row is `KEYS_CUE`, then ` · ` and what was said only if `withoutKeys` lets it through (the trailing `· u: undo` / `· y: redo` cut; anything naming another key dropped) and both fit; a `run: …` / `ask: …` line (it speaks of the prompt's own Enter) follows the cue's first half where the whole cue leaves no room. Inline the status line starts with the cue. The empty-design line, the goal's `d:` hint and the help card's `c:` footer lose their key too.
- Inline keys: all that work now, short labels (`a: +`, `z: fold` / `full`, `n: lint`, `c: ?`, `q: clear`), filled greedily into rows (`keyLines`); `INLINE_DROP` is gone. 99 cells hold `h j k l a x g e u y d z c v r` on one row; `i`, `n`, `q` on top of those make a second. A Button with a hotkey and an empty label draws `h:`, so `h j k l` + `move` saves nothing readable: the arrows stay.
- **Unbound letters are swallowed.** A key the pane has no Button for is given to the prompt box and the keyboard goes with it. `prompt.edit` (first used here; matcher `{ text: '' }`, so the hook costs one hop on the first character typed into an empty box and nothing on any other typing) sees it: one letter or digit, right after a drawing that held the keys (`paneHeld`, cleared by `ui.close` and by the swallow itself). It answers `{ text: e.text, cursor: e.cursor }` without `next` (nothing lands in the box), says `b is not a key here`, and takes the keyboard back with `$.ui.open(paneArgs(true))` from a clock callback (inside the hook the take is refused). Checked that prompt typing is not eaten: after Escape, after a click on the prompt box, after closing the pane by its mark and by ctrl+x x. Other characters (space, punctuation, capitals with shift) still go to the prompt, and the cue is drawn at once (the pane is redrawn unfocused).

**Short terminals** (100×30 inline, 8 body rows)
- Inline the tree is never taller than `bodyRows` (a taller one scrolls and the header leaves): the board takes `bodyRows - chrome`, down to no rows at all while the fields, the picker or a help page (cut to `bodyRows - 4` lines) are open (`boardRows`; the `Client` is not drawn at 0).
- `syncBoard`'s `seen` key includes the window's size, so a window that changed size reveals the selected card again; `paintBoard` leaves out the `▲` / `▼` words where they would be written over the selected card's own border.
- Left: with two key rows (redo, a lint or run results at 100 columns) the board has 4 rows and shows the selected card's top four.

**Names**
- `/conductor rename <old> <new>` (`DESIGN_VERBS`, and run.tsx passes the verb on): refuses a `replay-` name on either side, an existing target, a design being run; writes the new file, removes the old (`rm`), moves `histories` / `revisions` / `seenByClaude` / `warnedAt` / `picks`, renames the open board.
- `replay-*` cannot be opened or drafted as a design; `bareTarget` no longer offers a replay's name once its design is gone. The picker says how to name first; a design started as `untitled` says once `named untitled for now · /conductor rename untitled <name> names it` (`isDefaultName`).

**Leftovers**
- `overflow`: the rows under a long field continue at the character the field cut at (`value.slice(width - 1)`; the field shows `width - 1` characters and `…`).
- The `run: …` / `ask: …` line: cleared by `prompt.submit` (any prompt), by `session.start`, and by `watchBox` (reads `$.prompt.read()` every `BOX_POLL_MS` while the line stands, clears it when the box is empty).

**Not exercised this round:** a chat/tool edit arriving while a field holds a draft (code path only; no model turns), `prompt.submit` clearing the run line (same), the desktop surface. Tests were not touched: those on the home key, `INLINE_DROP`, field keys, `KEYS_CUE` placement, `seen` and `bareTarget` will need updating.

## Redesign v1: graph, detail pane, legend

The designer is a workspace of four fixed parts: a graph of the workflow (top to bottom only), a detail pane, a header, and a footer that is a key legend. The keyboard is WASD, typed into a key catcher. The brief it was built from is `docs/redesign-v1/BRIEF.md` (corrected to as-built); this section is the record. It replaces the parts of "UX", "Flow board" and review rounds 3 and 4 named at the top of each. Seen live on Claude Code 2.1.296, terminal, tmux.

```
┌─ SWEEP / multi-modal sweep ×4 · each: search angles: by container, by content, by entity,… ─ n1 ─┐
│ ╭───────────────────────────────────────────────────────────────────────────────────────── n2 ─╮ │
│ │ AGENT / search                                                                           low │ │
│ │ One agent per search angle.                              output: { sources: [{ ref, why }] } │ │
│ ╰──────────────────────────────────────────────────────────────────────────────────────────────╯ │
└────────────────────────────────────────────── [+] ───────────────────────────────────────────────┘
                                             all ⇓  [+]
╭───────────────────────────────────────────────────────────────────────────────────────────── n3 ─╮
│ CODE / dedupe sources                                                                            │
│ Plain code over all sweep results: drop duplicate refs before the expensive reading starts.      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
                                                 ↓  [+]
┌─ PIPELINE / deep read · each: deduped sources · count unknown ────────────────────────────── n4 ─┐
│ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ n5 ━┓ │
│ ┃ AGENT / read source                                                        1 model  2 effort ┃ │
│ ┃ One reader per source.                    output: { claims: [{ claim, quote, confidence }] } ┃ │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                ↓  [+]                                            │
│ ╭───────────────────────────────────────────────────────────────────────────────────────── n6 ─╮ │
│ │ VERIFY / check claims                                                                        │ │
│ │ Drop claims the source does not actually sup…  votes 2 · output: { refuted: boolean, reason… │ │
│ ╰──────────────────────────────────────────────────────────────────────────────────────────────╯ │
└────────────────────────────────────────────── [+] ───────────────────────────────────────────────┘
                                             all ⇓  [+]
╭───────────────────────────────────────────────────────────────────────────────────────────── n7 ─╮
│ CRITIC / completeness critic                                                                     │
│ Asks what is missing: an angle not searched, a claim…  output: { gaps: [{ what, how_to_fill }] } │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
                                                 ↓  [+]
╭───────────────────────────────────────────────────────────────────────────────────────────── n8 ─╮
│ AGENT / merge                                                                                    │
│ Runs once over all verified claims; cite the source of each and state open gaps.                 │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
                                                [+]
```

`bun scripts/render-graph.ts research --cols 100 --rows 40 --select n5`. The README has renders of a branch's arms, a carousel and a nested view; the other cases are `branch-when`, `parallel-9`, `deep-6`, `empty`, `empty-container`, `long` (`--list`).

**Modules**
- `src/ui/graph-layout.ts`: a Design as cards, arrows, slots, gutters, chips and crumbs in cells (`layoutGraph`), the hit tests (`graphAt`), the pan (`panTo`), and the walks over it (`navigate`, `moveTarget`, `viewShows`, `viewFor`, `parentView`, `canOpen`). The layout says the words too, as segments with a role (`Seg`, `SegRole`).
- `src/ui/graph-paint.ts`: a layout as rows of styled spans (`paintGraph`); each role gets its look (`segLook`), and what lies over the cards is drawn: the run, the pointer, a card in hand, cards on the move, the window's edges, the breadcrumb.
- `src/ui/graph-model.ts`: the Client's props (`GraphProps`), its messages (`GraphMessage`, `parseGraphMessage`), its local state and reducer (`GraphState`, `graphReduce`, `syncGraph`, `moveGraph`, `tickGraph`), and the help pages' words on the graph (`LEGEND`, `MOUSE_HELP`).
- `src/ui/keys.ts`: the one key table (`KEY_OPS`, `KeyOp`, `LOCKED_OPS`, `burstKeys`) and the legend made from it (`legendItems`, `legendRows`).
- `src/design/session.ts`: the pane's state and every step on it (`applyOp`, `applyMessage`, `pickBlock`, `typePicker`, …), the view (`viewRootOf`, `graphProps`, `graphOf`), the screen's shape (`detailWidth`, `dockColumns`, `factsLine`), the help pages (`helpPage`, `KEY_HELP`), the start screen (`startEntries`).
- `hooks/design.tsx`: draws the screen, holds the key catcher and the ring, saves. `hooks/canvas.tsx`: the Client, drawing the graph from props.
- `scripts/render-graph.ts`: the layout and the paint as text, with no session.

**The screen** (`ui.render` in `hooks/design.tsx`)
- **Wide** = docked (`placement !== 'inline'`) and `e.props.bodyColumns >= WIDE_MIN_COLUMNS` (100). The pane draws in `columns = bodyColumns - 2`, one cell in from the left. The detail pane is `detailWidth(columns)` wide (`DETAIL_SHARE` 0.3, within `DETAIL_MIN_W` 38 and `DETAIL_MAX_W` 52); three cells of rule (` │ `) stand between it and the graph, which has the rest.
- **Stacked** = docked and narrower, or inline: header, goal, graph, detail pane under it, footer.
- **Rules** (`rule()`, a row of `─` as wide as the pane, in `RULE`): docked, one under the header and goal rows and one above the footer, wide and stacked alike; stacked, one more between graph and detail pane (none while the detail pane is hidden). Inline has none.
- **Rows.** `mainRowsFor(goalRows, stacked)` = `bodyRows` less 1 (header), the goal's rows, the rules (docked 2, a third one stacked, inline 0) and the footer (`footRows`): docked, the legend's rows, 1 where `columns >= LEGEND_CORE_W` and `LEGEND_WRAP_ROWS` 2 under that; inline 2, one row for what was said and one of legend. Wide, graph and detail pane both have all of them. Stacked, the detail pane at rest has `DETAIL_REST_SHARE` 0.45 of them (never leaving the graph under `GRAPH_LEAST_ROWS` 3; inline: one row, its key hints), and while a field, the add list, the goal or a help page is open it takes what that needs. Hidden, it has none. The graph's region gets every row the rest leaves, whatever the graph's own height: it pans inside. The tree is never taller than `bodyRows`.
- **Dock width asked:** `dockColumns(terminalColumns)` = the terminal's columns (from `command.run`'s `e.presentation.columns`) less `DOCK_MARGIN` 30, at least 40; nothing is asked while the width is unknown. Inline `PANE_ROWS` 28 are asked. A kept dock width still wins.
- **Header, row 1** (`headOf(facts)`): `conductor / <name> / <facts>` and at the right the state (`design-state`): `EDITING · saved` | `unsaved template` (`designUi.unsaved`) | `not saved yet` (unsaved and empty) | `replay, not saved`; `DRAFTING`; the run's summary with its first word in capitals (`RUNNING · 5/9 agents done · 57.4k tokens · 4.5s`, `runSummary`, cut to its room); on the start screen `START · a saved design` | `from the <title> template` | `a blank design`. The name is cut to what the state leaves. The facts (`design-facts`, in `suggestion`) are `factsLine` → `agentsCount` in `lints.ts`: the agents the design starts and nothing else, `agents = 18` with every count stated, `agents ≥ 12` where a fan-out names no number, a loop repeats or a subworkflow starts its own; no block count, no problem count. They are left out where the row would leave the name under 8 cells.
- **Row 2:** `Goal: <description>`, up to `GOAL_ROWS` 2 docked (`firstLines`), 1 inline; `not said yet · g sets it` (without the key while not focused or locked). In the designer, unless a run locks it, the rows are a Client (`goalPress`, `hooks/goal.tsx`, element `goal`): `claude` under the pointer, and a click on them (down and up inside) posts to `ui.message`, which opens the goal's field as `g` does. It is no Button, which would be a stop of the ring between the catcher and the title. The click gave the Client the keyboard, so the hook takes it back (`$.ui.open` with focus) before the field opens, and `goalAsked` (for `LANDING_MS` at most) keeps a drawing that still finds the pane unfocused, or a move of the ring, from closing the field meanwhile.
- **What was said** (`saidRow`): `designUi.notice` (`Last change: …` before one that ends in `UNDO_HINT`; plain where `noticeInforms`, else `warning`; `LOCK_NOTICE` while a run locks), on one row, centred, cut to `saidW`. Docked it stands in the rule over the footer (`SAID_RULE_W` 3 cells of rule kept at each side), so no row is kept for it and nothing moves when something is said; inline it has the row over the legend. Not focused: `KEYS_CUE` (`Input: prompt · click the graph or /conductor`) first, as since round 4.
- **Footer** (`legendOf`): the legend and nothing else (`legendItems(…).footer`: the graph's keys and the pane's own), plain `Text`, each key in brackets in `claude` and its word in `FADED`, all dim while not focused; centred, as wide as the pane. Its rows (`legendMost`) depend on the width alone, so the footer keeps its height whatever is selected: docked 1 where `columns >= LEGEND_CORE_W` (112: the `core` keys of the fullest legend on one row, `keys.ts`), else `LEGEND_WRAP_ROWS` 2; inline 1.
- `i` (`designUi.detailHidden`, kept across designs by `carryUi`): the detail pane is not drawn, no row and no column of it, and the graph has its room; the legend then starts with `[i] Show details`. `e`, `n`, `g`, `?` and a click on a `[+]` show it again.

**The graph's layout** (`graph-layout.ts`)
- **Width.** `graphColumns(region)`: between `GRAPH_MIN_W` 12 and `GRAPH_MAX_W` 132; in a wider region the Client centres it (`pad`). Nothing reaches past the columns it was laid out for; there is no `panX`.
- **Chains and stacks** (`childFlow`): the top level, `pipeline`, `loop`, `loop-until-dry` list their blocks one under the other, each as wide as the list (a container's inside is 4 columns narrower), one arrow row between two. `parallel`, `sweep`, `branch` stand their arms side by side at equal widths (`stackShare`; the last arm in view takes the cells the division leaves), every arm as tall as the tallest, the gap between two holding `armWord` on the arms' second row: `OR` (branch; gap 4) or `∥` (gap 3), in `layout.rules`.
- **Leaf** (`leafBox`): top border with the id at the right; row 1 `nameSegs` (`TYPE / Title`, the title left out while it equals the type, `×N` after it for a leaf that fans out, `×n` with no count) and at the right the model and effort that are set (each cut to `KNOB_MAX` 14; left to the detail pane where they do not fit beside the name); row 2 the first line of `cardText` (notes, else the prompt) and at the right `votes N · output: <schema>` (`splitRow`: the right side keeps at most half the row, and is left out under 9 cells). No row 2: three rows tall.
- **Missing but needed** (`missingOf`, `armOf`): `Instruction [not set]` (an agent with no `cardText`), `Stop [not set]` (a `loop` with no `until`; a row inside its box), `IF [not set]`; `NOT_SET` in role `error`.
- **Open container** (`openBox`, `headSegs`): square border in the type's `ACCENT`; the header on the top border is `TYPE / Title ×4`, then what fits of `· each: <eachOf>`, `· until: …`, `· count unknown` (a fan-out with no number, in place of `×n`), and last `· 2–4 of 9` (a carousel's window: it is kept before any knob is). Right: the problem mark and the id (`topRow`). Empty: one row, `empty` (`EMPTY`), and its `[+]` on the bottom border.
- **Selected:** heavy border in `claude`. A selected leaf shows all of `cardText` wrapped, up to `noteRows(rows)` rows (a third of the graph's rows, at most `NOTE_ROWS_MAX` 8, then `… N more lines`), then `output:` on a row of its own; and its **chips** (`chipsOf`, `quickKnobs`) in place of the model and effort: digit, then the knob's value (`2 low`, `3 votes 2`) or its name dim while unset (`1 model`). Chips that do not fit beside the whole title take the next row. A selected container with quick knobs (`sweep`, `loop-until-dry`) carries them on its top border where name and chips both fit. No chips while a run locks. Each chip's cells are in `layout.chips` for a press.
- **Problem mark:** a bare ` ! ` (`BADGE`, role `badge`: inverse, bold, `error`), no count: on the top border directly left of the id (`topRow`), on a leaf and on a container alike; left out where the border cannot hold both. An open container is marked for its own problems; a collapsed one also when a block inside it has one (`problemsIn`). The pane shows no problem count anywhere.
- **Arms of a branch** (`armOf`, `armSegs`): the top border's left says `IF <when>` (the `when` knob, cut), `ELSE` for the last arm with none (when there is more than one arm), `IF [not set]` otherwise. On a container arm the header keeps its least cells and the condition takes what is over.
- **Carousel** (`stackShare`, `GUTTER_W` 3): an arm is never narrower than `ARM_MIN_W` 28. Where all arms at that width do not fit, `shown` of them are drawn between two gutters (both sides keep their 3 columns; `◀` / `▶` and under it the count out of sight, in `claude`, only on a side that has more). `layout.carousels[id] = { first, shown, count }`; `first` is what was asked (`designUi.carousels`, by container id), moved just far enough to hold the selected arm, clamped; `layout.scroll` is what it settled on and `shown()` in session.ts writes it back to state.
- **Collapsed** (`drawnOpen(depth, width)`, `collapsedBox`): a container is drawn open only while it is at most `OPEN_DEPTH` 3 containers below the view's root (itself counted: a top-level block is 1) and its inside (`width - 4`, of its arm's share) has at least `OPEN_MIN_W` 34 columns. Collapsed it is 4 rows: `▸ TYPE / Title` and `N blocks` (all it holds, at any depth), then the titles of its blocks joined by ` → ` (chain) or ` | ` (stack), `empty` with none, and `o: open`. Blocks inside it have no card.
- **Arrows** (`edgeKind`, unchanged): one row, centred on the list; `↓` (stream) or `⇓` with a dim `all ` on its left (barrier).
- **Slots:** one per insertion index, and one mark for all of them, `[+]` (`SLOT`), shown with or without a pointer (there is no `slot.shown`). Between two blocks of a chain it stands on the arrow's row, two cells right of the arrow. The end of any container's list, a chain's or a stack's, is on its bottom border, centred, the `+` on the column of its arrows (`endMark`); an empty container's too, under its `empty` row. The end of the top level is on a row of its own, the `+` under the arrows. An empty design's is a bare `[+]` in the middle of the window, over `EMPTY_KEYS` (left out while the pane does not hold the keyboard, `quiet`) and `EMPTY_NOTE`. `slot.target` marks the one place the keyboard adds at: where the add list is open, else `addPlace(design, selectedId, viewRoot)` in `ops.ts`, the rule `openAdd` opens the list by. The place the add list is open for reads `[+] Add block here` (`SLOT_OPEN`), on a row of its own (`lead`) where it has none (before the first block of a chain, between two arms). Before the first block and between arms a slot otherwise only takes a drop (bar `row` or `column`).
- **Edges of the window** (`edgeMarks`, `stickyCards`): `▲ N more above` / `▼ N more below` (blocks wholly out of view, else rows); the innermost open container whose header scrolled off keeps it on the first row. Left out where they would be written over the selected card's border.
- **Unmapped agents:** one card of 3 rows after the design, at the root only (`UNMAPPED_ID`), `N agents no block claims`.

**Paint and motion** (`graph-paint.ts`, `graph-model.ts`, `hooks/canvas.tsx`)
- Frames: `ROUND` (leaf), `SQUARE` (container), `HEAVY` (selected), `DASHED` (in hand). A leaf's border is `RULE`, a container's its accent, the selection's `claude`; `inactive` for a block a finished run never reached and for a card in hand.
- Colour tokens (`theme.ts`): `FADED` (= `inactive`) for words said quietly, in the graph and in the pane alike (a note, a hint, an id, a legend's word, a `[+]` at rest; it was `subtle`); `RULE` (= `subtle`) for lines that are not words (a leaf's border, the rules of the pane); `ACTIVE` (= `claude`) for the active `[+]`.
- `[+]` (`paintGraph`): `FADED` at rest; `ACTIVE` and bold for the one whose add list is open (`slot.open`), the one under the pointer (`hoverAt`, and each mark's own `hover`), and `slot.target`, the place `n` adds at, unless `quiet` (the pane does not hold the keyboard). None is drawn while a run locks, a card is in hand or cards slide.
- Cards slide and grow (`motionX`, `motionY`, `motionH`) when the design changed under them or a carousel slid (`shapeOf`: the blocks in their order and the carousels, within one view). A selection that moved and another view are drawn in place: the keys never wait on a tween. While cards slide, arrows, arm words, gutters and slots are left out, and a moving card is clipped to the inside of its container.
- A drag: the card dashed where it stood, a bar on the nearest slot within `DROP_REACH` 16 (`dropTarget`; never the view's frame, never into itself), and at the pointer ` n6 title · drop into n2 ` (`dragHint`). Held on the first or last row the graph pans one row per `DRAG_SCROLL_MS` 96.
- An edit from chat: `flashGraph` / `graphFlash`, `FLASH_MS` 800 (the first `FLASH_STRONG_MS` 400 with the name inverse), cleared in state after `FLASH_CLEAR_MS` 1200.
- Past `WEIGHT_MAX` 70,000 (`paintWeight`) the graph is painted `plain`.
- The pan (`panTo`, `syncGraph`): the selected card whole with a row of what is around it, or its top when it is taller than the window; another view starts from its top; the window's size is part of the `seen` key.

**Views** (`designUi.viewRootId`)
- `o` (`open`), a click on a container that is already selected, or a `view` message opens a container as the view: the frame, at full width, depth 0, so what was collapsed inside it may be open now (`canOpen`: any container but the one shown). The frame says nothing of the arm it is in the view above.
- The breadcrumb is the graph's first rows (`crumbsFor`): ` LEVEL 2   design  ›  n4 Deep read  ›  n9 Close gaps`, and under it a rule in `RULE` as wide as the graph (`layout.top` = `CRUMB_ROWS` 2; 1, no rule, in a window under `CRUMB_RULE_ROWS` 8). `layout.level` is `LEVEL <n>`, bold, n the containers the view is down; left out where the row would keep under `CRUMB_LEAST_W` 36 columns for the crumbs. Each crumb has `CRUMB_PAD` 1 cell at each side of its words, counted in its `x` and `w` (so in `crumbAt` and under the pointer), and `CRUMB_SEP` (`  ›  `) between two. The last, the view, is inverse `claude` and bold; every other one is pressable; too long, the middle crumbs become `…`, then the first and last are cut.
- `b` (`back`, `parentView`): one level up, the selection on the container it came out of. A crumb: up to that view, the selection on the container the way down went through.
- The person's keys never leave the view (`navigate` stops at the frame; `moveTarget` refuses: `already at the bottom of this view: b goes up a level`). When anything else selects a block the view does not draw (`followRun`, `showEdit`, `restoreDesign`), `viewRootOf` → `viewFor` picks: the view as it is when it draws the block, else the whole design when that does, else the outermost container that does.

**Navigation and moves** (`navigate`, `moveTarget`; `applyOp` calls them over `graphOf`, the layout for the region last drawn, `graphBox`)
- `s` / `w`: reading order of the chain. Down: into an open container's first block (a stack's first arm in view), else the next sibling of the nearest chain around. Up: the block read just before (the last of the container above, followed down), or from a first block to its container. In an arm they stay in it to its end, then go on to what follows the stack.
- `d` / `a`: inside a stack, at any depth, the next arm of the nearest stack that has one that way (the card of it nearest in height; an arm out of the carousel's window is selected and the window slides); in a stack with none that way, nothing. Elsewhere `d` goes into an open container and `a` out to the container around.
- Nothing wraps; at an edge the selection stays and nothing is said. With nothing selected any of the four selects the view's first card.
- `W` / `S` (`moveUp`, `moveDown`): one place in reading order: past a sibling; into an open container that comes next (as its first block; going up, as its last); out of the end of its own container (to just after it; going up, just before). A collapsed container is one place. `A` / `D`: swap with the arm beside it; outside a stack `only arms move sideways` (`ONLY_ARMS`), at the end `already the last arm` / `already the first arm`. The view's frame does not move. Each move is `moveNode` through `settle`: one undo step, announced by `movedWords` (`moved n7 into n4 · [u] Undo`, `moved n7 out of n4`, `moved n7 after n3`).

**The key catcher and the ring** (`hooks/design.tsx`)
- **Why.** A Button's `hotkey` cannot see Shift and takes one lowercase letter or digit; a focused `Input` is given every printable key with its case (API-NOTES S7). So the ring rests on one `Input`, the catcher, while no field is open.
- **Where.** The first child of the frame (`catcher()`, drawn while `catching`), under a `Box` with `display="none"`: in the tree and not drawn. It takes no cell, and the terminal's cursor is hidden while the ring rests on it, so nothing blinks at rest (it was a 1-cell clipped `Box` on the detail pane's last row; a clipped Input still shows its cursor). Being the first child it is the mod's **first focus stop** whatever comes and goes after it (the ring is kept by place). It is left out of the tree only while the add list or the goal's field is open: their field takes its place. `autoFocus`; key `keys:<LOAD>.<catchGen>` (`catcherKey`), `LOAD` being a stamp of this load of the module: a reloaded module counts from 0 again and a key of the load before would come back with its old text.
- **Reading it** (`catchKeys`): the engine sends the field's whole text, so the new characters are those after `caught.taken`. Up to `BURST_MAX` 8 at once are keys, applied in order; more is a paste (`PASTE_NOTICE`). `submit` is `ENTER` after them. Keys are applied one at a time on the state the one before left (`queueKeys`, `keyChain`, `runKey`).
- **Emptying it** (`tidySoon`): answering `ui.input` with `{ value: '' }` does not empty a field; drawing it under a new key does. A key typed in the frame an Input is drawn under a new key is dropped, so the catcher is re-keyed only once it holds more than `CATCH_FULL` 40 characters and no key has come for `TIDY_MS` 600.
- **`runKey`.** On the start screen: `startKey`. With a field asked for and the ring still on its way there (`editing`, `describing`, an open add list), what is typed into the catcher is that field's text, never a key: `e` then `x` types an x. Else `KEY_OPS[key]`; none: `unboundNotice` (`k is not a key here`). Before a key acts, `flushDrafts`. `undo` / `redo` go to `timeTravel`, `run` / `review` to `request` (fills the prompt, closes and reopens the pane without `focus`), the rest to `applyOp`; `edit`, `goal` and `add` then move the ring (`landOn`: `LAND_TRIES` 5, `FOCUS_DELAY_MS` 48 apart).
- **The door** (`door:<LOAD>.<n>`): a second small `Input` at the right end of the detail pane's heading, the stop right after the catcher while a block's fields are shown (the heading's row is `row-reverse`, so the door is before the type's Button in the tree). The person's Down arrow (or Tab) from the catcher lands on it; the `ui.focus` hook then opens the fields (`openFields`) and moves the ring to the title. Being an Input it takes what is typed meanwhile (`doorKeys`: title text). With the fields open, a step back from the first field that lands on it goes back to the catcher.
- **`ui.focus` hook.** A move by the person onto anything that is not the catcher, the door, a field, a field at rest or the add list's filter (`isDetailStop`; in practice the heading's type Button and the engine's own stop on the pane's close mark, where Enter would close the pane) is let through and followed at once by the mod's own `$.ui.focus` back to the catcher. It cannot be rewritten in the chain: the engine refuses an element where the person's move named none. A move onto a field at rest (`design-rest:<field>`, a `Button`) opens the fields on that field. The person's move off a field flushes its draft; off the goal's field closes it.
- **What the mod knows of the ring:** `ringOn` (the element, from the person's moves and its own), `ringTo` (where it is sending it), `ringStops` (this drawing's stops in words: when they change under a ring at rest, `settleRing` puts it on the catcher, or on the add list's filter while that is open). The pane no longer says in a word where the keyboard is (`inputWord` is gone): the keys named say it (`legendItems` is asked with `ring` = `list`, `goal`, `fields` or `graph`), and while `isFocused` is false the legend and the hints are dim and `KEYS_CUE` stands on the message row.
- **Fields while typing** (`pins`, `fieldText`, `redrawFields`): a field's Input is keyed `design-notes@n5#<editGen>` (`fieldKey`; `editGen` counts every time the fields close, so fields opened again are new ones and show the block as it is now). An Input keeps what was typed while the `value` drawn does not change; when it changes the text is replaced but the cursor stays where it was. So an open field is drawn with the one text it opened with for as long as it is typed in; letters that reached the mod by the catcher or the door on the ring's way are kept beside it (`head`) and the field is drawn anew, with all of it, only once the typing has paused (the ring is then stepped off and on, which puts the cursor at the end).
- **Enter on a field** (`saveField`): the ring is claimed for the catcher first (`ringOn = drawnCatcher`), so a letter typed on Enter's heels is a key (`savedField`, `afterEnter`); the block's drafts are saved as one edit; `home()`. The add list's filter does the same with `pickedField`.
- **The Client never keeps the keyboard** (as since round 3): every release posts a message, the `ui.message` hook answers with `$.ui.open(paneArgs(true))` and a `$.ui.focus` onto the catcher (or the filter a `[+]` opened), which is also the probe for `handed`. A key the clicked Client was given in between is posted as `{ kind: 'key', key }` under the table's own name (`graphKey`: Shift+letter → the capital, `return` → `enter`, the arrows → `w a s d`) and joins the same queue.

**The key table** (`KEY_OPS` in `keys.ts`; the brief's table, as built)

| Key | `KeyOp` | Does |
| --- | --- | --- |
| `w` `a` `s` `d` | `up` `left` `down` `right` | move the selection |
| `W` `A` `S` `D` | `moveUp` `moveLeft` `moveDown` `moveRight` | move the block |
| `Enter` `e` | `edit` | the fields open, the ring on the title |
| `n` `+` | `add` | the add list: after the selection; inside it when it is an empty container or the view's frame; at the end with nothing selected (`openAdd` → `addPlace`, the place the graph lights its `[+]` at) |
| `x` | `remove` | delete; a container that holds blocks asks (`confirmId`, `x again deletes them all`); closes a help page instead while one is open |
| `1` `2` | `knob1` `knob2` | `stepKnob` (ops.ts): `quickKnob` says which knob the type has. Model inherit → `MODEL_STEPS` haiku, sonnet, opus → inherit (a model of another name goes to inherit); effort inherit → `EFFORTS` → inherit (`QuickKnob` is `model` \| `effort`). Refused with the reason on a type that has none. Announced `n5 model: haiku · [u] Undo` |
| `o` `b` | `open` `back` | the view |
| `i` | `detail` | hide / show the detail pane |
| `u` `y` | `undo` `redo` | `timeTravel` |
| `g` | `goal` | the goal's field in the detail pane |
| `q` | `review` | fills `reviewPrompt`; the keys go to the prompt |
| `r` | `run` | fills `handoffPrompt`, says `run: <preflightLine> · finish the prompt, then Enter` |
| `c` | `clearRun` | puts away the results of a run that is over |
| `?` `h` | `help` | the help pages, 1 to `HELP_PAGES` 4 and round again |

- `p` is no key: `nextProblem` is gone from the table, and the character says `p is not a key here`.
- `LOCKED_OPS`: while a run locks the design the four directions, `open`, `back`, `detail`, `help` act (and `clearRun`, which answers with the lock); any other key says `LOCK_NOTICE`.
- **Legend** (`legendItems(LegendState)` returns `{ footer, detail }`): only keys that work now, in a fixed order, each named in one place and never in both. `footer`, the graph's keys and the pane's own, at the footer's right: `[i] Show details` (first, and only while the detail pane is hidden), `[WASD] Navigate`, `[Shift+WASD] Move`, `[n] New`, `[x] Delete`, `[t] Block`, `[1] Model` `[2] Effort` `[3] Votes` (the selected block's), `[o] Open`, `[b] Back`, `[u] Undo`, `[y] Redo`, `[g] Goal`, `[q] Ask Claude`, `[r] Run`, `[c] Clear results`, `[?] Help`. `detail`, the keys of the detail pane, on its last rows: `[Enter] Edit  [i] Hide` at rest. The Down arrow is named in neither: it opens the fields too, and the help page "Keys" says so. Tab and Shift+Tab step the ring as Down and Up do and are named nowhere.
- **Legend, the ring elsewhere** (`RingPlace`): in a field, the goal's or the add list's filter the letters are text, so the footer is `[Esc] Keys to the prompt` alone and `detail` is that place's: `fields` (`[↑ ↓] Field  [Enter] Save, back to the graph`), `goal` (`[Enter] Save, back to the graph`), `list` (`[↑ ↓] Choose  [n] Change place  [a-z] Filter  [Enter] Add | Set type  [x] Cancel`). A help page open: `detail` is `[? h] Next page  [x] Close help`, the footer `[WASD] Navigate`. `start`: `detail` is `[↑ ↓] Choose  [Enter] Open`, the footer `[?] Help`; with a help page open there, the footer has the list's two and `detail` the page's.
- `legendRows` fills at most the rows it is given (the footer's `legendMost`, the detail pane's `HINT_ROWS`); what does not fit loses the entries that are not `core`, last first.

**The detail pane's modes** (`detailBox`: content above, the rows of its keys below)
- **Key hints** (`hintsOf`, `design-hints`): the pane's last rows name the keys that act on it, `legendItems(…).detail`, drawn as the footer's legend is (`legendRow`): `HINT_ROWS` 2 docked where the pane has 8 rows or more, else 1. Nothing else is pinned there: no row for the selection and the keyboard's place, no catcher, no key for the next problem. Hidden (`i`), `detailBox` is not drawn at all.
- **The selected block** (`inspector(level)`, fitted by `fit`): the heading, the type and kind as a Button (`agent verify ▾`, `TYPE_KEY`; it opens the add list as a type list; plain text on the start block and while locked), and at the right the id; a thin rule; **Meaning** (`TEACH[type].hint`, `useWhen`); the fields (`texts`: title, notes, then `TEXT_KNOBS` in order `prompt`, `when`, `fanout`, `until`, `schema`, `agentType`, those `knobsOf(node, parentType)` gives); there is no Model, Effort or Votes picker (the card's chips step those); on a block that carries `isolation: worktree`, a read-only `Isolation  worktree` line in `FADED` (the pane has no control for that knob: it stays in the file format and the hand-off, for Claude to set or drop); **Run** (`agentsOf`, `AGENT_ROWS_MAX` 12) while results show. While a run locks: no fields, the type not pressable. Short of rows the levels give up, in order: the whole texts drawn under fields the ring is not in, the blank rows, Meaning, then the long texts cut to `CUTS` 8, 5, 3, 2, 1 rows.
- **A field at rest** (`restField`): its label (`FIELD_LABEL`, first letter capital) on a row, then its whole value wrapped; `[not set]` dim, or in `error` where a problem names the field (`problemFields(rule)`); such a field's label, at rest or open, ends in ` [Required]` in `error` while it is empty (`required`). The pane says no more of a problem: no Error or Fix text. All of it is one `Button` (`design-rest:<fieldKey>`): a press opens the fields on that one.
- **A field open** (`openField`): its label on a row, its `Input` under it. The ring's field (`activeBase`) is drawn at the pane's full width, the one width the engine wraps a focused Input at (API-NOTES S16), behind a `label` of `detailLeft - 2` spaces: the engine ends a label with `: `, which falls under the rule beside the graph. Stacked (`detailLeft` 0) it has no label. Its placeholder is cut to `fieldW`: a placeholder never wraps, and a longer one pushes the field's start left, under the graph. The other fields stand in the column (`paddingLeft`), one line each, cut with `…`; the Input moves between the two parents under one key as the ring moves. Letters typed on the ring's way (`pins[…].head`) stand dim on a row under the field (`+ …`) until the typing pauses. Redrawn per keystroke (`typeIn` invalidates `ui.render`; the draft is still a module variable): the item's rows are counted with `wrapText(value, fieldW)`, `fieldW` being the cells from `detailLeft` to the pane's edge less the 4 the engine keeps for its Enter mark.
- **The detail pane is as wide as the pane** (`detailBox(rows, hints, items, left)`, `frame`): no part of the frame has a margin around the detail pane, each part has its own (`margin`). Wide, the detail pane has the main rows and indents its items by `detailLeft` (1 + the graph + the rule); the graph and the rule are an `absolute` box drawn after it, over those cells. Stacked, it stands under the graph with no indent. An item marked `wide` (an open field) indents itself. An item marked `keep` (the ring's field) stays in view: where the items before it and its own rows are more than the pane's, the content is moved up by the difference (`marginTop` below zero), the heading first out of view.
- **The add list** (`addList`; `designUi.picker = { at, query, retypeId?, anchorId?, where?, pick? }`): heading `addHeading` (`New block after n4 Deep read`, `The first block`, `Type of n4 Deep read (now pipeline)`), the filter (`design-add:<LOAD>.<n>`), then every type on a row with its hint (at most `HINT_MAX` 25 characters), in the two `PALETTE_GROUPS` while nothing is typed; the marked one (`▸`, `pick`) opens to its whole hint and `use when`. `typePicker`: while the filter is empty `n` goes round `addSides` (after, inside for a container, before; `cyclePlace`; `PICKER_PLACE`), and that character is taken out of the filter by re-keying it; any other character starts the filter (`fuzzy`, best first); `x` closes, always (`PICKER_CLOSE`). The arrows alone move the mark, with anything typed or nothing (`movePick`, from the `ui.focus` hook): `w` / `s` are letters of the filter. Enter or a press on a row: `pickBlock`. The block added is selected with `editing` and `freshId`: its title field is empty over the default as placeholder.
- **Help** (`helpPage`, `fitHelp`): page 1 the selected type's card (`TEACH[type].card`), 2 `LEGEND` (the graph's marks), 3 `KEY_HELP`, 4 `MOUSE_HELP` and the file's path; `Help n/4` at the right of its title.
- **The goal** (`goalField`, `designUi.describing`): a label, a line of explanation, one `Input` (`design-description:<LOAD>.<n>`, a new key each time it opens), the whole text wrapped under it. No longer under the header.
- **Nothing selected** (`idle`): the goal, then how to go on; `stray` for the unmapped card.

**The start screen** (`designUi.status === 'pick'`; the template picker's replacement)
- Same frame. The detail pane lists `startEntries`: the saved designs (`designUi.saved`, read by the command, at most `SAVED_MAX` 60; a window of `SAVED_ROWS` 8 around the mark where rows are short), then the templates and `Blank`, each a `Button` row (`start:<kind>:<id>`), the marked one (`designUi.startMark`) with `▸`. Under them, how to name a design first and how to have Claude draft one.
- The graph's region draws the marked row's design read-only (`previewProps`: `mode: 'run'`, nothing selected; a saved one from `previews`, read again after a reload; a template made anew). The header shows its name, the agents the marked design starts (none for a blank one) and `START · …`, the goal rows its description (plain rows: no click). The detail pane's last rows name the list's keys, `[w s] Choose  [Enter] Open`, and the footer's legend `[?] Help`; no row names the marked design. The catcher is the frame's first child here too.
- `startKey`: `w` / `s` move the mark (`moveStartMark`), Enter opens it (`openEntry` → `openSaved` | `startFrom`), `?` / `h` turn the help pages (page 1 is `START_HELP` here), `x` closes them; anything else is `not a key here`.
- With a name given that no design has, the mark starts on the first template; with none, on the first saved design and a new one would be `freeName`.

**State** (`DesignUi`, `types/index.d.ts`)
- Added: `viewRootId`, `carousels`, `detailHidden`, `unsaved`, `startMark`; `picker` gained `anchorId`, `where`, `pick`.
- Removed: `grabbedId` (no grab: Shift+WASD moves), `compact`.
- `RunContext` carries `graph?: GraphBox` (the region last drawn) in place of the orientation and placement.
- Module variables in `hooks/design.tsx` (not state, a keystroke must not redraw): `catchGen`, `doorGen`, `descGen`, `pickGen`, `editGen`, `drawnCatcher`, `ringOn`, `ringTo`, `ringStops`, `pins`, `caught`, `doored`, `picked`, `pickedField`, `savedField`, `typingSeq`, `keyChain`, `graphBox`, `graphArea`, `wheelRows`, `previews`; `drafts`, `histories`, `revisions` as before.

**Between the Client and the hooks**
- Props (`GraphProps`, from `graphProps` + the wheel): `design`, `mode`, `selectedId`, `viewRootId`, `problems` (own problems by id), `openAt`, `scroll`, `columns`, `rows`, `unmapped`, `wheel { from, rows }`, and where they apply `emptyNote`, `run`, `flash`, `hold`, `quiet`. The hooks module lays out the same props (`graphLayout`) to walk what the Client draws.
- Messages (`GraphMessage`, one per input): `select { id }`, `move { id, to }`, `addAt { at }`, `knob { id, slot }` (a chip), `view { id | null }` (a crumb, or the selected container clicked again), `slide { id, first }` (a gutter), `touch`, `key { key }`. Gone: `remove`, `edit`, `key { op, orientation }`.
- Pointer rules (`reducePointer`): `select` on release on the cell pressed; a `[+]`, a chip, a crumb, a gutter act on release on the same one (`press`); only the selected card is picked up, and released where it went down a container is opened; anything else pans up and down. While locked: select, view, slide and pan only.
- A `slide` that takes the selected arm out of the window moves the selection to the stack itself (`applyMessage`): the window always holds the selected arm.
- **The wheel.** `ui.scroll` on the pane, origin `person`, with `e.pointer` inside `graphArea` (the graph region's cells in the body, set by the drawing): `wheelRows += e.by`, the pane is invalidated, and the hook answers `{}` without `next` so the pane itself stays still. The sum reaches the Client as `wheel: { from: LOAD, rows }`; `syncGraph` moves `panY` by what was added since it last looked (a first sum, or another `from`, is where the count starts). Anywhere else, and for the scroll keys, `next(e)`.

**Elsewhere for `when`**
- `model.ts`: `Knobs.when`, a text knob (`KNOB_KEYS`). `teach.ts`: `KNOB_HELP.when`, `FIELD_LABEL.when`, and `knobsOf(node, parentType)` offers it (after the prompt) only to a block directly in a `branch`; it is in no type's `KNOBS_BY_TYPE`.
- `lints.ts`, rule 11 `arm-no-when`: a block directly in a `branch` with no `when`, unless it is the last of several arms. The same arms read `IF [not set]`. Lints are "problems" in everything the person reads (the detail pane's `[Required]` mark; `preflightLine`: `problems in n3, n5`, named and not counted); the identifiers and what Claude's tool says keep "lint".
- `chat.ts`: the tool description and the `knobs` schema say `when`; `strayWhens` answers an edit that set it on a block that is no arm. `handoff.ts`: `armWords` opens an arm's outline row with `IF <when>: ` / `ELSE: ` / `IF (no condition set): `, and rule 3 says how to implement it.

**What was deleted**
- `src/ui/board-model.ts` (the flow board's props, messages and reducer).
- The left-to-right flow and `chooseOrientation`'s use, compact (`z`), grab (`g` is the goal now), the sideways pan, the fan-out's double bottom border, `edit` / `del` on the selected card.
- The key rows of hotkey Buttons, the home key and the rewrite of the ring onto it, the `prompt.edit` swallow of unbound letters, the type and add pickers' own rows, the template picker's Buttons-only screen, the goal's field under the header, `overflow` under a resting field.
- `src/ui/board-layout.ts` and `src/ui/board-paint.ts` (the flow board: the left-to-right flow, compact mode, the old card anatomy, the old `navigate`, `paintBoard`, the `edit` / `del` affordances), and `moveBy` in `ops.ts`. What the graph still used moved: `src/ui/text.ts` holds `clip`, `wrapText`, `firstLines`, `cappedLines`, `moreLines`; `graph-layout.ts` holds `Rect`, `EdgeKind`, `Flow`, `Direction`, `UNMAPPED_ID`, `samePlace`, `childFlow` and, private, `cardText`, `fanCount`, `eachOf`, `edgeKind`; `graph-paint.ts` holds `Span`, `RunOverlay`, `CardRun`, the run sums (over `layout.blocks`), `fitStatus`, `paintWeight`.
- **Taken out after the build** (the UI pass): the worktree chip and its toggle (`3` steps votes only; the `isolation` knob stays in the model, the chat tool and the hand-off); the `Model`, `Effort`, `Isolation` and `Votes` Selects; `p` / `nextProblem` and every problem count (the badge's number, the footer's, the preflight's); `slot.shown` and the labels `[+] Add block`, `[+] Add first block`, `+ Add first block inside …` (every `[+]` is drawn, and reads `[+]`); the pinned `Selection … · Input: …` row and `inputWord`; the block count in the footer's facts; the stacked dock's legend under the facts (it had five footer rows).
- **Closing changes.** `branch`'s accent is `warning` (it was `bashBorder`, too near the selection's `claude` and the badges' `error`). An arm of a stack grows to its neighbours' height only when within `ARM_GROW_MAX` (3) rows; otherwise it keeps its own, tops aligned. The frame has one column of margin on the right as on the left. A picker's label is a Button and opens it as its value does. A carousel's incoming arm slides in with the others, clipped at the container's border; the outgoing one goes on the first frame.
- **`prompt.edit` is back, narrowly.** After a click on the graph the pane retakes the keyboard and asks the ring onto the catcher; the engine refuses that first ask (`the focus moved meanwhile`), so for about 20 ms a letter typed goes to the prompt box and takes the keyboard with it. A `prompt.edit` hook (matcher `{ text: '' }`), armed for at most 400 ms after such a click, takes that one letter, applies it as the key it was meant as and retakes the keyboard. Cost: one hop on the first character typed into an empty prompt box. A key typed in the same frame as the click also retakes the keyboard (the click's own post can be dropped).
- **Enter and the catcher's count.** Enter empties the catcher's field; `catchKeys` counts from the start again after it (the count of keys already taken was once kept, and the next key was swallowed).

**Findings** (engine, 2.1.296; API-NOTES S7, S8 and "Other findings" have the evidence)
- A Button `hotkey` cannot see Shift: `Shift+j` pressed `j`'s Button, and `ui.press` carries no key.
- A focused `Input` receives every printable key with its case, one `ui.input` `change` each, Enter as `submit`; a burst arrives as one `change` holding all the characters. A Button's hotkey does not fire while the ring is on an Input.
- Answering `ui.input` with `{ value: '' }` does not empty the field. Drawing the Input under a new key does, and the ring stays (kept by place among the stops). A key typed in the frame an Input is drawn under a new key is dropped. A reused key brings back its old text, across reloads too. Changing `value` under a focused Input replaces the text and leaves the cursor where it was. An Input opened again under the key it last submitted from, with the same text, was drawn empty (Enter then saved an empty goal).
- A focused Input wraps only when it has the pane's full body width; inside any narrower column it is one line cut with `…`. Since S16 the fields are drawn at that width (see "A field open"). (This corrects "a focused field wraps its text over as many rows as it takes" under Flow board: that was the docked pane's full-width field.)
- Stop order is tree order, and an engine stop (the pane's ✕) sits before the mod's first. Up / Down walk the ring like Shift+Tab / Tab and a hook cannot tell them apart. A person's move that names no element cannot be given one in the chain.
- An `Input` under a `Box` with `display="none"` stays a focus stop and takes keys, and the terminal's cursor is hidden while the ring is on it. A focused Input pushed off-screen or clipped still has its cursor shown, clamped to the screen's edge.
- The docked pane's background colour is the engine's (`composerSidebarBackground` on the Box around the dock): nothing a mod draws or asks removes it (API-NOTES S8).
- `ui.scroll` is raised for the wheel even when the tree is exactly as tall as the body, with the pointer's cell; answering `{}` without `next` keeps the pane still. One tmux wheel tick is `by: ±3`. (No wheel reaches a Client, as before: the graph gets it through props.)
- On `/reload-plugins` the Client module can get one frame of props in the old shape: it reads its props defensively (`props.columns > 0 ? … : surface.columns`), as the hooks read state that an older load wrote (`ui.carousels ?? {}`, `ui.help ?? 0`).
- A clicked Client gets `{ key: 'W', shift: true }`, arrows, `tab`, `return`. Nothing can focus a Client without a click or tell when it loses the keys: it still never keeps the keyboard.
- A tool description is cut at 4096 characters; `toolDescription()` is 4,050 (it was 4,090 before `args` and `phase`: see the last section).
- A `Select` opened by the ring lists its options under itself: a picker's row has no fixed height.

**Not exercised**
- Anything that needs a model turn, on the new pane: an edit from chat marked on the graph (`flash`) and its `Claude added … · [u] Undo` line, `strayWhens` and `armNote` in a real answer, a real hand-off with `r` or `/conductor run` (the `IF` / `ELSE` outline, a `when` implemented), a draft landing on the `DRAFTING` graph.
- The inline placement beyond its code path (rows, one-row detail pane, one-row legend).
- The desktop surface.
- No tests: none were written, and the stale ones were not run.

## Blocks: args, phase, borders by flow

Asked for after a review of block coverage. Built; checked with `claude plugin validate .`, `bunx tsc -p .`, `scripts/render-graph.ts` and a live pane (tmux, truecolor). No tests.

- **`code` covers grouping and reducing.** No block was added for them: `TEACH.code` says so (one card line), and the palette finds `code` by `group`, `reduce`, `merge`, `aggregate`.
- **`phase`** (container, a chain): a titled group that only frames what it holds. `KNOBS_BY_TYPE.phase` is empty; the detail pane shows its title and type, and a notes field only for notes it already carries (`hasNotes`). It stands anywhere and holds any block. Its blocks run in order where it stands:
  - lints read through it: `CHAINS` holds it (`hasInput`), `producer` follows its last block, `receiver` its first (rule 1 looks at the first block of a phase after a `parallel`, and leaves an empty one alone);
  - arrows too: inside a phase `edgeKind` takes the type of the container the phase stands in (`Ctx.lanes`), and an arrow leaving a phase is drawn for its last block (`lastOf`);
  - it adds no depth: `depthStep` is 0 for a phase (1 for the frame of a view), in `openBox` and `viewShows` alike, so a container in a phase is open as deep as without it. It still takes its four columns.
- **`args`** (leaf): the workflow's input. Notes say what it is, `schema` its shape (the card's right side reads `input: …`, not `output: …`). With neither it reads `no input` (`NO_INPUT`, dim): that is a workflow that takes none, and no lint stands on it. It spawns nothing: 0 in `leastAgents`, no run status, no replay agents, no phase in the hand-off.
- **`args` is permanent** (asked for right after: "always show, permanent first block"): every design has exactly one, the first block of the top level.
  - `emptyDesign` makes it; `parseDesign` gives a design read without one an empty one (`withArgs`: a new id, put first) and refuses one that stands anywhere else (`ARGS_PLACE`); every template opens with its own.
  - `removeNode` and `retypeNode` refuse it (`ARGS_KEPT`), `moveNode` too (`ARGS_STAY`); `addNode` refuses a second, and any block asked for before it lands after it (`placeFor`). In the tool for Claude a `write` that leaves it out keeps the one the design has, and a refused `remove` now refuses the ops (it was passed over in silence).
  - It is not in `PALETTE`, so neither the add list nor the type list offers it; its own detail pane has no `Type` row; `n` on it adds after it only (`addSides`); the legend names neither `Shift+WASD` nor `x` while it is selected (`fixed`), and `WASD` is always named.
  - A design with nothing but it is blank (`isBlank`): that is what "empty" means everywhere (the draft command, a run refused, `not saved yet`, the legend's `q` and `r`, the detail pane's "An empty design"), and block counts leave it out (`blockCount`). The graph of a blank design is the args card, then the `[+]` and the lines on how to start in the middle of the rows left (`GraphLayout.blank`); nothing is selected when it opens, so the detail pane says how to start.
- **Borders say the flow** (`FRAMES` in graph-paint.ts, by `shapeOf`): a leaf `╭─╮ │`, a chain dashed `┌╴┐ ╎`, a stack dotted `┌╌┐ ┊`, each with a heavy twin for the selection (`┏━┓`, `┏╸┓ ╏`, `┏╍┓ ┋`). `SQUARE` is gone. A leaf in hand keeps `LIFTED` (`╭╴╮ ╎`); a container in hand keeps its own line, dim.
- **A phase has no outline.** Its ring is blank cells and the whole of its box stands on `PHASE_GROUND` (`userMessageBackground`: one step off the dock, `rgb(55,55,55)` on `rgb(38,38,38)` in the dark theme, `rgb(240,240,240)` on `rgb(245,245,245)` in the light one). The paint keeps a second grid (`grounds`) beside the looks; `shade` clips as `put` does; a phase in a phase turns the ground back to the pane's (`shaded`). Selected, it has the plain heavy line. `Span.ground` is the Client's `backgroundColor`. Not drawn in the `plain` fallback, and the rows of `▲ / ▼ N more` and the drag chip are put back on the pane's ground.
- **Accents:** `args` `bashBorder`, `phase` `text`. Glyphs for the plain list: `⇢`, `▭`.
- **Hand-off:** `args` gets no entry in `meta.phases` and is not the label's example; two lines say what `args` and `phase` mean to the script. `HANDOFF_MAX_LINES` is 65 (30 fixed lines and at most 35 of outline; 60 was already passed by 2).
- **The tool for Claude:** two more type lines took the description past 4096 characters, so what each knob means is now the description of `knobs` in the schema (on the ops; `nodes` points to it) and the description names the knobs only: 4,050 characters.
- Refusals name a type with its article (`aType`: `an agent block cannot hold children`).

**Not exercised:** a model turn (Claude filling in `args` or adding a `phase` through the tool, a hand-off of a design that has them); the light theme and the ANSI themes (in the ANSI themes and in a 16-colour terminal the dock and `userMessageBackground` are the same colour: a phase is then told by its header and its missing outline only); the inline placement, which has no dock background.

## Persona: splash and header

The pixels are in `src/ui/persona.ts`, read off `docs/redesign-v1/claude-conductor-persona-assets` (one source pixel each) and painted in the source's own hex colours (half-blocks in the splash, octants in the header), not theme keys.

- **Splash:** once a session (`$.state` `splashed`), the pane's first drawing shows it in place of the screen for `SPLASH_MS` 1800 (6 beats of `BEAT_MS` 300) plus 150 ms of rest. The conductor goes idle, ready, conducting, ready, conducting, complete (`SCORE`); six small agents stand in an arc at each side, each half rising on its own beat and all on the last. Under it `◆ Conductor` and `designed for full screen`. `hooks/splash.tsx` counts the beats; `hooks/design.tsx` ends it with one `$.clock.after` and settles the ring. No catcher is drawn under it: keys wait. Under 77 columns or 18 rows the conductor stands alone; under 17 rows there is no splash.
- **Header:** a 2-row persona (`smallPersona`, `SMALL_W` 10 cells): the conductor from the chest up (head, neck, both arms, baton), redrawn 8 pixels tall and painted as octants (Unicode 16, eight pixels to a cell, two colours a cell at most). Off the terminal (`e.surface`; the terminal's `Svg` is a fragment that draws nothing) it is one picture of the same pixels (`smallPersonaSvg`, 72 by 32 CSS pixels), not blocks. Each key that moves the selection (`w a s d`) takes it to its next pose (`nextPose`: idle, ready, conducting, and round; `complete` is drawn as idle), which it holds. It stands at the left of the name's row and the goal's first row, which have the rest (`headColumns`). `commit` reads what a change was (`gestureOf`): a block added is `ready`, blocks that changed place `conducting`, held `GESTURE_MS` 900 (`$.state` `persona`). With a run laid over the design and no gesture held: `conducting`/`ready` by the run clock while it runs, `complete` once done (`runPose`).

## Blocks and kinds

Asked for: "a block subtype system that encapsulates key patterns as presets", progressive disclosure in place of every pattern as a block. Built; checked with `claude plugin validate .`, `bunx tsc -p .`, `scripts/render-graph.ts` and a live pane (tmux: the add list both ways, a loop of kind pass with its blocks, a retype, undo). No tests. Where an earlier section names `verify`, `judge-panel`, `critic`, `sweep` or `loop-until-dry` as a type, this section stands.

**The rule.** A block is what a workflow script is written in; a pattern is a **kind** of the block it is made of. Each type's kinds answer one question about it, and the first is the plain block:

| Block | Its kinds answer | Kinds (`KINDS` in model.ts) |
| --- | --- | --- |
| agent | what is its job? | task, scout, check, verify, judge, critic, merge, classify |
| loop | when does it stop? | custom, count, pass, dry, converged, target, budget |
| parallel | what differs between its arms? | arms, each, sweep, attempts |
| branch | how is its arm picked? | if-else, guard, route |

`pipeline`, `phase`, `code`, `subworkflow`, `args` have none. A pattern that spans several blocks (judge panel: attempts, judge, merge) is a template, not a kind: `judge` is the scoring vote alone. Voting is not a kind and not a knob: the two voting kinds say their votes in their logic (see "Votes in the logic").

**The model.** `DesignNode.kind?`, validated against its type (`readType`: a kind the type does not have is refused with the ones it has); the plain kind is never stored (`plainKind`, `kindOf`). The five old pattern types are gone: a file or a tool call that names one is refused as an unknown type. `typeName` is a block in words (`agent verify`, `loop` for a plain one); `types/index.d.ts` mirrors `kind`.

**Fields are the type's, the same for every kind** (`KNOBS_BY_TYPE` in teach.ts). The user's rule: a kind must not bring inputs of its own; one free-text field per thing a block says.

| Block | Text fields | Chips |
| --- | --- | --- |
| agent | name, logic, prompt, output, agent type | model, effort |
| code | name, logic, output | |
| subworkflow | name, logic, prompt, output | |
| start | goal, args | |
| pipeline, parallel | name, logic, once per | |
| loop | name, logic, stop condition | |
| branch | name, logic; each arm: condition | |
| phase | name | |

- **The file's keys are the pane's words** (asked for after the first build, "rename the keys for consistency"): `name`, `logic`, and the knobs `prompt`, `output`, `oncePer`, `stopCondition`, `condition`, `agentType` (were `title`, `notes`, `schema`, `fanout`, `until`, `when`). A clean break: `Knobs`, `NodePatch`, the tool's schema, the hand-off text and the two saved designs were renamed in one change and nothing reads the old keys (an old file fails with `name must be a string`, an old knob from Claude with `unknown knob schema` and the list). `FIELD_LABEL` / `fieldWord` turn a key into its words (`oncePer` → `once per`) for the pane, the lints and the message row (`n5 changed: logic`); a container's header says `· stop: …`. Two lint rules were renamed with them: `code-input-no-output`, `arm-no-condition`.
- Dropped from what a type offers: `oncePer` on an agent (fan-out is said on a pipeline or a parallel), `output` on containers (a container hands on what its last block makes), `model` and `effort` on a sweep and a dry loop (their agents are blocks inside). A knob a block carries anyway still shows (`knobsOf`).
- No `max` knob: a loop's bound is part of its one stop condition (`the check passes, at most 3 rounds`).

**What a kind is** (`KIND_TEACH: Record<Kind, KindTeach>`): `hint`, `when`, `card` (teaching), `script` (one line in the script's terms, for the hand-off), and three presets:

- `fill`: knobs a new block of the kind gets (`fillOf`): verify `{ refuted: boolean, reason }`; judge a scores shape (both also get their logic, `logicOf`); scout and classify a shape and `effort low`; check `{ ok, failures }`; critic `{ gaps }`; every loop kind but custom its stop condition; sweep and attempts their `oncePer`.
- `hints`: what the empty fields are for (`placeholderOf(block, field, parent)`: the kind's, else the type's (`TYPE_HINTS`: the code block's logic names dedup, filter, top-K, merge, which replaced the code kinds first proposed), else `FIELD_PLACEHOLDER`). A branch's `condition` hint is shown on its arms.
- `starter`: the blocks a new, empty container starts with: loop pass (an attempt, a check), loop dry (a finder with an output shape, a dedup `code`).

`addNode(design, { type, kind?, name?, bare? })` applies fill and starter in one edit (one undo step); `bare` leaves the starter out (the tool for Claude brings its own blocks). `retypeNode(design, id, type, kind?)` changes both: a knob still as the old kind filled it goes, the new kind fills what is not set, a typed value is never lost, and a container left empty gets the new kind's starter. `retypeBlock` renames a block still called after its old type or kind (`defaultName`).

**The add list** (`pickerMatches` → `PickRow[]`, `pickBlock`, `typePicker` in session.ts):
- With nothing typed: the eight blocks of `PALETTE` (no keywords any more), in the two groups. A block that has kinds is `opens` (drawn `AGENT ▸`; the marked one lists its kinds): Enter sets `picker.block` and the list shows that block's kinds, the plain one first, under `· which agent?`; `b` goes back (`PICKER_BACK`).
- With something typed (in either list): `searchBlocks`, every block and kind whose full name (`pickName`: `agent verify`) holds the text, a kind's own prefix first, then the name's, then the rest. Names only, by the user's decision: no keywords, no subsequence match.
- **`b` is a key only while it is not a name.** It is taken as a key while the filter is empty and a block's kinds are listed, but `budget` and `branch` start with it (`w` and `s` were keys there once: they are letters of the filter now). The keys taken are kept (`picker.nav`), and when they and the next character start a block's or a kind's name (`startsName`) they become the filter's `lead`. Found live: giving them back to the field (a new `Input` with `sw` as its value) left the cursor after the first character, so the next letter landed inside (`sew`). So the field is not rewritten: the lead is drawn as text before it, the field keeps what was typed in it, and `filterText` puts the two together. A field emptied takes the lead with it.
- A retype (`Type` row) lists the block's own kinds first, then the other blocks it may become.

**Lints by kind** (lints.ts): rule 1 lets a `parallel` off when what follows is `code`, a judge or a merge; rule 3 fires on any loop with no stop condition but the kind dry (`needsStop`; a plain loop is still let off by a bound in its words); rule 6 lets off the kinds whose name is the task (`needsBrief`, `SELF_BRIEFED`: verify, judge, critic); rules 7 and 8 read `kind`; rule 9 tells a plain parallel to add blocks and one of kind each, sweep or attempts to say what it runs once per; rule 11 does not tell a guard to add an arm. The card's `Instruction [not set]` and `Stop [not set]` use the same two functions.

**The graph:** `typeLabel` (`AGENT verify`, `LOOP dry`) on cards, headers, collapsed cards and the detail pane's heading; a name still the type's or the kind's is left out. Kinds take their type's accent (the five old accents are gone from `ACCENT`). `childFlow`: `parallel` and `branch` are stacks. `edgeKind`: a barrier after a pipeline, a parallel, a fan-out or votes above one.

**Hand-off and the tool for Claude:** the outline says `n6 agent verify "…"`; the instructions list each kind the design uses with its `script` line (`HANDOFF_MAX_LINES` 80). The tool's block has `kind`; its description names the kinds per type, and what each kind means is on `kind` in the schema, as the knobs are on `knobs`: the description is 3,801 characters (it was 4,401, past the engine's cut at 4,096). `update` takes `type` and `kind` (a type said again leaves the kind; `kind: ""` makes the block plain); a new block from `add` or `write` gets its kind's fill under the knobs it came with.

**Not exercised:** a model turn (Claude adding or changing kinds through the tool, a hand-off of a design that has them); the stacked and inline layouts of the add list's two steps.

**After the build: the Block row, and no agent type field.** `Type` and `Agent type` read as one thing twice. The row that picks a block's type and kind is labelled `Block` and is the first row under the heading, before Meaning (`blockItems`); its label is now the stop before the picker (the row no longer runs backward), so Shift+Tab from the name reaches it and `offLabel` passes a further step back to the graph. `agentType` has no field any more (out of `TEXT_KNOBS`, `TextField`, `FIELD_LABEL`): like `isolation` it is Claude's to set, and shows as a read-only `Agent type  <name>` line when set (`setItems`). The add list's heading on a retype reads `Block n4 Deep read (now agent verify)`, the legend `[Enter] Set block`.

## Votes in the logic

Asked for: no votes chip on the graph; votes are said in the block's logic, typed or filled in by the kind. Checked with `claude plugin validate .`, `bunx tsc -p .` and a real paint.

- **The `votes` knob is gone** (a clean break): out of `Knobs`, `KNOB_KEYS` and `knobError` (the parser refuses it as an unknown knob), `KNOB_HELP` (so the tool's schema), the hand-off's outline, `types/index.d.ts`. The saved designs and the templates say it in their logic.
- **A kind may fill in the logic** (`KindTeach.logic`, `logicOf`): verify `3 votes: each voter tries to refute the result; it is kept when a majority fail to refute it`, judge `3 votes: each judge scores every candidate; the highest total wins`. `made` writes it on a new block, the tool's `write` on a new block that came with no logic, and `retypeNode` treats it as it does a filled knob: logic still as the old kind filled it in goes, logic that was typed stays, an empty one takes the new kind's.
- **The count is read from the logic** (`votesOf` in teach.ts): the first `N votes`, `N voters` or `N judges` of a verify or a judge, 1 where it says none and for any other block. `leastAgents` multiplies by it and `edgeKind` draws a barrier after more than one.
- **The card:** no `3` chip, no `votes N` at the right of row 2. `QuickKnob` is `model` | `effort`; the key `3`, `knob3` and `VOTES_STEP_MAX` are gone, and a `knob` message takes slot 1 or 2.
- **Lint 7 (`no-votes`) is gone**; the other rules keep their numbers.
- **The hand-off** tells Claude to run as many voters as the logic says, 3 where it says none (the kinds' `script` lines say the same).
- `replayAgents` read a `fanout` knob that no longer exists; it reads `oncePer`.

## No field is mined; a short hand-off

Asked for after "Votes in the logic": the counts and meanings that were still read out of typed text are gone, and the hand-off says the design and little else. Checked with `claude plugin validate .`, `bunx tsc -p .` and a real paint. Where this section and an earlier one disagree, this one holds.

- **What was read out of text, and is no more:** `votesOf` (votes in a logic); `statedCount` and the test in `unknownsOf` (a leading number in `oncePer`); `fanCount`, `fanMark` and `eachOf` in graph-layout.ts (the `×4` / `×n` mark, `count unknown`, the count and a leading `each` stripped from the header); lint 5 `fanout-over-cap` (a number above `CONCURRENCY_CAP` in `oncePer`); lints 1 `barrier-not-needed` and 2 `worktree-read-only` and the let-off of lint 3 (the word lists `CROSS_ITEM`, `READS`, `WRITES`, `BOUNDED` over a block's name, logic and prompt); `replayAgents` reading `oncePer` (a replay of a design gives a leaf 2 to 4 agents by its id).
- **What still reads text, as wiring:** the run view takes `n3` from the start of an agent's label (`reducer.ts`), and `handoffTarget` knows the hand-off sentence. `hasInput` and lint 9 test whether `oncePer` is empty, not what it says.
- **Agents** (`leastAgents`): one per agent block, the cheapest arm of a branch, nothing for the rest. `unknownsOf` goes by type and kind alone: a pipeline or a parallel (`fanouts`), a loop, a verify or a judge (`votes`), a subworkflow; any of them makes it `agents ≥ N (more: 2 blocks may fan out, 1 loop repeats, 1 block votes)`.
- **Lints:** 1, 2 and 5 are gone and the rest keep their numbers. Lint 3 is structural: any loop with an empty stop condition but the kind dry (`needsStop`).
- **The graph:** a header says `· once per: <as typed> · stop: <as typed>`; no `×` mark anywhere (the `fan` role and the legend's `×N` row are gone). `edgeKind`: a barrier after a pipeline or a parallel, by type.
- **Hand-off** (`buildHandoff`): the goal, the design file ("it defines the workflow"), the script to update where one exists, not to call the offer tool, to ask the user first about every flow that is ambiguous or looks unintended, and the three rules that tie a run to the board (label, phase, `meta.name`; with a script, `match`). Gone from it: what a node's fields are, the knobs paragraph, the per-kind `script` lines, the outline, the report after launching, `HANDOFF_MAX_LINES`. `outline` and `KindTeach.script` stay for the tool for Claude (chat.ts).
- **The tool for Claude** no longer says where votes go.

## Before a workflow, a run on a design, and what Claude is sent

Three things added after "No field is mined", then put right in a review round. Checked with `claude plugin validate .`, `bunx tsc -p .`, a throwaway script over the tracker with a fake host, and a real session (three tiny runs). Where this section and an earlier one disagree, this one holds.

**The offer** (hooks/offer.tsx, src/design/offer.ts)
- A second tool, `mcp__conductor__before_workflow`, no input, `isDeferred: false` (API-NOTES S13, S14: Claude calls a tool before a workflow only when its description is in every turn). It asks `Design this workflow in Conductor first?` with `$.ui.ask`: `Conductor`, `Standard`, `Always Standard`, `Always Conductor`.
- `Conductor`: the result is `offerBrief` (one `write` with the deferred design tool, named in full; stop afterwards; the person approves on the board with `r` or `/conductor run <name>`; told in chat to run it, call this tool again). The draft's board takes the keyboard. `Standard`: write the script and run it. An `Always …` answer is kept in `$.store` under `ask.workflow` and answers without a dialog from then on.
- No dialog, answer `Standard`: a subagent's call, a session with no surface, and while a handoff waits for its run (`tracker.awaitsRun()`).
- Esc, `Chat about this` and an empty typed answer are one result (no choice); other typed text is passed on as the person's words. Both say that what the person then answers in chat is acted on without calling the tool again.
- **A draft that waits** (`waiting` in offer.tsx): after a `Conductor` answer's draft has landed and until that design is handed off or run, a call answers without a dialog (`waitingResult`): the design is on the board unapproved; not told to run it, Claude drafts nothing and writes no script; told in chat to run it, Claude carries out `buildHandoff`'s text, which the result holds; for a different workflow, a second call in the same turn asks. A run named as the design is the design's (below), so a chat approval needs no pending claim.
- `/conductor ask reset` deletes every `$.store` key under `ask.`: the kept answers to both questions.

**A run and its design** (src/run/tracker.ts, hooks/run.tsx)
- **By name.** A run whose `workflowName`, through `designName`, is a saved design is that design's run: with a handoff waiting, without one, and whether or not its blocks have `match` (`RunStarted.design`, read by `designOfRun` in design.tsx before the tracker is told). The board goes to that design and follows the run; no question is asked, also with `Never visualize` kept. A toast says where the run went when no handoff led to it.
- **By handoff.** A handoff's claim (`HANDOFF_MS`, 180 s) still takes a run under any other name. Each prompt the person sends while it waits starts the wait again (`tracker.prompted()`), so it holds while they answer what Claude asked about the design. A run named as another saved design is that design's, and the handoff goes on waiting.
- **Out of a handoff** (`tracker.handedOff()`): the handed design's runs from the handoff until the person's next prompt once the claim is spent, so a retry in the same turn counts.
- **The script beside the design**: `.claude/workflow-designs/<name>.workflow.js` (`scriptFile`); that the file is there is the link. A run out of a handoff copies its script there (`result.scriptPath`; a run of that very file copies nothing). A run that only has the design's name copies only when the design has no script yet: the saved one may be newer. `delete` and `rename` take the script along.
- **A handoff of a design that has a script** (`buildHandoff` with `scriptPath`): update that file to match the design, changing only what the design changed, and run it by `scriptPath`; blocks with `match` keep the script's labels and phase titles.
- **The Visualize question.** A run no design took (main conversation, a surface, a `scriptPath` on the result) asks `Visualize this run in Conductor?`: `Visualize`, `Skip`, `Always visualize`, `Never visualize` (kept under `ask.visualize`). The turn is held while the dialog is up (S10). On yes the Workflow result carries `visualizeBrief`: one `attach` call under the workflow's own name (`designName(workflowName)`, so the next run of the script finds the design), nodes that mirror the script, each agent label in the `match` of the innermost block only, a phase title on the top-level block of that phase.
- **`attach`** (the design tool): a `write` for the run tracked now. Refused with no run, when the run is another design's, and when the name is a design this run did not create. It saves the design, copies the run's script beside it, and `tracker.adopt` places every agent seen so far again (`remap`); the answer lists the labels no block took (`attachNote`).
- `runBoardOf()` in design.tsx hands run.tsx `designOfRun` and `keepScript` as closures made in the session's start hook: `claude plugin validate` refuses a `$` passed to an imported function.

**What Claude is sent**
- **The design tool is deferred** (`isDeferred: true`). Its description says: read before describing, reviewing or editing, unless a Conductor note with the prompt has said what changed. 3,627 characters (the cut is 4,096; it was 4,087): what belongs to one field is said on that field in the schema (how a `write` keeps ids on `nodes`, what a kind fills in on `kind`, a key in the board's words on `knobs`, `match` and the default `name` on theirs only). There is no `guide` action: the long cards (17,000 characters) are the board's help page only.
- **The change note** (`changedNote`, `boardChanges`): after a change by hand the next prompt carries everything that differs from the design Claude last saw (blocks added whole, changed as they are now, moved, a container's new order, removed, the goal, the selected block), and counts as a read. Where saying it takes more than the design, or Claude holds no snapshot, `staleNote` says to read.
- **The snapshot** (`seenDesigns`) is kept only where Claude holds the design whole: after a `read`, after a change note, and after its own edit when `knownAfterEdit` holds (every logic, knob value, `match` and the goal is a string it sent in that edit or one the block had in the last snapshot, and the outline names every block). An edit that stored text Claude never saw (a kind's filled-in logic or knobs, a block from a design it never read) drops the snapshot. A compaction drops them all (not a `precompute`); a `/clear` and a resume also forget that Claude saw any design.
- **A `write` over a design Claude has not seen in this conversation is denied** when the design has blocks: an offered draft named as an existing design would replace it unread.
- **A deny is a reason**, never an instruction (Claude does not take one from a refusal), plus at most that a name no design has is free to use.

**Seen live** (sonnet, three runs of two haiku agents): the offer, `Standard`; the Visualize question, `Visualize`; `attach` under the workflow's name with each label on its agent block, both agents on their blocks, the script copied; the same script run again by path: no question, the run on the design, the kept script untouched; after `/clear` and a change by hand, `r`: Claude updated the kept script, ran it by `scriptPath`, no question of either kind, the run painted on the design. Without runs: a `write` to an unread saved design denied; a review after a change by hand answered from the note with no `read`; after an offered draft, `run it` in chat: one `before_workflow` call, no dialog, no second draft, Claude read the design file and was stopped before the Workflow call.

**Not exercised:** a retry of a failed script and a claim that expired before its run (the tracker's rules only, under the fake host); a chat approval through to its run; `Always …` and `Never …` answers kept and reset; a typed or empty answer; a session resume; a `precompute` compaction.

**Known and accepted:** a prompt queued mid-turn marks the change note as seen early; after `/clear` an `attach` is refused until the next run; a failed delete can leave `<name>.workflow.js` behind; the turn is held while the Visualize dialog is up; after a rename an `attach` to the run still shown is refused; a retry under a name that is not the design's, after the claim is spent, is not the design's run.

## The start block

Asked for: the `args` block becomes `start`, which carries the goal and the args as plain fields in the detail pane; the goal leaves the header and its key. Checked with `claude plugin validate .`, `bunx tsc -p .` and a real paint. A clean break; where this section and an earlier one disagree, this one holds.

- **The type** `args` is `start` everywhere (`NODE_TYPES`, `TEACH`, `ACCENT`, `types/index.d.ts`); the parser refuses `args` as an unknown type. `startOf`, `withStart`, `START_PLACE`, `START_KEPT`, `START_STAY` take the place of the `args` names. It stays what the args block was: one per design, first, not added, moved, deleted or retyped.
- **Its fields** are two knobs only it has (`START_KNOBS`; `startOnly` refuses them on any other block, in the parser and in `updateNode`): `goal` and `args`, both text. It offers no name and no logic (`hasName`, `hasLogic`): `e`, Enter and Tab open it on the goal (`firstField`), and its heading is `START` alone.
- **`Design.description` is gone**: the goal is `startOf(design).knobs.goal` (`goalOf`, `withGoal`). The saved designs and the templates were converted by hand: the description became the goal, the args block's output and logic became `args` (`{ target? }: what to review…`).
- **The card:** `START`, then the goal (wrapped in full when selected); `Goal [not set]` in the error colour while it is empty (`missingOf`). The args are not on the card. `NO_INPUT` and the `input: …` at the right are gone.
- **Lint 0, `start-no-goal`:** the start block with an empty goal. It marks the card (`!`), the field (`[Required]`) and the preflight line like any other.
- **The header** is the name's row and nothing under it but the rest of the persona (`HEAD_ROWS` 2): no `Goal:` rows, no `hooks/goal.tsx`, no click on them.
- **The key `g` is gone** (`KeyOp` `goal`, the legend's `Goal`, `RingPlace` `goal`, the help table's row), and with it `designUi.describing`, `describeDesign`, `drafts.goal`, `goalField`, `saveGoal`, `goalAsked`, the `design-description` Input.
- **A design opens on its start block** (`firstPick`), a blank one too, so the first Enter is the goal; the empty graph's hint is `e  say what this workflow is for`. With nothing selected the detail pane still says the goal.
- **The tool for Claude** has no `description` input: the goal and the args are the start block's knobs, set by an `update` of it or by a `write` that puts it first (a `write` without it keeps the one the design has). The briefs (`draftBrief`, `offerBrief`, `visualizeBrief`) say so, and `/conductor draft <name> <description>` writes the description as the goal.
- **Hand-off:** `Goal of the workflow (the start block's goal): …`; the start block gets no phase and is not the label's example.
- **Lists** (`/conductor list`, the start screen): `SavedDesign.goal`.

**Not exercised:** a model turn (Claude setting the goal through the tool, a draft, a hand-off); the stacked and inline layouts.

## Arrows for the detail pane

The keys of the detail pane are the arrows and Enter; Tab and Shift+Tab still step the ring (the engine's, a hook cannot tell them from Down and Up) and are named in no legend, help page or hint.

- **Fields:** `↓` from the graph opens the fields on the first (the door); `↑` / `↓` walk them, each move saving what was typed (`flushDrafts`); Enter saves and goes back to the graph. `←` / `→`, Home, End and Backspace are the field's own. Legend: `[↑ ↓] Field  [Enter] Save, back to the graph`.
- **The ring rests on Inputs alone.** Seen in a real session: on a `Button` the Left arrow is the engine's (`← for agents`): the conversation goes to the background and the pane with it. On an `Input` it moves the cursor, also at the start of the text, in an empty field and on the catcher. So the heading's type Button is no stop the ring keeps (out of `isDetailStop`; `offLabel` is gone): `↑` from the name lands on the door and the hook sends the ring on to the catcher, as it does from the engine's stop on the pane's `✕` (`↓` from the last field, `↑` from the catcher). The ring is on that Button or on the `✕` for one redraw; a Left arrow in that moment still leaves. The engine's stop is left as it is: no `{ deny }`.
- **`t`** (`retype`, `applyOp` → `openRetype`): the list of what the selected block may become, as a press on the type in the heading opens it. Not on the start block (`the start block stays the start block`). Legend: `[t] Block`, not `core`.
- **The list of blocks** (adding and `t`): the ring stays on the filter. A move of the person's off it is an arrow: onto a row (`pick:…`, the stop after the filter) it was Down, onto anything else Up; `movePick` moves the mark, and the hook puts the ring back on the filter. So the arrows choose with text in the filter too. `w` / `s` are letters of the filter, always. Legend: `[↑ ↓] Choose`.
- **The start screen:** the same reading of the arrows. The ring is on the catcher; a move of the person's onto a row (`start:…`) was Down, onto anything else Up (`moveStartMark`), and the ring is sent back to the catcher. `w` / `s` still move the mark. Legend: `[↑ ↓] Choose  [Enter] Open`.

## The project list, the legend in the header, buttons on the last row

Asked for: the design's name in the header chooses the design worked on; the state moves beside it; the legend moves to the header's free second row and the last row holds `[r] Run` and `[q] Claude Review` as buttons. Checked with `claude plugin validate .`, `bunx tsc -p .` and a real paint (160 and 110 columns, docked). Where this section and an earlier one disagree, this one holds.

- **Header, row 1** (`headOf(facts, keys)`): `conductor / <name> ▾ / <state> / <facts>`, nothing at the right. The state is in `FADED` (a run's summary keeps its colour). Loss order: the facts, then the state, then the name cut to 8 cells.
- **The name is a `Button`** (`project-name`; `▾`, and `▴` on the list), not the engine's `Select`: a `Select` lists under itself and scrolls past eight with no marker, and the header is `HEAD_ROWS` 2 tall. A press queues `p`. The key is not `design-name`: that is the name field's (`NAME_KEY`), and the `ui.focus` hook took the button for a field (found live: Up on the list left the ring there and the keys went to the prompt).
- **`p`, `project`** (`openProject`): `flushDrafts`, the saved designs read again (`readSaved`, which `/conductor list` uses too), then the start screen (`status: 'pick'`, `designAtom` null as on any start screen) with `ui.back` the design's name and the mark on its row. Rows are tagged `open` and `running`. State: `PROJECT · a saved design` in place of `START · …`. In `LOCKED_OPS`: looking at another design is no edit. On the error screen it is the one key.
- **Back** (`closeProject`: `x` with no help page open, `p`, Enter on the `open` row): the design from its file as it is now (`openDesign`, the selection from `picks`), with the view root, carousels, `runCleared` and `follow` it was left with (`behind`, module memory); a design no file holds yet comes back from `behind` whole. After a reload `behind` is gone: the file alone.
- **Opening another row** is `openEntry` as before. A template left unedited (`behind.ui.unsaved`) is dropped and said: `<name> was not saved: nothing of it was kept`.
- **Legend** (`legendItems` returns `{ header, actions, detail }`): `header` on the header's second row, left, one row always (`legendRows(…, headColumns, 1)`; `LEGEND_CORE_W` and `LEGEND_WRAP_ROWS` are gone): `[i] Show details`, `[p] Project`, `[⇧+WASD] (Move) Navigate` (`[WASD] Navigate` where the block cannot move), `[n] New`, `[x] Delete`, `[t] Block`, `[o] Open`, `[b] Back`, `[u] Undo`, `[y] Redo`, `[?] Help`. The knobs `1` `2` are named on the card alone: its chips are `[1] model  [2] effort` (`chipSegs`; a chip's digit is read out of the brackets for a press).
- **Last row** (`actionsOf`, `footRows` 1 docked): `LegendAction`s as `Button`s (`act:r`), a press queues the key: `[r] Run`, `[q] Claude Review` (was `Ask Claude`), `[c] Clear results` while results show. Not `on` (dim text, no button): an empty design, a run that locks, a field or the add list open. Blank on the start screen. The gap between two is a `Box` of `ACTION_GAP` 4 cells: as a `Text` of spaces it cost the button before it its last cell.
- **The ring.** The catcher is drawn after the header in the tree, so Down from it still reaches the detail pane; the new Buttons are strays to the `ui.focus` hook, which sends the ring back to the catcher.
- **State:** `DesignUi.back` (`string | null`).

**Not exercised:** a click on the name or on a button of the last row (tmux, keys only: each queues the key that was exercised); the list opened during a run and from the error screen; the inline placement; a reload while the list is open.
