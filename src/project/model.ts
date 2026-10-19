// The project model: its shapes, parsing, serializing and tree helpers.
// Pure TypeScript: no `$`, no engine imports, no fs.

export const NODE_TYPES = [
  // what a workflow script is written in
  'agent',
  'pipeline',
  'parallel',
  'loop',
  'branch',
  'subworkflow',
  'code',
  // frame: where the workflow starts (its goal and its args)
  'start',
] as const

export type NodeType = (typeof NODE_TYPES)[number]

/** The first of each list is the plain kind: a node that says no `kind` is that one. A kind adds no fields. */
export const KINDS = {
  agent: ['task', 'scout', 'check', 'verify', 'judge', 'critic', 'merge', 'classify'],
  loop: ['custom', 'count', 'pass', 'dry', 'converged', 'target', 'budget'],
  parallel: ['arms', 'each', 'sweep', 'attempts'],
  branch: ['if-else', 'guard', 'route'],
} as const

export type KindedType = keyof typeof KINDS

export type Kind = (typeof KINDS)[KindedType][number]

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export type Effort = (typeof EFFORTS)[number]

export type Knobs = {
  goal?: string
  /** On the start block: what the workflow is run on, in words or as a shape. */
  args?: string
  /** In words or as JSON Schema text. */
  output?: string
  model?: string
  effort?: Effort
  isolation?: 'worktree'
  agentType?: string
  /** On a pipeline or a parallel: the items it runs once per. */
  oncePer?: string
  stopCondition?: string
  /** On a block that stands directly in a `branch`: the condition that picks this arm. */
  condition?: string
}

export type ProjectNode = {
  id: string
  type: NodeType
  /** Left out for the plain kind. */
  kind?: Kind
  name: string
  /** A verify or a judge says its votes here (`3 votes`). */
  logic?: string
  knobs?: Knobs
  /** The script's own agent labels or phase titles this block stands for; one ending in `*` is a prefix. The run is put on the block by them. */
  match?: string[]
  children?: ProjectNode[]
}

export type Project = {
  version: 1
  name: string
  // A high-water mark, so an id is never handed out twice after the highest node is removed.
  nextId?: number
  nodes: ProjectNode[]
}

export type ParseResult = { ok: true; project: Project } | { ok: false; error: string }

export type Row = { node: ProjectNode; depth: number; parentId: string | undefined; index: number }

export type WalkInfo = { parent: ProjectNode | undefined; depth: number; index: number }

export const CONTAINER_TYPES: readonly NodeType[] = ['pipeline', 'parallel', 'loop', 'branch']

export function kindsOf(type: NodeType): readonly Kind[] {
  return (KINDS as Partial<Record<NodeType, readonly Kind[]>>)[type] ?? []
}

export function plainKind(type: NodeType): Kind | undefined {
  return kindsOf(type)[0]
}

export function kindOf(node: Pick<ProjectNode, 'type' | 'kind'>): Kind | undefined {
  return node.kind ?? plainKind(node.type)
}

/** `agent verify`, `loop dry`; the bare type for a plain block. */
export function typeName(node: Pick<ProjectNode, 'type' | 'kind'>): string {
  return node.kind === undefined || node.kind === plainKind(node.type) ? node.type : `${node.type} ${node.kind}`
}

export function readType(type: unknown, kind?: unknown): { type: NodeType; kind?: Kind } | { error: string } {
  if (!isNodeType(type)) return { error: `unknown type ${JSON.stringify(type)}` }
  if (kind === undefined || kind === null || kind === '') return { type }
  const kinds = kindsOf(type)
  const found = kinds.find(one => one === kind)
  if (found === undefined) {
    return { error: kinds.length === 0 ? `${aType(type)} block has no kinds` : `${JSON.stringify(kind)} is not a kind of ${type}: ${kinds.join(', ')}` }
  }
  return found === kinds[0] ? { type } : { type, kind: found }
}

