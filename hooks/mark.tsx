import type { ClientModule, JsonValue } from 'claude-code'

import { FADE_MS, HOLD_MS, MARK_STATES, markAt, markFrame, markPalette, nudged } from '../src/ui/mark'

// The header's mark, a surface module that posts nothing: it cycles on its own clock and redraws only its cells.
// `nudge` grows by one on each key that moves the selection; a new value starts the next fade at once.

type MarkProps = { nudge?: number; theme?: string }
/** `state` and `since` place the cycle: `now - since` ms into `state`. */
type MarkState = { state: number; since: number; nudge: number; frame: number }

/** Often enough for a fade to look smooth; a frame that changes nothing is not drawn. */
const TICK_MS = 64

const Mark: ClientModule<JsonValue, MarkState> = (raw, surface) => {
  // On a reload one frame of props can come in another shape: they are read defensively.
  const props: MarkProps = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as MarkProps) : {}
  const nudge = typeof props.nudge === 'number' ? props.nudge : 0
  const { Box, Text } = surface.elements
  const now = Date.now()
  const held = surface.state ?? { state: 0, since: now, nudge, frame: 0 }

  if (surface.state === undefined) {
    surface.setState(held)
    // Read through `surface`, which every call shares: this closure outlives the drawing that made it.
    surface.every(TICK_MS, () => {
      const at = surface.state
      if (!at) return
      const ms = Date.now() - at.since
      const into = ms % (HOLD_MS + FADE_MS)
      // Only a fade, and the frame that ends one, changes what is drawn.
      if (into > HOLD_MS || into < TICK_MS) surface.setState({ ...at, frame: at.frame + 1 })
    })
  }
  let current = held
  if (nudge !== held.nudge) {
    const next = nudged(held.state, now - held.since)
    current = { state: next.state, since: now - next.ms, nudge, frame: held.frame }
    surface.setState(current)
  }

  const at = markAt(current.state, now - current.since)
  const lines = markFrame(at.state % MARK_STATES, at.t, markPalette(props.theme))

  return (
    <Box flexDirection="column">
      {lines.map(line => (
        <Box flexDirection="row" height={1} flexShrink={0}>
          {line.map(span => (span.color === undefined ? <Text>{span.text}</Text> : <Text color={span.color}>{span.text}</Text>))}
        </Box>
      ))}
    </Box>
  )
}

export default Mark
