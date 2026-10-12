import type { ClientModule, JsonValue } from 'claude-code'

// The goal's rows under the header: a surface module, so that a click on them
// is heard. It draws the rows it is given and posts the click to
// hooks/design.tsx, which opens the goal's field as `g` does. It is no Button:
// a Button is a stop of the pane's ring, and Tab from the graph would land on
// it before the title.

type GoalProps = { label: string; rows: string[]; dim: boolean; faded: string }

/** Under the pointer the goal reads as what can be pressed. */
const HOVER = { scope: 'conductor-goal', color: 'claude' } as const

/** The button went down on the goal: released on it too, the click is posted. */
let held = false

const Goal: ClientModule<JsonValue> = (raw, surface) => {
  // On a reload one frame of props can come in another shape: they are read defensively.
  const props: Partial<GoalProps> = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Partial<GoalProps>) : {}
  const rows = Array.isArray(props.rows) ? props.rows : []
  const label = typeof props.label === 'string' ? props.label : ''
  const { Box, Text } = surface.elements

  surface.onPointer(event => {
    if (event.type === 'down') held = true
    if (event.type !== 'up') return
    // The pointer is held past the region's edges until the button comes up: a release out there is no click.
    const inside = event.x >= 0 && event.x < surface.columns && event.y >= 0 && event.y < rows.length
    if (held && inside) surface.post({ kind: 'goal' })
    held = false
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => (
        <Box flexDirection="row">
          <Text bold hover={HOVER}>{index === 0 ? label : ' '.repeat(label.length)}</Text>
          <Text color={props.dim ? props.faded : undefined} hover={HOVER}>{row}</Text>
        </Box>
      ))}
    </Box>
  )
}

export default Goal
