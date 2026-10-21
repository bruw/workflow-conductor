// The keys: the one table that says what each character typed into the key catcher does, and the legend drawn from it.
// Case matters: `w` moves the selection, `W` the block. No `$`, no engine imports.

/** The graph sends the same keys in its `key` messages. */
export type KeyOp =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'moveLeft'
  | 'moveRight'
  | 'moveUp'
  | 'moveDown'
  | 'edit'
  | 'add'
  | 'remove'
  | 'retype'
  | 'knob1'
  | 'knob2'
  | 'open'
  | 'back'
  | 'detail'
  | 'undo'
  | 'redo'
  | 'review'
  | 'run'
  | 'clearRun'
  | 'projects'
  | 'help'
  | 'minimize'
  | 'overwrite'
  /** No key of its own: the add list's `cancel`. */
  | 'cancel'

/** The catcher's `submit`, the graph's `return`. */
export const ENTER = 'enter'

export const KEY_OPS: Record<string, KeyOp> = {
  w: 'up',
  a: 'left',
  s: 'down',
  d: 'right',
  W: 'moveUp',
  A: 'moveLeft',
  S: 'moveDown',
  D: 'moveRight',
  [ENTER]: 'edit',
  e: 'edit',
  n: 'add',
  '+': 'add',
  x: 'remove',
  t: 'retype',
  '1': 'knob1',
  '2': 'knob2',
  o: 'open',
  b: 'back',
  i: 'detail',
  u: 'undo',
  y: 'redo',
  q: 'review',
  r: 'run',
  c: 'clearRun',
  p: 'projects',
  '?': 'help',
  h: 'help',
  m: 'minimize',
  f: 'overwrite',
}

/** One key both minimizes the pane and expands the band. */
export const MINIMIZE_KEYS = 'm'

/** Letter keys act only once the band or the pane holds the keys, which this engine chord (`abovePrompt:focus`) gives them. */
export const FOCUS_HINT = 'Ctrl+x tab: focus'

/** Characters that arrive at once are keys up to this many; more is a paste. */
export const BURST_MAX = 8

export const PASTE_NOTICE = 'pasted text is not keys: nothing was done'

/** The keys that still act while a run locks the project. */
export const LOCKED_OPS: readonly KeyOp[] = ['left', 'right', 'up', 'down', 'open', 'back', 'detail', 'help', 'clearRun', 'projects', 'minimize']

export function unboundNotice(key: string): string {
  return `${key === ' ' ? 'space' : key} is not a key here`
}

export function burstKeys(text: string): { keys: string[] } | { paste: true } {
  const keys = [...text]
  return keys.length > BURST_MAX ? { paste: true } : { keys }
}

/** Where the ring is: `graph` is the catcher; `start` is the catcher on the start screen and on the list of projects. */
export type RingPlace = 'graph' | 'fields' | 'list' | 'start'

export type LegendState = {
  ring: RingPlace
  /** The add list was opened on a block: `n` changes the place. */
  placed: boolean
  /** The add list picks a block's type, it adds none. */
  retype: boolean
  /** The add list's marked row is a block that has kinds: Enter opens them. */
  opens?: boolean
  /** The add list shows a block's kinds: `b` goes back to the blocks. */
  kinds?: boolean
  /** No block but the start block: nothing to run or to review. */
  empty: boolean
  /** The selected block is the start block: it does not move and is not deleted. */
  fixed?: boolean
  helping: boolean
  locked: boolean
  selected: boolean
  container: boolean
  nested: boolean
  results: boolean
  undo: boolean
  redo: boolean
  /** The detail pane is hidden: the header names the key that shows it. */
  hidden: boolean
  /** A workflow is running, or a replay is on the board: only then does the designer minimize. */
  minimizes?: boolean
  /** The start screen was opened from a project (`p`): `p` goes back to it. */
  back?: boolean
}

/** `core` entries are kept when the room is short. */
export type LegendItem = { keys: string; word: string; core: boolean }

/** `on` while a press does something. */
export type LegendAction = { key: string; word: string; on: boolean }

/** `header` is the graph's and the pane's keys, `detail` the detail pane's; `actions` hand the project to Claude or put a run away. */
export type Legend = { header: LegendItem[]; actions: LegendAction[]; detail: LegendItem[] }

