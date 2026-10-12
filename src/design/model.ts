// The design model: the shapes from docs/SPEC.md plus parsing, serializing and
// tree helpers. Pure TypeScript: no `$`, no engine imports, no fs.

export const NODE_TYPES = [
  // what a workflow script is written in
  'agent',
  'pipeline',
  'parallel',
  'loop',
  'branch',
  'subworkflow',
  'code',
  // frame: the workflow's input, and a group that only frames blocks
  'args',
  'phase',
] as const

export type NodeType = (typeof NODE_TYPES)[number]

/**
 * The kinds of a block: the pattern it is used for. Each list answers one question about its
 * block (an agent's job, when a loop stops, what differs between a parallel's arms, how a
 * branch picks its arm). The first of a list is the plain block, and a node that says no
 * `kind` is that one. A kind never changes a block's fields: it fills some in and says what
 * the empty ones are for (`KIND_TEACH` in teach.ts).
 */
export const KINDS = {
  agent: ['task', 'scout', 'check', 'verify', 'judge', 'critic', 'synthesize', 'classify'],
  loop: ['custom', 'count', 'pass', 'dry', 'converged', 'target', 'budget'],
  parallel: ['arms', 'each', 'sweep', 'attempts'],
  branch: ['if-else', 'guard', 'route'],
} as const

export type KindedType = keyof typeof KINDS

export type Kind = (typeof KINDS)[KindedType][number]

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export type Effort = (typeof EFFORTS)[number]

/** A block's knobs. The text ones are named as the pane's fields are: `oncePer` is "once per", `stopCondition` "stop condition". */
export type Knobs = {
  prompt?: string
  /** What the block hands on, in words or as JSON Schema text. */
  output?: string
  model?: string
  effort?: Effort
  isolation?: 'worktree'
  agentType?: string
  /** On a pipeline or a parallel: the items it runs once per. */
  oncePer?: string
  votes?: number
  /** On a loop: when it stops. */
  stopCondition?: string
  /** On a block that stands directly in a `branch`: the condition that picks this arm. */
  condition?: string
}

export type DesignNode = {
  id: string
  type: NodeType
  /** The pattern the block is used for; left out for the plain block (the first of its type's kinds). */
  kind?: Kind
  /** The block's name on the graph. */
  name: string
  /** Free text: what the block does and why. */
  logic?: string
  knobs?: Knobs
  children?: DesignNode[]
}

export type Design = {
  version: 1
  name: string
  description: string
  // SPEC deviation: a high-water mark so an id is never handed out twice, even
  // after the node with the highest number was removed. Optional: a design
  // without it derives the next id from the ids present. Maintained by ops.ts.
  nextId?: number
  nodes: DesignNode[]
}

export type ParseResult = { ok: true; design: Design } | { ok: false; error: string }

export type Row = { node: DesignNode; depth: number; parentId: string | undefined; index: number }

export type WalkInfo = { parent: DesignNode | undefined; depth: number; index: number }

/** The only types that may hold children. */
export const CONTAINER_TYPES: readonly NodeType[] = ['pipeline', 'parallel', 'loop', 'branch', 'phase']

/** The kinds a block type has, the plain one first; none for a type that has no kinds. */
export function kindsOf(type: NodeType): readonly Kind[] {
  return (KINDS as Partial<Record<NodeType, readonly Kind[]>>)[type] ?? []
}

/** The kind a block is with none said: the first of its type's, undefined for a type that has no kinds. */
export function plainKind(type: NodeType): Kind | undefined {
  return kindsOf(type)[0]
}

/** A block's kind, the plain one where it says none; undefined for a type that has no kinds. */
export function kindOf(node: Pick<DesignNode, 'type' | 'kind'>): Kind | undefined {
  return node.kind ?? plainKind(node.type)
}

/** A block as the add list and a message name it: `agent verify`, `loop dry`, and the bare type for a plain block. */
export function typeName(node: Pick<DesignNode, 'type' | 'kind'>): string {
  return node.kind === undefined || node.kind === plainKind(node.type) ? node.type : `${node.type} ${node.kind}`
}

/**
 * A block's type and kind as a file or a tool call says them. The plain kind is left out; a kind the
 * type does not have is refused, with the ones it has.
 */
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

/** Where the `args` block stands, as a refusal says it: every design has one, and nothing stands before it. */
export const ARGS_PLACE = 'the args block is the first block of the design: at the top level, before every other block'

