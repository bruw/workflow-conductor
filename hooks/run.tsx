import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import * as partial29 from '../fixtures/partial-29'
import * as review41 from '../fixtures/review-41'
import { flatten, parseDesign } from '../src/design/model'
import { DESIGN_PANE_ID, designFile } from '../src/design/session'
import { emptyRunState } from '../src/run/events'
import type { RunState } from '../src/run/events'
import { USAGE_KEYS } from '../src/run/journal'
import { replayEvents } from '../src/run/replay'
import type { ReplayFixture } from '../src/run/replay'
import type { Handoff, Tracker } from '../src/run/tracker'
import { buildRunRows, togglePhase } from '../src/ui/rail'
import type { Part, Row } from '../src/ui/rail'
import { GLYPH, PANE_ID, PANE_TITLE } from '../src/ui/theme'

const PLACEHOLDER = 'no workflow running yet'
const MAX_WIDTH = 96
const MAX_ROWS = 400
const HELP = [
  'Usage: /conductor [design [name] | draft <name> <description> | run <name> | list | replay <fixture>]',
  '  /conductor                  open the run view (on its design, when the run came from one)',
  '  /conductor design [name]    open the designer (name defaults to untitled)',
  '  /conductor draft <name> <description>   have Claude draft a design for the description, on the board',
  '  /conductor run <name>       hand the saved design to Claude to implement and run',
  '  /conductor list             name the saved designs',
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

export const registerRun = (on: On, tracker: Tracker): void => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'conductor',
      description: 'Workflow designer and run view: no argument opens the run view; design [name], draft <name> <description>, run <name>, list, replay <fixture>',
      argumentHint: '[design [name] | draft <name> <description> | run <name> | list | replay <fixture>]',
    })

    // A run a previous load of the module was following: when it came from a design, its
    // node ids are read from the design file again (they are not stored).
    const stored = await read($, runAtom)
    const attached = stored.status === 'idle' ? null : await read($, runDesignAtom)
    let claim: Handoff | undefined
    if (attached !== null) {
      const body = await $.fs.read(designFile(await $.session.root(), attached)).catch(() => '')
      const parsed = parseDesign(typeof body === 'string' ? body : '')
      if (parsed.ok) claim = { name: attached, nodeIds: flatten(parsed.design).map(row => row.node.id) }
    }

    // The tracker's only way out: every `$` call it causes is spelled here. Its timers
    // outlive this hook, as a `$.clock` callback does.
    tracker.attach(
      {
        write: state => update($, runAtom, () => plain(state)),
        frame: now => update($, clockAtom, () => now),
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
      if ((await read($, runDesignAtom)) !== null && (await read($, runAtom)).status !== 'idle') return next(e)
      const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
      if (opened.isPlaced) tracker.paneOpened()

      return { text: 'Conductor pane opened.' }
    }
    // design.tsx answers these, whichever of the two hooks the engine asks first.
    if (verb === 'design' || verb === 'draft' || verb === 'run' || verb === 'list' || (verb === 'replay' && name === 'design')) return next(e)
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

  on('tool.call', { tool: 'Workflow' }, async (_$, e, next) => {
    const answer = await next(e)
    const result = (answer as { result?: unknown }).result
    if (result !== null && typeof result === 'object') {
      const { runId, workflowName, transcriptDir } = result as Record<string, unknown>
      const id = text(runId)
      if (id !== undefined) tracker.runStarted({ runId: id, name: text(workflowName), transcriptDir: text(transcriptDir) })
    }

    return answer
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
        {rows.length > MAX_ROWS && <Text color="subtle">{`… ${rows.length - MAX_ROWS} more rows`}</Text>}
      </Box>
    )
  })
}
