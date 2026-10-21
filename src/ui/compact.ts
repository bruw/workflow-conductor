// The compact view: what the band above the prompt shows while the designer is minimized, by the person or for want of room.
// No `$`, no engine imports.

import type { NodeRun, RunState } from '../run/events'
import type { Project, ProjectNode } from '../project/model'
import { typeName } from '../project/model'
import { DOCK_MIN_TERMINAL, FULL_MIN_COLUMNS, FULL_MIN_ROWS } from '../project/session'

import { MINIMIZE_KEYS } from './keys'
import { FAILED, spinnerFrame } from './rail'
import { GLYPH } from './theme'
import { cellWidth, glyphs, oneLine } from './text'

export type Minimized = 'no' | 'person' | 'auto'

export type CompactWhy = 'narrow' | 'screen' | 'dock' | 'short'

/** Kept for the session. */
export type Shell = { minimized: Minimized; why: CompactWhy | null }

export function initialShell(): Shell {
  return { minimized: 'no', why: null }
}

export type PaneRoom = { dock: boolean; bodyColumns: number; bodyRows: number; fullscreen: boolean }

export function whyCompact(room: PaneRoom): CompactWhy {
  // Inline in the fullscreen layout is a terminal under DOCK_MIN_TERMINAL columns: wider, the pane is docked.
  if (!room.dock) return room.fullscreen ? 'narrow' : 'screen'
  return room.bodyColumns < FULL_MIN_COLUMNS ? 'dock' : 'short'
}

export const WHY_TEXT: Record<CompactWhy, string> = {
  narrow: `The full designer needs a terminal ${DOCK_MIN_TERMINAL}+ columns wide`,
  screen: `The full designer needs the fullscreen layout, or ${FULL_MIN_ROWS}+ rows above the prompt`,
  dock: `The full designer needs a dock ${FULL_MIN_COLUMNS}+ columns wide: drag its edge`,
  short: 'The full designer needs a taller terminal',
}

/** The designer's rows, and the prompt's under them. */
const DOCK_MIN_ROWS = FULL_MIN_ROWS + 6

export function wouldDock(viewport: { columns: number; rows: number; isFullscreen?: boolean } | undefined): boolean {
  return viewport !== undefined && viewport.isFullscreen === true && viewport.columns >= DOCK_MIN_TERMINAL && viewport.rows >= DOCK_MIN_ROWS
}

export const EXPAND_WORD = 'Expand'
export const EXPAND_W = `[${MINIMIZE_KEYS}] ${EXPAND_WORD}`.length

/** `passed` is a step no agent runs (code), behind one that started. */
export type StepState = 'waiting' | 'running' | 'done' | 'failed' | 'passed'

/** A step of the plan, or a stack of arms that run side by side (`all`) or one of which runs (`one`). */
export type StripItem = { kind: 'step'; id: string; title: string; state: StepState } | { kind: 'stack'; join: 'all' | 'one'; arms: StripItem[][] }

const stateOf = (bucket: NodeRun | undefined): StepState => {
  if (bucket === undefined || bucket.total === 0) return 'waiting'
  if (bucket.running > 0) return 'running'
  return bucket.failed > 0 ? 'failed' : 'done'
}

const titleOf = (node: ProjectNode): string => oneLine(node.name) || typeName(node)

const touched = (node: ProjectNode, run: RunState): boolean => (run.byNode[node.id]?.total ?? 0) > 0 || (node.children ?? []).some(child => touched(child, run))

function itemsOf(nodes: readonly ProjectNode[], run: RunState): StripItem[] {
  const out: StripItem[] = []
  for (const node of nodes) {
    if (node.type === 'start') continue
    const children = node.children ?? []
    // A container whose agents the run put on it, and on none of its blocks, is one step.
    const whole = children.length === 0 || (!children.some(child => touched(child, run)) && (run.byNode[node.id]?.total ?? 0) > 0)
    if (whole) out.push({ kind: 'step', id: node.id, title: titleOf(node), state: stateOf(run.byNode[node.id]) })
    // One arm is a fan-out of the same blocks: a sequence, not a stack.
    else if ((node.type === 'parallel' || node.type === 'branch') && children.length > 1) out.push({ kind: 'stack', join: node.type === 'branch' ? 'one' : 'all', arms: children.map(child => itemsOf([child], run)) })
    else out.push(...itemsOf(children, run))
  }
  return out
}

function stepsOf(items: readonly StripItem[]): Extract<StripItem, { kind: 'step' }>[] {
  return items.flatMap(item => (item.kind === 'step' ? [item] : item.arms.flatMap(stepsOf)))
}

/** The plan's steps in order, with the run on them; a run with no project has its phases. */
export function stripItems(project: Project | null, run: RunState): StripItem[] {
  if (project === null) return Object.keys(run.byPhase).map(phase => ({ kind: 'step', id: phase, title: oneLine(phase), state: stateOf(run.byPhase[phase]) }))
  const items = itemsOf(project.nodes, run)
  // A code step has no agent to say it ran: one with a step after it that started has.
  const codeIds = codeIdsOf(project)
  const steps = stepsOf(items)
  const lastStarted = steps.findLastIndex(step => step.state !== 'waiting' && step.state !== 'passed')
  steps.forEach((step, at) => {
    if (at < lastStarted && step.state === 'waiting' && codeIds.has(step.id)) step.state = 'passed'
  })
  return items
}