/** The design's `args` block: its first block. Every design that was parsed or made here has one (`withArgs`). */
export function argsOf(design: Pick<Design, 'nodes'>): DesignNode | undefined {
  return design.nodes[0]?.type === 'args' ? design.nodes[0] : undefined
}

/** Whether a design has no block of its own yet: nothing but the args block every design has. */
export function isBlank(design: Pick<Design, 'nodes'>): boolean {
  return design.nodes.every(node => node.type === 'args')
}

/**
 * The number the next new node gets: one more than the highest number ever
 * present. `design.nextId` remembers numbers of removed nodes; a design that
 * lacks it (hand-written, or a template) falls back to the highest id present.
 */
export function nextIdNumber(design: Pick<Design, 'nodes' | 'nextId'>): number {
  let highest = 0
  const visit = (nodes: readonly DesignNode[]): void => {
    for (const node of nodes) {
      highest = Math.max(highest, idNumber(node.id))
      if (node.children) visit(node.children)
    }
  }
  visit(design.nodes)
  return Math.max(design.nextId ?? 1, highest + 1)
}

/** The design with its args block: as it is when it has one, else with a new, empty one put first. */
export function withArgs(design: Design): Design {
  if (argsOf(design)) return design
  const number = nextIdNumber(design)
  return { ...design, nextId: number + 1, nodes: [{ id: `n${number}`, type: 'args', name: 'args' }, ...design.nodes] }
}

const KNOB_KEYS = ['prompt', 'output', 'model', 'effort', 'isolation', 'agentType', 'oncePer', 'votes', 'stopCondition', 'condition'] as const
const TEXT_KNOBS: readonly string[] = ['prompt', 'output', 'model', 'agentType', 'oncePer', 'stopCondition', 'condition']
const ID_PATTERN = /^n(\d+)$/

export function isNodeType(value: unknown): value is NodeType {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).includes(value)
}

export function canHoldChildren(type: NodeType): boolean {
  return CONTAINER_TYPES.includes(type)
}

/** A type with its article, as a refusal names it: `an agent`, `a pipeline`. */
export function aType(type: NodeType): string {
  return `${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}`
}

/** The number in an id like "n12", or 0 when the id has another form. */
export function idNumber(id: string): number {
  const match = ID_PATTERN.exec(id)
  return match ? Number(match[1]) : 0
}

/** Lowercase kebab-case, as `meta.name` wants it. */
export function toKebab(name: string): string {
  const kebab = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return kebab || 'untitled'
}

/** A design with no block of its own: the args block and nothing else. */
export function emptyDesign(name: string): Design {
  return withArgs({ version: 1, name: toKebab(name), description: '', nodes: [] })
}

/** Why one knob value is not acceptable, or undefined when it is. */
export function knobError(key: string, value: unknown): string | undefined {
  if (TEXT_KNOBS.includes(key)) return typeof value === 'string' ? undefined : `knob ${key} must be a string`
  if (key === 'effort') {
    return (EFFORTS as readonly unknown[]).includes(value) ? undefined : `knob effort must be one of ${EFFORTS.join(', ')}`
  }
  if (key === 'isolation') return value === 'worktree' ? undefined : 'knob isolation must be "worktree"'
  if (key === 'votes') {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? undefined : 'knob votes must be a whole number of at least 1'
  }
  return `unknown knob ${key}`
}

class Invalid extends Error {}

function fail(message: string): never {
  throw new Invalid(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Unknown knob keys are dropped; known keys with a wrong value are refused.
function readKnobs(raw: unknown, where: string): Knobs | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) fail(`${where}: knobs must be an object`)
  const knobs: Record<string, unknown> = {}
  for (const key of KNOB_KEYS) {
    const value = raw[key]
    if (value === undefined) continue
    const error = knobError(key, value)
    if (error) fail(`${where}: ${error}`)
    knobs[key] = value
  }
  return Object.keys(knobs).length > 0 ? (knobs as Knobs) : undefined
}

function readNodes(raw: unknown, where: string, seen: Set<string>): DesignNode[] {
  if (!Array.isArray(raw)) fail(`${where} must be an array`)
  return raw.map((one: unknown, index) => readNode(one, `${where}[${index}]`, seen))
}

