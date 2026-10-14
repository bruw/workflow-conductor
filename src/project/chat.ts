// The project as Claude edits it from chat: the tool's description and schema, generated from the teaching content
// and the model; the edits; the tool's answers. Every edit goes through ops.ts and is checked by parseProject.

import { OUTLINE_MAX, outline } from './handoff'
import { OFFER_TOOL_FULL_NAME } from './offer'
import { lint } from './lints'
import { CONTAINER_TYPES, KINDS, NODE_TYPES, startOf, typeName, canHoldChildren, findNode, flatten, kindsOf, parseProject, readType, serializeProject } from './model'
import type { Project, ProjectNode, Kind, Row } from './model'
import { addNode, moveNode, nextIdNumber, removeNode, retypeNode, updateNode } from './ops'
import type { NodePatch, Place } from './ops'
import { FLASH_MS } from '../ui/graph-model'
import { UNDO_HINT } from './history'
import { PROJECT_DIR, carryUi, initialUi } from './session'
import type { ProjectUi } from './session'
import { KIND_TEACH, KNOB_HELP, TEACH, defaultName, fillOf, logicOf } from './teach'

export const TOOL_NAME = 'project'
export const TOOL_FULL_NAME = 'mcp__workflow-conductor__project'
export const PROJECT_DIR_HINT = `${PROJECT_DIR}/<name>.json`

export const ACTIONS = ['read', 'apply', 'write', 'attach'] as const
export const OP_KINDS = ['add', 'update', 'move', 'remove'] as const

const KNOB_NAMES = Object.keys(KNOB_HELP)

function typeLines(): string[] {
  return NODE_TYPES.map(type => `- ${type}${canHoldChildren(type) ? ' (container)' : ''}: ${TEACH[type].hint}. Use when ${TEACH[type].when}.`)
}

/** All but the plain kind, which a block does not name. */
function namedKinds(type: keyof typeof KINDS): readonly Kind[] {
  return kindsOf(type).slice(1)
}

function kindNames(): string {
  return (Object.keys(KINDS) as (keyof typeof KINDS)[]).map(type => `${type}: ${namedKinds(type).join(', ')}`).join('. ')
}

function kindLine(): string {
  return (Object.keys(KINDS) as (keyof typeof KINDS)[]).map(type => `${type}: ${namedKinds(type).map(kind => `${kind} = ${KIND_TEACH[kind].hint}`).join('; ')}`).join('. ')
}

function knobLine(): string {
  return Object.entries(KNOB_HELP)
    .map(([key, help]) => `${key} (${help})`)
    .join('; ')
}

/** The tool is deferred: only its name is in every turn, and the model reads this once it loads the tool. */
export function toolDescription(): string {
  return [
    `Reads and edits the user's Conductor workflow project: the board of blocks they see, saved at ${PROJECT_DIR_HINT}. Use it whenever the user asks to draft, add, change, move or remove workflow blocks or steps ("add a verify after n3", "this block"); do not edit that file by hand. A project is a spec the user reviews, not a script: never run it from here.`,
    'Actions: read = the project JSON, the block selected on the board ("this block") and the lints. Read before you describe, review or edit a project, unless a Conductor note with the prompt has told you what changed: the user changes the board by hand between your turns, so what you read or wrote earlier may be gone (every answer names the revision it shows). apply = `ops` in order, all or nothing. write = replace the whole tree with `nodes` (drafting, large restructures). attach = a write, with `match`, of a project OF the workflow run tracked now: the run shows on it. An edit shows on the board at once and returns the lints: fix them or tell the user.',
    "Block: { id, type, kind?, name, logic?, knobs?, match?, children? }. Ids (n1, n2…) are assigned for you and never change. name is a short label; logic is free text saying what the block should do. Order is execution order. Only containers hold children. Blocks directly inside a branch are its arms (one runs, picked by its `condition`), and directly inside a parallel they run side by side: to run two blocks one after the other there, put both in a pipeline. Every project starts with its start block: it is not added, moved or removed, and it alone has the knobs `goal` (the goal of the whole workflow, in a sentence: set it when drafting, keep it true) and `args` (the workflow's input, or unset for none). Update it by id; in a write, put it first, or leave it out to keep it as it is.",
    'Types:',
    ...typeLines(),
    `Kinds: \`kind\` names the pattern a block is used for (each explained on \`kind\` in the schema); leave it out for the plain block. ${kindNames()}.`,
    // A description is cut at 4096 characters, and the types take them: what belongs to one field (what each knob and kind means, how a write keeps ids) is said on that field in the schema.
    `Knobs, all optional, explained on \`knobs\` in the schema: ${KNOB_NAMES.join(', ')}.`,
  ].join('\n')
}

