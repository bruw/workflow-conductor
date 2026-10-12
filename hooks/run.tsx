import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import * as partial29 from '../fixtures/partial-29'
import * as review41 from '../fixtures/review-41'
import { visualizeBrief } from '../src/design/chat'
import { flatten, parseDesign } from '../src/design/model'
import { VISUALIZE_HEADER, VISUALIZE_KEY, VISUALIZE_OPTIONS, VISUALIZE_QUESTION, reusedToast, storedVisualize, visualizeChoice, visualizeToast, visualizeTyped } from '../src/design/offer'
import { DESIGN_PANE_ID, bareTarget, designFile, designName, endRun, followRun, handoffOf, initialTimes, initialUi, isSaved, openDesign, scriptFile, stampTimes } from '../src/design/session'
import { emptyRunState } from '../src/run/events'
import type { RunState } from '../src/run/events'
import { USAGE_KEYS } from '../src/run/journal'
import { replayEvents } from '../src/run/replay'
import type { ReplayFixture } from '../src/run/replay'
import type { Handoff, Tracker } from '../src/run/tracker'
import { buildRunRows, togglePhase } from '../src/ui/rail'
import type { Part, Row } from '../src/ui/rail'
import { FADED, GLYPH, PANE_ID, PANE_TITLE } from '../src/ui/theme'

import { paneArgs } from './design'

const PLACEHOLDER = 'no workflow running yet'
const MAX_WIDTH = 96
const MAX_ROWS = 400
const HELP = [
  'Usage: /conductor [design [name] | draft <name> <description> | run <name> | list | rename <old> <new> | delete <name> | ask reset | replay <fixture>]',
  '  /conductor                  open the run (on its design, when it came from one); with no run, the design last opened',
  '  /conductor design [name]    open a design; with no name, pick a saved design or start one from a template',
  '  /conductor draft <name> <description>   have Claude draft a design for the description, on the board',
  '  /conductor run <name>       hand the saved design to Claude to implement and run',
  '  /conductor list             the saved designs, each with its block count and what it is for',
  '  /conductor rename <old> <new>   give a saved design another name',
  '  /conductor delete <name>    delete a saved design (asks once more before it does)',
  '  /conductor ask reset        forget every "Always" and "Never" answer, so Conductor asks again',
  '  /conductor replay <fixture|clear> [fast|slow]   replay a recorded run (dev)',
  '  /conductor replay design <template> [fast|slow]   replay a made-up run over a design (dev)',
].join('\n')

const FIXTURES: Record<string, ReplayFixture> = { 'review-41': review41, 'partial-29': partial29 }

// The run's state. Both hooks modules declare these (an atom must be spelled in the
// file that reads it): run.tsx writes them through the tracker, design.tsx reads them.
const runAtom = atom({ plugin: 'conductor', key: 'run' } as const, emptyRunState())
const clockAtom = atom({ plugin: 'conductor', key: 'runClock' } as const, 0)
/** The design the tracked run was started from (a handoff); null for any other run. */
const runDesignAtom = atom({ plugin: 'conductor', key: 'runDesign' } as const, null)
const uiAtom = atom({ plugin: 'conductor', key: 'runUi' } as const, { expanded: [], collapsed: [] })
/** When the run began and ended: stamped as its state is written. */
const timesAtom = atom({ plugin: 'conductor', key: 'runTimes' } as const, initialTimes())
/** The tracked run's script file, and the design drawn of that run after it started (design.tsx `attach` sets it). */
const runScriptAtom = atom({ plugin: 'conductor', key: 'runScript' } as const, null)
// The designer's state (design.tsx owns it): read and written here only so the selection can follow the run.
const designAtom = atom({ plugin: 'conductor', key: 'design' } as const, null)
const designUiAtom = atom({ plugin: 'conductor', key: 'designUi' } as const, initialUi())

// The reducer leaves optional fields present but undefined; the stored copy is plain data.
const plain = (state: RunState): RunState => JSON.parse(JSON.stringify(state)) as RunState

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined)

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

