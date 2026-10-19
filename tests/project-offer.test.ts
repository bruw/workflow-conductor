import { expect, test } from 'claude-code/testing'

import { OFFER_OPTIONS, SAVE_OPTIONS, VISUALIZE_OPTIONS, offerChoice, saveChoice, visualizeChoice } from '../src/project/offer'

test('each option of every question is one choice, and every choice has an option; typed text is none', async () => {
  expect(OFFER_OPTIONS.map(offerChoice).sort()).toEqual(['conductor', 'standard'])
  expect(VISUALIZE_OPTIONS.map(visualizeChoice).sort()).toEqual(['skip', 'visualize'])
  expect(SAVE_OPTIONS.map(saveChoice).sort()).toEqual(['save', 'skip'])

  for (const typed of ['', 'design it first', 'conductor']) {
    expect(offerChoice(typed)).toBeNull()
    expect(visualizeChoice(typed)).toBeNull()
    expect(saveChoice(typed)).toBeNull()
  }
})
