// The design as Claude edits it from chat: the tool's description and schema
// (generated from the teaching content and the model, never a second copy),
// the two ways an edit arrives (a list of ops, or a whole tree), and the words
// the tool answers with. Every edit goes through ops.ts and is checked by
// parseDesign before it counts. Pure TypeScript: no `$`, no engine imports.

import { outline } from './handoff'
import { lint } from './lints'
import { CONTAINER_TYPES, EFFORTS, NODE_TYPES, canHoldChildren, findNode, flatten, isNodeType, parseDesign, serializeDesign } from './model'
import type { Design, NodeType } from './model'
import { addNode, moveNode, nextIdNumber, removeNode, retypeNode, updateNode } from './ops'
import type { NodePatch, Place } from './ops'
import { FLASH_MS } from '../ui/board-model'
import { UNDO_HINT } from './history'
import { DESIGN_DIR, carryUi, initialUi } from './session'
import type { DesignUi } from './session'
import { KNOB_HELP, TEACH } from './teach'

/** The tool's short name; the model calls it as `mcp__conductor__design`. */
export const TOOL_NAME = 'design'
export const TOOL_FULL_NAME = 'mcp__conductor__design'
export const DESIGN_DIR_HINT = `${DESIGN_DIR}/<name>.json`

export const ACTIONS = ['read', 'apply', 'write', 'guide'] as const
export const OP_KINDS = ['add', 'update', 'move', 'remove'] as const

const KNOB_NAMES = Object.keys(KNOB_HELP)

/** One line per block type: its id, what it does and when to use it (the inspector's two lines, word for word). */
function typeLines(): string[] {
  return NODE_TYPES.map(type => `- ${type}${canHoldChildren(type) ? ' (container)' : ''}: ${TEACH[type].hint}. Use when ${TEACH[type].when}.`)
}

function knobLine(): string {
  return Object.entries(KNOB_HELP)
    .map(([key, help]) => `${key} (${help})`)
    .join('; ')
}

/** What the model reads every turn: kept short. The long cards are behind `guide`. */
export function toolDescription(): string {
  return [
    `Reads and edits the user's Conductor workflow design: the board of blocks they see, saved at ${DESIGN_DIR_HINT}. Use it whenever the user asks to draft, add, change, move or remove workflow blocks or steps ("add a verify after n3", "this block"); do not edit that file by hand. A design is a spec the user reviews, not a script: never run it from here.`,
    'Actions: read = the design JSON, the block selected on the board ("this block") and the lints. Always read before you describe, review or edit a design: the user changes the board by hand between your turns, so what you read or wrote earlier may be gone (every answer names the revision it shows). apply = `ops` in order, all or nothing. write = replace the whole tree with `nodes` (drafting, large restructures): keep the id of every block that stays, leave id off new ones. guide = the long help card of every type. `name` defaults to the design open on the board. An edit shows on the board at once and returns the lints: fix them or tell the user.',
    "Block: { id, type, title, notes?, knobs?, children? }. Ids (n1, n2…) are assigned for you and never change. title is a short label; notes is free text saying what the block should do. Order is execution order. Only containers hold children. Blocks directly inside a branch are its arms (one of them runs), and directly inside a parallel or sweep they run side by side: to run two blocks one after the other there, put both in a pipeline. The design's `description` is the goal of the whole workflow: set it when drafting, keep it true.",
    'Types:',
    ...typeLines(),
    `Knobs, all optional: ${knobLine()}.`,
  ].join('\n')
}

const BLOCK_FIELDS = {
  type: { enum: [...NODE_TYPES] },
  title: { type: 'string' },
  notes: { type: 'string' },
  knobs: { type: 'object', description: `Any of ${KNOB_NAMES.join(', ')}. In an update, "" clears a knob.` },
  children: { type: 'array', items: { type: 'object' }, description: 'Blocks inside a container, same shape.' },
}

