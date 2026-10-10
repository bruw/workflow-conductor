import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import * as partial29 from '../fixtures/partial-29'
import * as review41 from '../fixtures/review-41'
import { emptyRunState } from '../src/run/events'
import type { RunState } from '../src/run/events'
import { replayEvents } from '../src/run/replay'
import type { ReplayFixture } from '../src/run/replay'
import { createTracker } from '../src/run/tracker'
import { buildRunRows, togglePhase } from '../src/ui/rail'
import type { Part, Row } from '../src/ui/rail'
import { GLYPH, PANE_ID, PANE_TITLE } from '../src/ui/theme'

const PLACEHOLDER = 'no workflow running yet'
const MAX_WIDTH = 96
const MAX_ROWS = 400

const FIXTURES: Record<string, ReplayFixture> = { 'review-41': review41, 'partial-29': partial29 }

const runAtom = atom({ plugin: 'conductor', key: 'run' } as const, emptyRunState())
const uiAtom = atom({ plugin: 'conductor', key: 'runUi' } as const, { expanded: [], collapsed: [] })
const clockAtom = atom({ plugin: 'conductor', key: 'runClock' } as const, 0)

// The reducer leaves optional fields present but undefined; the stored copy is plain data.
const plain = (state: RunState): RunState => JSON.parse(JSON.stringify(state)) as RunState

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined)

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

/** The figure shown for a request or a turn: input plus output; cache reads and writes are left out. */
const tokensOf = (usage: unknown): number | undefined => {
  if (usage === null || typeof usage !== 'object') return undefined
  const { input_tokens, output_tokens } = usage as { input_tokens?: unknown; output_tokens?: unknown }

  return count(input_tokens) + count(output_tokens)
}

export const registerRun = (on: On): void => {
  const tracker = createTracker()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'conductor',
      description: 'Open the Conductor workflow pane (dev: replay <fixture> [fast|slow])',
    })

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
        paneShown: async () => (await $.ui.panes()).some(pane => pane.id === PANE_ID && pane.isShown && pane.isPlaced),
        status: line => $.ui.status(line),
        toast: line => $.ui.toast(line),
      },
      await read($, runAtom),
    )

    return next(e)
  })

  on('command.run', { command: 'conductor' }, async ($, e, next) => {
    const [verb, name, speed] = e.args.trim().split(/\s+/)

    if (!verb) {
      const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
      if (opened.isPlaced) tracker.paneOpened()

      return { text: 'Conductor pane opened.' }
    }
    if (verb !== 'replay') return next(e)

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
