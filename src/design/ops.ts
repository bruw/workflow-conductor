// Immutable edits on a Design. Every operation returns a new Design, or the
// same Design plus a reason when the edit is refused. Pure TypeScript.

import { canHoldChildren, findNode, idNumber, isNodeType, knobError, walk } from './model'
import type { Design, DesignNode, Knobs, NodeType } from './model'

export type OpResult = { design: Design; error?: string }

/** `id` is the id of the node that was added. */
export type AddResult = OpResult & { id?: string }

export type Place = { parentId?: string; index: number }

export type NodePatch = { title?: string; notes?: string; knobs?: Partial<Knobs> }

export type MoveByOptions = {
  /** Containers drawn collapsed: a moving node steps over them, not into them. */
  collapsed?: Iterable<string>
}

type Spot = { node: DesignNode; parent: DesignNode | undefined; index: number; siblings: readonly DesignNode[] }

function refuse(design: Design, error: string): OpResult {
  return { design, error }
}

function locate(design: Design, id: string): Spot | undefined {
  let spot: Spot | undefined
  walk(design, (node, info) => {
    if (node.id !== id || spot) return
    spot = { node, parent: info.parent, index: info.index, siblings: info.parent?.children ?? design.nodes }
  })
  return spot
}

// Replaces the child list of `parentId` (the top level when undefined).
function editList(nodes: readonly DesignNode[], parentId: string | undefined, fn: (list: readonly DesignNode[]) => DesignNode[]): DesignNode[] {
  if (parentId === undefined) return fn(nodes)
  return nodes.map(node => {
    if (node.id === parentId) return { ...node, children: fn(node.children ?? []) }
    return node.children ? { ...node, children: editList(node.children, parentId, fn) } : node
  })
}

function without(nodes: readonly DesignNode[], id: string): DesignNode[] {
  return nodes.filter(node => node.id !== id).map(node => (node.children ? { ...node, children: without(node.children, id) } : node))
}

function replace(nodes: readonly DesignNode[], id: string, next: DesignNode): DesignNode[] {
  return nodes.map(node => {
    if (node.id === id) return next
    return node.children ? { ...node, children: replace(node.children, id, next) } : node
  })
}

function insertAt(list: readonly DesignNode[], index: number, node: DesignNode): DesignNode[] {
  const at = Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : list.length, list.length))
  return [...list.slice(0, at), node, ...list.slice(at)]
}

function subtreeHas(node: DesignNode, id: string): boolean {
  return node.id === id || (node.children ?? []).some(child => subtreeHas(child, id))
}

// Why `parentId` cannot take a child, or undefined when it can.
function parentError(design: Design, parentId: string | undefined): string | undefined {
  if (parentId === undefined) return undefined
  const parent = findNode(design, parentId)
  if (!parent) return `no block ${parentId}`
  return canHoldChildren(parent.type) ? undefined : `a ${parent.type} block cannot hold children`
}

/**
 * The number the next new node gets: one more than the highest number ever
 * present. `design.nextId` remembers numbers of removed nodes; a design that
 * lacks it (hand-written, or a template) falls back to the highest id present.
 */
export function nextIdNumber(design: Design): number {
  let highest = 0
  walk(design, node => {
    highest = Math.max(highest, idNumber(node.id))
  })
  return Math.max(design.nextId ?? 1, highest + 1)
}

/** Inserts a new node. `at.index` is clamped to the destination list. */
export function addNode(design: Design, spec: { type: NodeType; title?: string }, at: Place): AddResult {
  if (!isNodeType(spec.type)) return refuse(design, `unknown type ${String(spec.type)}`)
  const error = parentError(design, at.parentId)
  if (error) return refuse(design, error)

  const number = nextIdNumber(design)
  const id = `n${number}`
  const node: DesignNode = { id, type: spec.type, title: spec.title ?? spec.type }
  if (canHoldChildren(spec.type)) node.children = []
  const nodes = editList(design.nodes, at.parentId, list => insertAt(list, at.index, node))
  return { design: { ...design, nextId: number + 1, nodes }, id }
}

/** Removes a node and everything nested in it. */
export function removeNode(design: Design, id: string): OpResult {
  if (!findNode(design, id)) return refuse(design, `no block ${id}`)
  return { design: { ...design, nextId: nextIdNumber(design), nodes: without(design.nodes, id) } }
}

/**
 * Reorders or re-nests a node. `to.index` is the position in the destination
 * list as it stands once the node has been lifted out, clamped to that list.
 */
