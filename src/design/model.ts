// The design model: the shapes from docs/SPEC.md plus parsing, serializing and
// tree helpers. Pure TypeScript: no `$`, no engine imports, no fs.

export const NODE_TYPES = [
  // primitives
  'agent',
  'pipeline',
  'parallel',
  'loop',
  'branch',
  'subworkflow',
  'code',
  // patterns
  'verify',
  'judge-panel',
  'loop-until-dry',
  'sweep',
  'critic',
] as const

export type NodeType = (typeof NODE_TYPES)[number]

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export type Effort = (typeof EFFORTS)[number]

export type Knobs = {
  prompt?: string
  schema?: string
  model?: string
  effort?: Effort
  isolation?: 'worktree'
  agentType?: string
  fanout?: string
  votes?: number
  until?: string
}

export type DesignNode = {
  id: string
  type: NodeType
  title: string
  notes?: string
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
export const CONTAINER_TYPES: readonly NodeType[] = ['pipeline', 'parallel', 'loop', 'loop-until-dry', 'branch', 'sweep']

const KNOB_KEYS = ['prompt', 'schema', 'model', 'effort', 'isolation', 'agentType', 'fanout', 'votes', 'until'] as const
const TEXT_KNOBS: readonly string[] = ['prompt', 'schema', 'model', 'agentType', 'fanout', 'until']
const ID_PATTERN = /^n(\d+)$/

export function isNodeType(value: unknown): value is NodeType {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).includes(value)
}

export function canHoldChildren(type: NodeType): boolean {
  return CONTAINER_TYPES.includes(type)
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

export function emptyDesign(name: string): Design {
  return { version: 1, name: toKebab(name), description: '', nodes: [] }
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
  const { id, type, title, notes, children } = raw
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) fail(`${where}: id must look like "n1"`)
  if (seen.has(id)) fail(`duplicate id ${id}`)
  seen.add(id)
  if (!isNodeType(type)) fail(`${id}: unknown type ${JSON.stringify(type)}`)
  if (typeof title !== 'string') fail(`${id}: title must be a string`)
  if (notes !== undefined && typeof notes !== 'string') fail(`${id}: notes must be a string`)

  const node: DesignNode = { id, type, title }
  if (notes !== undefined) node.notes = notes
  const knobs = readKnobs(raw.knobs, id)
  if (knobs) node.knobs = knobs
  if (children !== undefined) {
    const list = readNodes(children, `${id}.children`, seen)
    if (list.length > 0 && !canHoldChildren(type)) fail(`${id}: a ${type} node cannot hold children`)
    if (canHoldChildren(type)) node.children = list
  }
  return node
}

/** Validates shape, version, unique ids and known types. Never throws. */
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
    return { ok: true, design }
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message }
    return { ok: false, error: error instanceof SyntaxError ? `not valid JSON: ${error.message}` : 'design could not be read' }
  }
}

// Rebuilds every object so keys come out in one fixed order whatever order
// the design was assembled in.
function orderedNode(node: DesignNode): Record<string, unknown> {
  const out: Record<string, unknown> = { id: node.id, type: node.type, title: node.title }
  if (node.notes !== undefined) out.notes = node.notes
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

/** Every node as a row, in the order the canvas draws them. */
export function flatten(design: Design): Row[] {
  const rows: Row[] = []
  walk(design, (node, info) => {
    rows.push({ node, depth: info.depth, parentId: info.parent?.id, index: info.index })
  })
  return rows
}
