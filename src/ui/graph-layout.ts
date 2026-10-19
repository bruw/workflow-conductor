// The graph's layout: a Project as cards, arrows and slots in character cells, top to bottom, never wider than its columns.
// It says the words too, as segments with a role; the paint only gives each role its look. No `$`, no engine imports.

import { needsBrief, needsStop } from '../project/lints'
import { canHoldChildren, flatten, isBlank, plainKind } from '../project/model'
import type { Project, ProjectNode, NodeType, Row } from '../project/model'
import { defaultName } from '../project/teach'
import { START_STAY, addPlace, quickKnob } from '../project/ops'
import type { Place, QuickKnob } from '../project/ops'
import { cappedLines, cellWidth, clip, moreLines, oneLine, sanitize } from './text'

export type Rect = { x: number; y: number; w: number; h: number }
/** `stream`: each result is handed on as it arrives. `barrier`: the next block waits for all of them. */
export type EdgeKind = 'stream' | 'barrier'
/** How a container arranges what it holds: `chain`, one under the other; `stack`, side by side. */
export type Flow = 'chain' | 'stack'
export type Direction = 'left' | 'right' | 'up' | 'down'

/** The id of the card that stands for the agents no block claims; no node id has this form. */
export const UNMAPPED_ID = 'unmapped'

/** An arm of a stack is never narrower than this: fewer are shown, and the rest wait behind a gutter. */
export const ARM_MIN_W = 28
/** The most rows an arm of a stack grows by, to end on the same row as its taller neighbours. */
export const ARM_GROW_MAX = 3
/** A container more than this many containers below the view's root is drawn collapsed. */
export const OPEN_DEPTH = 3
/** A container whose inside would have fewer columns than this is drawn collapsed. */
export const OPEN_MIN_W = 34
/** The columns at each side of a carousel: `◀` or `▶` and the count hidden on that side. */
export const GUTTER_W = 3
export const NOTE_ROWS_MAX = 8
/** The narrowest graph that is laid out: fewer columns are treated as this many (and the paint clips). */
export const GRAPH_MIN_W = 12
/** The widest the graph's content is drawn: in a wider region it is centred. */
export const GRAPH_MAX_W = 132

export function graphColumns(region: number): number {
  return Math.max(GRAPH_MIN_W, Math.min(GRAPH_MAX_W, Math.trunc(region) || 0))
}

export const SLOT = '[+]'
export const SLOT_OPEN = '[+] Add block here'
export const EMPTY = 'empty'
/** Under an empty project's `[+]`: the keys that start it, then what Claude can do. */
export const EMPTY_KEYS: readonly (readonly [string, string])[] = [
  ['n', 'add a block'],
  ['e', 'say what this workflow is for'],
]
export const EMPTY_NOTE: readonly string[] = ['A plain message to Claude in the prompt', 'can draft the project, or change it later.']
export const EMPTY_W = Math.max(SLOT.length, ...EMPTY_KEYS.map(([key, text]) => key.length + 2 + text.length), ...EMPTY_NOTE.map(line => line.length))
export const EMPTY_ROWS = 2 + EMPTY_KEYS.length + 1 + EMPTY_NOTE.length
export const NOT_SET = '[not set]'
export const OPEN_HINT = 'o: open'

export type SegRole =
  | 'type'
  | 'sep'
  | 'title'
  /** `· stop: …`, `· 2–4 of 9`, `N blocks`, `o: open`. */
  | 'fact'
  /** `haiku low` at the right of a leaf's first row. */
  | 'meta'
  /** The one line of notes a card at rest shows. */
  | 'note'
  /** The selected card's notes. */
  | 'text'
  | 'more'
  /** `[not set]`. */
  | 'error'
  /** ` ! `: the block has a problem. */
  | 'badge'
  | 'id'
  /** `IF`, `ELSE` on an arm of a branch. */
  | 'arm'
  | 'key'
  | 'value'
  | 'unset'
  /** Cells of a border left as they are, between two things written on it. */
  | 'rule'

export type { QuickKnob } from '../project/ops'

export type Seg = { text: string; role: SegRole; chip?: QuickKnob }

/** One row of a card: `left` from its first cell, `right` ending at its last. On a border both stand one cell in from the corner's neighbour. */
export type CardRow = { left: Seg[]; right: Seg[] }

export type CardKind = 'leaf' | 'open' | 'collapsed'

export type GraphCard = Rect & {
  id: string
  type: NodeType | 'unmapped'
  /** `open`: a container drawn with what it holds. `collapsed`: a container drawn as one card. */
  kind: CardKind
  title: string
  /** Containers between it and the view's root, itself counted: the frame of a nested view is 0, a top-level block 1. */
  depth: number
  parentId: string | undefined
  index: number
  selected: boolean
  flow: Flow | null
  inside: number
  /** What its top border says: left the arm's condition and a container's header, right the problem mark and the id. */
  top: CardRow
  /** The rows inside it, from its second row. For an open container, the rows above what it holds (`empty` where it holds nothing). */
  rows: CardRow[]
}

export type GraphEdge = { kind: EdgeKind; from: string; to: string; x: number; y: number }

export type GraphSlot = Rect & {
  place: Place
  end: boolean
  /** How a drop here is marked: a bar along a row, or down a column (between two arms). */
  bar: 'row' | 'column'
  /** Where its `[+]` is written, from the first character; null for a slot that only takes a drop. */
  mark: { x: number; y: number; label: string } | null
  open: boolean
  /** The place the keyboard adds at: where `n` would open the add list (`addPlace` in ops.ts), or where it is open. */
  target: boolean
}

/** The word between two arms, on their second row: `OR` (one of them runs) or `∥` (all do). */
export type GraphRule = { x: number; y: number; w: number; label: string }

/** One side of a carousel that has arms out of sight: a press slides the window by one. */
export type GraphGutter = Rect & { id: string; side: 'left' | 'right'; count: number }

export type GraphChip = Rect & { id: string; knob: QuickKnob; key: string }

/** `id` is the view a press opens: null for the root, undefined for the `…` that stands for crumbs left out. `x` and `w` take in `CRUMB_PAD` at each side of the words. */
export type GraphCrumb = { id: string | null | undefined; text: string; x: number; w: number; last: boolean }

/** A carousel as it stands: arms `first` … `first + shown - 1` of `count` are in view. */
export type GraphCarousel = { first: number; shown: number; count: number }

export type GraphLayout = {
  width: number
  /** Rows of the graph itself, the breadcrumb's rows not counted. */
  height: number
  /** Rows pinned above the graph: in a nested view the breadcrumb and the rule under it (the breadcrumb alone where the rows are few), else 0. */
  top: number
  /** The container shown as the frame; null at the root. Null too when the id asked for is no container of the project. */
  viewRootId: string | null
  selectedId: string | null
  /** Parents before their children. Blocks inside a collapsed container and arms out of a carousel's window have none. */
  cards: GraphCard[]
  edges: GraphEdge[]
  slots: GraphSlot[]
  rules: GraphRule[]
  gutters: GraphGutter[]
  chips: GraphChip[]
  crumbs: GraphCrumb[]
  /** How deep the view is, said before the crumbs: `LEVEL 2`. '' at the root, and where the row has no room for it. */
  level: string
  carousels: Record<string, GraphCarousel>
  /** The offsets to keep: what was asked, moved so that each carousel holds the selected arm, and clamped. */
  scroll: Record<string, number>
  /** Every block of the project, drawn or not, parents first: what a run is summed over. */
  blocks: { id: string; type: NodeType; parentId: string | undefined }[]
  /** The whole project is shown and has no block of its own (the start block at the most). */
  blank: boolean
}