function readNode(raw: unknown, where: string, seen: Set<string>): DesignNode {
  if (!isRecord(raw)) fail(`${where} must be an object`)
  const { id, name, logic, children } = raw
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) fail(`${where}: id must look like "n1"`)
  if (seen.has(id)) fail(`duplicate id ${id}`)
  seen.add(id)
  const read = readType(raw.type, raw.kind)
  if ('error' in read) fail(`${id}: ${read.error}`)
  const { type, kind } = read
  if (typeof name !== 'string') fail(`${id}: name must be a string`)
  if (logic !== undefined && typeof logic !== 'string') fail(`${id}: logic must be a string`)

  const node: DesignNode = { id, type, name }
  if (kind !== undefined) node.kind = kind
  if (logic !== undefined) node.logic = logic
  const knobs = readKnobs(raw.knobs, id)
  if (knobs) node.knobs = knobs
  if (children !== undefined) {
    const list = readNodes(children, `${id}.children`, seen)
    if (list.length > 0 && !canHoldChildren(type)) fail(`${id}: ${aType(type)} node cannot hold children`)
    if (canHoldChildren(type)) node.children = list
  }
  return node
}

/**
 * Validates shape, version, unique ids, known types and kinds, and where `args` stands. Never throws.
 * A design read with no args block (one saved before every design had it) is given an empty one.
 */
export function parseDesign(json: string): ParseResult {
  try {
    const raw: unknown = JSON.parse(json)
    if (!isRecord(raw)) fail('design must be an object')
    if (raw.version !== 1) fail(`unsupported version ${JSON.stringify(raw.version)}; expected 1`)
    const { name, description, nextId } = raw
    if (typeof name !== 'string' || name === '') fail('name must be a non-empty string')
    if (typeof description !== 'string') fail('description must be a string')
    if (nextId !== undefined && !(typeof nextId === 'number' && Number.isInteger(nextId) && nextId >= 1)) {
      fail('nextId must be a whole number of at least 1')
    }
    const nodes = readNodes(raw.nodes, 'nodes', new Set())
    const design: Design = { version: 1, name, description, nodes }
    if (typeof nextId === 'number') design.nextId = nextId
    walk(design, (node, info) => {
      if (node.type === 'args' && (info.parent !== undefined || info.index !== 0)) fail(`${node.id}: ${ARGS_PLACE}`)
    })
    return { ok: true, design: withArgs(design) }
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message }
    return { ok: false, error: error instanceof SyntaxError ? `not valid JSON: ${error.message}` : 'design could not be read' }
  }
}

// Rebuilds every object so keys come out in one fixed order whatever order
// the design was assembled in.
function orderedNode(node: DesignNode): Record<string, unknown> {
  const out: Record<string, unknown> = { id: node.id, type: node.type }
  if (node.kind !== undefined && node.kind !== plainKind(node.type)) out.kind = node.kind
  out.name = node.name
  if (node.logic !== undefined) out.logic = node.logic
  if (node.knobs) {
    const knobs: Record<string, unknown> = {}
    for (const key of KNOB_KEYS) if (node.knobs[key] !== undefined) knobs[key] = node.knobs[key]
    if (Object.keys(knobs).length > 0) out.knobs = knobs
  }
  if (node.children) out.children = node.children.map(orderedNode)
  return out
}

/** Stable key order, 2-space indent, trailing newline. */
export function serializeDesign(design: Design): string {
  const out: Record<string, unknown> = { version: design.version, name: design.name, description: design.description }
  if (design.nextId !== undefined) out.nextId = design.nextId
  out.nodes = design.nodes.map(orderedNode)
  return `${JSON.stringify(out, null, 2)}\n`
}

/** Depth-first, parents before children, siblings in order. */
export function walk(design: Design, fn: (node: DesignNode, info: WalkInfo) => void): void {
  const visit = (nodes: readonly DesignNode[], parent: DesignNode | undefined, depth: number): void => {
    nodes.forEach((node, index) => {
      fn(node, { parent, depth, index })
      if (node.children) visit(node.children, node, depth + 1)
    })
  }
  visit(design.nodes, undefined, 0)
}

export function findNode(design: Design, id: string): DesignNode | undefined {
  let found: DesignNode | undefined
  walk(design, node => {
    if (node.id === id) found ??= node
  })
  return found
}

/** How many blocks a design has, as a count says it: the args block, which every design has, is not one of them. */
export function blockCount(design: Design): number {
  return flatten(design).filter(row => row.node.type !== 'args').length
}

/** Every node as a row, in the order the design lists them: parents before what they hold. */
export function flatten(design: Design): Row[] {
  const rows: Row[] = []
  walk(design, (node, info) => {
    rows.push({ node, depth: info.depth, parentId: info.parent?.id, index: info.index })
  })
  return rows
}