export const TOOL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['action'],
  properties: {
    action: { enum: [...ACTIONS] },
    name: { type: 'string', description: 'Design name. Default: the one open on the board.' },
    description: { type: 'string', description: "apply/write: the design's one-line description: the goal of the workflow." },
    ops: {
      type: 'array',
      description:
        'apply. add: a new block (type, title, notes?, knobs?, children?) placed by `after` or `before` (a sibling id) or `parent` (a container id: appended); none of them = end of the top level. update: `id` plus the fields to change (type too). move: `id` plus after | before | parent. remove: `id`, with everything it holds.',
      items: {
        type: 'object',
        required: ['op'],
        properties: { op: { enum: [...OP_KINDS] }, id: { type: 'string' }, after: { type: 'string' }, before: { type: 'string' }, parent: { type: 'string' }, ...BLOCK_FIELDS },
      },
    },
    nodes: {
      type: 'array',
      description: 'write. The whole tree, top level first.',
      items: { type: 'object', required: ['type', 'title'], properties: { id: { type: 'string', description: 'Only for a block that already exists.' }, ...BLOCK_FIELDS } },
    },
  },
}

/** Every type's long card: what `guide` answers, and what a draft is briefed with. */
export function guideText(): string {
  const lines: string[] = [`Containers (the only blocks that hold children): ${CONTAINER_TYPES.join(', ')}.`, `Knobs: ${knobLine()}.`, `Effort values: ${EFFORTS.join(', ')}.`, '']
  for (const type of NODE_TYPES) {
    lines.push(`${type}${TEACH[type].name === type ? '' : ` — ${TEACH[type].name}`}: ${TEACH[type].hint}. Use when ${TEACH[type].when}.`)
    for (const line of TEACH[type].card) lines.push(`  ${line}`)
  }
  return lines.join('\n')
}

/** What Claude is told, unseen, when the person asks for a draft. */
export function draftBrief(name: string, description: string): string[] {
  return [
    [
      `Conductor draft: the user wants a workflow design named "${name}" for: ${description}`,
      '',
      `Make it with the ${TOOL_FULL_NAME} tool: one call with action "write", name "${name}", a one-line description and the nodes.`,
      'The design is a spec the user reviews on the board. Do not write a workflow script and do not run anything.',
      'Pick the structure the task needs and no more: a few blocks with clear notes beat many. Use knobs where they say something (fanout, votes, until, schema).',
      `Afterwards say in two or three lines what the blocks do, name any lint you chose to leave, and say that /conductor run ${name} runs it.`,
      '',
      guideText(),
    ].join('\n'),
  ]
}

// ---------------------------------------------------------------------------
// Edits

/** `notes` are things the edit did that the caller may not have meant, said in the answer. */
export type Change = { added: string[]; changed: string[]; removed: string[]; notes?: string[] }

export type Edit = ({ ok: true; design: Design } & Change) | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const TYPES_HINT = `types: ${NODE_TYPES.join(', ')}`
const CONTAINERS_HINT = `containers: ${CONTAINER_TYPES.join(', ')}`
const KNOBS_HINT = `knobs: ${KNOB_NAMES.join(', ')}`

// A refusal Claude can act on: the model's own reason, plus the list it should have picked from.
function explain(error: string): string {
  if (error.includes('unknown type')) return `${error}; ${TYPES_HINT}`
  if (error.includes('cannot hold children')) return `${error}; ${CONTAINERS_HINT}`
  if (error.includes('unknown knob')) return `${error}; ${KNOBS_HINT}`
  return error
}

function knobsError(raw: unknown, where: string): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isRecord(raw)) return `${where}: knobs must be an object`
  const stray = Object.keys(raw).find(key => !KNOB_NAMES.includes(key))
  return stray === undefined ? undefined : `${where}: unknown knob ${stray}`
}

function signature(design: Design): Map<string, string> {
  const out = new Map<string, string>()
  for (const row of flatten(design)) {
    const { id, type, title, notes, knobs } = row.node
    out.set(id, JSON.stringify([row.parentId ?? null, type, title, notes ?? '', Object.entries(knobs ?? {}).sort(([a], [b]) => a.localeCompare(b))]))
  }
  return out
}