export const START_PLACE = 'the start block is the first block of the project: at the top level, before every other block'

/** Every project that is parsed or made here has one (`withStart`). */
export function startOf(project: Pick<Project, 'nodes'>): ProjectNode | undefined {
  return project.nodes[0]?.type === 'start' ? project.nodes[0] : undefined
}

export function goalOf(project: Pick<Project, 'nodes'>): string {
  return (startOf(project)?.knobs?.goal ?? '').replace(/\s+/g, ' ').trim()
}

export function withGoal(project: Project, goal: string): Project {
  const start = startOf(project)
  if (!start) return project
  const { goal: _old, ...rest } = start.knobs ?? {}
  const said = goal.replace(/\s+/g, ' ').trim()
  const knobs: Knobs = said === '' ? rest : { goal: said, ...rest }
  const { knobs: _knobs, ...bare } = start
  return { ...project, nodes: [Object.keys(knobs).length > 0 ? { ...bare, knobs } : bare, ...project.nodes.slice(1)] }
}

export function isBlank(project: Pick<Project, 'nodes'>): boolean {
  return project.nodes.every(node => node.type === 'start')
}

/** One more than the highest number ever present: `nextId` remembers the numbers of removed nodes. */
export function nextIdNumber(project: Pick<Project, 'nodes' | 'nextId'>): number {
  let highest = 0
  const visit = (nodes: readonly ProjectNode[]): void => {
    for (const node of nodes) {
      highest = Math.max(highest, idNumber(node.id))
      if (node.children) visit(node.children)
    }
  }
  visit(project.nodes)
  return Math.max(project.nextId ?? 1, highest + 1)
}

export function withStart(project: Project): Project {
  if (startOf(project)) return project
  const number = nextIdNumber(project)
  return { ...project, nextId: number + 1, nodes: [{ id: `n${number}`, type: 'start', name: 'start' }, ...project.nodes] }
}

const KNOB_KEYS = ['goal', 'args', 'output', 'model', 'effort', 'isolation', 'agentType', 'oncePer', 'stopCondition', 'condition'] as const
const TEXT_KNOBS: readonly string[] = ['goal', 'args', 'output', 'model', 'agentType', 'oncePer', 'stopCondition', 'condition']
const PROJECT_KEYS: readonly string[] = ['version', 'name', 'nextId', 'nodes']
const NODE_KEYS: readonly string[] = ['id', 'type', 'kind', 'name', 'logic', 'knobs', 'match', 'children']
const ID_PATTERN = /^n(\d+)$/
const NAME_PATTERN = /^[a-z0-9-]+$/

/** A project's name is spelled into its file's name, `meta.name` and the hand-off's sentence. */
export function isProjectName(name: unknown): name is string {
  return typeof name === 'string' && NAME_PATTERN.test(name)
}

export function isNodeType(value: unknown): value is NodeType {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).includes(value)
}

export function canHoldChildren(type: NodeType): boolean {
  return CONTAINER_TYPES.includes(type)
}

export function aType(type: NodeType): string {
  return `${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}`
}

export function idNumber(id: string): number {
  const match = ID_PATTERN.exec(id)
  return match ? Number(match[1]) : 0
}