function codeIdsOf(project: Project): Set<string> {
  const ids = new Set<string>()
  const visit = (nodes: readonly ProjectNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'code') ids.add(node.id)
      visit(node.children ?? [])
    }
  }
  visit(project.nodes)
  return ids
}

/** The step the strip is centred on: the front of the work, else the one to look at once it is over. */
export function currentStep(items: readonly StripItem[], running: boolean): string | null {
  const steps = stepsOf(items)
  const busy = steps.findLast(step => step.state === 'running')
  if (busy) return busy.id
  if (running) {
    const started = steps.findLastIndex(step => step.state !== 'waiting')
    return (steps[started + 1] ?? steps[started] ?? steps[0])?.id ?? null
  }
  return (steps.find(step => step.state === 'failed') ?? steps.findLast(step => step.state !== 'waiting') ?? steps[0])?.id ?? null
}

export type StripTone = 'text' | 'faded' | 'claude' | 'success' | 'error'

export type StripPart = { text: string; tone: StripTone; bold?: true }

const JOINT = ' → '
const ARMS = { all: ' ∥ ', one: ' OR ' } as const

function markOf(state: StepState, now: number): StripPart | null {
  if (state === 'running') return { text: `${spinnerFrame(now)} `, tone: 'claude' }
  if (state === 'done') return { text: `${GLYPH.done} `, tone: 'success' }
  if (state === 'passed') return { text: `${GLYPH.done} `, tone: 'faded' }
  if (state === 'failed') return { text: `${FAILED} `, tone: 'error' }
  return null
}

function titleTone(state: StepState, current: boolean): StripTone {
  if (state === 'failed') return 'error'
  if (current) return 'claude'
  return state === 'waiting' ? 'faded' : 'text'
}

/** The parts in order, and the cells the current step spans. */
function partsOf(items: readonly StripItem[], current: string | null, now: number): { parts: StripPart[]; focus: [number, number] } {
  const parts: StripPart[] = []
  let cells = 0
  let focus: [number, number] = [0, 0]
  const push = (part: StripPart): void => {
    parts.push(part)
    cells += cellWidth(part.text)
  }
  const sequence = (row: readonly StripItem[]): void => {
    row.forEach((item, at) => {
      if (at > 0) push({ text: JOINT, tone: 'faded' })
      if (item.kind === 'stack') {
        push({ text: '( ', tone: 'faded' })
        item.arms.forEach((arm, index) => {
          if (index > 0) push({ text: ARMS[item.join], tone: 'faded' })
          sequence(arm)
        })
        push({ text: ' )', tone: 'faded' })
        return
      }
      const lit = item.id === current
      const from = cells
      const mark = markOf(item.state, now)
      if (mark) push(mark)
      push({ text: item.title, tone: titleTone(item.state, lit), ...(lit ? { bold: true as const } : {}) })
      if (lit) focus = [from, cells]
    })
  }
  sequence(items)
  return { parts, focus }
}

/** `[from, from + width)` of the parts' cells; a wide glyph cut by an edge is a space. */
function window(parts: readonly StripPart[], from: number, width: number): StripPart[] {
  const out: StripPart[] = []
  let at = 0
  for (const part of parts) {
    let text = ''
    for (const glyph of glyphs(part.text)) {
      const end = at + glyph.width
      if (at >= from && end <= from + width) text += glyph.text
      else if (end > from && at < from + width) text += ' '.repeat(Math.min(end, from + width) - Math.max(at, from))
      at = end
    }
    if (text !== '') out.push({ ...part, text })
  }
  return out
}

/** Swaps the first or last visible cell for `…`. */
function edge(parts: StripPart[], side: 'start' | 'end'): void {
  const index = side === 'start' ? 0 : parts.length - 1
  const part = parts[index]
  if (!part) return
  const cut = glyphs(part.text)
  const kept = side === 'start' ? cut.slice(1) : cut.slice(0, -1)
  const lost = (side === 'start' ? cut[0] : cut.at(-1))?.width ?? 1
  // A wide glyph swapped for `…` leaves a cell, kept as a space so the width holds.
  const pad = ' '.repeat(Math.max(0, lost - 1))
  const rest = kept.map(one => one.text).join('')
  parts[index] = { ...part, text: side === 'start' ? `${pad}${rest}` : `${rest}${pad}` }
  if (side === 'start') parts.unshift({ text: '…', tone: 'faded' })
  else parts.push({ text: '…', tone: 'faded' })
}

/** The whole plan on one line of `width` cells at most: what does not fit is cut off at the edges, around the current step. */
export function planStrip(items: readonly StripItem[], current: string | null, width: number, now: number = 0): StripPart[] {
  const room = Math.max(1, Math.floor(width))
  const { parts, focus } = partsOf(items, current, now)
  const total = parts.reduce((sum, part) => sum + cellWidth(part.text), 0)
  if (total <= room) return parts
  // A current step wider than the room shows from its start, past the `…` the cut edge takes.
  const centred = focus[1] - focus[0] > room - 2 ? focus[0] - 1 : Math.floor((focus[0] + focus[1] - room) / 2)
  const from = Math.max(0, Math.min(total - room, centred))
  const shown = window(parts, from, room)
  if (from > 0) edge(shown, 'start')
  if (from + room < total) edge(shown, 'end')
  return shown
}
