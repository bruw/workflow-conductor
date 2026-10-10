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
hooks/canvas.tsx            Client module: the canvas
src/run/                    events.ts reducer.ts journal.ts
src/design/                 model.ts ops.ts lints.ts templates.ts teach.ts
src/ui/                     rail.ts theme.ts tween.ts
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
- **Token figure shown:** `input_tokens + output_tokens`. Cache reads/writes are excluded (they dominate and mislead).
- **Phase:** not on any event. Read it from `journal.jsonl` (`started` line, present once the spawn's `next(e)` resolves) via `$.fs.read`. `transcriptDir` is at `result.result.transcriptDir` of the Workflow `tool.call`, which resolves before the first spawn.
- **Run end:** no signal exists. Treat a run as done when no agent is running and no spawn arrived for a quiet period (8 s); a later spawn for the same run id flips it back to running. A definitive signal can replace this later.
- **Handoff:** a `command.run` answer with `context` does not start a model turn; the context is used on the next prompt. `/conductor run` therefore also needs `$.prompt.submit` (declared, untested) or fill-and-Enter.
- **Pointer:** SGR mouse sequences injected through tmux reach a `Client` (fullscreen session). Clicking a Client gives it the keyboard until Escape.
- **Tick:** `surface.every` runs on 16 ms frames (~60 Hz); ask for multiples of 16.
- **Rules:** `$` may not be passed to a helper function (validate refuses it): spell every `$` call at the call site inside the hook. `$.fs` has no append. The test runner refuses `node:fs` and non-code imports (fixtures are generated `.ts` modules). Idle hot reload lags; `/reload-plugins` forces it.
