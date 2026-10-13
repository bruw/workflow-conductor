// Immutable edits on a Project. Every operation returns a new Project, or the
// same Project plus a reason when the edit is refused. Pure TypeScript.

import { START_PLACE, EFFORTS, aType, startOf, startOnly, typeName, canHoldChildren, findNode, isNodeType, knobError, matchError, nextIdNumber, readType, walk } from './model'
import type { Project, ProjectNode, Kind, Knobs, NodeType } from './model'
import { defaultName, fillOf, logicOf, offers, starterOf } from './teach'
import type { BlockRef, Starter } from './teach'

export type OpResult = { project: Project; error?: string }

/** `id` is the id of the node that was added. */
export type AddResult = OpResult & { id?: string }

export type Place = { parentId?: string; index: number }

export type NodePatch = { name?: string; logic?: string; knobs?: Partial<Knobs>; match?: readonly string[] }

type Spot = { node: ProjectNode; parent: ProjectNode | undefined; index: number; siblings: readonly ProjectNode[] }

function refuse(project: Project, error: string): OpResult {
  return { project, error }
}

function locate(project: Project, id: string): Spot | undefined {
  let spot: Spot | undefined
  walk(project, (node, info) => {
    if (node.id !== id || spot) return
    spot = { node, parent: info.parent, index: info.index, siblings: info.parent?.children ?? project.nodes }
  })
  return spot
}

// Replaces the child list of `parentId` (the top level when undefined).
function editList(nodes: readonly ProjectNode[], parentId: string | undefined, fn: (list: readonly ProjectNode[]) => ProjectNode[]): ProjectNode[] {
  if (parentId === undefined) return fn(nodes)
  return nodes.map(node => {
    if (node.id === parentId) return { ...node, children: fn(node.children ?? []) }
    return node.children ? { ...node, children: editList(node.children, parentId, fn) } : node
  })
}

function without(nodes: readonly ProjectNode[], id: string): ProjectNode[] {
  return nodes.filter(node => node.id !== id).map(node => (node.children ? { ...node, children: without(node.children, id) } : node))
}

function replace(nodes: readonly ProjectNode[], id: string, next: ProjectNode): ProjectNode[] {
  return nodes.map(node => {
    if (node.id === id) return next
    return node.children ? { ...node, children: replace(node.children, id, next) } : node
  })
}

function insertAt(list: readonly ProjectNode[], index: number, node: ProjectNode): ProjectNode[] {
  const at = Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : list.length, list.length))
  return [...list.slice(0, at), node, ...list.slice(at)]
}

function subtreeHas(node: ProjectNode, id: string): boolean {
  return node.id === id || (node.children ?? []).some(child => subtreeHas(child, id))
}

// Why `parentId` cannot take a child, or undefined when it can.
function parentError(project: Project, parentId: string | undefined): string | undefined {
  if (parentId === undefined) return undefined
  const parent = findNode(project, parentId)
  if (!parent) return `no block ${parentId}`
  return canHoldChildren(parent.type) ? undefined : `${aType(parent.type)} block cannot hold children`
}

export { nextIdNumber } from './model'

/**
 * Where `n` adds a block: after the selected one; inside it, as its last, when it is a container that holds
 * nothing yet or the one the view shows (beside that one is out of sight); at the end of the project with none selected.
 */
export function addPlace(project: Project, selectedId: string | null, viewRootId: string | null): Place {
  const spot = selectedId === null ? undefined : locate(project, selectedId)
  if (!spot) return { index: project.nodes.length }
  const { node, parent, index } = spot
  const held = node.children?.length ?? 0
  if (canHoldChildren(node.type) && (node.id === viewRootId || held === 0)) return { parentId: node.id, index: held }
  return parent ? { parentId: parent.id, index: index + 1 } : { index: index + 1 }
}

/** What a second `start` block is refused with. */
function startTaken(id: string): string {
  return `the project already has its start block (${id}): every project has one, first, and no other`
}

/** What deleting the `start` block, or making it another block, is refused with. */
export const START_KEPT = 'the start block stays: every project has it, first. Clear its args for a workflow that takes no input'

/**
 * The place a block of `type` really gets when `at` is asked for: `start` goes first whatever was asked,
 * and nothing else goes before it.
 */
export function placeFor(project: Pick<Project, 'nodes'>, type: NodeType, at: Place): Place {
  if (type === 'start') return { index: 0 }
  return at.parentId === undefined && startOf(project) ? { index: Math.max(1, Number.isFinite(at.index) ? Math.trunc(at.index) : project.nodes.length) } : at
}

/** A new block of a type and kind, with what the kind fills in (its logic, and knobs under the ones it is given). */
function made(id: string, block: BlockRef, name: string, knobs: Knobs = {}): ProjectNode {
  const node: ProjectNode = { id, type: block.type, name }
  if (block.kind !== undefined) node.kind = block.kind
  const logic = logicOf(block)
  if (logic !== undefined) node.logic = logic
  const filled = { ...fillOf(block), ...knobs }
  if (Object.keys(filled).length > 0) node.knobs = filled
  if (canHoldChildren(block.type)) node.children = []
  return node
}

