import { expect, test } from 'claude-code/testing'

import { CONTAINER_TYPES, NODE_TYPES, emptyDesign, findNode, flatten, parseDesign, serializeDesign } from '../src/design/model'
import type { Design, NodeType } from '../src/design/model'
import { addNode, moveBy, moveNode, removeNode, updateNode } from '../src/design/ops'
import type { NodePatch, OpResult } from '../src/design/ops'
import { review } from '../src/design/templates'

// The tree as text: "n1 n2[n3 n4] n5".
function shape(design: Design): string {
  const draw = (nodes: Design['nodes']): string => nodes.map(node => (node.children ? `${node.id}[${draw(node.children)}]` : node.id)).join(' ')
  return draw(design.nodes)
}

function ok(result: OpResult): Design {
  if (result.error) throw new Error(result.error)
  return result.design
}

function refused(before: Design, result: OpResult): string {
  expect(result.design).toBe(before)
  expect(typeof result.error).toBe('string')
  return result.error ?? ''
}

function add(design: Design, type: NodeType, at: { parentId?: string; index: number }): Design {
  return ok(addNode(design, { type }, at))
}

// n1 n2[n3 n4] n5
const REVIEW = 'n1 n2[n3 n4] n5'

test('addNode inserts at the top level and inside a container, leaving the input alone', async () => {
  const before = review()
  const frozen = serializeDesign(before)

  const top = addNode(before, { type: 'agent', title: 'triage' }, { index: 0 })
  expect(top.id).toBe('n6')
  expect(shape(top.design)).toBe('n6 n1 n2[n3 n4] n5')
  expect(findNode(top.design, 'n6')).toEqual({ id: 'n6', type: 'agent', title: 'triage' })

  const nested = addNode(top.design, { type: 'parallel' }, { parentId: 'n2', index: 1 })
  expect(nested.id).toBe('n7')
  expect(shape(nested.design)).toBe('n6 n1 n2[n3 n7[] n4] n5')
  expect(findNode(nested.design, 'n7')?.title).toBe('parallel')

  expect(shape(add(before, 'code', { index: 99 }))).toBe('n1 n2[n3 n4] n5 n6')
  expect(shape(add(before, 'code', { index: -3 }))).toBe('n6 n1 n2[n3 n4] n5')
  expect(serializeDesign(before)).toBe(frozen)
  expect(parseDesign(serializeDesign(nested.design)).ok).toBe(true)
})

test('addNode starts an empty design at n1', async () => {
  const result = addNode(emptyDesign('demo'), { type: 'agent' }, { index: 0 })

  expect(result.id).toBe('n1')
  expect(shape(result.design)).toBe('n1')
})

test('addNode refuses an unknown parent, a parent that cannot hold children and an unknown type', async () => {
  const before = review()

  expect(refused(before, addNode(before, { type: 'agent' }, { parentId: 'n99', index: 0 }))).toMatch(/no node n99/)
  expect(refused(before, addNode(before, { type: 'agent' }, { parentId: 'n1', index: 0 }))).toMatch(/cannot hold children/)
  expect(refused(before, addNode(before, { type: 'teleport' as NodeType }, { index: 0 }))).toMatch(/unknown type/)
})

test('only the six container types accept children', async () => {
  expect([...CONTAINER_TYPES].sort()).toEqual(['branch', 'loop', 'loop-until-dry', 'parallel', 'pipeline', 'sweep'])

  for (const type of NODE_TYPES) {
    const holder = addNode(emptyDesign('demo'), { type }, { index: 0 })
    const child = addNode(holder.design, { type: 'agent' }, { parentId: 'n1', index: 0 })
    expect(child.error === undefined).toBe(CONTAINER_TYPES.includes(type))
  }
})

test('removeNode removes a node with its subtree and refuses an unknown id', async () => {
  const before = review()

  expect(shape(ok(removeNode(before, 'n3')))).toBe('n1 n2[n4] n5')
  expect(shape(ok(removeNode(before, 'n2')))).toBe('n1 n5')
  expect(shape(before)).toBe(REVIEW)
  expect(refused(before, removeNode(before, 'n99'))).toMatch(/no node n99/)
})

