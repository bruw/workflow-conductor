import type { AgentRun, RunState } from '../run/events'

import { cellWidth, clip, oneLine } from './text'
import { FADED, GLYPH, RULE } from './theme'

// The run pane as plain rows: no `$`, no elements. hooks/run.tsx maps rows to elements.

export type ColorKey = 'text' | 'claude' | 'success' | 'error' | 'subtle' | 'inactive'

export type Part = { text: string; color?: ColorKey; bold?: boolean }

export type RowKind = 'header' | 'phase' | 'agent' | 'footer'

export type Counts = { total: number; running: number; done: number; failed: number }

export type Row = {
  kind: RowKind
  /** Stable address: `header`, `phase:<title>`, `agent:<id>`, `footer`. */
  key: string
  glyph: string
  /** Color of the glyph, which is the row's state. */
  color: ColorKey
  /** The whole line left to right, glyph included, padded to the width. */
  parts: Part[]
  text: string
  /** Phase title: on a phase row its own, on an agent row its group's. */
  phase?: string
  /** Phase rows: whether its agents follow. */
  open?: boolean
  counts?: Counts
  tokens?: string
  bar?: string
}

export type RailUi = {
  expanded: ReadonlySet<string>
  /** Phases the person closed; wins over the automatic expansion on failure. */
  collapsed?: ReadonlySet<string>
  /** Milliseconds on the run's tick clock; picks the spinner frame. */
  now?: number
  /** Cells across; rows are padded so the right-hand columns line up. */
  width?: number
}

export type RailUiState = { expanded: string[]; collapsed: string[] }

export const NO_PHASE = '(no phase)'
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
export const SPIN_MS = 96
export const FAILED = '✗'
export const DEFAULT_WIDTH = 60
export const BAR_WIDTH = 8

const MIN_WIDTH = 36
const EIGHTHS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const
const COUNT_COLUMN = 8
const TOKEN_COLUMN = 8

/** `842`, `18.2k`, `120k`, `1.2M`. */
export function fmtTokens(tokens: number): string {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) return '0'
  const n = Math.round(tokens)
  if (n < 1000) return String(n)
  if (n < 99_950) return `${(n / 1000).toFixed(1)}k`
  if (n < 999_500) return `${Math.round(n / 1000)}k`

  return `${(n / 1_000_000).toFixed(1)}M`
}

/** `850ms`, `1.1s`, `42s`, `3m05s`, `1h02m`. */
export function fmtDuration(ms: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 9950) return `${(ms / 1000).toFixed(1)}s`

  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

export function bar(done: number, total: number, width: number = BAR_WIDTH): string {
  const cells = Math.max(0, Math.floor(width))
  const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0
  const eighths = Math.round(ratio * cells * 8)
  const full = Math.floor(eighths / 8)
  const rest = eighths % 8

  return ('█'.repeat(full) + (rest > 0 ? EIGHTHS[rest - 1] : '')).padEnd(cells, ' ')
}

export function spinnerFrame(now: number = 0): string {
  const frame = Math.floor(Math.max(0, now) / SPIN_MS) % SPINNER.length

  return SPINNER[frame] ?? SPINNER[0]
}

/** Left parts, a gap, right parts: `width` cells in all, the left side clipped to fit. */
function line(left: Part[], right: Part[], width: number): Part[] {
  const rightCells = right.reduce((sum, part) => sum + cellWidth(part.text), 0)
  let room = Math.max(0, width - rightCells - (rightCells > 0 ? 1 : 0))
  const fitted: Part[] = []

  for (const part of left) {
    const text = clip(part.text, room)
    if (text.length > 0) fitted.push({ ...part, text })
    room -= cellWidth(text)
  }

  const used = fitted.reduce((sum, part) => sum + cellWidth(part.text), 0)
  const gap = Math.max(0, width - used - rightCells)

  return [...fitted, ...(gap > 0 && rightCells > 0 ? [{ text: ' '.repeat(gap) }] : []), ...right]
}

