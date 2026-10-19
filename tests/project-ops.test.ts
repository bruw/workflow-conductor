import { expect, test } from 'claude-code/testing'

import { CONTAINER_TYPES, NODE_TYPES, emptyProject, findNode, flatten, parseProject, serializeProject } from '../src/project/model'
import type { NodeType, Project } from '../src/project/model'
import { addNode, moveNode, removeNode, updateNode } from '../src/project/ops'
import type { NodePatch, OpResult } from '../src/project/ops'
import { review } from '../src/project/templates'

// The tree as text: "n6 n1 n2[n3 n4] n5".
function shape(project: Project): string {
  const draw = (nodes: Project['nodes']): string => nodes.map(node => (node.children ? `${node.id}[${draw(node.children)}]` : node.id)).join(' ')
  return draw(project.nodes)
}

function ok(result: OpResult): Project {
  if (result.error) throw new Error(result.error)
  return result.project
}

function refused(before: Project, result: OpResult): string {
  expect(result.project).toBe(before)
  expect(typeof result.error).toBe('string')
  return result.error ?? ''
}

function add(project: Project, type: NodeType, at: { parentId?: string; index: number }): Project {
  return ok(addNode(project, { type }, at))
}

// n6 is the start block: it stays first.
const REVIEW = 'n6 n1 n2[n3 n4] n5'

test('addNode inserts at the top level and inside a container, leaving the input alone', async () => {
  const before = review()
  const frozen = serializeProject(before)

  // Nothing goes before the start block: index 0 is the place after it.
  const top = addNode(before, { type: 'agent', name: 'triage' }, { index: 0 })
  expect(top.id).toBe('n7')
  expect(shape(top.project)).toBe('n6 n7 n1 n2[n3 n4] n5')
  expect(findNode(top.project, 'n7')).toMatchObject({ id: 'n7', type: 'agent', name: 'triage' })

  const nested = addNode(top.project, { type: 'parallel' }, { parentId: 'n2', index: 1 })
  expect(nested.id).toBe('n8')
  expect(shape(nested.project)).toBe('n6 n7 n1 n2[n3 n8[] n4] n5')
  expect(findNode(nested.project, 'n8')?.name).toBe('parallel')

  expect(shape(add(before, 'code', { index: 99 }))).toBe('n6 n1 n2[n3 n4] n5 n7')
  expect(shape(add(before, 'code', { index: -3 }))).toBe('n6 n7 n1 n2[n3 n4] n5')
  expect(serializeProject(before)).toBe(frozen)
  expect(parseProject(serializeProject(nested.project)).ok).toBe(true)
})

test('addNode numbers on from the ids an empty project already has', async () => {
  const empty = emptyProject('demo')
  const result = addNode(empty, { type: 'agent' }, { index: 0 })

  expect(shape(empty)).toBe('n1')
  expect(result.id).toBe('n2')
  expect(shape(result.project)).toBe('n1 n2')
})

test('addNode refuses an unknown parent, a parent that cannot hold children, an unknown type or kind and a second start', async () => {
  const before = review()

  expect(refused(before, addNode(before, { type: 'agent' }, { parentId: 'n99', index: 0 }))).toMatch(/no block n99/)
  expect(refused(before, addNode(before, { type: 'agent' }, { parentId: 'n1', index: 0 }))).toMatch(/cannot hold children/)
  expect(refused(before, addNode(before, { type: 'teleport' as NodeType }, { index: 0 }))).toMatch(/unknown type/)
  expect(refused(before, addNode(before, { type: 'agent', kind: 'dry' }, { index: 0 }))).toMatch(/kind/)
  expect(refused(before, addNode(before, { type: 'start' }, { index: 3 }))).toMatch(/start/)
})