export function toKebab(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function emptyProject(name: string): Project {
  return withStart({ version: 1, name: toKebab(name) || 'untitled', nodes: [] })
}

export const START_KNOBS: readonly (keyof Knobs)[] = ['goal', 'args']

/** Why a block may not say these knobs, or undefined: the goal and the args are the start block's alone. */
export function startOnly(node: Pick<ProjectNode, 'type' | 'knobs'>): string | undefined {
  const stray = node.type === 'start' ? undefined : START_KNOBS.find(key => node.knobs?.[key] !== undefined)
  return stray === undefined ? undefined : `knob ${stray} is the start block's: ${aType(node.type)} block has none`
}

export function knobError(key: string, value: unknown): string | undefined {
  if (TEXT_KNOBS.includes(key)) return typeof value === 'string' ? undefined : `knob ${key} must be a string`
  if (key === 'effort') {
    return (EFFORTS as readonly unknown[]).includes(value) ? undefined : `knob effort must be one of ${EFFORTS.join(', ')}`
  }
  if (key === 'isolation') return value === 'worktree' ? undefined : 'knob isolation must be "worktree"'
  return `unknown knob ${key}`
}

class Invalid extends Error {}

function fail(message: string): never {
  throw new Invalid(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function matchError(value: unknown): string | undefined {
  return Array.isArray(value) && value.every(one => typeof one === 'string' && one !== '') ? undefined : 'match must be a list of non-empty strings'
}

function readKnobs(raw: unknown, where: string): Knobs | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) fail(`${where}: knobs must be an object`)
  const knobs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue
    const error = knobError(key, value)
    if (error) fail(`${where}: ${error}`)
    knobs[key] = value
  }
  return Object.keys(knobs).length > 0 ? (knobs as Knobs) : undefined
}

// An unknown key is refused: read and dropped, it would be erased by the next save.
function strayKey(raw: Record<string, unknown>, keys: readonly string[]): string | undefined {
  return Object.keys(raw).find(key => !keys.includes(key))
}

function readNodes(raw: unknown, where: string, seen: Set<string>): ProjectNode[] {
  if (!Array.isArray(raw)) fail(`${where} must be an array`)
  return raw.map((one: unknown, index) => readNode(one, `${where}[${index}]`, seen))
}

// A `prompt` knob in a saved project opens as part of the logic, the one field that says what a block does; the next save drops it.
function foldPrompt(raw: Record<string, unknown>, id: string): Record<string, unknown> {
  if (!isRecord(raw.knobs) || !('prompt' in raw.knobs)) return raw
  const { prompt, ...knobs } = raw.knobs
  if (prompt !== undefined && typeof prompt !== 'string') fail(`${id}: knob prompt must be a string`)
  const said = (prompt ?? '').trim()
  if (said === '' || (raw.logic !== undefined && typeof raw.logic !== 'string')) return { ...raw, knobs }
  const logic = (raw.logic ?? '').trim()
  return { ...raw, knobs, logic: logic === '' ? said : `${logic}${/[.!?:;]$/.test(logic) ? '' : '.'} ${said}` }
}

function readNode(given: unknown, where: string, seen: Set<string>): ProjectNode {
  if (!isRecord(given)) fail(`${where} must be an object`)
  const raw = foldPrompt(given, typeof given.id === 'string' ? given.id : where)
  const { id, name, logic, match, children } = raw
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) fail(`${where}: id must look like "n1"`)
  // Past that, two numbers read as one: the next id handed out would be one a block has.
  if (!Number.isSafeInteger(idNumber(id))) fail(`${where}: the number in id ${id} is too large`)
  if (seen.has(id)) fail(`duplicate id ${id}`)
  seen.add(id)
  const stray = strayKey(raw, NODE_KEYS)
  if (stray !== undefined) fail(`${id}: unknown key ${stray}`)
  const read = readType(raw.type, raw.kind)
  if ('error' in read) fail(`${id}: ${read.error}`)
  const { type, kind } = read
  if (typeof name !== 'string') fail(`${id}: name must be a string`)
  if (logic !== undefined && typeof logic !== 'string') fail(`${id}: logic must be a string`)

  const node: ProjectNode = { id, type, name }
  if (kind !== undefined) node.kind = kind
  if (logic !== undefined) node.logic = logic
  const knobs = readKnobs(raw.knobs, id)
  if (knobs) node.knobs = knobs
  if (match !== undefined) {
    if (matchError(match)) fail(`${id}: ${matchError(match)}`)
    // An empty list says nothing: the file is written without it.
    if ((match as string[]).length > 0) node.match = [...(match as string[])]
  }
  if (children !== undefined) {
    const list = readNodes(children, `${id}.children`, seen)
    if (list.length > 0 && !canHoldChildren(type)) fail(`${id}: ${aType(type)} node cannot hold children`)
    if (canHoldChildren(type)) node.children = list
  }
  return node
}

