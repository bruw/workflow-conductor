import { expect, test } from 'claude-code/testing'

import { NODE_TYPES } from '../src/design/model'
import { HINT_MAX, PALETTE, TEACH, fuzzy } from '../src/design/teach'

test('every node type has a glyph, a name, a short hint and a card', async () => {
  expect(HINT_MAX).toBe(70)
  expect(Object.keys(TEACH).sort()).toEqual([...NODE_TYPES].sort())

  for (const type of NODE_TYPES) {
    const teach = TEACH[type]
    expect([...teach.glyph].length).toBe(1)
    expect(teach.name.length).toBeGreaterThan(0)
    expect(teach.hint.length).toBeGreaterThan(0)
    expect(teach.hint.length).toBeLessThanOrEqual(HINT_MAX)
    expect(teach.hint).not.toContain('\n')
    expect(teach.card.length).toBeGreaterThanOrEqual(3)
    expect(teach.card.length).toBeLessThanOrEqual(6)
    for (const line of teach.card) {
      expect(line.trim().length).toBeGreaterThan(0)
      expect(line.length).toBeLessThanOrEqual(110)
    }
  }
})

test('glyphs and names are distinct', async () => {
  const all = NODE_TYPES.map(type => TEACH[type])

  expect(new Set(all.map(one => one.glyph)).size).toBe(all.length)
  expect(new Set(all.map(one => one.name)).size).toBe(all.length)
})

test('teaching content states the facts that matter most', async () => {
  expect(TEACH.pipeline.hint).toMatch(/no barrier/)
  expect(TEACH.pipeline.hint).toMatch(/[Dd]efault/)
  expect(TEACH.parallel.hint).toMatch(/Barrier/)
  expect(TEACH.parallel.card.join(' ')).toMatch(/16/)
  expect(TEACH.agent.card.join(' ')).toMatch(/schema/)
  expect(TEACH.agent.card.join(' ')).toMatch(/expensive/)
  expect(TEACH.subworkflow.card.join(' ')).toMatch(/One level/)
})

test('the palette lists every type once, primitives before patterns', async () => {
  expect(PALETTE.map(entry => entry.type)).toEqual([...NODE_TYPES])
  expect(PALETTE.filter(entry => entry.tier === 'primitive').map(entry => entry.type)).toEqual(['agent', 'pipeline', 'parallel', 'loop', 'branch', 'subworkflow', 'code'])
  expect(PALETTE.filter(entry => entry.tier === 'pattern').map(entry => entry.type)).toEqual(['verify', 'judge-panel', 'loop-until-dry', 'sweep', 'critic'])
  for (const entry of PALETTE) expect(entry.keywords.length).toBeGreaterThan(0)
})

test('fuzzy ranks the best match first', async () => {
  expect(fuzzy('pipe')[0]).toBe('pipeline')
  expect(fuzzy('adv')[0]).toBe('verify')
  expect(fuzzy('PIPE')[0]).toBe('pipeline')
  expect(fuzzy('barrier')[0]).toBe('parallel')
  expect(fuzzy('judge')[0]).toBe('judge-panel')
  expect(fuzzy('dry')[0]).toBe('loop-until-dry')
  expect(fuzzy('loop').slice(0, 2)).toEqual(['loop', 'loop-until-dry'])
  expect(fuzzy('ppl')).toContain('pipeline')
  expect(fuzzy('if')[0]).toBe('branch')
})

test('fuzzy lists everything for an empty query and nothing for no match', async () => {
  expect(fuzzy('')).toEqual([...NODE_TYPES])
  expect(fuzzy('   ')).toEqual([...NODE_TYPES])
  expect(fuzzy('zzzq')).toEqual([])
})