const BLOCK_FIELDS = {
  type: { enum: [...NODE_TYPES] },
  kind: { type: 'string', description: `Optional: the pattern, by type. ${kindLine()}. A new block of a kind gets the knobs its pattern needs where you set none. In an update, "" makes the block plain again.` },
  name: { type: 'string' },
  logic: { type: 'string' },
  knobs: { type: 'object', description: `All optional: ${knobLine()}. The board and the lints say a key in words: oncePer is "once per", stopCondition "stop condition". In an update, "" clears a knob.` },
  match: { type: 'array', items: { type: 'string' }, description: "Only on a project of a script that exists: the script's agent labels or phase titles this block stands for, each exact, or a prefix when it ends in *. In an update, [] clears it." },
  children: { type: 'array', items: { type: 'object' }, description: 'Blocks inside a container, same shape.' },
}

export const TOOL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['action'],
  properties: {
    action: { enum: [...ACTIONS] },
    name: { type: 'string', description: 'Project name. Default: the one open on the board (attach: name it).' },
    ops: {
      type: 'array',
      description:
        'apply. add: a new block (type, kind?, name, logic?, knobs?, children?) placed by `after` or `before` (a sibling id) or `parent` (a container id: appended); none of them = end of the top level. update: `id` plus the fields to change (type and kind too). move: `id` plus after | before | parent. remove: `id`, with everything it holds.',
      items: {
        type: 'object',
        required: ['op'],
        properties: { op: { enum: [...OP_KINDS] }, id: { type: 'string' }, after: { type: 'string' }, before: { type: 'string' }, parent: { type: 'string' }, ...BLOCK_FIELDS },
      },
    },
    nodes: {
      type: 'array',
      description: 'write/attach. The whole tree, top level first: keep the id of every block that stays, leave id off new ones.',
      // The knobs are explained once, on the ops.
      items: { type: 'object', required: ['type', 'name'], properties: { id: { type: 'string', description: 'Only for a block that already exists.' }, ...BLOCK_FIELDS, kind: { type: 'string', description: 'The same kinds as in `ops`.' }, knobs: { type: 'object', description: 'The same knobs as in `ops`.' }, match: { type: 'array', items: { type: 'string' }, description: 'As in `ops`.' } } },
    },
  },
}

const DRAFT_RULES = [
  'The project is a spec the user reviews on the board. Do not write a workflow script and do not run anything.',
  'Pick the structure the task needs and no more: a few blocks with clear logic beat many. Give a block its kind where one fits, and use knobs where they say something (oncePer, stopCondition, output).',
]

const DRAFT_AFTER = 'Afterwards stop: the user takes it from there. Say in two or three lines what the blocks do, name any lint you chose to leave, and tell the user to review and edit the project on the board and to approve it there with r (Implement and Run).'

/** For `/conductor <description>`. It names the tool in full: the tool is deferred, and the name is what Claude loads it by. */
export function draftBrief(description: string): string[] {
  return [
    [
      `Conductor draft: the user wants a new workflow project for: ${description}`,
      '',
      'Where what they want is too unclear to pick a structure for, ask them first, briefly, and wait for the answer. Otherwise do not ask.',
      `Make it with the ${TOOL_FULL_NAME} tool (it is deferred: load it by that name): one call with action "write", a short kebab-case name of your choosing that no project has, and the nodes, the start block first with the goal in a sentence in its \`goal\` knob. It is always a new project, unless the user's own words name an existing one to change.`,
      ...DRAFT_RULES,
      DRAFT_AFTER,
    ].join('\n'),
  ]
}

/** `asked` is false when an "Always Conductor" kept earlier answered. */
export function offerBrief(asked: boolean): string {
  return [
    `${asked ? 'The user chose Conductor' : 'The user chose Always Conductor earlier, so they were not asked'}: they want this workflow as a project on the Conductor board, to review and edit before anything is written or run.`,
    '',
    `Make it with the ${TOOL_FULL_NAME} tool (it is deferred: load it by that name): one call with action "write", a short kebab-case name of your choosing and the nodes, the start block first with the goal of the workflow in its \`goal\` knob.`,
    ...DRAFT_RULES,
    DRAFT_AFTER,
    `If they then tell you in chat to run it, call ${OFFER_TOOL_FULL_NAME} again before anything else: its answer says how this project is run.`,
  ].join('\n')
}