test('ids are never reused after a remove, even when the highest id was removed', async () => {
  const withoutLast = ok(removeNode(review(), 'n5'))
  const added = addNode(withoutLast, { type: 'agent' }, { index: 0 })
  expect(added.id).toBe('n6')

  // The highest id sits inside a removed subtree.
  const nested = add(add(review(), 'pipeline', { index: 0 }), 'agent', { parentId: 'n6', index: 0 })
  expect(shape(nested)).toBe('n6[n7] n1 n2[n3 n4] n5')
  expect(addNode(ok(removeNode(nested, 'n6')), { type: 'agent' }, { index: 0 }).id).toBe('n8')

  // The counter survives a save and load.
  let design = emptyDesign('demo')
  const handedOut: string[] = []
  for (let round = 0; round < 4; round++) {
    const result = addNode(design, { type: 'agent' }, { index: 0 })
    handedOut.push(result.id ?? '')
    const reloaded = parseDesign(serializeDesign(ok(removeNode(result.design, result.id ?? ''))))
    if (!reloaded.ok) throw new Error(reloaded.error)
    design = reloaded.design
  }
  expect(handedOut).toEqual(['n1', 'n2', 'n3', 'n4'])
  expect(design.nodes).toEqual([])
})

test('moveNode reorders among siblings', async () => {
  const before = review()

  expect(shape(ok(moveNode(before, 'n5', { index: 0 })))).toBe('n5 n1 n2[n3 n4]')
  expect(shape(ok(moveNode(before, 'n1', { index: 2 })))).toBe('n2[n3 n4] n5 n1')
  expect(shape(ok(moveNode(before, 'n1', { index: 99 })))).toBe('n2[n3 n4] n5 n1')
  expect(shape(ok(moveNode(before, 'n4', { parentId: 'n2', index: 0 })))).toBe('n1 n2[n4 n3] n5')
  expect(shape(ok(moveNode(before, 'n1', { index: 0 })))).toBe(REVIEW)
  expect(shape(before)).toBe(REVIEW)
})

test('moveNode re-nests into and out of containers, keeping the subtree', async () => {
  const before = review()

  expect(shape(ok(moveNode(before, 'n1', { parentId: 'n2', index: 1 })))).toBe('n2[n3 n1 n4] n5')
  expect(shape(ok(moveNode(before, 'n4', { index: 0 })))).toBe('n4 n1 n2[n3] n5')

  const holder = add(before, 'loop', { index: 3 })
  const moved = ok(moveNode(holder, 'n2', { parentId: 'n6', index: 0 }))
  expect(shape(moved)).toBe('n1 n5 n6[n2[n3 n4]]')
  expect(findNode(moved, 'n2')).toEqual(findNode(before, 'n2'))
})

test('moveNode refuses moves into itself, a descendant, a non-container and unknown ids', async () => {
  const deep = add(review(), 'parallel', { parentId: 'n2', index: 2 })
  expect(shape(deep)).toBe('n1 n2[n3 n4 n6[]] n5')

  expect(refused(deep, moveNode(deep, 'n2', { parentId: 'n2', index: 0 }))).toMatch(/into itself/)
  expect(refused(deep, moveNode(deep, 'n2', { parentId: 'n6', index: 0 }))).toMatch(/descendant/)
  expect(refused(deep, moveNode(deep, 'n5', { parentId: 'n1', index: 0 }))).toMatch(/cannot hold children/)
  expect(refused(deep, moveNode(deep, 'n5', { parentId: 'n4', index: 0 }))).toMatch(/cannot hold children/)
  expect(refused(deep, moveNode(deep, 'n99', { index: 0 }))).toMatch(/no node n99/)
  expect(refused(deep, moveNode(deep, 'n5', { parentId: 'n99', index: 0 }))).toMatch(/no node n99/)
})

test('updateNode changes title and notes and merges knobs', async () => {
  const before = review()

  const titled = ok(updateNode(before, 'n3', { title: 'review hard', notes: 'new notes' }))
  expect(findNode(titled, 'n3')).toMatchObject({ id: 'n3', type: 'agent', title: 'review hard', notes: 'new notes' })
  expect(findNode(titled, 'n3')?.knobs).toEqual(findNode(before, 'n3')?.knobs)

  const merged = ok(updateNode(before, 'n4', { knobs: { votes: 5, effort: 'high' } }))
  expect(findNode(merged, 'n4')?.knobs).toEqual({ ...findNode(before, 'n4')?.knobs, votes: 5, effort: 'high' })

  const cleared = ok(updateNode(merged, 'n4', { notes: '', knobs: { effort: undefined, prompt: '' } }))
  expect(findNode(cleared, 'n4')?.notes).toBeUndefined()
  expect(Object.keys(findNode(cleared, 'n4')?.knobs ?? {}).sort()).toEqual(['schema', 'votes'])

  const bare = ok(updateNode(before, 'n2', { knobs: { fanout: '' } }))
  expect(findNode(bare, 'n2')?.knobs).toBeUndefined()
  expect(shape(bare)).toBe(REVIEW)
  expect(findNode(before, 'n4')?.knobs?.votes).toBe(3)
})

