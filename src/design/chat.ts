// The design as Claude edits it from chat: the tool's description and schema
// (generated from the teaching content and the model, never a second copy),
// the two ways an edit arrives (a list of ops, or a whole tree), and the words
// the tool answers with. Every edit goes through ops.ts and is checked by
// parseDesign before it counts. Pure TypeScript: no `$`, no engine imports.

import { outline } from './handoff'
import { lint } from './lints'
import { CONTAINER_TYPES, EFFORTS, KINDS, NODE_TYPES, argsOf, typeName, canHoldChildren, findNode, flatten, kindsOf, parseDesign, readType, serializeDesign } from './model'
import type { Design, Kind } from './model'
import { addNode, moveNode, nextIdNumber, removeNode, retypeNode, updateNode } from './ops'
import type { NodePatch, Place } from './ops'
import { FLASH_MS } from '../ui/graph-model'
import { UNDO_HINT } from './history'
import { DESIGN_DIR, carryUi, initialUi } from './session'
import type { DesignUi } from './session'
import { FIELD_LABEL, KIND_TEACH, KNOB_HELP, TEACH, defaultTitle, fillOf } from './teach'

/** The tool's short name; the model calls it as `mcp__conductor__design`. */
export const TOOL_NAME = 'design'
export const TOOL_FULL_NAME = 'mcp__conductor__design'
export const DESIGN_DIR_HINT = `${DESIGN_DIR}/<name>.json`

export const ACTIONS = ['read', 'apply', 'write', 'guide'] as const
export const OP_KINDS = ['add', 'update', 'move', 'remove'] as const

const KNOB_NAMES = Object.keys(KNOB_HELP)

/** One line per block type: its id, what it does and when to use it (the detail pane's two lines, word for word). */
function typeLines(): string[] {
  return NODE_TYPES.map(type => `- ${type}${canHoldChildren(type) ? ' (container)' : ''}: ${TEACH[type].hint}. Use when ${TEACH[type].when}.`)
}

/** The kinds of a type but its plain one: the ones a block names. */
function namedKinds(type: keyof typeof KINDS): readonly Kind[] {
  return kindsOf(type).slice(1)
}

/** Every type that has kinds with the ones a block may name: `agent: scout, check, …. loop: …`. */
function kindNames(): string {
  return (Object.keys(KINDS) as (keyof typeof KINDS)[]).map(type => `${type}: ${namedKinds(type).join(', ')}`).join('. ')
}

/** Every kind in a phrase, by type: what `kind` says in the schema. */
function kindLine(): string {
  return (Object.keys(KINDS) as (keyof typeof KINDS)[]).map(type => `${type}: ${namedKinds(type).map(kind => `${kind} = ${KIND_TEACH[kind].hint}`).join('; ')}`).join('. ')
}

/** The board's words for the fields, beside the keys they are in the file: lints and messages use the words. */
function fieldWords(): string {
  return (['title', 'notes', 'schema', 'fanout', 'until', 'when'] as const).map(key => `${FIELD_LABEL[key]} = ${key}`).join(', ')
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
    "Block: { id, type, kind?, title, notes?, knobs?, children? }. Ids (n1, n2…) are assigned for you and never change. title is a short label; notes is free text saying what the block should do. Order is execution order. Only containers hold children. Blocks directly inside a branch are its arms (one runs, picked by its `when`), and directly inside a parallel they run side by side: to run two blocks one after the other there, put both in a pipeline. Every design starts with its args block (the workflow's input): it is not added, moved or removed; update it by id to say what the input is, or leave it empty for none. A phase only frames its blocks: they run in order where it stands. The design's `description` is the goal of the whole workflow: set it when drafting, keep it true.",
    'Types:',
    ...typeLines(),
    `Kinds: \`kind\` names the pattern a block is used for (each explained on \`kind\` in the schema); leave it out for the plain block. ${kindNames()}. A new block of a kind gets the knobs its pattern needs where you set none. The board calls the fields ${fieldWords()}: the lints use those words.`,
    // What each knob means is said on `knobs` in the schema: a description is cut at 4096 characters, and the types take them.
    `Knobs, all optional, explained on \`knobs\` in the schema: ${KNOB_NAMES.join(', ')}.`,
  ].join('\n')
}