/** Added to the Workflow tool's result. Under `name` the next run of the same script finds the project, and is shown on it with no question. */
export function visualizeBrief(scriptPath: string, asked: boolean, name: string | undefined): string {
  return [
    `Conductor: ${asked ? 'the user chose to see' : 'the user chose Always visualize earlier, so they see'} this workflow run as a project on the Conductor board. The run goes on meanwhile: do not change, re-run or stop the script.`,
    '',
    `Draw the project OF the script that is running with the ${TOOL_FULL_NAME} tool (it is deferred: load it by that name): one call with action "attach", ${name === undefined ? 'a short kebab-case name' : `name "${name}" (the workflow's own name as a project's: the next run of this script is then shown on this project without a question)`} and the nodes, the start block first with the workflow's goal in its \`goal\` knob.`,
    "- The nodes mirror the script's real structure: its pipelines, parallels, loops, branches and agents, no more. A phase is no block: its blocks stand at the top level in its place.",
    '- `match` ties the run to the blocks. It goes on the INNERMOST block an agent belongs to, and a label on one block only (never also on the container around it): the exact `label` of each agent() the block stands for, or the fixed start of the label and a * ("review *") where the script builds it at runtime.',
    "- Where the script groups its agents by `phase`, the first top-level block of each phase gets that phase's exact title in `match`.",
    `The script, if you do not hold its text: ${scriptPath}`,
    'The answer lists the agent labels no block took: fix `match` and call attach again under the same name. Afterwards tell the user in one or two lines what the board shows.',
  ].join('\n')
}

/** A label two blocks both list in `match`: the first in project order takes its agents, and the other shows none. */
function sharedMatch(project: Project): string[] {
  const first = new Map<string, string>()
  const notes: string[] = []
  for (const { node } of flatten(project)) {
    for (const one of node.match ?? []) {
      const held = first.get(one)
      if (held === undefined) first.set(one, node.id)
      else if (held !== node.id) notes.push(`Note: ${JSON.stringify(one)} is in the \`match\` of ${held} and ${node.id}: ${held} comes first and takes those agents. Keep it on the innermost block only.`)
    }
  }
  return notes
}

/** The agents of the run no block took, each label once. Later phases may still place some. */
export function attachNote(project: Project, unplaced: readonly string[]): string {
  const labels = [...new Set(unplaced)]
  const placed =
    labels.length === 0
      ? 'The run is shown on it: every agent so far is on a block.'
      : `The run is shown on it. Agent labels not placed yet (an agent whose phase has not been read yet may still land): ${labels.map(label => JSON.stringify(label)).join(', ')}. For any that no \`match\` covers, fix \`match\` and call attach again.`
  return [placed, ...sharedMatch(project)].join('\n')
}

/** Added to an edit's answer when the board could not be put on screen (an open nobody typed waits under 144 columns). */
export function unplacedNote(name: string): string {
  return `The board is not on screen (the terminal is too narrow for it to open by itself; the band above the prompt names the project): tell the user that /conductor opens it (project ${name}).`
}

// Edits

/** `notes` are things the edit did that the caller may not have meant, said in the answer. */
export type Change = { added: string[]; changed: string[]; removed: string[]; notes?: string[] }

export type Edit = ({ ok: true; project: Project } & Change) | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const TYPES_HINT = `types: ${NODE_TYPES.join(', ')}`
const CONTAINERS_HINT = `containers: ${CONTAINER_TYPES.join(', ')}`
const KNOBS_HINT = `knobs: ${KNOB_NAMES.join(', ')}`

// A refusal Claude can act on: the reason, plus the list it should have picked from.
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

function signature(project: Project): Map<string, string> {
  const out = new Map<string, string>()
  for (const row of flatten(project)) {
    const { id, type, kind, name, logic, knobs, match } = row.node
    out.set(id, JSON.stringify([row.parentId ?? null, type, kind ?? '', name, logic ?? '', Object.entries(knobs ?? {}).sort(([a], [b]) => a.localeCompare(b)), match ?? []]))
  }
  return out
}

