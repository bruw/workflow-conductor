// What the design pane does to its state, as pure steps: opening a design,
// starting one from a template, and applying a canvas message or an inspector
// edit. The hooks module reads state, calls one of these, writes state and
// saves. Pure TypeScript: no `$`, no engine imports.

import type { CanvasMessage, CanvasProps } from '../ui/canvas-model'
import { lint } from './lints'
import { canHoldChildren, emptyDesign, findNode, flatten, parseDesign, toKebab } from './model'
import type { Design, NodeType } from './model'
import { addNode, moveBy, moveNode, removeNode, updateNode } from './ops'
import type { NodePatch, OpResult, Place } from './ops'
import { fuzzy } from './teach'
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
  /** The node the toolbar's grab holds: j/k move it instead of the selection. */
  grabbedId: string | null
  /** The keyboard's add picker: where the block will go and what was typed. */
  picker: { at: Place; query: string } | null
  /** The container a first `x` asked about; a second `x` on it removes it. */
  confirmId: string | null
}

/** What a toolbar key asks for. The canvas sends the same edits as messages. */
export type ToolbarOp = 'down' | 'up' | 'grab' | 'addAfter' | 'addInside' | 'remove' | 'card' | 'cancel'

export type Step = { design: Design | null; ui: DesignUi; changed: boolean }

export function initialUi(): DesignUi {
  return { name: DEFAULT_DESIGN_NAME, status: 'closed', error: null, selectedId: null, rev: 0, showCard: false, notice: null, grabbedId: null, picker: null, confirmId: null }
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
    case 'select': {
      const selectedId = message.id !== null && findNode(design, message.id) ? message.id : null
      return { design, ui: { ...ui, selectedId, confirmId: null, grabbedId: ui.grabbedId === selectedId ? ui.grabbedId : null }, changed: false }
    }
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

/** Where `a` puts a block: after the selection, as its sibling; at the end with none. */
export function placeAfter(design: Design, selectedId: string | null): Place {
  const row = selectedId === null ? undefined : flatten(design).find(one => one.node.id === selectedId)
  if (!row) return { index: design.nodes.length }
  return row.parentId === undefined ? { index: row.index + 1 } : { parentId: row.parentId, index: row.index + 1 }
}

/** The row the selection lands on once `id` and what it holds are gone: the next one, else the one before. */
function afterRemoval(design: Design, id: string): string | null {
  const rows = flatten(design)
  const at = rows.findIndex(row => row.node.id === id)
  const here = rows[at]
  if (!here) return null
  const next = rows.slice(at + 1).find(row => row.depth <= here.depth)
  return next?.node.id ?? rows[at - 1]?.node.id ?? null
}

/**
 * Applies one toolbar key. The selection and the grab live here so the keys
 * work before the canvas was ever clicked; `rev` tells the canvas to follow.
 */
export function applyOp(design: Design | null, ui: DesignUi, op: ToolbarOp): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  const calm: DesignUi = { ...ui, confirmId: null, notice: null }
  const node = ui.selectedId === null ? undefined : findNode(design, ui.selectedId)
  switch (op) {
    case 'down':
    case 'up': {
      const delta = op === 'down' ? 1 : -1
      if (ui.grabbedId !== null && findNode(design, ui.grabbedId)) {
        const step = settle(design, calm, moveBy(design, ui.grabbedId, delta), ui.grabbedId)
        return { ...step, ui: { ...step.ui, rev: ui.rev + 1 } }
      }
      const rows = flatten(design)
      if (rows.length === 0) return { design, ui: calm, changed: false }
      const at = rows.findIndex(row => row.node.id === ui.selectedId)
      const to = at < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, at + delta))
      return { design, ui: { ...calm, grabbedId: null, selectedId: rows[to]?.node.id ?? null, rev: ui.rev + 1 }, changed: false }
    }
    case 'grab':
      if (!node) return { design, ui: { ...calm, grabbedId: null, notice: 'grab: select a block first' }, changed: false }
      return { design, ui: { ...calm, grabbedId: ui.grabbedId === node.id ? null : node.id }, changed: false }
    case 'addAfter':
      return { design, ui: { ...calm, grabbedId: null, picker: { at: placeAfter(design, node?.id ?? null), query: '' } }, changed: false }
    case 'addInside':
      if (!node) return { design, ui: { ...calm, grabbedId: null, picker: { at: { index: design.nodes.length }, query: '' } }, changed: false }
      if (!canHoldChildren(node.type)) return { design, ui: { ...calm, notice: `${node.id} is a ${node.type}: it holds no blocks; a adds after it` }, changed: false }
      return { design, ui: { ...calm, grabbedId: null, picker: { at: { parentId: node.id, index: node.children?.length ?? 0 }, query: '' } }, changed: false }
    case 'remove': {
      if (!node) return { design, ui: { ...calm, notice: 'delete: select a block first' }, changed: false }
      const held = node.children?.length ?? 0
      if (held > 0 && ui.confirmId !== node.id) {
        const inside = flatten({ ...design, nodes: node.children ?? [] }).length
        return {
          design,
          ui: { ...calm, confirmId: node.id, notice: `${node.id} holds ${inside} ${inside === 1 ? 'block' : 'blocks'}: x again deletes them all (no undo)` },
          changed: false,
        }
      }
      const step = settle(design, { ...calm, grabbedId: null }, removeNode(design, node.id), afterRemoval(design, node.id))
      return { ...step, ui: { ...step.ui, rev: ui.rev + 1 } }
    }
    case 'card':
      return { design, ui: { ...calm, showCard: !ui.showCard }, changed: false }
    case 'cancel':
      return { design, ui: { ...calm, grabbedId: null, picker: null }, changed: false }
  }
}

/** The picker's query as the person types it. */
export function typePicker(ui: DesignUi, query: string): DesignUi {
  return ui.picker ? { ...ui, picker: { ...ui.picker, query } } : ui
}

/** Adds from the open picker: `type` when a match was pressed, else the best match for `query`. */
export function pickBlock(design: Design | null, ui: DesignUi, choice: { type?: NodeType; query?: string }): Step {
  if (!design || ui.status !== 'ready' || !ui.picker) return { design, ui, changed: false }
  const type = choice.type ?? fuzzy(choice.query ?? ui.picker.query)[0]
  if (type === undefined) return { design, ui: { ...ui, notice: 'no block matches that' }, changed: false }
  const step = applyMessage(design, ui, { kind: 'add', type, at: ui.picker.at })
  return step.changed ? { ...step, ui: { ...step.ui, picker: null } } : step
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
