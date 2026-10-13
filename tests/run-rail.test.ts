import { expect, test } from 'claude-code/testing'

import type { RunEvent } from '../src/run/events'
import { emptyRunState } from '../src/run/events'
import { journalToEvents } from '../src/run/journal'
import { reduceAll } from '../src/run/reducer'
import { replayEvents, replayTokens } from '../src/run/replay'
import {
  bar,
  buildRunRows,
  currentPhase,
  fmtDuration,
  fmtTokens,
  NO_PHASE,
  SPIN_MS,
  SPINNER,
  spinnerFrame,
  statusText,
  togglePhase,
} from '../src/ui/rail'
import type { Row } from '../src/ui/rail'
import * as partial29 from '../fixtures/partial-29'
import * as review41 from '../fixtures/review-41'

const NONE = { expanded: new Set<string>() }

const start = (agentId: string, label: string, phase?: string): RunEvent => ({ kind: 'agent-start', runId: 'wf_1', agentId, label, phase })
const end = (agentId: string, ok: boolean, tokens: number, durationMs?: number): RunEvent => ({ kind: 'agent-end', agentId, ok, tokens, durationMs })

// Two phases and a loose agent: one phase mid-run, one with a failure.
const MIXED = reduceAll([
  { kind: 'run-start', runId: 'wf_1', name: 'demo' },
  start('a1', 'review:bugs', 'Review'),
  start('a2', 'review:perf', 'Review'),
  start('a3', 'verify:auth', 'Verify'),
  start('a4', 'stray'),
  start('a5', 'verify:db', 'Verify'),
  { kind: 'agent-usage', agentId: 'a1', tokens: 4100 },
  end('a2', true, 3300, 61_000),
  end('a3', false, 900, 850),
  end('a5', true, 15_000, 4200),
])

const kinds = (rows: Row[]) => rows.map(row => row.kind)
const byKey = (rows: Row[], key: string) => rows.find(row => row.key === key)

test('fmtTokens keeps three significant places', async () => {
  expect(fmtTokens(0)).toBe('0')
  expect(fmtTokens(842)).toBe('842')
  expect(fmtTokens(999)).toBe('999')
  expect(fmtTokens(1000)).toBe('1.0k')
  expect(fmtTokens(18_234)).toBe('18.2k')
  expect(fmtTokens(99_949)).toBe('99.9k')
  expect(fmtTokens(99_950)).toBe('100k')
  expect(fmtTokens(120_300)).toBe('120k')
  expect(fmtTokens(999_499)).toBe('999k')
  expect(fmtTokens(999_500)).toBe('1.0M')
  expect(fmtTokens(1_240_000)).toBe('1.2M')
  expect(fmtTokens(-5)).toBe('0')
  expect(fmtTokens(Number.NaN)).toBe('0')
})

test('fmtDuration picks the unit by size', async () => {
  expect(fmtDuration(850)).toBe('850ms')
  expect(fmtDuration(1136)).toBe('1.1s')
  expect(fmtDuration(9949)).toBe('9.9s')
  expect(fmtDuration(9950)).toBe('10s')
  expect(fmtDuration(42_400)).toBe('42s')
  expect(fmtDuration(59_600)).toBe('1m00s')
  expect(fmtDuration(185_000)).toBe('3m05s')
  expect(fmtDuration(3_720_000)).toBe('1h02m')
  expect(fmtDuration(-1)).toBe('')
})

test('bar keeps its width whatever the counts, empty at none and full at all', async () => {
  expect(bar(0, 12).trim()).toBe('')
  expect(bar(12, 12)).toBe(bar(20, 12))
  expect(bar(12, 12)).not.toContain(' ')
  expect([...bar(3, 4, 4)].length).toBe(4)
  for (let done = 0; done <= 27; done++) expect([...bar(done, 27)].length).toBe(8)
})

test('the spinner frame follows the clock', async () => {
  expect(spinnerFrame()).toBe(SPINNER[0])
  expect(spinnerFrame(SPIN_MS)).toBe(SPINNER[1])
  expect(spinnerFrame(SPIN_MS * SPINNER.length)).toBe(SPINNER[0])
  expect(new Set(SPINNER.map(frame => [...frame].length))).toEqual(new Set([1]))
})

test('an idle state has no rows', async () => {
  expect(buildRunRows(emptyRunState(), NONE)).toEqual([])
})

test('rows are header, phases in first-seen order, the loose group, footer', async () => {
  const rows = buildRunRows(MIXED, { ...NONE, collapsed: new Set(['Verify']), width: 60 })

  expect(rows.map(row => row.key)).toEqual(['header', 'phase:Review', 'phase:Verify', `phase:${NO_PHASE}`, 'footer'])
  for (const row of rows.slice(0, -1)) expect([...row.text].length).toBe(60)

  const header = byKey(rows, 'header')
  expect(header?.counts).toEqual({ total: 5, running: 2, done: 2, failed: 1 })
  expect(header?.tokens).toBe('23.3k')
  expect(header?.color).toBe('claude')

  const review = byKey(rows, 'phase:Review')
  expect(review).toMatchObject({ glyph: SPINNER[0], color: 'claude', open: false, tokens: '7.4k' })
  expect(review?.counts).toEqual({ total: 2, running: 1, done: 1, failed: 0 })

  expect(byKey(rows, 'phase:Verify')).toMatchObject({ color: 'error', open: false, tokens: '15.9k' })
  expect(byKey(rows, `phase:${NO_PHASE}`)?.counts).toEqual({ total: 1, running: 1, done: 0, failed: 0 })
})