const BLOCK_FIELDS = {
  type: { enum: [...NODE_TYPES] },
  kind: { type: 'string', description: `Optional: the pattern, by type. ${kindLine()}. In an update, "" makes the block plain again.` },
  title: { type: 'string' },
  notes: { type: 'string' },
  knobs: { type: 'object', description: `All optional: ${knobLine()}. In an update, "" clears a knob.` },
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
        'apply. add: a new block (type, kind?, title, notes?, knobs?, children?) placed by `after` or `before` (a sibling id) or `parent` (a container id: appended); none of them = end of the top level. update: `id` plus the fields to change (type and kind too). move: `id` plus after | before | parent. remove: `id`, with everything it holds.',
      items: {
        type: 'object',
        required: ['op'],
        properties: { op: { enum: [...OP_KINDS] }, id: { type: 'string' }, after: { type: 'string' }, before: { type: 'string' }, parent: { type: 'string' }, ...BLOCK_FIELDS },
      },
    },
    nodes: {
      type: 'array',
      description: 'write. The whole tree, top level first.',
      // The knobs are explained once, on the ops.
      items: { type: 'object', required: ['type', 'title'], properties: { id: { type: 'string', description: 'Only for a block that already exists.' }, ...BLOCK_FIELDS, kind: { type: 'string', description: 'The same kinds as in `ops`.' }, knobs: { type: 'object', description: 'The same knobs as in `ops`.' } } },
    },
  },
}