/** Order among siblings is not compared. */
export function diffProjects(before: Project | null, after: Project): Change {
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

/** A `condition` on a block that is no arm of a branch picks nothing. */
export function strayConditions(project: Project, ids: readonly string[]): string[] {
  return flatten(project)
    .filter(row => ids.includes(row.node.id) && (row.node.knobs?.condition ?? '').trim() !== '' && (row.parentId === undefined ? undefined : findNode(project, row.parentId)?.type) !== 'branch')
    .map(row => `${row.node.id} has a \`condition\` but does not stand directly in a branch, so nothing reads it: move the block into the branch as an arm, or clear the knob (condition: "").`)
}

// The last gate: whatever was assembled is read back by the model's own parser.
function checked(before: Project, candidate: Project, touched: Iterable<string> = [], notes: string[] = []): Edit {
  const parsed = parseProject(serializeProject(candidate))
  if (!parsed.ok) return { ok: false, error: explain(parsed.error) }
  const change = diffProjects(before, parsed.project)
  for (const id of touched) {
    if (!change.added.includes(id) && !change.changed.includes(id) && findNode(parsed.project, id)) change.changed.push(id)
  }
  const said = [...notes, ...strayConditions(parsed.project, [...change.added, ...change.changed])]
  return { ok: true, project: parsed.project, ...change, ...(said.length > 0 ? { notes: said } : {}) }
}

/** An `add` beside a sibling in a branch or a parallel makes another arm, not a step after it. Null elsewhere. */
export function armNote(project: Project, id: string, beside: string): string | null {
  const row = flatten(project).find(one => one.node.id === id)
  const parent = row?.parentId === undefined ? undefined : findNode(project, row.parentId)
  if (!parent) return null
  if (parent.type === 'branch') return `${id} was added as a new arm of branch ${parent.id} (a branch runs one of its arms; every arm but the last needs a \`condition\`), not as a step after ${beside}. To run it after ${beside} in the same arm, wrap the two in a pipeline: add a pipeline in ${parent.id}, then move ${beside} and ${id} into it.`
  if (parent.type === 'parallel') return `${id} was added beside ${beside} in ${parent.type} ${parent.id}: the two run at the same time, not one after the other. To run it after ${beside}, wrap the two in a pipeline inside ${parent.id}.`
  return null
}

/** A tree written in another order: `diffProjects` does not compare order. */
function reordered(before: Project, after: Project): string[] {
  const order = (project: Project): Map<string, string[]> => {
    const out = new Map<string, string[]>()
    for (const row of flatten(project)) out.set(row.parentId ?? '', [...(out.get(row.parentId ?? '') ?? []), row.node.id])
    return out
  }
  const old = order(before)
  const moved: string[] = []
  for (const [parent, ids] of order(after)) {
    const was = (old.get(parent) ?? []).filter(id => ids.includes(id))
    ids.filter(id => was.includes(id)).forEach((id, index) => {
      if (was[index] !== id) moved.push(id)
    })
  }
  return moved
}

/** A block whose id is in the project as it stood keeps it; every other gets a fresh id, whatever it came with, so ids never collide. */
export function replaceProject(before: Project, rawNodes: unknown): Edit {
  if (!Array.isArray(rawNodes)) return { ok: false, error: 'write needs `nodes`: the array of top-level blocks' }
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
    const node: Record<string, unknown> = { id, type: block?.type ?? raw.type, name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : block ? defaultName(block) : '' }
    if (block?.kind !== undefined) node.kind = block.kind
    // A new block of a kind gets what the kind fills in, under the logic and the knobs it came with; a block that stays is taken as written.
    const filled = stays || !block ? undefined : logicOf(block)
    if (typeof raw.logic === 'string' && raw.logic.trim() !== '') node.logic = raw.logic
    else if (raw.logic !== undefined && raw.logic !== null && typeof raw.logic !== 'string') problem ??= `${id}: logic must be a string`
    else if (filled !== undefined) node.logic = filled
    const given = isRecord(raw.knobs) ? Object.fromEntries(Object.entries(raw.knobs).filter(([, value]) => value !== '' && value !== null)) : {}
    const knobs = stays || !block ? given : { ...fillOf(block), ...given }
    if (isRecord(raw.knobs) || Object.keys(knobs).length > 0) node.knobs = knobs
    // Read back by parseProject below, which refuses a list that is not one of strings.
    if (raw.match !== undefined && raw.match !== null) node.match = raw.match
    const children = raw.children
    if (children !== undefined && children !== null && !Array.isArray(children)) problem ??= `${id}: children must be an array`
    const list = Array.isArray(children) ? children : []
    if (list.length > 0 || (block !== undefined && canHoldChildren(block.type))) node.children = list.map((child, index) => build(child, `${id}.children[${index}]`))
    return node
  }

  const nodes = rawNodes.map((raw, index) => build(raw, `nodes[${index}]`))
  if (problem !== undefined) return { ok: false, error: explain(problem) }
  // A tree written without the start block keeps the one the project has, as it is.
  const start = startOf(before)
  if (start && !nodes.some(node => node.type === 'start')) nodes.unshift({ ...start })
  const candidate = { version: 1, name: before.name, nextId: next, nodes } as unknown as Project
  // Not serializeProject: it would trust shapes that have not been checked yet.
  const parsed = parseProject(JSON.stringify(candidate))
  if (!parsed.ok) return { ok: false, error: explain(parsed.error) }
  return checked(before, parsed.project, reordered(before, parsed.project))
}