export type GraphOptions = {
  columns: number
  /** The rows the graph has: they cap the selected card's notes. */
  rows: number
  selectedId?: string | null
  viewRootId?: string | null
  scroll?: Readonly<Record<string, number>>
  /** A block's own problems, by id. A collapsed container is marked for those of all it holds as well. */
  problems?: Readonly<Record<string, number>>
  openAt?: Place | null
  /** Agents no block claims: more than 0 adds their card after the project (at the root only). */
  unmapped?: number
  /** A run locks the project: the selected card has no chips to press, and says its model and effort as any other. */
  locked?: boolean
}

/** A project file is not trusted text. */
const clean = oneLine

export function segsWidth(segs: readonly Seg[]): number {
  return segs.reduce((sum, seg) => sum + cellWidth(seg.text), 0)
}

export function samePlace(a: Place | null | undefined, b: Place | null | undefined): boolean {
  return a !== null && a !== undefined && b !== null && b !== undefined && a.parentId === b.parentId && a.index === b.index
}

export function childFlow(type: NodeType | undefined): Flow {
  return type === 'parallel' || type === 'branch' ? 'stack' : 'chain'
}

/** What a card says under its name: the block's logic; the start block's goal. */
function cardText(node: ProjectNode): string {
  return (node.type === 'start' ? (node.knobs?.goal ?? '') : (node.logic ?? '')).trim()
}

export function armWord(type: NodeType | undefined): string {
  return type === 'branch' ? 'OR' : '∥'
}

export function noteRows(rows: number): number {
  return Math.max(1, Math.min(NOTE_ROWS_MAX, Math.floor(rows / 3)))
}

export function stackShare(inner: number, count: number, type: NodeType | undefined): { share: number; shown: number; gap: number; carousel: boolean } {
  const gap = armWord(type).length + 2
  if (count <= 0) return { share: inner, shown: 0, gap, carousel: false }
  const all = Math.floor((inner - (count - 1) * gap) / count)
  if (all >= ARM_MIN_W || count === 1) return { share: Math.max(1, all), shown: count, gap, carousel: false }
  const room = inner - 2 * GUTTER_W
  const shown = Math.max(1, Math.min(count - 1, Math.floor((room + gap) / (ARM_MIN_W + gap))))
  return { share: Math.max(1, Math.floor((room - (shown - 1) * gap) / shown)), shown, gap, carousel: true }
}

/** `depth` counts the container itself. */
export function drawnOpen(depth: number, width: number): boolean {
  return depth <= OPEN_DEPTH && width - 4 >= OPEN_MIN_W
}

/** The most cells a model's name takes on a card: a model named in full is cut. */
const KNOB_MAX = 14

/** Each with the digit that steps it (`stepKnob` in ops.ts): `1` model, `2` effort. */
export function quickKnobs(node: Pick<ProjectNode, 'type' | 'kind'>): { key: string; knob: QuickKnob }[] {
  const out: { key: string; knob: QuickKnob }[] = []
  for (const slot of [1, 2]) {
    const knob = quickKnob(node, slot)
    if (knob !== undefined) out.push({ key: String(slot), knob })
  }
  return out
}

function chipSegs(node: ProjectNode, knob: QuickKnob, key: string): Seg[] {
  const value = node.knobs?.[knob]
  const set = value !== undefined && value !== ''
  const text = !set ? knob : clip(clean(String(value)), KNOB_MAX)
  return [
    { text: `[${key}] `, role: 'key', chip: knob },
    { text, role: set ? 'value' : 'unset', chip: knob },
  ]
}

function chipsOf(node: ProjectNode): Seg[] {
  return quickKnobs(node).flatMap((quick, i) => [...(i > 0 ? [{ text: '  ', role: 'rule' as const }] : []), ...chipSegs(node, quick.knob, quick.key)])
}

const MANY: readonly NodeType[] = ['pipeline', 'parallel']

/** A pipeline's stages hand each item on. Elsewhere the next block waits for `from`: a barrier when `from` yields many results, by its type, never by what its fields say. */
function edgeKind(parent: NodeType | undefined, from: ProjectNode): EdgeKind {
  if (parent === 'pipeline') return 'stream'
  return MANY.includes(from.type) ? 'barrier' : 'stream'
}

/** What a block needs and lacks, said in its place before `[not set]`. */
function missingOf(node: ProjectNode): string {
  if (needsBrief(node) && cardText(node) === '') return 'Instruction'
  if (needsStop(node) && clean(node.knobs?.stopCondition ?? '') === '') return 'Stop'
  if (node.type === 'start' && cardText(node) === '') return 'Goal'
  return ''
}

type Arm = { word: 'IF' | 'ELSE'; when: string }

function armOf(node: ProjectNode, parent: ProjectNode | undefined, index: number): Arm | null {
  if (parent?.type !== 'branch') return null
  const when = clean(node.knobs?.condition ?? '')
  if (when !== '') return { word: 'IF', when }
  // The last arm with no condition is the else; any other one still owes its condition.
  return index === (parent.children?.length ?? 0) - 1 && index > 0 ? { word: 'ELSE', when: '' } : { word: 'IF', when: '' }
}

function armSegs(arm: Arm, room: number): Seg[] {
  if (room < arm.word.length) return []
  const segs: Seg[] = [{ text: arm.word, role: 'arm' }]
  if (arm.word === 'ELSE') return segs
  const rest = room - arm.word.length - 1
  if (rest >= 2) segs.push({ text: ` ${clip(arm.when === '' ? NOT_SET : arm.when, rest)}`, role: arm.when === '' ? 'error' : 'text' })
  return segs
}

function armWidth(arm: Arm): number {
  return arm.word === 'ELSE' ? 4 : 3 + (arm.when === '' ? NOT_SET.length : cellWidth(arm.when))
}

const BADGE = ' ! '

/** `AGENT`, `AGENT verify`, `LOOP dry`: the kind is said where it is not the plain one. */
export function typeLabel(block: Pick<ProjectNode, 'type' | 'kind'>): string {
  return `${block.type.toUpperCase()}${block.kind === undefined || block.kind === plainKind(block.type) ? '' : ` ${block.kind}`}`
}

/** A block that still has the name it was added with: a card then says the type alone. */
function unnamed(block: Pick<ProjectNode, 'type' | 'kind'>, title: string): boolean {
  return title === '' || title.toLowerCase() === defaultName(block)
}

function nameSegs(block: Pick<ProjectNode, 'type' | 'kind'>, title: string, room: number, prefix: string = ''): Seg[] {
  const segs: Seg[] = []
  let left = room
  if (prefix !== '' && left > cellWidth(prefix) + 2) {
    segs.push({ text: prefix, role: 'sep' })
    left -= cellWidth(prefix)
  }
  const word = clip(typeLabel(block), left)
  if (word === '') return segs
  segs.push({ text: word, role: 'type' })
  left -= cellWidth(word)
  const named = !unnamed(block, title)
  if (named && left >= 5) {
    segs.push({ text: ' / ', role: 'sep' }, { text: clip(title, left - 3), role: 'title' })
  }
  return segs
}