export function moveNode(design: Design, id: string, to: Place): OpResult {
  const spot = locate(design, id)
  if (!spot) return refuse(design, `no block ${id}`)
  if (to.parentId !== undefined && subtreeHas(spot.node, to.parentId)) {
    return refuse(design, to.parentId === id ? 'a block cannot be moved into itself' : 'a block cannot be moved into a block it holds')
  }
  const error = parentError(design, to.parentId)
  if (error) return refuse(design, error)

  const lifted = without(design.nodes, id)
  return { design: { ...design, nodes: editList(lifted, to.parentId, list => insertAt(list, to.index, spot.node)) } }
}

/**
 * Changes title, notes and knobs. Knobs merge key by key; a knob set to
 * undefined or '' is cleared, and so are notes set to ''. Id and type are fixed.
 */
export function updateNode(design: Design, id: string, patch: NodePatch): OpResult {
  const node = findNode(design, id)
  if (!node) return refuse(design, `no block ${id}`)
  const loose: Record<string, unknown> = patch
  if (loose.id !== undefined && loose.id !== node.id) return refuse(design, 'id cannot be changed')
  if (loose.type !== undefined && loose.type !== node.type) return refuse(design, 'type cannot be changed')
  if (patch.title !== undefined && typeof patch.title !== 'string') return refuse(design, 'title must be a string')
  if (patch.notes !== undefined && typeof patch.notes !== 'string') return refuse(design, 'notes must be a string')

  const next: DesignNode = { ...node }
  if (patch.title !== undefined) next.title = patch.title
  if ('notes' in patch) {
    if (patch.notes) next.notes = patch.notes
    else delete next.notes
  }
  if (patch.knobs) {
    const knobs: Record<string, unknown> = { ...node.knobs }
    for (const [key, value] of Object.entries(patch.knobs)) {
      if (value === undefined || value === '') {
        delete knobs[key]
        continue
      }
      const error = knobError(key, value)
      if (error) return refuse(design, error)
      knobs[key] = value
    }
    if (Object.keys(knobs).length > 0) next.knobs = knobs as Knobs
    else delete next.knobs
  }
  return { design: { ...design, nodes: replace(design.nodes, id, next) } }
}

/**
 * Changes a node's type and nothing else. A block that holds others can only
 * become another container.
 */
export function retypeNode(design: Design, id: string, type: NodeType): OpResult {
  const node = findNode(design, id)
  if (!node) return refuse(design, `no block ${id}`)
  if (!isNodeType(type)) return refuse(design, `unknown type ${String(type)}`)
  if (node.type === type) return { design }
  if ((node.children?.length ?? 0) > 0 && !canHoldChildren(type)) {
    return refuse(design, `${id} holds blocks and a ${type} block cannot hold children: move or remove them first`)
  }
  const next: DesignNode = { ...node, type }
  if (canHoldChildren(type)) next.children = node.children ?? []
  else delete next.children
  return { design: { ...design, nodes: replace(design.nodes, id, next) } }
}

// One keyboard step. Down: swap with the next sibling, or step into it as its
// first child when it is an open container; from the last slot of a container,
// step out to just after it. Up mirrors this, so a step down then a step up
// always lands where it started.
function step(design: Design, id: string, down: boolean, collapsed: ReadonlySet<string>): OpResult {
  const spot = locate(design, id)
  if (!spot) return refuse(design, `no block ${id}`)
  const { parent, index, siblings } = spot
  const neighbour = siblings[down ? index + 1 : index - 1]

  if (neighbour) {
    if (canHoldChildren(neighbour.type) && !collapsed.has(neighbour.id)) {
      return moveNode(design, id, { parentId: neighbour.id, index: down ? 0 : (neighbour.children ?? []).length })
    }
    return moveNode(design, id, { parentId: parent?.id, index: down ? index + 1 : index - 1 })
  }
  if (!parent) return refuse(design, down ? 'already at the bottom' : 'already at the top')
  const outer = locate(design, parent.id)
  if (!outer) return refuse(design, `no block ${parent.id}`)
  return moveNode(design, id, { parentId: outer.parent?.id, index: down ? outer.index + 1 : outer.index })
}

/**
 * Moves a node `delta` keyboard steps (negative is up). Stops at the end of
 * the design; the error is set only when the node could not move at all.
 */
export function moveBy(design: Design, id: string, delta: number, options: MoveByOptions = {}): OpResult {
  const collapsed = new Set(options.collapsed ?? [])
  const steps = Number.isFinite(delta) ? Math.trunc(Math.abs(delta)) : 0
  if (steps === 0) return findNode(design, id) ? { design } : refuse(design, `no block ${id}`)

  let current = design
  for (let done = 0; done < steps; done++) {
    const result = step(current, id, delta > 0, collapsed)
    if (result.error) return done === 0 ? result : { design: current }
    current = result.design
  }
  return { design: current }
}
