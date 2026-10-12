// Immutable edits on a Design. Every operation returns a new Design, or the
// same Design plus a reason when the edit is refused. Pure TypeScript.

import { ARGS_PLACE, EFFORTS, aType, argsOf, typeName, canHoldChildren, findNode, isNodeType, knobError, nextIdNumber, readType, walk } from './model'
import type { Design, DesignNode, Kind, Knobs, NodeType } from './model'
import { defaultName, fillOf, offers, starterOf } from './teach'
import type { BlockRef, Starter } from './teach'

export type OpResult = { design: Design; error?: string }

/** `id` is the id of the node that was added. */
export type AddResult = OpResult & { id?: string }

export type Place = { parentId?: string; index: number }

export type NodePatch = { name?: string; logic?: string; knobs?: Partial<Knobs> }

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
  return canHoldChildren(parent.type) ? undefined : `${aType(parent.type)} block cannot hold children`
}

export { nextIdNumber } from './model'

/**
 * Where `n` adds a block: after the selected one; inside it, as its last, when it is a container that holds
 * nothing yet or the one the view shows (beside that one is out of sight); at the end of the design with none selected.
 */
export function addPlace(design: Design, selectedId: string | null, viewRootId: string | null): Place {
  const spot = selectedId === null ? undefined : locate(design, selectedId)
  if (!spot) return { index: design.nodes.length }
  const { node, parent, index } = spot
  const held = node.children?.length ?? 0
  if (canHoldChildren(node.type) && (node.id === viewRootId || held === 0)) return { parentId: node.id, index: held }
  return parent ? { parentId: parent.id, index: index + 1 } : { index: index + 1 }
}

/** What a second `args` block is refused with. */
function argsTaken(id: string): string {
  return `the design already has its args block (${id}): every design has one, first, and no other`
}

/** What deleting the `args` block, or making it another block, is refused with. */
export const ARGS_KEPT = 'the args block stays: every design has it, first. Clear its logic and output for a workflow that takes no input'

/**
 * The place a block of `type` really gets when `at` is asked for: `args` goes first whatever was asked,
 * and nothing else goes before it.
 */
export function placeFor(design: Pick<Design, 'nodes'>, type: NodeType, at: Place): Place {
  if (type === 'args') return { index: 0 }
  return at.parentId === undefined && argsOf(design) ? { index: Math.max(1, Number.isFinite(at.index) ? Math.trunc(at.index) : design.nodes.length) } : at
}

/** A new block of a type and kind, with what the kind fills in under the knobs it is given. */
function made(id: string, block: BlockRef, name: string, knobs: Knobs = {}): DesignNode {
  const node: DesignNode = { id, type: block.type, name }
  if (block.kind !== undefined) node.kind = block.kind
  const filled = { ...fillOf(block), ...knobs }
  if (Object.keys(filled).length > 0) node.knobs = filled
  if (canHoldChildren(block.type)) node.children = []
  return node
}

/** The blocks a container of a kind starts with, numbered from `number` on. */
function starters(block: BlockRef, number: number): DesignNode[] {
  return starterOf(block).map((one: Starter, index) => {
    const read = readType(one.type, one.kind)
    const node = made(`n${number + index}`, 'error' in read ? { type: one.type } : read, one.name, one.knobs)
    return one.logic === undefined ? node : { ...node, logic: one.logic }
  })
}

/**
 * Inserts a new node. `at.index` is clamped to the destination list; `args` goes first, and nothing goes before it.
 * A block of a kind is given what the kind fills in, and a container of a kind that starts with blocks is given
 * them: all of it one edit. `bare` leaves the starting blocks out, for an edit that brings its own.
 */
