// The keys: the one table that says what each character typed into the key
// catcher does, and the legend drawn from it: the graph's keys in the header,
// the hand-off and the review as buttons on the last row, the detail pane's on its
// last rows. Case matters: `w` moves the selection,
// `W` the block. Pure TypeScript: no `$`, no engine imports.

/** What a key asks for. The graph sends the same keys in its `key` messages. */
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
  /** No key of its own: the add list's `cancel`. */
  | 'cancel'

/** Enter, as the table names it: the catcher's `submit`, the graph's `return`. */
export const ENTER = 'enter'

/** Every key, by the character typed. */
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
}

/** The key that minimizes the pane into the band above the prompt, and expands the band into the pane: one key for both. */
export const MINIMIZE_KEYS = 'm'

/** Characters that arrive at once are keys up to this many; more is a paste. */
export const BURST_MAX = 8

/** What is said of a paste. */
export const PASTE_NOTICE = 'pasted text is not keys: nothing was done'

/** The keys that still act while a run locks the project. */
export const LOCKED_OPS: readonly KeyOp[] = ['left', 'right', 'up', 'down', 'open', 'back', 'detail', 'help', 'clearRun', 'projects', 'minimize']

/** What a key the table does not hold says. */
export function unboundNotice(key: string): string {
  return `${key === ' ' ? 'space' : key} is not a key here`
}

/** What a burst typed at once is: the keys to apply in order, or a paste. */
export function burstKeys(text: string): { keys: string[] } | { paste: true } {
  const keys = [...text]
  return keys.length > BURST_MAX ? { paste: true } : { keys }
}

// ---------------------------------------------------------------------------
// The legend

/** Where the ring is: on the catcher (`graph`), in a field of the block, in the add list's filter; `start` is the catcher on the start screen and on the list of projects. */
export type RingPlace = 'graph' | 'fields' | 'list' | 'start'

/** What decides which keys work right now. */
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
  /** The project holds no block of its own (the start block alone): nothing to run or to review. */
  empty: boolean
  /** The selected block is the start block: it does not move and is not deleted. */
  fixed?: boolean
  /** A help page is open: `x` closes it, it deletes nothing. */
  helping: boolean
  /** A run locks the project. */
  locked: boolean
  /** A block is selected. */
  selected: boolean
  /** The selected block holds blocks: `o` opens it. */
  container: boolean
  /** The view is inside a container: `b` goes up. */
  nested: boolean
  /** The results of a run are shown: `c` puts them away. */
  results: boolean
  undo: boolean
  redo: boolean
  /** The detail pane is hidden: it has no rows to name its keys on, and the header names the one that shows it. */
  hidden: boolean
  /** The start screen was opened from a project (`p`): `p` goes back to it. */
  back?: boolean
  /** The start screen's marked row is a saved project: it can be renamed and deleted there. */
  saved?: boolean
  /** A saved project's name is being typed on the start screen. */
  renaming?: boolean
}

/** One entry: the key as drawn in brackets, its word, and whether it is among the ones kept when the room is short. */
export type LegendItem = { keys: string; word: string; core: boolean }

/** A key drawn as a button on the pane's last row: `on` while a press does something. */
export type LegendAction = { key: string; word: string; on: boolean }

/**
 * The keys that work now, each named in one place: the graph's and the pane's own on the header's second row, the
 * ones that act on the detail pane on its last rows. `actions` are the keys that hand the project to Claude or put a
 * run away, not edits of it: buttons on the pane's last row.
 */
export type Legend = { header: LegendItem[]; actions: LegendAction[]; detail: LegendItem[] }