/** Which blocks an edit added, changed (their own fields or their container) or removed. Order among siblings is not compared. */
export function diffDesigns(before: Design | null, after: Design): Change {
  const old = before ? signature(before) : new Map<string, string>()
  const now = signature(after)
  const change: Change = { added: [], changed: [], removed: [] }
  for (const [id, mark] of now) {
    if (!old.has(id)) change.added.push(id)
    else if (old.get(id) !== mark) change.changed.push(id)
  }
  for (const id of old.keys()) if (!now.has(id)) change.removed.push(id)
  return change
}

// The last gate: whatever was assembled is read back by the model's own parser.
function checked(before: Design, candidate: Design, touched: Iterable<string> = [], notes: string[] = []): Edit {
  const parsed = parseDesign(serializeDesign(candidate))
  if (!parsed.ok) return { ok: false, error: explain(parsed.error) }
  const change = diffDesigns(before, parsed.design)
  for (const id of touched) {
    if (!change.added.includes(id) && !change.changed.includes(id) && findNode(parsed.design, id)) change.changed.push(id)
  }
  return { ok: true, design: parsed.design, ...change, ...(notes.length > 0 ? { notes } : {}) }
}

/**
 * What an `add` beside a sibling did when that sibling stands directly in a branch, a parallel or a sweep:
 * the new block is not a step after it but another arm, or another block run at the same time. Null elsewhere.
 */
export function armNote(design: Design, id: string, beside: string): string | null {
  const row = flatten(design).find(one => one.node.id === id)
  const parent = row?.parentId === undefined ? undefined : findNode(design, row.parentId)
  if (!parent) return null
  if (parent.type === 'branch') return `${id} was added as a new arm of branch ${parent.id} (a branch runs one of its arms), not as a step after ${beside}. To run it after ${beside} in the same arm, wrap the two in a pipeline: add a pipeline in ${parent.id}, then move ${beside} and ${id} into it.`
  if (parent.type === 'parallel' || parent.type === 'sweep') return `${id} was added beside ${beside} in ${parent.type} ${parent.id}: the two run at the same time, not one after the other. To run it after ${beside}, wrap the two in a pipeline inside ${parent.id}.`
  return null
}

/**
 * Replaces the whole tree. A block whose id is in the design as it stood keeps
 * it; every other block is new and gets a fresh id, whatever id it came with,
 * so ids are never reused and never collide.
 */
export function replaceDesign(before: Design, rawNodes: unknown, description?: unknown): Edit {
  if (!Array.isArray(rawNodes)) return { ok: false, error: 'write needs `nodes`: the array of top-level blocks' }
  if (description !== undefined && typeof description !== 'string') return { ok: false, error: 'description must be a string' }
  const known = new Set(flatten(before).map(row => row.node.id))
  const kept = new Set<string>()
  let next = nextIdNumber(before)
  let problem: string | undefined

  const build = (raw: unknown, where: string): Record<string, unknown> => {
    if (!isRecord(raw)) {
      problem ??= `${where} must be an object`
      return {}
    }
    let id: string
    if (typeof raw.id === 'string' && known.has(raw.id)) {
      if (kept.has(raw.id)) problem ??= `duplicate id ${raw.id}: a block that stays appears once; leave id off new blocks`
      kept.add(raw.id)
      id = raw.id
    } else id = `n${next++}`
    const type = raw.type
    problem ??= knobsError(raw.knobs, id)
    const node: Record<string, unknown> = { id, type, title: typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title : typeof type === 'string' ? type : '' }
    if (typeof raw.notes === 'string' && raw.notes.trim() !== '') node.notes = raw.notes
    else if (raw.notes !== undefined && raw.notes !== null && typeof raw.notes !== 'string') problem ??= `${id}: notes must be a string`
    if (isRecord(raw.knobs)) node.knobs = Object.fromEntries(Object.entries(raw.knobs).filter(([, value]) => value !== '' && value !== null))
    const children = raw.children
    if (children !== undefined && children !== null && !Array.isArray(children)) problem ??= `${id}: children must be an array`
    const list = Array.isArray(children) ? children : []
    if (list.length > 0 || (isNodeType(type) && canHoldChildren(type))) node.children = list.map((child, index) => build(child, `${id}.children[${index}]`))
    return node
  }

  const nodes = rawNodes.map((raw, index) => build(raw, `nodes[${index}]`))
  if (problem !== undefined) return { ok: false, error: explain(problem) }
  const candidate = { version: 1, name: before.name, description: description ?? before.description, nextId: next, nodes } as unknown as Design
  // Not serializeDesign: it would trust shapes that have not been checked yet.
  const parsed = parseDesign(JSON.stringify(candidate))
  if (!parsed.ok) return { ok: false, error: explain(parsed.error) }
  return checked(before, parsed.design)
}