/** Every type's long card: what `guide` answers, and what a draft is briefed with. */
export function guideText(): string {
  const lines: string[] = [`Containers (the only blocks that hold children): ${CONTAINER_TYPES.join(', ')}.`, `Knobs: ${knobLine()}.`, `Effort values: ${EFFORTS.join(', ')}.`, '']
  for (const type of NODE_TYPES) {
    lines.push(`${type}${TEACH[type].name === type ? '' : ` — ${TEACH[type].name}`}: ${TEACH[type].hint}. Use when ${TEACH[type].when}.`)
    for (const line of TEACH[type].card) lines.push(`  ${line}`)
    // Its kinds but the plain one, each with what it fills in and what it is in the script.
    for (const kind of kindsOf(type).slice(1)) {
      const teach = KIND_TEACH[kind]
      const fill = Object.entries(teach.fill ?? {}).map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      lines.push(`  kind ${kind}: ${teach.hint}. Use when ${teach.when}.`)
      for (const line of teach.card) lines.push(`    ${line}`)
      lines.push(`    In the script: ${teach.script}.${fill.length > 0 ? ` Filled in on a new block: ${fill.join(', ')}.` : ''}`)
    }
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
      'Pick the structure the task needs and no more: a few blocks with clear notes beat many. Give a block its kind where one fits, and use knobs where they say something (fanout, votes, until, schema).',
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
    const { id, type, kind, title, notes, knobs } = row.node
    out.set(id, JSON.stringify([row.parentId ?? null, type, kind ?? '', title, notes ?? '', Object.entries(knobs ?? {}).sort(([a], [b]) => a.localeCompare(b))]))
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

/** A `when` on a block that is no arm of a branch picks nothing: said of every such block among `ids`, so the edit can be put right. */
export function strayWhens(design: Design, ids: readonly string[]): string[] {
  return flatten(design)
    .filter(row => ids.includes(row.node.id) && (row.node.knobs?.when ?? '').trim() !== '' && (row.parentId === undefined ? undefined : findNode(design, row.parentId)?.type) !== 'branch')
    .map(row => `${row.node.id} has a \`when\` but does not stand directly in a branch, so nothing reads it: move the block into the branch as an arm, or clear the knob (when: "").`)
}

// The last gate: whatever was assembled is read back by the model's own parser.
function checked(before: Design, candidate: Design, touched: Iterable<string> = [], notes: string[] = []): Edit {
  const parsed = parseDesign(serializeDesign(candidate))
  if (!parsed.ok) return { ok: false, error: explain(parsed.error) }
  const change = diffDesigns(before, parsed.design)
  for (const id of touched) {
    if (!change.added.includes(id) && !change.changed.includes(id) && findNode(parsed.design, id)) change.changed.push(id)
  }
  const said = [...notes, ...strayWhens(parsed.design, [...change.added, ...change.changed])]
  return { ok: true, design: parsed.design, ...change, ...(said.length > 0 ? { notes: said } : {}) }
}

/**
 * What an `add` beside a sibling did when that sibling stands directly in a branch or a parallel:
 * the new block is not a step after it but another arm, or another block run at the same time. Null elsewhere.
 */
export function armNote(design: Design, id: string, beside: string): string | null {
  const row = flatten(design).find(one => one.node.id === id)
  const parent = row?.parentId === undefined ? undefined : findNode(design, row.parentId)
  if (!parent) return null
  if (parent.type === 'branch') return `${id} was added as a new arm of branch ${parent.id} (a branch runs one of its arms; every arm but the last needs a \`when\`), not as a step after ${beside}. To run it after ${beside} in the same arm, wrap the two in a pipeline: add a pipeline in ${parent.id}, then move ${beside} and ${id} into it.`
  if (parent.type === 'parallel') return `${id} was added beside ${beside} in ${parent.type} ${parent.id}: the two run at the same time, not one after the other. To run it after ${beside}, wrap the two in a pipeline inside ${parent.id}.`
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
    let stays = false
    if (typeof raw.id === 'string' && known.has(raw.id)) {
      if (kept.has(raw.id)) problem ??= `duplicate id ${raw.id}: a block that stays appears once; leave id off new blocks`
      kept.add(raw.id)
      id = raw.id
      stays = true
    } else id = `n${next++}`
    const read = readType(raw.type, raw.kind)
    if ('error' in read) problem ??= `${id}: ${read.error}`
    const block = 'error' in read ? undefined : read
    problem ??= knobsError(raw.knobs, id)
    const node: Record<string, unknown> = { id, type: block?.type ?? raw.type, title: typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title : block ? defaultTitle(block) : '' }
    if (block?.kind !== undefined) node.kind = block.kind
    if (typeof raw.notes === 'string' && raw.notes.trim() !== '') node.notes = raw.notes
    else if (raw.notes !== undefined && raw.notes !== null && typeof raw.notes !== 'string') problem ??= `${id}: notes must be a string`
    // A new block of a kind gets what the kind fills in, under the knobs it came with; a block that stays is taken as written.
    const given = isRecord(raw.knobs) ? Object.fromEntries(Object.entries(raw.knobs).filter(([, value]) => value !== '' && value !== null)) : {}
    const knobs = stays || !block ? given : { ...fillOf(block), ...given }
    if (isRecord(raw.knobs) || Object.keys(knobs).length > 0) node.knobs = knobs
    const children = raw.children
    if (children !== undefined && children !== null && !Array.isArray(children)) problem ??= `${id}: children must be an array`
    const list = Array.isArray(children) ? children : []
    if (list.length > 0 || (block !== undefined && canHoldChildren(block.type))) node.children = list.map((child, index) => build(child, `${id}.children[${index}]`))
    return node
  }

  const nodes = rawNodes.map((raw, index) => build(raw, `nodes[${index}]`))
  if (problem !== undefined) return { ok: false, error: explain(problem) }
  // A tree written without the args block keeps the one the design has, as it is.
  const args = argsOf(before)
  if (args && !nodes.some(node => node.type === 'args')) nodes.unshift({ ...args })
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
  const block = readType(raw.type, raw.kind)
  if ('error' in block) return { error: block.error }
  // The blocks a kind starts with are left out: an edit from chat brings its own.
  const added = addNode(design, { ...block, title: typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title : undefined, bare: true }, at)
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
      const removed = removeNode(design, id)
      if (removed.error) return refuse(removed.error)
      design = removed.design
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
    if (op.type !== undefined || op.kind !== undefined) {
      const now = findNode(design, id)
      const asked = readType(op.type ?? now?.type, op.kind)
      if ('error' in asked) return refuse(asked.error)
      // A type said again with no kind leaves the kind the block has; `kind: ""` makes it plain.
      const kept = op.kind === undefined && asked.kind === undefined && asked.type === now?.type ? now.kind : asked.kind
      const retyped = retypeNode(design, id, asked.type, kept)
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
  const where = state.open ? `open on the board; selected block ("this block"): ${selected ? `${selected.id} (${typeName(selected)} "${selected.title}")` : 'none'}` : 'not open on the board'
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

/** A change in a few words, for the message row and the undo history: `added n12; changed n3, n4`. '' for none. */
export function changeWords(change: Change): string {
  const list = (ids: string[]): string => (ids.length > 4 ? `${ids.slice(0, 4).join(', ')} and ${ids.length - 4} more` : ids.join(', '))
  return [change.added.length > 0 ? `added ${list(change.added)}` : '', change.changed.length > 0 ? `changed ${list(change.changed)}` : '', change.removed.length > 0 ? `removed ${list(change.removed)}` : ''].filter(Boolean).join('; ')
}

/** What the model is told, unseen, with a prompt sent after the board changed by hand since it last read the design. */
export function staleNote(name: string, revision: number): string {
  return `Conductor: the user changed the "${name}" workflow design on the board by hand since you last read or edited it (it is now revision ${revision}). What you know of it is out of date: call ${TOOL_FULL_NAME} with action "read" before you describe, review or edit it.`
}

/** When the hooks module takes the mark's ids back: once the graph has shown it. */
export const FLASH_CLEAR_MS = FLASH_MS + 400

/**
 * The pane's state once an edit from chat (or a reload of the file) has landed:
 * the design is the one shown, the touched blocks are marked for a moment, and
 * the selection goes to the first new block so the graph scrolls to it. `seq`
 * only ever grows, so the graph can tell one edit from the next.
 */
export function showEdit(ui: DesignUi, name: string, design: Design, change: Change): DesignUi {
  const same = ui.name === name && ui.status === 'ready'
  // The draft has landed (or the file changed): the graph no longer says Claude is drafting.
  // An edit never lands under the results of a run that is over: they are put away.
  const base: DesignUi = same ? { ...ui, picker: null, confirmId: null, editing: false, describing: false, freshId: null, drafting: false, notice: null, runCleared: true, unsaved: false } : { ...carryUi(ui, initialUi()), name, status: 'ready' }
  const still = same && ui.selectedId !== null && findNode(design, ui.selectedId) ? ui.selectedId : null
  const selectedId = change.added[0] ?? still ?? change.changed[0] ?? design.nodes[0]?.id ?? null
  // Said on the message row, with the way back: an edit from chat is undone like any other.
  const said = changeWords(change)
  return { ...base, selectedId, notice: said !== '' ? `Claude ${said} · ${UNDO_HINT}` : base.notice, flash: { ids: [...change.added, ...change.changed], seq: (ui.flash?.seq ?? 0) + 1 } }
}

/** The mark is spent: the ids go, the count stays. */
export function clearFlash(ui: DesignUi, seq: number): DesignUi {
  return ui.flash && ui.flash.seq === seq && ui.flash.ids.length > 0 ? { ...ui, flash: { ids: [], seq } } : ui
}