type Ctx = {
  selectedId: string | null
  /** The selected block and every container around it. */
  path: ReadonlySet<string>
  noteRows: number
  problems: Readonly<Record<string, number>>
  openAt: Place | null
  asked: Readonly<Record<string, number>>
  carousels: Record<string, GraphCarousel>
  locked: boolean
}

type Box = {
  node: ProjectNode
  kind: CardKind
  w: number
  h: number
  depth: number
  index: number
  parentId: string | undefined
  top: CardRow
  rows: CardRow[]
  inside: number
  /** The blocks drawn inside it: all of a chain, the window of a carousel. */
  kids: Box[]
  first: number
  /** A row above the blocks for an open slot that has no row of its own. */
  lead: number
  gap: number
}

function insideOf(node: ProjectNode): number {
  return (node.children ?? []).reduce((sum, child) => sum + 1 + insideOf(child), 0)
}

function problemsIn(node: ProjectNode, problems: Readonly<Record<string, number>>): number {
  return (problems[node.id] ?? 0) + (node.children ?? []).reduce((sum, child) => sum + problemsIn(child, problems), 0)
}

function topRow(node: ProjectNode, w: number, arm: Arm | null, problems: number, head: (room: number) => Seg[], headMin: number, chips: Seg[] = [], headKeep: number = headMin): CardRow {
  const right: Seg[] = []
  // Corners, one cell of border at each end, one between the two sides.
  const span = w - 5
  const id = ` ${node.id} `
  if (problems > 0 && BADGE.length + cellWidth(id) <= span) right.push({ text: BADGE, role: 'badge' }, { text: id, role: 'id' })
  else if (cellWidth(id) <= span) right.push({ text: id, role: 'id' })
  // A selected container's chips stand before them, when its name and they both fit.
  if (chips.length > 0 && segsWidth(right) + segsWidth(chips) + 3 + headKeep + 4 <= span) right.unshift({ text: ' ', role: 'rule' }, ...chips, { text: ' ', role: 'rule' }, { text: '─', role: 'rule' })
  // The words stand between two spaces.
  let room = span - segsWidth(right) - 2
  const left: Seg[] = []
  if (arm && room >= arm.word.length) {
    // A container's own header keeps the cells it needs at the least; the condition takes what is over, and all of it on a leaf.
    const given = headMin === 0 ? room : Math.min(armWidth(arm), room - 3 - headMin)
    const segs = armSegs(arm, given)
    if (segs.length > 0) {
      left.push({ text: ' ', role: 'rule' }, ...segs, { text: ' ', role: 'rule' })
      room -= segsWidth(segs)
      if (headMin > 0) {
        left.push({ text: '─', role: 'rule' })
        room -= 3
      }
    }
  }
  const words = headMin > 0 && room >= 2 ? head(room) : []
  if (words.length > 0) left.push({ text: ' ', role: 'rule' }, ...words, { text: ' ', role: 'rule' })
  return { left, right }
}

function clipSegs(segs: readonly Seg[], room: number): Seg[] {
  const out: Seg[] = []
  let left = room
  for (const seg of segs) {
    if (left <= 0) break
    const text = clip(seg.text, left)
    out.push({ ...seg, text })
    left -= cellWidth(text)
  }
  return out
}

function firstLine(node: ProjectNode): string {
  return clean(cardText(node).split(/\r?\n/).find(line => line.trim() !== '') ?? '')
}

function leafBox(node: ProjectNode, w: number, depth: number, parent: ProjectNode | undefined, index: number, ctx: Ctx): Box {
  const inner = Math.max(1, w - 4)
  const selected = node.id === ctx.selectedId
  const knobs = node.knobs ?? {}
  const title = clean(node.name)
  const rows: CardRow[] = []

  const chips = selected && !ctx.locked ? chipsOf(node) : []
  const meta = [knobs.model, knobs.effort].filter(one => one !== undefined && one !== '').map(one => clip(clean(one ?? ''), KNOB_MAX)).join(' ')
  const nameMin = cellWidth(typeLabel(node)) + (unnamed(node, title) ? 0 : 3 + Math.min(cellWidth(title), 8))
  let right: Seg[] = chips.length > 0 ? chips : meta === '' ? [] : [{ text: meta, role: 'meta' }]
  // Chips that do not fit beside the whole name get the next row; a model and effort that do not fit are left to the detail pane.
  const nameAll = cellWidth(typeLabel(node)) + (unnamed(node, title) ? 0 : 3 + cellWidth(title))
  const beside = right.length === 0 || (chips.length > 0 ? nameAll : nameMin) + 2 + segsWidth(right) <= inner
  if (!beside) right = []
  const room = inner - (right.length > 0 ? segsWidth(right) + 2 : 0)
  rows.push({ left: nameSegs(node, title, room), right })
  if (selected && !beside && chips.length > 0) {
    // One space between chips when two do not fit; then as many as do.
    const tight = segsWidth(chips) <= inner ? chips : chips.map(seg => (seg.role === 'rule' ? { ...seg, text: ' ' } : seg))
    const kept: Seg[] = []
    for (let i = 0; i < tight.length; i += 3) {
      const next = tight.slice(i === 0 ? 0 : i - 1, i + 2)
      if (segsWidth(kept) + segsWidth(next) > inner) break
      kept.push(...next)
    }
    if (kept.length > 0) rows.push({ left: kept, right: [] })
  }

  const lacks = missingOf(node)
  const said: Seg[] = lacks !== '' ? [{ text: `${lacks} `, role: 'note' }, { text: NOT_SET, role: 'error' }] : firstLine(node) === '' ? [] : [{ text: firstLine(node), role: 'note' }]
  const capped = selected && lacks === '' ? cappedLines(sanitize(cardText(node)), inner, ctx.noteRows) : { lines: [], more: 0 }
  if (!selected || lacks !== '' || capped.lines.length === 0 || (capped.lines.length === 1 && capped.more === 0)) {
    const text: Seg[] = selected ? said.map(seg => (seg.role === 'note' && lacks === '' ? { ...seg, role: 'text' as const } : seg)) : said
    if (text.length > 0) rows.push({ left: clipSegs(text, inner), right: [] })
  } else {
    for (const line of capped.lines) rows.push({ left: [{ text: line, role: 'text' }], right: [] })
    if (capped.more > 0) rows.push({ left: [{ text: clip(moreLines(capped.more), inner), role: 'more' }], right: [] })
  }

  const top = topRow(node, w, armOf(node, parent, index), ctx.problems[node.id] ?? 0, () => [], 0)
  return { node, kind: 'leaf', w, h: rows.length + 2, depth, index, parentId: parent?.id, top, rows, inside: 0, kids: [], first: 0, lead: 0, gap: 0 }
}