function placeOf(project: Project, op: Record<string, unknown>): Place | string {
  // A null is a place not said, as one left out is.
  const beside = op.after ?? op.before
  if (beside !== undefined && beside !== null) {
    if (typeof beside !== 'string') return 'after/before must be a block id'
    const row = flatten(project).find(one => one.node.id === beside)
    if (!row) return `no block ${beside}`
    const index = op.after !== undefined && op.after !== null ? row.index + 1 : row.index
    return row.parentId === undefined ? { index } : { parentId: row.parentId, index }
  }
  if (op.parent !== undefined && op.parent !== null) {
    if (typeof op.parent !== 'string') return 'parent must be a block id'
    const parent = findNode(project, op.parent)
    if (!parent) return `no block ${op.parent}`
    return { parentId: parent.id, index: parent.children?.length ?? 0 }
  }
  return { index: project.nodes.length }
}

function patchOf(raw: Record<string, unknown>): NodePatch {
  const patch: Record<string, unknown> = {}
  if (raw.name !== undefined && raw.name !== null) patch.name = raw.name
  if (raw.logic !== undefined && raw.logic !== null) patch.logic = raw.logic
  if (raw.knobs !== undefined && raw.knobs !== null) patch.knobs = raw.knobs
  if (raw.match !== undefined && raw.match !== null) patch.match = raw.match
  return patch as NodePatch
}

type Grown = { project: Project; ids: string[] } | { error: string }

function grow(project: Project, raw: unknown, at: Place): Grown {
  if (!isRecord(raw)) return { error: 'a block must be an object' }
  const block = readType(raw.type, raw.kind)
  if ('error' in block) return { error: block.error }
  // The blocks a kind starts with are left out: an edit from chat brings its own.
  const added = addNode(project, { ...block, name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : undefined, bare: true }, at)
  if (added.error || added.id === undefined) return { error: added.error ?? 'could not add' }
  const id = added.id
  const knobs = knobsError(raw.knobs, id)
  if (knobs) return { error: knobs }
  const patched = updateNode(added.project, id, patchOf({ logic: raw.logic, knobs: raw.knobs, match: raw.match }))
  if (patched.error) return { error: `${id}: ${patched.error}` }
  let current = patched.project
  const ids = [id]
  const children = raw.children
  if (children !== undefined && children !== null && !Array.isArray(children)) return { error: `${id}: children must be an array` }
  for (const [index, child] of (Array.isArray(children) ? children : []).entries()) {
    const inner = grow(current, child, { parentId: id, index })
    if ('error' in inner) return inner
    current = inner.project
    ids.push(...inner.ids)
  }
  return { project: current, ids }
}