/** The figure shown for a request or a turn: all four usage counts, as the built-in workflow row totals them. */
const tokensOf = (usage: unknown): number | undefined => {
  if (usage === null || typeof usage !== 'object') return undefined
  const counts = usage as Record<string, unknown>

  return USAGE_KEYS.reduce((sum, key) => sum + count(counts[key]), 0)
}

/** Copies a run's script beside its design; a run of that very file copies nothing. Never a throw. */
const keepScript = async ($: EngineInterface, from: string, to: string): Promise<void> => {
  if (from === to) return
  try {
    await $.fs.write(to, await $.fs.read(from))
  } catch {
    // The design is whole without it: the next handoff writes a script anew.
  }
}

/**
 * A run that started with no design, of a workflow named as a saved design that is tied to a script (a block has
 * `match`): the run is shown on that design at once, as design.tsx's `attach` shows one on a design just drawn.
 * Null when there is no such design.
 */
const reuseDesign = async ($: EngineInterface, tracker: Tracker, workflow: string | undefined, script: string | undefined): Promise<{ name: string; placed: boolean } | null> => {
  if (workflow === undefined) return null
  const name = designName(workflow)
  const root = await $.session.root()
  const path = designFile(root, name)
  if (!isSaved(name) || !(await $.fs.exists(path))) return null
  const shown = await read($, designUiAtom)
  const onBoard = shown.name === name && shown.status === 'ready' ? await read($, designAtom) : null
  // The board's copy when it shows this design (a field typed there and not sent is not in the file yet), else the file's.
  const opened = onBoard === null ? openDesign(name, await $.fs.read(path), shown) : null
  const design = onBoard ?? opened?.design ?? null
  if (design === null || !flatten(design).some(row => row.node.match !== undefined)) return null
  if (opened !== null) {
    await update($, designAtom, () => opened.design)
    await update($, designUiAtom, () => opened.ui)
  }
  if (script !== undefined) await keepScript($, script, scriptFile(root, name))
  // The tracker's write reads the run's design and the board: both hold this design before it places the agents.
  await update($, designUiAtom, held => ({ ...held, follow: true, runCleared: false }))
  await update($, runDesignAtom, () => name)
  tracker.adopt(handoffOf(name, design))
  const pane = await $.ui.open(paneArgs(false)).catch(() => undefined)

  return { name, placed: pane?.isPlaced !== false }
}