/** `▸ TYPE / Title` and how many blocks, then their titles and how to open it. */
function collapsedBox(node: ProjectNode, w: number, depth: number, parent: ProjectNode | undefined, index: number, ctx: Ctx): Box {
  const inner = Math.max(1, w - 4)
  const kin = node.children ?? []
  const inside = insideOf(node)
  const count = `${inside} ${inside === 1 ? 'block' : 'blocks'}`
  const fits = cellWidth(typeLabel(node)) + 4 + count.length <= inner
  const rows: CardRow[] = [{ left: nameSegs(node, clean(node.name), inner - (fits ? count.length + 2 : 0), '▸ '), right: fits ? [{ text: count, role: 'fact' }] : [] }]
  const titles = kin.length === 0 ? EMPTY : kin.map(child => clean(child.name) || child.type).join(childFlow(node.type) === 'chain' ? ' → ' : ' | ')
  const hint = OPEN_HINT.length + 6 <= inner
  rows.push({ left: [{ text: clip(titles, inner - (hint ? OPEN_HINT.length + 2 : 0)), role: 'note' }], right: hint ? [{ text: OPEN_HINT, role: 'fact' }] : [] })
  const top = topRow(node, w, armOf(node, parent, index), problemsIn(node, ctx.problems), () => [], 0)
  return { node, kind: 'collapsed', w, h: 4, depth, index, parentId: parent?.id, top, rows, inside, kids: [], first: 0, lead: 0, gap: 0 }
}

/** `TYPE kind / Title · once per: … · stop: … · 2–4 of 9`, with what fits `room`. */
function headSegs(node: ProjectNode, room: number, range: string): Seg[] {
  const title = clean(node.name)
  // The carousel's window is said before any knob: it is the one fact found nowhere else.
  const kept = range !== '' && room - (range.length + 3) >= cellWidth(typeLabel(node)) + Math.min(cellWidth(title) + 3, 9) ? range.length + 3 : 0
  const segs = nameSegs(node, title, room - kept)
  let left = room - kept - segsWidth(segs)
  const fact = (label: string, text: string, whole: boolean = false): void => {
    if (text === '' || left < label.length + 3 + (whole ? cellWidth(text) : Math.min(cellWidth(text), 6))) return
    const words = ` · ${label}${clip(text, left - 3 - label.length)}`
    segs.push({ text: words, role: 'fact' })
    left -= cellWidth(words)
  }
  // Its fields as they were typed: nothing is read out of them.
  fact('once per: ', clean(node.knobs?.oncePer ?? ''))
  fact('stop: ', clean(node.knobs?.stopCondition ?? ''))
  if (kept > 0) segs.push({ text: ` · ${range}`, role: 'fact' })
  return segs
}

/** `decide` is the width that decided it is open (`measure`): what it holds is opened by it too, as `viewShows` counts, never by the cells a last arm was left over. */
function openBox(node: ProjectNode, w: number, depth: number, parent: ProjectNode | undefined, index: number, ctx: Ctx, decide: number = w): Box {
  const inner = Math.max(1, w - 4)
  const within = Math.max(1, decide - 4)
  const kin = node.children ?? []
  const flow = childFlow(node.type)
  const lacks = missingOf(node)
  const rows: CardRow[] = lacks === '' ? [] : [{ left: clipSegs([{ text: `${lacks} `, role: 'note' }, { text: NOT_SET, role: 'error' }], inner), right: [] }]
  // A container that holds nothing says so, on the row its first block would take.
  if (kin.length === 0) rows.push({ left: [{ text: EMPTY, role: 'note' }], right: [] })
  const openHere = ctx.openAt !== null && ctx.openAt.parentId === node.id
  let kids: Box[]
  let first = 0
  let lead = 0
  let gap = 0
  let range = ''
  let body = 0
  const deeper = depth + 1
  if (flow === 'chain') {
    kids = kin.map((child, i) => measure(child, inner, within, deeper, node, i, ctx))
    // Before the first block there is no arrow row for the open slot to stand on.
    lead = openHere && ctx.openAt?.index === 0 && kin.length > 0 ? 1 : 0
    if (kids.length > 0) body = kids.reduce((sum, kid) => sum + kid.h, 0) + kids.length - 1
  } else {
    const share = stackShare(inner, kin.length, node.type)
    const arm = stackShare(within, kin.length, node.type).share
    gap = share.gap
    if (share.carousel) {
      // The window starts where it was asked to, and moves just far enough to hold the selected arm.
      const held = kin.findIndex(child => ctx.path.has(child.id))
      first = Math.max(0, Math.min(kin.length - share.shown, Math.trunc(ctx.asked[node.id] ?? 0) || 0))
      if (held >= 0 && held < first) first = held
      if (held >= first + share.shown) first = held - share.shown + 1
      ctx.carousels[node.id] = { first, shown: share.shown, count: kin.length }
      range = `${share.shown === 1 ? first + 1 : `${first + 1}–${first + share.shown}`} of ${kin.length}`
    }
    const room = inner - (share.carousel ? 2 * GUTTER_W : 0)
    // Equal widths; the last arm in view takes the cells the division leaves over.
    kids = kin.slice(first, first + share.shown).map((child, j) => measure(child, j === share.shown - 1 ? Math.max(share.share, room - (share.share + gap) * (share.shown - 1)) : share.share, arm, deeper, node, first + j, ctx))
    // Between two arms there is no row for the open slot: it gets one above them. (After the last arm it stands on the border.)
    lead = openHere && kin.length > 0 && (ctx.openAt?.index ?? 0) < kin.length ? 1 : 0
    if (kids.length > 0) body = Math.max(...kids.map(kid => kid.h))
    // Tops aligned. Bottoms too where an arm is within ARM_GROW_MAX rows of the tallest: a shorter one keeps its own height, not stretched hollow.
    for (const kid of kids) if (body - kid.h <= ARM_GROW_MAX) kid.h = body
  }
  const headMin = cellWidth(typeLabel(node)) + Math.min(cellWidth(clean(node.name)) + 3, 9)
  const top = topRow(node, w, armOf(node, parent, index), ctx.problems[node.id] ?? 0, room => headSegs(node, room, range), headMin, node.id === ctx.selectedId && !ctx.locked ? chipsOf(node) : [], headMin + (range === '' ? 0 : range.length + 3))
  return { node, kind: 'open', w, h: 2 + rows.length + lead + body, depth, index, parentId: parent?.id, top, rows, inside: insideOf(node), kids, first, lead, gap }
}

/** `w` is the width it is drawn at, `share` the width that decides whether a container is open (an arm's, without the cells left over). */
function measure(node: ProjectNode, w: number, share: number, depth: number, parent: ProjectNode | undefined, index: number, ctx: Ctx): Box {
  if (!canHoldChildren(node.type)) return leafBox(node, w, depth, parent, index, ctx)
  return drawnOpen(depth, share) ? openBox(node, w, depth, parent, index, ctx, share) : collapsedBox(node, w, depth, parent, index, ctx)
}

export const CRUMB_SEP = '  ›  '
/** Cells at each side of a crumb's words that are the crumb's too: under the pointer, and where the view's own is lit. */
export const CRUMB_PAD = 1
/** In a window of at least `CRUMB_RULE_ROWS` rows: the crumbs, and a rule between them and the graph. */
export const CRUMB_ROWS = 2
export const CRUMB_RULE_ROWS = 8
/** The level is said only where the row keeps this many columns for the crumbs. */
const CRUMB_LEAST_W = 36