/** Never throws. A project read with no start block is given an empty one. */
export function parseProject(json: string): ParseResult {
  try {
    const raw: unknown = JSON.parse(json)
    if (!isRecord(raw)) fail('project must be an object')
    if (raw.version !== 1) fail(`unsupported version ${JSON.stringify(raw.version)}; expected 1`)
    const stray = strayKey(raw, PROJECT_KEYS)
    if (stray !== undefined) fail(`project: unknown key ${stray}`)
    const { name, nextId } = raw
    if (!isProjectName(name)) fail('name must be lowercase letters, digits and dashes (a-z, 0-9, -)')
    if (nextId !== undefined && !(typeof nextId === 'number' && Number.isSafeInteger(nextId) && nextId >= 1)) {
      fail('nextId must be a whole number of at least 1')
    }
    const nodes = readNodes(raw.nodes, 'nodes', new Set())
    const project: Project = { version: 1, name, nodes }
    if (typeof nextId === 'number') project.nextId = nextId
    walk(project, (node, info) => {
      if (node.type === 'start' && (info.parent !== undefined || info.index !== 0)) fail(`${node.id}: ${START_PLACE}`)
      const misplaced = startOnly(node)
      if (misplaced) fail(`${node.id}: ${misplaced}`)
    })
    return { ok: true, project: withStart(project) }
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message }
    return { ok: false, error: error instanceof SyntaxError ? `not valid JSON: ${error.message}` : 'project could not be read' }
  }
}

// Keys come out in one fixed order, whatever order the project was assembled in.
function orderedNode(node: ProjectNode): Record<string, unknown> {
  const out: Record<string, unknown> = { id: node.id, type: node.type }
  if (node.kind !== undefined && node.kind !== plainKind(node.type)) out.kind = node.kind
  out.name = node.name
  if (node.logic !== undefined) out.logic = node.logic
  if (node.knobs) {
    const knobs: Record<string, unknown> = {}
    for (const key of KNOB_KEYS) if (node.knobs[key] !== undefined) knobs[key] = node.knobs[key]
    if (Object.keys(knobs).length > 0) out.knobs = knobs
  }
  if (node.match && node.match.length > 0) out.match = node.match
  if (node.children) out.children = node.children.map(orderedNode)
  return out
}

export function serializeProject(project: Project): string {
  const out: Record<string, unknown> = { version: project.version, name: project.name }
  if (project.nextId !== undefined) out.nextId = project.nextId
  out.nodes = project.nodes.map(orderedNode)
  return `${JSON.stringify(out, null, 2)}\n`
}

export function walk(project: Project, fn: (node: ProjectNode, info: WalkInfo) => void): void {
  const visit = (nodes: readonly ProjectNode[], parent: ProjectNode | undefined, depth: number): void => {
    nodes.forEach((node, index) => {
      fn(node, { parent, depth, index })
      if (node.children) visit(node.children, node, depth + 1)
    })
  }
  visit(project.nodes, undefined, 0)
}

export function findNode(project: Project, id: string): ProjectNode | undefined {
  let found: ProjectNode | undefined
  walk(project, node => {
    if (node.id === id) found ??= node
  })
  return found
}

export function blockCount(project: Project): number {
  return flatten(project).filter(row => row.node.type !== 'start').length
}

export function flatten(project: Project): Row[] {
  const rows: Row[] = []
  walk(project, (node, info) => {
    rows.push({ node, depth: info.depth, parentId: info.parent?.id, index: info.index })
  })
  return rows
}
