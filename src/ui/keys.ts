// The keys: the one table that says what each character typed into the key
// catcher does, and the legend drawn from it: the graph's keys in the footer,
// the detail pane's on its last rows. Case matters: `w` moves the selection,
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
  | 'help'
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
  '?': 'help',
  h: 'help',
}

/** Characters that arrive at once are keys up to this many; more is a paste. */
export const BURST_MAX = 8

/** What is said of a paste. */
export const PASTE_NOTICE = 'pasted text is not keys: nothing was done'

/** The keys that still act while a run locks the design. */
export const LOCKED_OPS: readonly KeyOp[] = ['left', 'right', 'up', 'down', 'open', 'back', 'detail', 'help', 'clearRun']

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

/** Where the ring is: on the catcher (`graph`), in a field of the block, in the add list's filter; `start` is the catcher on the start screen. */
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
  /** The design holds no block of its own (the start block alone): nothing to run or to review. */
  empty: boolean
  /** The selected block is the start block: it does not move and is not deleted. */
  fixed?: boolean
  /** A help page is open: `x` closes it, it deletes nothing. */
  helping: boolean
  /** A run locks the design. */
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
  /** The quick knobs of the selected block, by digit: its name, or null where its type has none. */
  knobs: readonly (string | null)[]
  /** The detail pane is hidden: it has no rows to name its keys on, and the footer names the one that shows it. */
  hidden: boolean
}

/** One entry: the key as drawn in brackets, its word, and whether it is among the ones kept when the room is short. */
export type LegendItem = { keys: string; word: string; core: boolean }

/**
 * The keys that work now, each named in one place: the graph's and the pane's own in the footer, the ones that act
 * on the detail pane on its last rows.
 */
export type Legend = { footer: LegendItem[]; detail: LegendItem[] }

/** The keys that work now, in their fixed order. */
export function legendItems(state: LegendState): Legend {
  const out: LegendItem = { keys: 'Esc', word: 'Keys to the prompt', core: true }
  const save: LegendItem = { keys: 'Enter', word: 'Save, back to the graph', core: true }
  const pages: LegendItem[] = [{ keys: '? h', word: 'Next page', core: true }, { keys: 'x', word: 'Close help', core: true }]
  // In a field and in the add list's filter the letters are text: no key of the graph acts, and the footer names the one way out.
  if (state.ring === 'fields') return { footer: [out], detail: [{ keys: 'Tab', word: 'Next field', core: true }, { keys: 'Shift+Tab', word: 'Previous', core: true }, save] }
  if (state.ring === 'list') {
    return {
      footer: [out],
      detail: [
        { keys: 'w s', word: 'Choose', core: true },
        ...(state.placed ? [{ keys: 'n', word: 'Change place', core: true }] : []),
        ...(state.kinds ? [{ keys: 'b', word: 'Blocks', core: true }] : []),
        { keys: 'a-z', word: 'Filter', core: false },
        { keys: 'Enter', word: state.opens ? 'Kinds' : state.retype ? 'Set block' : 'Add', core: true },
        { keys: 'x', word: 'Cancel', core: true },
      ],
    }
  }
  if (state.ring === 'start') {
    const choose: LegendItem[] = [{ keys: 'w s', word: 'Choose', core: true }, { keys: 'Enter', word: 'Open', core: true }]
    // A help page has the detail pane in place of the list: the keys that walk the list still act, and are the footer's.
    return state.helping ? { footer: choose, detail: pages } : { footer: [{ keys: '?', word: 'Help', core: true }], detail: choose }
  }
  // A help page has the detail pane: the keys that turn and close it are its own, and `x` deletes nothing.
  if (state.helping) return { footer: [{ keys: 'WASD', word: 'Navigate', core: true }], detail: pages }
  const edits = !state.locked
  const footer: (LegendItem | false)[] = [
    // With no detail pane to say it, the footer names the one key that brings it back, first: it is the last to go where the room is short.
    state.hidden && { keys: 'i', word: 'Show details', core: true },
    // Every design has a card to walk to: its start block.
    { keys: 'WASD', word: 'Navigate', core: true },
    edits && state.selected && !state.fixed && { keys: 'Shift+WASD', word: 'Move', core: true },
    edits && { keys: 'n', word: 'New', core: true },
    edits && state.selected && !state.fixed && { keys: 'x', word: 'Delete', core: true },
    ...state.knobs.map((name, index) => edits && name !== null && { keys: String(index + 1), word: name, core: false }),
    state.container && { keys: 'o', word: 'Open', core: true },
    state.nested && { keys: 'b', word: 'Back', core: true },
    edits && state.undo && { keys: 'u', word: 'Undo', core: false },
    edits && state.redo && { keys: 'y', word: 'Redo', core: false },
    edits && !state.empty && { keys: 'q', word: 'Ask Claude', core: false },
    edits && !state.empty && { keys: 'r', word: 'Run', core: true },
    state.results && !state.locked && { keys: 'c', word: 'Clear results', core: false },
    { keys: '?', word: 'Help', core: true },
  ]
  // Enter opens the selected block's fields (Tab does too: the help page says so).
  const detail: (LegendItem | false)[] = state.hidden ? [] : [edits && state.selected && { keys: 'Enter', word: 'Edit', core: true }, { keys: 'i', word: 'Hide', core: false }]
  const kept = (items: readonly (LegendItem | false)[]): LegendItem[] => items.filter((one): one is LegendItem => one !== false)
  return { footer: kept(footer), detail: kept(detail) }
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

/**
 * The widest the footer's legend is with its `core` keys alone, whatever is selected: a pane with this many columns
 * names its keys on one row; a narrower one wraps them onto a second.
 */
export const LEGEND_CORE_W = legendWidth(
  legendItems({ ring: 'graph', placed: false, retype: false, empty: false, helping: false, locked: false, selected: true, container: true, nested: true, results: true, undo: true, redo: true, knobs: [], hidden: true }).footer.filter(one => one.core),
)

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