test('updateNode refuses a change of id or type, bad knobs and unknown ids', async () => {
  const before = review()
  const patch = (value: object): NodePatch => value as NodePatch

  expect(refused(before, updateNode(before, 'n1', patch({ id: 'n9' })))).toMatch(/id cannot be changed/)
  expect(refused(before, updateNode(before, 'n1', patch({ type: 'pipeline' })))).toMatch(/type cannot be changed/)
  expect(refused(before, updateNode(before, 'n1', patch({ knobs: { effort: 'extreme' } })))).toMatch(/effort/)
  expect(refused(before, updateNode(before, 'n1', patch({ knobs: { votes: 0 } })))).toMatch(/votes/)
  expect(refused(before, updateNode(before, 'n1', patch({ knobs: { colour: 'red' } })))).toMatch(/unknown knob/)
  expect(refused(before, updateNode(before, 'n99', { title: 'x' }))).toMatch(/no node n99/)
  expect(ok(updateNode(before, 'n1', patch({ id: 'n1', type: 'agent', title: 'same' }))).nodes[0]?.title).toBe('same')
})

test('moveBy walks a node down through a container and out the other side', async () => {
  let design = review()
  const seen = [shape(design)]
  for (let stepIndex = 0; stepIndex < 4; stepIndex++) {
    design = ok(moveBy(design, 'n1', 1))
    seen.push(shape(design))
  }

  expect(seen).toEqual([REVIEW, 'n2[n1 n3 n4] n5', 'n2[n3 n1 n4] n5', 'n2[n3 n4 n1] n5', 'n2[n3 n4] n1 n5'])
  expect(shape(ok(moveBy(design, 'n1', 1)))).toBe('n2[n3 n4] n5 n1')
})

test('moveBy up retraces moveBy down step for step', async () => {
  const start = review()
  const down: string[] = []
  let design = start
  for (let stepIndex = 0; stepIndex < 5; stepIndex++) {
    design = ok(moveBy(design, 'n1', 1))
    down.push(shape(design))
  }
  const up: string[] = []
  for (let stepIndex = 0; stepIndex < 5; stepIndex++) {
    up.push(shape(design))
    design = ok(moveBy(design, 'n1', -1))
  }

  expect(up.reverse()).toEqual(down)
  expect(shape(design)).toBe(REVIEW)
})

test('moveBy takes several steps at once and stops at the ends', async () => {
  const before = review()

  expect(shape(ok(moveBy(before, 'n1', 3)))).toBe('n2[n3 n4 n1] n5')
  expect(shape(ok(moveBy(before, 'n5', -2)))).toBe('n1 n2[n3 n5 n4]')
  expect(shape(ok(moveBy(before, 'n1', 50)))).toBe('n2[n3 n4] n5 n1')
  expect(shape(ok(moveBy(before, 'n4', -50)))).toBe('n4 n1 n2[n3] n5')
  expect(ok(moveBy(before, 'n1', 0))).toBe(before)

  expect(refused(before, moveBy(before, 'n1', -1))).toMatch(/top/)
  expect(refused(before, moveBy(before, 'n5', 1))).toMatch(/bottom/)
  expect(refused(before, moveBy(before, 'n99', 1))).toMatch(/no node n99/)
  expect(refused(before, moveBy(before, 'n99', 0))).toMatch(/no node n99/)
})

test('moveBy steps over a collapsed container and carries a container with its children', async () => {
  const before = review()

  expect(shape(ok(moveBy(before, 'n1', 1, { collapsed: ['n2'] })))).toBe('n2[n3 n4] n1 n5')
  expect(shape(ok(moveBy(before, 'n5', -1, { collapsed: new Set(['n2']) })))).toBe('n1 n5 n2[n3 n4]')
  expect(shape(ok(moveBy(before, 'n2', 1)))).toBe('n1 n5 n2[n3 n4]')
  expect(shape(ok(moveBy(before, 'n2', -1)))).toBe('n2[n3 n4] n1 n5')
})

test('every row of a design stays present after any single move', async () => {
  const before = review()
  const ids = flatten(before).map(row => row.node.id).sort()

  for (const id of ids) {
    for (const delta of [-2, -1, 1, 2]) {
      const after = moveBy(before, id, delta).design
      expect(flatten(after).map(row => row.node.id).sort()).toEqual(ids)
    }
  }
})