// Where an op points: beside a sibling, or at the end of a container; the end of the top level with none.
function placeOf(design: Design, op: Record<string, unknown>): Place | string {
  const beside = op.after ?? op.before
  if (beside !== undefined) {
    if (typeof beside !== 'string') return 'after/before must be a block id'
    const row = flatten(design).find(one => one.node.id === beside)
    if (!row) return `no block ${beside}`
    const index = op.after !== undefined ? row.index + 1 : row.index
    return row.parentId === undefined ? { index } : { parentId: row.parentId, index }
  }
  if (op.parent !== undefined && op.parent !== null) {
    if (typeof op.parent !== 'string') return 'parent must be a block id'
    const parent = findNode(design, op.parent)
    if (!parent) return `no block ${op.parent}`
    return { parentId: parent.id, index: parent.children?.length ?? 0 }
  }
  return { index: design.nodes.length }
}

function patchOf(raw: Record<string, unknown>): NodePatch {
  const patch: Record<string, unknown> = {}
  if (raw.title !== undefined && raw.title !== null) patch.title = raw.title
  if (raw.notes !== undefined && raw.notes !== null) patch.notes = raw.notes
  if (raw.knobs !== undefined && raw.knobs !== null) patch.knobs = raw.knobs
  return patch as NodePatch
}

type Grown = { design: Design; ids: string[] } | { error: string }

// Adds one block and, inside it, its children.
function grow(design: Design, raw: unknown, at: Place): Grown {
  if (!isRecord(raw)) return { error: 'a block must be an object' }
  if (!isNodeType(raw.type)) return { error: `unknown type ${JSON.stringify(raw.type)}` }
  const type: NodeType = raw.type
  const added = addNode(design, { type, title: typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title : undefined }, at)
  if (added.error || added.id === undefined) return { error: added.error ?? 'could not add' }
  const id = added.id
  const knobs = knobsError(raw.knobs, id)
  if (knobs) return { error: knobs }
  const patched = updateNode(added.design, id, patchOf({ notes: raw.notes, knobs: raw.knobs }))
  if (patched.error) return { error: `${id}: ${patched.error}` }
  let current = patched.design
  const ids = [id]
  const children = raw.children
  if (children !== undefined && children !== null && !Array.isArray(children)) return { error: `${id}: children must be an array` }
  for (const [index, child] of (Array.isArray(children) ? children : []).entries()) {
    const inner = grow(current, child, { parentId: id, index })
    if ('error' in inner) return inner
    current = inner.design
    ids.push(...inner.ids)
  }
  return { design: current, ids }
}

