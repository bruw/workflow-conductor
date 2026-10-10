export const meta = {
  name: 'e2e',
  description: 'Smoke test: one greet agent, then echo over alpha and beta (3 agents total)',
  phases: [{ title: 'n1 greet' }, { title: 'n2 echo ×2' }],
}

phase('n1 greet')
const greet = await agent('Reply with the single word ok.', {
  label: 'n1: greet',
  phase: 'n1 greet',
  model: 'haiku',
  effort: 'low',
})

phase('n2 echo ×2')
const echoes = await pipeline(
  ['alpha', 'beta'],
  word => agent(`Reply with the word ${word} only.`, {
    label: `n3: echo ${word}`,
    phase: 'n2 echo ×2',
    model: 'haiku',
    effort: 'low',
  }),
)

return { greet, echoes }
