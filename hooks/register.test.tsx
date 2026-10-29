import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'task-progress',
  component: 'AbovePrompt',
  props: { hasSurvey: false },
} as const

const PANE = {
  plugin: 'task-progress',
  component: 'Pane',
  requestId: 'task-progress',
  props: {
    title: 'Task progress',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const PLAN = 'mcp__ccd_turn__update_plan'
const WRAP = 'mcp__ccd_turn__wrap_up'

const items = (...rows: [string, string][]) => ({
  tool: PLAN,
  items: rows.map(([content, status]) => ({ content, status })),
})

type Found = { text?: string; props?: { color?: string } } | undefined
type Mounted = { find: (q: object) => Promise<Found>; unmount: () => Promise<void> }

// Stands in for the engine beneath the plugin and records what it was asked.
function world(on: any) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const toasts: string[] = []
  const sounds: unknown[] = []
  const invalidations: string[] = []
  const engine = { result: {} as object }
  on('tool.call', () => ({ result: engine.result }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('ui.toast', (_: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('audio.play', (_: any, e: any) => {
    sounds.push(e)
    return { value: undefined }
  })
  on('ui.invalidate', (_: any, e: any) => {
    invalidations.push(String(e))
    return { value: undefined }
  })
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  return { clock, toasts, sounds, invalidations, engine }
}

// Tool inputs are checked against the tools this machine happens to have connected.
const call = ($: any, input: object) => $.tool.call(input as never)

const find = (ui: Mounted, re: RegExp) => ui.find({ type: 'Text', text: re })
const text = async (ui: Mounted, re: RegExp) => (await find(ui, re))?.text

test('the band follows the desktop task list', async ($, on) => {
  world(on)

  await call($, items(['Read config', 'in_progress'], ['Write code', 'pending'], ['Run tests', 'pending'], ['Ship', 'pending']))
  await call($, { tool: PLAN, advance: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect(await text(ui, /1\/4/)).toContain('25%')
  expect(await text(ui, /Write code/)).toContain('Write code')
  await ui.unmount()

  await call($, { tool: PLAN, done: [2, 3], start: 4 })
  const mid = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect(await text(mid, /3\/4/)).toContain('75%')
  await mid.unmount()

  await call($, { tool: WRAP, recap: 'done' })
  const end = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await text(end, /all done/)).toContain('all done')
  await end.unmount()
})

test('the band follows TodoWrite and stays hidden with no list', async ($, on) => {
  world(on)

  const empty = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect(await text(empty, /engine/)).toBe('engine')
  await empty.unmount()

  await call($, {
    tool: 'TodoWrite',
    todos: [
      { content: 'A', status: 'completed', activeForm: 'Doing A' },
      { content: 'B', status: 'in_progress', activeForm: 'Doing B' },
    ],
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect(await text(ui, /1\/2/)).toContain('50%')
  expect(await text(ui, /Doing B/)).toContain('Doing B')
  await ui.unmount()
})

test('time left appears once a step has finished', async ($, on) => {
  const { clock } = world(on)

  await call($, items(['Read', 'in_progress'], ['Write', 'pending'], ['Test', 'pending']))
  const before = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect(await text(before, /left/)).toBeUndefined()
  await before.unmount()

  await clock.advance(20_000)
  await call($, { tool: PLAN, advance: true })

  // One step took 20s: one pending step plus the whole current one is 40s.
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect(await text(ui, /left/)).toContain('~40s left')
  expect(await text(ui, /▸/)).toContain('Write')
  await ui.unmount()
})

test("the band counts the current step's actions and shows its time", async ($, on) => {
  const { clock } = world(on)

  await call($, items(['Read', 'in_progress'], ['Write', 'pending']))
  await call($, { tool: 'Bash', command: 'ls' })
  await call($, { tool: 'Read', file_path: '/x' })
  await call($, { tool: 'Bash', command: 'ls', agentId: 'sub' })
  await clock.advance(45_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect(await text(ui, /actions/)).toContain('2 actions')
  expect(await text(ui, /· 45s/)).toContain('45s')
  await ui.unmount()

  // The next step starts counting from zero.
  await call($, { tool: PLAN, advance: true })
  await call($, { tool: 'Bash', command: 'ls' })
  const next = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect(await text(next, /1 action/)).toContain('1 action')
  expect(await text(next, /actions/)).toBeUndefined()
  await next.unmount()
})

test('a step named N of M gets a sub-bar, a test summary fills one', async ($, on) => {
  const { engine } = world(on)

  await call($, items(['Migrate 3/10 files', 'in_progress'], ['Run tests', 'pending']))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect(await text(ui, /^ 3\/10$/)).toBeDefined()
  await ui.unmount()

  await call($, { tool: PLAN, advance: true })
  engine.result = { stdout: 'Tests:       1 failed, 11 passed, 12 total', stderr: '' }
  await call($, { tool: 'Bash', command: 'npm test' })
  const tests = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect(await text(tests, /tests 11\/12/)).toContain('tests 11/12')
  await tests.unmount()
})

test('a finished list toasts and chimes once', async ($, on) => {
  const { clock, toasts, sounds } = world(on)

  await call($, items(['A', 'in_progress'], ['B', 'pending'], ['C', 'pending']))
  await clock.advance(30_000)
  await call($, { tool: PLAN, advance: true })
  expect(toasts).toEqual([])
  await clock.advance(40_000)
  await call($, { tool: PLAN, advance: true })
  await clock.advance(1_000)
  await call($, { tool: PLAN, advance: true })

  expect(toasts).toEqual(['All 3 steps done in 1m 11s'])
  expect(sounds.length).toBe(1)

  // More updates to a finished list do not announce again.
  await call($, { tool: WRAP, recap: 'done' })
  await call($, { tool: PLAN, done: [1, 2, 3] })
  expect(toasts.length).toBe(1)
  expect(sounds.length).toBe(1)
})

test('with the chime off the toast still shows', { options: { sound: false } }, async ($, on) => {
  const { toasts, sounds } = world(on)

  await call($, items(['A', 'in_progress']))
  await call($, { tool: PLAN, advance: true })

  expect(toasts.length).toBe(1)
  expect(sounds.length).toBe(0)
})

test('a step past its limit turns amber, and the redraw timer runs only while a step is active', async ($, on) => {
  const { clock, invalidations } = world(on)

  await clock.advance(120_000)
  expect(invalidations.length).toBe(0)

  await call($, items(['Run tests', 'in_progress'], ['Ship', 'pending']))
  const quiet = invalidations.length

  await clock.advance(60_000)
  expect(invalidations.length).toBeGreaterThan(quiet)

  const calm = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  const early = await find(calm, /· 1m/)
  expect(early?.text).toContain('1m')
  expect(early?.props?.color).toBeUndefined()
  await calm.unmount()

  await clock.advance(130_000)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  const stuck = await find(ui, /· 3m/)
  expect(stuck?.text).toContain('3m')
  expect(stuck?.props?.color).toBe('yellow')
  expect(await text(ui, /Run tests/)).toContain('Run tests')
  await ui.unmount()

  // Finished: the timer stops.
  await call($, { tool: WRAP, recap: 'done' })
  const stopped = invalidations.length
  await clock.advance(120_000)
  expect(invalidations.length).toBe(stopped)
})

test("the pane shows each step's time, totals and earlier runs", async ($, on) => {
  const { clock } = world(on)

  await call($, items(['Read config', 'in_progress'], ['Write code', 'pending']))
  await call($, { tool: 'Bash', command: 'ls' })
  await clock.advance(12_000)
  await call($, { tool: PLAN, advance: true })
  await clock.advance(30_000)
  await call($, { tool: PLAN, advance: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect(await text(ui, /Read config/)).toMatch(/✓ Read config\s+12s · 1 action/)
  expect(await text(ui, /Write code/)).toMatch(/✓ Write code\s+30s/)
  expect(await text(ui, /^Total/)).toContain('Total 42s · 1 action')
  await ui.unmount()

  // The next prompt clears the list, which stays in the history.
  await $.prompt.submit({ text: 'next' } as never)
  const empty = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect(await text(empty, /No task list/)).toBeDefined()
  expect(await text(empty, /Previous runs/)).toBe('Previous runs')
  expect(await text(empty, /2 steps in 42s/)).toContain('2 steps in 42s · 1 action')
  await empty.unmount()
})

test("the context bar shows the engine's figure and is absent without one", async ($, on) => {
  world(on)
  const measure = (percent: number) =>
    $.session.measure({ context: { window: 200_000, percent }, rateLimits: [], changed: ['context'] } as never)

  await call($, items(['A', 'in_progress'], ['B', 'pending']))

  const none = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect(await text(none, /ctx/)).toBeUndefined()
  await none.unmount()

  await measure(48)
  const ok = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect((await find(ok, /48%/))?.props?.color).toBe('green')
  await ok.unmount()

  await measure(85)
  const hot = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect((await find(hot, /85%/))?.props?.color).toBe('red')
  await hot.unmount()
})
