import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { HistoryEntry, Run, Step } from '../types'
import {
  bar,
  currentStep,
  elapsedMs,
  fmtDur,
  keepHistory,
  layoutBand,
  stamp,
  stepMs,
  subOf,
  testCounts,
} from './lib'

const PANE = 'task-progress'
const TICK_MS = 20000
const steps = atom({ plugin: 'task-progress', key: 'steps' } as const, [])
const run = atom({ plugin: 'task-progress', key: 'run' } as const, null)
const ctx = atom({ plugin: 'task-progress', key: 'ctx' } as const, null)
const model = atom({ plugin: 'task-progress', key: 'model' } as const, null)
const history = atom({ plugin: 'task-progress', key: 'history' } as const, [])

// The desktop app's task list (Code tab) and its end-of-turn wrap-up.
const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
const WRAP_TOOL = 'mcp__ccd_turn__wrap_up'
const LIST_TOOLS = new Set([PLAN_TOOL, WRAP_TOOL, 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'])

type PlanInput = {
  items?: { content: string; status: Step['status'] }[]
  advance?: boolean
  done?: number[]
  start?: number
}

// Applies one update_plan call: a whole new list, or advance / done / start on the current one.
function applyPlan(list: Step[], input: PlanInput): Step[] {
  if (Array.isArray(input.items)) {
    return input.items.map(item => ({ label: item.content, status: item.status }))
  }
  let next = list.map(step => ({ ...step }))
  if (input.advance) {
    const current = next.find(step => step.status === 'in_progress')
    if (current) current.status = 'completed'
    const pending = next.find(step => step.status === 'pending')
    if (pending) pending.status = 'in_progress'
  }
  for (const n of input.done ?? []) {
    const step = next[n - 1]
    if (step) step.status = 'completed'
  }
  if (typeof input.start === 'number' && next[input.start - 1]) {
    next = next.map(step => (step.status === 'in_progress' ? { ...step, status: 'pending' } : step))
    const target = next[input.start - 1]
    if (target) target.status = 'in_progress'
  }
  return next
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

let timer: Timer | undefined
let isSoundOn = true
// Runs already announced, so a burst of updates cannot notify twice.
const announced = new Set<number>()

// A redraw timer runs only while a step is in progress.
async function syncTimer($: EngineInterface) {
  const active = currentStep(await read($, steps)) !== undefined
  if (active && !timer) {
    timer = $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
  } else if (!active && timer) {
    timer.cancel()
    timer = undefined
  }
}

async function saveHistory($: EngineInterface, next: HistoryEntry[]) {
  await update($, history, () => next)
  await $.store.set('history', next)
}

// Writes the list, keeps the run in step with it, and fires the done notice once.
async function setSteps(
  $: EngineInterface,
  fn: (list: Step[]) => Step[],
  byIndex = false,
) {
  const now = await $.clock.now()
  const prev = await read($, steps)
  const next = stamp(prev, fn(prev), now, byIndex)
  await update($, steps, () => next)

  const current = await read($, run)
  const isAllDone = next.length > 0 && next.every(step => step.status === 'completed')
  let active = current
  if (next.length === 0) {
    active = null
  } else if (!current || (current.notified && !isAllDone)) {
    active = { startedAt: now, notified: false, actions: 0 }
  }
  if (active !== current) {
    await update($, run, () => active)
    if (!active) announced.clear()
  }

  if (active && isAllDone && !active.notified && !announced.has(active.startedAt)) {
    announced.add(active.startedAt)
    const ms = now - active.startedAt
    const finished: Run = { ...active, notified: true, finishedAt: now }
    await update($, run, () => finished)
    $.ui.toast(`All ${plural(next.length, 'step')} done in ${fmtDur(ms)}`)
    if (isSoundOn) $.audio.play({ asset: 'assets/chime.wav' }).catch(() => undefined)
    const entry: HistoryEntry = { steps: next.length, ms, actions: active.actions, at: now }
    await saveHistory($, keepHistory(await read($, history), entry))
  }
  await syncTimer($)
}

export const register: Register = (on, options) => {
  // TaskCreate's id comes back in its result; map it to the step's position.
  const taskIndex = new Map<string, number>()
  isSoundOn = (options as { sound?: boolean } | undefined)?.sound !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'task-progress',
      description: 'Show the current task list with a progress bar in a pane',
    })

    const saved = await $.store.get('history')
    if (Array.isArray(saved) && (await read($, history)).length === 0) {
      await update($, history, () => saved as HistoryEntry[])
    }
    try {
      const { context } = await $.session.usage()
      if (context.percent !== undefined) await update($, ctx, () => Math.round(context.percent as number))
    } catch {
      // No context figure yet; the band leaves the bar out.
    }
    await syncTimer($)

    return next(e)
  })

  on('command.run', { command: 'task-progress' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Task progress' })

    return { text: 'Task progress pane opened.' }
  })

  // The engine measures the session after each turn; its context fill drives the ctx bar.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      const percent = e.context.percent
      await update($, ctx, () => (percent === undefined ? null : Math.round(percent)))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && e.usage?.model) {
      const id = e.usage.model
      await update($, model, () => id)
    }

    return next(e)
  })

  // A finished list clears when the next prompt is sent.
  on('prompt.submit', async ($, e, next) => {
    const list = await read($, steps)
    if (list.length > 0 && list.every(step => step.status === 'completed')) {
      taskIndex.clear()
      await setSteps($, () => [])
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // Subagents keep their own lists; only the main session's counts.
    if (e.agentId) return next(e)

    const input = e as unknown as Record<string, unknown>

    if (e.tool === PLAN_TOOL) {
      await setSteps($, list => applyPlan(list, input as PlanInput))
      return next(e)
    }

    if (e.tool === WRAP_TOOL) {
      await setSteps($, list => list.map(step => ({ ...step, status: 'completed' as const })))
      return next(e)
    }

    if (e.tool === 'TodoWrite' && Array.isArray(input.todos)) {
      const todos = input.todos as { content: string; status: Step['status']; activeForm?: string }[]
      await setSteps(
        $,
        () =>
          todos.map(todo => ({
            label: todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content,
            status: todo.status,
          })),
        true,
      )
      return next(e)
    }

    if (e.tool === 'TaskCreate') {
      const ran = await next(e)
      const id = (ran.result as { task?: { id?: string } } | undefined)?.task?.id
      const list = await read($, steps)
      if (id) taskIndex.set(String(id), list.length)
      await setSteps($, prev => [...prev, { label: String(input.subject ?? ''), status: 'pending' }], true)
      return ran
    }

    if (e.tool === 'TaskUpdate') {
      const at = taskIndex.get(String(input.taskId))
      const status = input.status as Step['status'] | 'deleted' | undefined
      if (at !== undefined && status) {
        await setSteps(
          $,
          list =>
            status === 'deleted'
              ? list.filter((_, i) => i !== at)
              : list.map((step, i) => (i === at ? { ...step, status } : step)),
          true,
        )
      }
      return next(e)
    }

    if (LIST_TOOLS.has(e.tool)) return next(e)

    // Any other main-session call is an action of the current step.
    if (currentStep(await read($, steps))) {
      await update($, steps, list => list.map(step => (step.status === 'in_progress' ? { ...step, actions: (step.actions ?? 0) + 1 } : step)))
      await update($, run, r => (r ? { ...r, actions: r.actions + 1 } : r))
    }

    if (e.tool === 'Bash') {
      const ran = await next(e)
      const out = ran.result as { stdout?: string; stderr?: string } | undefined
      const counts = testCounts(`${out?.stdout ?? ''}\n${out?.stderr ?? ''}`)
      if (counts) {
        await update($, steps, list => list.map(step => (step.status === 'in_progress' ? { ...step, tests: counts } : step)))
      }
      return ran
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, steps)
    if (e.props.hasSurvey || list.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const segs = layoutBand({
      steps: list,
      run: await read($, run),
      ctx: await read($, ctx),
      now: await $.clock.now(),
      cols: (e.props as { bodyColumns?: number }).bodyColumns ?? 100,
    })

    return (
      <Box>
        {segs.map(seg => (
          <Text color={seg.color} dimColor={seg.dim}>
            {seg.text}
          </Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, steps)
    const past = await read($, history)
    const current = await read($, run)

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No task list yet. It appears when Claude starts a multi-step task.</Text>
          {past.length > 0 && <Text> </Text>}
          {past.length > 0 && <Text bold>Previous runs</Text>}
          {past.map(prior => (
            <Text dimColor>
              {plural(prior.steps, 'step')} in {fmtDur(prior.ms)} · {plural(prior.actions, 'action')}
            </Text>
          ))}
        </Box>
      )
    }

    const now = await $.clock.now()
    const done = list.filter(step => step.status === 'completed').length
    const { filled, empty } = bar(done, list.length, 20)
    const pad = Math.min(36, Math.max(...list.map(step => [...step.label].length)))
    const modelId = await read($, model)
    const total = current ? (current.finishedAt ?? now) - current.startedAt : undefined
    const earlier = current?.notified ? past.slice(1) : past

    return (
      <Box flexDirection="column">
        <Box>
          <Text color={done === list.length ? 'green' : 'cyan'}>{filled}</Text>
          <Text dimColor>{empty}</Text>
          <Text>
            {' '}
            {done}/{list.length}
          </Text>
        </Box>
        {list.map(step => {
          const label = [...step.label].length > 36 ? `${[...step.label].slice(0, 35).join('')}…` : step.label
          const spacing = ' '.repeat(Math.max(2, pad - [...label].length + 2))
          const dur = step.status === 'completed' ? stepMs(step) : elapsedMs(step, now)
          const sub = step.status === 'in_progress' ? subOf(step) : undefined
          const extra = [
            dur !== undefined ? fmtDur(dur) : '',
            step.actions ? plural(step.actions, 'action') : '',
            sub ? `${sub.done}/${sub.total}` : '',
          ].filter(Boolean)
          return (
            <Text dimColor={step.status === 'pending'} color={step.status === 'completed' ? 'green' : undefined}>
              {step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '▸' : '·'} {label}
              {extra.length > 0 ? `${spacing}${extra.join(' · ')}` : ''}
            </Text>
          )
        })}
        {total !== undefined && <Text> </Text>}
        {total !== undefined && (
          <Text dimColor>
            Total {fmtDur(total)} · {plural(current?.actions ?? 0, 'action')}
            {modelId ? ` · ${modelId}` : ''}
          </Text>
        )}
        {earlier.length > 0 && <Text> </Text>}
        {earlier.length > 0 && <Text bold>Previous runs</Text>}
        {earlier.map(prior => (
          <Text dimColor>
            {plural(prior.steps, 'step')} in {fmtDur(prior.ms)} · {plural(prior.actions, 'action')}
          </Text>
        ))}
      </Box>
    )
  })
}