function countOf(agents: readonly AgentRun[]): Counts & { tokens: number } {
  const sum = { total: 0, running: 0, done: 0, failed: 0, tokens: 0 }
  for (const agent of agents) {
    sum.total++
    sum[agent.status]++
    sum.tokens += agent.tokens
  }

  return sum
}

function stateColor(counts: Counts): ColorKey {
  if (counts.running > 0) return 'claude'
  if (counts.failed > 0) return 'error'

  return counts.total > 0 ? 'success' : 'inactive'
}

function tally(counts: Counts & { tokens: number }): Part[] {
  const settled = `${counts.done + counts.failed}/${counts.total}`
  const failed = counts.failed > 0 ? `${counts.failed}${FAILED} ` : ''
  const pad = ' '.repeat(Math.max(1, COUNT_COLUMN - cellWidth(settled) - cellWidth(failed)))

  return [
    { text: pad },
    ...(failed ? [{ text: failed, color: 'error' as const }] : []),
    { text: settled },
    { text: fmtTokens(counts.tokens).padStart(TOKEN_COLUMN, ' '), color: FADED },
  ]
}

const row = (fields: Omit<Row, 'text'>): Row => ({ ...fields, text: fields.parts.map(part => part.text).join('') })

/** Agents grouped by phase in first-seen order; agents without one come last. */
export function groupByPhase(state: RunState): { phase: string; agents: AgentRun[] }[] {
  const groups = new Map<string, AgentRun[]>()
  const loose: AgentRun[] = []

  for (const agent of Object.values(state.agents)) {
    if (agent.phase === undefined || agent.phase === '') {
      loose.push(agent)
      continue
    }
    const group = groups.get(agent.phase)
    if (group) group.push(agent)
    else groups.set(agent.phase, [agent])
  }

  const ordered = [...groups].map(([phase, agents]) => ({ phase, agents }))
  if (loose.length > 0) ordered.push({ phase: NO_PHASE, agents: loose })

  return ordered
}

export function buildRunRows(state: RunState, ui: RailUi): Row[] {
  const agents = Object.values(state.agents)
  if (state.status === 'idle' && agents.length === 0) return []

  const width = Math.max(MIN_WIDTH, Math.floor(ui.width ?? DEFAULT_WIDTH))
  const spin = spinnerFrame(ui.now)
  const all = countOf(agents)
  const statusColor: ColorKey = state.status === 'running' ? 'claude' : state.status === 'failed' ? 'error' : state.status === 'stopped' ? 'subtle' : 'success'
  const rows: Row[] = []
  // A run's name, a phase's title and an agent's label are not this mod's words: each is shown cleaned, on one line.
  const name = oneLine(state.name ?? state.runId ?? '') || 'workflow'

  rows.push(
    row({
      kind: 'header',
      key: 'header',
      glyph: GLYPH.dot,
      color: statusColor,
      parts: line(
        [
          { text: `${GLYPH.dot} `, color: statusColor },
          { text: 'wf: ', color: FADED },
          { text: name, bold: true },
        ],
        [{ text: state.status, color: statusColor }, ...tally(all)],
        width,
      ),
      counts: { total: all.total, running: all.running, done: all.done, failed: all.failed },
      tokens: fmtTokens(all.tokens),
    }),
  )

  for (const { phase, agents: members } of groupByPhase(state)) {
    const counts = countOf(members)
    const color = stateColor(counts)
    const open = ui.collapsed?.has(phase) ? false : ui.expanded.has(phase) || counts.failed > 0
    const glyph = counts.running > 0 ? spin : GLYPH.diamond
    const progress = bar(counts.done + counts.failed, counts.total)

    rows.push(
      row({
        kind: 'phase',
        key: `phase:${phase}`,
        glyph,
        color,
        phase,
        open,
        parts: line(
          [
            { text: `${glyph}  `, color },
            { text: oneLine(phase), color: phase === NO_PHASE ? FADED : undefined },
            { text: `  ×${counts.total}`, color: FADED },
          ],
          [{ text: `▕${progress}▏`, color: counts.running > 0 ? 'claude' : RULE }, ...tally(counts)],
          width,
        ),
        counts: { total: counts.total, running: counts.running, done: counts.done, failed: counts.failed },
        tokens: fmtTokens(counts.tokens),
        bar: progress,
      }),
    )

    if (!open) continue

    members.forEach((agent, at) => {
      const agentColor: ColorKey = agent.status === 'running' ? 'claude' : agent.status === 'failed' ? 'error' : 'success'
      const agentGlyph = agent.status === 'running' ? spin : agent.status === 'failed' ? FAILED : GLYPH.done
      const branch = at === members.length - 1 ? GLYPH.railEnd : GLYPH.railBranch
      const took = agent.durationMs === undefined ? '' : fmtDuration(agent.durationMs)
      const tokens = agent.tokens > 0 ? fmtTokens(agent.tokens) : ''

      rows.push(
        row({
          kind: 'agent',
          key: `agent:${agent.agentId}`,
          glyph: agentGlyph,
          color: agentColor,
          phase,
          parts: line(
            [
              { text: `${GLYPH.rail}  ${branch} `, color: RULE },
              { text: `${agentGlyph} `, color: agentColor },
              { text: oneLine(agent.label) || oneLine(agent.agentId) },
            ],
            [
              { text: took, color: FADED },
              { text: tokens.padStart(TOKEN_COLUMN, ' '), color: FADED },
            ],
            width,
          ),
          tokens,
        }),
      )
    })
  }

  const summary = [
    all.running > 0 ? `${all.running} running` : '',
    `${all.done} done`,
    all.failed > 0 ? `${all.failed} failed` : '',
  ].filter(Boolean)

  rows.push(
    row({
      kind: 'footer',
      key: 'footer',
      glyph: GLYPH.railEnd,
      color: FADED,
      parts: line([{ text: `${GLYPH.railEnd}─ `, color: RULE }, { text: summary.join(' · '), color: FADED }], [], width),
      counts: { total: all.total, running: all.running, done: all.done, failed: all.failed },
      tokens: fmtTokens(all.tokens),
    }),
  )

  return rows
}

