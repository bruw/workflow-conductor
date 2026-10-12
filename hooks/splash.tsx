import type { ClientModule, JsonValue } from 'claude-code'

import { BEAT_MS, SPLASH_BEATS, splashScene } from '../src/ui/persona'
import { TEXT } from '../src/ui/theme'

// The splash's scene: a surface module, so that its beats are counted where
// they are drawn. It has no `$` and posts nothing: hooks/design.tsx shows it
// for the splash's time and then draws the designer in its place.

type SplashProps = { rows: number }
type SplashState = { beat: number }

// The one ticker, as in ./canvas.tsx: the handle and the beat's body live here
// because a drawing's closures are replaced on every call. It runs from the
// first drawing to the last beat.
let stopTicker: (() => void) | null = null
let onBeat: (() => void) | null = null

const Splash: ClientModule<JsonValue, SplashState> = (raw, surface) => {
  // On a reload one frame of props can come in another shape: they are read defensively.
  const props: Partial<SplashProps> = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Partial<SplashProps>) : {}
  const rows = typeof props.rows === 'number' ? props.rows : 0
  const { Box, Text } = surface.elements
  const beat = surface.state?.beat ?? 0

  if (stopTicker === null && beat < SPLASH_BEATS - 1) stopTicker = surface.every(BEAT_MS, () => onBeat?.())
  onBeat = () => {
    if (beat + 1 >= SPLASH_BEATS - 1) {
      stopTicker?.()
      stopTicker = null
    }
    surface.setState({ beat: beat + 1 })
  }

  const scene = splashScene(beat, surface.columns > 0 ? surface.columns : 80, rows)
  const pad = Math.max(0, Math.floor((surface.columns - scene.width) / 2))

  return (
    <Box flexDirection="column" paddingLeft={pad}>
      {scene.lines.map(line => (
        <Box flexDirection="row">
          {line.map(span => (
            <Text color={span.color ?? TEXT} backgroundColor={span.ground}>{span.text}</Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export default Splash
