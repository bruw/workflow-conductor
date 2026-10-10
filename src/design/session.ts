// What the design pane does to its state, as pure steps: opening a design,
// starting one from a template, and applying a canvas message or an inspector
// edit. The hooks module reads state, calls one of these, writes state and
// saves. Pure TypeScript: no `$`, no engine imports.

import type { CanvasMessage, CanvasProps } from '../ui/canvas-model'
import { lint } from './lints'
import { emptyDesign, findNode, parseDesign, toKebab } from './model'
import type { Design, NodeType } from './model'
import { addNode, moveBy, moveNode, removeNode, updateNode } from './ops'
import type { NodePatch, OpResult } from './ops'
import { TEMPLATES } from './templates'

export const DESIGN_PANE_ID = 'conductor-design'
export const DESIGN_PANE_TITLE = 'Conductor design'
export const DESIGN_DIR = '.claude/workflow-designs'
export const BLANK_TEMPLATE_ID = 'blank'
export const DEFAULT_DESIGN_NAME = 'untitled'

/**
 * `closed`: nothing opened yet. `pick`: no saved design, choosing a template.
 * `ready`: a design is loaded. `error`: the saved file could not be read.
 */
export type DesignStatus = 'closed' | 'pick' | 'ready' | 'error'

export type DesignUi = {
  /** The file's name (kebab-case, no extension). */
  name: string
  status: DesignStatus
  /** Why the saved file was refused (`error`). */
  error: string | null
  selectedId: string | null
  /** Bumped whenever the hooks module moves the selection itself, so the canvas takes it. */
  rev: number
  showCard: boolean
  /** The last refused edit or failed save, shown in the pane until the next edit. */
  notice: string | null
}

export type Step = { design: Design | null; ui: DesignUi; changed: boolean }

export function initialUi(): DesignUi {
  return { name: DEFAULT_DESIGN_NAME, status: 'closed', error: null, selectedId: null, rev: 0, showCard: false, notice: null }
}

export function designName(args: string): string {
  return toKebab(args.trim() || DEFAULT_DESIGN_NAME)
}

/** The design's file under the project root. */
export function designFile(root: string, name: string): string {
  return `${root.replace(/\/+$/, '')}/${DESIGN_DIR}/${name}.json`
}

/** Opens `name`: `text` is the saved file's content, undefined when there is none. */
export function openDesign(name: string, text: string | undefined, rev = 0): Step {
  const ui: DesignUi = { ...initialUi(), name, rev: rev + 1 }
  if (text === undefined) return { design: null, ui: { ...ui, status: 'pick' }, changed: false }
  const parsed = parseDesign(text)
  if (!parsed.ok) return { design: null, ui: { ...ui, status: 'error', error: parsed.error }, changed: false }
  return { design: parsed.design, ui: { ...ui, status: 'ready', selectedId: parsed.design.nodes[0]?.id ?? null }, changed: false }
}

/** Starts the design from a template (or blank), named after the file. Only from the picker. */
export function startDesign(ui: DesignUi, templateId: string): Step {
  if (ui.status !== 'pick') return { design: null, ui, changed: false }
  const template = TEMPLATES.find(one => one.id === templateId)
  const design: Design = template ? { ...template.make(), name: ui.name } : emptyDesign(ui.name)
  return {
    design,
    ui: { ...ui, status: 'ready', error: null, notice: null, selectedId: design.nodes[0]?.id ?? null, rev: ui.rev + 1 },
    changed: true,
  }
}

function settle(design: Design, ui: DesignUi, result: OpResult, selectedId: string | null): Step {
  if (result.error) return { design, ui: { ...ui, notice: result.error }, changed: false }
  const kept = selectedId !== null && findNode(result.design, selectedId) ? selectedId : null
  return { design: result.design, ui: { ...ui, selectedId: kept, notice: null }, changed: result.design !== design }
}

/** Applies one message from the canvas. A refused edit leaves the design as it was and sets `notice`. */
export function applyMessage(design: Design | null, ui: DesignUi, message: CanvasMessage): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  switch (message.kind) {
    case 'select':
      return { design, ui: { ...ui, selectedId: message.id !== null && findNode(design, message.id) ? message.id : null }, changed: false }
    case 'edit':
      return { design, ui: { ...ui, selectedId: findNode(design, message.id) ? message.id : ui.selectedId }, changed: false }
    case 'toggleCard':
      return { design, ui: { ...ui, showCard: !ui.showCard }, changed: false }
    case 'move': {
      const result = message.to
        ? moveNode(design, message.id, message.to)
        : moveBy(design, message.id, message.delta ?? 0, { collapsed: message.collapsed ?? [] })
      return settle(design, ui, result, message.id)
    }
    case 'add': {
      const result = addNode(design, { type: message.type }, message.at)
      const step = settle(design, ui, result, result.id ?? ui.selectedId)
      return result.error ? step : { ...step, ui: { ...step.ui, rev: ui.rev + 1 } }
    }
    case 'remove': {
      const next = message.select === undefined ? (ui.selectedId === message.id ? null : ui.selectedId) : message.select
      return settle(design, ui, removeNode(design, message.id), next)
    }
  }
}

/** An inspector edit of one node. */
export function patchNode(design: Design | null, ui: DesignUi, id: string, patch: NodePatch): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  return settle(design, ui, updateNode(design, id, patch), ui.selectedId)
}

const AGENT_LIKE: readonly NodeType[] = ['agent', 'verify', 'judge-panel', 'loop-until-dry', 'sweep', 'critic']

/** Which knob pickers the inspector shows for a type: the ones a script could honour there. */
export function knobFields(type: NodeType): { model: boolean; effort: boolean; isolation: boolean } {
  const spawns = AGENT_LIKE.includes(type)
  return { model: spawns, effort: spawns, isolation: type === 'agent' }
}

/** The Select value that clears a knob. */
export const INHERIT = 'inherit'
export const MODEL_CHOICES: readonly string[] = ['haiku', 'sonnet', 'opus']

/** What the canvas gets as props. */
export function canvasProps(design: Design, ui: DesignUi, maxRows = 0): CanvasProps {
  return {
    design,
    lints: lint(design).map(one => ({ nodeId: one.nodeId, message: one.message })),
    mode: 'design',
    selectedId: ui.selectedId,
    rev: ui.rev,
    maxRows,
  }
}