/** `LEVEL 2   project  ›  n4 Deep read  ›  n9 Close gaps`: the middle is left out as `…` when it is too long. The level is how many containers down the view is. */
function crumbsFor(project: Project, trail: readonly ProjectNode[], columns: number): { crumbs: GraphCrumb[]; level: string } {
  const word = `LEVEL ${trail.length}`
  const level = columns - word.length - 3 >= CRUMB_LEAST_W ? word : ''
  // The level stands one cell in, two cells before the first crumb.
  const lead = level === '' ? 0 : 1 + level.length + 2
  const room = columns - lead
  let parts: { id: string | null | undefined; text: string }[] = [{ id: null, text: clean(project.name) }, ...trail.map(node => ({ id: node.id, text: `${node.id} ${clean(node.name)}`.trim() }))]
  const width = (): number => parts.reduce((sum, part) => sum + cellWidth(part.text) + CRUMB_PAD * 2, 0) + CRUMB_SEP.length * (parts.length - 1)
  // Too long: the crumbs in the middle go first, then the names are cut.
  while (width() > room && parts.length > 3) parts = [...parts.slice(0, 1), { id: undefined, text: '…' }, ...parts.slice(parts[1]?.id === undefined ? 3 : 2)]
  for (const at of [0, parts.length - 1]) {
    const part = parts[at]
    const over = width() - room
    if (part && over > 0) parts[at] = { ...part, text: clip(part.text, Math.max(part.id === null ? 2 : 4, cellWidth(part.text) - over)) }
  }
  const crumbs: GraphCrumb[] = []
  let x = lead
  for (const [i, part] of parts.entries()) {
    const text = clip(part.text, Math.max(1, columns - x - CRUMB_PAD * 2))
    const w = cellWidth(text) + CRUMB_PAD * 2
    if (x + CRUMB_PAD < columns) crumbs.push({ id: part.id, text, x, w, last: i === parts.length - 1 })
    x += w + CRUMB_SEP.length
  }
  return { crumbs, level }
}

type Index = { rows: Row[]; byId: Map<string, Row> }

function indexOf(project: Project): Index {
  const rows = flatten(project)
  return { rows, byId: new Map(rows.map(row => [row.node.id, row])) }
}

/** The containers around a block, outermost first; the block itself is not among them. */
function ancestors(index: Index, id: string): ProjectNode[] {
  const out: ProjectNode[] = []
  for (let row = index.byId.get(id); row?.parentId !== undefined; ) {
    row = index.byId.get(row.parentId)
    if (row) out.unshift(row.node)
  }
  return out
}

