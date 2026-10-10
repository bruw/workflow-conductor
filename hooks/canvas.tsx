import type { ClientModule, JsonValue } from 'claude-code'

import { boardLayout, boardOffsets, boardReduce, boardTicking, dragHint, dragTarget, dragging, initialBoard, moveBoard, syncBoard, tickBoard } from '../src/ui/board-model'
import type { BoardContext, BoardInput, BoardProps, BoardState } from '../src/ui/board-model'
import { paintBoard, paintWeight } from '../src/ui/board-paint'
import type { PaintOptions, Span } from '../src/ui/board-paint'
import { FRAME_MS } from '../src/ui/tween'

// The flow board: a surface module. It owns only transient view state (the pan,
// a drag in flight, the slot under the pointer, cards sliding) and has no `$`: every click, drop and key is
// a message posted to hooks/design.tsx, which answers with new props.

/** Past this the board is drawn without colours: fewer spans, a smaller tree. */
const WEIGHT_MAX = 70_000

// The one shared ticker. It runs only while cards slide or a drag held at an
// edge pans: started by the drawing that finds either, stopped by the tick that
// finds none. The handle and the tick's body live here because a drawing's
// closures are replaced on every call; `ticking` in the instance's own state
// says whether this instance started it. One board is mounted at a time.
let stopTicker: (() => void) | null = null
let onTick: (() => void) | null = null

const Board: ClientModule<JsonValue, BoardState> = (raw, surface) => {
  const props = raw as unknown as BoardProps
  const { Box, Text } = surface.elements
  // The region is as wide as the pane lays it out; before the first layout the pane's own count stands in.
  // The cards are laid out for the pane's count (`props.columns`), which the hooks module sized the region from.
  const columns = surface.columns > 0 ? surface.columns : props.columns > 0 ? props.columns : 80
  const rows = Math.max(1, props.rows > 0 ? props.rows : 12)
  const locked = props.mode === 'run'
  const layout = boardLayout(props)
  const context: BoardContext = { layout, columns, rows, selectedId: props.selectedId, confirmId: props.confirmId, locked }

  let state = syncBoard(surface.state ?? initialBoard(), context)

  // Set again on every call (a later listener replaces the earlier one), so it
  // always reduces against the props and state this drawing shows.
  const take = (input: BoardInput) => {
    const result = boardReduce(state, input, context)
    if (result.state !== state) {
      state = result.state
      surface.setState(state)
    }
    if (result.post) surface.post(result.post as unknown as JsonValue)
  }
  surface.onKey(event => take({ type: 'key', ...event }))
  surface.onPointer(event => take({ type: 'pointer', event: event.type, x: event.x, y: event.y }))

  // Motion. Cards whose place changed since the last drawing start sliding, and
  // the ticker starts with them. At most one setState per drawing, and none
  // once the places are as recorded, so a drawing never chains into a loop.
  const moved = moveBoard(state, layout)
  const start = boardTicking(moved, context) && (!moved.ticking || stopTicker === null)
  if (start) {
    stopTicker?.()
    stopTicker = surface.every(FRAME_MS, () => onTick?.())
  }
  const settled: BoardState = start && !moved.ticking ? { ...moved, ticking: true } : moved
  if (settled !== state) {
    state = settled
    surface.setState(state)
  }
  onTick = () => {
    state = tickBoard(state, context)
    if (!state.ticking) {
      stopTicker?.()
      stopTicker = null
    }
    surface.setState(state)
  }

  const held = dragging(state)
  const options: PaintOptions = {
    columns,
    rows,
    panX: state.panX,
    panY: state.panY,
    selectedId: props.selectedId,
    grabbedId: props.grabbedId,
    confirmId: props.confirmId,
    pickerAt: props.pickerAt,
    lints: new Set(props.lints.map(one => one.nodeId)),
    run: props.run,
    locked,
    hoverAt: state.hover,
    drag: held !== null && state.drag?.kind === 'card' ? { id: held, target: dragTarget(state, context), x: state.drag.x, y: state.drag.y, hint: dragHint(state, context) } : null,
    offsets: boardOffsets(state),
  }
  let lines = paintBoard(layout, options)
  if (paintWeight(lines) > WEIGHT_MAX) lines = paintBoard(layout, { ...options, plain: true })

  const drawSpan = (span: Span) => (
    <Text
      color={span.color}
      bold={span.bold}
      inverse={span.inverse}
      hover={span.hover === undefined ? undefined : { scope: span.hover, color: 'claude', bold: true, inverse: true }}
    >
      {span.text}
    </Text>
  )

  return (
    <Box flexDirection="column">
      {lines.map(line => (
        <Box flexDirection="row">{line.map(drawSpan)}</Box>
      ))}
    </Box>
  )
}

export default Board