/** Applies the ops in order. One refused op refuses them all, and says which. */
export function applyOps(before: Design, rawOps: unknown, description?: unknown): Edit {
  if (description !== undefined && typeof description !== 'string') return { ok: false, error: 'description must be a string' }
  const ops = rawOps === undefined && description !== undefined ? [] : rawOps
  if (!Array.isArray(ops)) return { ok: false, error: 'apply needs `ops`: an array of { op: add | update | move | remove, … }' }
  let design: Design = description === undefined ? before : { ...before, description }
  const touched: string[] = []
  const notes: string[] = []

  for (const [index, op] of ops.entries()) {
    const kind = isRecord(op) ? op.op : undefined
    const refuse = (error: string): Edit => ({ ok: false, error: `ops[${index}]${typeof kind === 'string' ? ` (${kind})` : ''}: ${explain(error)}. Nothing was changed.` })
    if (!isRecord(op)) return refuse('an op must be an object')
    if (kind === 'add') {
      const at = placeOf(design, op)
      if (typeof at === 'string') return refuse(at)
      const grown = grow(design, op, at)
      if ('error' in grown) return refuse(grown.error)
      design = grown.design
      const beside = op.after ?? op.before
      const note = typeof beside === 'string' && grown.ids[0] !== undefined ? armNote(design, grown.ids[0], beside) : null
      if (note !== null) notes.push(note)
      continue
    }
    const id = op.id
    if (kind !== 'update' && kind !== 'move' && kind !== 'remove') return refuse(`op must be one of ${OP_KINDS.join(', ')}`)
    if (typeof id !== 'string') return refuse('needs the `id` of a block')
    if (!findNode(design, id)) return refuse(`no block ${id}`)
    if (kind === 'remove') {
      design = removeNode(design, id).design
      continue
    }
    if (kind === 'move') {
      // The place is read with the block lifted out, as moveNode counts it.
      if (op.after === undefined && op.before === undefined && (op.parent === undefined || op.parent === null)) return refuse('needs after, before or parent')
      const at = placeOf(removeNode(design, id).design, op)
      if (typeof at === 'string') return refuse(at.startsWith('no block') ? `${at} outside ${id}` : at)
      const moved = moveNode(design, id, at)
      if (moved.error) return refuse(moved.error)
      design = moved.design
      touched.push(id)
      continue
    }
    if (op.type !== undefined) {
      if (!isNodeType(op.type)) return refuse(`unknown type ${JSON.stringify(op.type)}`)
      const retyped = retypeNode(design, id, op.type)
      if (retyped.error) return refuse(retyped.error)
      design = retyped.design
    }
    const knobs = knobsError(op.knobs, id)
    if (knobs) return refuse(knobs)
    const updated = updateNode(design, id, patchOf(op))
    if (updated.error) return refuse(updated.error)
    design = updated.design
  }
  return checked(before, design, touched, notes)
}

// ---------------------------------------------------------------------------
// What the tool answers with

function lintLines(design: Design): string[] {
  const lints = lint(design)
  if (lints.length === 0) return ['Lints: none.']
  return ['Lints (advisory: fix them, or tell the user why they stand):', ...lints.map(one => `- ${one.nodeId} [${one.rule}]: ${one.message}`)]
}

/** `revision` counts every change to the design this session, by hand or from chat: an answer that names an older one is stale. */
export type ReadState = { open: boolean; selectedId: string | null; locked: boolean; revision?: number }

function revisionWords(revision: number | undefined): string {
  return revision === undefined ? '' : ` Revision ${revision}: the user edits the board by hand, so read again before relying on this later.`
}

export function readReport(design: Design, state: ReadState): string {
  const selected = state.selectedId === null ? undefined : findNode(design, state.selectedId)
  const where = state.open ? `open on the board; selected block ("this block"): ${selected ? `${selected.id} (${selected.type} "${selected.title}")` : 'none'}` : 'not open on the board'
  return [
    `Design "${design.name}" as it is on the board now (${where})${state.locked ? '. A run of it is in progress: editing is locked until it ends' : ''}.${revisionWords(state.revision)}`,
    serializeDesign(design).trimEnd(),
    ...lintLines(design),
  ].join('\n')
}