export function layoutGraph(project: Project, options: GraphOptions): GraphLayout {
  const columns = Math.max(GRAPH_MIN_W, Math.trunc(options.columns) || 0)
  const index = indexOf(project)
  const selectedId = options.selectedId ?? null
  const rootRow = options.viewRootId ? index.byId.get(options.viewRootId) : undefined
  const root = rootRow && canHoldChildren(rootRow.node.type) ? rootRow : undefined
  const openAt = options.openAt ?? null
  const ctx: Ctx = {
    selectedId,
    path: new Set(selectedId === null || !index.byId.has(selectedId) ? [] : [selectedId, ...ancestors(index, selectedId).map(node => node.id)]),
    noteRows: noteRows(options.rows),
    problems: options.problems ?? {},
    openAt,
    asked: options.scroll ?? {},
    carousels: {},
    locked: options.locked === true,
  }

  const cards: GraphCard[] = []
  const edges: GraphEdge[] = []
  const slots: GraphSlot[] = []
  const rules: GraphRule[] = []
  const gutters: GraphGutter[] = []
  const chips: GraphChip[] = []

  const isOpen = (place: Place): boolean => samePlace(openAt, place)
  const blank = !root && isBlank(project)
  const markAt = (x: number, y: number, label: string, from: number, room: number): { x: number; y: number; label: string } => {
    const text = clip(label, Math.max(1, room))
    return { x: Math.max(from, Math.min(x, from + room - text.length)), y, label: text }
  }

  const put = (box: Box, x: number, y: number): void => {
    const flow = box.kind === 'leaf' ? null : childFlow(box.node.type)
    const card: GraphCard = { x, y, w: box.w, h: box.h, id: box.node.id, type: box.node.type, kind: box.kind, title: clean(box.node.name), depth: box.depth, parentId: box.parentId, index: box.index, selected: box.node.id === selectedId, flow, inside: box.inside, top: box.top, rows: box.rows }
    cards.push(card)
    // Where each chip was written (on the top border of a container, in a row of a leaf), for a press on it.
    for (const [i, row] of [box.top, ...box.rows].entries()) {
      let at = x + 2
      for (const side of [row.left, row.right]) {
        if (side === row.right) at = x + box.w - 2 - segsWidth(side)
        for (const seg of side) {
          const last = chips.at(-1)
          const w = cellWidth(seg.text)
          if (seg.chip && last && last.knob === seg.chip && last.y === y + i && last.x + last.w === at) last.w += w
          else if (seg.chip) chips.push({ x: at, y: y + i, w, h: 1, id: card.id, knob: seg.chip, key: seg.text.replace(/[^0-9]/g, '') })
          at += w
        }
      }
    }
    if (box.kind === 'open') putList(box.kids, { box, card }, x + 2, y + 1 + box.rows.length, box.w - 4)
  }

  /** Says the row after the list's last. `host` is the container the list is in; none for the top level. */
  const putList = (kids: Box[], host: { box: Box; card: GraphCard } | undefined, ox: number, oy: number, lw: number): number => {
    const parentId = host?.card.id
    const place = (at: number): Place => (parentId === undefined ? { index: at } : { parentId, index: at })
    const count = host ? (host.box.node.children ?? []).length : kids.length
    const flow = host ? childFlow(host.box.node.type) : 'chain'
    const arrowX = ox + Math.floor((lw - 1) / 2)
    const lead = host ? host.box.lead : isOpen(place(0)) && count > 0 ? 1 : 0
    const base = { target: false }
    /** The end of a container's list: `[+]` in the middle of its bottom border, the `+` on the column of its arrows. */
    const endMark = (card: GraphCard, open: boolean): NonNullable<GraphSlot['mark']> => markAt(arrowX - 1, card.y + card.h - 1, open ? SLOT_OPEN : SLOT, card.x + 2, card.w - 4)

    if (!host && blank) {
      // A project with no block of its own: its `[+]` stands in the middle of the rows left, over the paint's lines that say how to start.
      let y = oy
      for (const kid of kids) {
        put(kid, ox, y)
        y += kid.h
      }
      const open = isOpen(place(count))
      const rows = Math.max(1, Math.trunc(options.rows) || 1)
      const at = y + Math.max(y > oy ? 1 : 0, Math.floor((rows - (y - oy) - EMPTY_ROWS) / 2))
      slots.push({ ...base, x: ox, y: at, w: lw, h: 1, place: place(count), end: true, bar: 'row', open, mark: markAt(ox + Math.max(1, Math.floor((lw - EMPTY_W) / 2)), at, open ? SLOT_OPEN : SLOT, ox, lw) })
      // As tall as the lines under the `[+]` reach, where the rows are short of them: they are panned to, not cut.
      return Math.max(oy + rows, at + EMPTY_ROWS)
    }
    if (count === 0 && host) {
      // An empty container: a drop goes on the row above its bottom border, the one that says `empty`.
      const open = isOpen(place(0))
      slots.push({ ...base, x: ox, y: oy - 1, w: lw, h: 1, place: place(0), end: true, bar: 'row', open, mark: endMark(host.card, open) })
      return oy
    }

    let y = oy
    if (flow === 'chain') {
      if (lead > 0) {
        slots.push({ ...base, x: ox, y, w: lw, h: 1, place: place(0), end: false, bar: 'row', open: true, mark: markAt(arrowX + 3, y, SLOT_OPEN, ox, lw) })
        y += 1
      }
      for (const [i, kid] of kids.entries()) {
        const before = kids[i - 1]
        if (before) {
          const kind = edgeKind(host?.box.node.type, before.node)
          edges.push({ kind, from: before.node.id, to: kid.node.id, x: arrowX, y })
          const open = isOpen(place(i))
          // Two cells right of the arrow (a barrier's `all` is on its left).
          slots.push({ ...base, x: ox, y, w: lw, h: 1, place: place(i), end: false, bar: 'row', open, mark: markAt(arrowX + 3, y, open ? SLOT_OPEN : SLOT, ox, lw) })
          y += 1
        } else if (lead === 0 && !(host === undefined && kid.node.type === 'start')) {
          // Nothing is dropped before the start block.
          slots.push({ ...base, x: ox, y, w: lw, h: 1, place: place(0), end: false, bar: 'row', open: false, mark: null })
        }
        put(kid, ox, y)
        y += kid.h
      }
      const open = isOpen(place(count))
      if (host) {
        slots.push({ ...base, x: host.card.x, y: host.card.y + host.card.h - 1, w: host.card.w, h: 1, place: place(count), end: true, bar: 'row', open, mark: endMark(host.card, open) })
        return y
      }
      slots.push({ ...base, x: ox, y, w: lw, h: 1, place: place(count), end: true, bar: 'row', open, mark: markAt(arrowX - 1, y, open ? SLOT_OPEN : SLOT, ox, lw) })
      return y + 1
    }

    if (!host) return y
    const { box, card } = host
    const carousel = ctx.carousels[card.id]
    const ax = ox + (carousel ? GUTTER_W : 0)
    const xs: number[] = []
    let x = ax
    for (const kid of kids) {
      xs.push(x)
      x += kid.w + box.gap
    }
    const armsEnd = x - box.gap
    const armsY = y + lead
    const rowH = Math.max(1, ...kids.map(kid => kid.h))
    for (const [j, kid] of kids.entries()) {
      const at = box.first + j
      const kx = xs[j] ?? ax
      const open = isOpen(place(at))
      // Between two arms (before the first: the cell left of it) a drop is a bar down the gap; an open slot is said on the row above.
      const rect = j === 0 ? { x: kx - 1, y: armsY, w: 1, h: rowH } : { x: kx - box.gap, y: armsY, w: box.gap, h: rowH }
      slots.push({ ...base, ...rect, place: place(at), end: false, bar: 'column', open, mark: open && lead > 0 ? markAt(rect.x, y, SLOT_OPEN, ox, lw) : null })
      if (j > 0) rules.push({ x: kx - box.gap, y: armsY + 1, w: box.gap, label: armWord(box.node.type) })
      put(kid, kx, armsY)
    }
    // An open slot for an arm out of the window: said at the side it is on.
    if (lead > 0 && openAt && !slots.some(slot => slot.open && samePlace(slot.place, openAt))) {
      slots.push({ ...base, x: ox, y, w: lw, h: 1, place: place(openAt.index), end: false, bar: 'row', open: true, mark: markAt(openAt.index < box.first ? ox : ox + lw, y, SLOT_OPEN, ox, lw) })
    }
    // The end of the arms: a drop is a bar right of the last one, or along the bottom border while that one is out of the window.
    const open = isOpen(place(count))
    const whole = box.first + kids.length === count
    const rect = whole ? { x: Math.min(armsEnd, card.x + card.w - 2), y: armsY, w: 1, h: rowH } : { x: card.x, y: card.y + card.h - 1, w: card.w, h: 1 }
    slots.push({ ...base, ...rect, place: place(count), end: true, bar: whole ? 'column' : 'row', open, mark: endMark(card, open) })
    if (carousel) {
      if (carousel.first > 0) gutters.push({ x: ox, y: armsY, w: GUTTER_W, h: rowH, id: card.id, side: 'left', count: carousel.first })
      const after = carousel.count - carousel.first - carousel.shown
      if (after > 0) gutters.push({ x: ox + lw - GUTTER_W, y: armsY, w: GUTTER_W, h: rowH, id: card.id, side: 'right', count: after })
    }
    return armsY + rowH
  }

  let height: number
  let crumbs: GraphCrumb[] = []
  let level = ''
  if (root) {
    // A nested view: the container is the frame, at full width, whatever its depth and width.
    const parent = root.parentId === undefined ? undefined : index.byId.get(root.parentId)?.node
    const frame = openBox(root.node, columns, 0, parent, root.index, ctx)
    // The frame says nothing of the arm it is in the view above: there is no arm beside it here.
    frame.top = topRow(root.node, columns, null, ctx.problems[root.node.id] ?? 0, room => headSegs(root.node, room, rangeOf(ctx.carousels[root.node.id])), cellWidth(typeLabel(root.node)), root.node.id === selectedId && !ctx.locked ? chipsOf(root.node) : [], root.node.type.length + 12 + rangeOf(ctx.carousels[root.node.id]).length)
    put(frame, 0, 0)
    height = frame.h
    ;({ crumbs, level } = crumbsFor(project, [...ancestors(index, root.node.id), root.node], columns))
  } else {
    height = putList(
      project.nodes.map((node, i) => measure(node, columns, columns, 1, undefined, i, ctx)),
      undefined,
      0,
      0,
      columns,
    )
    const strays = options.unmapped ?? 0
    if (strays > 0) {
      // Not a block of the project: a card of its own after it, with no slot around it.
      const title = strays > 1 ? `${strays} agents no block claims` : 'an agent no block claims'
      cards.push({ x: 0, y: height, w: columns, h: 3, id: UNMAPPED_ID, type: 'unmapped', kind: 'leaf', title, depth: 1, parentId: undefined, index: project.nodes.length, selected: selectedId === UNMAPPED_ID, flow: null, inside: 0, top: { left: [], right: [] }, rows: [{ left: [{ text: clip(title, columns - 4), role: 'title' }], right: [] }] })
      height += 3
    }
  }

  // The one `[+]` the keyboard adds at: where the add list is open, else where `n` would open it.
  const keyAt = openAt ?? addPlace(project, selectedId, root?.node.id ?? null)
  for (const slot of slots) slot.target = samePlace(slot.place, keyAt)

  const scroll: Record<string, number> = {}
  for (const [id, carousel] of Object.entries(ctx.carousels)) scroll[id] = carousel.first
  return {
    width: columns,
    height,
    top: crumbs.length === 0 ? 0 : Math.trunc(options.rows) >= CRUMB_RULE_ROWS ? CRUMB_ROWS : 1,
    viewRootId: root?.node.id ?? null,
    selectedId,
    cards,
    edges,
    slots,
    rules,
    gutters,
    chips,
    crumbs,
    level,
    carousels: ctx.carousels,
    scroll,
    blocks: index.rows.map(row => ({ id: row.node.id, type: row.node.type, parentId: row.parentId })),
    blank,
  }
}

function rangeOf(carousel: GraphCarousel | undefined): string {
  if (!carousel) return ''
  return `${carousel.shown === 1 ? carousel.first + 1 : `${carousel.first + 1}–${carousel.first + carousel.shown}`} of ${carousel.count}`
}

function within(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
}

export function cardOf(layout: GraphLayout, id: string | null | undefined): GraphCard | undefined {
  return id === null || id === undefined ? undefined : layout.cards.find(card => card.id === id)
}

