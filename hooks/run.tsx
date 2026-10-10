import type { On } from 'claude-code'

import { GLYPH, PANE_ID, PANE_TITLE } from '../src/ui/theme'

const PLACEHOLDER = 'no workflow loaded yet'

export const registerRun = (on: On): void => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'conductor',
      description: 'Open the Conductor workflow pane',
    })

    return next(e)
  })

  on('command.run', { command: 'conductor' }, async $ => {
    await $.ui.open({ id: PANE_ID, title: PANE_TITLE })

    return { text: 'Conductor pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text bold>{`${GLYPH.diamond} ${PANE_TITLE}`}</Text>
        <Text dimColor>{`${GLYPH.railEnd} ${PLACEHOLDER}`}</Text>
      </Box>
    )
  })
}