export function addNode(design: Design, spec: { type: NodeType; kind?: Kind; name?: string; bare?: boolean }, asked: Place): AddResult {
  if (!isNodeType(spec.type)) return refuse(design, `unknown type ${String(spec.type)}`)
  const block = readType(spec.type, spec.kind)
  if ('error' in block) return refuse(design, block.error)
  const taken = spec.type === 'args' ? argsOf(design) : undefined
  if (taken) return refuse(design, argsTaken(taken.id))
  const at = placeFor(design, spec.type, asked)
  const error = parentError(design, at.parentId)
  if (error) return refuse(design, error)

  const number = nextIdNumber(design)
  const id = `n${number}`
  const node = made(id, block, spec.name ?? defaultName(block))
  const held = spec.bare ? [] : starters(block, number + 1)
  if (held.length > 0) node.children = held
  const nodes = editList(design.nodes, at.parentId, list => insertAt(list, at.index, node))
  return { design: { ...design, nextId: number + 1 + held.length, nodes }, id }
}

/** Removes a node and everything nested in it. The `args` block is never removed. */
export function removeNode(design: Design, id: string): OpResult {
  const node = findNode(design, id)
  if (!node) return refuse(design, `no block ${id}`)
  if (node.type === 'args') return refuse(design, ARGS_KEPT)
  return { design: { ...design, nextId: nextIdNumber(design), nodes: without(design.nodes, id) } }
}

/** What a move of the `args` block, or of a block to before it, is refused with. */
export const ARGS_STAY = 'args stay first: the workflow\'s input is the first block of the design'

/**
 * Reorders or re-nests a node. `to.index` is the position in the destination
 * list as it stands once the node has been lifted out, clamped to that list.
 * The `args` block does not move, and a block sent before it lands after it.
 */
export function moveNode(design: Design, id: string, to: Place): OpResult {
  const spot = locate(design, id)
  if (!spot) return refuse(design, `no block ${id}`)
  if (spot.node.type === 'args') return refuse(design, ARGS_STAY)
  if (to.parentId !== undefined && subtreeHas(spot.node, to.parentId)) {
    return refuse(design, to.parentId === id ? 'a block cannot be moved into itself' : 'a block cannot be moved into a block it holds')
  }
  const error = parentError(design, to.parentId)
  if (error) return refuse(design, error)

  const lifted = without(design.nodes, id)
  const at = placeFor({ nodes: lifted }, spot.node.type, to)
  return { design: { ...design, nodes: editList(lifted, at.parentId, list => insertAt(list, at.index, spot.node)) } }
}

/**
 * Changes name, logic and knobs. Knobs merge key by key; a knob set to
 * undefined or '' is cleared, and so is logic set to ''. Id and type are fixed.
 */
export function updateNode(design: Design, id: string, patch: NodePatch): OpResult {
  const node = findNode(design, id)
  if (!node) return refuse(design, `no block ${id}`)
  const loose: Record<string, unknown> = patch
  if (loose.id !== undefined && loose.id !== node.id) return refuse(design, 'id cannot be changed')
  if (loose.type !== undefined && loose.type !== node.type) return refuse(design, 'type cannot be changed')
  if (patch.name !== undefined && typeof patch.name !== 'string') return refuse(design, 'name must be a string')
  if (patch.logic !== undefined && typeof patch.logic !== 'string') return refuse(design, 'logic must be a string')

  const next: DesignNode = { ...node }
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
      if (error) return refuse(design, error)
      knobs[key] = value
    }
    if (Object.keys(knobs).length > 0) next.knobs = knobs as Knobs
    else delete next.knobs
  }
  return { design: { ...design, nodes: replace(design.nodes, id, next) } }
}

/**
 * Changes a node's type and kind (the plain kind where none is said). A block that holds others can only
 * become another container; the `args` block stays what it is, and no block becomes one.
 * Its knobs follow the kind and never lose what was typed: a knob still as the old kind filled it in goes,
 * and the new kind fills in the ones that are not set. A container left empty starts with its new kind's blocks.
 */
