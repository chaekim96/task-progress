import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Step } from '../types'

const PANE = 'task-progress'
const WIDTH = 20
const steps = atom({ plugin: 'task-progress', key: 'steps' } as const, [])

// The desktop app's task list (Code tab) and its end-of-turn wrap-up.
const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
const WRAP_TOOL = 'mcp__ccd_turn__wrap_up'

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
    const current = next.findIndex(step => step.status === 'in_progress')
    if (current >= 0) next[current].status = 'completed'
    const pending = next.findIndex(step => step.status === 'pending')
    if (pending >= 0) next[pending].status = 'in_progress'
  }
  for (const n of input.done ?? []) {
    if (next[n - 1]) next[n - 1].status = 'completed'
  }
  if (typeof input.start === 'number' && next[input.start - 1]) {
    next = next.map(step => (step.status === 'in_progress' ? { ...step, status: 'pending' } : step))
    next[input.start - 1].status = 'in_progress'
  }
  return next
}

function bar(done: number, total: number) {
  const filled = Math.round((done / total) * WIDTH)
  return { filled: '█'.repeat(filled), empty: '░'.repeat(WIDTH - filled) }
}

export const register: Register = on => {
  // TaskCreate's id comes back in its result; map it to the step's position.
  const taskIndex = new Map<string, number>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'task-progress',
      description: 'Show the current task list with a progress bar in a pane',
    })

    return next(e)
  })

  on('command.run', { command: 'task-progress' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Task progress' })

    return { text: 'Task progress pane opened.' }
  })

  // A finished list clears when the next prompt is sent.
  on('prompt.submit', async ($, e, next) => {
    const list = await read($, steps)
    if (list.length > 0 && list.every(step => step.status === 'completed')) {
      taskIndex.clear()
      await update($, steps, () => [])
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // Subagents keep their own lists; only the main session's counts.
    if (e.agentId) return next(e)

    const input = e as unknown as Record<string, unknown>

    if (e.tool === PLAN_TOOL) {
      await update($, steps, list => applyPlan(list, input as PlanInput))
      return next(e)
    }

    if (e.tool === WRAP_TOOL) {
      await update($, steps, list => list.map(step => ({ ...step, status: 'completed' as const })))
      return next(e)
    }

    if (e.tool === 'TodoWrite' && Array.isArray(input.todos)) {
      const todos = input.todos as { content: string; status: Step['status']; activeForm?: string }[]
      await update($, steps, () =>
        todos.map(todo => ({
          label: todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content,
          status: todo.status,
        })),
      )
      return next(e)
    }

    if (e.tool === 'TaskCreate') {
      const ran = await next(e)
      const id = (ran.result as { task?: { id?: string } } | undefined)?.task?.id
      const list = await read($, steps)
      if (id) taskIndex.set(String(id), list.length)
      await update($, steps, prev => [...prev, { label: String(input.subject ?? ''), status: 'pending' }])
      return ran
    }

    if (e.tool === 'TaskUpdate') {
      const at = taskIndex.get(String(input.taskId))
      const status = input.status as Step['status'] | 'deleted' | undefined
      if (at !== undefined && status) {
        await update($, steps, list =>
          status === 'deleted'
            ? list.filter((_, i) => i !== at)
            : list.map((step, i) => (i === at ? { ...step, status } : step)),
        )
      }
      return next(e)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, steps)
    if (e.props.hasSurvey || list.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const done = list.filter(step => step.status === 'completed').length
    const total = list.length
    const pct = Math.round((done / total) * 100)
    const isDone = done === total
    const current = list.find(step => step.status === 'in_progress')
    const { filled, empty } = bar(done, total)

    return (
      <Box>
        <Text color={isDone ? 'green' : 'cyan'}>{filled}</Text>
        <Text dimColor>{empty}</Text>
        <Text>
          {' '}
          {done}/{total} · {pct}%
        </Text>
        {isDone && <Text color="green"> ✓ all done</Text>}
        {!isDone && current && <Text dimColor> ▸ {current.label}</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, steps)
    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No task list yet. It appears when Claude starts a multi-step task.</Text>
        </Box>
      )
    }

    const done = list.filter(step => step.status === 'completed').length
    const { filled, empty } = bar(done, list.length)

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
        {list.map(step => (
          <Text dimColor={step.status === 'pending'} color={step.status === 'completed' ? 'green' : undefined}>
            {step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '▸' : '·'} {step.label}
          </Text>
        ))}
      </Box>
    )
  })
}
