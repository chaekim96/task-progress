import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'task-progress',
  component: 'AbovePrompt',
  props: { hasSurvey: false },
} as const

const PLAN = 'mcp__ccd_turn__update_plan'

test('the band follows the desktop task list', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.tool.call({
    tool: PLAN,
    items: [
      { content: 'Read config', status: 'in_progress' },
      { content: 'Write code', status: 'pending' },
      { content: 'Run tests', status: 'pending' },
      { content: 'Ship', status: 'pending' },
    ],
  })
  await $.tool.call({ tool: PLAN, advance: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text', text: /1\/4/ }))?.text).toContain('25%')
  expect((await ui.find({ type: 'Text', text: /Write code/ }))?.text).toContain('Write code')
  await ui.unmount()

  await $.tool.call({ tool: PLAN, done: [2, 3], start: 4 })
  const mid = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect((await mid.find({ type: 'Text', text: /3\/4/ }))?.text).toContain('75%')
  await mid.unmount()

  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'done' })
  const end = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect((await end.find({ type: 'Text', text: /all done/ }))?.text).toContain('all done')
  await end.unmount()
})

test('the band follows TodoWrite and stays hidden with no list', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const empty = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect((await empty.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await empty.unmount()

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'A', status: 'completed', activeForm: 'Doing A' },
      { content: 'B', status: 'in_progress', activeForm: 'Doing B' },
    ],
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text', text: /1\/2/ }))?.text).toContain('50%')
  expect((await ui.find({ type: 'Text', text: /Doing B/ }))?.text).toContain('Doing B')
  await ui.unmount()
})