/** The blocks a container of a kind starts with, numbered from `number` on. */
function starters(block: BlockRef, number: number): ProjectNode[] {
  return starterOf(block).map((one: Starter, index) => {
    const read = readType(one.type, one.kind)
    const node = made(`n${number + index}`, 'error' in read ? { type: one.type } : read, one.name, one.knobs)
    return one.logic === undefined ? node : { ...node, logic: one.logic }
  })
}

/**
 * Inserts a new node. `at.index` is clamped to the destination list; `start` goes first, and nothing goes before it.
 * A block of a kind is given what the kind fills in, and a container of a kind that starts with blocks is given
 * them: all of it one edit. `bare` leaves the starting blocks out, for an edit that brings its own.
 */
export function addNode(project: Project, spec: { type: NodeType; kind?: Kind; name?: string; bare?: boolean }, asked: Place): AddResult {
  if (!isNodeType(spec.type)) return refuse(project, `unknown type ${String(spec.type)}`)
  const block = readType(spec.type, spec.kind)
  if ('error' in block) return refuse(project, block.error)
  const taken = spec.type === 'start' ? startOf(project) : undefined
  if (taken) return refuse(project, startTaken(taken.id))
  const at = placeFor(project, spec.type, asked)
  const error = parentError(project, at.parentId)
  if (error) return refuse(project, error)

  const number = nextIdNumber(project)
  const id = `n${number}`
  const node = made(id, block, spec.name ?? defaultName(block))
  const held = spec.bare ? [] : starters(block, number + 1)
  if (held.length > 0) node.children = held
  const nodes = editList(project.nodes, at.parentId, list => insertAt(list, at.index, node))
  return { project: { ...project, nextId: number + 1 + held.length, nodes }, id }
}

/** Removes a node and everything nested in it. The `start` block is never removed. */
export function removeNode(project: Project, id: string): OpResult {
  const node = findNode(project, id)
  if (!node) return refuse(project, `no block ${id}`)
  if (node.type === 'start') return refuse(project, START_KEPT)
  return { project: { ...project, nextId: nextIdNumber(project), nodes: without(project.nodes, id) } }
}

/** What a move of the `start` block, or of a block to before it, is refused with. */
export const START_STAY = 'start stays first: the workflow starts at the first block of the project'

/**
 * Reorders or re-nests a node. `to.index` is the position in the destination
 * list as it stands once the node has been lifted out, clamped to that list.
 * The `start` block does not move, and a block sent before it lands after it.
 */
export function moveNode(project: Project, id: string, to: Place): OpResult {
  const spot = locate(project, id)
  if (!spot) return refuse(project, `no block ${id}`)
  if (spot.node.type === 'start') return refuse(project, START_STAY)
  if (to.parentId !== undefined && subtreeHas(spot.node, to.parentId)) {
    return refuse(project, to.parentId === id ? 'a block cannot be moved into itself' : 'a block cannot be moved into a block it holds')
  }
  const error = parentError(project, to.parentId)
  if (error) return refuse(project, error)

  const lifted = without(project.nodes, id)
  const at = placeFor({ nodes: lifted }, spot.node.type, to)
  return { project: { ...project, nodes: editList(lifted, at.parentId, list => insertAt(list, at.index, spot.node)) } }
}

/**
 * Changes name, logic, knobs and match. Knobs merge key by key; a knob set to
 * undefined or '' is cleared, and so is logic set to ''. `match` is replaced whole, and
 * cleared by an empty list. Id and type are fixed.
 */
export function updateNode(project: Project, id: string, patch: NodePatch): OpResult {
  const node = findNode(project, id)
  if (!node) return refuse(project, `no block ${id}`)
  const loose: Record<string, unknown> = patch
  if (loose.id !== undefined && loose.id !== node.id) return refuse(project, 'id cannot be changed')
  if (loose.type !== undefined && loose.type !== node.type) return refuse(project, 'type cannot be changed')
  if (patch.name !== undefined && typeof patch.name !== 'string') return refuse(project, 'name must be a string')
  if (patch.logic !== undefined && typeof patch.logic !== 'string') return refuse(project, 'logic must be a string')

  const next: ProjectNode = { ...node }
  if (patch.name !== undefined) next.name = patch.name
  if ('logic' in patch) {
    if (patch.logic) next.logic = patch.logic
    else delete next.logic
  }
  if (patch.knobs) {
    const knobs: Record<string, unknown> = { ...node.knobs }
    for (const [key, value] of Object.entries(patch.knobs)) {
      if (value === undefined || value === '') {
        delete knobs[key]
        continue
      }
      const error = knobError(key, value)
      if (error) return refuse(project, error)
      knobs[key] = value
    }
    if (Object.keys(knobs).length > 0) next.knobs = knobs as Knobs
    else delete next.knobs
    const stray = startOnly(next)
    if (stray) return refuse(project, stray)
  }
  if (patch.match !== undefined) {
    const error = matchError(patch.match)
    if (error) return refuse(project, error)
    if (patch.match.length > 0) next.match = [...patch.match]
    else delete next.match
  }
  return { project: { ...project, nodes: replace(project.nodes, id, next) } }
}