test('a phase with a failed agent opens by itself, and the person can close it', async () => {
  const rows = buildRunRows(MIXED, NONE)

  expect(byKey(rows, 'phase:Verify')?.open).toBe(true)
  expect(byKey(rows, 'phase:Review')?.open).toBe(false)
  expect(rows.filter(row => row.kind === 'agent').map(row => row.key)).toEqual(['agent:a3', 'agent:a5'])

  const failed = byKey(rows, 'agent:a3')
  expect(failed).toMatchObject({ color: 'error', phase: 'Verify', tokens: '900' })

  const closed = togglePhase({ expanded: [], collapsed: [] }, 'Verify', true)
  expect(closed).toEqual({ expanded: [], collapsed: ['Verify'] })
  expect(kinds(buildRunRows(MIXED, { expanded: new Set(closed.expanded), collapsed: new Set(closed.collapsed) }))).not.toContain('agent')

  const reopened = togglePhase(closed, 'Verify', false)
  expect(reopened).toEqual({ expanded: ['Verify'], collapsed: [] })
})

test('an open phase lists its agents with a spinner on the running ones', async () => {
  const rows = buildRunRows(MIXED, { expanded: new Set(['Review']), collapsed: new Set(['Verify']), now: SPIN_MS * 2 })
  const agents = rows.filter(row => row.kind === 'agent')

  expect(agents.map(row => row.key)).toEqual(['agent:a1', 'agent:a2'])
  expect(agents[0]).toMatchObject({ glyph: SPINNER[2], color: 'claude', tokens: '4.1k' })
  expect(agents[1]).toMatchObject({ color: 'success', tokens: '3.3k' })
  expect(rows.indexOf(agents[0] as Row)).toBe(rows.findIndex(row => row.key === 'phase:Review') + 1)
})

test('a long label is clipped to the width', async () => {
  const state = reduceAll([start('a1', 'review: '.padEnd(120, 'x'), 'A phase with a very long title that cannot fit in the row at all')])
  const rows = buildRunRows(state, { expanded: new Set(['A phase with a very long title that cannot fit in the row at all']), width: 40 })

  for (const row of rows.slice(0, -1)) expect([...row.text].length).toBe(40)
})

test('the 41-agent fixture folds into five finished phases', async () => {
  const state = reduceAll(replayEvents('review-41', review41))
  const rows = buildRunRows(state, NONE)
  const phases = rows.filter(row => row.kind === 'phase')
  const total = Object.keys(state.agents).reduce((sum, agentId) => sum + replayTokens(agentId), 0)

  expect(state.status).toBe('done')
  expect(kinds(rows)).toEqual(['header', 'phase', 'phase', 'phase', 'phase', 'phase', 'footer'])
  expect(phases.map(row => row.phase)).toEqual(['Review', 'Foundation', 'Triage', 'Fix', 'Integrate'])
  expect(phases.map(row => row.counts?.total)).toEqual([12, 4, 12, 12, 1])
  for (const phase of phases) {
    expect(phase).toMatchObject({ color: 'success', open: false })
    expect(phase.counts?.done).toBe(phase.counts?.total)
  }
  expect(rows[0]).toMatchObject({ color: 'success', tokens: fmtTokens(total) })
  expect(rows[0]?.counts).toEqual({ total: 41, running: 0, done: 41, failed: 0 })

  const open = buildRunRows(state, { expanded: new Set(['Fix', 'Integrate']) })
  expect(open.filter(row => row.kind === 'agent').length).toBe(13)
  expect(open.filter(row => row.kind === 'agent').every(row => row.color === 'success')).toBe(true)
})

test('the partial fixture stays running and names its busy phase', async () => {
  const state = reduceAll(journalToEvents(partial29.journal, partial29.metas, { runId: 'wf_partial' }))
  const rows = buildRunRows(state, NONE)

  expect(state.status).toBe('running')
  expect(rows[0]?.counts).toEqual({ total: 29, running: 3, done: 26, failed: 0 })
  expect(rows.filter(row => row.kind === 'phase').map(row => row.phase)).toEqual(['Review', 'Triage', 'Implement', 'Integrate'])
  expect(rows.filter(row => row.color === 'claude' && row.kind === 'phase').map(row => row.phase)).toContain(currentPhase(state))
  expect(statusText(state)).toContain(currentPhase(state) ?? '?')

  // Replayed, a recording that stops with agents open is an interrupted run: they end failed, and so does the run.
  const replayed = reduceAll(replayEvents('partial-29', partial29))
  expect(replayed.status).toBe('failed')
  expect(buildRunRows(replayed, NONE)[0]?.counts).toEqual({ total: 29, running: 0, done: 26, failed: 3 })
})
