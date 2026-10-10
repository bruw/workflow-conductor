import type { RunEvent } from './events'

export type AgentMeta = { description?: string; workflowPhase?: string }

export type JournalOptions = {
  /** Run id stamped on the events; the journal itself does not carry one. */
  runId?: string
}

function parseLine(line: string): Record<string, unknown> | undefined {
  if (!line.trim()) return undefined
  try {
    const value: unknown = JSON.parse(line)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Converts the contents of a workflow `journal.jsonl` into run events.
 * `metas` maps agentId to the reduced contents of its `agent-<id>.meta.json`, used when a
 * `started` line lacks a label or phase. Unknown and malformed lines are skipped.
 */
export function journalToEvents(journalText: string, metas: Record<string, AgentMeta> = {}, options: JournalOptions = {}): RunEvent[] {
  const runId = options.runId ?? ''
  const events: RunEvent[] = []
  let index = 0

  if (typeof journalText !== 'string') return events

  for (const line of journalText.split('\n')) {
    const entry = parseLine(line)
    if (!entry) continue

    if (entry.type === 'launched') {
      events.push({ kind: 'run-start', runId })
      continue
    }

    const agentId = text(entry.agentId)
    if (agentId === undefined) continue

    if (entry.type === 'started') {
      const meta = metas?.[agentId]
      const start: RunEvent = {
        kind: 'agent-start',
        runId,
        agentId,
        label: text(entry.label) ?? text(meta?.description) ?? '',
        index: index++,
      }
      const phase = text(entry.phase) ?? text(meta?.workflowPhase)
      if (phase !== undefined) start.phase = phase
      events.push(start)
    } else if (entry.type === 'result') {
      events.push({ kind: 'agent-end', agentId, ok: entry.result !== null && entry.result !== undefined })
    }
  }

  return events
}

/**
 * The phase of every agent the journal has a `started` line for: its title, or null when
 * the line names none. An agent missing from the map has not been journalled yet.
 */
export function journalPhases(journalText: string): Map<string, string | null> {
  const phases = new Map<string, string | null>()
  if (typeof journalText !== 'string') return phases

  for (const line of journalText.split('\n')) {
    const entry = parseLine(line)
    if (entry?.type !== 'started') continue

    const agentId = text(entry.agentId)
    if (agentId !== undefined) phases.set(agentId, text(entry.phase) ?? null)
  }

  return phases
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Totals `input_tokens + output_tokens` over an agent transcript (`agent-<id>.jsonl`).
 * One API message is written as several lines that repeat the same `message.id` and usage,
 * so usage is counted once per message id (the largest seen); lines without an id each count.
 */
export function sumUsage(transcriptText: string): number {
  if (typeof transcriptText !== 'string') return 0

  const byMessage = new Map<string, number>()
  let total = 0

  for (const line of transcriptText.split('\n')) {
    const message = parseLine(line)?.message
    if (message === null || typeof message !== 'object') continue

    const { id, usage } = message as { id?: unknown; usage?: unknown }
    if (usage === null || typeof usage !== 'object') continue

    const { input_tokens, output_tokens } = usage as { input_tokens?: unknown; output_tokens?: unknown }
    const tokens = count(input_tokens) + count(output_tokens)

    if (typeof id === 'string') byMessage.set(id, Math.max(byMessage.get(id) ?? 0, tokens))
    else total += tokens
  }

  for (const tokens of byMessage.values()) total += tokens
  return total
}