/** One refused op refuses them all. */
export function applyOps(before: Project, ops: unknown): Edit {
  if (!Array.isArray(ops)) return { ok: false, error: 'apply needs `ops`: an array of { op: add | update | move | remove, … }' }
  let project: Project = before
  const touched: string[] = []
  const notes: string[] = []

  for (const [index, op] of ops.entries()) {
    const kind = isRecord(op) ? op.op : undefined
    const refuse = (error: string): Edit => ({ ok: false, error: `ops[${index}]${typeof kind === 'string' ? ` (${kind})` : ''}: ${explain(error)}. Nothing was changed.` })
    if (!isRecord(op)) return refuse('an op must be an object')
    if (kind === 'add') {
      const at = placeOf(project, op)
      if (typeof at === 'string') return refuse(at)
      const grown = grow(project, op, at)
      if ('error' in grown) return refuse(grown.error)
      project = grown.project
      const beside = op.after ?? op.before
      const note = typeof beside === 'string' && grown.ids[0] !== undefined ? armNote(project, grown.ids[0], beside) : null
      if (note !== null) notes.push(note)
      continue
    }
    const id = op.id
    if (kind !== 'update' && kind !== 'move' && kind !== 'remove') return refuse(`op must be one of ${OP_KINDS.join(', ')}`)
    if (typeof id !== 'string') return refuse('needs the `id` of a block')
    if (!findNode(project, id)) return refuse(`no block ${id}`)
    if (kind === 'remove') {
      const removed = removeNode(project, id)
      if (removed.error) return refuse(removed.error)
      project = removed.project
      continue
    }
    if (kind === 'move') {
      // The place is read with the block lifted out, as moveNode counts it.
      if ((op.after ?? op.before ?? op.parent ?? null) === null) return refuse('needs after, before or parent')
      const at = placeOf(removeNode(project, id).project, op)
      if (typeof at === 'string') return refuse(at.startsWith('no block') ? `${at} outside ${id}` : at)
      const moved = moveNode(project, id, at)
      if (moved.error) return refuse(moved.error)
      project = moved.project
      touched.push(id)
      continue
    }
    if (op.type !== undefined || op.kind !== undefined) {
      const now = findNode(project, id)
      const asked = readType(op.type ?? now?.type, op.kind)
      if ('error' in asked) return refuse(asked.error)
      // A type said again with no kind leaves the kind the block has; `kind: ""` makes it plain.
      const kept = op.kind === undefined && asked.kind === undefined && asked.type === now?.type ? now.kind : asked.kind
      const retyped = retypeNode(project, id, asked.type, kept)
      if (retyped.error) return refuse(retyped.error)
      project = retyped.project
    }
    const knobs = knobsError(op.knobs, id)
    if (knobs) return refuse(knobs)
    const updated = updateNode(project, id, patchOf(op))
    if (updated.error) return refuse(updated.error)
    project = updated.project
  }
  return checked(before, project, touched, notes)
}

// What the tool answers with

function lintLines(project: Project): string[] {
  const lints = lint(project)
  if (lints.length === 0) return ['Lints: none.']
  return ['Lints (advisory: fix them, or tell the user why they stand):', ...lints.map(one => `- ${one.nodeId} [${one.rule}]: ${one.message}`)]
}

/** `revision` counts every change to the project this session, by hand or from chat: an answer that names an older one is stale. */
export type ReadState = { open: boolean; selectedId: string | null; locked: boolean; revision?: number }

function revisionWords(revision: number | undefined): string {
  return revision === undefined ? '' : ` Revision ${revision}: the user edits the board by hand, so in a later turn read again before relying on this, unless a Conductor note with that prompt says what changed.`
}

export function readReport(project: Project, state: ReadState): string {
  const selected = state.selectedId === null ? undefined : findNode(project, state.selectedId)
  const where = state.open ? `open on the board; selected block ("this block"): ${selected ? `${selected.id} (${typeName(selected)} "${selected.name}")` : 'none'}` : 'not open on the board'
  return [
    `Project "${project.name}" as it is on the board now (${where})${state.locked ? '. A run of it is in progress: editing is locked until it ends' : ''}.${revisionWords(state.revision)}`,
    serializeProject(project).trimEnd(),
    ...lintLines(project),
  ].join('\n')
}

export function editReport(project: Project, change: Change, revision?: number): string {
  const parts = [
    change.added.length > 0 ? `added ${change.added.join(', ')}` : '',
    change.changed.length > 0 ? `changed ${change.changed.join(', ')}` : '',
    change.removed.length > 0 ? `removed ${change.removed.join(', ')}` : '',
  ].filter(Boolean)
  return [
    `Project "${project.name}" saved and shown on the board: ${parts.length > 0 ? parts.join('; ') : 'nothing differs from before'}.${revisionWords(revision)}`,
    ...(change.notes ?? []).map(note => `Note: ${note}`),
    'Now:',
    ...outline(project),
    ...lintLines(project),
  ].join('\n')
}