export function cardAt(layout: GraphLayout, x: number, y: number): GraphCard | undefined {
  for (let i = layout.cards.length - 1; i >= 0; i--) {
    const card = layout.cards[i]
    if (card && within(card, x, y)) return card
  }
  return undefined
}

/** The slot whose `[+]` (its words, and the cell on either side) is under a cell. */
export function slotAt(layout: GraphLayout, x: number, y: number): GraphSlot | undefined {
  return layout.slots.find(slot => slot.mark !== null && slot.mark.y === y && x >= slot.mark.x - 1 && x <= slot.mark.x + slot.mark.label.length)
}

export function gutterAt(layout: GraphLayout, x: number, y: number): GraphGutter | undefined {
  return layout.gutters.find(gutter => within(gutter, x, y))
}

export function chipAt(layout: GraphLayout, x: number, y: number): GraphChip | undefined {
  return layout.chips.find(chip => within(chip, x, y))
}

/** The last crumb (the view shown) and the `…` open nothing. */
export function crumbAt(layout: GraphLayout, x: number): GraphCrumb | undefined {
  return layout.crumbs.find(crumb => !crumb.last && crumb.id !== undefined && x >= crumb.x && x < crumb.x + crumb.w)
}

export function slideBy(layout: GraphLayout, gutter: Pick<GraphGutter, 'id' | 'side'>): Record<string, number> {
  const carousel = layout.carousels[gutter.id]
  if (!carousel) return layout.scroll
  const first = Math.max(0, Math.min(carousel.count - carousel.shown, carousel.first + (gutter.side === 'left' ? -1 : 1)))
  return { ...layout.scroll, [gutter.id]: first }
}

export type GraphHit =
  | { kind: 'crumb'; crumb: GraphCrumb }
  | { kind: 'chip'; chip: GraphChip }
  | { kind: 'slot'; slot: GraphSlot }
  | { kind: 'gutter'; gutter: GraphGutter }
  | { kind: 'card'; card: GraphCard }

/** `row` 0 is the window's first row. The most particular thing first: a crumb, a chip, a `[+]`, a gutter, then the innermost card. */
export function graphAt(layout: GraphLayout, column: number, row: number, panY: number): GraphHit | null {
  if (row < layout.top) {
    const crumb = row === 0 ? crumbAt(layout, column) : undefined
    return crumb ? { kind: 'crumb', crumb } : null
  }
  const y = row - layout.top + panY
  const chip = chipAt(layout, column, y)
  if (chip) return { kind: 'chip', chip }
  const slot = slotAt(layout, column, y)
  if (slot) return { kind: 'slot', slot }
  const gutter = gutterAt(layout, column, y)
  if (gutter) return { kind: 'gutter', gutter }
  const card = cardAt(layout, column, y)
  return card ? { kind: 'card', card } : null
}

export function graphRows(layout: Pick<GraphLayout, 'top'>, rows: number): number {
  return Math.max(0, Math.trunc(rows) - layout.top)
}

/** Moves as little as can be from `panY`: the whole card with a row of what is around it, or its top when it is taller. `rows` counts the breadcrumb's. */
export function panTo(layout: GraphLayout, rows: number, panY: number, id: string | null): number {
  const room = graphRows(layout, rows)
  const most = Math.max(0, layout.height - room)
  const card = cardOf(layout, id)
  let pan = Math.max(0, Math.min(most, Math.trunc(panY) || 0))
  if (!card || room <= 0) return pan
  const from = Math.max(0, card.y - 1)
  const to = Math.min(layout.height, card.y + card.h + 1)
  if (to - from > room) pan = card.h + 1 > room ? card.y : from
  else if (from < pan) pan = from
  else if (to > pan + room) pan = to - room
  return Math.max(0, Math.min(most, pan))
}

/** `▲ 3 more above`, `▼ 2 more below`; '' with none. */
export function edgeMarks(layout: GraphLayout, rows: number, panY: number): { above: string; below: string } {
  const bottom = panY + rows
  // Always a count: the blocks wholly out of view, or with none (part of one is cut) the rows.
  const count = (hidden: (card: GraphCard) => boolean, cut: number, glyph: string, where: string): string => {
    const blocks = layout.cards.filter(hidden).length
    return blocks > 0 ? `${glyph} ${blocks} more ${where}` : `${glyph} ${cut} more ${cut === 1 ? 'row' : 'rows'} ${where}`
  }
  return {
    above: panY > 0 ? count(card => card.y + card.h <= panY, panY, '▲', 'above') : '',
    below: bottom < layout.height ? count(card => card.y >= bottom, layout.height - bottom, '▼', 'below') : '',
  }
}

/** The open containers whose header belongs on the window's first row, the innermost of each nest. */
export function stickyCards(layout: GraphLayout, panY: number): GraphCard[] {
  const open = layout.cards.filter(card => card.kind === 'open' && card.y <= panY && card.y + card.h - 1 > panY)
  return open.filter(card => !open.some(other => other.parentId === card.id))
}

function subtree(layout: GraphLayout, id: string): GraphCard[] {
  const ids = new Set([id])
  const out: GraphCard[] = []
  for (const card of layout.cards) {
    if (card.id !== id && (card.parentId === undefined || !ids.has(card.parentId))) continue
    ids.add(card.id)
    out.push(card)
  }
  return out
}

/** How far (columns, a row counting four) a dragged card may be from a slot and still drop into it. */
export const DROP_REACH = 16

export type GraphDrop = {
  slot: GraphSlot
  /** Where `moveNode` is to put the card; null when the slot is where the card already is. */
  to: Place | null
}

/** The nearest slot within reach that is not inside the card itself. Null when no slot is near (a drop there cancels), and for the frame of a view. */
export function dropTarget(layout: GraphLayout, id: string, x: number, y: number): GraphDrop | null {
  const card = cardOf(layout, id)
  if (!card || card.type === 'unmapped' || card.id === layout.viewRootId) return null
  const own = new Set(subtree(layout, id).map(one => one.id))
  let best: GraphSlot | undefined
  let bestReach = Infinity
  for (const slot of layout.slots) {
    if (slot.place.parentId !== undefined && own.has(slot.place.parentId)) continue
    const dx = Math.max(slot.x - x, 0, x - (slot.x + slot.w - 1))
    const dy = Math.max(slot.y - y, 0, y - (slot.y + slot.h - 1))
    const reach = dx + 4 * dy
    if (reach < bestReach) {
      best = slot
      bestReach = reach
    }
  }
  if (!best || bestReach > DROP_REACH) return null
  const { parentId, index } = best.place
  if (parentId === card.parentId && (index === card.index || index === card.index + 1)) return { slot: best, to: null }
  const at = parentId === card.parentId && card.index < index ? index - 1 : index
  return { slot: best, to: parentId === undefined ? { index: at } : { parentId, index: at } }
}

function walker(project: Project, layout: GraphLayout) {
  const index = indexOf(project)
  const parentOf = (row: Row): Row | undefined => (row.parentId === undefined ? undefined : index.byId.get(row.parentId))
  const siblingsOf = (row: Row): readonly ProjectNode[] => parentOf(row)?.node.children ?? project.nodes
  const flowOf = (row: Row): Flow => childFlow(parentOf(row)?.node.type)
  const enterable = (node: ProjectNode): boolean => cardOf(layout, node.id)?.kind === 'open' && (node.children?.length ?? 0) > 0
  /** The block a step into a container lands on: its first, or the first arm its carousel shows. */
  const firstIn = (node: ProjectNode): ProjectNode | undefined => node.children?.[childFlow(node.type) === 'stack' ? (layout.carousels[node.id]?.first ?? 0) : 0]
  return { index, parentOf, siblingsOf, flowOf, enterable, firstIn }
}

