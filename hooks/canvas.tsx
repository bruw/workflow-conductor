import type { ClientModule, JsonValue } from 'claude-code'

import { animateLayout, canvasReduce, canvasTicking, hintLine, initialCanvas, moveCanvas, rowCells, syncCanvas, tickCanvas, viewCanvas, windowCanvas } from '../src/ui/canvas-model'
import type { CanvasInput, CanvasLine, CanvasProps, CanvasState, DesignRow } from '../src/ui/canvas-model'
import { FRAME_MS } from '../src/ui/tween'

// The canvas: a surface module. It owns only transient view state (selection
// cursor, grab, picker query, folds, scroll) and has no `$`: every edit is a
// message posted to hooks/design.tsx, which answers with new props.

const HINT_ROWS = 1
const NAME_WIDTH = 20

// The one shared ticker. It runs only while rows slide or a drag held at an edge
// scrolls: started by the drawing that finds either, stopped by the tick that finds none. The handle and the
// tick's body live here because a drawing's closures are replaced on every
// call; `ticking` in the instance's own state says whether this instance
// started it. One canvas is mounted at a time.
let stopTicker: (() => void) | null = null
let onTick: (() => void) | null = null

const Canvas: ClientModule<JsonValue, CanvasState> = (raw, surface) => {
  const props = raw as unknown as CanvasProps
  const { Box, Text } = surface.elements
  // The region is as tall as what is drawn here, so `surface.rows` only echoes
  // the last drawing; the room there is comes from the pane, as `maxRows`.
  const limit = props.maxRows > 0 ? props.maxRows : surface.rows
  const capacity = limit > 0 ? Math.max(1, limit - HINT_ROWS) : 0
  const columns = surface.columns > 0 ? surface.columns : 80
  const locked = props.mode === 'run'

  let state = syncCanvas(surface.state ?? initialCanvas(), props)

  // Set again on every call (a later listener replaces the earlier one), so it
  // always reduces against the props and state this drawing shows.
  const take = (input: CanvasInput) => {
    const result = canvasReduce(state, input, { design: props.design, capacity, run: props.run, locked })
    if (result.state !== state) {
      state = result.state
      surface.setState(state)
    }
    if (result.post) surface.post(result.post as unknown as JsonValue)
  }
  surface.onKey(event => take({ type: 'key', ...event }))
  surface.onPointer(event => take({ type: 'pointer', event: event.type, x: event.x, y: event.y }))

  // Motion. Rows whose line changed since the last drawing start sliding, and
  // the ticker starts with them. At most one setState per drawing, and none
  // once the lines are as recorded, so a drawing never chains into a loop.
  const scene = viewCanvas(state, props, capacity)
  const moved = moveCanvas(state, scene)
  const start = canvasTicking(moved, { design: props.design, capacity }) && (!moved.ticking || stopTicker === null)
  if (start) {
    stopTicker?.()
    stopTicker = surface.every(FRAME_MS, () => onTick?.())
  }
  const settled: CanvasState = start && !moved.ticking ? { ...moved, ticking: true } : moved
  if (settled !== state) {
    state = settled
    surface.setState(state)
  }
  onTick = () => {
    state = tickCanvas(state, { design: props.design, capacity })
    if (!state.ticking) {
      stopTicker?.()
      stopTicker = null
    }
    surface.setState(state)
  }

  const view = windowCanvas(animateLayout(scene.layout, state), scene.top, capacity)

  const drawRow = (row: DesignRow) => {
    if (row.kind === 'add') {
      return (
        <Text wrap="truncate-end">
          <Text color="subtle">{row.rail}</Text>
          <Text color={row.selected ? 'claude' : 'subtle'} bold={row.selected} inverse={row.selected}>
            {`${row.glyph} ${row.title}`}
          </Text>
        </Text>
      )
    }
    const { run } = row
    const cells = rowCells(row, columns)
    if (row.kind === 'agent') {
      return (
        <Text wrap="truncate-end">
          <Text color="subtle">{row.rail}</Text>
          <Text color={run?.color}>{`${row.glyph} `}</Text>
          <Text color={run?.color === 'error' ? 'error' : undefined}>{cells.name}</Text>
          <Text color="subtle">{cells.tokens}</Text>
        </Text>
      )
    }
    const lit = row.selected || row.grabbed
    // A node the finished run never reached is dim from end to end.
    const dim = run !== undefined && run.note !== ''
    const tint = lit ? 'claude' : dim ? 'inactive' : undefined

    // Hover is the engine's: the row's group lights under the pointer, with no redraw.
    const scope = `conductor-row-${row.id}`

    return (
      <Text wrap="truncate-end" hover={{ scope, bold: true }}>
        <Text color="subtle">{row.rail}</Text>
        <Text color={run && !row.grabbed ? run.color : tint} bold={lit} inverse={row.grabbed} hover={{ scope, color: 'claude' }}>{`${run ? run.glyph : row.glyph} `}</Text>
        <Text color={tint} bold={lit} inverse={lit} hover={{ scope, color: 'claude' }}>{cells.name}</Text>
        <Text color={row.grabbed ? 'claude' : 'subtle'} inverse={row.grabbed}>{`${cells.badge}${cells.fold}`}</Text>
        <Text color="warning">{cells.lint}</Text>
        <Text color="inactive">{cells.type}</Text>
        {cells.note !== '' && <Text color="inactive">{cells.note}</Text>}
        {cells.bar !== '' && <Text color={run?.color}>{cells.bar}</Text>}
        {cells.counts !== '' && <Text color={run?.color}>{cells.counts}</Text>}
        {cells.tokens !== '' && <Text color="subtle">{cells.tokens}</Text>}
      </Text>
    )
  }

  const drawLine = (line: CanvasLine) => {
    if (line.kind === 'row') return drawRow(line.row)
    if (line.kind === 'blank') return <Text> </Text>
    if (line.kind === 'lifted') {
      const { row } = line
      const fold = row.hidden > 0 ? ` [+${row.hidden}]` : ''

      return (
        <Text wrap="truncate-end">
          <Text color="subtle">{line.rail}</Text>
          <Text color="claude" bold inverse>{`${row.glyph} ${row.id}  ${row.title}${row.badge ? `  ${row.badge}` : ''}${fold} `}</Text>
        </Text>
      )
    }
    if (line.kind === 'picker') {
      return (
        <Text wrap="truncate-end">
          <Text color="subtle">{line.rail}</Text>
          <Text color="claude" bold>{`+ ${line.query}`}</Text>
          <Text color="claude" inverse>{' '}</Text>
          {line.query === '' && <Text color="subtle">{' type a block name'}</Text>}
        </Text>
      )
    }
    if (line.kind === 'empty') {
      return (
        <Text wrap="truncate-end">
          <Text color="subtle">{`${line.rail}no block matches`}</Text>
        </Text>
      )
    }

    return (
      <Text wrap="truncate-end">
        <Text color="subtle">{line.rail}</Text>
        <Text color={line.active ? 'claude' : undefined} bold={line.active} inverse={line.active}>
          {`${line.glyph} ${line.name.padEnd(NAME_WIDTH)}`}
        </Text>
        <Text color="subtle">{` ${line.hint}`}</Text>
      </Text>
    )
  }

  // The toolbar shows the keys; this line is only for what is cut off, a drag, or the canvas's own picker.
  const cut = `${view.above > 0 ? `↑${view.above} ` : ''}${view.below > 0 ? `↓${view.below} ` : ''}`
  const under = `${cut}${hintLine(state, scene.dragging)}`

  return (
    <Box flexDirection="column">
      {view.lines.map(drawLine)}
      {under !== '' && <Text color="subtle" wrap="truncate-end">{under}</Text>}
    </Box>
  )
}

export default Canvas