/**
 * Whether Claude holds `stored` whole after the edit it made with `input`: every text the answer's outline does not say is one
 * Claude sent or one the block had in the project it last saw (`seen`). False for a text from elsewhere, such as what a kind fills in.
 */
export function knownAfterEdit(stored: Project, seen: Project | undefined, input: unknown): boolean {
  const rows = flatten(stored)
  if (rows.length > OUTLINE_MAX) return false
  const sent = new Set<string>()
  const collect = (value: unknown): void => {
    if (typeof value === 'string') sent.add(value)
    else if (Array.isArray(value)) value.forEach(collect)
    else if (isRecord(value)) Object.values(value).forEach(collect)
  }
  collect(input)
  const texts = (node: ProjectNode | undefined): string[] => (node ? [`logic=${node.logic ?? ''}`, ...Object.entries(node.knobs ?? {}).map(([key, value]) => `${key}=${String(value)}`), ...(node.match ?? []).map(one => `match=${one}`)] : [])
  const before = new Map((seen ? flatten(seen) : []).map(row => [row.node.id, new Set(texts(row.node))]))
  const known = (id: string, text: string): boolean => text === 'logic=' || sent.has(text.slice(text.indexOf('=') + 1)) || before.get(id)?.has(text) === true
  return rows.every(({ node }) => texts(node).every(text => known(node.id, text)))
}

