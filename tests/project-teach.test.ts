import { expect, test } from 'claude-code/testing'

import { KINDS, NODE_TYPES, kindsOf } from '../src/project/model'
import type { Kind } from '../src/project/model'
import { HINT_MAX, KIND_TEACH, PALETTE, TEACH, allBlocks, searchBlocks, startsName } from '../src/project/teach'

const KIND_LIST = Object.values(KINDS).flat() as Kind[]

test('every node type and every kind has a hint that fits its room, and a card', async () => {
  expect(Object.keys(TEACH).sort()).toEqual([...NODE_TYPES].sort())
  expect(Object.keys(KIND_TEACH).sort()).toEqual([...KIND_LIST].sort())

  for (const teach of [...NODE_TYPES.map(type => TEACH[type]), ...KIND_LIST.map(kind => KIND_TEACH[kind])]) {
    expect(teach.hint.length).toBeGreaterThan(0)
    expect(teach.hint.length).toBeLessThanOrEqual(HINT_MAX)
    expect(teach.hint).not.toContain('\n')
    expect(teach.card.length).toBeGreaterThan(0)
  }
})

test('the add list holds every type once but start, and every kind of each', async () => {
  expect(PALETTE.map(entry => entry.type).sort()).toEqual(NODE_TYPES.filter(type => type !== 'start').sort())

  const blocks = allBlocks()
  expect(new Set(blocks.map(block => `${block.type} ${block.kind ?? ''}`)).size).toBe(blocks.length)
  for (const { type } of PALETTE) expect(blocks.filter(block => block.type === type).length).toBe(Math.max(1, kindsOf(type).length))
})

test('searchBlocks ranks a name that starts with the query first', async () => {
  expect(searchBlocks('pipe')[0]).toEqual({ type: 'pipeline' })
  expect(searchBlocks('PIPE')[0]).toEqual({ type: 'pipeline' })
  expect(searchBlocks('judge')[0]).toEqual({ type: 'agent', kind: 'judge' })
  expect(searchBlocks('dry')[0]).toEqual({ type: 'loop', kind: 'dry' })
  expect(searchBlocks('loop')).toEqual(KINDS.loop.map(kind => ({ type: 'loop', kind })))
  // Held anywhere in a name, after the ones that start with it.
  expect(searchBlocks('ver').slice(0, 2)).toEqual([
    { type: 'agent', kind: 'verify' },
    { type: 'loop', kind: 'converged' },
  ])
})

test('searchBlocks finds nothing for an empty query or no match', async () => {
  expect(searchBlocks('')).toEqual([])
  expect(searchBlocks('   ')).toEqual([])
  expect(searchBlocks('zzzq')).toEqual([])
  expect(startsName('sw')).toBe(true)
  expect(startsName('zz')).toBe(false)
  expect(startsName('')).toBe(false)
})