export function retypeNode(design: Design, id: string, type: NodeType, kind?: Kind): OpResult {
  const node = findNode(design, id)
  if (!node) return refuse(design, `no block ${id}`)
  if (!isNodeType(type)) return refuse(design, `unknown type ${String(type)}`)
  const block = readType(type, kind)
  if ('error' in block) return refuse(design, block.error)
  if (node.type === type && node.kind === block.kind) return { design }
  if (node.type === 'args') return refuse(design, ARGS_KEPT)
  if (type === 'args') {
    const taken = argsOf(design)
    return refuse(design, taken ? argsTaken(taken.id) : `${id} cannot become args: ${ARGS_PLACE}`)
  }
  if ((node.children?.length ?? 0) > 0 && !canHoldChildren(type)) {
    return refuse(design, `${id} holds blocks and ${aType(type)} block cannot hold children: move or remove them first`)
  }
  const next: DesignNode = { ...node, type }
  if (block.kind !== undefined) next.kind = block.kind
  else delete next.kind
  const knobs: Record<string, unknown> = { ...node.knobs }
  for (const [key, value] of Object.entries(fillOf(node))) if (knobs[key] === value) delete knobs[key]
  for (const [key, value] of Object.entries(fillOf(block))) knobs[key] ??= value
  if (Object.keys(knobs).length > 0) next.knobs = knobs as Knobs
  else delete next.knobs
  const number = nextIdNumber(design)
  const held = (node.children?.length ?? 0) > 0 ? [] : starters(block, number)
  if (canHoldChildren(type)) next.children = held.length > 0 ? held : (node.children ?? [])
  else delete next.children
  return { design: { ...design, ...(held.length > 0 ? { nextId: number + held.length } : {}), nodes: replace(design.nodes, id, next) } }
}

/** The knobs a digit steps on the selected block, and the models the first one goes through. */
export type QuickKnob = 'model' | 'effort' | 'votes'
export const MODEL_STEPS: readonly string[] = ['haiku', 'sonnet', 'opus']
/** Votes go round from 1 to this. */
export const VOTES_STEP_MAX = 5
/** What an unset model or effort reads as. */
export const INHERIT = 'inherit'

/** Which knob a digit steps on a block: 1 its model, 2 its effort, 3 its votes. Undefined where its type and kind have none. */
export function quickKnob(node: Pick<DesignNode, 'type' | 'kind'>, slot: number): QuickKnob | undefined {
  const has = (knob: keyof Knobs): boolean => offers(node, knob)
  if (slot === 1) return has('model') ? 'model' : undefined
  if (slot === 2) return has('effort') ? 'effort' : undefined
  if (slot === 3) return has('votes') ? 'votes' : undefined
  return undefined
}

/** A quick knob's value in a word: `inherit` for an unset model or effort, `none` for no votes. */
export function quickValue(node: Pick<DesignNode, 'knobs'>, knob: QuickKnob): string {
  if (knob === 'votes') return node.knobs?.votes === undefined ? 'none' : String(node.knobs.votes)
  return node.knobs?.[knob] ?? INHERIT
}

/**
 * Steps a quick knob of a block to its next value: model inherit → haiku → sonnet → opus → inherit (a model
 * of another name goes to inherit), effort inherit → low → … → max → inherit, votes 1 … 5 and round again.
 * `knob` and `value` say what it is now; refused where the block's type has no such knob.
 */
export function stepKnob(design: Design, id: string, slot: number): OpResult & { knob?: QuickKnob; value?: string } {
  const node = findNode(design, id)
  if (!node) return refuse(design, `no block ${id}`)
  const knob = quickKnob(node, slot)
  if (knob === undefined) return refuse(design, `${id} is ${/^[aeiou]/.test(node.type) ? 'an' : 'a'} ${typeName(node)}: it has no ${slot === 1 ? 'model' : slot === 2 ? 'effort' : 'votes'}`)
  const after = <T>(steps: readonly T[], now: T | undefined): T | undefined => (now === undefined ? steps[0] : steps[steps.indexOf(now) + 1 || steps.length])
  const patch: Partial<Knobs> =
    knob === 'model'
      ? { model: after(MODEL_STEPS, node.knobs?.model) ?? '' }
      : knob === 'effort'
        ? { effort: after(EFFORTS, node.knobs?.effort) }
        : { votes: ((node.knobs?.votes ?? 0) % VOTES_STEP_MAX) + 1 }
  const result = updateNode(design, id, { knobs: patch })
  const changed = findNode(result.design, id)
  return result.error || !changed ? result : { ...result, knob, value: quickValue(changed, knob) }
}
