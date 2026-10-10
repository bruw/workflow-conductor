import type { ClientModule, JsonValue } from 'claude-code'

import { buildDesignRows, canvasReduce, hintLine, initialCanvas, layoutCanvas, syncCanvas, windowCanvas } from '../src/ui/canvas-model'
import type { CanvasLine, CanvasProps, CanvasState, DesignRow } from '../src/ui/canvas-model'
import { GLYPH } from '../src/ui/theme'

// The canvas: a surface module. It owns only transient view state (selection
// cursor, grab, picker query, folds, scroll) and has no `$`: every edit is a
// message posted to hooks/design.tsx, which answers with new props.

const HINT_ROWS = 1
const TYPE_COLUMN_MIN = 26
const TYPE_COLUMN_MAX = 44
const NAME_WIDTH = 20

const Canvas: ClientModule<JsonValue, CanvasState> = (raw, surface) => {
  const props = raw as unknown as CanvasProps
  const { Box, Text } = surface.elements
  // The region is as tall as what is drawn here, so `surface.rows` only echoes
  // the last drawing; the room there is comes from the pane, as `maxRows`.
  const limit = props.maxRows > 0 ? props.maxRows : surface.rows
  const capacity = limit > 0 ? Math.max(1, limit - HINT_ROWS) : 0
  const columns = surface.columns > 0 ? surface.columns : 80
  const typeColumn = Math.max(TYPE_COLUMN_MIN, Math.min(TYPE_COLUMN_MAX, columns - 18))

  let state = syncCanvas(surface.state ?? initialCanvas(), props)

  // Set again on every call (a later listener replaces the earlier one), so it
  // always reduces against the props and state this drawing shows.
  surface.onKey(event => {
    if (props.mode !== 'design') return
    const result = canvasReduce(state, { type: 'key', ...event }, { design: props.design, capacity })
    if (result.state !== state) {
      state = result.state
      surface.setState(state)
    }
    if (result.post) surface.post(result.post as unknown as JsonValue)
  })

  const rows = buildDesignRows(props.design, {
    selectedId: state.selectedId,
    grabbedId: state.grabbedId,
    collapsed: state.collapsed,
    lints: props.lints,
  })
  const view = windowCanvas(layoutCanvas(rows, state.picker), state.top, capacity)

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
    const fold = row.collapsed ? ` [+${row.hidden}]` : ''
    const badge = row.badge ? `  ${row.badge}` : ''
    const lint = row.lint ? ` ${GLYPH.lint}` : ''
    const used = row.rail.length + 2 + row.id.length + 2 + row.title.length + badge.length + fold.length + lint.length
    const gap = ' '.repeat(Math.max(2, typeColumn - used))
    const lit = row.selected || row.grabbed

    return (
      <Text wrap="truncate-end">
        <Text color="subtle">{row.rail}</Text>
        <Text color={lit ? 'claude' : undefined} bold={lit} inverse={row.grabbed}>{`${row.glyph} `}</Text>
        <Text color={lit ? 'claude' : undefined} bold={lit} inverse={lit}>{`${row.id}  ${row.title}`}</Text>
        <Text color={row.grabbed ? 'claude' : 'subtle'} inverse={row.grabbed}>{`${badge}${fold}`}</Text>
        <Text color="warning">{lint}</Text>
        <Text color="inactive">{`${gap}${row.typeName}`}</Text>
      </Text>
    )
  }

  const drawLine = (line: CanvasLine) => {
    if (line.kind === 'row') return drawRow(line.row)
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

  const selected = rows.find(row => row.selected)
  const cut = `${view.above > 0 ? `↑${view.above} ` : ''}${view.below > 0 ? `↓${view.below} ` : ''}`

  return (
    <Box flexDirection="column">
      {view.lines.map(drawLine)}
      <Text color="subtle" wrap="truncate-end">{`${cut}${hintLine(state, selected)}`}</Text>
    </Box>
  )
}

export default Canvas
