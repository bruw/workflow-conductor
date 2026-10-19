import { expect, test } from 'claude-code/testing'

import type { RunEvent } from '../src/run/events'
import { emptyRunState } from '../src/run/events'
import type { Project } from '../src/project/model'
import { reduceAll } from '../src/run/reducer'
import { currentStep, planStrip, stripItems } from '../src/ui/compact'
import type { StripItem, StripPart } from '../src/ui/compact'
import { cellWidth } from '../src/ui/text'

const PROJECT: Project = {
  version: 1,
  name: 'review-pr',
  nodes: [
    { id: 'n0', type: 'start', name: 'start' },
    { id: 'n1', type: 'agent', kind: 'scout', name: 'scout diff' },
    { id: 'n6', type: 'code', name: 'split work' },
    {
      id: 'n2',
      type: 'pipeline',
      name: 'review',
      children: [
        { id: 'n3', type: 'agent', name: 'review' },
        { id: 'n4', type: 'agent', kind: 'verify', name: 'verify findings' },
      ],
    },
    {
      id: 'n7',
      type: 'parallel',
      name: 'checks',
      children: [
        { id: 'n8', type: 'agent', name: 'lint' },
        { id: 'n9', type: 'agent', name: 'tests' },
      ],
    },
    { id: 'n5', type: 'agent', kind: 'merge', name: 'merge' },
  ],
}

const IDS = new Set(['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9'])
const start = (agentId: string, label: string): RunEvent => ({ kind: 'agent-start', runId: 'wf_1', agentId, label })
const end = (agentId: string, ok: boolean): RunEvent => ({ kind: 'agent-end', agentId, ok, tokens: 100 })
const runOf = (events: RunEvent[]) => reduceAll([{ kind: 'run-start', runId: 'wf_1', name: 'review-pr' }, ...events], { ids: IDS })

const steps = (items: readonly StripItem[]): { id: string; state: string }[] =>
  items.flatMap(item => (item.kind === 'step' ? [{ id: item.id, state: item.state }] : item.arms.flatMap(steps)))
const width = (parts: readonly StripPart[]): number => parts.reduce((sum, part) => sum + cellWidth(part.text), 0)
const text = (parts: readonly StripPart[]): string => parts.map(part => part.text).join('')

test('the strip has every block but the start, containers opened, arms as a stack', () => {
  const items = stripItems(PROJECT, emptyRunState())
  expect(steps(items).map(step => step.id)).toEqual(['n1', 'n6', 'n3', 'n4', 'n8', 'n9', 'n5'])
  const stack = items.find(item => item.kind === 'stack')
  expect(stack?.kind === 'stack' ? stack.arms.length : 0).toBe(2)
})

test('each step takes its state from the run, and a code step behind a started one has passed', () => {
  const run = runOf([start('a1', 'n1 scout'), end('a1', true), start('a2', 'n3 review:bugs'), start('a3', 'n4 verify'), end('a3', false)])
  const by = Object.fromEntries(steps(stripItems(PROJECT, run)).map(step => [step.id, step.state]))
  expect(by).toEqual({ n1: 'done', n6: 'passed', n3: 'running', n4: 'failed', n8: 'waiting', n9: 'waiting', n5: 'waiting' })
})

test('a parallel of one arm is a fan-out: its blocks are a sequence, not a stack', () => {
  const sweep: Project = { version: 1, name: 'sweep', nodes: [{ id: 'n1', type: 'parallel', kind: 'sweep', name: 'sweep', children: [{ id: 'n2', type: 'agent', name: 'search' }] }] }
  const items = stripItems(sweep, emptyRunState())
  expect(items.some(item => item.kind === 'stack')).toBe(false)
  expect(steps(items).map(step => step.id)).toEqual(['n2'])
})

test('a container the run put its agents on, and none on its blocks, is one step', () => {
  const run = runOf([start('a1', 'n2 review')])
  const ids = steps(stripItems(PROJECT, run)).map(step => step.id)
  expect(ids).toContain('n2')
  expect(ids).not.toContain('n3')
})

test('with no project the steps are the run phases, in the order they came', () => {
  const run = reduceAll([
    { kind: 'run-start', runId: 'wf_1' },
    { kind: 'agent-start', runId: 'wf_1', agentId: 'a1', label: 'x', phase: 'Scan' },
    { kind: 'agent-end', agentId: 'a1', ok: true },
    { kind: 'agent-start', runId: 'wf_1', agentId: 'a2', label: 'y', phase: 'Fix' },
  ])
  expect(steps(stripItems(null, run))).toEqual([
    { id: 'Scan', state: 'done' },
    { id: 'Fix', state: 'running' },
  ])
})

test('the current step is the last one running, else the next to start, else the first failure once over', () => {
  const live = runOf([start('a1', 'n1 scout'), end('a1', true), start('a2', 'n3 review'), start('a3', 'n8 lint')])
  expect(currentStep(stripItems(PROJECT, live), true)).toBe('n8')
  const between = runOf([start('a1', 'n1 scout'), end('a1', true)])
  expect(currentStep(stripItems(PROJECT, between), true)).toBe('n6')
  const over = { ...runOf([start('a1', 'n1 scout'), end('a1', true), start('a2', 'n4 verify'), end('a2', false)]), status: 'failed' as const }
  expect(currentStep(stripItems(PROJECT, over), false)).toBe('n4')
})

test('a strip that fits is whole; one that does not keeps the width and the current step in view', () => {
  const run = runOf([start('a1', 'n1 scout'), end('a1', true), start('a2', 'n3 review'), end('a2', true), start('a3', 'n4 verify')])
  const items = stripItems(PROJECT, run)
  const whole = planStrip(items, 'n4', 500)
  expect(text(whole)).toContain('scout diff')
  expect(text(whole)).toContain('merge')
  for (const room of [12, 20, 31, 44]) {
    for (const current of ['n1', 'n4', 'n5']) {
      const parts = planStrip(items, current, room)
      expect(width(parts)).toBeLessThanOrEqual(room)
      const title = { n1: 'scout', n4: 'verify', n5: 'merge' }[current] ?? ''
      expect(text(parts)).toContain(title)
    }
  }
  // Centred on the middle, both ends are out of view.
  const middle = text(planStrip(items, 'n4', 20))
  expect(middle).not.toContain('scout')
  expect(middle).not.toContain('merge')
})

test('a step wider than the strip shows from its start', () => {
  const long: Project = { version: 1, name: 'long', nodes: [{ id: 'n1', type: 'agent', name: 'a' }, { id: 'n2', type: 'agent', name: 'a very long step title that never fits' }, { id: 'n3', type: 'agent', name: 'b' }] }
  const parts = planStrip(stripItems(long, emptyRunState()), 'n2', 16)
  expect(width(parts)).toBeLessThanOrEqual(16)
  expect(text(parts)).toContain('a very')
})