/** `id` itself when there is no block that way: nothing wraps, and the selection stays inside the view. Sideways goes to the next arm inside a stack, elsewhere into a container or out of it. */
export function navigate(project: Project, layout: GraphLayout, id: string | null, direction: Direction): string | null {
  const { index, parentOf, siblingsOf, flowOf, enterable, firstIn } = walker(project, layout)
  const rootId = layout.viewRootId
  const here = id === null ? undefined : index.byId.get(id)
  // Nothing selected, or a block this view does not draw: the view's first card.
  if (!here || !cardOf(layout, here.node.id)) return layout.cards.find(card => card.type !== 'unmapped' && card.id !== rootId)?.id ?? layout.cards[0]?.id ?? id
  const stay = here.node.id

  if (direction === 'down') {
    if (enterable(here.node)) return firstIn(here.node)?.id ?? stay
    for (let row: Row | undefined = here; row && row.node.id !== rootId; row = parentOf(row)) {
      const next = flowOf(row) === 'chain' ? siblingsOf(row)[row.index + 1] : undefined
      if (next) return next.id
    }
    return stay
  }

  if (direction === 'up') {
    if (stay === rootId) return stay
    const before = flowOf(here) === 'chain' ? siblingsOf(here)[here.index - 1] : undefined
    if (!before) return here.parentId ?? stay
    // The block read just before this one: the last of the container above, followed down to its end.
    let last = before
    while (enterable(last)) {
      const kin = last.children ?? []
      const next = childFlow(last.type) === 'chain' ? kin.at(-1) : firstIn(last)
      if (!next) break
      last = next
    }
    return last.id
  }

  // Sideways. Inside a stack (at any depth) the key belongs to the arms: the nearest stack that has one that way.
  const step = direction === 'right' ? 1 : -1
  const from = cardOf(layout, stay)
  let stacked = false
  for (let row: Row | undefined = here; row && row.node.id !== rootId; row = parentOf(row)) {
    if (flowOf(row) !== 'stack') continue
    stacked = true
    const arm = siblingsOf(row)[row.index + step]
    if (!arm) continue
    // An arm out of the carousel's window is selected as it is: the window then slides to it.
    const inArm = subtree(layout, arm.id)
    let best = inArm[0]
    for (const card of inArm) if (best && from && Math.abs(card.y - from.y) < Math.abs(best.y - from.y)) best = card
    return best?.id ?? arm.id
  }
  if (stacked) return stay
  if (direction === 'right') return enterable(here.node) ? (firstIn(here.node)?.id ?? stay) : stay
  return stay === rootId ? stay : (here.parentId ?? stay)
}

export const ONLY_ARMS = 'only arms move sideways'

export type MoveTarget = { to: Place; reason?: undefined } | { to: null; reason: string }

/** `down` / `up` is one place in reading order: into an open container that comes next, past a collapsed one, out of the end of its own. `right` / `left` swap two arms. A block never leaves the view. */
export function moveTarget(project: Project, layout: GraphLayout, id: string | null, direction: Direction): MoveTarget {
  const { index, parentOf, siblingsOf, flowOf } = walker(project, layout)
  const here = id === null ? undefined : index.byId.get(id)
  if (!here) return { to: null, reason: id === null ? 'no block is selected' : `no block ${id}` }
  if (here.node.id === layout.viewRootId) return { to: null, reason: `${here.node.id} is the view: b goes up a level, then it can move` }
  if (here.node.type === 'start') return { to: null, reason: START_STAY }
  const parent = parentOf(here)
  const within = (at: number): Place => (parent ? { parentId: parent.node.id, index: at } : { index: at })
  const siblings = siblingsOf(here)

  if (direction === 'left' || direction === 'right') {
    if (flowOf(here) !== 'stack') return { to: null, reason: ONLY_ARMS }
    const at = here.index + (direction === 'right' ? 1 : -1)
    if (at < 0 || at >= siblings.length) return { to: null, reason: direction === 'right' ? 'already the last arm' : 'already the first arm' }
    return { to: within(at) }
  }

  const down = direction === 'down'
  const neighbour = siblings[here.index + (down ? 1 : -1)]
  // Nothing goes before the start block.
  if (neighbour?.type === 'start') return { to: null, reason: `already at the top: ${START_STAY}` }
  if (neighbour) {
    const open = canHoldChildren(neighbour.type) && cardOf(layout, neighbour.id)?.kind === 'open'
    return { to: open ? { parentId: neighbour.id, index: down ? 0 : (neighbour.children ?? []).length } : within(here.index + (down ? 1 : -1)) }
  }
  if (!parent) return { to: null, reason: down ? 'already at the bottom' : 'already at the top' }
  if (parent.node.id === layout.viewRootId) return { to: null, reason: `already at the ${down ? 'bottom' : 'top'} of this view: b goes up a level` }
  const at = down ? parent.index + 1 : parent.index
  return { to: parent.parentId === undefined ? { index: at } : { parentId: parent.parentId, index: at } }
}

/** Whether a view draws a block: every container around it is open there. `viewRootId` null is the whole project. */
export function viewShows(project: Project, viewRootId: string | null, id: string, columns: number): boolean {
  const index = indexOf(project)
  if (!index.byId.has(id)) return false
  if (viewRootId === id) return canHoldChildren(index.byId.get(id)?.node.type ?? 'agent')
  const around = ancestors(index, id)
  const from = viewRootId === null ? -1 : around.findIndex(node => node.id === viewRootId)
  if (viewRootId !== null && from < 0) return false
  // The width and the depth each container on the way down is given, as the layout gives them.
  let width = Math.max(GRAPH_MIN_W, Math.trunc(columns) || 0)
  let depth = 0
  let list: ProjectNode | undefined = around[from]
  for (let i = from + 1; i < around.length; i++) {
    const node = around[i]
    if (!node) return false
    const inner = list ? width - 4 : width
    width = list && childFlow(list.type) === 'stack' ? stackShare(inner, (list.children ?? []).length, list.type).share : inner
    depth += 1
    if (!drawnOpen(depth, width)) return false
    list = node
  }
  return true
}

/** `viewRootId` when it draws the block already, else the whole project (null), else the outermost container that does. Null too for an id the project does not have. */
export function viewFor(project: Project, viewRootId: string | null, id: string, columns: number): string | null {
  if (viewShows(project, viewRootId, id, columns)) return viewRootId
  if (viewShows(project, null, id, columns)) return null
  const index = indexOf(project)
  return ancestors(index, id).find(node => viewShows(project, node.id, id, columns))?.id ?? index.byId.get(id)?.parentId ?? null
}

export function parentView(project: Project, viewRootId: string | null): string | null {
  if (viewRootId === null) return null
  return indexOf(project).byId.get(viewRootId)?.parentId ?? null
}

export function canOpen(project: Project, viewRootId: string | null, id: string | null): boolean {
  if (id === null || id === viewRootId) return false
  const row = indexOf(project).byId.get(id)
  return row !== undefined && canHoldChildren(row.node.type)
}