test('a container of a kind that starts with blocks is added with them, each with an id of its own', async () => {
  const before = review()
  const added = addNode(before, { type: 'loop', kind: 'pass' }, { index: 99 })
  const loop = findNode(added.project, added.id ?? '')

  expect(loop?.kind).toBe('pass')
  expect((loop?.children ?? []).length).toBeGreaterThan(0)
  const ids = flatten(added.project).map(row => row.node.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(parseProject(serializeProject(added.project)).ok).toBe(true)
  expect(ids).not.toContain(addNode(added.project, { type: 'agent' }, { index: 99 }).id)

  expect(findNode(addNode(before, { type: 'loop', kind: 'pass', bare: true }, { index: 99 }).project, added.id ?? '')?.children).toEqual([])
})

test('only the container types accept children', async () => {
  expect([...CONTAINER_TYPES].sort()).toEqual(['branch', 'loop', 'parallel', 'pipeline'])

  for (const type of NODE_TYPES.filter(one => one !== 'start')) {
    const holder = addNode(emptyProject('demo'), { type }, { index: 99 })
    const child = addNode(holder.project, { type: 'agent' }, { parentId: holder.id, index: 0 })
    expect(child.error === undefined).toBe(CONTAINER_TYPES.includes(type))
  }
})

test('removeNode removes a node with its subtree and refuses an unknown id and the start block', async () => {
  const before = review()

  expect(shape(ok(removeNode(before, 'n3')))).toBe('n6 n1 n2[n4] n5')
  expect(shape(ok(removeNode(before, 'n2')))).toBe('n6 n1 n5')
  expect(shape(before)).toBe(REVIEW)
  expect(refused(before, removeNode(before, 'n99'))).toMatch(/no block n99/)
  expect(refused(before, removeNode(before, 'n6'))).toMatch(/start/)
})

test('ids are never reused after a remove, even when the highest id was removed', async () => {
  // n6, the start block, has the highest id of the template: n5 goes, and the next is still n7.
  const withoutLast = ok(removeNode(review(), 'n5'))
  expect(addNode(withoutLast, { type: 'agent' }, { index: 0 }).id).toBe('n7')

  const nested = add(add(review(), 'pipeline', { index: 1 }), 'agent', { parentId: 'n7', index: 0 })
  expect(shape(nested)).toBe('n6 n7[n8] n1 n2[n3 n4] n5')
  expect(addNode(ok(removeNode(nested, 'n7')), { type: 'agent' }, { index: 0 }).id).toBe('n9')

  let project = emptyProject('demo')
  const handedOut: string[] = []
  for (let round = 0; round < 4; round++) {
    const result = addNode(project, { type: 'agent' }, { index: 0 })
    handedOut.push(result.id ?? '')
    const reloaded = parseProject(serializeProject(ok(removeNode(result.project, result.id ?? ''))))
    if (!reloaded.ok) throw new Error(reloaded.error)
    project = reloaded.project
  }
  expect(handedOut).toEqual(['n2', 'n3', 'n4', 'n5'])
  expect(shape(project)).toBe('n1')
})

test('moveNode reorders among siblings; the start block stays first', async () => {
  const before = review()

  expect(shape(ok(moveNode(before, 'n5', { index: 0 })))).toBe('n6 n5 n1 n2[n3 n4]')
  expect(shape(ok(moveNode(before, 'n1', { index: 3 })))).toBe('n6 n2[n3 n4] n5 n1')
  expect(shape(ok(moveNode(before, 'n1', { index: 99 })))).toBe('n6 n2[n3 n4] n5 n1')
  expect(shape(ok(moveNode(before, 'n4', { parentId: 'n2', index: 0 })))).toBe('n6 n1 n2[n4 n3] n5')
  expect(shape(ok(moveNode(before, 'n1', { index: 1 })))).toBe(REVIEW)
  expect(shape(before)).toBe(REVIEW)
  expect(refused(before, moveNode(before, 'n6', { index: 2 }))).toMatch(/start/)
})

test('moveNode re-nests into and out of containers, keeping the subtree', async () => {
  const before = review()

  expect(shape(ok(moveNode(before, 'n1', { parentId: 'n2', index: 1 })))).toBe('n6 n2[n3 n1 n4] n5')
  expect(shape(ok(moveNode(before, 'n4', { index: 1 })))).toBe('n6 n4 n1 n2[n3] n5')

  const holder = add(before, 'loop', { index: 4 })
  const moved = ok(moveNode(holder, 'n2', { parentId: 'n7', index: 0 }))
  expect(shape(moved)).toBe('n6 n1 n5 n7[n2[n3 n4]]')
  expect(findNode(moved, 'n2')).toEqual(findNode(before, 'n2'))
})

test('moveNode refuses moves into itself, a block it holds, a non-container and unknown ids', async () => {
  const deep = add(review(), 'parallel', { parentId: 'n2', index: 2 })
  expect(shape(deep)).toBe('n6 n1 n2[n3 n4 n7[]] n5')

  expect(refused(deep, moveNode(deep, 'n2', { parentId: 'n2', index: 0 }))).toMatch(/into itself/)
  expect(refused(deep, moveNode(deep, 'n2', { parentId: 'n7', index: 0 }))).toMatch(/holds/)
  expect(refused(deep, moveNode(deep, 'n5', { parentId: 'n1', index: 0 }))).toMatch(/cannot hold children/)
  expect(refused(deep, moveNode(deep, 'n5', { parentId: 'n4', index: 0 }))).toMatch(/cannot hold children/)
  expect(refused(deep, moveNode(deep, 'n99', { index: 0 }))).toMatch(/no block n99/)
  expect(refused(deep, moveNode(deep, 'n5', { parentId: 'n99', index: 0 }))).toMatch(/no block n99/)
})

test('updateNode changes name, logic and match and merges knobs', async () => {
  const before = review()

  const named = ok(updateNode(before, 'n3', { name: 'review hard', logic: 'new logic' }))
  expect(findNode(named, 'n3')).toMatchObject({ id: 'n3', type: 'agent', name: 'review hard', logic: 'new logic' })
  expect(findNode(named, 'n3')?.knobs).toEqual(findNode(before, 'n3')?.knobs)

  const merged = ok(updateNode(before, 'n4', { knobs: { model: 'haiku', effort: 'high' } }))
  expect(findNode(merged, 'n4')?.knobs).toEqual({ ...findNode(before, 'n4')?.knobs, model: 'haiku', effort: 'high' })

  const cleared = ok(updateNode(merged, 'n4', { logic: '', knobs: { effort: undefined, output: '' } }))
  expect(findNode(cleared, 'n4')?.logic).toBeUndefined()
  expect(Object.keys(findNode(cleared, 'n4')?.knobs ?? {})).toEqual(['model'])

  const bare = ok(updateNode(before, 'n2', { knobs: { oncePer: '' } }))
  expect(findNode(bare, 'n2')?.knobs).toBeUndefined()
  expect(shape(bare)).toBe(REVIEW)
  expect(findNode(before, 'n4')?.knobs?.model).toBeUndefined()

  const matched = ok(updateNode(before, 'n3', { match: ['review:*'] }))
  expect(findNode(matched, 'n3')?.match).toEqual(['review:*'])
  expect(findNode(ok(updateNode(matched, 'n3', { match: [] })), 'n3')?.match).toBeUndefined()
})

test('updateNode refuses a change of id or type, bad knobs and unknown ids', async () => {
  const before = review()
  const patch = (value: object): NodePatch => value as NodePatch

  expect(refused(before, updateNode(before, 'n1', patch({ id: 'n9' })))).toMatch(/id cannot be changed/)
  expect(refused(before, updateNode(before, 'n1', patch({ type: 'pipeline' })))).toMatch(/type cannot be changed/)
  expect(refused(before, updateNode(before, 'n1', patch({ knobs: { effort: 'extreme' } })))).toMatch(/effort/)
  expect(refused(before, updateNode(before, 'n1', patch({ knobs: { colour: 'red' } })))).toMatch(/unknown knob/)
  expect(refused(before, updateNode(before, 'n1', patch({ knobs: { goal: 'mine' } })))).toMatch(/goal/)
  expect(refused(before, updateNode(before, 'n1', patch({ match: [''] })))).toMatch(/match/)
  expect(refused(before, updateNode(before, 'n99', { name: 'x' }))).toMatch(/no block n99/)
  expect(findNode(ok(updateNode(before, 'n1', patch({ id: 'n1', type: 'agent', name: 'same' }))), 'n1')?.name).toBe('same')
})

test('every block of a project stays present after any single move', async () => {
  const before = review()
  const ids = flatten(before).map(row => row.node.id).sort()

  for (const id of ids) {
    for (const to of [{ index: 0 }, { index: 2 }, { index: 99 }, { parentId: 'n2', index: 0 }, { parentId: 'n2', index: 5 }]) {
      const after = moveNode(before, id, to).project
      expect(flatten(after).map(row => row.node.id).sort()).toEqual(ids)
      expect(after.nodes[0]?.type).toBe('start')
    }
  }
})