export function editReport(design: Design, change: Change, revision?: number): string {
  const parts = [
    change.added.length > 0 ? `added ${change.added.join(', ')}` : '',
    change.changed.length > 0 ? `changed ${change.changed.join(', ')}` : '',
    change.removed.length > 0 ? `removed ${change.removed.join(', ')}` : '',
  ].filter(Boolean)
  return [
    `Design "${design.name}" saved and shown on the board: ${parts.length > 0 ? parts.join('; ') : 'nothing differs from before'}.${revisionWords(revision)}`,
    ...(change.notes ?? []).map(note => `Note: ${note}`),
    'Now:',
    ...outline(design),
    ...lintLines(design),
  ].join('\n')
}

/** The design a path names, when it is a design file under `root`; null for any other path. */
export function designOfPath(root: string, cwd: string, path: string): string | null {
  if (path === '') return null
  const absolute = path.startsWith('/') ? path : `${cwd.replace(/\/+$/, '')}/${path}`
  const parts: string[] = []
  for (const part of absolute.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  const prefix = `${root.replace(/\/+$/, '')}/${DESIGN_DIR}/`
  const clean = `/${parts.join('/')}`
  if (!clean.startsWith(prefix)) return null
  const file = clean.slice(prefix.length)
  return /^[a-z0-9-]+\.json$/.test(file) ? file.slice(0, -'.json'.length) : null
}

/** A change in a few words, for the line under the board and the undo history: `added n12; changed n3, n4`. '' for none. */
export function changeWords(change: Change): string {
  const list = (ids: string[]): string => (ids.length > 4 ? `${ids.slice(0, 4).join(', ')} and ${ids.length - 4} more` : ids.join(', '))
  return [change.added.length > 0 ? `added ${list(change.added)}` : '', change.changed.length > 0 ? `changed ${list(change.changed)}` : '', change.removed.length > 0 ? `removed ${list(change.removed)}` : ''].filter(Boolean).join('; ')
}

/** What the model is told, unseen, with a prompt sent after the board changed by hand since it last read the design. */
export function staleNote(name: string, revision: number): string {
  return `Conductor: the user changed the "${name}" workflow design on the board by hand since you last read or edited it (it is now revision ${revision}). What you know of it is out of date: call ${TOOL_FULL_NAME} with action "read" before you describe, review or edit it.`
}

/** When the hooks module takes the mark's ids back: once the board has shown it. */
export const FLASH_CLEAR_MS = FLASH_MS + 400

/**
 * The pane's state once an edit from chat (or a reload of the file) has landed:
 * the design is the one shown, the touched blocks are marked for a moment, and
 * the selection goes to the first new block so the board scrolls to it. `seq`
 * only ever grows, so the board can tell one edit from the next.
 */
export function showEdit(ui: DesignUi, name: string, design: Design, change: Change): DesignUi {
  const same = ui.name === name && ui.status === 'ready'
  // The draft has landed (or the file changed): the board no longer says Claude is drafting.
  // An edit never lands under the results of a run that is over: they are put away.
  const base: DesignUi = same ? { ...ui, grabbedId: null, picker: null, confirmId: null, editing: false, describing: false, freshId: null, drafting: false, notice: null, runCleared: true } : { ...carryUi(ui, initialUi()), name, status: 'ready' }
  const still = same && ui.selectedId !== null && findNode(design, ui.selectedId) ? ui.selectedId : null
  const selectedId = change.added[0] ?? still ?? change.changed[0] ?? design.nodes[0]?.id ?? null
  // Said under the board, with the way back: an edit from chat is undone like any other.
  const said = changeWords(change)
  return { ...base, selectedId, notice: said !== '' ? `Claude ${said} · ${UNDO_HINT}` : base.notice, flash: { ids: [...change.added, ...change.changed], seq: (ui.flash?.seq ?? 0) + 1 } }
}

/** The mark is spent: the ids go, the count stays. */
export function clearFlash(ui: DesignUi, seq: number): DesignUi {
  return ui.flash && ui.flash.seq === seq && ui.flash.ids.length > 0 ? { ...ui, flash: { ids: [], seq } } : ui
}