/**
 * Changes a node's type and kind (the plain kind where none is said). A block that holds others can only
 * become another container; the `start` block stays what it is, and no block becomes one.
 * Its knobs and its logic follow the kind and never lose what was typed: one still as the old kind filled it in goes,
 * and the new kind fills in the ones that are not set. A container left empty starts with its new kind's blocks.
 */
export function retypeNode(project: Project, id: string, type: NodeType, kind?: Kind): OpResult {
  const node = findNode(project, id)
  if (!node) return refuse(project, `no block ${id}`)
  if (!isNodeType(type)) return refuse(project, `unknown type ${String(type)}`)
  const block = readType(type, kind)
  if ('error' in block) return refuse(project, block.error)
  if (node.type === type && node.kind === block.kind) return { project }
  if (node.type === 'start') return refuse(project, START_KEPT)
  if (type === 'start') {
    const taken = startOf(project)
    return refuse(project, taken ? startTaken(taken.id) : `${id} cannot become start: ${START_PLACE}`)
  }
  if ((node.children?.length ?? 0) > 0 && !canHoldChildren(type)) {
    return refuse(project, `${id} holds blocks and ${aType(type)} block cannot hold children: move or remove them first`)
  }
  const next: ProjectNode = { ...node, type }
  if (block.kind !== undefined) next.kind = block.kind
  else delete next.kind
  const knobs: Record<string, unknown> = { ...node.knobs }
  for (const [key, value] of Object.entries(fillOf(node))) if (knobs[key] === value) delete knobs[key]
  for (const [key, value] of Object.entries(fillOf(block))) knobs[key] ??= value
  if (Object.keys(knobs).length > 0) next.knobs = knobs as Knobs
  else delete next.knobs
  const logic = (node.logic === logicOf(node) ? undefined : node.logic) ?? logicOf(block)
  if (logic !== undefined) next.logic = logic
  else delete next.logic
  const number = nextIdNumber(project)
  const held = (node.children?.length ?? 0) > 0 ? [] : starters(block, number)
  if (canHoldChildren(type)) next.children = held.length > 0 ? held : (node.children ?? [])
  else delete next.children
  return { project: { ...project, ...(held.length > 0 ? { nextId: number + held.length } : {}), nodes: replace(project.nodes, id, next) } }
}

/** The knobs a digit steps on the selected block, and the models the first one goes through. */
export type QuickKnob = 'model' | 'effort'
export const MODEL_STEPS: readonly string[] = ['haiku', 'sonnet', 'opus']
/** What an unset model or effort reads as. */
export const INHERIT = 'inherit'

/** Which knob a digit steps on a block: 1 its model, 2 its effort. Undefined where its type has none. */
export function quickKnob(node: Pick<ProjectNode, 'type' | 'kind'>, slot: number): QuickKnob | undefined {
  const has = (knob: keyof Knobs): boolean => offers(node, knob)
  if (slot === 1) return has('model') ? 'model' : undefined
  if (slot === 2) return has('effort') ? 'effort' : undefined
  return undefined
}

/** A quick knob's value in a word: `inherit` for an unset model or effort. */
export function quickValue(node: Pick<ProjectNode, 'knobs'>, knob: QuickKnob): string {
  return node.knobs?.[knob] ?? INHERIT
}

/**
 * Steps a quick knob of a block to its next value: model inherit → haiku → sonnet → opus → inherit (a model
 * of another name goes to inherit), effort inherit → low → … → max → inherit.
 * `knob` and `value` say what it is now; refused where the block's type has no such knob.
 */
export function stepKnob(project: Project, id: string, slot: number): OpResult & { knob?: QuickKnob; value?: string } {
  const node = findNode(project, id)
  if (!node) return refuse(project, `no block ${id}`)
  const knob = quickKnob(node, slot)
  if (knob === undefined) return refuse(project, `${id} is ${/^[aeiou]/.test(node.type) ? 'an' : 'a'} ${typeName(node)}: it has no ${slot === 1 ? 'model' : 'effort'}`)
  const after = <T>(steps: readonly T[], now: T | undefined): T | undefined => (now === undefined ? steps[0] : steps[steps.indexOf(now) + 1 || steps.length])
  const patch: Partial<Knobs> = knob === 'model' ? { model: after(MODEL_STEPS, node.knobs?.model) ?? '' } : { effort: after(EFFORTS, node.knobs?.effort) }
  const result = updateNode(project, id, { knobs: patch })
  const changed = findNode(result.project, id)
  return result.error || !changed ? result : { ...result, knob, value: quickValue(changed, knob) }
}