export function legendItems(state: LegendState): Legend {
  const out: LegendItem = { keys: 'Esc', word: 'Keys to the prompt', core: true }
  const save: LegendItem = { keys: 'Enter', word: 'Save, back to the graph', core: true }
  const pages: LegendItem[] = [{ keys: '? h', word: 'Next page', core: true }, { keys: 'x', word: 'Close help', core: true }]
  const help: LegendItem = { keys: '?', word: 'Help', core: true }
  const minimize: LegendAction = { key: MINIMIZE_KEYS, word: 'Minimize', on: true }
  if (state.ring === 'start') {
    const choose: LegendItem[] = [{ keys: '↑ ↓', word: 'Choose', core: true }, { keys: 'Enter', word: 'Open', core: true }]
    const back: LegendItem[] = state.back ? [{ keys: 'p', word: 'Back', core: true }] : []
    // A help page has the detail pane in place of the list: the keys that walk the list still act, and are the header's.
    return state.helping ? { header: choose, actions: [], detail: pages } : { header: [...back, help], actions: state.minimizes ? [minimize] : [], detail: choose }
  }
  const edits = !state.locked
  // In a field and in the add list the letters are text, so the actions wait.
  const ready = edits && !state.empty && state.ring === 'graph'
  const actions: LegendAction[] = [
    { key: 'r', word: 'Implement and Run', on: ready },
    { key: 'q', word: 'Claude Review', on: ready },
    ...(state.results && edits ? [{ key: 'c', word: 'Clear results', on: state.ring === 'graph' }] : []),
  ]
  if (state.ring === 'fields') return { header: [out], actions, detail: [{ keys: '↑ ↓', word: 'Field', core: true }, save] }
  if (state.ring === 'list') {
    return {
      header: [out],
      actions,
      detail: [
        { keys: '↑ ↓', word: 'Choose', core: true },
        ...(state.placed ? [{ keys: 'n', word: 'Change place', core: true }] : []),
        ...(state.kinds ? [{ keys: 'b', word: 'Blocks', core: true }] : []),
        { keys: 'a-z', word: 'Filter', core: false },
        { keys: 'Enter', word: state.opens ? 'Kinds' : state.retype ? 'Set block' : 'Add', core: true },
        { keys: 'x', word: 'Cancel', core: true },
      ],
    }
  }
  if (state.helping) return { header: [{ keys: 'WASD', word: 'Navigate', core: true }], actions, detail: pages }
  if (state.minimizes) actions.push(minimize)
  const moves = edits && state.selected && !state.fixed
  const header: (LegendItem | false)[] = [
    // First, so it is the last to go where the room is short.
    state.hidden && { keys: 'i', word: 'Show details', core: true },
    { keys: 'p', word: 'Projects', core: true },
    // Every project has a card to walk to: its start block.
    moves ? { keys: '⇧+WASD', word: '(Move) Navigate', core: true } : { keys: 'WASD', word: 'Navigate', core: true },
    edits && { keys: 'n', word: 'New', core: true },
    moves && { keys: 'x', word: 'Delete', core: true },
    moves && { keys: 't', word: 'Block', core: false },
    state.container && { keys: 'o', word: 'Open', core: true },
    state.nested && { keys: 'b', word: 'Back', core: true },
    edits && state.undo && { keys: 'u', word: 'Undo', core: false },
    edits && state.redo && { keys: 'y', word: 'Redo', core: false },
    help,
  ]
  // Enter opens the selected block's fields (the Down arrow does too: the help page says so).
  const detail: (LegendItem | false)[] = state.hidden ? [] : [edits && state.selected && { keys: 'Enter', word: 'Edit', core: true }, { keys: 'i', word: 'Hide', core: false }]
  const kept = (items: readonly (LegendItem | false)[]): LegendItem[] => items.filter((one): one is LegendItem => one !== false)
  return { header: kept(header), actions, detail: kept(detail) }
}

export const LEGEND_GAP = 2

/** `[n] New`: the brackets and the space are the 3. */
export function legendCells(item: LegendItem): number {
  return item.keys.length + 3 + item.word.length
}

function fill(items: readonly LegendItem[], width: number): LegendItem[][] {
  const rows: LegendItem[][] = [[]]
  let used = 0
  for (const item of items) {
    const cells = legendCells(item)
    if (used > 0 && used + LEGEND_GAP + cells > width) {
      rows.push([])
      used = 0
    }
    rows[rows.length - 1]?.push(item)
    used += (used > 0 ? LEGEND_GAP : 0) + cells
  }
  return rows
}

/** Short of room, entries that are not `core` go, last first; then `core` ones from the end, but never the last: the way to the help pages, or out. */
export function legendRows(items: readonly LegendItem[], width: number, rows: number): LegendItem[][] {
  let shown = [...items]
  for (;;) {
    const filled = fill(shown, width)
    if (filled.length <= rows) return filled
    const loose = shown.map(one => one.core).lastIndexOf(false)
    const drop = loose >= 0 ? loose : shown.length - 2
    if (drop < 0) return filled.slice(0, rows)
    shown = shown.filter((_, index) => index !== drop)
  }
}