export function currentPhase(state: RunState): string | undefined {
  const groups = groupByPhase(state)
  const busy = groups.filter(group => group.agents.some(agent => agent.status === 'running'))

  return (busy.at(-1) ?? groups.at(-1))?.phase
}

/** Status line while the pane is closed: `wf 7/12 ▸ verify`. With `titles` (a project's block titles by id, in project order) it names the last block running: `wf 3/4 ▸ n3 review`. */
export function statusText(state: RunState, titles?: Readonly<Record<string, string>>): string {
  const all = countOf(Object.values(state.agents))
  const head = `wf ${all.done + all.failed}/${all.total}`
  if (titles !== undefined) {
    const busy = Object.keys(titles).filter(id => (state.byNode[id]?.running ?? 0) > 0).at(-1)
    return busy === undefined ? head : `${head} ▸ ${busy} ${oneLine(titles[busy] ?? '')}`.trimEnd()
  }
  const phase = currentPhase(state)

  return `${head}${phase === undefined || phase === NO_PHASE ? '' : ` ▸ ${oneLine(phase)}`}`
}

/** The one toast at run end. */
export function endText(state: RunState): string {
  const all = countOf(Object.values(state.agents))
  const failed = all.failed > 0 ? ` · ${all.failed} failed` : ''

  return `wf ${oneLine(state.name ?? state.runId ?? '') || 'workflow'} ${state.status}: ${all.done}/${all.total} agents${failed} · ${fmtTokens(all.tokens)} tokens`
}

/** `open` is what the person sees now; the phase goes to its opposite. */
export function togglePhase(ui: RailUiState, phase: string, open: boolean): RailUiState {
  const expanded = (ui.expanded ?? []).filter(one => one !== phase)
  const collapsed = (ui.collapsed ?? []).filter(one => one !== phase)

  return open ? { expanded, collapsed: [...collapsed, phase] } : { expanded: [...expanded, phase], collapsed }
}
