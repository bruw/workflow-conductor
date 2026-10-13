import type { ClientModule, JsonValue } from 'claude-code'

import { dragHint, dragTarget, dragging, flashGraph, graphFlash, graphLayout, graphOffsets, graphReduce, graphTicking, initialGraph, moveGraph, syncGraph, tickGraph } from '../src/ui/graph-model'
import type { GraphContext, GraphInput, GraphProps, GraphState } from '../src/ui/graph-model'
import { paintGraph, paintWeight } from '../src/ui/graph-paint'
import type { GraphPaintOptions, Span } from '../src/ui/graph-paint'
import { FRAME_MS } from '../src/ui/tween'
import { TEXT } from '../src/ui/theme'

// The graph, a surface module: it owns only transient view state (the pan, a drag in flight, the hover, cards sliding) and has no `$`.
// Every click, drop and key is a message posted to hooks/project.tsx, which answers with new props.

/** Past this the graph is drawn without colours: fewer spans, a smaller tree. */
const WEIGHT_MAX = 70_000

// The one shared ticker: started by the drawing that finds cards sliding, a mark showing or a drag panning at an edge, stopped by the tick that finds none.
// Its handle and the tick's body are module variables because a drawing's closures are replaced on every call; one graph is mounted at a time.
let stopTicker: (() => void) | null = null
let onTick: (() => void) | null = null

const Graph: ClientModule<JsonValue, GraphState> = (raw, surface) => {
  const props = raw as unknown as GraphProps
  const { Box, Text } = surface.elements
  // The cards are laid out for the columns the hooks module walks them in (`props.columns`): never wider than the
  // region, and centred in one that is wider than the graph is ever drawn.
  const columns = props.columns > 0 ? props.columns : surface.columns > 0 ? surface.columns : 80
  const rows = Math.max(1, props.rows > 0 ? props.rows : 12)
  const pad = Math.max(0, Math.floor((surface.columns - columns) / 2))
  const locked = props.mode === 'run'
  const layout = graphLayout({ ...props, columns, rows })
  const context: GraphContext = { layout, columns, rows, selectedId: props.selectedId, locked, hold: props.hold === true, wheel: props.wheel }

  const held = surface.state ?? initialGraph()
  let state = syncGraph(held, context)

  // Set again on every call (a later listener replaces the earlier one), so it reduces against the props and state this drawing shows.
  const take = (input: GraphInput) => {
    const result = graphReduce(state, input, context)
    if (result.state !== state) {
      state = result.state
      surface.setState(state)
    }
    if (result.post) surface.post(result.post as unknown as JsonValue)
  }
  surface.onKey(event => take({ type: 'key', ...event }))
  surface.onPointer(event => take({ type: 'pointer', event: event.type, x: event.x - pad, y: event.y }))

  // At most one setState per drawing, and none once the places are as recorded, so a drawing never chains into a loop.
  // The wheel's rows come with the props: the pan they left is kept, or the next drawing would take them again.
  const moved = moveGraph(flashGraph(state, props.flash), layout)
  const start = graphTicking(moved, context) && (!moved.ticking || stopTicker === null)
  if (start) {
    stopTicker?.()
    stopTicker = surface.every(FRAME_MS, () => onTick?.())
  }
  const settled: GraphState = start && !moved.ticking ? { ...moved, ticking: true } : moved
  if (settled !== state || state.wheel !== held.wheel) {
    state = settled
    surface.setState(state)
  }
  onTick = () => {
    state = tickGraph(state, context)
    if (!state.ticking) {
      stopTicker?.()
      stopTicker = null
    }
    surface.setState(state)
  }

  const inHand = dragging(state)
  const options: GraphPaintOptions = {
    columns,
    rows,
    panY: state.panY,
    run: props.run,
    locked,
    emptyNote: props.emptyNote,
    hoverAt: state.hover,
    drag: inHand !== null && state.drag?.kind === 'card' ? { id: inHand, target: dragTarget(state, context), x: state.drag.x, y: state.drag.y, hint: dragHint(state, context) } : null,
    offsets: graphOffsets(state),
    flash: graphFlash(state),
    quiet: props.quiet === true,
  }
  let lines = paintGraph(layout, options)
  if (paintWeight(lines) > WEIGHT_MAX) lines = paintGraph(layout, { ...options, plain: true })

  const drawSpan = (span: Span) => (
    <Text
      color={span.color ?? TEXT}
      backgroundColor={span.ground}
      bold={span.bold}
      inverse={span.inverse}
      hover={span.hover}
    >
      {span.text}
    </Text>
  )

  return (
    <Box flexDirection="column" paddingLeft={pad}>
      {lines.map(line => (
        <Box flexDirection="row">{line.map(drawSpan)}</Box>
      ))}
    </Box>
  )
}

export default Graph
