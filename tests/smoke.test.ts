import { expect, test } from 'claude-code/testing'

import { GLYPH, PANE_ID, PANE_TITLE } from '../src/ui/theme'

const SURFACES = ['terminal', 'desktop'] as const

for (const surface of SURFACES) {
  test(`pane draws its title on ${surface}`, async $ => {
    const ui = await $.ui.mount({
      plugin: 'conductor',
      surface,
      component: 'Pane',
      requestId: PANE_ID,
      props: {
        title: PANE_TITLE,
        isFocused: false,
        bodyColumns: 80,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 20 },
        view: {},
      },
    })

    const title = await ui.find({ type: 'Text', text: PANE_TITLE })
    expect(title?.text).toBe(`${GLYPH.diamond} ${PANE_TITLE}`)
    expect(title?.props.bold).toBe(true)

    const dim = (await ui.findAll({ type: 'Text' })).filter(one => one.props.dimColor === true)
    expect(dim.length).toBe(1)
  })
}

test('theme glyphs are distinct single characters', async () => {
  const glyphs = Object.values(GLYPH)

  expect(new Set(glyphs).size).toBe(glyphs.length)
  for (const glyph of glyphs) expect([...glyph].length).toBe(1)
  expect(GLYPH.done).toBe('✓')
})