export const registerRun = (on: On, tracker: Tracker): void => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'conductor',
      description: 'Workflow designer and run view: no argument opens the run view; design [name], draft <name> <description>, run <name>, list, rename <old> <new>, delete <name>, ask reset, replay <fixture>',
      argumentHint: '[design [name] | draft <name> <description> | run <name> | list | rename <old> <new> | delete <name> | ask reset | replay <fixture>]',
    })

    // A run a previous load of the module was following: when it came from a design, its
    // node ids are read from the design file again (they are not stored).
    const stored = await read($, runAtom)
    const attached = stored.status === 'idle' ? null : await read($, runDesignAtom)
    let claim: Handoff | undefined
    if (attached !== null) {
      const body = await $.fs.read(designFile(await $.session.root(), attached)).catch(() => '')
      const parsed = parseDesign(typeof body === 'string' ? body : '')
      if (parsed.ok) claim = handoffOf(attached, parsed.design)
    }

    // The tracker's only way out: every `$` call it causes is spelled here. Its timers
    // outlive this hook, as a `$.clock` callback does.
    tracker.attach(
      {
        write: async state => {
          await update($, runAtom, () => plain(state))
          const now = await $.clock.now()
          const times = await read($, timesAtom)
          if (stampTimes(times, state, now) !== times) await update($, timesAtom, held => stampTimes(held, state, now))
          // The designer's selection follows the block that is running, until the person moves it.
          const name = await read($, runDesignAtom)
          if (name === null || state.status === 'idle') return
          const design = await read($, designAtom)
          const shown = await read($, designUiAtom)
          // Over: the selection goes to the first block with a failure, once.
          const settle = state.status === 'running' ? followRun : endRun
          if (settle(shown, design, state, name) !== shown) await update($, designUiAtom, held => settle(held, design, state, name))
        },
        frame: async tick => {
          await update($, clockAtom, () => tick)
          // The elapsed time in the designer's header: stamped here, about once a second, so no drawing reads a clock.
          const now = await $.clock.now()
          const times = await read($, timesAtom)
          if (stampTimes(times, tracker.state(), now) !== times) await update($, timesAtom, held => stampTimes(held, tracker.state(), now))
        },
        readText: async path => {
          const body = await $.fs.read(path)

          return typeof body === 'string' ? body : ''
        },
        every: (ms, fn) => $.clock.every(ms, fn),
        after: (ms, fn) => $.clock.after(ms, fn),
        // Either pane shows the run: the run view, or the designer with the run laid over it.
        paneShown: async () => (await $.ui.panes()).some(pane => (pane.id === PANE_ID || pane.id === DESIGN_PANE_ID) && pane.isShown && pane.isPlaced),
        design: name => update($, runDesignAtom, () => name),
        status: line => $.ui.status(line),
        toast: line => $.ui.toast(line),
      },
      stored,
      claim,
    )

    return next(e)
  })

  on('command.run', { command: 'conductor' }, async ($, e, next) => {
    const [verb, name, speed] = e.args.trim().split(/\s+/)

    if (!verb) {
      // One place to look: a run that came from a design is shown on that design, by design.tsx.
      // With no run at all there is nothing to show here: design.tsx opens the design last worked on, or the picker.
      if (bareTarget((await read($, runAtom)).status, await read($, runDesignAtom), await read($, designUiAtom)).view === 'design') return next(e)
      const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
      if (opened.isPlaced) tracker.paneOpened()

      return { text: 'Conductor pane opened.' }
    }
    // design.tsx answers these (offer.tsx `ask`), whichever of the hooks the engine asks first.
    if (verb === 'ask' || verb === 'design' || verb === 'draft' || verb === 'run' || verb === 'list' || verb === 'delete' || verb === 'rename' || (verb === 'replay' && name === 'design')) return next(e)
    if (verb !== 'replay') return { text: HELP }

    if (name === 'clear') {
      tracker.clear()

      return { text: 'Run view cleared.' }
    }
    const fixture = name === undefined ? undefined : FIXTURES[name]
    if (name === undefined || !fixture || (speed !== undefined && speed !== 'fast' && speed !== 'slow')) {
      return { text: `Usage: /conductor replay <${Object.keys(FIXTURES).join('|')}|clear> [fast|slow]` }
    }
    tracker.replay(replayEvents(name, fixture), speed ?? 'fast')

    return { text: `Replaying ${name} (${speed ?? 'fast'}); token counts are made up.` }
  })

  // The run starts here. One that no design claimed is asked about, the turn held meanwhile (API-NOTES S10): whether
  // to draw a design of it. Whatever happens after the start, the tool's result goes back: never a throw.
  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const answer = await next(e)
    const result = (answer as { result?: unknown }).result
    if (result === null || typeof result !== 'object') return answer
    const { runId, workflowName, transcriptDir, scriptPath } = result as Record<string, unknown>
    const id = text(runId)
    if (id === undefined) return answer
    tracker.runStarted({ runId: id, name: text(workflowName), transcriptDir: text(transcriptDir) })

    try {
      // The script is the file the result names, in every form of the call (S11). A run started again keeps its drawing.
      const script = text(scriptPath)
      await update($, runScriptAtom, held => (script === undefined ? null : { runId: id, path: script, drawn: held !== null && held.runId === id ? held.drawn : null }))
      const claimed = tracker.design()
      if (claimed !== undefined) {
        // A design's own run: the script it was implemented as is kept beside it, for the next handoff to update.
        if (script !== undefined && isSaved(claimed)) await keepScript($, script, scriptFile(await $.session.root(), claimed))

        return answer
      }
      // A subagent's workflow is not the person's to be asked about; nor is one where nobody reads a question.
      if (e.agentId !== undefined || answer.deny !== undefined || answer.isError === true) return answer
      const surfaces = await $.session.surfaces().catch(() => undefined)
      if (surfaces !== undefined && surfaces.length === 0) return answer
      // The workflow has a design drawn of its script before: no question, the run is on it.
      const reused = await reuseDesign($, tracker, text(workflowName), script)
      if (reused !== null) {
        $.ui.toast(reusedToast(reused.name, reused.placed))

        return answer
      }
      const kept = storedVisualize(await $.store.get(VISUALIZE_KEY).catch(() => undefined))
      let choice = kept
      if (choice === null) {
        let said: string
        try {
          said = await $.ui.ask(VISUALIZE_QUESTION, { options: VISUALIZE_OPTIONS, header: VISUALIZE_HEADER })
        } catch {
          return answer
        }
        const picked = visualizeChoice(said)
        if (picked === null) return said.trim() === '' ? answer : { ...answer, context: [...(answer.context ?? []), visualizeTyped(said)] }
        if (picked.always) {
          await $.store.set(VISUALIZE_KEY, picked.choice).catch(() => undefined)
          $.ui.toast(visualizeToast(picked.choice))
        }
        choice = picked.choice
      }

      return choice === 'skip' ? answer : { ...answer, context: [...(answer.context ?? []), visualizeBrief(script, kept === null)] }
    } catch {
      return answer
    }
  })

  // Only a workflow's agents carry `e.workflow`; the id is on what `next` resolves to.
  on('agent.spawn', async (_$, e, next) => {
    const answer = await next(e)
    const agentId = e.workflow ? text((answer as { agentId?: unknown }).agentId) : undefined
    if (e.workflow && agentId !== undefined) {
      tracker.agentSpawned({ runId: e.workflow.runId, agentId, label: e.description, index: e.workflow.agentIndex })
    }

    return answer
  })

  // Runs on every loop: each chunk goes through untouched, the last one is read.
  on('turn.step', async function* (_$, e, next) {
    for await (const chunk of next(e)) {
      if (chunk.kind === 'stop' && e.agentId !== undefined) tracker.agentUsage(e.agentId, tokensOf(chunk.usage) ?? 0)
      yield chunk
    }
  })

  on('turn.complete', async (_$, e, next) => {
    if (e.agentId !== undefined) {
      tracker.agentEnded(e.agentId, {
        ok: !e.isAborted && e.reason !== 'error' && e.reason !== 'refusal',
        durationMs: e.durationMs,
        tokens: tokensOf(e.usage),
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, runAtom)
    const ui = await read($, uiAtom)
    const now = await read($, clockAtom)
    const rows = buildRunRows(state, {
      expanded: new Set(ui.expanded),
      collapsed: new Set(ui.collapsed),
      now,
      width: Math.min(MAX_WIDTH, e.props.bodyColumns),
    })

    const span = (part: Part) => (
      <Text color={part.color === 'text' ? undefined : part.color} bold={part.bold}>
        {part.text}
      </Text>
    )
    const draw = (row: Row) => {
      const phase = row.phase
      if (row.kind !== 'phase' || phase === undefined) return <Text wrap="truncate-end">{row.parts.map(span)}</Text>
      const isOpen = row.open === true

      // Keyed by the phase, not its text: the counts in the label change, the address must not.
      return (
        <Button key={row.key} plain onPress={() => update($, uiAtom, held => togglePhase(held, phase, isOpen))}>
          {row.parts.map(span)}
        </Button>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>{`${GLYPH.diamond} ${PANE_TITLE}`}</Text>
        {rows.length === 0 && <Text dimColor>{`${GLYPH.railEnd} ${PLACEHOLDER}`}</Text>}
        {rows.slice(0, MAX_ROWS).map(draw)}
        {rows.length > MAX_ROWS && <Text color={FADED}>{`… ${rows.length - MAX_ROWS} more rows`}</Text>}
      </Box>
    )
  })
}