export function projectOfPath(root: string, cwd: string, path: string): string | null {
  if (path === '') return null
  const absolute = path.startsWith('/') ? path : `${cwd.replace(/\/+$/, '')}/${path}`
  const parts: string[] = []
  for (const part of absolute.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  const prefix = `${root.replace(/\/+$/, '')}/${PROJECT_DIR}/`
  const clean = `/${parts.join('/')}`
  if (!clean.startsWith(prefix)) return null
  const file = clean.slice(prefix.length)
  return /^[a-z0-9-]+\.json$/.test(file) ? file.slice(0, -'.json'.length) : null
}

/** For the message row and the undo history: `added n12; changed n3, n4`. */
export function changeWords(change: Change): string {
  const list = (ids: string[]): string => (ids.length > 4 ? `${ids.slice(0, 4).join(', ')} and ${ids.length - 4} more` : ids.join(', '))
  return [change.added.length > 0 ? `added ${list(change.added)}` : '', change.changed.length > 0 ? `changed ${list(change.changed)}` : '', change.removed.length > 0 ? `removed ${list(change.removed)}` : ''].filter(Boolean).join('; ')
}

/** Sent, unseen, with a prompt when the board changed by hand and the change itself cannot be said (`changedNote`). */
export function staleNote(name: string, revision: number): string {
  return `Conductor: the user changed the "${name}" workflow project on the board by hand since you last read or edited it (it is now revision ${revision}). This note cannot say what changed, so what you know of it is out of date: call ${TOOL_FULL_NAME} with action "read" before you describe, review or edit it.`
}

function blockOf(node: ProjectNode, deep: boolean): Record<string, unknown> {
  const { id, type, kind, name, logic, knobs, match, children } = node
  const own = { id, type, kind, name, logic, knobs: knobs && Object.keys(knobs).length > 0 ? knobs : undefined, match }
  return deep && children ? { ...own, children: children.map(child => blockOf(child, true)) } : own
}

const TOP = ''

function childIds(rows: readonly Row[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const row of rows) out.set(row.parentId ?? TOP, [...(out.get(row.parentId ?? TOP) ?? []), row.node.id])
  return out
}

const whereWords = (parentId: string): string => (parentId === TOP ? 'at the top level' : `inside ${parentId}`)

/** Everything that differs between the project as Claude last saw it and the board, so that the one and the lines give the other exactly. */
export function boardChanges(seen: Project, now: Project): string[] {
  const old = new Map(flatten(seen).map(row => [row.node.id, row]))
  const rows = flatten(now)
  const kids = childIds(rows)
  // A block is placed by the one before it: with the blocks that stayed keeping their order, that says the whole order.
  const place = (row: Row): string => `${whereWords(row.parentId ?? TOP)}, ${row.index === 0 ? 'first' : `after ${kids.get(row.parentId ?? TOP)?.[row.index - 1]}`}`
  const added: string[] = []
  const changed: string[] = []
  const moved: string[] = []
  // A new block is said whole, so nothing it holds is said again.
  const within = new Set<string>()
  for (const row of rows) {
    const { id } = row.node
    const was = old.get(id)
    if (row.parentId !== undefined && within.has(row.parentId)) within.add(id)
    else if (!was) {
      within.add(id)
      added.push(`- ${place(row)}: ${JSON.stringify(blockOf(row.node, true))}`)
    } else {
      if (JSON.stringify(blockOf(was.node, false)) !== JSON.stringify(blockOf(row.node, false))) changed.push(`- ${JSON.stringify(blockOf(row.node, false))}`)
      if (was.parentId !== row.parentId) moved.push(`- ${id}: ${place(row)}`)
    }
  }
  // Blocks that stayed in their container but not in their order: the container's whole order is said.
  const before = childIds([...old.values()])
  const order: string[] = []
  for (const [parentId, ids] of kids) {
    if (within.has(parentId)) continue
    const stayed = ids.filter(id => (old.get(id)?.parentId ?? TOP) === parentId && old.has(id))
    const asWas = (before.get(parentId) ?? []).filter(id => stayed.includes(id))
    if (stayed.join() !== asWas.join()) order.push(`Order ${whereWords(parentId)} now: ${ids.join(', ')}.`)
  }
  const removed = [...old.keys()].filter(id => !findNode(now, id))
  return [
    ...(added.length > 0 ? ['Added, each whole (a block you knew that is written inside one now stands there):', ...added] : []),
    ...(changed.length > 0 ? ['Changed, each as it is now (what it holds is as before, but for what these lines say):', ...changed] : []),
    ...(moved.length > 0 ? ['Moved, each with everything it holds:', ...moved] : []),
    ...order,
    ...(removed.length > 0 ? [`Removed: ${removed.join(', ')}.`] : []),
  ]
}

/** In place of `staleNote` when the project as Claude last saw it is at hand. Null when saying the change takes more than the project does: a read is cheaper. */
export function changedNote(name: string, revision: number, seen: Project, now: Project, selectedId: string | null): string | null {
  const lines = boardChanges(seen, now)
  if (lines.join('\n').length > serializeProject(now).length) return null
  const selected = selectedId === null ? undefined : findNode(now, selectedId)
  return [
    `Conductor: the user changed the "${name}" workflow project on the board by hand since you last read or edited it (it is now revision ${revision}). ${lines.length > 0 ? 'What follows is everything that changed' : 'Nothing in it differs from what you last saw'}: with it you know the board as it is, so this is the note that stands in for a read: none is needed. An edit with ${TOOL_FULL_NAME} from here is accepted.`,
    ...lines,
    `Selected block ("this block"): ${selected ? `${selected.id} (${typeName(selected)} "${selected.name}")` : 'none'}.`,
  ].join('\n')
}

/** When the hooks module takes the mark's ids back: once the graph has shown it. */
export const FLASH_CLEAR_MS = FLASH_MS + 400

/** The selection goes to the first new block so the graph scrolls to it. `seq` only ever grows, so the graph can tell one edit from the next. */
export function showEdit(ui: ProjectUi, name: string, project: Project, change: Change): ProjectUi {
  const same = ui.name === name && ui.status === 'ready'
  // A draft being laid out stays so under a later edit of Claude's turn (a lint fixed): the turn's end is what ends it.
  // An edit never lands under the results of a run that is over: they are put away.
  const base: ProjectUi = same ? { ...ui, picker: null, confirmId: null, editing: false, freshId: null, drafting: ui.drafting === 'show' ? 'show' : null, notice: null, runCleared: true, unsaved: false } : { ...carryUi(ui, initialUi()), name, status: 'ready' }
  const still = same && ui.selectedId !== null && findNode(project, ui.selectedId) ? ui.selectedId : null
  const selectedId = change.added[0] ?? still ?? change.changed[0] ?? project.nodes[0]?.id ?? null
  // An edit from chat is undone like any other.
  const said = changeWords(change)
  return { ...base, selectedId, notice: said !== '' ? `Claude ${said} · ${UNDO_HINT}` : base.notice, flash: { ids: [...change.added, ...change.changed], seq: (ui.flash?.seq ?? 0) + 1 } }
}

/** The mark is spent: the ids go, the count stays. */
export function clearFlash(ui: ProjectUi, seq: number): ProjectUi {
  return ui.flash && ui.flash.seq === seq && ui.flash.ids.length > 0 ? { ...ui, flash: { ids: [], seq } } : ui
}