/** The keys that work now, in their fixed order. */
export function legendItems(state: LegendState): Legend {
  const out: LegendItem = { keys: 'Esc', word: 'Keys to the prompt', core: true }
  const save: LegendItem = { keys: 'Enter', word: 'Save, back to the graph', core: true }
  const pages: LegendItem[] = [{ keys: '? h', word: 'Next page', core: true }, { keys: 'x', word: 'Close help', core: true }]
  const help: LegendItem = { keys: '?', word: 'Help', core: true }
  const minimize: LegendItem = { keys: MINIMIZE_KEYS, word: 'Minimize', core: false }
  if (state.ring === 'start') {
    const choose: LegendItem[] = [{ keys: '↑ ↓', word: 'Choose', core: true }, { keys: 'Enter', word: 'Open', core: true }]
    const back: LegendItem[] = state.back ? [{ keys: 'p', word: 'Back', core: true }] : []
    // The name's field has the letters: the one way out, and what Enter does.
    if (state.renaming) return { header: [out], actions: [], detail: [{ keys: 'Enter', word: 'Rename', core: true }, { keys: '↑ ↓', word: 'Cancel', core: true }] }
    // A saved project is renamed and deleted where it is listed.
    const row: LegendItem[] = state.saved ? [{ keys: 'e', word: 'Rename', core: true }, { keys: 'x', word: 'Delete', core: true }] : []
    // A help page has the detail pane in place of the list: the keys that walk the list still act, and are the header's.
    return state.helping ? { header: choose, actions: [], detail: pages } : { header: [...back, minimize, help], actions: [], detail: [...choose, ...row] }
  }
  const edits = !state.locked
  // The run and the review are asked of Claude, not done to the project: they are pressed on the last row. In a field
  // and in the add list the letters are text, and they wait.
  const ready = edits && !state.empty && state.ring === 'graph'
  const actions: LegendAction[] = [
    { key: 'r', word: 'Implement and Run', on: ready },
    { key: 'q', word: 'Claude Review', on: ready },
    ...(state.results && edits ? [{ key: 'c', word: 'Clear results', on: state.ring === 'graph' }] : []),
  ]
  // In a field and in the add list's filter the letters are text: no key of the graph acts, and the header names the one way out.
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
  // A help page has the detail pane: the keys that turn and close it are its own, and `x` deletes nothing.
  if (state.helping) return { header: [{ keys: 'WASD', word: 'Navigate', core: true }], actions, detail: pages }
  const moves = edits && state.selected && !state.fixed
  const header: (LegendItem | false)[] = [
    // With no detail pane to say it, the header names the one key that brings it back, first: it is the last to go where the room is short.
    state.hidden && { keys: 'i', word: 'Show details', core: true },
    // The projects: the one shown is changed for another there.
    { keys: 'p', word: 'Projects', core: true },
    // Every project has a card to walk to: its start block. With Shift the same keys move the block, where it can move.
    moves ? { keys: '⇧+WASD', word: '(Move) Navigate', core: true } : { keys: 'WASD', word: 'Navigate', core: true },
    edits && { keys: 'n', word: 'New', core: true },
    moves && { keys: 'x', word: 'Delete', core: true },
    moves && { keys: 't', word: 'Block', core: false },
    state.container && { keys: 'o', word: 'Open', core: true },
    state.nested && { keys: 'b', word: 'Back', core: true },
    edits && state.undo && { keys: 'u', word: 'Undo', core: false },
    edits && state.redo && { keys: 'y', word: 'Redo', core: false },
    minimize,
    help,
  ]
  // Enter opens the selected block's fields (the Down arrow does too: the help page says so).
  const detail: (LegendItem | false)[] = state.hidden ? [] : [edits && state.selected && { keys: 'Enter', word: 'Edit', core: true }, { keys: 'i', word: 'Hide', core: false }]
  const kept = (items: readonly (LegendItem | false)[]): LegendItem[] => items.filter((one): one is LegendItem => one !== false)
  return { header: kept(header), actions, detail: kept(detail) }
}

/** Cells between two entries of a legend row. */
export const LEGEND_GAP = 2

/** The cells one entry takes: `[n] New`. */
export function legendCells(item: LegendItem): number {
  return item.keys.length + 3 + item.word.length
}

/** The cells a row of entries takes, the gaps between them counted. */
export function legendWidth(row: readonly LegendItem[]): number {
  return row.reduce((sum, item) => sum + legendCells(item), 0) + LEGEND_GAP * Math.max(0, row.length - 1)
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

/**
 * A legend as at most `rows` rows no wider than `width`, in the items' order. Where they do
 * not all fit, the ones that are not `core` are left out, last first; the help pages name every key.
 * Short of room for the `core` ones too, they go from the end, but for the last: the way to the help pages, or out.
 */
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
