import type { ClientModule, JsonValue } from 'claude-code'

import { BEAT_MS, SPLASH_BEATS, splashScene, waitScene } from '../src/ui/persona'
import { TEXT } from '../src/ui/theme'

// The splash's scene, a surface module with no `$` that posts nothing: its beats are counted where they are drawn.
// While a draft is awaited the beat comes with the props, counted by hooks/project.tsx, and no ticker runs here.

type SplashProps = { rows: number; beat?: number }
type SplashState = { beat: number }

// The handle and the beat's body are module variables because a drawing's closures are replaced on every call.
let stopTicker: (() => void) | null = null
let onBeat: (() => void) | null = null

const Splash: ClientModule<JsonValue, SplashState> = (raw, surface) => {
  // On a reload one frame of props can come in another shape: they are read defensively.
  const props: Partial<SplashProps> = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Partial<SplashProps>) : {}
  const rows = typeof props.rows === 'number' ? props.rows : 0
  const { Box, Text } = surface.elements
  const waiting = typeof props.beat === 'number'
  const beat = surface.state?.beat ?? 0

  if (!waiting && stopTicker === null && beat < SPLASH_BEATS - 1) stopTicker = surface.every(BEAT_MS, () => onBeat?.())
  onBeat = () => {
    if (beat + 1 >= SPLASH_BEATS - 1) {
      stopTicker?.()
      stopTicker = null
    }
    surface.setState({ beat: beat + 1 })
  }

  const columns = surface.columns > 0 ? surface.columns : 80
  const scene = typeof props.beat === 'number' ? waitScene(props.beat, columns, rows) : splashScene(beat, columns, rows)
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
